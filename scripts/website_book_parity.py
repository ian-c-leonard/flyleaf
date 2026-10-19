"""Strict compiler-content/HTML word-order parity for the native family book.

Consumes an actual Typst metadata query; does not parse Typst or regenerate prose.
Only the current finite content vocabulary is admitted. Layout whitespace and
smart punctuation are presentation differences. Words, punctuation, source
metadata placement, note placement, cell boundaries and link targets remain.
"""
# Validation assertions must never be disabled by an optimized interpreter.
if not __debug__:
    raise RuntimeError('Native Book parity requires Python without optimization')

from collections import Counter
from dataclasses import dataclass, field
from functools import cache
from html.parser import HTMLParser
import json
import re

import booklib


FIELDS = {
    'styled': 'child styles', 'sequence': 'children', 'parbreak': '',
    'v': 'amount', 'align': 'alignment body', 'text': 'text label',
    'metadata': 'label value', 'space': '', 'pagebreak': 'to weak',
    'outline': 'depth indent', 'heading': 'body depth label',
    'smartquote': 'double', 'strong': 'body label', 'item': 'body',
    'emph': 'body', 'counter-update': 'key', 'link': 'body dest',
    'footnote': 'body label', 'figure': 'body caption kind label supplement',
    'image': 'source width height fit label', 'caption': 'body',
    'ref': 'target form', 'block': 'above below body breakable inset sticky width',
    'super': 'body', 'symbol': 'text', 'grid': 'children column-gutter columns row-gutter',
    'cell': 'body', 'smallcaps': 'body', 'h': 'amount',
    'table': 'children columns inset stroke', 'header': 'children',
    'columns': 'body count gutter', 'linebreak': '', 'raw': 'text block',
}
NULL_METADATA = {'<title-end>', '<recto-gap-start>', '<recto-gap-end>', '<part-title>'}
TRANS = str.maketrans({'’': "'", '‘': "'", '“': '"', '”': '"'})


@cache
def continuous_openings():
    """Bare <nar-...> markers: the openings of the family's continuous sketches,
    which supply their own headings (see book-assemble.py)."""
    labels = set()
    book = booklib.flyleaf_settings.folder_name('book')
    # Stories are .typ files; other files there, such as a Mac's .DS_Store, are not.
    for path in sorted((booklib.ROOT / book / 'sketches').glob('*.typ')):
        if path.name.startswith('.'):
            continue
        meta, _ = booklib.parse_front_matter(path)
        if meta.get('continuous') == 'true' and meta.get('refn'):
            labels.add(f"<nar-{meta['refn']}>")
    return frozenset(labels)


def norm(s):
    return re.sub(r'\s+', ' ', s.translate(TRANS).replace('…', '...')).strip()


def tokens(s):
    # Word boundaries are retained: "another" cannot equal "an other".
    return re.findall(r'⟦[^⟧]*⟧|\w+|[^\w\s]', norm(s))


def mark(kind, value=''):
    assert '⟧' not in str(value)
    return ' ⟦' + kind + ':' + str(value) + '⟧ '


def meta(label, value):
    schemas = {'<bibliography-use>': {'person', 'key'},
               '<register-source>': {'refn', 'key'}}
    if label in schemas:
        assert isinstance(value, dict) and set(value) == schemas[label]
        assert all(isinstance(x, str) for x in value.values())
    elif label == '<bibliography-entry>':
        assert isinstance(value, str)
    else:
        raise ValueError('Unsupported semantic metadata: ' + label)
    return mark('META', json.dumps([label, value], ensure_ascii=False, sort_keys=True))


