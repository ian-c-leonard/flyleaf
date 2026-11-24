#!/usr/bin/env python3
"""Keep every note whole on the page of its mark, by layout alone.

book.yaml `notes: same-page` turns this on. The typesetter fills a page with
text first, so a note near the foot is cut in two, or pushed to the next page
with its mark left behind. This step makes a print copy of the assembled book
in which such text starts the next page instead. It changes no word and no
note: the print copy differs from the assembled book only by layout marks,
`strip_marks` takes them out again, and the build compares the two.

How it works. The book is laid out and every note reports the page of its
mark and the pages where it starts and ends. For the first note that is not
wholly on its mark's page, the line of text that carries the mark is found
(by laying the paragraph out once more with a probe before every word), and
the mark `#notes-cut();` is written before the first word of that line: the
page ends there. Text that is not a one-line paragraph of running text (a
kept-together block, a list, a list of children) moves whole, with a line
`#notes-page()` above it. Then the book is laid out again, until no note
leaves its page.

Each top-level section (a chapter) starts on a new page, so its pages do not
depend on the sections before it. Sections are therefore worked on alone, in
parallel, in a small copy that lays out in a second or two, and the result is
kept between builds for as long as nothing it depends on changes. The whole
print copy is then laid out, and that layout is the one that counts: a note
still off its page is worked on there, and a cut that does not fall at the
start of a line there is taken out and made again.
"""
import concurrent.futures
import hashlib
import json
import os
import re
import subprocess
import threading
import time
from collections import Counter
from pathlib import Path

import booklib

CUT = '#notes-cut();'
PAGE = '#notes-page()'
MARK = 10 ** 7                      # the probe that stands at a note's mark
IDENT = re.compile(r'#[A-Za-z_][A-Za-z0-9_.-]*')
LISTLIKE = re.compile(r'\s*(?:\d+\.|[-+/])(?:\s|$)')
LABEL_AHEAD = re.compile(r'<[A-Za-z0-9_.:-]+>')
GLYPHS = '“”‘"\'″′;?!&'              # compared between the plain and the print PDF
RULE = re.compile(r'#(?:import|set|show|let)\b')
BREAK = re.compile(r'#(?:pagebreak|colbreak)\([^()]*\)')
PICTURE = re.compile(r'"(/[^"\n]+\.(?:jpe?g|png|gif|webp|svg|pdf))"', re.I)
CHECKS = '<fn-check>'
WHOLE_BOOK_ROUNDS = 40              # moves made in the whole book, after the sections
Stop = booklib.Stop                 # the step cannot go on; the message says why


# ---------- reading the assembled text ----------

