"""Bind the reviewed headings, captions, register and apparatus to actual HTML.

This prepares inputs for the same Unicode selector and atomic mutation engine
used by prose. It never guesses a named person from a citation or a photograph.
Optional: used only for a book-annotations.json part named non-prose.
"""
from collections import defaultdict
from copy import deepcopy
from hashlib import sha256
import re

from website_book_annotations import Passage, character_map, normalized, require


def visible(node):
    return normalized(node.text({'doc-noteref'}))


def links(node):
    return [{'href': n.attrs.get('href', ''), 'text': visible(n),
             'role': n.attrs.get('role'), 'image': 'data-book-image' in n.attrs}
            for n in node.nodes() if n.tag == 'a']


def index_blocks(body, authored):
    nodes = list(body.nodes())
    parents = {id(c): n for n in nodes for c in n.children if not isinstance(c, str)}
    context = {}
    chapter = section = 'title-page'
    for node in nodes:
        if node.tag in {'h2', 'h3'} and node.attrs.get('id'):
            section = node.attrs['id']
            if node.tag == 'h2':
                chapter = section
        context[id(node)] = chapter, section
    indexed = {}

    def add(ident, node, kind, children=None, **fields):
        ch, sec = context[id(node)]
        children = list(enumerate(node.children)) if children is None else list(children)
        quote = normalized(''.join(c if isinstance(c, str) else c.text({'doc-noteref'})
                                   for _, c in children))
        row = {'id': ident, 'kind': kind, 'chapter': ch, 'section': sec,
               'quote': quote, 'sha256': sha256(quote.encode()).hexdigest(), **fields}
        indexed[ident] = row, Passage(node, children, ch, sec, quote)

    headings = [n for n in nodes if re.fullmatch('h[1-6]', n.tag) and
                parents.get(id(n), body).attrs.get('role') != 'doc-toc']
    for i, node in enumerate(headings, 1):
        kind = ('authored-heading' if context[id(node)][0] in authored and
                node.tag in {'h1', 'h2', 'h3'} else 'generated-heading')
        add(f'NP-H{i:03}', node, kind, elementId=node.attrs.get('id'), assetPaths=[], tag=node.tag)
    figures = [n for n in nodes if n.tag == 'figure']
    for i, figure in enumerate(figures, 1):
        captions = [n for n in figure.nodes() if n.tag == 'figcaption']
        require(len(captions) == 1, 'A reviewed figure must have exactly one caption')
        add(f'NP-F{i:03}', captions[0],
            'chart-caption' if figure.attrs.get('class') == 'native-book-chart' else 'figure-caption',
            elementId=figure.attrs.get('id'),
            assetPaths=[n.attrs.get('data-book-original') for n in figure.nodes() if n.tag == 'img'])
    collateral = [n for n in nodes if n.attrs.get('id', '').startswith('reg-collateral-')]
    for i, marker in enumerate(collateral, 1):
        node = marker
        while node.tag not in {'p', 'div', 'li'} and id(node) in parents:
            node = parents[id(node)]
        add(f'NP-C{i:03}', node, 'collateral-entry', elementId=marker.attrs['id'])

    active_heading = None
    register_count = 0
    containers = {'root', 'body', 'p', 'div', 'li', 'ul', 'ol'}
    boundaries = {'h2', 'h3', 'h4', 'p', 'div', 'li', 'ul', 'ol'}

    def register_walk(node):
        nonlocal active_heading, register_count
        if isinstance(node, str):
            require(not node.strip(), 'Unaccounted register text outside a block')
            return
        if node.tag == 'h4':
            active_heading = node.attrs['id']
            return
        if node.tag in {'h2', 'h3'}:
            return
        require(node.tag in containers, f'Unreviewed register element: {node.tag}')
        inline = []

        def flush():
            nonlocal register_count
            text = normalized(''.join(c if isinstance(c, str) else c.text({'doc-noteref'})
                                      for _, c in inline))
            if text:
                register_count += 1
                add(f'NP-R{register_count:03}', node, 'register-block', inline,
                    registerHeading=active_heading, containerTag=node.tag)
            inline.clear()

        for i, child in enumerate(node.children):
            if not isinstance(child, str) and child.tag in boundaries:
                flush()
                register_walk(child)
            else:
                inline.append((i, child))
        flush()

    in_register = False
    for node in body.children:
        if isinstance(node, str):
            continue
        if node.tag == 'h2':
            in_register = node.attrs.get('id', '').startswith('reg-ch-')
        if in_register:
            register_walk(node)
    return indexed


