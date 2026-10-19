"""Apply reviewed, passage-specific reader links without changing manuscript text.

Input offsets count decoded Unicode code points with whitespace collapsed and
footnote marker numbers omitted. We map them back to original text leaves; no
name matching, text replacement, or citation-owner inference is permitted.
This module is deliberately independent of the HTML parser and publication I/O.

Optional: it acts only when the family's site folder holds book-annotations.json.
Without it the site's book pages are plain, with no reader links.
"""
from collections import Counter, defaultdict
from copy import deepcopy
from dataclasses import dataclass
from datetime import date
from hashlib import sha256
import json
from pathlib import Path
import re


def require(condition, message):
    if not condition:
        raise ValueError(message)


def normalized(text):
    return ' '.join(text.split())


def content_digest(value):
    return sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                             separators=(',', ':')).encode()).hexdigest()


@dataclass(frozen=True)
class Catalogue:
    """Verified loader result. Any later in-memory content drift is rejected."""
    parts: tuple
    scope: dict
    inputs: tuple
    digest: str


NON_PROSE = 'non-prose'  # the manifest part for captions, charts and tables


def load_catalogue(manifest_path):
    """Read the complete reviewed source set from a reproducible checkout.

    The manifest lists parts by id. The part named non-prose holds captions,
    charts and tables; every other part holds prose. A family without a
    manifest has no reader annotations."""
    path = Path(manifest_path).resolve()
    if not path.is_file():
        return Catalogue((), {}, (), content_digest({'parts': [], 'scope': {}}))
    raw = path.read_bytes()
    manifest = json.loads(raw)
    require(manifest.get('schema') == 1, 'Unsupported annotation manifest')
    rows = manifest.get('parts')
    ids = [row.get('id') for row in rows] if isinstance(rows, list) else []
    require(ids and len(ids) == len(set(ids)) and
            all(isinstance(i, str) and re.fullmatch('[a-z0-9-]+', i) for i in ids),
            'Annotation manifest must list each reviewed part exactly once')
    parts, inputs = [], [(str(path), sha256(raw).hexdigest())]
    for row in rows:
        names = ({'associations': 'associations.json', 'guards': 'required-context.json',
                  'contexts': 'book-only-locations.json', 'coverage': 'coverage.json',
                  'preserved': 'preserve-existing.json', 'corrections': 'destination-corrections.json'}
                 if row['id'] == NON_PROSE else
                 {'associations': 'associations.json', 'guards': 'qualification-guards.json',
                  'contexts': 'book-only-locations.json'})
        require(isinstance(row.get('sources'), dict) and set(row['sources']) == set(names),
                'Annotation manifest must include every reviewed source exactly once')
        part = {'review': row['id']}
        for key, filename in names.items():
            source = row['sources'][key]
            relative = f"book-annotations/{row['id']}/{filename}"
            require(source.get('path') == relative and
                    re.fullmatch('[a-f0-9]{64}', source.get('sha256', '')),
                    'Unexpected annotation source path or digest')
            target = path.parent / relative
            require(target.resolve() == target and target.is_file(),
                    'Annotation source must be a regular file under the content directory')
            data = target.read_bytes()
            require(sha256(data).hexdigest() == source['sha256'], f'Annotation source changed: {relative}')
            part[key] = json.loads(data)
            inputs.append((str(target), source['sha256']))
        parts.append(part)
    scope = manifest.get('scope')
    require(isinstance(scope, dict), 'Annotation manifest needs a reviewed chapter inventory')
    return Catalogue(tuple(parts), scope, tuple(inputs), content_digest({'parts': parts, 'scope': scope}))


@dataclass
class Passage:
    node: object
    children: list
    chapter: str
    section: str
    quote: str