def scan_line(line, stack):
    """Advance the bracket stack over one source line. Returns (bounds, notes):
    the word starts that lie in the paragraph's own text, each with whether the
    text may be cut there, and (start, end) of each footnote on the line.
    Inside _emphasis_ or *strong* text a word start is known but not cuttable,
    and a place that already has a cut is not cut again. Nor is the text cut
    inside a quotation written with straight quotes: the typesetter pairs
    those within a paragraph, and a cut would turn the closing one around.
    A note that is still open where the line ends is returned in `notes` with
    the end of the line as its end."""
    bounds, notes, opened = [], [], []
    quotes = []                                  # straight quotations open in the paragraph's text: True is double
    i, n = 0, len(line)
    while i < n:
        c = line[i]
        top = stack[-1] if stack else ''
        if c == '\\':
            i += 2
            continue
        if top == '"':
            if c == '"':
                stack.pop()
            i += 1
            continue
        if c == '/' and line.startswith('//', i) and (top == '(' or i == 0 or line[i - 1].isspace()):
            break                           # a comment runs to the end of the line
        if top == '(':
            if c == '"':
                stack.append('"')
            elif c == '(':
                stack.append('(')
            elif c == ')':
                stack.pop()
            elif c == '[':
                stack.append('[')
            i += 1
            continue
        if c == '#':
            if line.startswith(CUT, i):
                i += len(CUT)
                continue
            if line.startswith('#footnote[', i):
                stack.append('f')
                opened.append(i)
                i += 10
                continue
            m = IDENT.match(line, i)
            if m:
                j = m.end()
                if j < n and line[j] in '([':
                    stack.append(line[j])
                    i = j + 1
                else:
                    i = j
                continue
            i += 1
            continue
        if c == '[':
            stack.append('[')
        elif c == ']':
            while stack and stack[-1] in 'es':
                stack.pop()                 # emphasis never runs past the group it began in
            if stack and stack.pop() == 'f' and opened:
                notes.append((opened.pop(), i + 1))
        elif c in '"\'' and 'f' not in stack:
            # The typesetter's own rule for straight quotes (typst: SmartQuoter).
            before = line[i - 1] if i else ' '
            double, last = c == '"', quotes[-1] if quotes else None
            if before.isnumeric() and last != double:
                pass                        # a prime, as in 5' 10"
            elif not double and last is not False and before.isalpha():
                pass                        # an apostrophe
            elif last == double and not before.isspace() and before not in '([{':
                quotes.pop()
            else:
                quotes.append(double)
        elif c in '_*':
            before = line[i - 1] if i else ' '
            after = line[i + 1] if i + 1 < n else ' '
            if not (before.isalnum() and after.isalnum()):      # inside a word it is a plain character
                kind = 'e' if c == '_' else 's'
                if top == kind:
                    stack.pop()
                else:
                    stack.append(kind)
        elif c == ' ' and i + 1 < n and line[i + 1] not in ' "\'' and all(k in 'es' for k in stack):
            free = (not stack and not quotes and not line.startswith(CUT, i + 1)
                    and not LABEL_AHEAD.match(line, i + 1))     # a label belongs to what stands before it
            bounds.append((i + 1, free))
        i += 1
    notes.extend((start, n) for start in opened)                # notes that run on to the next line
    return bounds, notes


def index(lines):
    """The notes in order as (line, start, end); each line's word starts; how
    many groups are open where each line begins; and whether each line ends
    with every group closed."""
    stack, notes, bounds, depth, closed = [], [], [], [], []
    for k, line in enumerate(lines):
        while stack and stack[-1] in 'es':
            stack.pop()                     # emphasis ends with its line
        depth.append(len(stack))
        b, found = scan_line(line, stack)
        bounds.append(b)
        notes.extend((k, s, e) for s, e in sorted(found))
        closed.append(not [s for s in stack if s not in 'es'])
    return notes, bounds, depth, closed


def apart(line):
    """A source line that cannot belong to the paragraph beside it: a blank
    line, a heading, or a page break on a line of its own."""
    return not line.strip() or line.startswith('=') or line == PAGE or bool(BREAK.fullmatch(line))


def plain(lines, depth, closed, k):
    """A paragraph of running text written on one line, which may be cut
    between two of its lines on the page. A paragraph that runs over several
    source lines, a list item, a heading or a call is not: it moves whole."""
    line = lines[k]
    return (depth[k] == 0 and closed[k] and bool(line.strip()) and line[0] not in '#=])'
            and not LISTLIKE.match(line)
            and (k == 0 or (depth[k - 1] == 0 and apart(lines[k - 1])))
            and (k + 1 == len(lines) or apart(lines[k + 1])))


def chunk_start(depth, k):
    while depth[k] > 0:
        k -= 1
    return k


def block_start(lines, depth, k):
    """The first line of the block of text that holds line k: lines with no
    blank line between them belong together, as do the lines of one call.
    A heading or a page break opens a block, whatever stands above it."""
    k = chunk_start(depth, k)
    while k > 0:
        if lines[k - 1].strip() and not (lines[k].startswith('=') or BREAK.fullmatch(lines[k])):
            k = chunk_start(depth, k - 1)
            continue
        # The items of one list belong together even with blank lines between
        # them: a break there would start the numbering again.
        prev = k - 1
        while prev > 0 and not lines[prev].strip():
            prev -= 1
        if list_kind(lines[k]) and depth[prev] == 0 and list_kind(lines[prev]) == list_kind(lines[k]):
            k = prev
            continue
        break
    return k


def list_kind(line):
    """'-' for a bullet, '+' for a numbered item, '/' for a term; '' otherwise."""
    m = LISTLIKE.match(line)
    return '' if not m else ('+' if m.group(0).strip()[0] in '+0123456789' else m.group(0).strip()[0])