class Expected:
    def __init__(self, body):
        self.notes = []
        self.links = [[]]
        self.counts = Counter()
        self.figure_numbers = Counter()
        self.figures = {}
        self.figure_order = []
        self.figure_labels = []
        self.images = []
        self.cells = 0
        self.table_cells = 0
        self.in_table = False
        self.headings = []
        self.main = self.walk(body, 0)
        line = booklib.strapline(booklib.load_book_yaml())
        self.main = self.main.replace(line, line.upper(), 1)

    def walk(self, x, stream):
        if not isinstance(x, dict) or x.get('func') not in FIELDS:
            raise ValueError('Unknown compiler content node: ' + repr(x)[:120])
        f = x['func']
        if set(x) - {'func'} - set(FIELDS[f].split()):
            if f == 'block' and 'stroke' in x and 'inset' in x:
                raise ValueError('The book prints a reminder that a story is older than the '
                                 'tree records it covers, and the site cannot show it. Reread '
                                 'the story, run flyleaf coverage --mark-all, then build the '
                                 'book and the site again.')
            raise ValueError('Unknown compiler content fields: ' + repr(x)[:160])
        self.counts[f] += 1
        w = lambda y: self.walk(y, stream)
        if f in {'text', 'symbol'}:
            assert isinstance(x['text'], str) and '⟦' not in x['text']
            return x['text']
        if f == 'raw':  # `raw text` in a story; the guide has no block form
            assert x['block'] is False and isinstance(x['text'], str) and '⟦' not in x['text']
            return x['text']
        if f == 'smartquote':
            assert isinstance(x['double'], bool)
            return '"' if x['double'] else "'"
        if f == 'styled':
            assert x['styles'] == '..'
            return w(x['child'])
        if f == 'sequence':
            parts = x['children']
            # Two print divider pages become web headings. Their wording is
            # preserved; only documented casing and the separator differ.
            if any(c.get('label') == '<part-title>' for c in parts):
                text = ''.join(w(c) for c in parts)
                text = norm(text)
                allowed = {'PART I The Narrative': 'Part I — The Narrative',
                           'PART II The Genealogical Register':
                           'Part II — The Genealogical Register'}
                if text not in allowed:
                    raise ValueError('Unknown print/web divider transformation: ' + text)
                return ' ' + allowed[text] + ' '
            return ''.join(w(c) for c in parts)
        if f in {'space', 'parbreak', 'linebreak', 'v', 'h', 'pagebreak'}:
            return ' '
        if f == 'counter-update':
            assert x['key'] == 'page'
            return ''
        if f == 'outline':
            assert x == {'func': 'outline', 'depth': 2, 'indent': '0% + 1em'}
            return ''  # Navigation is checked separately against headings.
        if f == 'metadata':
            if x['value'] is None:
                assert (x.get('label') in NULL_METADATA
                        or x.get('label') in continuous_openings())
                return ''
            return meta(x['label'], x['value'])
        if f == 'footnote':
            assert stream == 0
            n = len(self.notes) + 1
            self.links.append([])
            self.notes.append(self.walk(x['body'], n))
            return mark('NOTE', n)
        if f in {'link', 'ref'}:
            dest = x['dest'] if f == 'link' else x['target']
            assert isinstance(dest, str)
            dest = '#' + dest[1:-1] if dest.startswith('<') and dest.endswith('>') else dest
            form = x.get('form', 'normal')
            assert form in {'normal', 'page'}
            self.links[stream].append({'kind': f, 'dest': dest, 'form': form})
            if f == 'ref':
                return mark('REF', form + ':' + dest)
            return mark('LINK', dest) + w(x['body']) + mark('/LINK')
        if f == 'figure':
            kind = x.get('kind', 'image')
            assert kind in {'image', 'family-chart'}
            self.figure_numbers[kind] += 1
            n = self.figure_numbers[kind]
            label = ('Chart' if kind == 'family-chart' else 'Figure') + ' ' + str(n)
            if kind == 'family-chart':
                assert x['supplement'] == {'func': 'text', 'text': 'Chart'}
                self.figures['#' + x['label'][1:-1]] = label
            self.figure_order.append(label)
            identity = x.get('label')
            assert identity is None or re.fullmatch(r'<[a-z0-9-]+>', identity)
            self.figure_labels.append(identity[1:-1] if identity else None)
            return ' ' + w(x['body']) + ' ' + label + ': ' + w(x['caption']) + ' '
        if f == 'image':
            assert isinstance(x['source'], str) and x['source'].startswith('/')
            self.images.append(x['source'][1:])
            return ''  # Exact source bytes/inventory are an independent gate.
        if f == 'table':
            assert x['columns'] == ['auto', '1.4fr', '1fr', '1fr']
            assert not self.in_table
            self.in_table = True
            result = ' ' + ''.join(w(c) for c in x['children']) + ' '
            self.in_table = False
            return result
        if f == 'header':
            return ''.join(w(c) for c in x['children'])
        if f == 'cell':
            self.cells += 1
            if self.in_table:
                self.table_cells += 1
                return mark('CELL', self.table_cells) + w(x['body']) + mark('/CELL')
            return ' ' + w(x['body']) + ' '
        if f == 'grid':
            return ' ' + ''.join(w(c) for c in x['children']) + ' '
        if f == 'heading':
            assert isinstance(x['depth'], int) and 1 <= x['depth'] <= 5
            label = x.get('label')
            assert label is None or re.fullmatch(r'<[a-z0-9-]+>', label)
            body = w(x['body'])
            self.headings.append({'level': x['depth'] + 1,
                                  'label': label[1:-1] if label else None,
                                  'tokens': tokens(body)})
            return ' ' + body + ' '
        if f in {'block', 'align', 'columns', 'item'}:
            return ' ' + w(x['body']) + ' '
        if f in {'emph', 'strong', 'super', 'smallcaps', 'caption'}:
            return w(x['body'])
        raise ValueError('Unhandled compiler node: ' + f)