def passages(body):
    """Index prose runs, keeping headings/captions/tables/apparatus separate."""
    result = []
    chapter = section = 'title-page'
    blocks = {'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'figure',
              'table', 'ol', 'ul', 'li', 'blockquote', 'nav', 'section'}

    def walk(node):
        nonlocal chapter, section
        if isinstance(node, str):
            require(not node.strip(), 'Unaccounted prose outside an element')
            return
        if re.fullmatch('h[1-6]', node.tag):
            if node.attrs.get('id'):
                section = node.attrs['id']
                if node.tag in {'h1', 'h2'}:
                    chapter = section
            return
        if node.tag in {'nav', 'figure', 'table'} or node.attrs.get('role') == 'doc-endnotes':
            return
        if node.tag not in {'p', 'div', 'root', 'body', 'li', 'ol', 'ul', 'blockquote'}:
            return
        inline = []

        def flush():
            if inline:
                text = ''.join(child if isinstance(child, str) else
                               child.text({'doc-noteref'}) for _, child in inline)
                quote = normalized(text)
                if quote:
                    result.append(Passage(node, list(inline), chapter, section, quote))
                inline.clear()

        for index, child in enumerate(node.children):
            if not isinstance(child, str) and child.tag in blocks:
                flush()
                walk(child)
            else:
                inline.append((index, child))
        flush()

    walk(body)
    return result


def character_map(passage):
    """A normalized code point maps to its original leaf and ancestor links."""
    raw = []

    def walk(parent, index, child, links, ancestors):
        if isinstance(child, str):
            raw.extend((char, parent, index, offset, links, ancestors)
                       for offset, char in enumerate(child))
        elif child.attrs.get('role') != 'doc-noteref':
            nested = links + ([child] if child.tag == 'a' else [])
            for i, value in enumerate(child.children):
                walk(child, i, value, nested, ancestors + [child])

    for index, child in passage.children:
        walk(passage.node, index, child, [], [passage.node])
    result = []
    whitespace = None
    for item in raw:
        if item[0].isspace():
            if result and whitespace is None:
                whitespace = (' ', *item[1:])
        else:
            if whitespace:
                result.append(whitespace)
                whitespace = None
            result.append(item)
    require(''.join(item[0] for item in result) == passage.quote,
            'Internal normalized character map differs from passage')
    return result


def inline_range(chosen, label):
    """Wrap complete inline formatting nodes; never split or clone their IDs."""
    first, last = chosen[0], chosen[-1]
    common = first[5]
    for item in chosen[1:]:
        common = common[:next((i for i, pair in enumerate(zip(common, item[5]))
                               if pair[0] is not pair[1]), min(len(common), len(item[5])))]
    require(common and all(not item[4] for item in chosen), f'{label}: crosses an existing link')
    parent = common[-1]

    def boundary(item, ending):
        if item[1] is parent:
            index, offset = item[2], item[3] + int(ending)
            if ending and offset == len(parent.children[index]):
                return index + 1, 0
            return index, offset
        child = item[5][len(common)]
        index = next(i for i, value in enumerate(parent.children) if value is child)
        # Every original character of this formatting element must be selected.
        # This permits <em>14b</em> Harbour Row without flattening the italic
        # address suffix, while rejecting a partially selected styled element.
        inside = [point for point in chosen if any(a is child for a in point[5])]
        actual = ''.join(point[0] for point in inside)
        require(normalized(child.text()) == actual and all(
            n.tag in {'em', 'strong', 'span', 'sup', 'sub'} and
            not set(n.attrs) - {'style'} for n in child.nodes()),
            f'{label}: partially selected or semantic inline element')
        return (index + 1, 0) if ending else (index, 0)

    start, end = boundary(first, False), boundary(last, True)
    for child in parent.children[start[0]:end[0]]:
        if not isinstance(child, str):
            require(all(n.tag in {'em', 'strong', 'span', 'sup', 'sub'} and
                        not set(n.attrs) - {'style'} for n in child.nodes()),
                    f'{label}: cannot enclose a citation, link or semantic marker')
    return parent, start, end


def child_slice(children, start, end):
    """Select a half-open range of original children and text offsets."""
    result = []
    for index in range(start[0], min(end[0] + 1, len(children))):
        child = children[index]
        left = start[1] if index == start[0] else 0
        right = end[1] if index == end[0] else None
        if index == end[0] and right == 0:
            break
        if isinstance(child, str):
            text = child[left:right]
            if text:
                result.append(text)
        else:
            require(left == 0 and right is None, 'Attempt to split an element')
            result.append(child)
    return result


