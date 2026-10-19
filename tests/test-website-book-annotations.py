"""Identity, staleness and manuscript-preservation checks for reader links."""
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
import tempfile
import unittest

import sys
SCRIPTS = Path(__file__).resolve().parent.parent / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from website_native_book import Node
from website_book_annotations import annotate as apply_annotations, normalized, Catalogue, content_digest, load_catalogue


def annotate(body, value, people, geography, *, edition_date=None):
    # Unit fixtures represent deliberately reviewed inputs. The full-corpus
    # probe and loader tests use the mandatory on-disk source verification.
    catalogue = Catalogue(tuple(value['parts']), value['scope'], (),
                          content_digest({'parts': value['parts'], 'scope': value['scope']}))
    return apply_annotations(body, catalogue, people, geography, edition_date=edition_date)


def fixture(children=None):
    paragraph = Node('p', {}, children or ['Edith met Karin.'])
    body = Node('body', {}, [Node('h2', {'id': 'ch-test'}, ['A family']), paragraph])
    quote = normalized(paragraph.text({'doc-noteref'}))
    p = {'id': 'P-1', 'chapter': 'ch-test', 'section': 'ch-test', 'quote': quote,
         'sha256': sha256(quote.encode()).hexdigest(), 'associations': []}
    part = {'associations': {'passages': [p]}, 'guards': {'guards': []},
            'contexts': {'locationRecords': {}, 'mentions': []}}
    catalogue = {'schema': 1, 'parts': [part],
                 'scope': {'authoredChapters':['ch-test'], 'separateChapters':[]}}
    return body, catalogue, {'edith': 'Edith /Penhallow/', 'karin': 'Karin /Solberg/'}, {'locations': [], 'places': []}


def mention(catalogue, text, target='edith', occurrence=1):
    passage = catalogue['parts'][0]['associations']['passages'][0]
    quote = passage['quote']
    position = -1
    for _ in range(occurrence):
        position = quote.index(text, position + 1)
    association = {'id': f"P-1-A{len(passage['associations']) + 1}", 'kind': 'person',
                   'refn': target, 'targetName': {'edith': 'Edith /Penhallow/', 'karin': 'Karin /Solberg/'}[target],
                   'selector': {'exact': text, 'occurrence': occurrence, 'start': position,
                                'end': position + len(text), 'prefix': quote[:position],
                                'suffix': quote[position + len(text):]}}
    passage['associations'].append(association)
    return association


