"""A checked HTML presentation of the receipted book, never a second manuscript.

The compiler reads an import-only derivative of build/book.typ. This module
accepts a deliberately narrow HTML vocabulary, accounts for the complete book,
and writes only into the exporter's disposable package stage. Its caller installs
that stage atomically after the PDF/source/composition receipts are rechecked.
"""
from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from html import escape
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote, urlsplit
import base64
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET

import bookbib
import booklib
import flyleaf_settings
from book_publication import digest, verify_receipt
from website_book_archive import current_book_map
from website_book_parity import Expected, Actual, compare
from website_book_annotations import DATE_STYLES, annotate, load_catalogue, written_date
from website_book_profiles import build_profile_introductions
from website_book_citation_presentation import build_citation_presentation

ROOT = booklib.ROOT  # the family folder
SCRIPTS = booklib.ENGINE / 'scripts'
SITE = booklib.ENGINE / 'website'  # the site code and its build output
SITE_CONTENT = flyleaf_settings.path('site_content')
TEMPLATE = booklib.TEMPLATES / 'web-template.typ'
BOOK = flyleaf_settings.folder_name('book')  # the family's book folder
SELECTIONS = ROOT / BOOK / 'web-selections.json'
# Without book/web-selections.json, nothing is hand-picked: headings take
# addresses from their text, and there are no highlights or old routes.
NO_SELECTIONS = {'schema': 1, 'headingAnchors': [], 'highlights': [], 'legacyRoutes': {},
                 'profileIntroductions': [], 'sectionPeople': [], 'citationPresentation': []}


def load_selections():
    return json.loads(SELECTIONS.read_text()) if SELECTIONS.is_file() else dict(NO_SELECTIONS)
VOID = {'meta', 'img', 'br'}
TAGS = {'html', 'head', 'meta', 'title', 'body', 'p', 'h1', 'h2', 'h3', 'h4',
        'h5', 'h6', 'nav', 'ol', 'ul', 'li', 'a', 'div', 'strong', 'em', 'sup',
        'sub', 'figure', 'img', 'figcaption', 'span', 'table', 'thead', 'tbody',
        'tr', 'th', 'td', 'br', 'section', 'code'}
ATTRIBUTES = {
    'meta': {'charset', 'name', 'content'}, 'a': {'href', 'id', 'role'},
    'img': {'src', 'style', 'alt'}, 'ol': {'style', 'start'},
    'span': {'id', 'style', 'data-book-person', 'data-book-key',
             'data-register-person', 'data-register-key', 'data-bibliography-entry',
             'data-book-page-ref'},
    'nav': {'role'}, 'section': {'role'}, 'li': {'id', 'value'},
    'figure': {'id'}, **{f'h{i}': {'id'} for i in range(1, 7)},
    'div': {'data-book-display'},
}
ROLES = {'doc-toc', 'doc-noteref', 'doc-endnotes', 'doc-backlink'}


@dataclass
class Node:
    tag: str
    attrs: dict = field(default_factory=dict)
    children: list = field(default_factory=list)

    def nodes(self):
        yield self
        for child in self.children:
            if isinstance(child, Node):
                yield from child.nodes()

    def text(self, omit_roles=()):
        if self.attrs.get('role') in omit_roles:
            return ''
        return ''.join(child if isinstance(child, str) else child.text(omit_roles)
                       for child in self.children)

    def html(self):
        inside = ''.join(escape(c) if isinstance(c, str) else c.html() for c in self.children)
        if self.tag == 'root':
            return inside
        attrs = ''.join(f' {k}="{escape(str(v), quote=True)}"' for k, v in self.attrs.items())
        return f'<{self.tag}{attrs}>' + ('' if self.tag in VOID else inside + f'</{self.tag}>')


def normalized(text):
    # Typst smart punctuation and ordinary whitespace are presentation only.
    return re.sub(r'\s+', ' ', text.translate(str.maketrans(
        {'’': "'", '‘': "'", '“': '"', '”': '"'})).replace('…', '...')).strip()


def allowed_style(tag, style):
    if tag == 'span':
        return style in {'font-variant-caps: small-caps', 'white-space: pre-wrap'}
    if tag == 'ol':
        return style == 'list-style-type: none'
    if tag == 'img':
        return bool(re.fullmatch(r'width: [0-9.]+(?:pt|%)(?:; height: [0-9.]+pt)?', style))
    return False


class BookHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node('root')
        self.stack = [self.root]

    def handle_decl(self, decl):
        if decl.lower() != 'doctype html':
            raise ValueError('Unexpected HTML declaration')

    def handle_comment(self, data):
        raise ValueError('Unexpected HTML comment')

    def handle_starttag(self, tag, attrs):
        if tag not in TAGS or len(dict(attrs)) != len(attrs):
            raise ValueError(f'Unsupported HTML element or duplicate attribute: {tag}')
        for key, value in attrs:
            if key not in ATTRIBUTES.get(tag, set()) or value is None:
                raise ValueError(f'Unsupported HTML attribute: {tag}.{key}')
            if key == 'style' and not allowed_style(tag, value):
                raise ValueError(f'Unsupported HTML style: {tag}.{value}')
            if key == 'role' and value not in ROLES:
                raise ValueError(f'Unsupported document role: {value}')
            if key == 'data-book-display' and value != 'relationship':
                raise ValueError(f'Unsupported book display marker: {value}')
            if key == 'id' and not re.fullmatch(r'[a-zA-Z][a-zA-Z0-9_-]*', value):
                raise ValueError(f'Invalid book anchor: {value}')
            if key == 'href':
                url = urlsplit(value)
                if not (re.fullmatch(r'#[a-zA-Z][a-zA-Z0-9_-]*', value) or
                        (url.scheme in {'https', 'http'} and url.netloc and not url.username)):
                    raise ValueError(f'Unsafe book link: {value}')
        node = Node(tag, dict(attrs))
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_endtag(self, tag):
        if len(self.stack) < 2 or self.stack[-1].tag != tag:
            raise ValueError(f'Malformed book HTML: unexpected </{tag}>')
        self.stack.pop()

    def handle_data(self, data):
        self.stack[-1].children.append(data)

    def parse(self, source):
        self.feed(source)
        self.close()
        if len(self.stack) != 1:
            raise ValueError('Truncated book HTML')
        nodes = list(self.root.nodes())
        for tag in ('html', 'head', 'body', 'title'):
            if sum(n.tag == tag for n in nodes) != 1:
                raise ValueError(f'Expected exactly one book {tag}')
        normalize_note_targets(self.root)
        check_links(self.root)
        return next(n for n in nodes if n.tag == 'body')