def leads_in(line):
    """A source line that introduces the text under it and must not be left
    behind at the foot of a page: a heading below chapter level, a section's
    address, or a block the template keeps with what follows."""
    return (line.startswith('==') or line.startswith('#metadata(none) <')
            or (line.startswith('#block(') and 'sticky: true' in line.split('[', 1)[0]))


def before_block(lines, depth, k):
    """Where a page mark goes so that the block holding line k opens the next
    page: above its heading or lead-in, if it has one, so that goes with it.
    A chapter heading is not climbed over: it opens a page already."""
    j = block_start(lines, depth, k)
    while True:
        prev = j - 1
        while prev > 0 and not lines[prev].strip():
            prev -= 1
        above = block_start(lines, depth, prev) if prev > 0 else 0
        if prev > 0 and depth[above] == 0 and leads_in(lines[above]):
            j = above
        else:
            return j


def cut_line(line, offset):
    return line[:offset] + CUT + line[offset:]


def strip_marks(lines):
    """The assembled text again, from a print copy."""
    out, after_page = [], False
    for line in lines:
        if line == PAGE:
            after_page = True
            continue
        if after_page:
            after_page = False
            if line == '':
                continue
        out.append(line.replace(CUT, ''))
    return out


def sections(lines, depth):
    """The line where each top-level section starts. Everything before the
    first is front pages."""
    starts = [i for i, l in enumerate(lines) if l.startswith('= ') and depth[i] == 0]
    if not starts:
        raise Stop('The assembled book has no top-level heading.')
    return starts


def carried(lines, depth, start):
    """The rules in force where a section starts: every import, set, show and
    let written at the top level before it. A section laid out alone needs
    them, or its paragraphs would not be set as they are in the book."""
    return [l for i, l in enumerate(lines[:start]) if depth[i] == 0 and RULE.match(l)]


LABEL = re.compile(r'(?<!#ref\()(?<!#link\()<([A-Za-z0-9_.:-]+)>')


def stubs(seg_lines, charts):
    """Lines that stand in for labels a section points to in other sections."""
    text = '\n'.join(seg_lines)
    numbered = set(re.findall(r'#ref\(<([^>]+)>\)', text))
    wanted = numbered | set(re.findall(r'#ref\(<([^>]+)>,', text)) | set(re.findall(r'#link\(<([^>]+)>\)', text))
    missing = sorted(wanted - set(LABEL.findall(text)))
    out = ['#pagebreak()'] if missing else []
    for label in missing:
        if label in numbered:
            number = charts.get(label)
            update = (f'#counter(figure.where(kind: "family-chart")).update({number - 1})' if number else '')
            out.append(update + '#figure(kind: "family-chart", supplement: [Chart], caption: [stub], [stub]) '
                       f'<{label}>')
        else:
            out.append(f'==== Stub <{label}>')
        out.append('')
    return out


def kind_text(kind):
    return kind if kind in ('image', 'table', 'raw') else json.dumps(kind)


def standalone(rules, counters, seg_lines, charts):
    """A small book holding one section, set and numbered as in the whole
    book. Returns (lines, how many lines stand before the section)."""
    head = list(rules) + [f'#counter(footnote).update({counters["footnote"]})']
    head += [f'#counter(figure.where(kind: {kind_text(kind)})).update({n})'
             for kind, n in sorted(counters['figures'].items()) if n]
    head.append('')
    return head + list(seg_lines) + [''] + stubs(seg_lines, charts), len(head)


# ---------- reading a layout ----------

def clean(v):
    return v['anchor'] == v['entry_start'] == v['entry_end']


def plain_text(node):
    if isinstance(node, dict):
        return node.get('text', '') + ''.join(plain_text(v) for k, v in node.items() if k != 'text')
    if isinstance(node, list):
        return ''.join(plain_text(v) for v in node)
    return ''


def letters(text):
    return re.sub(r'[^a-z0-9]', '', text.lower())


def at_line_start(v, left, width):
    """Whether a probe stands where a line of text begins: at the right edge
    of the line above (the line was broken after it) or at the left edge."""
    edge = left[v['page'] % 2]
    return v['x'] >= edge + width - 1.0 or abs(v['x'] - edge) < 1.0


