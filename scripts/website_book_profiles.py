"""Derive profile introductions from complete, reviewed native Book paragraphs.

This module neither authors prose nor parses a second manuscript. Its caller has
already checked the HTML tree, source uses and annotation catalogue. Selections
pin meaning (words, reviewed identities, qualifications and attached sources),
not compiler-generated note numbers. Nothing mutates the input Book tree.
Optional: used only for profileIntroductions in book/web-selections.json.
"""
from copy import deepcopy
from hashlib import sha256
import re

from website_book_annotations import content_digest, normalized, require

HASH = re.compile(r'[a-f0-9]{64}')
BLOCKS = {'p', 'div', 'figure', 'table', 'ol', 'ul', 'li', 'section', 'blockquote'}


def unique(values, message):
    require(len(values) == 1, message)
    return values[0]



def normalized_origins(raw):
    """Map collapsed Unicode text positions to original decoded text positions."""
    positions, pending = [], None
    for index, character in enumerate(raw):
        if character.isspace():
            if positions and pending is None:
                pending = index
        else:
            if pending is not None:
                positions.append(pending)
            positions.append(index)
            pending = None
    return positions


def register_controls(nodes, block, annotations, public_anchors, raw, ranges, notes):
    controls, origins = [], normalized_origins(raw)
    mentions = {mention['id']: mention for mention in annotations['mentions']}
    text = normalized(raw)
    for node, start, end in ranges:
        anchor = node.attrs['href'][1:]
        require(anchor in public_anchors, 'Profile register target is not public')
        target = unique([n for n in nodes if n.attrs.get('id') == anchor],
                        'Profile register heading is missing or ambiguous')
        require(target.tag in {'h3', 'h4', 'h5', 'h6'}, 'Profile register target is not a person heading')
        source = mentions.get(node.attrs.get('data-book-mention'))
        heading_mentions = [mentions.get(n.attrs.get('data-book-mention')) for n in target.nodes()
                            if 'data-book-mention' in n.attrs]
        heading_people = [m for m in heading_mentions if m and m['kind'] == 'person']
        require(source and source['kind'] == 'person' and len(heading_people) == 1 and
                source['target'] == heading_people[0]['target'],
                'Profile register identity differs from the actual reviewed heading')
        printed = re.fullmatch(r'([1-9][0-9]*)\. (.+)', normalized(target.text({'doc-noteref'})))
        require(printed, 'Profile register heading needs its actual printed number and name')
        number, label = int(printed[1]), printed[2]
        link_text = normalized(node.text({'doc-noteref'}))
        reference = re.search(r'\(no\. ([1-9][0-9]*)\)', link_text)
        require(not reference or int(reference[1]) == number,
                'Profile register reference differs from its actual printed number')
        positions = [i for i, origin in enumerate(origins) if start <= origin < end]
        require(positions and text[positions[0]:positions[-1] + 1] == link_text,
                'Profile register link does not cover an exact complete text run')
        first, last = positions[0], positions[-1] + 1
        require(not any(first < note['offset'] < last for note in notes),
                'Profile register link overlaps a source control')
        controls.append({'start': first, 'end': last, 'anchor': anchor,
                         'person': source['target'], 'number': number, 'label': label})
    return controls


def source_groups(block, markers):
    """Only group actual adjacent compiler notes bridged by an unstyled SUP comma."""
    indexes = {id(marker): index for index, (_, marker) in enumerate(markers)}
    groups = []
    def kind(child):
        if isinstance(child, str):
            return 'space' if not child.strip() else 'other'
        if child.tag == 'a' and child.attrs.get('role') == 'doc-noteref':
            return 'note'
        if not child.attrs and child.tag == 'sup' and child.children == [',']:
            return 'comma'
        if child.tag == 'span' and not child.attrs and not child.text().strip() and all(
                isinstance(part, str) for part in child.children):
            return 'space'
        return 'other'
    for parent in block.nodes():
        children, index = parent.children, 0
        while index < len(children):
            if kind(children[index]) != 'note':
                index += 1
                continue
            members, end = [indexes[id(children[index])]], index
            while True:
                cursor, commas = end + 1, 0
                while cursor < len(children) and kind(children[cursor]) in {'space', 'comma'}:
                    commas += kind(children[cursor]) == 'comma'
                    cursor += 1
                if commas != 1 or cursor >= len(children) or kind(children[cursor]) != 'note':
                    break
                members.append(indexes[id(children[cursor])])
                end = cursor
            if len(members) > 1:
                require(members == list(range(members[0], members[-1] + 1)),
                        'Profile source group crosses a different note attachment')
                groups.append(members)
            index = end + 1
    return sorted(groups, key=lambda members: members[0])