def selected_span(quote, selector, label):
    start, end = selector.get('start'), selector.get('end')
    exact = selector.get('exact')
    require(type(start) is int and type(end) is int and 0 <= start < end <= len(quote),
            f'{label}: invalid Unicode selector range')
    require(isinstance(exact, str) and quote[start:end] == exact,
            f'{label}: selector text changed')
    positions = [m.start() for m in re.finditer(re.escape(exact), quote)]
    require(type(selector.get('occurrence')) is int and
            1 <= selector['occurrence'] <= len(positions) and
            positions[selector['occurrence'] - 1] == start,
            f'{label}: selector occurrence changed')
    prefix, suffix = selector.get('prefix'), selector.get('suffix')
    require(isinstance(prefix, str) and isinstance(suffix, str) and
            quote[:start].endswith(prefix) and quote[end:].startswith(suffix),
            f'{label}: selector context changed')
    return start, end


# How a book writes its edition date: "17 October 2026" now, and
# "October 17, 2026" in books built before Flyleaf 0.1. A reviewed passage
# may hold either; the book's own text decides which one it prints.
DATE_STYLES = {'full-date': ('{day} %B %Y', '%B %d, %Y'), 'month-year': ('%B %Y',)}


def written_date(day, style):
    return day.strftime(style.replace('{day}', str(day.day)))


def resolve_edition_dates(proposals, edition_date, printed=lambda passage, quote: True):
    """Resolve explicitly reviewed publication-date spans, never historical dates.

    Only annotation selectors change; the already compiled manuscript is read
    verbatim. A receipt supplies the edition date, not the current clock.
    Passages with reader links or withheld identities need a separate offset
    policy and cannot use this narrow generated-boilerplate declaration.
    printed(passage, quote) says whether the book holds that wording.
    """
    resolved, fields = [], []
    formats = DATE_STYLES
    for original in proposals:
        ident, quote = original['id'], original['quote']
        require(sha256(quote.encode()).hexdigest() == original['sha256'],
                f'{ident}: passage hash changed')
        if 'generatedEditionDate' not in original:
            resolved.append(original)
            continue
        field = original['generatedEditionDate']
        require(isinstance(field, dict) and set(field) == {'reviewedDate', 'format', 'selector'} and
                field.get('format') in formats, f'{ident}: invalid generated edition-date declaration')
        require(not original['associations'] and not original.get('existingLinks') and
                not original.get('withheld'),
                f'{ident}: generated edition-date passage has reader identity selectors')
        for value in [field['reviewedDate'], edition_date]:
            require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', value),
                    f'{ident}: generated edition date requires an ISO date from the book receipt')
        try:
            reviewed, current = date.fromisoformat(field['reviewedDate']), date.fromisoformat(edition_date)
        except ValueError as error:
            raise ValueError(f'{ident}: invalid generated edition date') from error
        start, end = selected_span(quote, field['selector'], ident + ' edition date')
        styles = formats[field['format']]
        require(quote[start:end] in {written_date(reviewed, style) for style in styles},
                f'{ident}: reviewed edition-date value differs from its declared date and format')
        candidates = [quote[:start] + written_date(current, style) + quote[end:] for style in styles]
        p = deepcopy(original)
        p['quote'] = next((c for c in candidates if printed(original, c)), candidates[0])
        p['sha256'] = sha256(p['quote'].encode()).hexdigest()
        resolved.append(p)
        fields.append({'passage': ident, 'editionDate': edition_date, 'format': field['format'],
                       'reviewedSha256': original['sha256'], 'renderedSha256': p['sha256']})
    return resolved, fields


def _restore_html(node):
    """Remove just the added reader decorations, for exact manuscript parity."""
    if isinstance(node, str):
        return node
    clone = type(node)(node.tag, dict(node.attrs), [])
    for key in ('data-book-mention', 'data-book-passage', 'data-book-added-link'):
        clone.attrs.pop(key, None)
    for child in node.children:
        if not isinstance(child, str) and child.attrs.get('data-book-added-link') == 'true':
            clone.children.extend(_restore_html(value) for value in child.children)
        else:
            clone.children.append(_restore_html(child))
    return clone