class Annotations(unittest.TestCase):
    def reject(self, args, pattern):
        before = args[0].html()
        with self.assertRaisesRegex(ValueError, pattern):
            annotate(*args)
        self.assertEqual(args[0].html(), before, 'Failed validation must preserve the manuscript')

    def test_unicode_offsets_repeated_names_and_original_whitespace(self):
        args = fixture(['An album 🎨: Edith, then\n\u00a0Edith and Karin.'])
        mention(args[1], 'Edith', occurrence=2)
        mention(args[1], 'Karin', target='karin')
        original = args[0].text()
        result = annotate(*args)
        self.assertEqual(result['counts']['mentions'], 2)
        self.assertEqual(args[0].text(), original)
        self.assertIn('An album 🎨: Edith, then\n\u00a0<a', args[0].html())
        self.assertEqual([n.text() for n in args[0].nodes() if 'data-book-mention' in n.attrs], ['Edith', 'Karin'])

    def test_existing_register_link_keeps_destination_and_number(self):
        args = fixture([Node('a', {'href': '#reg-edith'}, ['Edith (no.\u00a01)']), ' met Karin.'])
        mention(args[1], 'Edith')
        annotate(*args)
        links = [n for n in args[0].nodes() if n.tag == 'a']
        self.assertEqual(len(links), 1)
        self.assertEqual(links[0].attrs['href'], '#reg-edith')
        self.assertEqual(links[0].text(), 'Edith (no.\u00a01)')

    def test_wrong_register_person_cannot_gain_a_correct_looking_preview(self):
        args = fixture([Node('a', {'href': '#reg-karin'}, ['Edith (no. 1)']), ' met Karin.'])
        mention(args[1], 'Edith')
        self.reject(args, 'different person')

    def test_formatted_address_retains_italic_suffix(self):
        args = fixture(['At ', Node('em', {}, ['12b']), ' Chapel Street, Edith lived.'])
        a = mention(args[1], '12b Chapel Street')
        a.update(kind='place', placeId='address', targetName='12b Chapel Street, Penzance',
                 locationId='penzance', relation='within-locality', geographyNote='Town reference only.')
        args[3]['places'].append({'id':'address','name':a['targetName'],'location':'penzance',
                                  'relation':'within-locality','note':'Town reference only.'})
        mention(args[1], 'Edith')
        original_em = next(n for n in args[0].nodes() if n.tag == 'em').html()
        result = annotate(*args)
        linked = next(n for n in args[0].nodes() if n.attrs.get('data-book-mention') == a['id'])
        self.assertEqual(linked.text(), '12b Chapel Street')
        self.assertEqual(next(n for n in linked.nodes() if n.tag == 'em').html(), original_em)
        self.assertEqual(result['mentions'][0]['qualifications'], ['Town reference only.'])

    def test_partial_formatted_range_does_not_split_semantic_markup(self):
        args = fixture([Node('em', {'id':'an-address'}, ['At 12b']), ' Chapel Street.'])
        mention(args[1], '12b Chapel Street')
        self.reject(args, 'partially selected or semantic')

    def test_changed_passage_is_not_found_by_name_alone(self):
        args = fixture(); mention(args[1], 'Edith')
        args[0].children[-1].children = ['Edith did not meet Karin.']
        self.reject(args, 'expected one exact passage')

    def test_unreviewed_new_paragraph_requires_a_decision(self):
        args = fixture(); mention(args[1], 'Edith')
        args[0].children.append(Node('p', {}, ['Karin worked here.']))
        self.reject(args, 'coverage changed')

    def test_ambiguous_duplicate_passage_is_rejected(self):
        args = fixture(); mention(args[1], 'Edith')
        args[0].children.append(deepcopy(args[0].children[-1]))
        self.reject(args, 'found 2')

    def test_changed_identity_or_unpublished_profile_is_rejected(self):
        for change in ['absent', 'different']:
            args = fixture(); mention(args[1], 'Edith')
            if change == 'absent': args[2].pop('edith')
            else: args[2]['edith'] = 'Edith /Someone-else/'
            with self.subTest(change=change): self.reject(args, 'identity changed or unpublished')

    def test_offsets_occurrence_and_context_are_all_checked(self):
        for key, value in [('start', 1), ('occurrence', 2), ('prefix', 'Different'), ('suffix', 'Different')]:
            args = fixture(); a = mention(args[1], 'Edith'); a['selector'][key] = value
            with self.subTest(key=key): self.reject(args, 'selector')

    def test_overlapping_mentions_are_rejected(self):
        args = fixture(); mention(args[1], 'Edith'); mention(args[1], 'Edith')
        self.reject(args, 'overlapping mentions')

    def test_qualification_survives_while_footnote_marker_remains_unlinked(self):
        args = fixture(['Edith may be this person.', Node('a', {'role':'doc-noteref','href':'#note-1'}, ['7'])])
        mention(args[1], 'Edith')
        p = args[1]['parts'][0]['associations']['passages'][0]
        guard = {'passageId':'P-1','passageSha256':p['sha256'],'kind':'linked-native-note',
                 'noteAnchor':'note-1','exact':'7Identification remains uncertain.'}
        args[1]['parts'][0]['guards']['guards'].append(guard)
        args[0].children.append(Node('section', {'role':'doc-endnotes'}, [
            Node('li', {'id':'note-1'}, [Node('a', {'role':'doc-backlink','href':'#reference'}, ['7']),
                                      'Identification remains uncertain.'])]))
        result = annotate(*args)
        note = next(n for n in args[0].nodes() if n.attrs.get('role') == 'doc-noteref')
        self.assertNotIn('data-book-mention', note.attrs)
        self.assertEqual(result['passages'][0]['qualifications'][0]['text'], guard['exact'])

    def test_qualification_must_still_be_linked_from_its_passage(self):
        args = fixture(); mention(args[1], 'Edith')
        p = args[1]['parts'][0]['associations']['passages'][0]
        args[1]['parts'][0]['guards']['guards'].append({'passageId':'P-1','passageSha256':p['sha256'],
            'kind':'linked-native-note','noteAnchor':'note-1','exact':'Uncertain.'})
        args[0].children.append(Node('section', {'role':'doc-endnotes'}, [Node('li', {'id':'note-1'}, ['Uncertain.'])]))
        self.reject(args, 'no longer linked')

    def test_changed_qualification_witness_cannot_be_omitted(self):
        args = fixture(); mention(args[1], 'Edith')
        p = args[1]['parts'][0]['associations']['passages'][0]
        args[1]['parts'][0]['guards']['guards'].append({'passageId':'P-1','passageSha256':p['sha256'],
            'kind':'same-passage','exact':'The identification remains unproved.'})
        self.reject(args, 'qualification wording changed')

    def test_no_double_annotation(self):
        args = fixture(); mention(args[1], 'Edith'); annotate(*args)
        self.reject(args, 'only once')

    def test_unknown_person_with_null_name_is_rejected(self):
        args = fixture(); a = mention(args[1], 'Edith')
        a.update(refn='unknown-person', targetName=None)
        self.reject(args, 'identity changed or unpublished')

    def test_context_cannot_bypass_the_reviewed_locality_lane(self):
        args = fixture(); a = mention(args[1], 'Edith')
        a.update(kind='context', locationId='nonexistent-town', targetName='Unreviewed')
        self.reject(args, 'ordinary associations admit only')

    def test_new_authored_chapter_requires_review(self):
        args = fixture(); mention(args[1], 'Edith')
        args[0].children.extend([Node('h2', {'id':'ch-new'}, ['A new chapter']),
                                 Node('p', {}, ['Edith worked elsewhere.'])])
        self.reject(args, 'Unreviewed chapter')

    def test_deleting_a_part_cannot_delete_its_declared_scope(self):
        args = fixture(); args[1]['parts'].clear()
        self.reject(args, 'complete authored chapter inventory')

    def test_loaded_data_cannot_lose_guards_or_parts(self):
        args = fixture(); mention(args[1], 'Edith')
        value = args[1]
        catalogue = Catalogue(tuple(value['parts']), value['scope'], (),
                              content_digest({'parts':value['parts'],'scope':value['scope']}))
        value['parts'][0]['associations']['passages'].clear()
        with self.assertRaisesRegex(ValueError, 'changed after loading'):
            apply_annotations(args[0], catalogue, args[2], args[3])

    def test_dictionary_cannot_bypass_verified_loader(self):
        args = fixture()
        with self.assertRaisesRegex(ValueError, 'verified annotation catalogue loader'):
            apply_annotations(*args)

    def test_loader_requires_complete_unique_sources_with_exact_hashes(self):
        for mutation in ['none', 'renamed-parts', 'no-parts', 'duplicate-part', 'missing-source', 'duplicate-path', 'changed-bytes', 'bad-hash']:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary).resolve()
                value = fixture()[1]
                manifest = {'schema':1,'scope':value['scope'],'parts':[]}
                # A family names its prose parts; the part named non-prose is special.
                parts = (['opening', 'later-chapters', 'non-prose'] if mutation == 'renamed-parts'
                         else ['c1-c2','c3','remaining-prose','non-prose'])
                for part in parts:
                    row = {'id':part,'sources':{}}
                    names = ([('associations','associations.json'),('guards','required-context.json'),
                              ('contexts','book-only-locations.json'),('coverage','coverage.json'),
                              ('preserved','preserve-existing.json'),('corrections','destination-corrections.json')]
                             if part == 'non-prose' else
                             [('associations','associations.json'),('guards','qualification-guards.json'),('contexts','book-only-locations.json')])
                    for key, filename in names:
                        relative = f'book-annotations/{part}/{filename}'
                        path = root / relative; path.parent.mkdir(parents=True, exist_ok=True)
                        data = json.dumps(value['parts'][0].get(key, {})).encode(); path.write_bytes(data)
                        row['sources'][key] = {'path':relative,'sha256':sha256(data).hexdigest()}
                    manifest['parts'].append(row)
                if mutation == 'no-parts': manifest['parts'] = []
                elif mutation == 'duplicate-part': manifest['parts'][2] = manifest['parts'][1]
                elif mutation == 'missing-source': manifest['parts'][0]['sources'].pop('guards')
                elif mutation == 'duplicate-path': manifest['parts'][0]['sources']['guards']['path'] = manifest['parts'][0]['sources']['associations']['path']
                elif mutation == 'changed-bytes': (root / manifest['parts'][0]['sources']['guards']['path']).write_text('{"guards":[]}')
                elif mutation == 'bad-hash': manifest['parts'][0]['sources']['guards']['sha256'] = '0' * 64
                path = root / 'book-annotations.json'; path.write_text(json.dumps(manifest))
                if mutation in ('none', 'renamed-parts'):
                    catalogue = load_catalogue(path)
                    self.assertEqual(len(catalogue.parts), len(parts))
                    self.assertEqual(len(catalogue.inputs), 1 + 3 * (len(parts) - 1) + 6)
                    self.assertEqual(catalogue.parts[-1]['review'], 'non-prose')
                else:
                    with self.assertRaises(ValueError): load_catalogue(path)


    def test_a_family_without_a_manifest_has_no_reader_annotations(self):
        with tempfile.TemporaryDirectory() as temporary:
            catalogue = load_catalogue(Path(temporary) / 'book-annotations.json')
        self.assertEqual(catalogue.parts, ())
        body, _, people, geography = fixture()
        before = body.html()
        result = apply_annotations(body, catalogue, people, geography)
        self.assertEqual((result['passages'], result['mentions']), ([], []))
        self.assertEqual(result['counts']['passages'], 0)
        self.assertEqual(body.html(), before)