def normalize_note_targets(body):
    """Pin the backlink to its marker when Typst labels its preceding space.

    Showing horizontal space explicitly can receive the compiler's location ID.
    Only an adjacent whitespace span, optionally containing the compiler’s
    explicit pre-wrap whitespace spans, is accepted; never move an ID from
    text, another labelled element or an unrelated paragraph. All source characters and link destinations
    stay the same. The ordinary reciprocal-link validator then checks the result.
    """
    def pure_spacing(children):
        return bool(children) and all(
            (isinstance(child, str) and not child.strip()) or
            (isinstance(child, Node) and child.tag == 'span' and
             child.attrs == {'style': 'white-space: pre-wrap'} and
             pure_spacing(child.children)) for child in children)

    nodes = list(body.nodes())
    by_id = {n.attrs['id']: n for n in nodes if 'id' in n.attrs}
    parents = {id(child): n for n in nodes for child in n.children if isinstance(child, Node)}
    for note in nodes:
        if note.attrs.get('role') != 'doc-noteref' or 'id' in note.attrs:
            continue
        target = by_id.get(note.attrs.get('href', '')[1:])
        backs = [n for n in target.nodes() if n.attrs.get('role') == 'doc-backlink'] if target else []
        if len(backs) != 1:
            raise ValueError('Missing exact footnote return link')
        identity = backs[0].attrs.get('href', '')[1:]
        space = by_id.get(identity)
        siblings = [c for c in parents[id(note)].children if not (isinstance(c, str) and not c.strip())]
        index = next(i for i, c in enumerate(siblings) if c is note)
        if (not space or space.tag != 'span' or set(space.attrs) != {'id'} or
                not pure_spacing(space.children)
                or index < 1 or siblings[index - 1] is not space):
            raise ValueError('Footnote return target is not its adjacent empty spacing span')
        note.attrs['id'] = identity
        del space.attrs['id']


def check_links(body):
    nodes = list(body.nodes())
    ids = Counter(n.attrs['id'] for n in nodes if 'id' in n.attrs)
    if any(count != 1 for count in ids.values()):
        raise ValueError('Duplicate book anchors')
    links = [n.attrs['href'] for n in nodes if n.tag == 'a' and n.attrs.get('href', '').startswith('#')]
    missing = sorted({link[1:] for link in links} - ids.keys())
    if missing:
        raise ValueError('Broken book links: ' + ', '.join(missing[:10]))
    notes = [n for n in nodes if n.attrs.get('role') == 'doc-noteref']
    back = [n for n in nodes if n.attrs.get('role') == 'doc-backlink']
    by_id = {n.attrs['id']: n for n in nodes if 'id' in n.attrs}
    if len(notes) != len(back):
        raise ValueError('Footnote/backlink count mismatch')
    for note in notes:
        target = by_id[note.attrs['href'][1:]]
        returns = [n for n in target.nodes() if n.attrs.get('role') == 'doc-backlink']
        if len(returns) != 1 or returns[0].attrs['href'] != '#' + note.attrs.get('id', ''):
            raise ValueError('Footnote does not return to its exact reference')
    return {'anchors': len(ids), 'internalLinks': len(links), 'footnotes': len(notes)}


def derive(source):
    old = f'#import "{booklib.TEMPLATE_IMPORT}": *'.encode()
    new = f'#import "{booklib.WEB_TEMPLATE_IMPORT}": *'.encode()
    if source.count(old) != 1 or new in source:
        raise ValueError('Expected one original print-template import')
    result = source.replace(old, new)
    if result.replace(new, old) != source:
        raise ValueError('Web input must be an import-only derivative')
    return result


def compiler_warnings(stderr, source, derived_name):
    expected = ['html export is under active development and incomplete']
    print_rule = '#set page(numbering: "1")'
    if source.count(print_rule) != 1:
        raise ValueError('Unexpected print page-numbering rule inventory')
    expected.append('page set rule was ignored during HTML export')
    warnings = re.findall(r'^warning: (.+)$', stderr, re.M)
    if warnings != expected or re.search(r'^error:', stderr, re.M):
        raise ValueError('Unexpected Typst HTML warnings: ' + repr(warnings))
    line = source[:source.index(print_rule)].count('\n') + 1
    if f'{derived_name}:{line}:1' not in stderr or print_rule not in stderr:
        raise ValueError('Ignored print rule did not match its exact source location')


