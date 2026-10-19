"""Re-anchor the reviewed web-book catalogue after deliberate prose edits.

The build binds every annotated passage to its exact text: its quote and hash,
the character offsets of each name link, and the guards and profile
selections that depend on it. That protects meaning, but it also means a
one-word edit fails the build. After an editorial change to the manuscript,
run the normal site build once with BOOK_REANCHOR=1. Before checking, this
module matches each changed passage to its new text, moves each name link to
the same words, drops links and guards whose words were deliberately removed,
and records the new hashes. It prints every change for review in git.

For authored prose it never invents an association, never adds or removes
passages, and never touches the manuscript itself. Generated text (the
register, its notes and the link inventory) follows the data: new entries get
their profile link, removed ones drop out, and every change is printed.

To add new facts: edit the tree, run flyleaf book, reread the stories and
run flyleaf coverage --mark-all, run flyleaf book and flyleaf repin, then
build the site once with BOOK_REANCHOR=1.

Optional: there is nothing to re-anchor without book-annotations.json in the
family's site folder or book/web-selections.json.
"""
from collections import defaultdict
from difflib import SequenceMatcher
from hashlib import sha256
import json
from pathlib import Path
import re

from website_book_annotations import (NON_PROSE, Passage, character_map, normalized, passages,
                                      require)
import flyleaf_settings

def prose_parts(data):
    """Every other manifest part holds prose, in manifest order."""
    return tuple(dict.fromkeys(part for part, _ in data if part != NON_PROSE))
CONTEXT = 64


def digest(text):
    return sha256(text.encode()).hexdigest()


def relocate(selector, old_quote, new_quote, taken=()):
    """Move a selector to the same words in the revised passage, or None.

    Words already claimed by another link in the passage (taken spans) are
    skipped, so two links never overlap."""
    exact = selector['exact']
    every = [m.start() for m in re.finditer(re.escape(exact), new_quote)]
    positions = [p for p in every
                 if not any(p < end and p + len(exact) > start for start, end in taken)]
    if not positions:
        return swapped_name(selector, old_quote, new_quote, taken)
    # Prefer the occurrence whose neighbouring words survived, then the one
    # nearest the original relative position.
    old_start = selector['start']
    relative = old_start / max(1, len(old_quote))

    def score(start):
        # Count the neighbouring characters that survived on each side.
        before, prefix = new_quote[:start][::-1], selector['prefix'][::-1]
        after, suffix = new_quote[start + len(exact):], selector['suffix']
        kept = (next((i for i, (a, b) in enumerate(zip(before, prefix)) if a != b),
                     min(len(before), len(prefix))) +
                next((i for i, (a, b) in enumerate(zip(after, suffix)) if a != b),
                     min(len(after), len(suffix))))
        return (kept, -abs(start / max(1, len(new_quote)) - relative))

    start = max(positions, key=score)
    end = start + len(exact)
    return {**selector, 'occurrence': every.index(start) + 1, 'start': start,
            'end': end, 'prefix': new_quote[max(0, start - CONTEXT):start],
            'suffix': new_quote[end:end + CONTEXT]}


def installed_passage_order(folder):
    """Passage IDs in reading order from the currently installed web book."""
    order = []
    for path in sorted(Path(folder).glob('*.json')):
        order += re.findall(r'data-book-passage=\\?"([^"\\]+)', path.read_text())
    return list(dict.fromkeys(order))


def unchanged_quote(p, block):
    """Whether a passage's words are unchanged (edition dates are filled in)."""
    field = p.get('generatedEditionDate')
    if not field:
        return p['quote'] == block.quote
    start, end = field['selector']['start'], field['selector']['end']
    pattern = re.escape(p['quote'][:start]) + '.+?' + re.escape(p['quote'][end:])
    return re.fullmatch(pattern, block.quote) is not None


def follow_edition_counts(p, block):
    """Counts in an edition line follow the data (103 -> 105 people).

    Only plain numbers outside the edition date may change; every other
    word must match. Returns the change, or None when it does not apply."""
    field = p.get('generatedEditionDate')
    if not field:
        return None
    start, end = field['selector']['start'], field['selector']['end']
    head, tail = p['quote'][:start], p['quote'][end:]
    numbers = lambda text: re.split(r'(\d+)', text)
    pattern = lambda parts: ''.join('(\\d+)' if i % 2 else re.escape(x)
                                    for i, x in enumerate(parts))
    head_parts, tail_parts = numbers(head), numbers(tail)
    match = re.fullmatch(pattern(head_parts) + '.+?' + pattern(tail_parts), block.quote)
    if not match:
        return None
    found = iter(match.groups())
    fill = lambda parts: ''.join(next(found) if i % 2 else x for i, x in enumerate(parts))
    new_head, new_tail = fill(head_parts), fill(tail_parts)
    if len(new_head) != len(head) and p.get('associations'):
        return None
    quote = new_head + p['quote'][start:end] + new_tail
    shift = len(new_head) - len(head)
    selector = field['selector']
    selector['start'], selector['end'] = start + shift, end + shift
    selector['prefix'] = quote[max(0, selector['start'] - 64):selector['start']]
    selector['suffix'] = quote[selector['end']:selector['end'] + 64]
    before, p['quote'] = p['quote'], quote
    p['sha256'] = sha256(quote.encode()).hexdigest()
    return f"{p['id']}: edition counts “{before}” -> “{quote}”"


def similarity_pairs(before, after):
    """Greedy best pairs by text similarity, for sections whose counts differ."""
    # A paragraph split in two keeps its identity in the part that still opens
    # with its first words, whichever part is longer.
    scored = sorted(((SequenceMatcher(None, p['quote'], b.quote).ratio()
                      + (b.quote[:40] == p['quote'][:40]), i, j)
                     for i, p in enumerate(before) for j, b in enumerate(after)), reverse=True)
    used_old, used_new, pairs = set(), set(), []
    for ratio, i, j in scored:
        if ratio < 0.35 or i in used_old or j in used_new:
            continue
        used_old.add(i)
        used_new.add(j)
        pairs.append((before[i], after[j]))
    return pairs


def swapped_name(selector, old_quote, new_quote, taken=()):
    """Follow a name that an edit replaced word for word (William -> Bill).

    Each linked word must map to one word in the revised passage, either
    unchanged or replaced one-for-one, and the result must still read as a
    short capitalised name. Anything else drops the link."""
    start, end = selector['start'], selector['end']
    if old_quote[start:end] != selector['exact']:
        return None
    word = r"[\w’'-]+"
    old = [(m.start(), m.end()) for m in re.finditer(word, old_quote)]
    new = [(m.start(), m.end()) for m in re.finditer(word, new_quote)]
    linked = [i for i, (a, b) in enumerate(old) if a >= start and b <= end]
    if not linked or old[linked[0]][0] != start or old[linked[-1]][1] != end:
        return None
    mapping = {}
    for tag, i1, i2, j1, j2 in SequenceMatcher(
            None, [old_quote[a:b] for a, b in old], [new_quote[a:b] for a, b in new],
            autojunk=False).get_opcodes():
        if tag == 'equal' or (tag == 'replace' and i2 - i1 == j2 - j1):
            mapping.update((i1 + k, j1 + k) for k in range(i2 - i1))
        elif tag == 'replace':
            # A rewritten stretch: a name at its start or end maps to the
            # word at the same edge ("In 1989 William" -> "At the time, Bill").
            inside = [i for i in linked if i1 <= i < i2]
            if inside and inside[-1] == i2 - 1 and len(inside) <= j2 - j1:
                mapping.update((i, j2 - (i2 - i)) for i in inside)
            elif inside and inside[0] == i1 and len(inside) <= j2 - j1:
                mapping.update((i, j1 + (i - i1)) for i in inside)
    if any(i not in mapping for i in linked):
        return None
    for i in linked:
        before = old_quote[old[i][0]:old[i][1]]
        after = new_quote[new[mapping[i]][0]:new[mapping[i]][1]]
        # A changed word must still be the same name: same initial or a
        # family short form (Margaret -> Madge).
        if before != after and after[:1] != before[:1] and \
                after not in FAMILY_NAMES.get(before, []):
            return None
    s0, e0 = new[mapping[linked[0]]][0], new[mapping[linked[-1]]][1]
    text = new_quote[s0:e0]
    if (e0 <= s0 or len(text) > 60 or
            not re.fullmatch(r"[A-Z][\w’'.-]*(?: [A-Z][\w’'.-]*)*", text) or
            any(s0 < b and e0 > a for a, b in taken)):
        return None
    return {**selector, 'exact': text, 'occurrence': new_quote[:e0].count(text),
            'start': s0, 'end': e0, 'prefix': new_quote[max(0, s0 - CONTEXT):s0],
            'suffix': new_quote[e0:e0 + CONTEXT]}