class EditionDates(unittest.TestCase):
    @staticmethod
    def dated(quote='Compiled on September 23, 2026.', exact='September 23, 2026',
              kind='full-date', occurrence=1):
        args = fixture([quote])
        p = args[1]['parts'][0]['associations']['passages'][0]
        start = -1
        for _ in range(occurrence):
            start = quote.index(exact, start + 1)
        end = start + len(exact)
        p['generatedEditionDate'] = {'reviewedDate': '2026-09-23', 'format': kind,
            'selector': {'exact': exact, 'occurrence': occurrence, 'start': start, 'end': end,
                         'prefix': quote[:start], 'suffix': quote[end:]}}
        return args

    def test_receipt_date_survives_day_month_year_and_digit_width_changes(self):
        for value, printed in [('2026-09-24', 'September 24, 2026'),
                               ('2026-10-01', 'October 01, 2026'),
                               ('2027-01-01', 'January 01, 2027'),
                               ('2000-02-29', 'February 29, 2000')]:
            args = self.dated()
            args[0].children[-1].children = ['Compiled on ' + printed + '.']
            before = args[0].text()
            with self.subTest(value=value):
                result = annotate(*args, edition_date=value)
                self.assertEqual(args[0].text(), before)
                self.assertEqual(result['generatedEditionDates'][0]['editionDate'], value)
                self.assertEqual(result['passages'][0]['sha256'], sha256(before.split('A family')[-1].encode()).hexdigest())
                self.assertEqual(args[1]['parts'][0]['associations']['passages'][0]['quote'],
                                 'Compiled on September 23, 2026.')

    def test_a_book_that_writes_the_day_first_still_matches_a_reviewed_passage(self):
        # Books now print "1 October 2026"; a passage reviewed earlier holds
        # "September 23, 2026". Either reviewed style resolves to the book's own.
        for quote, exact in [('Compiled on September 23, 2026.', 'September 23, 2026'),
                             ('Compiled on 23 September 2026.', '23 September 2026')]:
            args = self.dated(quote, exact)
            args[0].children[-1].children = ['Compiled on 1 October 2026.']
            with self.subTest(quote=quote):
                result = annotate(*args, edition_date='2026-10-01')
                self.assertEqual(result['generatedEditionDates'][0]['editionDate'], '2026-10-01')
        args = self.dated()
        args[0].children[-1].children = ['Compiled on 2 October 2026.']
        with self.assertRaisesRegex(ValueError, 'expected one exact passage'):
            annotate(*args, edition_date='2026-10-01')

    def test_title_month_changes_but_documented_person_count_stays_literal(self):
        args = self.dated('September 2026 edition — 87 documented persons',
                          'September 2026', 'month-year')
        args[0].children[-1].children = ['January 2027 edition — 87 documented persons']
        result = annotate(*args, edition_date='2027-01-01')
        self.assertEqual(result['generatedEditionDates'][0]['format'], 'month-year')
        bad = self.dated('September 2026 edition — 87 documented persons',
                         'September 2026', 'month-year')
        bad[0].children[-1].children = ['January 2027 edition — 88 documented persons']
        with self.assertRaisesRegex(ValueError, 'expected one exact passage'):
            annotate(*bad, edition_date='2027-01-01')

    def test_same_literal_historical_date_is_never_replaced(self):
        quote = 'A letter dated September 23, 2026. Compiled on September 23, 2026.'
        args = self.dated(quote, occurrence=2)
        expected = 'A letter dated September 23, 2026. Compiled on October 01, 2026.'
        args[0].children[-1].children = [expected]
        annotate(*args, edition_date='2026-10-01')
        self.assertEqual(args[0].children[-1].text(), expected)
        bad = self.dated(quote, occurrence=2)
        bad[0].children[-1].children = [expected.replace('letter dated September 23', 'letter dated September 24')]
        before = bad[0].html()
        with self.assertRaisesRegex(ValueError, 'expected one exact passage'):
            annotate(*bad, edition_date='2026-10-01')
        self.assertEqual(bad[0].html(), before)

    def test_changed_surrounding_prose_or_wrong_rendered_date_is_rejected(self):
        for text in ['Not compiled on September 24, 2026.', 'Compiled on September 25, 2026.']:
            args = self.dated()
            args[0].children[-1].children = [text]
            before = args[0].html()
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, 'expected one exact passage'):
                annotate(*args, edition_date='2026-09-24')
            self.assertEqual(args[0].html(), before)

    def test_missing_invalid_receipt_or_declaration_is_rejected(self):
        for value in [None, '', 'September 24, 2026', '2026-02-30', '20260924', 20260924]:
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'edition date'):
                annotate(*self.dated(), edition_date=value)
        for field, value in [('reviewedDate', '2026-09-22'), ('format', 'historical-date')]:
            args = self.dated()
            args[1]['parts'][0]['associations']['passages'][0]['generatedEditionDate'][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'edition-date'):
                annotate(*args, edition_date='2026-09-23')

    def test_original_hash_and_exact_span_remain_required(self):
        for kind in ['hash', 'offset', 'occurrence']:
            args = self.dated()
            p = args[1]['parts'][0]['associations']['passages'][0]
            if kind == 'hash':
                p['sha256'] = '0' * 64
            else:
                selector = p['generatedEditionDate']['selector']
                selector['start' if kind == 'offset' else 'occurrence'] += 1
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, 'changed'):
                annotate(*args, edition_date='2026-09-23')

    def test_identity_offsets_cannot_be_silently_rebased(self):
        for name in ['associations', 'existingLinks', 'withheld']:
            args = self.dated()
            args[1]['parts'][0]['associations']['passages'][0][name] = [{'reason': 'Needs its own review'}]
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'identity selectors'):
                annotate(*args, edition_date='2026-09-23')

    def test_undeclared_date_still_requires_exact_reviewed_text(self):
        args = fixture(['Historical date: September 23, 2026.'])
        args[0].children[-1].children = ['Historical date: September 24, 2026.']
        with self.assertRaisesRegex(ValueError, 'expected one exact passage'):
            annotate(*args, edition_date='2026-09-24')