def rows_from_probes(pos, count, left, width, locked=()):
    """The lines of a paragraph, from the probes before its words (0 is the
    paragraph's start). A probe before the first word of a line sits at the
    right edge of the line above, because the line was broken after it. A line
    that starts inside a hyphenated word has no such probe: it is not `clean`,
    and the text cannot be cut there. Nor can it be cut before a `locked`
    word, one inside emphasis."""
    rows = [{'ids': [0], 'clean': True, 'page': pos[0]['page'], 'y': None}]
    for i in range(1, count + 1):
        v = pos[i]
        key = (v['page'], round(v['y'], 1))
        cur = rows[-1]
        if v['x'] >= left[v['page'] % 2] + width - 1.0:
            rows.append({'ids': [i], 'clean': i not in locked, 'page': None, 'y': None})
        elif abs(v['x'] - left[v['page'] % 2]) < 1.0 and cur['y'] is not None and (cur['page'], cur['y']) != key:
            rows.append({'ids': [i], 'clean': i not in locked, 'page': v['page'], 'y': key[1]})
        elif cur['y'] is None:
            cur['ids'].append(i)
            cur['page'], cur['y'] = key
        elif (cur['page'], cur['y']) == key:
            cur['ids'].append(i)
        else:
            rows.append({'ids': [i], 'clean': False, 'page': v['page'], 'y': key[1]})
    for n, row in enumerate(rows):
        if row['page'] is None:               # a line of one word: take the page of the line after it
            later = next((r['page'] for r in rows[n + 1:] if r['page'] is not None), None)
            row['page'] = later if later is not None else pos[row['ids'][0]]['page']
    return rows


def choose(rows, word, page, early, has_mark):
    """Which line of the paragraph opens the next page. Returns ('cut', row),
    ('whole',) for the whole paragraph, or None when no move can help.
    `word` is the probe of the word that carries the mark, `page` the mark's
    page, `early` whether the note began on the page before its mark."""
    c = next(n for n, row in enumerate(rows) if word in row['ids'])
    while rows[c]['page'] < page and c + 1 < len(rows):
        c += 1
    first_here = next((n for n, row in enumerate(rows) if row['page'] == page), 0)
    last = len(rows) - 1
    # The text can be cut only where a line starts with a whole word, outside
    # emphasis and quotations. Failing that at the mark's own line, an earlier
    # line moves too, on the page before if need be.
    while c > 0 and not rows[c]['clean']:
        c -= 1
    # One line alone at the head or the foot of a page is avoided only when
    # that costs no notes: a line that carries marks takes its notes with it
    # and leaves a much emptier page.
    if c == last and last >= 3 and c - 1 > first_here and rows[c - 1]['clean'] and not has_mark(c - 1):
        c -= 1
    if c == 0:
        return ('whole',)
    if c == first_here and not early:
        # The mark's line already opens its page, so no move gives its notes
        # more room. (When the note began on the page before its mark, cutting
        # there does help: the note then goes over with its line.)
        return None
    if c == 1 and rows[0]['page'] == rows[1]['page'] and not has_mark(0):
        return ('whole',)
    return ('cut', c)


class Layout:
    """Lays a copy of the book out and reads where its notes fell."""

    def __init__(self, root, env, work, left, width):
        self.root, self.env, self.work = Path(root), env, Path(work)
        self.left, self.width = left, width      # left edge of the text on odd and even pages; its width
        self.work.mkdir(parents=True, exist_ok=True)
        self.queries, self._count = 0, threading.Lock()

    def query(self, name, lines, selector):
        src = self.work / name
        src.write_text('\n'.join(lines), encoding='utf-8')
        with self._count:
            self.queries += 1
        done = subprocess.run(['typst', 'query', '--root', str(self.root), str(src), selector],
                              capture_output=True, text=True, env=self.env, cwd=self.root)
        if done.returncode:
            raise Stop('The layout step could not lay out ' + name + ':\n' + done.stderr[-1500:])
        return json.loads(done.stdout)

    def checks(self, name, lines):
        return records(self.query(name, lines, CHECKS))


def records(elements):
    recs = [e['value'] for e in elements if e.get('label') == CHECKS]
    if any('entry_end' not in v for v in recs):
        raise Stop('The book template does not report where a note ends; update the template.')
    return {v['number']: v for v in recs}