def find_compiler(receipt):
    """The Typst that built the PDF: FLYLEAF_TYPST, else typst on PATH.
    It must be the exact binary and version the PDF receipt recorded."""
    found = os.environ.get('FLYLEAF_TYPST') or shutil.which('typst')
    if not found:
        raise ValueError('Typst is required on PATH')
    compiler = Path(found).resolve()
    toolchain = receipt['toolchain']
    if digest(compiler) != toolchain['typstSha256']:
        raise ValueError('The web book needs the Typst that built the PDF')
    version = subprocess.run([str(compiler), '--version'], capture_output=True, text=True, check=True)
    if version.stdout.strip() != toolchain['typst']:
        raise ValueError('Typst version mismatch')
    booklib.check_typst_version(toolchain['typst'])
    return compiler


def compile_book(source, receipt, work):
    compiler = find_compiler(receipt)
    staged = booklib.STAGED_TEMPLATES / 'web-template.typ'
    if not staged.is_file() or staged.read_bytes() != TEMPLATE.read_bytes():
        raise ValueError('The web template changed after the book was built; run flyleaf book')
    derived = work / 'book.typ'
    derived.write_bytes(derive(source))
    html_path = work / 'book.html'
    command = [str(compiler), 'compile', '--root', str(ROOT), '--format', 'html',
               '--features', 'html', '--creation-timestamp', str(receipt['toolchain']['creationTimestamp']),
               str(derived), str(html_path)]
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True,
                            env=booklib.font_environment())
    (work / 'compiler.stderr').write_text(result.stderr)
    if result.returncode:
        raise ValueError('Native Book compilation failed: ' + result.stderr[:4000])
    compiler_warnings(result.stderr, derived.read_text(), derived.relative_to(ROOT).as_posix())
    return html_path.read_text()


def query_book_body(source, receipt, work):
    """Inspect the expanded print body independently of HTML show rules.

    Capturing content in metadata preserves the existing assembler's exact
    register sentences, source wording, note placement and table cells. This
    query does not render or parse a PDF and does not regenerate manuscript text.
    """
    lines = source.splitlines(keepends=True)
    insert = b'#show: body => { [#metadata(body) <web-parity-body>]; body }\n'
    if len(lines) < 3 or not lines[2].startswith(b'#show: book.with(') or b'<web-parity-body>' in source:
        raise ValueError('Unexpected assembled book wrapper for the parity query')
    derived = b''.join(lines[:3]) + insert + b''.join(lines[3:])
    if derived.replace(insert, b'', 1) != source:
        raise ValueError('Parity query changed the checked manuscript')
    target = work / 'parity-book.typ'
    target.write_bytes(derived)
    compiler = find_compiler(receipt)
    run = subprocess.run([str(compiler), 'query', '--root', str(ROOT),
                          '--creation-timestamp', str(receipt['toolchain']['creationTimestamp']),
                          str(target), '<web-parity-body>', '--field', 'value', '--one'],
                         cwd=ROOT, capture_output=True, env=booklib.font_environment())
    if run.returncode or run.stderr:
        raise ValueError('Book body query failed: ' + run.stderr.decode()[:3000])
    return json.loads(run.stdout), hashlib.sha256(run.stdout).hexdigest()


def printed(markup):
    """The words a line of story markup prints: no *bold*, _italic_ or
    `raw text` markers, and each escaped character, such as \\$, as itself."""
    parts = re.split(r'(?<!\\)`([^`]*)`', markup)
    return ''.join(part if index % 2 else re.sub(r'\\(.)', r'\1', re.sub(r'(?<!\\)[*_]', '', part))
                   for index, part in enumerate(parts))


def number_names(text, raw, tree, numbers):
    """As in the PDF, each #refp of an ancestor reads "Name (no. N)". Anyone
    outside the register, such as a brother or sister, keeps a plain name."""
    for refn in re.findall(r'#refp\("([^"]+)"\)', raw):
        person = tree.by_refn[refn]
        if person['xref'] in numbers:
            name = booklib.person_name(person)
            text = text.replace(name, f'{name} (no. {numbers[person["xref"]][0]})', 1)
    return text