def prepare_nonprose(body, part, prose, authored, locations):
    """Validate complete lane coverage and return merged, exact block proposals."""
    indexed = index_blocks(body, authored)
    associations, coverage = part['associations'], part['coverage']
    preserved, guards = part['preserved'], part['guards']
    nodes = list(body.nodes())
    anchors = {n.attrs['id']: n for n in nodes if 'id' in n.attrs}
    expected_links = deepcopy(preserved['links'])
    for correction in part['corrections']['links']:
        before, after = correction['before'], correction['after']
        found = [i for i, row in enumerate(expected_links) if row == before]
        require(len(found) == 1 and {k: v for k, v in before.items() if k != 'href'} ==
                {k: v for k, v in after.items() if k != 'href'},
                'Register destination correction must bind one unchanged link label')
        expected_links[found[0]] = after
    require(links(body) == expected_links, 'Existing Book/source/image links changed from reviewed inventory')
    figures = [n for n in nodes if n.tag == 'figure']
    require(len(figures) == len(preserved['figures']), 'Complete figure-control inventory changed')
    for i, (figure, witness) in enumerate(zip(figures, preserved['figures']), 1):
        captions = [n for n in figure.nodes() if n.tag == 'figcaption']
        require(len(captions) == 1 and witness['id'] == f'NP-F{i:03}', 'Figure identity changed')
        caption = captions[0]
        mapping = character_map(Passage(caption, list(enumerate(caption.children)), '', '', visible(caption)))
        caption_links = []
        for link in caption.nodes():
            if link.tag != 'a' or link.attrs.get('role') == 'doc-noteref':
                continue
            positions = [j for j, point in enumerate(mapping) if any(n is link for n in point[4])]
            caption_links.append({'text': visible(link), 'href': link.attrs.get('href', ''),
                'role': link.attrs.get('role'), 'start': min(positions) if positions else None,
                'end': max(positions) + 1 if positions else None})
        require([n.attrs.get('data-book-original') for n in figure.nodes() if n.tag == 'img'] == witness['assetPaths'] and
                [n.attrs for n in figure.nodes() if n.tag == 'a' and 'data-book-image' in n.attrs] == witness['imageLinks'] and
                caption_links == witness['captionLinks'], f"{witness['id']}: figure or caption controls changed")

    known = preserved['ahnentafelKnownRows']
    unknown = preserved['ahnentafelUnknownNumbers']
    known_by_number = {r['number']: r for r in known}
    require(len(known_by_number) == len(known) and len(set(unknown)) == len(unknown) and
            not set(unknown) & set(known_by_number), 'Conflicting reviewed ancestor-table numbers')
    # The book splits the table so its last rows stay with the closing note;
    # the parts are read in order as one table.
    tables = [n for n in nodes if n.tag == 'table']
    require(bool(tables) == bool(known or unknown), 'Complete ancestor-table inventory changed')
    if tables:
        table_rows = [n for table in tables for n in table.nodes() if n.tag == 'tr']
        numbers = sorted([*known_by_number, *unknown], key=int)
        require(len(table_rows) == len(numbers) + 1, 'Ancestor-table row count changed')
        cells = lambda row: [visible(n) for n in row.children if not isinstance(n, str) and n.tag in {'th', 'td'}]
        require(cells(table_rows[0]) == ['no.', 'person', 'born', 'died'], 'Ancestor-table columns changed')
        for number, row in zip(numbers, table_rows[1:]):
            witness = known_by_number.get(number)
            if witness:
                require(witness['href'] == '#reg-' + witness['refn'] and cells(row) == witness['quote'] and
                        links(row) == [{'href': witness['href'], 'text': witness['quote'][1],
                                        'role': None, 'image': False}], 'Known ancestor-table identity or cells changed')
            else:
                require(cells(row) == [number, '_____ _____', '', ''] and not links(row),
                        'Unknown ancestor-table placeholder or dates changed')

    def bind(row, fields):
        require(row['id'] in indexed, f"{row['id']}: reviewed non-prose block is missing")
        current, block = indexed[row['id']]
        require(all(row.get(k) == current.get(k) for k in fields),
                f"{row['id']}: the book's words here changed since the reader links were "
                "reviewed. If the change is meant, build the site once with BOOK_REANCHOR=1 "
                "(docs/book.md, Reader links on the website)")
        return block

    # These are complete inventories, including the blocks whose decision is to
    # leave existing text/navigation alone. New headings cannot disappear merely
    # because a proposal list was shortened.
    for key, kind, fields in [
            ('registerBlocks', 'register-block', ('registerHeading', 'quote', 'sha256')),
            ('generatedHeadings', 'generated-heading', ('elementId', 'quote', 'sha256'))]:
        rows = coverage[key]
        require(len({r['id'] for r in rows}) == len(rows) and
                {r['id'] for r in rows} == {i for i, (r, _) in indexed.items() if r['kind'] == kind},
                f'Complete {kind} coverage changed')
        for row in rows:
            bind(row, fields)
    displayed = associations['authoredHeadingsAndCaptions']
    require(len({r['id'] for r in displayed}) == len(displayed) and
            {r['id'] for r in displayed} == {i for i, (r, _) in indexed.items()
              if r['kind'] in {'authored-heading', 'figure-caption', 'chart-caption'}},
            'Complete heading/caption coverage changed')

    matched, aliases, physical = {}, {}, {}
    rows = [*displayed, *associations['registerPeople'], *associations['registerPlaces']]
    for row in rows:
        fields = ['kind', 'chapter', 'section', 'quote', 'sha256']
        fields += [k for k in ('elementId', 'assetPaths', 'registerHeading', 'containerTag') if k in row]
        block = bind(row, fields)
        key = id(block.node), tuple(i for i, _ in block.children)
        ident = physical.setdefault(key, row['id'])
        require(row['id'] not in aliases or aliases[row['id']] == ident, 'Conflicting non-prose block alias')
        aliases[row['id']] = ident
        if ident not in matched:
            matched[ident] = ({**deepcopy(row), 'associations': []}, block)
        target = matched[ident][0]
        require(target['quote'] == row['quote'], 'Overlapping block views have different text')
        target['associations'].extend(deepcopy(row['associations']))
    anchor_people = {i for i, (row, _) in indexed.items()
                     if row['kind'] == 'collateral-entry' or row['kind'] == 'generated-heading'
                     and row.get('tag') == 'h4' and (row.get('elementId') or '').startswith('reg-')}
    require(anchor_people <= {r['id'] for r in associations['registerPeople']},
            'A complete register identity has lost its profile entrypoint')

    protected = defaultdict(list)
    guard_count = 0

    def protect(ident, text, kind, **fields):
        nonlocal guard_count
        protected[aliases[ident]].append({'text': text, 'kind': kind, **fields})
        guard_count += 1

    for guard in guards['captionGuards']:
        ident = guard['blockId']
        require(ident in aliases, 'Caption guard has lost its block')
        row = matched[aliases[ident]][0]
        require((row['quote'], row['sha256'], row.get('assetPaths')) ==
                (guard['quote'], guard['sha256'], guard['assetPaths']), 'Caption context changed')
        protect(ident, guard['quote'], 'caption')
    require({g['blockId'] for g in guards['captionGuards']} ==
            {i for i, (r, _) in indexed.items() if r['kind'] in {'figure-caption', 'chart-caption'}},
            'Every complete caption is required preview context')
    for guard in guards['crossPassageGuards']:
        witness = prose.get(guard['passageId'])
        require(witness and (witness[0]['section'], witness[0]['quote'], witness[0]['sha256']) ==
                (guard['section'], guard['quote'], guard['sha256']), 'Cross-passage qualification changed')
        protect(guard['blockId'], guard['quote'], 'other-bound-passage')

    def note_witness(row):
        note = anchors.get(row['id'])
        require(note is not None, f"Required note is missing: {row['id']}")
        quote = normalized(note.text({'doc-noteref', 'doc-backlink'}))
        require(quote == row['quote'] and sha256(quote.encode()).hexdigest() == row['sha256'],
                f"Required note wording changed: {row['id']}")
        return note

    for guard in guards['unmarkedEndnoteGuards']:
        note_witness(guard)
        guard_count += 1

    # Optional selected source-note witnesses. A collateral entry and its
    # register view may index one physical block; neither creates another note.
    linked = guards.get('linkedNoteGuards', [])
    require(isinstance(linked, list), 'Linked note guards must be a list')
    linked_ids, linked_physical = set(), set()
    source_groups = {}
    source_heading = None
    for node in nodes:
        if re.fullmatch('h[1-4]', node.tag):
            source_heading = (node if node.tag == 'h4' and
                              node.attrs.get('id', '').startswith('sources-') else None)
        source_groups[id(node)] = source_heading
    for guard in linked:
        gid, ident = guard['id'], guard['blockId']
        require(isinstance(gid, str) and gid and gid not in linked_ids,
                'Duplicate or missing linked note guard identity')
        linked_ids.add(gid)
        require(ident in indexed, f'{gid}: linked note block is missing')
        current, block = indexed[ident]
        require((guard['blockQuote'], guard['blockSha256']) ==
                (current['quote'], current['sha256']), f'{gid}: linked note block changed')
        canonical = physical.get((id(block.node), tuple(i for i, _ in block.children)))
        require(canonical in matched, f'{gid}: linked note block has lost its reviewed view')
        witness = guard['noteWitness']
        require(sum(n.attrs.get('id') == witness['id'] for n in nodes) == 1,
                f"Required note missing or duplicated: {witness['id']}")
        note = note_witness(witness)
        markers = [{'person': n.attrs['data-book-person'], 'key': n.attrs.get('data-book-key')}
                   for n in note.nodes() if 'data-book-person' in n.attrs]
        require(markers and markers == witness['markers'] and
                all(isinstance(m.get(k), str) and m[k] for m in markers for k in ('person', 'key')),
                f'{gid}: linked note source-use changed')
        if 'existingLinks' in witness:
            require([{k: link[k] for k in ('text', 'href', 'role')} for link in links(note)] ==
                    witness['existingLinks'], f'{gid}: linked note source links changed')
        controls = [n for _, child in block.children if not isinstance(child, str)
                    for n in child.nodes() if n.tag == 'a']
        mode = guard['attachment']
        if mode == 'footnote':
            require(guard.get('sourceAnchor') is None and
                    any(n.attrs.get('role') == 'doc-noteref' and
                        n.attrs.get('href') == '#' + witness['id'] for n in controls),
                    f'{gid}: linked note attachment changed')
        elif mode == 'source-apparatus':
            anchor = guard['sourceAnchor']
            require(isinstance(anchor, str) and anchor.startswith('sources-') and
                    any(n.attrs.get('role') != 'doc-noteref' and
                        n.attrs.get('href') == '#' + anchor for n in controls),
                    f'{gid}: source note navigation changed')
            heading = anchors.get(anchor)
            require(heading is not None and heading.tag == 'h4' and
                    sum(n.attrs.get('id') == anchor for n in nodes) == 1 and
                    source_groups[id(note)] is heading,
                    f'{gid}: source note heading/group changed')
            require(all(m['person'] == anchor[len('sources-'):] for m in markers),
                    f'{gid}: source note owner changed')
            register_markers = [{'person': n.attrs['data-register-person'],
                                 'key': n.attrs.get('data-register-key')}
                                for n in note.nodes() if 'data-register-person' in n.attrs]
            require(not register_markers or register_markers == markers,
                    f'{gid}: source note source-use changed')
        else:
            raise ValueError(f'{gid}: unsupported linked note attachment: {mode}')
        physical_note = canonical, witness['id']
        if physical_note not in linked_physical:
            protect(canonical, witness['quote'], 'linked-native-note', note=witness['id'])
            linked_physical.add(physical_note)

    for row in associations['registerPlaces']:
        _, block = matched[aliases[row['id']]]
        refs = [n.attrs['href'][1:] for _, child in block.children if not isinstance(child, str)
                for n in child.nodes() if n.attrs.get('role') == 'doc-noteref']
        require(refs == row['noteIds'], f"{row['id']}: attached register note relationship changed")
        require([n['id'] for n in row['requiredNoteWitnesses']] == refs,
                f"{row['id']}: a complete register qualification is missing")
        for witness in row['requiredNoteWitnesses']:
            note = note_witness(witness)
            markers = [{'person': n.attrs['data-book-person'], 'key': n.attrs.get('data-book-key')}
                       for n in note.nodes() if 'data-book-person' in n.attrs]
            require(markers == witness['markers'], f"{row['id']}: register note source-use changed")
            protect(row['id'], witness['quote'], 'linked-native-note', note=witness['id'])
        protect(row['id'], row['quote'], 'register-context')

    contexts = []
    for key, value in part['contexts']['locationRecords'].items():
        require(locations.get(key) == value, f'Book locality reference changed: {key}')
    for context in part['contexts']['mentions']:
        ident = context['blockId']
        require(ident in aliases, 'Non-prose locality context has lost its block')
        contexts.append({**context, 'passageId': aliases[ident]})
    return matched, protected, contexts, {
        'reviewedHeadingsAndCaptions': len(displayed),
        'registerBlocks': len(coverage['registerBlocks']),
        'generatedHeadings': len(coverage['generatedHeadings']),
        'existingLinks': len(expected_links), 'guards': guard_count}