@dataclass
class Node:
    tag: str
    attrs: dict = field(default_factory=dict)
    children: list = field(default_factory=list)

    def all(self):
        yield self
        for c in self.children:
            if isinstance(c, Node):
                yield from c.all()

    def text(self):
        return ''.join(c if isinstance(c, str) else c.text() for c in self.children)


class Parser(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.root = Node('root')
        self.stack = [self.root]
        self.feed(text)
        self.close()
        assert len(self.stack) == 1

    def handle_starttag(self, tag, attrs):
        assert len(dict(attrs)) == len(attrs)
        n = Node(tag, dict(attrs))
        self.stack[-1].children.append(n)
        if tag not in {'img', 'br', 'meta'}:
            self.stack.append(n)

    def handle_endtag(self, tag):
        assert len(self.stack) > 1 and self.stack[-1].tag == tag
        self.stack.pop()

    def handle_data(self, data):
        self.stack[-1].children.append(data)


class Actual:
    def __init__(self, html, expected, normalize_note_ids=False):
        self.expected = expected
        self.root = Parser(html).root
        self.normalized_note_ids = []
        if normalize_note_ids:
            for parent in self.root.all():
                for i, node in enumerate(parent.children):
                    if not isinstance(node, Node) or node.attrs.get('role') != 'doc-noteref' or 'id' in node.attrs:
                        continue
                    previous = parent.children[i-1] if i else None
                    assert isinstance(previous, Node) and previous.tag == 'span'
                    assert set(previous.attrs) == {'id'} and previous.children
                    assert all(isinstance(c, str) and not c.strip() for c in previous.children)
                    node.attrs['id'] = previous.attrs.pop('id')
                    self.normalized_note_ids.append(node.attrs['id'])
        nodes = list(self.root.all())
        self.by_id = {n.attrs['id']: n for n in nodes if 'id' in n.attrs}
        assert len(self.by_id) == sum('id' in n.attrs for n in nodes)
        self.note_refs = []
        self.seen_links = Counter()
        self.page_refs = []
        self.table_cells = 0
        self.headings = []
        self.figure_labels = []
        self.main = self.walk(self.root, 0)
        # A book with no footnotes has no notes section.
        sections = [n for n in nodes if n.attrs.get('role') == 'doc-endnotes']
        assert len(sections) == 1 or (not sections and not expected.notes)
        entries = [n for n in sections[0].all() if n.tag == 'li'] if sections else []
        assert len(entries) == len(expected.notes) == len(self.note_refs)
        self.notes = []
        for i, (entry, reference) in enumerate(zip(entries, self.note_refs), 1):
            assert reference.attrs['href'] == '#' + entry.attrs['id']
            back = [n for n in entry.all() if n.attrs.get('role') == 'doc-backlink']
            assert len(back) == 1 and back[0].attrs['href'] == '#' + reference.attrs['id']
            assert norm(back[0].text()) == norm(reference.text()) == str(i)
            self.notes.append(self.walk(entry, i))
        assert all(self.seen_links[i] == len(links) for i, links in enumerate(expected.links))
        assert self.table_cells == expected.table_cells

    def walk(self, x, stream):
        if isinstance(x, str):
            assert '⟦' not in x
            return x
        assert x.tag in {'root', 'html', 'head', 'title', 'meta', 'body', 'p', 'h1', 'h2',
            'h3', 'h4', 'h5', 'h6', 'nav', 'ol', 'ul', 'li', 'a', 'div', 'strong',
            'em', 'sup', 'sub', 'figure', 'img', 'figcaption', 'span', 'table',
            'thead', 'tbody', 'tr', 'th', 'td', 'br', 'section', 'code'}
        role = x.attrs.get('role')
        if role in {'doc-toc', 'doc-endnotes', 'doc-backlink'} or x.tag == 'head':
            return ''
        if role == 'doc-noteref':
            assert stream == 0 and x.tag == 'a'
            self.note_refs.append(x)
            return mark('NOTE', len(self.note_refs))
        assert role is None
        w = lambda y: self.walk(y, stream)
        if 'data-book-person' in x.attrs:
            assert not x.children
            return meta('<bibliography-use>', {'person': x.attrs['data-book-person'],
                                              'key': x.attrs['data-book-key']})
        if 'data-register-person' in x.attrs:
            assert not x.children
            return meta('<register-source>', {'refn': x.attrs['data-register-person'],
                                             'key': x.attrs['data-register-key']})
        if 'data-bibliography-entry' in x.attrs:
            assert not x.children
            return meta('<bibliography-entry>', x.attrs['data-bibliography-entry'])
        if x.tag == 'a' and 'data-book-image' not in x.attrs:
            i = self.seen_links[stream]
            assert i < len(self.expected.links[stream]), 'Unexpected HTML link'
            e = self.expected.links[stream][i]
            self.seen_links[stream] += 1
            assert x.attrs['href'] == e['dest'], ('link target', stream, i, x.attrs, e)
            if e['kind'] == 'ref':
                if e['form'] == 'normal':
                    assert norm(x.text()) == self.expected.figures[e['dest']]
                else:
                    # Exact target and position are checked here. The checked
                    # web adapter validates the replacement label separately.
                    assert norm(x.text())
                    self.page_refs.append({'target': e['dest'], 'display': norm(x.text())})
                return mark('REF', e['form'] + ':' + e['dest'])
            return mark('LINK', e['dest']) + ''.join(w(c) for c in x.children) + mark('/LINK')
        if x.tag == 'img':
            return ''
        if x.tag == 'figure':
            self.figure_labels.append(x.attrs.get('id'))
        if x.tag == 'br':
            return ' '
        if x.tag in {'td', 'th'}:
            self.table_cells += 1
            return mark('CELL', self.table_cells) + ''.join(w(c) for c in x.children) + mark('/CELL')
        text = ''.join(w(c) for c in x.children)
        # Compiler headings carry IDs. Only the explicit title/contents/part
        # chrome is unlabelled; losing an ordinary ID therefore fails the count.
        if x.tag in {'h1', 'h2', 'h3', 'h4', 'h5', 'h6'} and 'id' in x.attrs:
            self.headings.append({'level': int(x.tag[1]), 'label': x.attrs['id'],
                                  'tokens': tokens(text)})
        if x.tag in {'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'li',
                     'figure', 'figcaption', 'th', 'td', 'table', 'tr', 'section'}:
            return ' ' + text + ' '
        return text


def compare(expected, actual):
    # Typst's HTML may leave out the id of a labelled figure nothing links to,
    # such as a chapter's only chart. Any id it does write must be the right one.
    linked = {link['dest'][1:] for stream in expected.links for link in stream
              if link['dest'].startswith('#')}
    if (len(expected.figure_labels) != len(actual.figure_labels)
            or any(label != found and (found is not None or label in linked)
                   for label, found in zip(expected.figure_labels, actual.figure_labels))):
        raise ValueError('Ordered compiler figure identities differ from HTML')
    if len(expected.headings) != len(actual.headings):
        raise ValueError('Complete compiler heading inventory differs from HTML')
    for index, (left, right) in enumerate(zip(expected.headings, actual.headings)):
        if (left['level'] != right['level'] or left['tokens'] != right['tokens']
                or (left['label'] is not None and left['label'] != right['label'])):
            raise ValueError('Compiler heading hierarchy/identity differs: ' +
                             json.dumps({'index': index, 'expected': left, 'actual': right}))
    rows = []
    for label, a, b in [('main', expected.main, actual.main)] + [
            ('note-' + str(i), a, b) for i, (a, b) in enumerate(zip(expected.notes, actual.notes), 1)]:
        left, right = tokens(a), tokens(b)
        if left != right:
            at = next((i for i, pair in enumerate(zip(left, right)) if pair[0] != pair[1]), min(len(left), len(right)))
            raise ValueError(json.dumps({'stream': label, 'index': at,
                'expected': left[max(0, at-12):at+16], 'actual': right[max(0, at-12):at+16],
                'expectedTokens': len(left), 'actualTokens': len(right)}, ensure_ascii=False))
        rows.append({'stream': label, 'tokens': len(left)})
    return {'complete': True, 'streams': len(rows), 'mainTokens': rows[0]['tokens'],
            'noteTokens': sum(x['tokens'] for x in rows[1:]), 'notes': len(expected.notes),
            'compilerNodes': dict(expected.counts), 'orderedLinks': sum(map(len, expected.links)),
            'orderedTableCells': expected.table_cells,
            'orderedHeadings': len(expected.headings),
            'normalizedAdjacentWhitespaceNoteIds': len(actual.normalized_note_ids),
            'pageReferenceLabelsCheckedSeparately': len(actual.page_refs), 'rows': rows}