def validate_content(body, assembled, receipt, mapping, tree):
    nodes = list(body.nodes())
    source_map = tree.sources_by_person()
    uses = Counter((n.attrs['data-book-person'], n.attrs.get('data-book-key'))
                   for n in nodes if 'data-book-person' in n.attrs)
    expected = Counter(re.findall(r'#metadata\(\(person: "([^"]+)", key: "([^"]+)"\)\) <bibliography-use>', assembled))
    if uses != expected:
        raise ValueError('Book citation identity/membership changed during HTML export')
    if any(key not in source_map.get(person, {}) for person, key in uses):
        raise ValueError('Book citation does not resolve to its exact person/key')
    register = booklib._load_module('check-register-sources.py', 'native_book_register_check')
    register_elements = [{'value': {'refn': n.attrs['data-register-person'],
                                   'key': n.attrs.get('data-register-key')}}
                         for n in nodes if 'data-register-person' in n.attrs]
    register_count, errors = register.check_sources(register.expected_keys(tree, receipt['rootRefn']), register_elements)
    bib_elements = [{'label': '<bibliography-use>', 'value': {'person': p, 'key': k}}
                    for (p, k), count in uses.items() for _ in range(count)]
    bib_elements += [{'label': '<bibliography-entry>', 'value': n.attrs['data-bibliography-entry']}
                     for n in nodes if 'data-bibliography-entry' in n.attrs]
    bib_stats, bib_errors = bookbib.check_inventory(source_map, bookbib.load_policy(), bib_elements,
                                                    people=tree.register_people(receipt['rootRefn']))
    if errors or bib_errors:
        raise ValueError('Book source apparatus mismatch: ' + repr(errors + bib_errors))
    corpus = {
        'prose': normalized(body.text({'doc-endnotes', 'doc-noteref', 'doc-backlink'})),
        'note': normalized(' '.join(n.text() for n in nodes if n.attrs.get('role') == 'doc-endnotes')),
        'caption': normalized(' '.join(n.text() for n in nodes if n.tag == 'figcaption')),
    }
    table = tree.ahnentafel(receipt['rootRefn'])
    numbers = tree.numbers_by_xref(table)
    checked = Counter()
    for claim in mapping['claims']:
        text = claim['text']
        if claim['kind'] == 'prose':
            text = printed(text)
            text = re.sub(r'(?:^|\s)\+ ', ' ', text)
            text = text.replace('{{stat:persons}}', str(len(set(table.values()))))
            text = number_names(text, claim['raw'], tree, numbers)
            if '{{stat:date}}' in text:
                edition = date.fromisoformat(receipt['book']['editionDate'])
                written = [text.replace('{{stat:date}}', written_date(edition, style))
                           for style in DATE_STYLES['full-date']]
                text = next((t for t in written if normalized(t) in corpus['prose']), written[0])
        if claim['kind'] not in corpus or normalized(text) not in corpus[claim['kind']]:
            raise ValueError(f'Book text missing: {claim["file"]}:{claim["line"]}: {text[:120]}')
        checked[claim['kind']] += 1
    return {'authoredSegments': dict(checked), 'bibliographyUses': sum(uses.values()),
            'registerSources': register_count, 'bibliography': bib_stats}, source_map, uses


def prose_opening(nodes):
    """First complete prose block, excluding display matter and note markers.

    Typst emits both p and div for prose. Choosing only p can skip an entire
    section's opening and accidentally summarize a much later paragraph.
    """
    display = {'figure', 'figcaption', 'table', 'nav', 'ol', 'ul'}
    blocks = display | {'p', 'div', 'section', *{f'h{i}' for i in range(1, 7)}}
    excluded = {id(child) for node in nodes
                if (node.tag in display or node.attrs.get('role') == 'doc-endnotes'
                    or node.attrs.get('data-book-display') == 'relationship')
                for child in node.nodes()}

    def adjacent_note(children, index, step):
        index += step
        while 0 <= index < len(children):
            child = children[index]
            if ((isinstance(child, str) and not child.strip()) or
                    (isinstance(child, Node) and child.tag == 'span' and not child.text().strip())):
                index += step
                continue
            return isinstance(child, Node) and child.attrs.get('role') == 'doc-noteref'
        return False

    def prose_text(node):
        if node.attrs.get('role') == 'doc-noteref':
            return '\0'
        parts = []
        for i, child in enumerate(node.children):
            # This punctuation joins two omitted citation markers. Ordinary
            # punctuation and all other superscripts remain part of the prose.
            if (isinstance(child, Node) and child.tag == 'sup' and child.text().strip() in {',', ';'}
                    and adjacent_note(node.children, i, -1) and adjacent_note(node.children, i, 1)):
                continue
            parts.append(child if isinstance(child, str) else prose_text(child))
        return ''.join(parts)

    for node in nodes:
        if node.tag not in {'p', 'div'} or id(node) in excluded:
            continue
        if any(child is not node and child.tag in blocks for child in node.nodes()):
            continue
        # Omitted markers must not join adjacent words; ordinary punctuation
        # and the existing spaces on either side otherwise remain untouched.
        text = normalized(re.sub(r'(?<=\w)\0+(?=\w)', ' ', prose_text(node)).replace('\0', ''))
        if text:
            return text
    return ''


def add_section_people(sections, selections, tree, published_people=None):
    """Reviewed people discussed in a section, separate from ancestor covers.

    Explicit entries bind a real narrative section to its exact authored file.
    They add metadata only: no text, family edges, citation owners or numbering.
    """
    allowed = {'schema', 'headingAnchors', 'highlights', 'legacyRoutes', 'sectionPeople',
               'profileIntroductions', 'citationPresentation'}
    if set(selections) - allowed:
        raise ValueError('Unsupported reading selection field')
    entries = selections.get('sectionPeople', [])
    if not isinstance(entries, list):
        raise ValueError('Section people must be a list')
    used = set()
    by_anchor = {section['anchor']: section for section in sections}
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {'anchor', 'people', 'manuscript', 'sha256'}:
            raise ValueError('Unsupported section people selector')
        anchor = entry['anchor']
        if not isinstance(anchor, str) or anchor not in by_anchor or anchor in used:
            raise ValueError('Missing or duplicate section people anchor')
        people = entry['people']
        if (not isinstance(people, list) or not people or
                any(not isinstance(person, str) or person not in tree.by_refn or
                    (published_people is not None and person not in published_people)
                    for person in people) or len(set(people)) != len(people)):
            raise ValueError('Section people must be unique published native identities')
        manuscript = entry['manuscript']
        sha256 = entry['sha256']
        if (not isinstance(manuscript, str) or
                not re.fullmatch(re.escape(BOOK) + r'/sketches/[a-zA-Z0-9._-]+\.typ', manuscript) or
                not isinstance(sha256, str) or not re.fullmatch(r'[a-f0-9]{64}', sha256)):
            raise ValueError('Invalid section people manuscript binding')
        path = ROOT / manuscript
        if (not path.is_file() or not path.resolve().is_relative_to((ROOT / BOOK / 'sketches').resolve()) or
                digest(path) != sha256):
            raise ValueError('Stale section people manuscript binding')
        meta, _ = booklib.parse_front_matter(path)
        if anchor != 'nar-' + meta.get('refn', ''):
            raise ValueError('Section people manuscript belongs to a different section')
        used.add(anchor)
        by_anchor[anchor]['people'] = sorted(set(by_anchor[anchor]['people']) | set(people))


