"""Re-anchoring keeps reviewed links on their words after deliberate prose edits."""
from hashlib import sha256
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import sys
SCRIPTS = Path(__file__).resolve().parent.parent / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import website_book_reanchor
from website_native_book import Node
from website_book_nonprose import index_blocks
from website_book_annotations import (annotate, normalized, Catalogue, content_digest)
from website_book_reanchor import (align, catalogue_new_charts, check_installed_matches, follow_ancestor_dates, follow_corrected_names, follow_edition_counts, person_mention,
                                   reanchor, relocate, refresh_section_people, remap)

PEOPLE = {'edith': 'Edith /Penhallow/', 'karin': 'Karin /Solberg/'}
GEOGRAPHY = {'locations': [], 'places': []}
# The short forms these fixtures use, in place of the current family's list.
SHORT_FORMS = {'Herman': ['Hermann']}


def setUpModule():
    patcher = patch.object(website_book_reanchor, 'FAMILY_NAMES', SHORT_FORMS)
    patcher.start()
    unittest.addModuleCleanup(patcher.stop)


def body(text):
    return Node('body', {}, [Node('h2', {'id': 'ch-test'}, ['A family']), Node('p', {}, [text])])


def selector(quote, exact):
    start = quote.index(exact)
    end = start + len(exact)
    return {'exact': exact, 'occurrence': 1, 'start': start, 'end': end,
            'prefix': quote[max(0, start - 64):start], 'suffix': quote[end:end + 64]}


def write_catalogue(root, quote):
    passage = {'id': 'P-1', 'chapter': 'ch-test', 'section': 'ch-test', 'quote': quote,
               'sha256': sha256(quote.encode()).hexdigest(), 'withheld': [], 'existingLinks': [],
               'associations': [{'id': 'P-1-A1', 'kind': 'person', 'refn': 'karin',
                                 'targetName': PEOPLE['karin'], 'selector': selector(quote, 'Karin')}]}
    guards = [{'passageId': 'P-1', 'passageSha256': passage['sha256'], 'kind': 'same-passage',
               'exact': 'The notice gives the date.'}]
    parts = []
    for part in ('c1-c2', 'c3', 'remaining-prose'):
        files = {'associations': {'passages': [passage] if part == 'c1-c2' else []},
                 'guards': {'guards': guards if part == 'c1-c2' else []},
                 'contexts': {'locationRecords': {}, 'mentions': []}}
        sources = {}
        for key, name in (('associations', 'associations.json'), ('guards', 'qualification-guards.json'),
                          ('contexts', 'book-only-locations.json')):
            path = root / 'book-annotations' / part / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(files[key], ensure_ascii=False, indent=2) + '\n')
            sources[key] = {'path': f'book-annotations/{part}/{name}',
                            'sha256': sha256(path.read_bytes()).hexdigest()}
        parts.append({'id': part, 'sources': sources})
    manifest = root / 'book-annotations.json'
    manifest.write_text(json.dumps({'schema': 1, 'scope': {'authoredChapters': ['ch-test'],
                                                          'separateChapters': []},
                                    'parts': parts}, indent=2) + '\n')
    return manifest


def loaded(manifest):
    data = json.loads(manifest.read_text())
    parts = []
    for row in data['parts']:
        part = {'review': row['id']}
        for key, source in row['sources'].items():
            raw = (manifest.parent / source['path']).read_bytes()
            assert sha256(raw).hexdigest() == source['sha256'], 'manifest digest is stale'
            part[key] = json.loads(raw)
        parts.append(part)
    return Catalogue(tuple(parts), data['scope'], (),
                     content_digest({'parts': parts, 'scope': data['scope']}))