# Short forms and other spellings of a given name that the family's records use.
FAMILY_NAMES = flyleaf_settings.get('names.short_forms', {})


def same_given(a, b):
    """Two first given names that name the same person: equal, or one is a
    listed form of the other (a spelling corrected by research)."""
    return a == b or b in FAMILY_NAMES.get(a, []) or a in FAMILY_NAMES.get(b, [])


def follow_corrected_names(data, people):
    """Research may correct a published person's name, as when a maiden name
    is found. A link to that person keeps its target when the written form
    still starts with the same first given name (or its family short form);
    the stored name follows, and a note about the old name is dropped."""
    changes = []
    first = lambda name: (name.split('/')[0].split() or [''])[0]

    def walk(value):
        if isinstance(value, dict):
            refn, was = value.get('refn'), value.get('targetName')
            if (value.get('kind') == 'person' and isinstance(was, str) and
                    isinstance(value.get('selector'), dict) and people.get(refn, was) != was):
                now = people[refn]
                said = (value['selector'].get('exact') or '').split()[:1]
                if (now and same_given(first(now), first(was)) and
                        said and said[0] in [first(now), *FAMILY_NAMES.get(first(now), [])]):
                    value['targetName'] = now
                    changes.append(f"{value.get('id')}: {refn} name {was!r} -> {now!r}")
                    if 'name' in (value.get('qualification') or '').lower():
                        changes.append(f"{value.get('id')}: dropped note {value.pop('qualification')!r}")
            for v in value.values():
                walk(v)
        elif isinstance(value, list):
            for v in value:
                walk(v)
    for value in data.values():
        walk(value)
    return changes


def person_mention(association, people, old_quote, new_quote, taken=()):
    """Another written form of the same person's name in the revised passage."""
    name = people.get(association.get('refn'), association.get('targetName', ''))
    given = name.split('/')[0].split()
    surname = name.split('/')[1].strip() if name.count('/') >= 2 else ''
    if not given:
        return None
    forms = [' '.join(given + [surname]).strip(), f'{given[0]} {surname}'.strip()]
    for first in [given[0], *FAMILY_NAMES.get(given[0], [])]:
        forms += [f'{first} {surname}'.strip(), first]
    relative = association['selector']['start'] / max(1, len(old_quote))
    for form in dict.fromkeys(f for f in forms if f):
        hits = [m.start() for m in re.finditer(r'(?<![\w’])' + re.escape(form) + r'(?![\w’])', new_quote)
                if not any(m.start() < e and m.start() + len(form) > b for b, e in taken)]
        if hits:
            start = min(hits, key=lambda h: abs(h / max(1, len(new_quote)) - relative))
            end = start + len(form)
            return {**association['selector'], 'exact': form,
                    'occurrence': new_quote[:end].count(form), 'start': start, 'end': end,
                    'prefix': new_quote[max(0, start - CONTEXT):start],
                    'suffix': new_quote[end:end + CONTEXT]}
    return None


def note_texts(body):
    return {n.attrs['id']: normalized(n.text()) for n in body.nodes() if 'id' in n.attrs}


def mention_ids(data):
    """Every mention id in the catalogue; ids are unique across all parts."""
    used = set()

    def collect(value):
        if isinstance(value, dict):
            if isinstance(value.get('id'), str):
                used.add(value['id'])
            for child in value.values():
                collect(child)
        elif isinstance(value, list):
            for child in value:
                collect(child)

    collect(list(data.values()))
    return used


def link_cited_names(p, block, people, anchors, data, used):
    """Link a full name in a revised or new paragraph to the person that the
    paragraph's own footnotes cite. Two cited people with one name stay unlinked."""
    cited = []
    for nid in linked_notes(block):
        note = anchors.get(nid)
        for n in (note.nodes() if note is not None else ()):
            refn = n.attrs.get('data-book-person')
            if refn in people and refn not in cited:
                cited.append(refn)
    names = defaultdict(list)
    for refn in cited:
        names[' '.join(people[refn].replace('/', ' ').split())].append(refn)
    have = {a.get('refn') for a in p['associations']}
    # A name withheld only because nobody matched it then may be linked now
    # that the person is published and cited here. Other decisions stand.
    later = {'missing-person-target', 'target-not-published'}
    withheld = {w.get('exact') for w in p.get('withheld', [])
                if isinstance(w, dict) and w.get('status') not in later}
    taken = [(a['selector']['start'], a['selector']['end']) for a in p['associations']]
    taken += [(c['selector']['start'], c['selector']['end']) for part in prose_parts(data)
              for c in data[part, 'contexts'].get('mentions', []) if c.get('passageId') == p['id']]
    mapping = character_map(block)
    quote, changes = p['quote'], []
    for plain, refns in names.items():
        if len(refns) != 1 or refns[0] in have or ' ' not in plain or plain in withheld:
            continue
        m = re.search(r'(?<![\w’])' + re.escape(plain) + r'(?![\w’])', quote)
        if (not m or any(m.start() < b and m.end() > a for a, b in taken)
                or any(item[4] for item in mapping[m.start():m.end()])):
            continue
        start, end = m.start(), m.end()
        n = 1
        while f"{p['id']}-A{n:02}" in used:
            n += 1
        label = f"{p['id']}-A{n:02}"
        used.add(label)
        taken.append((start, end))
        p['associations'].append({
            'kind': 'person', 'refn': refns[0], 'id': label, 'targetName': people[refns[0]],
            'reason': 'Named in full in this paragraph, whose own footnotes cite this person.',
            'selector': {'exact': plain, 'occurrence': quote[:end].count(plain), 'start': start,
                         'end': end, 'prefix': quote[max(0, start - CONTEXT):start],
                         'suffix': quote[end:end + CONTEXT]}})
        p['withheld'] = [w for w in p.get('withheld', []) if not (
            isinstance(w, dict) and w.get('exact') == plain and w.get('status') in later)]
        changes.append(f"{p['id']}: links “{plain}”")
    p['associations'].sort(key=lambda a: a['selector']['start'])
    return changes


def linked_notes(block):
    return [n.attrs.get('href', '')[1:] for _, child in block.children
            if not isinstance(child, str) for n in child.nodes()
            if n.attrs.get('role') == 'doc-noteref']