def reading_sections(body, selections, tree, published_people=None):
    nodes = list(body.nodes())
    selectors = {(s['level'], s['heading']): s['anchor'] for s in selections['headingAnchors']}
    if len(selectors) != len(selections['headingAnchors']) or len(set(selectors.values())) != len(selectors):
        raise ValueError('Reading selectors must have unique headings and anchors')
    rewrites, used = {}, set()
    taken = {n.attrs['id'] for n in nodes if 'id' in n.attrs} | set(selectors.values())
    for node in nodes:
        if re.fullmatch(r'h[1-6]', node.tag) and node.attrs.get('id', '').startswith('loc-'):
            key = (int(node.tag[1]), normalized(node.text()))
            if key in selectors:
                rewrites[node.attrs['id']] = selectors[key]
                used.add(key)
                continue
            # A heading nobody named takes an address from its text.
            anchor = 'reading-' + (booklib.slugify(key[1]) or 'section')
            if anchor in taken:
                raise ValueError('Two reading headings need the same address: ' + repr(key)
                                 + '; name one in book/web-selections.json')
            taken.add(anchor)
            rewrites[node.attrs['id']] = anchor
    if used != selectors.keys():
        raise ValueError('Stale reading heading selectors')
    for node in nodes:
        if node.attrs.get('id') in rewrites:
            node.attrs['id'] = rewrites[node.attrs['id']]
        href = node.attrs.get('href', '')
        if href.startswith('#') and href[1:] in rewrites:
            node.attrs['href'] = '#' + rewrites[href[1:]]
    by_id = {n.attrs['id']: n for n in nodes if 'id' in n.attrs}
    for i, node in enumerate(nodes):
        if 'data-book-page-ref' not in node.attrs:
            continue
        links = [n for n in node.nodes() if n.tag == 'a']
        if len(links) != 1:
            raise ValueError('Unexpected physical page-reference structure')
        link = links[0]
        target_id = link.attrs['href'][1:]
        target = by_id[target_id]
        if target.tag.startswith('h') and re.fullmatch('h[1-6]', target.tag):
            title = normalized(target.text())
        elif target.tag == 'figure':
            caption = next(n for n in target.nodes() if n.tag == 'figcaption')
            title = re.split(r'Earlier generations:|Later generations:', normalized(caption.text()))[0].strip()
        elif target_id.startswith(('family-', 'reg-collateral-')):
            refn = re.sub(r'^(family-|reg-collateral-)', '', target_id)
            title = 'Family of ' + booklib.person_name(tree.by_refn[refn])
        elif target_id.startswith('nar-'):
            next_heading = next((n for n in nodes[nodes.index(target) + 1:] if re.fullmatch('h[1-6]', n.tag)), None)
            if not next_heading:
                raise ValueError('Narrative target has no heading')
            title = normalized(next_heading.text())
        else:
            raise ValueError('Page reference lacks a meaningful destination: ' + target_id)
        link.children = [title]
        del node.attrs['data-book-page-ref']
    # Footnote IDs are internal to this edition; public links use the explicit
    # heading/person/selection anchors, never compiler-generated locations.
    sections, chapter = [], ''
    flat = list(body.nodes())
    for i, node in enumerate(flat):
        if node.tag not in {'h2', 'h3'} or not node.attrs.get('id'):
            continue
        anchor = node.attrs['id']
        if node.tag == 'h2':
            chapter = anchor
        end = next((j for j in range(i + 1, len(flat)) if flat[j].tag in {'h2', 'h3'}), len(flat))
        following = flat[i + 1:end]
        # These h3 sections group reference entries, not narrative paragraphs.
        # Keep the h2 introduction, which explains the references' limitations.
        opening = '' if chapter == 'register-references' and node.tag == 'h3' else prose_opening(following)
        excerpt = opening
        # This is a literal prefix from the compiled body, not authored web prose.
        if len(excerpt) > 240:
            excerpt = excerpt[:240].rsplit(' ', 1)[0] + '…'
        image = next((n for n in following if n.tag == 'img' and n.attrs.get('data-book-kind') != 'chart'), None)
        people = set()
        for n in following:
            if n.attrs.get('role') == 'doc-noteref':
                note = by_id[n.attrs['href'][1:]]
                people.update(m.attrs['data-book-person'] for m in note.nodes() if 'data-book-person' in m.attrs)
        if anchor.startswith('nar-') and anchor[4:] in tree.by_refn:
            people.add(anchor[4:])
        sections.append({'anchor': anchor, 'chapter': chapter, 'level': int(node.tag[1]),
                         'title': node.text().strip(), 'excerpt': excerpt, 'opening': opening,
                         'people': sorted(people),
                         'image': image.attrs.get('data-book-original', '') if image else ''})
    # The compiler's role marker is needed only for metadata extraction. Keep
    # the delivered body and its annotation identities exactly as before.
    for node in nodes:
        node.attrs.pop('data-book-display', None)
    anchors = {s['anchor'] for s in sections}
    tocs = [n for n in body.nodes() if n.attrs.get('role') == 'doc-toc']
    if len(tocs) != 1:
        raise ValueError('Expected one complete generated table of contents')
    toc_links = [n for n in tocs[0].nodes() if n.tag == 'a']
    if ([(n.attrs.get('href', '')[1:], normalized(n.text())) for n in toc_links] !=
            [(s['anchor'], normalized(s['title'])) for s in sections]):
        raise ValueError('Generated contents do not match all reading headings in order')
    if not set(selections['highlights']).issubset(anchors):
        raise ValueError('Chapter highlight does not select an actual reading section')
    for old, target in selections['legacyRoutes'].items():
        if not old or target not in by_id or target.startswith('loc-'):
            raise ValueError('Invalid legacy Book redirect')
    add_section_people(sections, selections, tree, published_people)
    public_anchors = sorted(a for a in by_id if not a.startswith(('loc-', 'book-note-')))
    return sections, public_anchors