def annotate(body, catalogue, people, geography, *, edition_date=None):
    """Validate all proposals first, then return compact reader metadata.

    people maps stable published REFN to the complete recorded GEDCOM NAME;
    geography is the same reviewed Places catalogue shipped with the site.
    Existing register links retain their destinations and gain a preview.
    """
    require(isinstance(catalogue, Catalogue), 'Use the verified annotation catalogue loader')
    require(content_digest({'parts': catalogue.parts, 'scope': catalogue.scope}) == catalogue.digest,
            'Reviewed annotation catalogue changed after loading')
    if not catalogue.parts and not catalogue.scope:  # no manifest: no annotations
        return {'schema': 1, 'passages': [], 'mentions': [],
                'counts': {'passages': 0, 'mentions': 0, 'kinds': {}, 'guards': 0}}
    destination = body
    body = deepcopy(body)
    original = body.html()
    nodes = list(body.nodes())
    require(not any(any(key in {'data-book-mention', 'data-book-passage', 'data-book-added-link'}
                        for key in node.attrs) for node in nodes),
            'Reader links must be applied only once')
    by_anchor = {n.attrs['id']: n for n in nodes if 'id' in n.attrs}
    locations = {x['id']: x for x in geography['locations']}
    places = {x['id']: x for x in geography['places']}
    indexed = defaultdict(list)
    for p in passages(body):
        indexed[p.chapter, p.section, p.quote].append(p)
    proposals, guards, contexts = [], [], []
    non_prose = None
    for part in catalogue.parts:
        if part.get('review') == NON_PROSE:
            require(non_prose is None, 'Duplicate non-prose catalogue')
            non_prose = part
            continue
        proposals.extend(part['associations']['passages'])
        guards.extend(part['guards']['guards'])
        contexts.extend(part['contexts']['mentions'])
        for key, value in part['contexts']['locationRecords'].items():
            require(locations.get(key) == value, f'Book locality reference changed: {key}')
    proposals, generated_dates = resolve_edition_dates(
        proposals, edition_date,
        lambda p, quote: len(indexed.get((p['chapter'], p['section'], quote), [])) == 1)
    ids = [p['id'] for p in proposals]
    require(len(ids) == len(set(ids)), 'Duplicate reviewed passage identity')
    authored = catalogue.scope.get('authoredChapters')
    separate = catalogue.scope.get('separateChapters')
    require(isinstance(authored, list) and authored and len(authored) == len(set(authored)) and
            all(isinstance(x, str) and x for x in authored) and isinstance(separate, list) and
            all(isinstance(x, dict) and set(x) == {'chapter', 'lane'} and
                isinstance(x['chapter'], str) and isinstance(x['lane'], str) and x['lane'] for x in separate),
            'Invalid reviewed chapter inventory')
    excluded = [x['chapter'] for x in separate]
    require(len(excluded) == len(set(excluded)) and not set(authored) & set(excluded),
            'Duplicate or conflicting reviewed chapter lanes')
    require({p['chapter'] for p in proposals} == set(authored),
            'Reviewed prose parts do not cover the complete authored chapter inventory')
    actual_chapters = {p.chapter for rows in indexed.values() for p in rows}
    actual_chapters.update(n.attrs['id'] for n in nodes if n.tag in {'h1', 'h2'} and n.attrs.get('id'))
    require(actual_chapters <= set(authored) | set(excluded),
            'Unreviewed chapter or prose lane: ' + ', '.join(sorted(actual_chapters - set(authored) - set(excluded))))
    matched = {}
    occupied = set()
    for p in proposals:
        ident, quote = p['id'], p['quote']
        require(all(a.get('kind') in {'person', 'place'} for a in p['associations']),
                f'{ident}: ordinary associations admit only people and literal places')
        require(sha256(quote.encode()).hexdigest() == p['sha256'], f'{ident}: passage hash changed')
        found = indexed[p['chapter'], p['section'], quote]
        require(len(found) == 1, f'{ident}: expected one exact passage, found {len(found)}')
        block = found[0]
        key = (id(block.node), tuple(i for i, _ in block.children))
        require(key not in occupied, f'{ident}: duplicate passage selectors')
        occupied.add(key)
        matched[ident] = (p, block)

    # An added/removed authored block requires a fresh content decision. Headings,
    # charts and apparatus have their own policy; they cannot silently join prose.
    actual = [p for rows in indexed.values() for p in rows if p.chapter in set(authored)]
    require(len(actual) == len(proposals), 'Authored prose coverage changed; review new/removed blocks')
    protected = defaultdict(list)
    lane_checks = {}
    if non_prose is not None:
        from website_book_nonprose import prepare_nonprose
        more, protection, localities, lane_checks = prepare_nonprose(
            body, non_prose, matched, set(authored), locations)
        require(not set(more) & set(matched), 'Prose/non-prose passage identities overlap')
        for ident, (p, block) in more.items():
            require(all(a.get('kind') in {'person', 'place'} for a in p['associations']),
                    f'{ident}: ordinary associations admit only people and literal places')
            key = id(block.node), tuple(i for i, _ in block.children)
            require(key not in occupied, f'{ident}: prose/non-prose block overlap')
            occupied.add(key)
        matched.update(more)
        protected.update(protection)
        contexts.extend(localities)
    for guard in guards:
        ident = guard['passageId']
        require(ident in matched, f'Guard targets unknown passage: {ident}')
        p, block = matched[ident]
        require(p['sha256'] == guard['passageSha256'], f'{ident}: qualification passage changed')
        kind = guard['kind']
        if kind == 'same-passage':
            witness = p['quote']
        elif kind == 'other-bound-passage':
            other = matched.get(guard['witnessPassageId'])
            require(other and other[0]['sha256'] == guard['witnessPassageSha256'],
                    f'{ident}: qualification witness changed')
            witness = other[0]['quote']
        elif kind == 'linked-native-note':
            anchor = guard['noteAnchor']
            note = by_anchor.get(anchor)
            links = [n.attrs.get('href') for _, child in block.children
                     if not isinstance(child, str) for n in child.nodes()
                     if n.attrs.get('role') == 'doc-noteref']
            require(note and '#' + anchor in links, f'{ident}: qualification note is no longer linked')
            # The complete note words and exact passage-note relationship matter.
            # Presentation attributes such as edition-bound source IDs may change.
            witness = normalized(note.text())
        else:
            raise ValueError(f'Unsupported qualification kind: {kind}')
        require(guard['exact'] in witness, f'{ident}: qualification wording changed')
        protected[ident].append({'text': guard['exact'], 'kind': kind,
                                **({'note': guard['noteAnchor']} if kind == 'linked-native-note' else {})})

    extra = defaultdict(list)
    for context in contexts:
        ident = context['passageId']
        require(ident in matched, f'Unknown book context passage: {ident}')
        p, _ = matched[ident]
        require((context['chapter'], context['section'], context['quote'], context['passageSha256']) ==
                (p['chapter'], p['section'], p['quote'], p['sha256']), f'{ident}: locality context changed')
        location = context['existingLocationId']
        require(location in locations and context['literalPlaceId'] is None and
                bool(context['qualification']), f'{ident}: invalid book-only locality reference')
        extra[ident].append({'id': context['id'], 'kind': 'context', 'locationId': location,
                            'targetName': context.get('proposedLabel', context['selector']['exact']),
                            'relation': context['relation'], 'selector': context['selector'],
                            'qualification': context['qualification']})

    mutations, entries, output_blocks = [], [], []
    mentions = set()
    link_owners = set()
    for ident, (p, block) in matched.items():
        mapping = character_map(block)
        spans = []
        links_in_passage = []
        for a in [*p['associations'], *extra[ident]]:
            aid = a['id']
            require(aid not in mentions and re.fullmatch(r'[A-Za-z0-9-]+', aid), f'Duplicate/invalid mention: {aid}')
            mentions.add(aid)
            start, end = selected_span(p['quote'], a['selector'], aid)
            require(not any(start < b and end > a0 for a0, b in spans), f'{aid}: overlapping mentions')
            spans.append((start, end))
            kind = a['kind']
            if kind == 'person':
                target = a['refn']
                require(target in people and isinstance(people[target], str) and people[target].strip() and
                        people[target] == a['targetName'], f'{aid}: person identity changed or unpublished: {target}')
            elif kind == 'place':
                target = a['placeId']
                place = places.get(target)
                require(place and (place['name'], place['location'], place['relation']) ==
                        (a['targetName'], a['locationId'], a['relation']), f'{aid}: place identity/context changed')
                require(not a.get('geographyNote') or a['geographyNote'] == place['note'],
                        f'{aid}: geographic qualification changed')
            elif kind == 'context':
                target = a['locationId']
            else:
                raise ValueError(f'{aid}: unsupported entity kind {kind}')
            require(isinstance(target, str) and re.fullmatch(r'[a-z0-9-]+', target),
                    f'{aid}: unsafe entity target')
            chosen = mapping[start:end]
            first = chosen[0]
            existing = first[4][-1] if first[4] else None
            if existing:
                require(all(item[4] and item[4][-1] is existing for item in chosen),
                        f'{aid}: mention crosses an existing link boundary')
                require(kind == 'person' and existing.attrs.get('href') in
                        {'#reg-' + target, '#reg-collateral-' + target},
                        f'{aid}: existing register link points to a different person')
                require(id(existing) not in link_owners, f'{aid}: multiple mentions in one existing link')
                link_owners.add(id(existing))
                mutations.append(('existing', existing, aid))
            else:
                parent, begin, finish = inline_range(chosen, aid)
                href = '#view=book&bookAnchor=' + p['section']
                if kind == 'person':
                    href += '&person=' + target
                elif kind == 'place':
                    href = '#view=places&place=' + target
                mutations.append(('new', parent, begin, finish, aid, href))
            entries.append({'id': aid, 'passage': ident, 'kind': kind, 'target': target,
                            'name': a['targetName'], 'label': a['selector']['exact'],
                            'qualifications': list(dict.fromkeys(filter(None,
                                [a.get('qualification'), a.get('geographyNote')]))),
                            **({'location': a['locationId'], 'relation': a['relation']} if kind != 'person' else {})})
            links_in_passage.append(aid)
        output_blocks.append({'id': ident, 'chapter': p['chapter'], 'section': p['section'],
                              'sha256': p['sha256'], 'mentions': links_in_passage,
                              'qualifications': protected[ident]})

    # Do not reuse a container for distinct runs: the following map needs an
    # unambiguous visible passage target, not a whole chapter wrapper.
    require(len({id(b.node) for _, b in matched.values()}) == len(matched),
            'Two prose runs share a container; review paragraph boundaries')
    for ident, (_, block) in matched.items():
        block.node.attrs['data-book-passage'] = ident
    parent_edits = defaultdict(list)
    for change in mutations:
        if change[0] == 'existing':
            change[1].attrs['data-book-mention'] = change[2]
        else:
            parent_edits[id(change[1])].append(change)
    # Rebuild each parent's child list once so adjacent edits keep source offsets.
    parents = {id(change[1]): change[1] for change in mutations if change[0] == 'new'}
    for parent in parents.values():
        output = []
        cursor = (0, 0)
        for _, _, start, end, aid, href in sorted(parent_edits[id(parent)], key=lambda e: e[2]):
            require(cursor <= start, 'Overlapping inline mutations')
            output.extend(child_slice(parent.children, cursor, start))
            output.append(type(parent)('a', {'href': href, 'data-book-mention': aid,
                                           'data-book-added-link': 'true'},
                                       child_slice(parent.children, start, end)))
            cursor = end
        output.extend(child_slice(parent.children, cursor, (len(parent.children), 0)))
        parent.children = output
    require(_restore_html(body).html() == original, 'Annotations changed the original manuscript DOM')
    destination.attrs, destination.children = body.attrs, body.children
    return {'schema': 1, 'passages': output_blocks, 'mentions': entries,
            'counts': {'passages': len(output_blocks), 'mentions': len(entries),
                       'kinds': dict(Counter(e['kind'] for e in entries)),
                       'guards': len(guards) + lane_checks.get('guards', 0)},
            **({'nonProseCoverage': lane_checks} if lane_checks else {}),
            **({'generatedEditionDates': generated_dates} if generated_dates else {})}