def reanchor(body, manifest_path, previous_order=(), installed=None, people=None):
    """Rewrite catalogue files to match the revised body. Returns change lines."""
    manifest_path = Path(manifest_path)
    if not manifest_path.is_file():
        return []  # the family has no reader annotations to follow
    manifest = json.loads(manifest_path.read_text())
    root = manifest_path.parent
    found = passages(body)
    exact = defaultdict(list)
    for p in found:
        exact[p.chapter, p.section, p.quote].append(p)
    files, data = {}, {}
    for row in manifest['parts']:
        for key, source in row['sources'].items():
            path = root / source['path']
            files[row['id'], key] = path
            data[row['id'], key] = json.loads(path.read_text())
    changes = follow_corrected_names(data, people or {})
    if installed is not None:
        changes += rebase_generated(body, data, set(manifest['scope']['authoredChapters']),
                                    installed, people or {})
    proposals = [(part, p) for part in prose_parts(data)
                 for p in data[part, 'associations']['passages']]
    authored = set(manifest['scope']['authoredChapters'])
    rank = {pid: i for i, pid in enumerate(previous_order)}
    olds, news = defaultdict(list), defaultdict(list)
    for part, p in proposals:
        olds[p['chapter'], p['section']].append(p)
    for block in found:
        if block.chapter in authored:
            news[block.chapter, block.section].append(block)
    moved, unmatched, leftover, every_block = {}, [], [], {}
    for key in sorted(set(olds) | set(news)):
        before = sorted(olds[key], key=lambda p: rank.get(p['id'], len(rank)))
        after = news[key]
        if len(before) == len(after) and (rank or len(before) == 1):
            # Paragraphs are never added or removed, so pair them in reading order.
            pairs = list(zip(before, after))
        else:
            pairs = similarity_pairs(before, after)
            paired_old = {id(p) for p, _ in pairs}
            paired_new = {id(b) for _, b in pairs}
            unmatched += [p['id'] for p in before if id(p) not in paired_old]
            leftover += [(key, b) for b in after if id(b) not in paired_new]
        for p, block in pairs:
            every_block[p['id']] = block
            if unchanged_quote(p, block):
                continue
            counted = follow_edition_counts(p, block)
            if counted:
                changes.append(counted)
                continue
            require(not p.get('generatedEditionDate'),
                    'An edition-date passage changed beyond its date; update it by hand')
            moved[p['id']] = (p['quote'], block)
    # A paragraph moved to another section of its chapter keeps its entry and
    # links; its words must still be recognisably the same.
    by_id = {p['id']: p for _, p in proposals}
    for pid in list(unmatched):
        p = by_id[pid]
        options = [(SequenceMatcher(None, p['quote'], b.quote).ratio()
                    + (b.quote[:40] == p['quote'][:40]), n)
                   for n, (key, b) in enumerate(leftover) if key[0] == p['chapter']]
        if not options or max(options)[0] < 0.6:
            continue
        _, n = max(options)
        _, block = leftover.pop(n)
        changes.append(f"{pid}: moved from section {p['section']} to {block.section}")
        p['section'] = block.section
        unmatched.remove(pid)
        every_block[pid] = block
        if not unchanged_quote(p, block):
            moved[pid] = (p['quote'], block)
    require(not unmatched, 'Could not match revised passages (added, removed or rewritten '
            'beyond recognition): ' + ', '.join(unmatched))
    # A new paragraph joins its section's part of the catalogue. Its names are
    # linked below only where its own footnotes cite that person.
    part_of = {p['id']: part for part, p in proposals}
    taken_ids = {p['id'] for _, p in proposals}
    fresh = {}
    for key, block in leftover:
        neighbours = olds[key] or [p for _, p in proposals if p['chapter'] == key[0]]
        require(neighbours, f'New prose block has no catalogued chapter: {block.quote[:60]}')
        base, n = neighbours[-1]['id'], 1
        while f'{base}-N{n}' in taken_ids:
            n += 1
        ident = f'{base}-N{n}'
        taken_ids.add(ident)
        entry = {'id': ident, 'chapter': block.chapter, 'section': block.section,
                 'quote': block.quote, 'sha256': digest(block.quote), 'associations': [],
                 'withheld': [], 'existingLinks': [], 'reviewNote': 'New paragraph added with research.'}
        data[part_of[neighbours[-1]['id']], 'associations']['passages'].append(entry)
        fresh[ident] = (entry, block)
        every_block[ident] = block
        changes.append(f'{ident}: new paragraph “{block.quote[:60]}”')

    notes = note_texts(body)
    anchors = {n.attrs['id']: n for n in body.nodes() if 'id' in n.attrs}
    hashes = {}
    for part in prose_parts(data):
        for p in data[part, 'associations']['passages']:
            if p['id'] not in moved:
                continue
            old_quote, block = moved[p['id']]
            p['quote'], p['sha256'] = block.quote, digest(block.quote)
            hashes[p['id']] = p['sha256']
            changes.append(f"{p['id']}: passage text revised")
            kept, taken, lost = [], [], []
            for a in p['associations']:
                selector = relocate(a['selector'], old_quote, block.quote, taken)
                if selector:
                    a['selector'] = selector
                    taken.append((selector['start'], selector['end']))
                    kept.append(a)
                else:
                    lost.append(a)
            for a in lost:
                # A person renamed in the edit (William -> Bill) keeps a link to
                # another form of their name in the same passage.
                selector = (person_mention(a, people or {}, old_quote, block.quote, taken)
                            if a.get('kind') == 'person' else None)
                if selector:
                    a['selector'] = selector
                    taken.append((selector['start'], selector['end']))
                    kept.append(a)
                    changes.append(f"{p['id']}: link {a['id']} now on “{selector['exact']}”")
                else:
                    changes.append(f"{p['id']}: dropped link {a['id']} ({a['selector']['exact']})")
            p['associations'] = sorted(kept, key=lambda a: a['selector']['start'])
            for w in p.get('withheld', []):
                if isinstance(w, dict) and isinstance(w.get('selector'), dict):
                    w['selector'] = relocate(w['selector'], old_quote, block.quote) or w['selector']
            p['existingLinks'] = [link for link in p.get('existingLinks', [])
                                  if link.get('role') != 'doc-noteref' or
                                  link.get('href', '')[1:] in linked_notes(block)]
    by_id = {p['id']: p for part in prose_parts(data) for p in data[part, 'associations']['passages']}
    revised = [(by_id[pid], block) for pid, (_, block) in moved.items()] + list(fresh.values())
    used = mention_ids(data)
    for p, block in revised:
        changes += link_cited_names(p, block, people or {}, anchors, data, used)
    blocks = {pid: block for pid, (_, block) in moved.items()}
    quotes = {p['id']: p['quote'] for part in prose_parts(data)
              for p in data[part, 'associations']['passages']}
    spans = {}
    for part in prose_parts(data):
        guards = data[part, 'guards']['guards']
        kept = []
        for g in guards:
            pid = g['passageId']
            if pid in hashes:
                g['passageSha256'] = hashes[pid]
            if g.get('witnessPassageId') in hashes:
                g['witnessPassageSha256'] = hashes[g['witnessPassageId']]
            keep = True
            if g['kind'] == 'same-passage' and pid in hashes:
                keep = g['exact'] in quotes[pid]
            elif g['kind'] == 'other-bound-passage' and g.get('witnessPassageId') in hashes:
                keep = g['exact'] in quotes[g['witnessPassageId']]
            elif g['kind'] == 'linked-native-note' and pid in every_block:
                # Renumbered notes: confirm against the notes this passage cites.
                linked = linked_notes(every_block[pid])
                if g['noteAnchor'] not in linked or g['exact'] not in notes.get(g['noteAnchor'], ''):
                    match = [a for a in linked if g['exact'] in notes.get(a, '')]
                    if match:
                        changes.append(f"{pid}: guard note {g['noteAnchor']} -> {match[0]}")
                        g['noteAnchor'] = match[0]
                    else:
                        # The same citation reworded (a later citation of a
                        # source uses its short title): follow the closest note.
                        plain = {a: normalized(anchors[a].text({'doc-noteref', 'doc-backlink'}))
                                 for a in linked if a in anchors}
                        best = max(plain, key=lambda a: SequenceMatcher(
                            None, plain[a], g['exact']).ratio(), default=None)
                        if best and SequenceMatcher(None, plain[best], g['exact']).ratio() >= 0.6:
                            changes.append(f"{pid}: guard follows reworded note {best}")
                            g['noteAnchor'], g['exact'] = best, plain[best]
                        else:
                            keep = False
            if keep:
                kept.append(g)
            else:
                changes.append(f"{pid}: dropped guard “{g['exact'][:70]}”")
        data[part, 'guards']['guards'] = kept
        contexts = data[part, 'contexts']
        kept = []
        for c in contexts.get('mentions', []):
            pid = c['passageId']
            if pid in moved:
                old_quote, block = moved[pid]
                taken = spans.setdefault(pid, [
                    (a['selector']['start'], a['selector']['end'])
                    for part2 in prose_parts(data) for q in data[part2, 'associations']['passages']
                    if q['id'] == pid for a in q['associations']])
                selector = relocate(c['selector'], old_quote, block.quote, taken)
                if selector:
                    taken.append((selector['start'], selector['end']))
                if not selector:
                    changes.append(f"{pid}: dropped locality {c['id']} ({c['selector']['exact']})")
                    continue
                c.update(quote=block.quote, passageSha256=digest(block.quote), selector=selector)
            kept.append(c)
        if 'mentions' in contexts:
            contexts['mentions'] = kept
    changes += reanchor_nonprose(body, manifest, root, files, data,
                                 {pid: block.quote for pid, (_, block) in moved.items()}, people)
    for (part, key), path in files.items():
        text = json.dumps(data[part, key], ensure_ascii=False, indent=2) + '\n'
        if text != path.read_text():
            path.write_text(text)
            row = next(r for r in manifest['parts'] if r['id'] == part)
            row['sources'][key]['sha256'] = sha256(path.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    return changes


def refresh_selections(selections_path, introductions_for, presentation_for):
    """Re-pin profile and citation selections to the checked new content."""
    path = Path(selections_path)
    selections = json.loads(path.read_text())
    changes = []
    for entry in selections.get('profileIntroductions', []):
        for expected in entry['blocks']:
            try:
                actual = introductions_for(expected['passage'])
            except ValueError as error:
                raise ValueError(f"profile {entry['person']}, {expected['passage']}: {error}") from None
            if actual != expected:
                changes.append(f"profile {entry['person']}: {expected['passage']} re-pinned")
                expected.update(actual)
    for entry in selections.get('citationPresentation', []):
        actual = presentation_for(entry['person'], entry['key'])
        if actual != entry['contextSha256']:
            changes.append(f"citation {entry['person']}/{entry['key']} re-pinned")
            entry['contextSha256'] = actual
    if changes:
        path.write_text(json.dumps(selections, ensure_ascii=False, indent=2) + '\n')
    return changes


def refresh_section_people(selections_path, root):
    """Re-pin section people to the current, deliberately edited manuscripts."""
    path = Path(selections_path)
    selections = json.loads(path.read_text())
    changes = []
    for entry in selections.get('sectionPeople', []):
        actual = sha256((Path(root) / entry['manuscript']).read_bytes()).hexdigest()
        if actual != entry['sha256']:
            changes.append(f"section people {entry['anchor']}: {entry['manuscript']} re-pinned")
            entry['sha256'] = actual
    if changes:
        path.write_text(json.dumps(selections, ensure_ascii=False, indent=2) + '\n')
    return changes


def caption_links(caption):
    """The same caption-link witness the non-prose check computes."""
    from website_book_nonprose import visible
    mapping = character_map(Passage(caption, list(enumerate(caption.children)), '', '', visible(caption)))
    result = []
    for link in caption.nodes():
        if link.tag != 'a' or link.attrs.get('role') == 'doc-noteref':
            continue
        positions = [j for j, point in enumerate(mapping) if any(n is link for n in point[4])]
        result.append({'text': visible(link), 'href': link.attrs.get('href', ''),
                       'role': link.attrs.get('role'),
                       'start': min(positions) if positions else None,
                       'end': max(positions) + 1 if positions else None})
    return result


def reanchor_nonprose(body, manifest, root, files, data, revised, people=None):
    """Follow revised captions and prose passages in the non-prose catalogue."""
    from website_book_nonprose import index_blocks
    changes = []
    part = NON_PROSE
    if (part, 'associations') not in data:
        return changes
    associations, guards = data[part, 'associations'], data[part, 'guards']
    preserved = data[part, 'preserved']
    indexed = index_blocks(body, set(manifest['scope']['authoredChapters']))
    figures = [n for n in body.nodes() if n.tag == 'figure']
    edited = {}
    for row in associations['authoredHeadingsAndCaptions']:
        if row['kind'] not in {'figure-caption', 'chart-caption'} or row['id'] not in indexed:
            continue
        current, _ = indexed[row['id']]
        if current['quote'] == row['quote']:
            continue
        old_quote = row['quote']
        row['quote'], row['sha256'] = current['quote'], current['sha256']
        edited[row['id']] = row['quote']
        changes.append(f"{row['id']}: caption revised")
        kept, taken = [], []
        for a in row['associations']:
            selector = (relocate(a['selector'], old_quote, row['quote'], taken) or
                        (person_mention(a, people or {}, old_quote, row['quote'], taken)
                         if a.get('kind') == 'person' else None))
            if selector:
                a['selector'] = selector
                taken.append((selector['start'], selector['end']))
                kept.append(a)
            else:
                changes.append(f"{row['id']}: dropped caption link {a['id']} ({a['selector']['exact']})")
        row['associations'] = kept
    contexts = data[part, 'contexts']
    kept = []
    for context in contexts.get('mentions', []):
        pid = context.get('passageId') or context.get('blockId')
        if pid in edited:
            old_quote = context['quote']
            selector = relocate(context['selector'], old_quote, edited[pid])
            if not selector:
                changes.append(f"{pid}: dropped caption locality {context['id']}")
                continue
            context.update(quote=edited[pid], passageSha256=sha256(edited[pid].encode()).hexdigest(),
                           selector=selector)
        kept.append(context)
    if 'mentions' in contexts:
        contexts['mentions'] = kept
    for guard in guards['captionGuards']:
        if guard['blockId'] in edited:
            guard['quote'] = edited[guard['blockId']]
            guard['sha256'] = sha256(guard['quote'].encode()).hexdigest()
    # Figure controls follow revised captions, and image labels follow
    # renumbered footnotes (the label repeats the caption's note number).
    relabelled = 0
    for i, (figure, witness) in enumerate(zip(figures, preserved['figures']), 1):
        caption = next(n for n in figure.nodes() if n.tag == 'figcaption')
        links_now = caption_links(caption)
        images_now = [n.attrs for n in figure.nodes()
                      if n.tag == 'a' and 'data-book-image' in n.attrs]
        if figure.attrs.get('class') == 'native-book-chart':
            # Family charts are drawn from the data; a new relative redraws
            # the chart under a new file name. All of its controls follow.
            assets = [n.attrs.get('data-book-original') for n in figure.nodes() if n.tag == 'img']
            if (assets, images_now, links_now) != (witness['assetPaths'], witness['imageLinks'],
                                                   witness['captionLinks']):
                witness.update(assetPaths=assets, imageLinks=images_now, captionLinks=links_now)
                for row in [*associations['authoredHeadingsAndCaptions'], *guards['captionGuards']]:
                    if witness['id'] in (row.get('id'), row.get('blockId')) and 'assetPaths' in row:
                        row['assetPaths'] = assets
                changes.append(f"{witness['id']}: family chart redrawn")
        elif witness['id'] in edited:
            witness['captionLinks'], witness['imageLinks'] = links_now, images_now
        elif images_now != witness['imageLinks'] and [
                {k: v for k, v in a.items() if k != 'aria-label'} for a in images_now] == [
                {k: v for k, v in a.items() if k != 'aria-label'} for a in witness['imageLinks']]:
            witness['imageLinks'] = images_now
            relabelled += 1
    if relabelled:
        changes.append(f'{relabelled} figure image labels follow renumbered notes')
    # Any stored witness of a footnote's words follows the revised note.
    anchors = {n.attrs['id']: n for n in body.nodes() if 'id' in n.attrs}

    def follow_notes(value):
        if isinstance(value, dict):
            nid = value.get('id')
            if (isinstance(nid, str) and nid.startswith('loc-') and 'quote' in value
                    and 'sha256' in value and nid in anchors):
                quote = normalized(anchors[nid].text({'doc-noteref', 'doc-backlink'}))
                if quote != value['quote']:
                    value['quote'] = quote
                    value['sha256'] = sha256(quote.encode()).hexdigest()
                    changes.append(f'{nid}: footnote witness revised')
            for child in value.values():
                follow_notes(child)
        elif isinstance(value, list):
            for child in value:
                follow_notes(child)

    follow_notes(guards)
    follow_notes(associations)
    # Moving a citation marker within its sentence changes the order of links
    # in the book, never the links themselves. Accept a new order only when
    # the complete set of links is unchanged; anything else still fails.
    from collections import Counter
    from website_book_nonprose import links
    current = links(body)
    corrections = data[part, 'corrections']['links']
    expected = [dict(row) for row in preserved['links']]
    for correction in corrections:
        found = [i for i, row in enumerate(expected) if row == correction['before']]
        if len(found) == 1:
            expected[found[0]] = correction['after']
    key = lambda row: tuple(sorted(row.items()))
    if current != expected:
        if Counter(map(key, current)) == Counter(map(key, expected)):
            reordered = [dict(row) for row in current]
            for correction in corrections:
                found = [i for i, row in enumerate(reordered) if row == correction['after']]
                if len(found) == 1:
                    reordered[found[0]] = correction['before']
            preserved['links'] = reordered
            changes.append('link inventory: same links in a revised order')
        else:
            # New facts add source links and renumber notes. Record the new
            # inventory and print what changed, for review in git.
            lost = Counter(map(key, expected)) - Counter(map(key, current))
            gained = Counter(map(key, current)) - Counter(map(key, expected))
            preserved['links'] = [dict(row) for row in current]
            for correction in corrections:
                found = [i for i, row in enumerate(preserved['links']) if row == correction['after']]
                if len(found) == 1:
                    preserved['links'][found[0]] = correction['before']
            changes.append(f'link inventory: {sum(gained.values())} gained, {sum(lost.values())} lost')
            changes += [f'  link gained: {dict(row)}' for row in list(gained)[:5]
                        if not dict(row)['href'].startswith('#loc-')]
            changes += [f'  link lost: {dict(row)}' for row in list(lost)[:5]
                        if not dict(row)['href'].startswith('#loc-')]
    for guard in guards['crossPassageGuards']:
        if guard['passageId'] in revised:
            guard['quote'] = revised[guard['passageId']]
            guard['sha256'] = sha256(guard['quote'].encode()).hexdigest()
            changes.append(f"{guard['blockId']}: cross-passage guard follows {guard['passageId']}")
    changes += follow_ancestor_dates(body, preserved)
    return changes


def follow_ancestor_dates(body, preserved):
    """The ancestor table follows the register as research adds ancestors.

    The table is drawn from the data. A known row keeps its number, person and
    register link; its born and died cells may change, and so may its name when
    research corrects it (a maiden name found, a middle name added) while the
    link and first given name stay the same. A blank row may
    become a newly found ancestor, and that ancestor's parents then appear as
    new blank rows. A known row that changes person, or disappears, is left
    for the later check to refuse."""
    from website_book_nonprose import links, visible
    known = {r['number']: r for r in preserved['ahnentafelKnownRows']}
    unknown = set(preserved['ahnentafelUnknownNumbers'])
    tables = [n for n in body.nodes() if n.tag == 'table']
    if not tables or not known:
        return []
    cells = lambda row: [visible(n) for n in row.children
                         if not isinstance(n, str) and n.tag in {'th', 'td'}]
    # The book may split the table into parts; header rows are skipped.
    rows = {c[0]: (c, row) for table in tables for row in [n for n in table.nodes() if n.tag == 'tr']
            if len(c := cells(row)) == 4 and c[0].isdigit()}
    if not set(known) <= set(rows):
        return []
    policy = next(iter(known.values())).get('policy', '')
    changes, found, blank = [], [], []
    # A new ancestor fills a blank row, or is the parent of a row already known
    # (two generations found at once). Children come first in number order.
    present = set(known)
    for number, (now, row) in sorted(rows.items(), key=lambda item: int(item[0])):
        link = links(row)
        witness = known.get(number)
        if witness:
            was = witness['quote']
            first = lambda text: (text.split() or [''])[0]
            same_person = (now[0] == was[0] and same_given(first(now[1]), first(was[1])) and
                           link == [{'href': witness['href'], 'text': now[1], 'role': None, 'image': False}])
            if same_person and now != was:
                if now[1] != was[1]:
                    changes.append(f"ancestor {number} ({witness['refn']}): name {was[1]!r} -> {now[1]!r}")
                if now[2:] != was[2:]:
                    changes.append(f"ancestor {number} ({witness['refn']}): dates {was[2:]} -> {now[2:]}")
                witness['quote'] = now
        elif (len(link) == 1 and link[0]['href'].startswith('#reg-') and
              link[0]['text'] == now[1] and
              (number in unknown or str(int(number) // 2) in present)):
            found.append({'number': number, 'refn': link[0]['href'].removeprefix('#reg-'),
                          'href': link[0]['href'], 'quote': now, 'policy': policy})
            present.add(number)
        elif now == [number, '_____ _____', '', ''] and not link:
            blank.append(number)
    if found or set(blank) != unknown - {r['number'] for r in found}:
        for row in found:
            changes.append(f"ancestor {row['number']} ({row['refn']}): newly found")
        added = sorted(set(blank) - unknown, key=int)
        if added:
            changes.append(f"ancestor table: new blank rows {', '.join(added)}")
        preserved['ahnentafelKnownRows'] = sorted([*known.values(), *found],
                                                  key=lambda r: int(r['number']))
        preserved['ahnentafelUnknownNumbers'] = sorted(blank, key=int)
    return changes


# --- Generated text: the register, its notes and the link inventory -------
#
# The register is generated from the GEDCOM, so a new fact adds a sentence, a
# footnote, perhaps a whole entry. The catalogue numbers register blocks,
# headings, figures and footnotes by position, so one insertion shifts every
# later number. rebase_generated() matches the previous edition's blocks and
# notes to the new ones by content, renumbers every reference, and moves
# each pinned quote onto the new text.

NP_ID = re.compile(r'NP-[HFRC]\d{3,}')
LOC_ID = re.compile(r'(#?)((?:loc|book-note)-\d+)')
PERSON_ROLE = 'named-in-context'


def previous_notes(folder):
    """Footnote ids and texts, in order, from the installed web book."""
    from html.parser import HTMLParser
    from website_native_book import VOID

    class Notes(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.stack, self.notes = [], []

        def handle_starttag(self, tag, attrs):
            attrs = dict(attrs)
            if tag in VOID:
                return
            skip = attrs.get('role') in {'doc-noteref', 'doc-backlink'}
            ident = attrs.get('id') or ''
            # Note markers in the text share the loc- numbering; only the
            # notes themselves are compared.
            note = LOC_ID.fullmatch(ident) and not skip
            if note:
                self.notes.append([ident, []])
            self.stack.append((tag, skip, ident if note else None))

        def handle_endtag(self, tag):
            if tag in VOID:
                return
            while self.stack:
                if self.stack.pop()[0] == tag:
                    break

        def handle_data(self, data):
            if any(skip for _, skip, _ in self.stack):
                return
            for _, _, ident in self.stack:
                if ident:
                    self.notes[[n[0] for n in self.notes].index(ident)][1].append(data)

    order = []
    for path in sorted(Path(folder).glob('*.json')):
        parser = Notes()
        parser.feed(json.loads(path.read_text())['html'])
        order += [(ident, normalized(''.join(parts))) for ident, parts in parser.notes]
    return order


def current_notes(body):
    return [(n.attrs['id'], normalized(n.text({'doc-noteref', 'doc-backlink'})))
            for n in body.nodes() if LOC_ID.fullmatch(n.attrs.get('id', ''))
            and n.attrs.get('role') not in {'doc-noteref', 'doc-backlink'}]


def align(old, new, key, group=lambda row: None, similar=0.5):
    """Pair old and new rows (lists of (id, row)) by content.

    Unchanged rows pair in sequence; a changed row pairs with a new row of the
    same group whose text is similar; a moved row pairs by identical key."""
    matcher = SequenceMatcher(None, [key(r) for _, r in old], [key(r) for _, r in new],
                              autojunk=False)
    pairs, lost, gained = {}, [], []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == 'equal':
            pairs.update((old[i1 + k][0], new[j1 + k][0]) for k in range(i2 - i1))
            continue
        candidates = list(range(j1, j2))
        for oid, orow in old[i1:i2]:
            scored = [(SequenceMatcher(None, orow['quote'], new[j][1]['quote']).ratio(), -j, j)
                      for j in candidates if group(orow) == group(new[j][1])]
            best = max(scored, default=None)
            if best and best[0] >= similar:
                pairs[oid] = new[best[2]][0]
                candidates.remove(best[2])
            else:
                lost.append(oid)
        gained += [new[j][0] for j in candidates]
    # A moved block shows as a deletion and an insertion with the same words.
    by_key = defaultdict(list)
    rows = dict(new)
    for nid in gained:
        by_key[key(rows[nid])].append(nid)
    old_rows = dict(old)
    for oid in list(lost):
        match = by_key.get(key(old_rows[oid]))
        if match:
            pairs[oid] = match.pop(0)
            lost.remove(oid)
            gained.remove(pairs[oid])
    # A moved block whose words also changed (a renumbered chapter heading)
    # still pairs when its anchor is unique on both sides.
    for oid in list(lost):
        anchor = group(old_rows[oid])
        if anchor is None:
            continue
        olds = [o for o in lost if group(old_rows[o]) == anchor]
        news = [n for n in gained if group(rows[n]) == anchor]
        if len(olds) == 1 and len(news) == 1:
            pairs[oid] = news[0]
            lost.remove(oid)
            gained.remove(news[0])
    return pairs, lost, gained



def check_installed_matches(data, installed_notes):
    """The installed web book must be the one the catalogue was built from.

    Footnotes are renumbered by comparing the installed book with the new one.
    If the catalogue was reset to the committed copy while the installed book
    came from a later trial build, nearly every stored note differs; stop then
    instead of renumbering against the wrong book."""
    def witnesses(value):
        if isinstance(value, dict):
            if (isinstance(value.get('id'), str) and LOC_ID.fullmatch(value['id'])
                    and isinstance(value.get('quote'), str)):
                yield value
            for child in value.values():
                yield from witnesses(child)
        elif isinstance(value, list):
            for child in value:
                yield from witnesses(child)

    texts = dict(installed_notes)
    stored = [w for w in witnesses(list(data.values())) if w['id'] in texts]
    stale = [w['id'] for w in stored if normalized(w['quote']) != texts[w['id']]]
    require(len(stale) * 2 <= len(stored),
            f'The installed web book does not match the catalogue: {len(stale)} of '
            f'{len(stored)} stored notes differ (first {stale[:1]}). Put back the web book '
            'built from the committed catalogue (website/public/data/native-book, as '
            'deployed) before re-anchoring.')

def note_pairs(old, new):
    pairs, _, _ = align([(i, {'quote': t}) for i, t in old], [(i, {'quote': t}) for i, t in new],
                        key=lambda row: row['quote'], similar=0.6)
    return pairs


def remap(value, np_map, loc_map):
    """Replace every block and note id in value, all at once."""
    if isinstance(value, dict):
        return {k: remap(v, np_map, loc_map) for k, v in value.items()}
    if isinstance(value, list):
        return [remap(v, np_map, loc_map) for v in value]
    if isinstance(value, str):
        if NP_ID.fullmatch(value):
            return np_map.get(value, value)
        match = LOC_ID.fullmatch(value)
        if match and match.group(2) in loc_map:
            return match.group(1) + loc_map[match.group(2)]
    return value


def note_witness(note, witness):
    """The stored witness of a footnote, recomputed from the current note."""
    from website_book_nonprose import links
    quote = normalized(note.text({'doc-noteref', 'doc-backlink'}))
    fresh = {**witness, 'quote': quote, 'sha256': digest(quote)}
    if 'markers' in witness:
        fresh['markers'] = [{'person': n.attrs['data-book-person'], 'key': n.attrs.get('data-book-key')}
                            for n in note.nodes() if 'data-book-person' in n.attrs]
    if 'existingLinks' in witness:
        fresh['existingLinks'] = [{k: link[k] for k in ('text', 'href', 'role')}
                                  for link in links(note)]
    return fresh


def person_selector(quote, name):
    """The printed name in a register heading or collateral entry."""
    plain = ' '.join(name.replace('/', ' ').split())
    start = quote.find(plain)
    if start < 0:
        match = re.match(r'^[0-9ivxlcdm]+\.\s+([^,.(]+)', quote)
        if not match:
            return None
        start, plain = match.start(1), match.group(1).strip()
    end = start + len(plain)
    return {'exact': plain, 'occurrence': quote[:end].count(plain), 'start': start, 'end': end,
            'prefix': quote[max(0, start - CONTEXT):start], 'suffix': quote[end:end + CONTEXT]}


def catalogue_new_charts(body, indexed, gained, data, people):
    """A newly found generation adds a family chart, and research may add a
    captioned photograph. Catalogue each like the rest.

    The caption's first sentence names the couple ("Chart 17: A and B."); each
    name must match exactly one published person. The chart's image and caption
    controls are then filled in by the chart-redraw step."""
    from website_book_nonprose import links
    part = NON_PROSE
    associations, guards = data[part, 'associations'], data[part, 'guards']
    preserved = data[part, 'preserved']
    rows = associations['authoredHeadingsAndCaptions']
    have = {r['id'] for r in rows}
    # Mention ids are unique across every catalogue part, not only captions.
    used = set()

    def collect(value):
        if isinstance(value, dict):
            if isinstance(value.get('id'), str):
                used.add(value['id'])
            for child in value.values():
                collect(child)
        elif isinstance(value, list):
            for child in value:
                collect(child)

    collect(list(data.values()))
    by_name = defaultdict(list)
    for refn, name in people.items():
        by_name[' '.join(name.replace('/', ' ').split())].append((refn, name))
    numbered = {}
    for table in [n for n in body.nodes() if n.tag == 'table']:
        for tr in [n for n in table.nodes() if n.tag == 'tr']:
            cells = [c for c in tr.children if not isinstance(c, str) and c.tag in {'td', 'th'}]
            refs = [a.attrs.get('href', '') for a in tr.nodes() if a.tag == 'a']
            if cells and len(refs) == 1 and refs[0].startswith('#reg-'):
                numbered[cells[0].text().strip()] = refs[0].removeprefix('#reg-')
    changes = []
    figures = [n for n in body.nodes() if n.tag == 'figure']

    def named_in_full(ident, quote, fields):
        """Links for the published people a new heading or caption names in
        full; nobody is matched from a first name alone or from a face."""
        hits = sorted((quote.find(plain), -len(plain), plain, found[0])
                      for plain, found in by_name.items()
                      if len(found) == 1 and plain and ' ' in plain and
                      re.search(r'(?<!\w)' + re.escape(plain) + r'(?!\w)', quote))
        found, end = [], -1
        for start, _, plain, (refn, name) in hits:
            if start < end:
                continue
            end = start + len(plain)
            label = f'{ident}-A{len(found) + 1:02}'
            while label in used:
                label += 'X'
            used.add(label)
            found.append({'kind': 'person', 'refn': refn, **fields, 'id': label,
                          'selector': person_selector(quote, name),
                          'targetName': name, 'heldPassageEvidence': []})
        return found
    for ident in gained:
        row, block = indexed.get(ident, (None, None))
        if row and row['kind'] == 'figure-caption' and ident not in have:
            # A new photograph is catalogued only for the people its caption
            # names in full.
            found = named_in_full(ident, row['quote'], {
                'associationRole': 'named-depicted-person', 'qualification': 'Named in the printed caption.',
                'reason': 'New photograph; its caption names this person in full, '
                          'matched to the published register name.'})
            require(found, f'{ident}: new figure “{row["quote"][:60]}” names no published person in full')
            rows.append({'id': ident, 'kind': 'figure-caption', 'chapter': row['chapter'],
                         'section': row['section'], 'quote': row['quote'], 'sha256': row['sha256'],
                         'elementId': row['elementId'], 'assetPaths': row['assetPaths'],
                         'existingLinks': [{k: v for k, v in link.items() if k != 'image'}
                                           for link in links(block.node)],
                         'associations': found, 'withheld': [],
                         'reviewNote': 'New photograph added with research.'})
            guards['captionGuards'].append({'blockId': ident, 'assetPaths': row['assetPaths'],
                                            'quote': row['quote'], 'sha256': row['sha256']})
            figure = figures[int(ident[4:]) - 1]
            preserved['figures'].append({
                'id': ident, 'assetPaths': row['assetPaths'],
                'imageLinks': [n.attrs for n in figure.nodes() if n.tag == 'a' and 'data-book-image' in n.attrs],
                'captionLinks': caption_links(block.node)})
            changes.append(f'{ident}: new photograph “{row["quote"][:60]}”')
            continue
        if row and row['kind'] == 'authored-heading' and ident not in have:
            # A new section heading from research. Many headings name nobody
            # in full; those it does name are linked like a new caption's.
            found = named_in_full(ident, row['quote'], {
                'associationRole': 'named-in-context',
                'reason': 'New heading; it names this person in full, '
                          'matched to the published register name.'})
            rows.append({'id': ident, 'kind': 'authored-heading', 'chapter': row['chapter'],
                         'section': row['section'], 'quote': row['quote'], 'sha256': row['sha256'],
                         'elementId': row['elementId'], 'assetPaths': [],
                         'existingLinks': [{k: v for k, v in link.items() if k != 'image'}
                                           for link in links(block.node)],
                         'associations': found, 'withheld': [],
                         'reviewNote': 'New heading added with research.'})
            changes.append(f'{ident}: new heading “{row["quote"][:60]}”')
            continue
        if not row or row['kind'] != 'chart-caption' or ident in have:
            continue
        couple = re.split(r'\.\s+(?:Earlier|Later) generations', row['quote'])[0].rstrip('.')
        # The chart id carries the husband's ancestor number (chart-solberg-6);
        # the wife is the next number. The ancestor table links both.
        number = re.fullmatch(r'chart-[a-z]+-(\d+)', row.get('elementId') or '')
        couple_refns = [numbered.get(str(n)) for n in
                        ((int(number[1]), int(number[1]) + 1) if number else ())]
        # A chart may show one parent when the other is unknown ("Chart 17: A.").
        expected = 2 if ' and ' in couple else 1
        known = [r for r in couple_refns if r in people]
        if expected == 1:
            # A one-name caption may still sit over a couple; keep the parent it names.
            known = [r for r in known if re.search(
                r'(?<!\w)' + re.escape(' '.join(people[r].replace('/', ' ').split())) + r'(?!\w)', couple)]
        if number and len(known) == expected:
            named = [(' '.join(people[r].replace('/', ' ').split()), (r, people[r]))
                     for r in known]
        else:
            named = [(plain, found[0]) for plain, found in by_name.items()
                     if len(found) == 1 and plain and
                     re.search(r'(?<!\w)' + re.escape(plain) + r'(?!\w)', couple)]
        found = []
        for n, (plain, (refn, name)) in enumerate(sorted(named, key=lambda x: couple.find(x[0])), 1):
            label = f'{ident}-A{n:02}'
            while label in used:
                label += 'X'
            used.add(label)
            found.append({'kind': 'person', 'refn': refn, 'associationRole': 'chart-root',
                          'reason': 'Generated family chart; its caption names this couple, '
                                    'matched to the published register name.',
                          'id': label, 'selector': person_selector(row['quote'], name),
                          'targetName': name, 'heldPassageEvidence': []})
        require(len(found) == expected, f'{ident}: new family chart “{couple}” does not name '
                                        f'{expected} published people')
        rows.append({'id': ident, 'kind': 'chart-caption', 'chapter': row['chapter'],
                     'section': row['section'], 'quote': row['quote'], 'sha256': row['sha256'],
                     'elementId': row['elementId'], 'assetPaths': row['assetPaths'],
                     'existingLinks': [{k: v for k, v in link.items() if k != 'image'}
                                       for link in links(block.node)],
                     'associations': found, 'withheld': [],
                     'reviewNote': 'Generated chart for a newly added generation.'})
        guards['captionGuards'].append({'blockId': ident, 'assetPaths': row['assetPaths'],
                                        'quote': row['quote'], 'sha256': row['sha256']})
        preserved['figures'].append({'id': ident, 'assetPaths': [], 'imageLinks': [],
                                     'captionLinks': []})
        changes.append(f'{ident}: new family chart “{couple}”')
    order = list(indexed)
    position = lambda ident: order.index(ident) if ident in order else len(order)
    rows.sort(key=lambda r: position(r['id']))
    guards['captionGuards'].sort(key=lambda g: position(g['blockId']))
    return changes


def rebase_generated(body, data, authored, installed, people):
    """Follow the regenerated register, notes and figures. Returns change lines."""
    from website_book_nonprose import index_blocks
    changes = []
    part = NON_PROSE
    associations, coverage = data[part, 'associations'], data[part, 'coverage']
    guards = data[part, 'guards']
    indexed = index_blocks(body, authored)
    current = defaultdict(list)
    for ident, (row, _) in indexed.items():
        current[ident[3]].append((ident, row))

    old = defaultdict(list)
    for row in coverage['registerBlocks']:
        old['R'].append((row['id'], row))
    for row in coverage['generatedHeadings']:
        old['H'].append((row['id'], row))
    for row in associations['authoredHeadingsAndCaptions']:
        old[row['id'][3]].append((row['id'], row))
    for row in associations['registerPeople']:
        if row['kind'] == 'collateral-entry':
            old['C'].append((row['id'], row))
    np_map, lost, gained = {}, [], []
    keys = {'H': (lambda r: (r.get('elementId'), r['quote']), lambda r: r.get('elementId')),
            'F': (lambda r: (r.get('elementId'), tuple(r.get('assetPaths') or ())),
                  lambda r: r.get('elementId')),
            'R': (lambda r: (r.get('registerHeading'), r['quote']), lambda r: r.get('registerHeading')),
            'C': (lambda r: r.get('elementId'), lambda r: r.get('elementId'))}
    for kind, (key, group) in keys.items():
        before = sorted(old[kind], key=lambda item: int(item[0][4:]))
        pairs, gone, new = align(before, current[kind], key, group)
        np_map.update((a, b) for a, b in pairs.items() if a != b)
        # A removed block's number may now belong to another block.
        np_map.update((a, f'{a}-REMOVED') for a in gone)
        lost += gone
        gained += new
    # Footnotes (loc-N) and register source notes (book-note-N) number separately.
    old_notes, new_notes, loc_map = previous_notes(installed), current_notes(body), {}
    check_installed_matches(data, old_notes)
    for family in ('loc-', 'book-note-'):
        pairs = note_pairs([n for n in old_notes if n[0].startswith(family)],
                           [n for n in new_notes if n[0].startswith(family)])
        loc_map.update((a, b) for a, b in pairs.items() if a != b)
    # A register line can change its words with nothing renumbered, as when a
    # place now reads "at" rather than "in"; its catalogue rows follow too.
    stored = {row['id']: row['quote'] for name in ('registerBlocks', 'generatedHeadings')
              for row in coverage[name]}
    reworded = any(stored.get(ident, row['quote']) != row['quote']
                   for ident, (row, _) in indexed.items())
    if not (np_map or loc_map or lost or gained or reworded):
        return changes
    if np_map:
        changes.append(f'{len(np_map)} book blocks renumbered')
    if loc_map:
        changes.append(f'{len(loc_map)} footnotes renumbered')
    for key in data:
        data[key] = remap(data[key], np_map, loc_map)
    associations, coverage = data[part, 'associations'], data[part, 'coverage']
    guards, contexts = data[part, 'guards'], data[part, 'contexts']
    lost = {np_map[i] for i in lost}
    changes += catalogue_new_charts(body, indexed, gained, data, people)
    # Figure witnesses are checked in book order.
    data[part, 'preserved']['figures'].sort(key=lambda w: int(w['id'][4:]))

    # Complete inventories follow the current book; decisions carry over.
    for name, kind, fields in (('registerBlocks', 'register-block', ('registerHeading',)),
                               ('generatedHeadings', 'generated-heading', ('elementId',))):
        before = {row['id']: row for row in coverage[name]}
        default = ({'actions': ['preserve-generated-text; no additional repeated-name/'
                                'source-owner annotation']} if name == 'registerBlocks' else
                   {'decision': max((r['decision'] for r in coverage[name]),
                                    key=[r['decision'] for r in coverage[name]].count)})
        rows = []
        for ident, (row, _) in indexed.items():
            if row['kind'] != kind:
                continue
            previous = before.get(ident)
            if previous and previous['quote'] != row['quote']:
                changes.append(f'{ident}: generated text revised')
            elif not previous:
                changes.append(f"{ident}: new {kind} “{row['quote'][:60]}”")
            fresh = {'id': ident, **{f: row.get(f) for f in fields},
                     'quote': row['quote'], 'sha256': row['sha256']}
            rows.append({**(previous or default), **fresh})
        coverage[name] = rows

    # Every stored view of a heading follows a moved chapter: its new
    # surrounding chapter and section, and a renumbered title.
    def headings(value):
        if isinstance(value, dict):
            if (NP_ID.fullmatch(str(value.get('id', ''))) and value.get('kind') == 'authored-heading'
                    and value['id'] in indexed):
                yield value
            for child in value.values():
                yield from headings(child)
        elif isinstance(value, list):
            for child in value:
                yield from headings(child)

    renamed = set()
    for row in [r for key in data for r in headings(data[key])]:
        now, _ = indexed[row['id']]
        row['chapter'], row['section'] = now['chapter'], now['section']
        if now['quote'] != row.get('quote'):
            row['associations'] = [
                {**a, 'selector': moved} for a in row.get('associations', [])
                if (moved := relocate(a['selector'], row['quote'], now['quote']))]
            row.update(quote=now['quote'], sha256=now['sha256'])
            if row['id'] not in renamed:
                renamed.add(row['id'])
                changes.append(f"{row['id']}: heading now “{now['quote']}”")

    # Rows bound to a register block or entry move onto its new words.
    notes = {n.attrs['id']: n for n in body.nodes() if LOC_ID.fullmatch(n.attrs.get('id', ''))}
    for name in ('registerPeople', 'registerPlaces'):
        kept = []
        for row in associations[name]:
            if row['id'] not in indexed:
                changes.append(f"{row['id']}: register block removed")
                continue
            now, block = indexed[row['id']]
            if now['quote'] != row['quote']:
                moved, taken = [], []
                for a in row['associations']:
                    selector = relocate(a['selector'], row['quote'], now['quote'], taken)
                    if not selector and a.get('kind') == 'person':
                        # A corrected name: find the person's current written name.
                        selector = person_mention(a, people, row['quote'], now['quote'], taken)
                    if selector:
                        a['selector'] = selector
                        taken.append((selector['start'], selector['end']))
                        moved.append(a)
                    else:
                        changes.append(f"{row['id']}: dropped {a['id']} ({a['selector']['exact']})")
                row['associations'] = moved
            for field in ('chapter', 'section', 'quote', 'sha256', 'elementId',
                          'registerHeading', 'containerTag'):
                if field in row:
                    row[field] = now.get(field)
            if name == 'registerPlaces':
                refs = linked_notes(block)
                witnesses = {w['id']: w for w in row['requiredNoteWitnesses']}
                row['noteIds'] = refs
                row['requiredNoteWitnesses'] = [
                    note_witness(notes[ref], witnesses.get(ref, {'id': ref, 'markers': []}))
                    for ref in refs]
            if row['associations'] or name == 'registerPeople':
                kept.append(row)
        associations[name] = kept

    # Every register entry keeps its profile entrypoint, including new ones.
    have = {row['id'] for row in associations['registerPeople']}
    used = {a['id'] for rows in associations.values() if isinstance(rows, list)
            for row in rows if isinstance(row, dict) for a in row.get('associations', [])}
    for ident, (row, _) in indexed.items():
        element = row.get('elementId') or ''
        entry = (row['kind'] == 'collateral-entry' or
                 row['kind'] == 'generated-heading' and row.get('tag') == 'h4' and
                 element.startswith('reg-'))
        if not entry or ident in have:
            continue
        refn = element.removeprefix('reg-collateral-').removeprefix('reg-')
        name = people.get(refn)
        selector = person_selector(row['quote'], name or '')
        if not name or not selector:
            changes.append(f'{ident}: new register entry for {refn} has no profile name')
            continue
        label = f'{ident}-PERSON-A01'
        while label in used:
            label += 'X'
        used.add(label)
        associations['registerPeople'].append({
            'id': ident, 'kind': row['kind'], 'chapter': row['chapter'], 'section': row['section'],
            'quote': row['quote'], 'sha256': row['sha256'], 'elementId': element,
            'associations': [{'kind': 'person', 'refn': refn, 'associationRole': PERSON_ROLE,
                              'id': label, 'selector': selector, 'targetName': name,
                              'heldPassageEvidence': []}],
            'policy': 'One profile entrypoint on the register entry.'})
        changes.append(f'{ident}: profile link for new register entry {refn}')
    order = list(indexed)
    associations['registerPeople'].sort(key=lambda row: order.index(row['id']))

    def cited_note(block, witness):
        # The note this block cites whose words best match the stored witness.
        cited = [ref for ref in linked_notes(block) if ref in notes]
        text = lambda ref: normalized(notes[ref].text({'doc-noteref', 'doc-backlink'}))
        if witness['id'] in cited and text(witness['id']) == witness['quote']:
            return witness['id']
        return max(cited, key=lambda ref: SequenceMatcher(None, text(ref), witness['quote']).ratio(),
                   default=witness['id'])

    for guard in list(guards.get('linkedNoteGuards', [])):
        if guard['blockId'] not in indexed:
            guards['linkedNoteGuards'].remove(guard)
            changes.append(f"{guard['id']}: note guard dropped with its block")
            continue
        now, block = indexed[guard['blockId']]
        if guard['attachment'] == 'footnote':
            guard['noteWitness']['id'] = cited_note(block, guard['noteWitness'])
        if guard['noteWitness']['id'] not in notes:
            guards['linkedNoteGuards'].remove(guard)
            changes.append(f"{guard['id']}: note guard dropped with its note")
            continue
        guard['blockQuote'], guard['blockSha256'] = now['quote'], now['sha256']
        guard['noteWitness'] = note_witness(notes[guard['noteWitness']['id']], guard['noteWitness'])
    by_text = defaultdict(list)
    for ref, node in notes.items():
        by_text[normalized(node.text({'doc-noteref', 'doc-backlink'}))].append(ref)
    for guard in guards['unmarkedEndnoteGuards']:
        same = by_text.get(guard['quote'], [])
        if len(same) == 1:
            guard['id'] = same[0]
        if guard['id'] in notes:
            guard.update(note_witness(notes[guard['id']], guard))
    for name in ('captionGuards', 'crossPassageGuards'):
        guards[name] = [g for g in guards[name] if g['blockId'] not in lost]
    kept = []
    for context in contexts.get('mentions', []):
        ident = context.get('blockId')
        if ident in lost:
            changes.append(f"{ident}: locality dropped with its block")
            continue
        if ident in indexed and ident[3] in 'RC' and context['quote'] != indexed[ident][0]['quote']:
            quote = indexed[ident][0]['quote']
            selector = relocate(context['selector'], context['quote'], quote)
            if not selector:
                changes.append(f"{ident}: dropped locality {context['id']}")
                continue
            context.update(quote=quote, passageSha256=digest(quote), selector=selector)
        kept.append(context)
    if 'mentions' in contexts:
        contexts['mentions'] = kept
    for ident in sorted(lost):
        changes.append(f"{ident.removesuffix('-REMOVED')}: block no longer in the book")
    return changes