def bind_citation_notes(body):
    """Give complete printed reference entries edition-bound reader targets."""
    parents = {id(c): p for p in body.nodes() for c in p.children if isinstance(c, Node)}
    register_count = 0
    for marker in [n for n in body.nodes() if 'data-book-person' in n.attrs]:
        parent = parents[id(marker)]
        if parent.tag == 'li' and parent.attrs.get('id', '').startswith('loc-'):
            ancestor = parents.get(id(parent))
            section = parents.get(id(ancestor))
            if ancestor.tag != 'ol' or section.attrs.get('role') != 'doc-endnotes':
                raise ValueError('Citation is not in a complete printed endnote')
        elif parent.tag == 'div' and parents[id(parent)] is body:
            metadata = [n for n in parent.nodes() if 'data-register-person' in n.attrs]
            if len(metadata) != 1 or (metadata[0].attrs['data-register-person'], metadata[0].attrs['data-register-key']) != (marker.attrs['data-book-person'], marker.attrs['data-book-key']):
                raise ValueError('Register reference identity differs from its printed citation')
            register_count += 1
            if parent.attrs:
                raise ValueError('Unexpected register reference container attributes')
            parent.attrs['id'] = f'book-note-{register_count}'
        else:
            raise ValueError('Citation metadata is outside a complete printed note')
        parent.attrs['data-book-note'] = ''
    return register_count


def image_dimensions(data, suffix):
    if suffix == '.svg':
        if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
            raise ValueError('External or declared chart entities are unsupported')
        svg = ET.fromstring(data)
        # Charts are generated illustrations, served as private static images.
        # Reject active SVG and links; all current charts are self-contained.
        allowed = {
            'svg': {'width', 'height', 'viewBox', 'font-family', 'font-size'},
            'metadata': set(),
            'rect': {'x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke', 'stroke-width'},
            'path': {'d', 'stroke', 'stroke-width', 'fill'},
            'text': {'x', 'y', 'text-anchor', 'font-size', 'font-family', 'font-weight', 'font-style', 'fill'},
        }
        for node in svg.iter():
            name = node.tag.split('}')[-1]
            if (node.tag != '{http://www.w3.org/2000/svg}' + name or name not in allowed
                    or set(node.attrib) - allowed[name] or any(
                        re.search(r'url\s*\(|@import|javascript:|data:', v, re.I) for v in node.attrib.values())):
                raise ValueError('Unsupported active or external chart SVG content')
            for attribute in ('fill', 'stroke'):
                if attribute in node.attrib and not re.fullmatch(
                        r'none|#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})', node.attrib[attribute]):
                    raise ValueError('Chart paint must be a literal color or none')
        viewbox = svg.attrib.get('viewBox', '').split()
        if len(viewbox) != 4:
            raise ValueError('Chart SVG lacks intrinsic dimensions')
        width, height = map(float, viewbox[2:])
    else:
        from PIL import Image
        with Image.open(io.BytesIO(data)) as im:
            width, height = im.size
    if not (0 < width < 100000 and 0 < height < 100000):
        raise ValueError('Invalid image dimensions')
    return width, height