def offenders(recs, first, last, skip):
    return [v for n, v in sorted(recs.items()) if first <= n <= last and n not in skip and not clean(v)]


def plan(layout, name, lines, notes, bounds, depth, closed, at, rec, recs):
    """How to move the mark of the note at index `at` to the next page:
    ('cut', line, offset), ('page', line) or None."""
    k, start, _ = notes[at]
    if not plain(lines, depth, closed, k):
        return ('page', before_block(lines, depth, k))
    line, offs = lines[k], [o for o, _ in bounds[k]]
    locked = {i + 1 for i, (_, free) in enumerate(bounds[k]) if not free}
    inserts = [(0, 0)] + [(o, i + 1) for i, o in enumerate(offs)] + [(start, MARK)]
    probed = line
    for o, i in sorted(inserts, key=lambda t: (-t[0], -t[1])):
        probed = probed[:o] + f'#notes-probe({i});' + probed[o:]
    got = layout.query(name, lines[:k] + [probed] + lines[k + 1:], f'selector(<notes-probe>).or({CHECKS})')
    pos = {e['value']['i']: e['value'] for e in got if e.get('label') == '<notes-probe>'}
    page = pos[MARK]['page']
    whole = ('page', before_block(lines, depth, k))
    if records(got) != recs or len(pos) != len(inserts):
        return whole                                    # the probes moved the text; do not trust them
    rows = rows_from_probes(pos, len(offs), layout.left, layout.width, locked)
    marks = [s for kk, s, _ in notes if kk == k]
    last = len(rows) - 1

    def has_mark(n):
        a = offs[rows[n]['ids'][0] - 1] if rows[n]['ids'][0] else 0
        b = offs[rows[n + 1]['ids'][0] - 1] if n < last else len(line)
        return any(a <= m < b for m in marks)
    word = max([0] + [i + 1 for i, o in enumerate(offs) if o <= start])
    choice = choose(rows, word, page, rec['entry_start'] < rec['anchor'], has_mark)
    if choice is None:
        return None
    if choice[0] == 'whole':
        return whole
    return ('cut', k, offs[rows[choice[1]]['ids'][0] - 1])


def apply(lines, choice):
    out = list(lines)
    if choice[0] == 'page':
        out[choice[1]:choice[1]] = [PAGE, '']
    else:
        out[choice[1]] = cut_line(out[choice[1]], choice[2])
    return out


def fix(layout, name, lines, first, last, base, skip=(), limit=None):
    """Move text until no note numbered first..last leaves its page, or until
    `limit` notes have been worked on. `base` is the number of the first note
    in `lines`. Returns (lines, moves, the notes that could not be helped)."""
    skip, moves = set(skip), []
    given = set(skip)
    recs = layout.checks(name, lines)
    rounds = 0
    while limit is None or rounds < limit:
        off = offenders(recs, first, last, skip)
        if not off:
            break
        rounds += 1
        v = off[0]
        n = v['number']
        notes, bounds, depth, closed = index(lines)
        if len(notes) != len(recs):
            raise Stop(f'{name}: {len(notes)} notes in the text but {len(recs)} on its pages.')
        choice = plan(layout, name, lines, notes, bounds, depth, closed, n - base, v, recs)
        done, tried_page = False, False
        while choice and not done:
            trial = apply(lines, choice)
            after = layout.checks(name, trial)
            if clean(after[n]) and not any(o['number'] < n for o in offenders(after, first, last, skip)):
                lines, recs, done = trial, after, True
                moves.append({'note': n, 'page': v['anchor'], 'kind': choice[0]})
            elif choice[0] == 'cut' and not tried_page:
                tried_page = True
                choice = ('page', before_block(lines, depth, notes[n - base][0]))
            else:
                choice = None
        if not done:
            skip.add(n)
    return lines, moves, sorted(skip - given)