class Reanchor(unittest.TestCase):
    def test_revised_passage_keeps_links_and_drops_removed_guard(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = 'Edith met Karin in Madison. The notice gives the date.'
            manifest = write_catalogue(Path(tmp), old)
            new = 'In Madison, Edith first met her grandmother Karin.'
            changes = reanchor(body(new), manifest)
            self.assertIn('P-1: passage text revised', changes)
            self.assertTrue(any('dropped guard' in line for line in changes))
            result = annotate(body(new), loaded(manifest), PEOPLE, GEOGRAPHY)
            self.assertEqual([m['label'] for m in result['mentions']], ['Karin'])

    def test_unchanged_catalogue_is_left_alone(self):
        with tempfile.TemporaryDirectory() as tmp:
            quote = 'Edith met Karin in Madison. The notice gives the date.'
            manifest = write_catalogue(Path(tmp), quote)
            before = {p: p.read_bytes() for p in Path(tmp).rglob('*.json')}
            self.assertEqual(reanchor(body(quote), manifest), [])
            self.assertEqual(before, {p: p.read_bytes() for p in Path(tmp).rglob('*.json')})

    def test_removed_name_drops_its_link(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = write_catalogue(Path(tmp), 'Edith met Karin in Madison. The notice gives the date.')
            changes = reanchor(body('Edith grew up in Madison.'), manifest)
            self.assertTrue(any('dropped link P-1-A1' in line for line in changes))

    def test_complete_rewrite_keeps_its_place_and_reports_lost_links(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = write_catalogue(Path(tmp), 'Edith met Karin in Madison. The notice gives the date.')
            changes = reanchor(body('Xq zv.'), manifest)
            self.assertIn('P-1: passage text revised', changes)
            self.assertTrue(any('dropped link P-1-A1' in line for line in changes))

    def test_added_paragraph_is_catalogued_without_guessed_links(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = write_catalogue(Path(tmp), 'Edith met Karin in Madison. The notice gives the date.')
            revised = body('Edith met Karin in Madison. The notice gives the date.')
            revised.children.append(Node('p', {}, ['Karin Solberg grew up in Penzance.']))
            changes = reanchor(revised, manifest, people=PEOPLE)
            self.assertTrue(any('new paragraph' in line for line in changes))
            result = annotate(revised, loaded(manifest), PEOPLE, GEOGRAPHY)
            # Without a footnote citing her, the new name is not linked.
            self.assertEqual([m['label'] for m in result['mentions']], ['Karin'])

    def test_a_paragraph_moved_to_a_new_section_keeps_its_entry_and_links(self):
        with tempfile.TemporaryDirectory() as tmp:
            quote = 'Edith met Karin in Madison. The notice gives the date.'
            manifest = write_catalogue(Path(tmp), quote)
            revised = Node('body', {}, [Node('h2', {'id': 'ch-test'}, ['A family']),
                                        Node('h3', {'id': 'reading-later'}, ['Later years']),
                                        Node('p', {}, ['In those years ' + quote])])
            changes = reanchor(revised, manifest, people=PEOPLE)
            self.assertIn('P-1: moved from section ch-test to reading-later', changes)
            result = annotate(revised, loaded(manifest), PEOPLE, GEOGRAPHY)
            self.assertEqual([(m['passage'], m['label']) for m in result['mentions']], [('P-1', 'Karin')])

    def test_a_cited_full_name_in_new_text_is_linked(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = write_catalogue(Path(tmp), 'Edith met Karin in Madison. The notice gives the date.')
            revised = body('Edith met Karin in Madison. The notice gives the date.')
            revised.children.append(Node('p', {}, ['Karin Solberg grew up in Penzance.', Node(
                'a', {'role': 'doc-noteref', 'href': '#loc-1'}, ['1'])]))
            revised.children.append(Node('section', {'role': 'doc-endnotes'}, [Node('ol', {}, [Node(
                'li', {'id': 'loc-1'}, [Node('span', {'data-book-person': 'karin'}, ['Census, 1930.'])])])]))
            reanchor(revised, manifest, people=PEOPLE)
            result = annotate(revised, loaded(manifest), PEOPLE, GEOGRAPHY)
            self.assertEqual([m['label'] for m in result['mentions']], ['Karin', 'Karin Solberg'])

    def test_a_split_paragraph_keeps_its_links_in_the_opening_part(self):
        with tempfile.TemporaryDirectory() as tmp:
            opening = 'Edith met Karin in Madison in the spring.'
            rest = 'The notice gives the date, the name of the church and the long list of the guests.'
            manifest = write_catalogue(Path(tmp), opening + ' ' + rest)
            revised = body(opening)
            revised.children.append(Node('p', {}, [rest]))
            reanchor(revised, manifest, people=PEOPLE)
            result = annotate(revised, loaded(manifest), PEOPLE, GEOGRAPHY)
            self.assertEqual([(m['passage'], m['label']) for m in result['mentions']], [('P-1', 'Karin')])

    def test_a_name_withheld_for_want_of_a_person_is_linked_once_cited(self):
        people = {**PEOPLE, 'robert': 'Robert /Penhallow/'}
        with tempfile.TemporaryDirectory() as tmp:
            manifest = write_catalogue(Path(tmp), 'Edith met Karin in Madison. The notice gives the date.')
            path = Path(tmp) / 'book-annotations/c1-c2/associations.json'
            data = json.loads(path.read_text())
            data['passages'][0]['withheld'] = [
                {'exact': 'Edith Penhallow', 'status': 'missing-person-target', 'kind': 'person'},
                {'exact': 'Robert Penhallow', 'status': 'explicitly-withheld', 'kind': 'person'}]
            path.write_text(json.dumps(data))
            raw = json.loads(manifest.read_text())
            raw['parts'][0]['sources']['associations']['sha256'] = sha256(path.read_bytes()).hexdigest()
            manifest.write_text(json.dumps(raw))
            text = 'Edith Penhallow met Karin in Madison with Robert Penhallow. The notice gives the date.'
            revised = Node('body', {}, [Node('h2', {'id': 'ch-test'}, ['A family']), Node('p', {}, [
                text, Node('a', {'role': 'doc-noteref', 'href': '#loc-1'}, ['1'])]),
                Node('section', {'role': 'doc-endnotes'}, [Node('ol', {}, [Node('li', {'id': 'loc-1'}, [
                    Node('span', {'data-book-person': 'edith'}, ['Census.']),
                    Node('span', {'data-book-person': 'robert'}, ['Census.'])])])])])
            reanchor(revised, manifest, people=people)
            passage = json.loads(path.read_text())['passages'][0]
            self.assertEqual([a['selector']['exact'] for a in passage['associations']], ['Edith Penhallow', 'Karin'])
            self.assertEqual([w['exact'] for w in passage['withheld']], ['Robert Penhallow'])

    def test_repeated_name_follows_its_own_context(self):
        old = 'Walter wrote to Walter O’Brien about the farm.'
        sel = selector(old, 'Walter O’Brien')
        sel.update(occurrence=2, exact='Walter', end=sel['start'] + 6,
                   suffix=old[sel['start'] + 6:sel['start'] + 70])
        new = 'Later, Walter wrote a long letter to Walter O’Brien about the farm.'
        moved = relocate(sel, old, new)
        self.assertEqual(new[moved['start']:moved['end']], 'Walter')
        self.assertEqual(moved['occurrence'], 2)

    def test_section_people_follow_the_edited_manuscript(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sketch = root / 'book/sketches/one.typ'
            sketch.parent.mkdir(parents=True)
            sketch.write_text('Revised text.\n')
            selections = root / 'web-selections.json'
            selections.write_text(json.dumps({'sectionPeople': [
                {'anchor': 'a', 'people': ['edith'], 'manuscript': 'book/sketches/one.typ',
                 'sha256': '0' * 64}]}))
            self.assertEqual(len(refresh_section_people(selections, root)), 1)
            self.assertEqual(json.loads(selections.read_text())['sectionPeople'][0]['sha256'],
                             sha256(sketch.read_bytes()).hexdigest())


class GeneratedTextTest(unittest.TestCase):
    """New facts renumber the register and its notes; references follow."""

    def test_a_reworded_register_line_moves_its_links_with_nothing_renumbered(self):
        old, new = 'Ann was buried in Orchard Hill Cemetery.', 'Ann was buried at Orchard Hill Cemetery.'

        def page(text):
            return Node('body', {}, [Node('h2', {'id': 'reg-ch-one'}, ['Register']),
                                     Node('h4', {'id': 'reg-ann'}, ['Ann']), Node('p', {}, [text])])
        indexed = index_blocks(page(old), set())
        coverage = {name: [{'id': ident, **({'registerHeading': row['registerHeading']} if kind == 'register-block'
                                              else {'elementId': row['elementId']}),
                            'quote': row['quote'], 'sha256': row['sha256'],
                            **({'actions': []} if kind == 'register-block' else {'decision': 'keep'})}
                           for ident, (row, _) in indexed.items() if row['kind'] == kind]
                    for name, kind in (('registerBlocks', 'register-block'),
                                       ('generatedHeadings', 'generated-heading'))}
        row, _ = indexed['NP-R001']
        place = {'id': 'NP-R001', 'quote': old, 'sha256': row['sha256'], 'chapter': 'reg-ch-one',
                 'section': 'reg-ch-one', 'registerHeading': 'reg-ann', 'containerTag': 'p',
                 'noteIds': [], 'requiredNoteWitnesses': [],
                 'associations': [{'id': 'NP-R001-PLACE-A01', 'kind': 'place',
                                   'selector': selector(old, 'Orchard Hill Cemetery')}]}
        data = {('non-prose', 'associations'): {'authoredHeadingsAndCaptions': [],
                                                'registerPeople': [], 'registerPlaces': [place]},
                ('non-prose', 'coverage'): coverage,
                ('non-prose', 'guards'): {'captionGuards': [], 'crossPassageGuards': [],
                                          'unmarkedEndnoteGuards': []},
                ('non-prose', 'contexts'): {},
                ('non-prose', 'preserved'): {'figures': []}}
        with tempfile.TemporaryDirectory() as installed:
            changes = website_book_reanchor.rebase_generated(page(new), data, set(), installed,
                                                             {'ann': 'Ann /Example/'})
        self.assertIn('NP-R001: generated text revised', changes)
        block, = data['non-prose', 'coverage']['registerBlocks']
        self.assertEqual(block['quote'], new)
        moved, = data['non-prose', 'associations']['registerPlaces']
        self.assertEqual(moved['quote'], new)
        self.assertEqual(new[moved['associations'][0]['selector']['start']:
                             moved['associations'][0]['selector']['end']], 'Orchard Hill Cemetery')

    def rows(self, *quotes):
        return [(f'NP-R{i:03}', {'registerHeading': 'reg-a', 'quote': q})
                for i, q in enumerate(quotes, 1)]

    def test_inserted_block_shifts_later_numbers(self):
        key = lambda r: (r['registerHeading'], r['quote'])
        pairs, lost, gained = align(self.rows('Born 1900.', 'Died 1980.'),
                                    self.rows('Born 1900.', 'At school 1915.', 'Died 1980.'), key)
        self.assertEqual(pairs, {'NP-R001': 'NP-R001', 'NP-R002': 'NP-R003'})
        self.assertEqual((lost, gained), ([], ['NP-R002']))

    def test_revised_block_keeps_its_identity(self):
        key = lambda r: (r['registerHeading'], r['quote'])
        pairs, lost, gained = align(self.rows('She married Erik.'),
                                    self.rows('She married Erik. Sources: under 1. Erik.'), key,
                                    lambda r: r['registerHeading'])
        self.assertEqual((pairs, lost, gained), ({'NP-R001': 'NP-R001'}, [], []))

    def test_moved_block_is_found_by_its_words(self):
        key = lambda r: r['quote']
        pairs, _, _ = align(self.rows('A.', 'B.', 'C.'), self.rows('B.', 'C.', 'A.'), key)
        self.assertEqual(pairs['NP-R001'], 'NP-R003')

    def test_moved_and_renumbered_heading_pairs_by_its_anchor(self):
        old = [('NP-H001', {'elementId': 'ch-edith', 'quote': 'Chapter 1. The Present Generation'}),
               ('NP-H002', {'elementId': 'ch-penhallow', 'quote': 'Chapter 2. Penhallow'})]
        new = [('NP-H001', {'elementId': 'ch-penhallow', 'quote': 'Chapter 1. Penhallow'}),
               ('NP-H002', {'elementId': 'ch-edith', 'quote': 'Chapter 2. The Present Generation'})]
        pairs, lost, gained = align(old, new, lambda r: (r['elementId'], r['quote']),
                                    lambda r: r['elementId'])
        self.assertEqual(pairs, {'NP-H001': 'NP-H002', 'NP-H002': 'NP-H001'})
        self.assertEqual((lost, gained), ([], []))

    def test_link_follows_a_name_swapped_word_for_word(self):
        cases = [
            ('In 1994 Rosalind was teaching.', 'At the time, Rosa was teaching.', 'Rosalind', 'Rosa'),
            ('Karin Solberg was there.', 'Karen Solberg was there.', 'Karin Solberg', 'Karen Solberg'),
            ('the ship of Captain Thomas Treloar.', 'the ship of her grandfather, Captain Thomas Trelore.',
             'Captain Thomas Treloar', 'Captain Thomas Trelore'),
        ]
        for old, new, exact, expected in cases:
            moved = relocate(selector(old, exact), old, new)
            self.assertEqual(moved and moved['exact'], expected)
            self.assertEqual(new[moved['start']:moved['end']], expected)
        # A deleted name drops its link.
        self.assertIsNone(relocate(selector('Robert, known as Rob, studied.', 'Robert'),
                                   'Robert, known as Rob, studied.', 'He studied.'))

    def test_remap_renames_every_reference_at_once(self):
        data = {'id': 'NP-R002', 'noteIds': ['loc-5'], 'href': '#loc-5',
                'association': 'NP-R002-PERSON-A01', 'other': 'NP-R003'}
        out = remap(data, {'NP-R002': 'NP-R003', 'NP-R003': 'NP-R004'}, {'loc-5': 'loc-6'})
        self.assertEqual(out, {'id': 'NP-R003', 'noteIds': ['loc-6'], 'href': '#loc-6',
                               'association': 'NP-R002-PERSON-A01', 'other': 'NP-R004'})

    def test_repeated_name_keeps_the_one_with_surviving_context(self):
        old = 'She married 4 June 1960, Erik Lund.'
        new = 'She married 4 June 1960, Erik Lund. Sources: under 1. Erik Lund.'
        moved = relocate(selector(old, 'Erik Lund'), old, new)
        self.assertEqual(moved['start'], old.index('Erik Lund'))


class CorrectedNameTest(unittest.TestCase):
    def link(self, exact, name, note='Maiden name remains unestablished.'):
        return {'kind': 'person', 'refn': 'joan', 'id': 'C2-001-A01', 'targetName': name,
                'qualification': note, 'selector': {'exact': exact}}

    def test_a_found_maiden_name_follows_and_drops_the_old_note(self):
        row = self.link('Joan Penhallow', 'Joan /Penhallow/')
        changes = follow_corrected_names({('c1', 'associations'): {'passages': [row]}},
                                         {'joan': 'Joan Margaret /Treloar/'})
        self.assertEqual(row['targetName'], 'Joan Margaret /Treloar/')
        self.assertNotIn('qualification', row)
        self.assertEqual(len(changes), 2)

    def test_a_register_heading_link_finds_the_corrected_name(self):
        row = self.link('Joan Penhallow', 'Joan /Penhallow/')
        row['selector'].update(start=4, end=18)
        moved = person_mention(row, {'joan': 'Joan Margaret /Treloar/'},
                               '39. Joan Penhallow', '39. Joan Margaret Treloar')
        self.assertEqual((moved['exact'], moved['start']), ('Joan Margaret Treloar', 4))

    def test_a_corrected_spelling_of_the_first_name_follows(self):
        row = self.link('Hermann Kesler', 'Hermann /Kessler/', 'The name reading is uncertain.')
        row['refn'] = 'hermann'
        follow_corrected_names({('c1', 'associations'): [row]}, {'hermann': 'Herman Friedrich /Kessler/'})
        self.assertEqual(row['targetName'], 'Herman Friedrich /Kessler/')

    def test_a_different_first_name_is_left_for_the_check_to_refuse(self):
        row = self.link('Joan Penhallow', 'Joan /Penhallow/')
        follow_corrected_names({('c1', 'associations'): [row]}, {'joan': 'Susan /Penhallow/'})
        self.assertEqual(row['targetName'], 'Joan /Penhallow/')


class AncestorTableTest(unittest.TestCase):
    def table(self, name, born):
        cell = lambda *c: Node('td', {}, list(c))
        row = Node('tr', {}, [cell('2'), cell(Node('a', {'href': '#reg-robert'}, [name])),
                              cell(born), cell('')])
        head = Node('tr', {}, [Node('th', {}, [t]) for t in ('no.', 'person', 'born', 'died')])
        return Node('body', {}, [Node('table', {}, [head, row])])

    def preserved(self):
        return {'ahnentafelKnownRows': [{'number': '2', 'refn': 'robert', 'href': '#reg-robert',
                                         'quote': ['2', 'Robert Penhallow', 'March 1931', '']}],
                'ahnentafelUnknownNumbers': []}

    def test_dates_follow_a_new_birth_date(self):
        kept = self.preserved()
        changes = follow_ancestor_dates(self.table('Robert Penhallow', '15 March 1931'), kept)
        self.assertEqual(kept['ahnentafelKnownRows'][0]['quote'][2], '15 March 1931')
        self.assertEqual(len(changes), 1)

    def test_a_corrected_spelling_with_the_same_link_is_followed(self):
        kept = self.preserved()
        kept['ahnentafelKnownRows'][0]['quote'] = ['2', 'Hermann Kessler', '', '']
        changes = follow_ancestor_dates(self.table('Herman Friedrich Kessler', '1852'), kept)
        self.assertEqual(kept['ahnentafelKnownRows'][0]['quote'][1], 'Herman Friedrich Kessler')
        self.assertEqual(len(changes), 2)

    def test_a_newly_found_ancestor_fills_a_blank_row(self):
        cell = lambda *c: Node('td', {}, list(c))
        head = Node('tr', {}, [Node('th', {}, [t]) for t in ('no.', 'person', 'born', 'died')])
        row = lambda n, person, born: Node('tr', {}, [cell(n), cell(person), cell(born), cell('')])
        robert = row('2', Node('a', {'href': '#reg-robert'}, ['Robert Penhallow']), 'March 1931')
        harold = row('4', Node('a', {'href': '#reg-harold'}, ['Harold Penhallow']), '1905')
        blanks = [row(n, '_____ _____', '') for n in ('8', '9')]
        body = Node('body', {}, [Node('table', {}, [head, robert, harold, *blanks])])
        kept = self.preserved()
        kept['ahnentafelUnknownNumbers'] = ['4']
        changes = follow_ancestor_dates(body, kept)
        self.assertEqual([r['refn'] for r in kept['ahnentafelKnownRows']], ['robert', 'harold'])
        self.assertEqual(kept['ahnentafelUnknownNumbers'], ['8', '9'])
        self.assertTrue(any('newly found' in c for c in changes))

    def test_two_generations_found_at_once(self):
        cell = lambda *c: Node('td', {}, list(c))
        head = Node('tr', {}, [Node('th', {}, [t]) for t in ('no.', 'person', 'born', 'died')])
        row = lambda n, person, born: Node('tr', {}, [cell(n), cell(person), cell(born), cell('')])
        link = lambda refn, name: Node('a', {'href': f'#reg-{refn}'}, [name])
        rows = [row('2', link('robert', 'Robert Penhallow'), 'March 1931'),
                row('4', link('harold', 'Harold Penhallow'), '1905'),
                row('8', link('william', 'William Penhallow'), '1875'),
                row('9', '_____ _____', ''), row('16', '_____ _____', ''), row('17', '_____ _____', '')]
        body = Node('body', {}, [Node('table', {}, [head, *rows])])
        kept = self.preserved()
        kept['ahnentafelUnknownNumbers'] = ['4']
        follow_ancestor_dates(body, kept)
        self.assertEqual([r['refn'] for r in kept['ahnentafelKnownRows']], ['robert', 'harold', 'william'])
        self.assertEqual(kept['ahnentafelUnknownNumbers'], ['9', '16', '17'])

    def test_a_corrected_name_with_the_same_link_is_followed(self):
        kept = self.preserved()
        changes = follow_ancestor_dates(self.table('Robert John Penhallow', 'March 1931'), kept)
        self.assertEqual(kept['ahnentafelKnownRows'][0]['quote'][1], 'Robert John Penhallow')
        self.assertTrue(any('name' in c for c in changes))

    def test_a_different_person_is_left_for_the_check_to_refuse(self):
        kept = self.preserved()
        self.assertEqual(follow_ancestor_dates(self.table('Someone Else', '1931'), kept), [])
        self.assertEqual(kept['ahnentafelKnownRows'][0]['quote'][1], 'Robert Penhallow')


class EditionCountTest(unittest.TestCase):
    def passage(self):
        quote = 'September 2026 edition \u2014 87 people in the ancestor table'
        return {'id': 'F-004', 'quote': quote, 'associations': [],
                'generatedEditionDate': {'selector': {'exact': 'September 2026', 'start': 0,
                                                      'end': 14, 'prefix': '', 'suffix': quote[14:]}}}

    def block(self, text):
        return type('Block', (), {'quote': text})()

    def test_count_follows_the_data(self):
        p = self.passage()
        change = follow_edition_counts(p, self.block('October 2026 edition \u2014 89 people in the ancestor table'))
        self.assertTrue(change)
        self.assertEqual(p['quote'], 'September 2026 edition \u2014 89 people in the ancestor table')
        self.assertIn('89', p['generatedEditionDate']['selector']['suffix'])

    def test_reworded_line_still_fails(self):
        p = self.passage()
        self.assertIsNone(follow_edition_counts(p, self.block('October 2026 edition \u2014 89 relatives in the table')))


class NewPhotographTest(unittest.TestCase):
    PEOPLE = {'thomas-henry-treloar': 'Thomas Henry /Treloar/', 'joan-treloar': 'Joan Margaret /Treloar/'}

    def run_with(self, caption):
        image = {'href': '/data/images/x.jpg', 'data-book-image': 'images/x.jpg',
                 'aria-label': 'Open illustration: ' + caption}
        page = Node('body', {}, [Node('h2', {'id': 'ch-test'}, ['A family']), Node('figure', {}, [
            Node('a', image, [Node('img', {'data-book-original': 'images/x.jpg'}, [])]),
            Node('figcaption', {}, [caption])])])
        data = {('non-prose', 'associations'): {'authoredHeadingsAndCaptions': []},
                ('non-prose', 'guards'): {'captionGuards': []},
                ('non-prose', 'preserved'): {'figures': []}}
        changes = catalogue_new_charts(page, index_blocks(page, {'ch-test'}), ['NP-F001'], data, self.PEOPLE)
        return changes, data, image

    def test_a_new_portrait_links_the_person_its_caption_names(self):
        changes, data, image = self.run_with("Figure 1: Dr. Thomas Henry Treloar, Joan's father.")
        row, = data['non-prose', 'associations']['authoredHeadingsAndCaptions']
        link, = row['associations']
        self.assertEqual((link['refn'], link['selector']['exact']), ('thomas-henry-treloar', 'Thomas Henry Treloar'))
        witness, = data['non-prose', 'preserved']['figures']
        self.assertEqual((witness['assetPaths'], witness['imageLinks']), (['images/x.jpg'], [image]))
        self.assertEqual(len(data['non-prose', 'guards']['captionGuards']), 1)
        self.assertEqual(len(changes), 1)

    def test_a_photograph_naming_nobody_in_full_is_refused(self):
        with self.assertRaises(ValueError):
            self.run_with("Figure 1: Joan's father in about 1890.")


class NewHeadingTest(unittest.TestCase):
    def run_with(self, heading):
        page = Node('body', {}, [Node('h2', {'id': 'ch-test'}, ['A family']),
                                 Node('h3', {'id': 'reading-new'}, [heading])])
        data = {('non-prose', 'associations'): {'authoredHeadingsAndCaptions': []},
                ('non-prose', 'guards'): {'captionGuards': []},
                ('non-prose', 'preserved'): {'figures': []}}
        indexed = index_blocks(page, {'ch-test'})
        ident = next(i for i, (row, _) in indexed.items() if row.get('elementId') == 'reading-new')
        changes = catalogue_new_charts(page, indexed, [ident], data,
                                       {'ingrid': 'Ingrid C. /Solberg/', 'arne': 'Arne Olaf /Solberg/'})
        row, = data['non-prose', 'associations']['authoredHeadingsAndCaptions']
        return changes, row

    def test_a_new_heading_naming_nobody_in_full_is_catalogued_unlinked(self):
        changes, row = self.run_with("Ingrid's parents, the Solbergs of Minneapolis")
        self.assertEqual((row['kind'], row['associations']), ('authored-heading', []))
        self.assertEqual(len(changes), 1)

    def test_a_new_heading_links_a_person_it_names_in_full(self):
        _, row = self.run_with('Arne Olaf Solberg in Minneapolis')
        self.assertEqual([a['refn'] for a in row['associations']], ['arne'])


class InstalledBookTest(unittest.TestCase):
    DATA = {('non-prose', 'guards'): {'notes': [{'id': 'loc-1', 'quote': 'Census, 1880.'},
                                                {'id': 'loc-2', 'quote': 'Herald, 1873.'}]}}

    def test_matching_installed_book_passes(self):
        check_installed_matches(self.DATA, [('loc-1', 'Census, 1880.'), ('loc-2', 'Herald, 1873.')])

    def test_a_later_trial_build_is_refused(self):
        with self.assertRaises(ValueError):
            check_installed_matches(self.DATA, [('loc-1', 'Tribune, 1890.'), ('loc-2', 'Census, 1900.')])


class NewChartTest(unittest.TestCase):
    def test_a_one_parent_chart_links_its_one_person(self):
        caption = 'Chart 14: Olaf Solberg. Later generations: no. 11 in Chart 13.'
        page = Node('body', {}, [Node('h2', {'id': 'ch-test'}, ['A family']), Node(
            'figure', {'class': 'native-book-chart', 'id': 'chart-solberg-22'},
            [Node('img', {'data-book-original': 'book-assets/x.svg'}, []), Node('figcaption', {}, [caption])])])
        data = {('non-prose', 'associations'): {'authoredHeadingsAndCaptions': []},
                ('non-prose', 'guards'): {'captionGuards': []},
                ('non-prose', 'preserved'): {'figures': []}}
        catalogue_new_charts(page, index_blocks(page, {'ch-test'}), ['NP-F001'], data,
                             {'olaf-solberg-1838': 'Olaf /Solberg/'})
        row, = data['non-prose', 'associations']['authoredHeadingsAndCaptions']
        self.assertEqual([a['refn'] for a in row['associations']], ['olaf-solberg-1838'])


    def test_a_one_name_chart_over_a_known_couple_links_the_named_parent(self):
        # Two published Paul Kesslers: the chart's number, not the name, picks him.
        caption = 'Chart 58: Paul Kessler. Later generations: no. 4101 in Chart 47.'
        row = lambda n, refn, name: Node('tr', {}, [Node('td', {}, [n]), Node('td', {}, [
            Node('a', {'href': '#reg-' + refn}, [name])]), Node('td', {}, ['']), Node('td', {}, [''])])
        page = Node('body', {}, [Node('h2', {'id': 'ch-test'}, ['A family']), Node(
            'figure', {'class': 'native-book-chart', 'id': 'chart-kessler-16406'},
            [Node('img', {'data-book-original': 'book-assets/x.svg'}, []), Node('figcaption', {}, [caption])]),
            Node('table', {}, [row('16406', 'paul-kessler-hamburg', 'Paul Kessler'),
                               row('16407', 'anna-vogel-kessler', 'Anna Vogel')])])
        data = {('non-prose', 'associations'): {'authoredHeadingsAndCaptions': []},
                ('non-prose', 'guards'): {'captionGuards': []},
                ('non-prose', 'preserved'): {'figures': []}}
        catalogue_new_charts(page, index_blocks(page, {'ch-test'}), ['NP-F001'], data,
                             {'paul-kessler-hamburg': 'Paul /Kessler/', 'paul-kessler-bremen': 'Paul /Kessler/',
                              'anna-vogel-kessler': 'Anna /Vogel/'})
        found, = data['non-prose', 'associations']['authoredHeadingsAndCaptions']
        self.assertEqual([a['refn'] for a in found['associations']], ['paul-kessler-hamburg'])

if __name__ == '__main__':
    unittest.main()