def externalize_images(body, receipt, stage, admitted, previews):
    dependencies = {name: sha for name, sha in receipt['dependencies'].items()
                    if Path(name).suffix.lower() in {'.svg', '.png', '.jpg', '.jpeg'}}
    by_hash = {}
    for name, sha in dependencies.items():
        by_hash.setdefault(sha, []).append(name)
    seen, entries = [], []
    for figure in [n for n in body.nodes() if n.tag == 'figure']:
        captions = [n for n in figure.nodes() if n.tag == 'figcaption']
        images = [n for n in figure.nodes() if n.tag == 'img']
        if len(captions) != 1 or len(images) != 1:
            raise ValueError('Expected one caption and one image per book figure')
        image = images[0]
        match = re.fullmatch(r'data:(image/(?:jpeg|png|svg\+xml));base64,(.+)', image.attrs.get('src', ''), re.S)
        if not match:
            raise ValueError('Unsupported or external compiler image')
        data = base64.b64decode(match[2], validate=True)
        sha = hashlib.sha256(data).hexdigest()
        candidates = by_hash.get(sha, [])
        if len(candidates) != 1:
            raise ValueError('Book image lacks an unambiguous checked dependency')
        source = candidates[0]
        if data != flyleaf_settings.locate(source).read_bytes():
            raise ValueError('Book image differs from its checked original')
        suffix = Path(source).suffix.lower()
        chart = source.startswith('build/figures/chart-') and suffix == '.svg'
        if chart:
            path = f'book-assets/{sha}.svg'
            (stage / 'book-assets').mkdir(exist_ok=True)
            (stage / path).write_bytes(data)
        else:
            path = source
            if path not in admitted or digest(stage / path) != sha:
                raise ValueError('Book figure is not an admitted private asset: ' + path)
        width, height = image_dimensions(data, suffix)
        image.attrs = {'src': '/data/' + quote(path, safe='/'), 'width': str(width), 'height': str(height),
                       'alt': '', 'loading': 'lazy', 'decoding': 'async',
                       'data-book-original': path, 'data-book-kind': 'chart' if chart else 'figure'}
        # Caption remains visible once, directly after its image. The enclosing
        # image link is explicitly named, avoiding a second long screenreader caption.
        url = '/data/' + quote(path, safe='/')
        image_link = Node('a', {'href': url, 'data-book-image': path,
                              'aria-label': 'Open illustration: ' + normalized(captions[0].text())}, [image])
        for parent in figure.nodes():
            for i, child in enumerate(parent.children):
                if child is image:
                    parent.children[i] = image_link
                    break
            else:
                continue
            break
        if not chart and path in previews.get('files', {}):
            preview = previews['files'][path]
            if preview['sourceSha256'] != sha or preview['sourceBytes'] != len(data):
                raise ValueError('Book image preview has a different source')
            variants = preview['variants']
            for size, variant in variants.items():
                if digest(stage / variant['path']) != variant['sha256']:
                    raise ValueError('Book image preview bytes changed')
            image.attrs['src'] = '/data/' + variants['1600']['path']
            image.attrs['srcset'] = ', '.join('/data/' + variants[s]['path'] + ' ' + s + 'w' for s in ('640', '1600'))
            image.attrs['sizes'] = '(max-width: 720px) calc(100vw - 40px), 720px'
        figure.attrs['class'] = 'native-book-chart' if chart else 'native-book-figure'
        entries.append({'source': source, 'path': path, 'sha256': sha, 'bytes': len(data),
                        'kind': 'chart' if chart else 'figure', 'width': width, 'height': height})
        seen.append(source)
    # A picture may appear in more than one figure; each must still be accounted for.
    if set(seen) != set(dependencies):
        raise ValueError('Complete book image inventory differs from checked dependencies')
    if sum(n.tag == 'img' for n in body.nodes()) != len(entries):
        raise ValueError('Unaccounted image outside a captioned book figure')
    return entries


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')


def check_image_positions(expected, assets):
    if expected.images != [asset['source'] for asset in assets]:
        raise ValueError('Book illustrations differ from compiler caption/figure order')