def misplaced_cuts(layout, name, lines):
    """The cuts in `lines` that do not fall where a line of text begins, as
    (line, which cut on that line). A paragraph breaks into the same lines with
    or without a cut at the start of one of them, so the book is laid out with
    a probe in place of every cut, and each probe must stand at a line start."""
    probed, where = [], []
    for k, line in enumerate(lines):
        parts = line.split(CUT)
        out = parts[0]
        for n, part in enumerate(parts[1:]):
            out += f'#notes-probe({len(where)});' + part
            where.append((k, n))
        probed.append(out)
    if not where:
        return []
    got = layout.query(name, probed, '<notes-probe>')
    pos = {e['value']['i']: e['value'] for e in got}
    return [where[i] for i in range(len(where)) if not at_line_start(pos[i], layout.left, layout.width)]


def without_cuts(lines, cuts):
    """`lines` with the given cuts, as (line, which cut on that line), taken out."""
    out = list(lines)
    for k in sorted({k for k, _ in cuts}):
        gone = {n for kk, n in cuts if kk == k}
        parts = out[k].split(CUT)
        text = parts[0]
        for n, part in enumerate(parts[1:]):
            text += ('' if n in gone else CUT) + part
        out[k] = text
    return out


# ---------- the whole book ----------

def read_book(layout, lines, starts):
    """One layout of the whole book: every note's pages and words, and for
    each section the note and figure numbers that stand before it."""
    got = layout.query('whole.typ', lines,
                       f'selector(heading.where(level: 1)).or(figure).or(footnote).or({CHECKS})')
    heads, figures, seen, bodies = [], {}, 0, []
    for e in got:
        if e.get('func') == 'heading':
            heads.append({'title': letters(plain_text(e.get('body'))), 'footnote': seen, 'figures': dict(figures)})
        elif e.get('func') == 'figure':
            kind = e.get('kind', 'image')
            figures[kind] = figures.get(kind, 0) + 1
        elif e.get('func') == 'footnote':
            bodies.append(e.get('body'))
        elif e.get('label') == CHECKS:
            seen += 1
    recs = records(got)
    if sorted(recs) != list(range(1, len(recs) + 1)):
        raise Stop('The notes of the book are not numbered 1 to n; the layout step cannot follow them.')
    counters, at = [], 0
    for start in starts:
        title = letters(re.sub(r'<[A-Za-z0-9_.:-]+>\s*$', '', lines[start][2:]).replace('\\', ''))
        while at < len(heads) and heads[at]['title'] != title:
            at += 1
        if at == len(heads):
            raise Stop('The layout step could not find the section "' + lines[start][2:60] + '" on the pages.')
        counters.append({'footnote': heads[at]['footnote'], 'figures': heads[at]['figures']})
        at += 1
    return recs, counters, bodies


def pictures(root, text):
    """A digest of every picture file a piece of the book names: a picture
    that changes shape moves the text around it."""
    found = {}
    for name in sorted(set(PICTURE.findall(text))):
        path = Path(root) / name.lstrip('/')
        found[name] = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else ''
    return found