def nonprose_fixture():
    args = fixture()
    body, catalogue, _, geography = args
    catalogue['scope']['separateChapters'] = [
        {'chapter': 'reg-ch-test', 'lane': 'generated-register'},
        {'chapter': 'bibliography', 'lane': 'source-apparatus'}]
    caption = 'Edith at Bodmin; the exact site is unknown.'
    register = 'Karin was probably in Bodmin.'
    body.children.extend([
        Node('figure', {'class': 'native-book-figure'}, [Node('figcaption', {}, [caption])]),
        Node('h2', {'id': 'reg-ch-test'}, ['Register']),
        Node('h4', {'id': 'reg-edith'}, ['Edith']),
        Node('p', {}, [Node('span', {'id': 'reg-collateral-karin'}, ['Karin']),
                       ' was probably in Bodmin.',
                       Node('a', {'href': '#note-1', 'role': 'doc-noteref'}, ['7'])]),
        Node('h2', {'id': 'bibliography'}, ['References']),
        Node('section', {'role': 'doc-endnotes'}, [Node('li', {'id': 'note-1'}, [
            Node('a', {'href': '#ref-1', 'role': 'doc-backlink'}, ['7']),
            'Only a probable locality.'])])])

    def row(ident, kind, quote, chapter='reg-ch-test', **fields):
        return {'id': ident, 'kind': kind, 'quote': quote, 'sha256': sha256(quote.encode()).hexdigest(),
                'chapter': chapter, 'section': chapter, 'associations': [], **fields}

    def person(row, text, target):
        start = row['quote'].index(text)
        row['associations'].append({'id': row['id'] + '-PERSON', 'kind': 'person', 'refn': target,
             'targetName': args[2][target], 'selector': {'exact': text, 'start': start,
              'end': start+len(text), 'occurrence': 1, 'prefix': row['quote'][:start],
              'suffix': row['quote'][start+len(text):]}})

    heading = row('NP-H001', 'authored-heading', 'A family', 'ch-test', elementId='ch-test', assetPaths=[])
    cap = row('NP-F001', 'figure-caption', caption, 'ch-test', elementId=None, assetPaths=[])
    person(cap, 'Edith', 'edith')
    register_title = row('NP-H002', 'generated-heading', 'Register', elementId='reg-ch-test')
    edith = row('NP-H003', 'generated-heading', 'Edith', elementId='reg-edith')
    person(edith, 'Edith', 'edith')
    references = row('NP-H004', 'generated-heading', 'References', 'bibliography', elementId='bibliography')
    karin = row('NP-C001', 'collateral-entry', register, elementId='reg-collateral-karin')
    person(karin, 'Karin', 'karin')
    note = {'id': 'note-1', 'quote': 'Only a probable locality.',
            'sha256': sha256(b'Only a probable locality.').hexdigest(), 'markers': []}
    place = row('NP-R001', 'register-block', register, registerHeading='reg-edith', containerTag='p',
                noteIds=['note-1'], requiredNoteWitnesses=[note])
    start = register.index('Bodmin')
    place['associations'] = [{'id': 'NP-R001-PLACE', 'kind': 'place', 'placeId': 'bodmin-likely',
        'targetName': 'Bodmin (likely)', 'locationId': 'bodmin', 'relation': 'within-locality',
        'geographyNote': 'Only a probable locality.',
        'selector': {'exact': 'Bodmin', 'start': start, 'end': start+6,
                     'occurrence': 1, 'prefix': 'Karin was probably in ', 'suffix': '.'}}]
    geography['places'] = [{'id': 'bodmin-likely', 'name': 'Bodmin (likely)',
                            'location': 'bodmin', 'relation': 'within-locality', 'note': 'Only a probable locality.'}]
    prose = catalogue['parts'][0]['associations']['passages'][0]
    part = {'review': 'non-prose',
        'associations': {'authoredHeadingsAndCaptions': [heading, cap],
                         'registerPeople': [edith, karin], 'registerPlaces': [place]},
        'coverage': {'registerBlocks': [deepcopy(place)],
                     'generatedHeadings': [register_title, deepcopy(edith), references]},
        'preserved': {'figures': [{'id': 'NP-F001', 'assetPaths': [], 'imageLinks': [], 'captionLinks': []}],
            'ahnentafelKnownRows': [], 'ahnentafelUnknownNumbers': [], 'links': [
            {'href': '#note-1', 'text': '', 'role': 'doc-noteref', 'image': False},
            {'href': '#ref-1', 'text': '7', 'role': 'doc-backlink', 'image': False}]},
        'corrections': {'links': []},
        'contexts': {'mentions': [], 'locationRecords': {}},
        'guards': {'captionGuards': [{'blockId': cap['id'], 'quote': caption, 'sha256': cap['sha256'], 'assetPaths': []}],
            'crossPassageGuards': [{'blockId': cap['id'], 'passageId': prose['id'], 'section': 'ch-test',
                                    'quote': prose['quote'], 'sha256': prose['sha256']}],
            'unmarkedEndnoteGuards': [note]}}
    catalogue['parts'].append(part)
    return args