def build_web_book(receipt_path, stage, admitted, renamed=None):
    """Build inside an uninstalled package; failure never replaces live data.

    renamed maps a saved page's path to the name a public site gives it."""
    renamed = renamed or {}
    receipt = verify_receipt(receipt_path)
    annotations = load_catalogue(SITE_CONTENT / 'book-annotations.json')
    inputs = {flyleaf_settings.logical(p): digest(p) for p in
              (TEMPLATE, *([SELECTIONS] if SELECTIONS.is_file() else []), Path(__file__),
               ROOT / BOOK / 'CLAIMS-MAP.json',
               SCRIPTS / 'website_book_annotations.py',
               SCRIPTS / 'website_book_nonprose.py',
               SCRIPTS / 'website_book_profiles.py',
               SCRIPTS / 'website_book_citation_presentation.py',
               flyleaf_settings.content_file('geography.json'),
               *(SCRIPTS / name for name in ('website_book_parity.py',
                 'website_book_archive.py', 'website_assets.py', 'extract-claims.py')))}
    inputs.update({flyleaf_settings.logical(path): sha for path, sha in annotations.inputs})
    published_gedcom_sha = digest(stage / 'family.ged')
    published = booklib.Tree(stage / 'family.ged')
    published_people = {}
    for record in published._parser.get_root_child_elements():
        if record.get_tag() != 'INDI':
            continue
        fields = {}
        for child in record.get_child_elements():
            # A person's Flyleaf id is the REFN with TYPE jsonid.
            if child.get_tag() == 'REFN' and not any(
                    sub.get_tag() == 'TYPE' and sub.get_value() == 'jsonid'
                    for sub in child.get_child_elements()):
                continue
            if child.get_tag() in {'REFN', 'NAME'}:
                fields.setdefault(child.get_tag(), child.get_multi_line_value())
        if fields.get('REFN'):
            published_people[fields['REFN']] = fields.get('NAME', '')
    mapping, root, _ = current_book_map(ROOT / BOOK / 'CLAIMS-MAP.json', booklib.SRC_GED.read_text())
    if root != receipt['rootXref']:
        raise ValueError('Native reader belongs to a different family')
    selections = load_selections()
    if os.environ.get('BOOK_REANCHOR') == '1' and SELECTIONS.is_file():
        from website_book_reanchor import refresh_section_people
        for line in refresh_section_people(SELECTIONS, ROOT):
            print('reanchor:', line)
        selections = json.loads(SELECTIONS.read_text())
        inputs[flyleaf_settings.logical(SELECTIONS)] = digest(SELECTIONS)
    if selections.get('schema') != 1:
        raise ValueError('Unsupported reading selection schema')
    source = (ROOT / 'build/book.typ').read_bytes()
    # In the family's build folder, inside Typst's --root, wherever Flyleaf is.
    workspace = ROOT / 'build' / 'web-book'
    workspace.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='native-book-', dir=workspace) as tmp:
        work = Path(tmp)
        html = compile_book(source, receipt, work)
        body = BookHTML().parse(html)
        oracle, oracle_hash = query_book_body(source, receipt, work)
        expected = Expected(oracle)
        generated = compare(expected, Actual(body.html(), expected))
        tree = booklib.Tree()
        checks, source_map, uses = validate_content(body, source.decode(), receipt, mapping, tree)
        checks.update(check_links(body))
        previews_path = stage / 'previews.json'
        previews = json.loads(previews_path.read_text()) if previews_path.exists() else {}
        assets = externalize_images(body, receipt, stage, set(admitted), previews)
        check_image_positions(expected, assets)
        checks['linkedRegisterNotes'] = bind_citation_notes(body)
        sections, public_anchors = reading_sections(body, selections, tree, published_people)
        checks['images'] = len(assets)
        checks['contentsSections'] = len(sections)
        check_links(body)
        transformed = compare(expected, Actual(body.html(), expected))
        checks['generatedText'] = {k: v for k, v in transformed.items() if k != 'rows'}
        checks['expandedPrintBodySha256'] = oracle_hash
        if generated['mainTokens'] != transformed['mainTokens'] or generated['noteTokens'] != transformed['noteTokens']:
            raise ValueError('Presentation transforms changed the complete book wording')
        if os.environ.get('BOOK_REANCHOR') == '1':
            # Deliberate prose edits: move the reviewed catalogue onto the new
            # text, print every change for review, then check it as usual.
            from website_book_reanchor import reanchor, installed_passage_order
            order = installed_passage_order(SITE / 'public/data/native-book')
            for line in reanchor(body, SITE_CONTENT / 'book-annotations.json', order,
                                 installed=SITE / 'public/data/native-book',
                                 people=published_people):
                print('reanchor:', line)
            annotations = load_catalogue(SITE_CONTENT / 'book-annotations.json')
            inputs.update({flyleaf_settings.logical(path): sha for path, sha in annotations.inputs})
        reader_annotations = annotate(body, annotations, published_people,
                                      json.loads((flyleaf_settings.content_file('geography.json')).read_text()),
                                      edition_date=receipt['book']['editionDate'])
        checks['annotations'] = reader_annotations['counts']
        citations = []
        for person, key in sorted(uses):
            src = source_map[person][key]
            citations.append({'person': person, 'key': key, 'sourcePointer': src['source_id'],
                              'legacyNotes': src['raw_notes'],
                              'label': src['source_label'], 'url': src['url'],
                              'locators': sorted({u.get('page', '') for u in src['uses']} or {''}),
                              'files': sorted({renamed.get(p, p) for p in src['paths']} & set(admitted))})
        if os.environ.get('BOOK_REANCHOR') == '1' and SELECTIONS.is_file():
            from website_book_reanchor import refresh_selections
            from website_book_profiles import profile_block, profile_selector
            from website_book_citation_presentation import citation_context
            from website_book_annotations import content_digest
            by_identity = {(c['person'], c['key']): c for c in citations}
            for line in refresh_selections(
                    SELECTIONS,
                    lambda passage: profile_selector(profile_block(
                        body, reader_annotations, citations, passage, public_anchors)),
                    lambda person, key: content_digest(citation_context(body, by_identity[person, key]))):
                print('reanchor:', line)
            selections = json.loads(SELECTIONS.read_text())
            inputs[flyleaf_settings.logical(SELECTIONS)] = digest(SELECTIONS)
        presentation = build_citation_presentation(
            body, citations, selections.get('citationPresentation', []), set(admitted))
        checks['citationPresentation'] = {'uses': len(presentation)}
        introductions = build_profile_introductions(
            body, reader_annotations, citations, selections.get('profileIntroductions', []),
            published_people, public_anchors)
        checks['profileIntroductions'] = {'people': len(introductions),
                                         'paragraphs': sum(len(p['blocks']) for p in introductions)}
        payload = {'schema': 1, 'pdfSha256': receipt['book']['sha256'],
                   'html': ''.join(c.html() if isinstance(c, Node) else escape(c) for c in body.children),
                   'sections': sections, 'highlights': selections['highlights'],
                   'anchors': public_anchors,
                   'legacyRoutes': selections['legacyRoutes'], 'citations': citations,
                   'assets': assets, 'annotations': reader_annotations,
                   'profileIntroductions': introductions, 'citationPresentation': presentation}
        payload_bytes = (json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
        sha = hashlib.sha256(payload_bytes).hexdigest()
        path = f'native-book/{sha}.json'
        (stage / 'native-book').mkdir()
        (stage / path).write_bytes(payload_bytes)
        descriptor = {'schema': 1, 'path': path, 'sha256': sha, 'bytes': len(payload_bytes),
                      'pdfSha256': receipt['book']['sha256'], 'sections': sections,
                      'anchors': public_anchors,
                      'highlights': selections['highlights'], 'legacyRoutes': selections['legacyRoutes'],
                      'profileIntroductions': introductions, 'citationPresentation': presentation}
        final = verify_receipt(receipt_path)
        if (final != receipt or source != (ROOT / 'build/book.typ').read_bytes()
                or digest(stage / 'family.ged') != published_gedcom_sha
                or any(digest(flyleaf_settings.locate(name)) != sha
                       for name, sha in inputs.items())):
            raise ValueError('Book inputs changed during native publication')
        check_receipt = {'schema': 1, 'status': 'checked-web-book', 'pdfReceiptSha256': digest(receipt_path),
                         'inputs': inputs, 'compilerSha256': receipt['toolchain']['typstSha256'],
                         'rawHtmlSha256': hashlib.sha256(html.encode()).hexdigest(),
                         'publishedGedcomSha256': published_gedcom_sha,
                         'importOnlyDerivation': True, 'checks': checks, 'book': descriptor,
                         'assets': assets}
        write_json(stage / 'native-book-receipt.json', check_receipt)
        return descriptor