def keep_on_page(lines, layout, charts=None, cache=None, jobs=4, log=print, digest=''):
    """The print copy of the assembled `lines`, and a report."""
    began = time.time()
    lines = list(lines)
    charts = charts or {}
    if any(l == PAGE or CUT in l for l in lines):
        raise Stop('The assembled book already holds a layout mark of the notes step.')
    all_notes, _, depth, _ = index(lines)
    starts = sections(lines, depth)
    recs, counters, bodies = read_book(layout, lines, starts)
    if len(all_notes) != len(recs):
        raise Stop(f'{len(all_notes)} notes in the assembled book but {len(recs)} on its pages.')
    ends = starts[1:] + [len(lines)]
    first_note = [sum(k < s for k, _, _ in all_notes) + 1 for s in starts]
    last_note = [sum(k < e for k, _, _ in all_notes) for e in ends]
    before = len(offenders(recs, 1, len(recs), ()))
    stored = cache if cache is not None else {}
    report = {'notes': len(recs), 'before': before, 'moves': 0, 'cuts': 0, 'sections': []}
    keys = {}

    def key_of(n):
        if n not in keys:
            doc, shift = standalone(carried(lines, depth, starts[n]), counters[n], lines[starts[n]:ends[n]], charts)
            keys[n] = (hashlib.sha256(json.dumps(
                [doc, digest, layout.left, layout.width, pictures(layout.root, '\n'.join(doc))]).encode()).hexdigest(),
                doc, shift)
        return keys[n]

    def work(n):
        seg = lines[starts[n]:ends[n]]
        if not offenders(recs, first_note[n], last_note[n], ()):
            return n, seg, 0, [], 'clean'
        if counters[n]['footnote'] != first_note[n] - 1:
            raise Stop('The notes before a section do not match its pages.')
        key, doc, shift = key_of(n)
        if key in stored:
            hit = stored[key]
            if strip_marks(hit['lines']) == seg:
                return n, hit['lines'], hit['moves'], hit['unresolved'], 'kept'
        fixed, moves, unresolved = fix(layout, f'section-{n:02}.typ', doc, first_note[n], last_note[n], first_note[n])
        fixed = fixed[shift:len(fixed) - (len(doc) - shift - len(seg))]
        if strip_marks(fixed) != seg:
            raise Stop('The layout step changed the text of a section; it must only add layout marks.')
        return n, fixed, len(moves), unresolved, 'worked'

    out = list(lines[:starts[0]])
    unresolved, parts = set(), {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as pool:
        for n, seg, moves, left, state in sorted(pool.map(work, range(len(starts)))):
            parts[n] = {'at': len(out), 'moves': moves, 'unresolved': list(left), 'state': state}
            out.extend(seg)
            unresolved.update(left)

    # The whole print copy, laid out: this is the layout that counts. A
    # section's small copy can still differ from the book (by the width of a
    # page number, say). So a cut that does not start a line here is taken out,
    # and whatever is still off its page is worked on in the whole book.
    both = f'selector(footnote).or({CHECKS})'
    budget, whole_moves = WHOLE_BOOK_ROUNDS, 0
    while True:
        wrong = misplaced_cuts(layout, 'cuts.typ', out)
        if wrong:
            log(f'  {len(wrong)} cuts did not fall at the start of a line in the whole book; making them again.')
            out = without_cuts(out, wrong)
        got = layout.query('print.typ', out, both)
        final = records(got)
        rest = offenders(final, 1, len(final), unresolved)
        if not rest or budget <= 0:
            break
        log(f'  {len(rest)} notes are off their page in the whole book; working on those there.')
        out, moves, stuck = fix(layout, 'print.typ', out, 1, len(final), 1, skip=unresolved, limit=budget)
        budget -= len(moves) + len(stuck)
        whole_moves += len(moves)
        unresolved.update(stuck)
    if strip_marks(out) != lines:
        raise Stop('The print copy differs from the assembled book by more than layout marks.')
    if [e.get('body') for e in got if e.get('func') == 'footnote'] != bodies:
        raise Stop('A note in the print copy differs from the assembled book.')
    left = offenders(final, 1, len(final), ())

    # Keep each section as it now stands, whole-book moves included, so the
    # next build of the same text reuses it and needs no whole-book work.
    where, k, i = {}, 0, 0                  # where each assembled line stands in the print copy
    while i < len(out):
        if out[i] == PAGE:
            i += 2
            continue
        where[k] = i
        k, i = k + 1, i + 1
    out_starts = []
    for start in starts:
        at = where[start]
        while at >= 2 and out[at - 2] == PAGE:
            at -= 2                         # a page mark above a section's heading belongs to it
        out_starts.append(at)
    live = set()
    for n in range(len(starts)):
        seg_out = out[out_starts[n]:(out_starts[n + 1] if n + 1 < len(starts) else len(out))]
        off_here = [v['number'] for v in left if first_note[n] <= v['number'] <= last_note[n]]
        cuts, pages = sum(l.count(CUT) for l in seg_out), sum(l == PAGE for l in seg_out)
        report['sections'].append({'title': lines[starts[n]][2:60], 'notes': last_note[n] - first_note[n] + 1,
                                   'moves': cuts + pages, 'unresolved': len(off_here), 'state': parts[n]['state']})
        report['moves'] += cuts + pages
        report['cuts'] += cuts
        if cache is not None and parts[n]['state'] != 'clean':
            if strip_marks(seg_out) != lines[starts[n]:ends[n]]:
                raise Stop('The layout step lost track of a section in the print copy.')
            key = key_of(n)[0]
            live.add(key)
            stored[key] = {'lines': seg_out, 'moves': cuts + pages,
                           'unresolved': [n for n in off_here if n in unresolved]}
    if cache is not None:
        for key in list(cache):
            if key not in live:
                del cache[key]
    report['after'] = len(left)
    report['unresolved'] = [{'note': v['number'], 'page': v['anchor']} for v in left]
    report['whole_book_moves'] = whole_moves
    report['seconds'] = round(time.time() - began)
    report['layouts'] = layout.queries
    return out, report


def marks_of(pdf):
    """How often each quotation mark and a few other marks occur in a PDF's
    text. Letters, digits, hyphens and spaces are left out: page numbers,
    running heads and line breaks change those between two layouts."""
    text = subprocess.run(['pdftotext', str(pdf), '-'], capture_output=True, text=True, check=True).stdout
    found = Counter(text)
    return {mark: found[mark] for mark in GLYPHS}


def same_marks(plain_pdf, print_pdf):
    """Stop unless the print copy's PDF prints the same quotation marks as the
    PDF of the assembled book. Text that moves to another page must not turn a
    closing quote into an opening one, or a word into a list number."""
    before, after = marks_of(plain_pdf), marks_of(print_pdf)
    if before != after:
        changed = ', '.join(f'{mark!r} {before[mark]} to {after[mark]}' for mark in GLYPHS if before[mark] != after[mark])
        raise Stop('The print copy prints different marks from the assembled book: ' + changed
                   + '. A layout mark changed how some text is set; the book was not built.')


def summary(report):
    text = (f'notes: {report["before"]} of {report["notes"]} were not wholly on their mark\'s page; '
            f'{report["moves"]} moves of text ({report["cuts"]} between two lines of a paragraph) '
            f'leave {report["after"]}. {report["layouts"]} layouts, {report["seconds"]} s.')
    if report['unresolved']:
        shown = ', '.join(f'{u["note"]} (PDF page {u["page"]})' for u in report['unresolved'][:12])
        text += '\n  Could not be kept on their page: notes ' + shown + (' …' if len(report['unresolved']) > 12 else '')
    return text


# ---------- the build's way in ----------

def placement(cfg=None):
    """Where a note may fall (book.yaml `notes`).

    flow: the typesetter decides; a note may be cut in two or pushed to the
    next page. same-page: text moves so every note is whole on its mark's page."""
    value = str((cfg if cfg is not None else booklib.load_book_yaml()).get('notes') or 'flow')
    if value not in ('flow', 'same-page'):
        raise SystemExit("book.yaml: notes must be 'flow' or 'same-page', not " + repr(value))
    return value


def chart_numbers():
    """The number of each printed chart, by its label in the book."""
    path = booklib.ROOT / 'build' / 'figures' / 'print-charts.json'
    if not path.is_file():
        return {}
    manifest = json.loads(path.read_text())
    return {f"chart-{chapter_id}-{panel['focus']}": panel['number']
            for chapter_id, chapter in manifest['chapters'].items() for panel in chapter['panels']}


def print_copy(entry, out, work, env, cache_path=None, digest='', jobs=None, log=print):
    """Write the print copy of the assembled book `entry` to `out`: the same
    text with layout marks. `env` sets the book's fonts for the typesetter, and
    `digest` names what else a layout depends on (template, fonts,
    typesetter). A kept result is reused only while those, this script, the
    section's text and its pictures are all unchanged."""
    margins = booklib.MARGINS_IN
    left = {1: margins['inside'] * 72, 0: margins['outside'] * 72}   # odd pages are right-hand pages
    layout = Layout(booklib.ROOT, env, work, left, booklib.page_settings()['text_width_pt'])
    cache = {}
    if cache_path and Path(cache_path).is_file():
        try:
            cache = json.loads(Path(cache_path).read_text())
        except ValueError:
            cache = {}                       # a damaged file only costs the time to work again
    digest = json.dumps([digest, hashlib.sha256(Path(__file__).read_bytes()).hexdigest()])
    lines = Path(entry).read_text(encoding='utf-8').split('\n')
    printed, report = keep_on_page(lines, layout, chart_numbers(), cache,
                                   jobs or min(6, os.cpu_count() or 2), log, digest)
    Path(out).write_text('\n'.join(printed), encoding='utf-8')
    if cache_path:
        Path(cache_path).write_text(json.dumps(cache))
    return report