def linked_nonprose_fixture(attachment='footnote'):
    """Reviewed people-only block with a direct note and its source appendix."""
    from website_book_nonprose import index_blocks, links
    args = nonprose_fixture()
    body, catalogue, _, _ = args
    part = catalogue['parts'][-1]
    part['associations']['registerPlaces'] = []
    part['guards']['unmarkedEndnoteGuards'] = []
    block = body.children[5]
    block.children.insert(-1, ' ')
    block.children.insert(-1, Node('a', {'href': '#sources-karin'}, ['Sources for Karin']))
    block_quote = normalized(block.text({'doc-noteref'}))
    person_row = part['associations']['registerPeople'][-1]
    for row in [person_row, part['coverage']['registerBlocks'][0]]:
        row.update(quote=block_quote, sha256=sha256(block_quote.encode()).hexdigest())
    person_row['associations'][0]['selector']['suffix'] = block_quote[len('Karin'):]
    note = body.children[-1].children[0]
    note.children[1:] = ['A ', Node('a', {'href': 'https://example.test/account'}, ['family account']),
        ': the wedding year and town come from memory alone.',
        Node('span', {'data-book-person': 'karin', 'data-book-key': 'karin-witness'})]
    source_note = Node('div', {'id': 'book-note-karin', 'data-book-note': ''}, [
        'The second parent is named in one letter only.',
        Node('span', {'data-register-person': 'karin', 'data-register-key': 'karin-identity'}),
        Node('span', {'data-book-person': 'karin', 'data-book-key': 'karin-identity'})])
    body.children.extend([
        Node('h4', {'id': 'sources-karin'}, ['Sources for Karin']), source_note,
        Node('h4', {'id': 'sources-edith'}, ['Sources for Edith']),
        Node('div', {'id': 'book-note-edith', 'data-book-note': ''}, ['A different source account.'])])
    indexed = index_blocks(body, {'ch-test'})
    part['coverage']['generatedHeadings'] = [deepcopy(row) for row, _ in indexed.values()
                                            if row['kind'] == 'generated-heading']
    part['preserved']['links'] = links(body)
    selected_note = note if attachment == 'footnote' else source_note
    quote = normalized(selected_note.text({'doc-noteref', 'doc-backlink'}))
    part['guards']['linkedNoteGuards'] = [{
        'id': 'LINKED-NOTE-1', 'blockId': 'NP-C001',
        'blockQuote': block_quote, 'blockSha256': sha256(block_quote.encode()).hexdigest(),
        'attachment': attachment,
        'sourceAnchor': None if attachment == 'footnote' else 'sources-karin',
        'noteWitness': {'id': selected_note.attrs['id'], 'quote': quote,
            'sha256': sha256(quote.encode()).hexdigest(),
            'markers': [{'person': 'karin', 'key': 'karin-witness' if attachment == 'footnote'
                        else 'karin-identity'}],
            'existingLinks': [{k: row[k] for k in ['text', 'href', 'role']}
                              for row in links(selected_note)]}}]
    return args