def profile_block(body, annotations, citations, passage_id, public_anchors):
    """Extract one complete physical paragraph, including its note positions."""
    passage = unique([p for p in annotations['passages'] if p['id'] == passage_id],
                     'Profile paragraph metadata is missing or ambiguous')
    require(passage['chapter'].startswith('ch-') and passage['section'] in public_anchors,
            'Profile introductions require a public narrative section')
    nodes = list(body.nodes())
    block = unique([n for n in nodes if n.attrs.get('data-book-passage') == passage_id],
                   'Profile paragraph is missing or has overlapping physical views')
    require(block.tag in {'p', 'div'} and not any(
        n is not block and n.tag in BLOCKS for n in block.nodes()),
        'Profile selection must be a complete prose paragraph')
    text = normalized(block.text({'doc-noteref'}))
    require(sha256(text.encode()).hexdigest() == passage['sha256'],
            'Profile paragraph differs from its reviewed text')
    raw, markers, register_ranges = [], [], []

    def walk(node):
        if isinstance(node, str):
            raw.append(node)
        elif node.attrs.get('role') == 'doc-noteref':
            markers.append((len(normalized(''.join(raw))), node))
        else:
            start = len(''.join(raw))
            for child in node.children:
                walk(child)
            if node.tag == 'a' and node.attrs.get('href', '').startswith('#reg-'):
                register_ranges.append((node, start, len(''.join(raw))))

    walk(block)
    notes = []
    for offset, marker in markers:
        require(0 < offset <= len(text), 'Profile source marker has no preceding claim')
        target = marker.attrs.get('href', '')
        require(target.startswith('#'), 'Profile source note must be an attached local note')
        note = unique([n for n in nodes if n.attrs.get('id') == target[1:]],
                      'Profile source note is missing or ambiguous')
        owners = [(n.attrs.get('data-book-person'), n.attrs.get('data-book-key'))
                  for n in note.nodes() if 'data-book-person' in n.attrs or 'data-book-key' in n.attrs]
        require(owners and all(person and key for person, key in owners),
                'Profile source note needs its exact citation owner and key')
        sources = [unique([c for c in citations if (c['person'], c['key']) == owner],
                          'Profile source use is missing or ambiguous') for owner in owners]
        require(any(n.attrs.get('role') == 'doc-backlink' and
                    n.attrs.get('href') == '#' + marker.attrs.get('id', '') for n in note.nodes()),
                'Profile source note is not reciprocally attached to this paragraph')
        notes.append({'offset': offset, 'anchor': target[1:],
                      'text': normalized(note.text({'doc-backlink'})),
                      'citations': deepcopy(sources)})
    mentions = [deepcopy(m) for m in annotations['mentions'] if m['passage'] == passage_id]
    require([m['id'] for m in mentions] == passage['mentions'],
            'Profile paragraph mention inventory differs')
    qualifications = [{k: v for k, v in q.items() if k != 'note'}
                      for q in passage['qualifications']]
    # The full note survives even where the display qualification is abbreviated.
    # Note IDs can change in a later print layout; source identity/text cannot.
    context = {'mentions': mentions, 'qualifications': qualifications,
               'notes': [{k: v for k, v in n.items() if k != 'anchor'} for n in notes]}
    controls = register_controls(nodes, block, annotations, public_anchors, ''.join(raw), register_ranges, notes)
    groups = source_groups(block, markers)
    return {'passage': passage_id, 'section': passage['section'], 'chapter': passage['chapter'],
            'sha256': passage['sha256'], 'contextSha256': content_digest(
                {'chapter': passage['chapter'], 'section': passage['section'], **context}),
            'text': text, **context, 'notes': notes,
            **({'registerLinks': controls} if controls else {}),
            **({'sourceGroups': groups} if groups else {})}


def profile_selector(block):
    """A proposed selection for deliberate editorial review, never auto-adopted."""
    return {key: block[key] for key in ('passage', 'sha256', 'contextSha256')}


def build_profile_introductions(body, annotations, citations, selections,
                                published_people, public_anchors):
    require(isinstance(selections, list), 'Profile introductions must be an explicit list')
    document_order = {node.attrs['data-book-passage']: index
                      for index, node in enumerate(body.nodes())
                      if 'data-book-passage' in node.attrs}
    result, used = [], set()
    for entry in selections:
        require(isinstance(entry, dict) and set(entry) == {'person', 'blocks'},
                'Unsupported profile introduction selection')
        person, blocks = entry['person'], entry['blocks']
        require(isinstance(person, str) and person in published_people and person not in used,
                'Profile introduction needs a unique published person')
        require(isinstance(blocks, list) and 1 <= len(blocks) <= 12,
                'Select one to twelve complete profile paragraphs')
        extracted, seen = [], set()
        previous_position = -1
        for expected in blocks:
            require(isinstance(expected, dict) and set(expected) ==
                    {'passage', 'sha256', 'contextSha256'}, 'Unsupported profile paragraph selector')
            require(isinstance(expected['passage'], str) and expected['passage'] not in seen and
                    all(isinstance(expected[k], str) and HASH.fullmatch(expected[k])
                        for k in ('sha256', 'contextSha256')), 'Invalid or duplicate profile paragraph')
            block = profile_block(body, annotations, citations, expected['passage'], public_anchors)
            require(all(link['person'] in published_people for link in block.get('registerLinks', [])),
                    'Profile register target needs a published person')
            require(profile_selector(block) == expected,
                    'Profile paragraph/source/qualification changed; review the selection')
            position = document_order[block['passage']]
            require(position > previous_position,
                    'Profile paragraphs must follow the actual Book reading order')
            previous_position = position
            extracted.append(block)
            seen.add(expected['passage'])
        require(any(m['kind'] == 'person' and m['target'] == person
                    for m in extracted[0]['mentions']),
                'Profile opening lacks its explicitly reviewed person identity')
        result.append({'person': person, 'blocks': extracted})
        used.add(person)
    return result