class LinkedNonProseNotes(unittest.TestCase):
    reject = Annotations.reject

    def refresh_links(self, args):
        # Isolate the new relationship check from the global link inventory.
        from website_book_nonprose import links
        args[1]['parts'][-1]['preserved']['links'] = links(args[0])

    def test_complete_note_survives_both_honest_attachment_modes(self):
        from website_book_annotations import _restore_html
        for mode in ['footnote', 'source-apparatus']:
            args = linked_nonprose_fixture(mode)
            original = args[0].html()
            witness = args[1]['parts'][-1]['guards']['linkedNoteGuards'][0]['noteWitness']
            with self.subTest(mode=mode):
                result = annotate(*args)
                karin = next(m for m in result['mentions'] if m['target'] == 'karin')
                block = next(p for p in result['passages'] if p['id'] == karin['passage'])
                self.assertEqual(block['qualifications'], [{
                    'text': witness['quote'], 'kind': 'linked-native-note', 'note': witness['id']}])
                self.assertEqual(result['counts']['guards'], 3)
                self.assertEqual(_restore_html(args[0]).html(), original)

    def test_removed_qualification_changed_body_owner_or_key_fails_atomically(self):
        for mode in ['footnote', 'source-apparatus']:
            for change in ['qualification', 'extra-body', 'owner', 'key', 'missing-note']:
                args = linked_nonprose_fixture(mode)
                witness = args[1]['parts'][-1]['guards']['linkedNoteGuards'][0]['noteWitness']
                note = next(n for n in args[0].nodes() if n.attrs.get('id') == witness['id'])
                if change == 'qualification':
                    phrase = 'and town come from memory alone' if mode == 'footnote' else 'named in one letter only'
                    note.children = [c.replace(phrase, 'supplied') if isinstance(c, str) else c
                                     for c in note.children]
                elif change == 'extra-body': note.children.append(' A new unreviewed claim.')
                elif change == 'missing-note': note.attrs['id'] = 'different-note'
                else:
                    marker = next(n for n in note.nodes() if 'data-book-person' in n.attrs)
                    marker.attrs['data-book-person' if change == 'owner' else 'data-book-key'] = 'other-owner-or-key'
                self.refresh_links(args)
                with self.subTest(mode=mode, change=change):
                    self.reject(args, 'note.*(wording|source-use|missing)|Required note')

    def test_detached_note_or_source_navigation_cannot_be_replaced_by_other_block(self):
        for mode in ['footnote', 'source-apparatus']:
            args = linked_nonprose_fixture(mode)
            block = args[0].children[5]
            target = '#note-1' if mode == 'footnote' else '#sources-karin'
            link = next(c for c in block.children if isinstance(c, Node) and c.attrs.get('href') == target)
            block.children[block.children.index(link)] = link.text() if mode == 'source-apparatus' else ''
            if mode == 'footnote':
                args[0].children[1].children.append(link)
            else:
                # Put the same target on another paragraph without changing
                # that paragraph's reviewed visible words.
                link.children = ['Edith met Karin.']
                args[0].children[1].children = [link]
            self.refresh_links(args)
            with self.subTest(mode=mode): self.reject(args, 'attachment|navigation|linked')

    def test_foreign_source_heading_or_note_group_is_rejected(self):
        for change in ['navigation', 'note-group', 'register-owner']:
            args = linked_nonprose_fixture('source-apparatus')
            note = next(n for n in args[0].nodes() if n.attrs.get('id') == 'book-note-karin')
            if change == 'navigation':
                link = next(n for n in args[0].children[5].nodes() if n.attrs.get('href') == '#sources-karin')
                link.attrs['href'] = '#sources-edith'
            elif change == 'note-group':
                args[0].children.remove(note)
                args[0].children.append(note)
            else:
                next(n for n in note.nodes() if 'data-register-person' in n.attrs).attrs['data-register-person'] = 'edith'
            self.refresh_links(args)
            with self.subTest(change=change): self.reject(args, 'source.*(heading|group|owner|navigation|source-use)|navigation')

    def test_same_physical_collateral_and_register_views_add_one_qualification(self):
        for mode in ['footnote', 'source-apparatus']:
            args = linked_nonprose_fixture(mode)
            guards = args[1]['parts'][-1]['guards']['linkedNoteGuards']
            alias = deepcopy(guards[0]); alias.update(id='LINKED-NOTE-2', blockId='NP-R001')
            guards.append(alias)
            with self.subTest(mode=mode):
                result = annotate(*args)
                karin = next(m for m in result['mentions'] if m['target'] == 'karin')
                block = next(p for p in result['passages'] if p['id'] == karin['passage'])
                self.assertEqual(len(block['qualifications']), 1)
                self.assertEqual(result['counts']['guards'], 3)

    def test_two_distinct_attached_notes_on_one_block_remain_two_witnesses(self):
        args = linked_nonprose_fixture('footnote')
        appendix = linked_nonprose_fixture('source-apparatus')
        second = deepcopy(appendix[1]['parts'][-1]['guards']['linkedNoteGuards'][0])
        second['id'] = 'LINKED-NOTE-2'
        args[1]['parts'][-1]['guards']['linkedNoteGuards'].append(second)
        result = annotate(*args)
        karin = next(m for m in result['mentions'] if m['target'] == 'karin')
        block = next(p for p in result['passages'] if p['id'] == karin['passage'])
        self.assertEqual({q['note'] for q in block['qualifications']}, {'note-1', 'book-note-karin'})
        self.assertEqual(result['counts']['guards'], 4)

    def test_guard_cannot_omit_full_note_body_hash_or_use_another_indexed_block(self):
        for mode in ['footnote', 'source-apparatus']:
            for change in ['shorter-quote', 'hash', 'other-block', 'duplicate-note', 'unknown-mode']:
                args = linked_nonprose_fixture(mode)
                guard = args[1]['parts'][-1]['guards']['linkedNoteGuards'][0]
                witness = guard['noteWitness']
                if change == 'shorter-quote':
                    witness['quote'] = 'A partial note.'
                    witness['sha256'] = sha256(witness['quote'].encode()).hexdigest()
                elif change == 'hash': witness['sha256'] = '0' * 64
                elif change == 'other-block': guard['blockId'] = 'NP-H003'
                elif change == 'unknown-mode': guard['attachment'] = 'inferred-relationship'
                else:
                    note = next(n for n in args[0].nodes() if n.attrs.get('id') == witness['id'])
                    args[0].children.append(deepcopy(note))
                    self.refresh_links(args)
                with self.subTest(mode=mode, change=change):
                    self.reject(args, 'note.*(wording|block|attachment)|Required note')

    def test_optional_absent_or_empty_lane_preserves_existing_catalogue_output(self):
        original = nonprose_fixture()
        empty = deepcopy(original)
        empty[1]['parts'][-1]['guards']['linkedNoteGuards'] = []
        self.assertEqual(annotate(*original), annotate(*empty))
        self.assertEqual(original[0].html(), empty[0].html())


class NonProse(unittest.TestCase):
    reject = Annotations.reject
    def test_caption_and_collateral_register_keep_complete_context(self):
        args = nonprose_fixture()
        original = args[0].html()
        result = annotate(*args)
        from website_book_annotations import _restore_html
        self.assertEqual(_restore_html(args[0]).html(), original)
        self.assertEqual(result['counts']['mentions'], 4)
        self.assertEqual(result['counts']['kinds'], {'person': 3, 'place': 1})
        karin = next(m for m in result['mentions'] if m['target'] == 'karin')
        town = next(m for m in result['mentions'] if m['kind'] == 'place')
        self.assertEqual(karin['passage'], town['passage'])
        context = next(p for p in result['passages'] if p['id'] == town['passage'])
        self.assertIn('Karin was probably in Bodmin.', [q['text'] for q in context['qualifications']])
        self.assertIn('Only a probable locality.', [q['text'] for q in context['qualifications']])
        caption = next(p for p in result['passages'] if p['id'] == 'NP-F001')
        self.assertIn('Edith at Bodmin; the exact site is unknown.', [q['text'] for q in caption['qualifications']])
        self.assertIn('Edith met Karin.', [q['text'] for q in caption['qualifications']])

    def test_entire_caption_or_generated_heading_cannot_disappear(self):
        for lane in ['caption', 'heading', 'register']:
            args = nonprose_fixture(); part = args[1]['parts'][-1]
            if lane == 'caption': part['associations']['authoredHeadingsAndCaptions'].pop()
            elif lane == 'heading': part['coverage']['generatedHeadings'].pop()
            else: part['coverage']['registerBlocks'].clear()
            with self.subTest(lane=lane): self.reject(args, 'coverage changed')

    def test_unchanged_name_cannot_hide_changed_probability_or_attached_note(self):
        for change in ['probability', 'note', 'note-target']:
            args = nonprose_fixture()
            if change == 'probability': args[0].children[5].children[1] = ' was in Bodmin.'
            elif change == 'note': args[0].children[-1].children[0].children[-1] = 'An exact site.'
            else: args[0].children[5].children[-1].attrs['href'] = '#different-note'
            with self.subTest(change=change): self.reject(args, 'changed|missing')

    def test_collateral_marker_and_primary_profile_entrypoint_are_required(self):
        for change in ['marker', 'entrypoint']:
            args = nonprose_fixture()
            if change == 'marker': args[0].children[5].children[0].attrs['id'] = 'reg-collateral-edith'
            else: args[1]['parts'][-1]['associations']['registerPeople'].pop()
            with self.subTest(change=change): self.reject(args, 'changed|entrypoint')

    def test_unqualified_same_town_is_not_an_allowed_fallback(self):
        args = nonprose_fixture()
        args[3]['places'][0]['name'] = 'Bodmin'
        self.reject(args, 'place identity/context changed')

    def test_figure_target_and_accessible_label_are_checked_independently_of_href(self):
        for mutation in ['none', 'target', 'label']:
            args = nonprose_fixture(); part = args[1]['parts'][-1]
            path = 'images/family.jpg'
            attrs = {'href': '/data/' + path, 'data-book-image': path, 'aria-label': 'Open the family photograph'}
            control = Node('a', dict(attrs), [Node('img', {'data-book-original': path})])
            args[0].children[2].children.insert(0, control)
            part['associations']['authoredHeadingsAndCaptions'][1]['assetPaths'] = [path]
            part['guards']['captionGuards'][0]['assetPaths'] = [path]
            part['preserved']['figures'][0].update(assetPaths=[path], imageLinks=[attrs])
            part['preserved']['links'].insert(0, {'href': attrs['href'], 'text': '', 'role': None, 'image': True})
            if mutation == 'target': control.attrs['data-book-image'] = 'images/different.jpg'
            elif mutation == 'label': control.attrs['aria-label'] = 'A different family'
            with self.subTest(mutation=mutation):
                if mutation == 'none': annotate(*args)
                else: self.reject(args, 'figure or caption controls changed')

    def test_table_keeps_known_dates_and_exact_unknown_placeholders(self):
        for mutation in ['none', 'known-date', 'unknown-name', 'unknown-date', 'missing-row', 'duplicate-row']:
            args = nonprose_fixture(); part = args[1]['parts'][-1]
            header = Node('tr', {}, [Node('th', {}, [text]) for text in ['no.', 'person', 'born', 'died']])
            known = Node('tr', {}, [Node('td', {}, ['1']), Node('td', {}, [Node('a', {'href': '#reg-edith'}, ['Edith'])]),
                                    Node('td', {}, ['2 March 1950']), Node('td', {}, [])])
            unknown = Node('tr', {}, [Node('td', {}, [text]) for text in ['36', '_____ _____', '', '']])
            table = Node('table', {}, [header, known, unknown]); args[0].children.insert(-1, table)
            part['preserved']['ahnentafelKnownRows'] = [{'number': '1', 'refn': 'edith', 'href': '#reg-edith',
                                                        'quote': ['1', 'Edith', '2 March 1950', '']}]
            part['preserved']['ahnentafelUnknownNumbers'] = ['36']
            part['preserved']['links'].insert(1, {'href': '#reg-edith', 'text': 'Edith', 'role': None, 'image': False})
            if mutation == 'known-date': known.children[2].children = ['A different date']
            elif mutation == 'unknown-name': unknown.children[1].children = ['Unreviewed ancestor']
            elif mutation == 'unknown-date': unknown.children[2].children = ['1800']
            elif mutation == 'missing-row': table.children.pop()
            elif mutation == 'duplicate-row': table.children.append(deepcopy(unknown))
            with self.subTest(mutation=mutation):
                if mutation == 'none': annotate(*args)
                else: self.reject(args, '[Aa]ncestor-table')


if __name__ == '__main__':
    unittest.main()
