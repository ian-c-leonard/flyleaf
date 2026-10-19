#!/usr/bin/env python3
"""Profile excerpts must retain complete reviewed prose and claim attachments."""
from copy import deepcopy
from hashlib import sha256
import unittest

import sys
from pathlib import Path
SCRIPTS = Path(__file__).resolve().parent.parent / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from website_native_book import Node
from website_book_profiles import build_profile_introductions, profile_block, profile_selector


def fixture():
    marker = Node('a', {'role': 'doc-noteref', 'id': 'ref-1', 'href': '#loc-1'},
                  [Node('sup', children=['12'])])
    paragraph = Node('div', {'data-book-passage': 'C1-004'}, [
        Node('a', {'data-book-mention': 'C1-004-A01'}, ['Tamsin']),
        ' graduated. ', marker, ' The year is not reported.'])
    text = 'Tamsin graduated. The year is not reported.'
    note = Node('li', {'id': 'loc-1'}, [
        Node('a', {'role': 'doc-backlink', 'href': '#ref-1'}, ['12']),
        Node('span', {'data-book-person': 'edith', 'data-book-key': 'graduation'},
             ['Family testimony. No degree or date inferred.'])])
    body = Node('root', children=[paragraph, Node('section', {'role': 'doc-endnotes'}, [note])])
    annotations = {'passages': [{'id': 'C1-004', 'chapter': 'ch-edith', 'section': 'nar-edith',
        'sha256': sha256(text.encode()).hexdigest(), 'mentions': ['C1-004-A01'],
        'qualifications': [{'kind': 'linked-native-note', 'text': 'No degree or date inferred.', 'note': 'loc-1'}]}],
        'mentions': [{'id': 'C1-004-A01', 'passage': 'C1-004', 'kind': 'person',
                      'target': 'tamsin-penhallow', 'name': 'Tamsin Grace /Penhallow/',
                      'label': 'Tamsin', 'qualifications': ['Edith’s sister, not her grandmother.']}]}
    citations = [{'person': 'edith', 'key': 'graduation', 'sourcePointer': '@SRC_PHOTO@',
                  'legacyNotes': [], 'label': 'Family photograph', 'url': '',
                  'locators': ['Testimony about graduation'], 'files': ['images/family/photo.jpg']}]
    block = profile_block(body, annotations, citations, 'C1-004', {'ch-edith', 'nar-edith'})
    selections = [{'person': 'tamsin-penhallow', 'blocks': [profile_selector(block)]}]
    return body, annotations, citations, selections


class ProfileIntroductionTests(unittest.TestCase):
    def setUp(self):
        self.body, self.annotations, self.citations, self.selections = fixture()

    def build(self):
        return build_profile_introductions(self.body, self.annotations, self.citations,
                                          self.selections, {'tamsin-penhallow', 'edith'},
                                          {'ch-edith', 'nar-edith'})

    def test_complete_wrapped_paragraph_retains_source_owner_and_clause_position(self):
        before = self.body.html()
        block = self.build()[0]['blocks'][0]
        self.assertEqual(block['text'], 'Tamsin graduated. The year is not reported.')
        self.assertEqual(block['notes'][0]['offset'], len('Tamsin graduated.'))
        self.assertEqual(block['notes'][0]['citations'], self.citations)
        self.assertEqual(block['notes'][0]['citations'][0]['person'], 'edith')
        self.assertEqual(block['notes'][0]['text'], 'Family testimony. No degree or date inferred.')
        self.assertEqual(block['mentions'][0]['qualifications'], ['Edith’s sister, not her grandmother.'])
        self.assertEqual(self.body.html(), before)

    def test_edited_prose_cannot_keep_old_review(self):
        self.body.children[0].children[-1] = ' The year is established.'
        with self.assertRaisesRegex(ValueError, 'reviewed text'):
            self.build()

    def test_same_words_with_changed_identity_qualification_or_source_are_rejected(self):
        for kind in ('identity', 'qualification', 'source', 'note-limit'):
            with self.subTest(kind=kind):
                self.setUp()
                if kind == 'identity':
                    self.annotations['mentions'][0]['target'] = 'edith'
                elif kind == 'qualification':
                    self.annotations['passages'][0]['qualifications'] = []
                elif kind == 'source':
                    self.citations[0]['sourcePointer'] = '@OTHER@'
                else:
                    self.body.children[1].children[0].children[1].children[0] = 'Family testimony.'
                with self.assertRaisesRegex(ValueError, 'review the selection'):
                    self.build()

    def test_wrong_owner_or_unreciprocated_attachment_fails(self):
        for kind in ('owner', 'return'):
            with self.subTest(kind=kind):
                self.setUp()
                note = self.body.children[1].children[0]
                if kind == 'owner':
                    note.children[1].attrs['data-book-person'] = 'tamsin-penhallow'
                else:
                    note.children[0].attrs['href'] = '#unrelated-marker'
                with self.assertRaises(ValueError):
                    self.build()

    def test_layout_note_renumbering_preserves_meaning(self):
        self.body.children[0].children[2].attrs['href'] = '#loc-29'
        self.body.children[1].children[0].attrs['id'] = 'loc-29'
        self.annotations['passages'][0]['qualifications'][0]['note'] = 'loc-29'
        self.assertEqual(self.build()[0]['blocks'][0]['notes'][0]['anchor'], 'loc-29')

    def test_unrelated_profile_and_ambiguous_physical_block_fail(self):
        self.selections[0]['person'] = 'edith'
        with self.assertRaisesRegex(ValueError, 'person identity'):
            self.build()
        self.setUp()
        self.body.children.append(deepcopy(self.body.children[0]))
        with self.assertRaisesRegex(ValueError, 'physical views'):
            self.build()

    def test_no_register_headings_or_partial_nested_runs(self):
        self.annotations['passages'][0]['chapter'] = 'register'
        with self.assertRaisesRegex(ValueError, 'narrative section'):
            self.build()
        self.setUp()
        self.body.children[0].children.append(Node('p', children=['Another paragraph.']))
        with self.assertRaisesRegex(ValueError, 'complete prose paragraph'):
            self.build()

    def add_life_paragraphs(self, count):
        """Several complete, independently bound paragraphs from one life account."""
        original_paragraph = deepcopy(self.body.children[0])
        original_note = deepcopy(self.body.children[1].children[0])
        original_passage = deepcopy(self.annotations['passages'][0])
        original_mention = deepcopy(self.annotations['mentions'][0])
        for index in range(2, count + 1):
            passage, mention = f'C1-{index + 3:03d}', f'C1-{index + 3:03d}-A01'
            paragraph, note = deepcopy(original_paragraph), deepcopy(original_note)
            paragraph.attrs['data-book-passage'] = passage
            paragraph.children[0].attrs['data-book-mention'] = mention
            paragraph.children[2].attrs.update(id=f'ref-{index}', href=f'#loc-{index}')
            note.attrs['id'] = f'loc-{index}'
            note.children[0].attrs['href'] = f'#ref-{index}'
            self.body.children.insert(index - 1, paragraph)
            self.body.children[-1].children.append(note)
            metadata = deepcopy(original_passage)
            metadata.update(id=passage, mentions=[mention])
            metadata['qualifications'][0]['note'] = f'loc-{index}'
            self.annotations['passages'].append(metadata)
            self.annotations['mentions'].append(original_mention | {'id': mention, 'passage': passage})
            block = profile_block(self.body, self.annotations, self.citations,
                                  passage, {'ch-edith', 'nar-edith'})
            self.selections[0]['blocks'].append(profile_selector(block))

    def test_complete_life_account_keeps_more_than_three_paragraphs_in_reading_order(self):
        self.add_life_paragraphs(12)
        paragraphs = self.build()[0]['blocks']
        self.assertEqual(len(paragraphs), 12)
        self.assertEqual([b['notes'][0]['anchor'] for b in paragraphs],
                         [f'loc-{i}' for i in range(1, 13)])
        self.assertTrue(all(b['notes'][0]['citations'] == self.citations for b in paragraphs))
        self.selections[0]['blocks'][1:3] = reversed(self.selections[0]['blocks'][1:3])
        with self.assertRaisesRegex(ValueError, 'actual Book reading order'):
            self.build()

    def test_unbounded_complete_life_account_is_rejected(self):
        self.add_life_paragraphs(13)
        with self.assertRaisesRegex(ValueError, 'one to twelve'):
            self.build()

    def test_selection_schema_rejects_missing_unknown_duplicate_or_unbounded_choices(self):
        original = deepcopy(self.selections)
        variants = [None, {}, [{'person': 'missing', 'blocks': original[0]['blocks']}],
                    original * 2, [original[0] | {'text': 'Unreviewed prose'}],
                    [{'person': 'tamsin-penhallow', 'blocks': []}],
                    [{'person': 'tamsin-penhallow', 'blocks': original[0]['blocks'] * 2}],
                    [{'person': 'tamsin-penhallow', 'blocks': original[0]['blocks'] * 4}],
                    [{'person': 'tamsin-penhallow', 'blocks': [{'passage': 'C1-004', 'sha256': 'wrong', 'contextSha256': 'wrong'}]}]]
        for value in variants:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.selections = value
                self.build()
        self.selections = []
        self.assertEqual(self.build(), [])



class DerivedControlTests(unittest.TestCase):
    def register_fixture(self):
        body, annotations, citations, selections = fixture()
        p = body.children[0]
        p.children.insert(1, ' is the child of ')
        p.children.insert(2, Node('a', {'href': '#reg-parent', 'data-book-mention': 'PARENT-LINK'},
                                  ['Robert John Penhallow (no.\u00a02)']))
        annotations['mentions'].append({'id': 'PARENT-LINK', 'passage': 'C1-004',
            'kind': 'person', 'target': 'robert-penhallow', 'name': 'Robert John /Penhallow/',
            'label': 'Robert John Penhallow (no. 2)', 'qualifications': []})
        annotations['passages'][0]['mentions'].append('PARENT-LINK')
        annotations['passages'][0]['sha256'] = sha256(' '.join(p.text({'doc-noteref'}).split()).encode()).hexdigest()
        heading = Node('h4', {'id': 'reg-parent'}, ['2. ', Node('a', {'data-book-mention': 'PARENT-HEADING'}, ['Robert John Penhallow'])])
        body.children.append(heading)
        annotations['mentions'].append({'id': 'PARENT-HEADING', 'passage': 'NP-H1',
            'kind': 'person', 'target': 'robert-penhallow', 'name': 'Robert John /Penhallow/',
            'label': 'Robert John Penhallow', 'qualifications': []})
        return body, annotations, citations, {'ch-edith', 'nar-edith', 'reg-parent'}

    def test_actual_register_anchor_has_verified_number_identity_and_unicode_range(self):
        body, annotations, citations, anchors = self.register_fixture()
        before = body.html()
        block = profile_block(body, annotations, citations, 'C1-004', anchors)
        link = block['registerLinks'][0]
        self.assertEqual({k: link[k] for k in ('anchor', 'person', 'number', 'label')},
            {'anchor': 'reg-parent', 'person': 'robert-penhallow', 'number': 2, 'label': 'Robert John Penhallow'})
        self.assertEqual(block['text'][link['start']:link['end']], 'Robert John Penhallow (no. 2)')
        self.assertEqual(body.html(), before)
        # A layout-only anchor rename changes control metadata, never selectors.
        selector = profile_selector(block)
        body.children[0].children[2].attrs['href'] = '#reg-renamed'
        body.children[-1].attrs['id'] = 'reg-renamed'
        anchors.add('reg-renamed')
        self.assertEqual(profile_selector(profile_block(body, annotations, citations, 'C1-004', anchors)), selector)

    def test_same_words_cannot_hide_wrong_missing_duplicate_or_misnumbered_register(self):
        for mutation in ('person', 'missing', 'duplicate', 'number', 'unpublished-anchor'):
            with self.subTest(mutation=mutation):
                body, annotations, citations, anchors = self.register_fixture()
                if mutation == 'person': annotations['mentions'][-1]['target'] = 'tamsin-penhallow'
                elif mutation == 'missing': body.children.pop()
                elif mutation == 'duplicate': body.children.append(deepcopy(body.children[-1]))
                elif mutation == 'number': body.children[-1].children[0] = '3. '
                else: anchors.remove('reg-parent')
                with self.assertRaisesRegex(ValueError, 'register'):
                    profile_block(body, annotations, citations, 'C1-004', anchors)

    def paired_fixture(self, separator):
        body, annotations, citations, _ = fixture()
        marker = deepcopy(body.children[0].children[2])
        marker.attrs.update(id='ref-2', href='#loc-2')
        body.children[0].children[3:3] = [separator, Node('span', children=[' ']), marker]
        note = deepcopy(body.children[1].children[0])
        note.attrs['id'] = 'loc-2'
        note.children[0].attrs['href'] = '#ref-2'
        body.children[1].children.append(note)
        text = ' '.join(body.children[0].text({'doc-noteref'}).split())
        annotations['passages'][0]['sha256'] = sha256(text.encode()).hexdigest()
        return body, annotations, citations

    def test_only_actual_compiler_comma_groups_sources_without_changing_offsets_or_words(self):
        body, annotations, citations = self.paired_fixture(Node('sup', children=[',']))
        before = body.html()
        block = profile_block(body, annotations, citations, 'C1-004', {'ch-edith', 'nar-edith'})
        self.assertEqual(block['sourceGroups'], [[0, 1]])
        self.assertEqual(block['text'], 'Tamsin graduated. , The year is not reported.')
        self.assertEqual([n['offset'] for n in block['notes']], [17, 19])
        self.assertEqual(body.html(), before)
        for separator in (',', ' and ', Node('sup', children=['1']), Node('sup', {'title': 'factual'}, [','])):
            body, annotations, citations = self.paired_fixture(separator)
            block = profile_block(body, annotations, citations, 'C1-004', {'ch-edith', 'nar-edith'})
            self.assertEqual(block.get('sourceGroups', []), [])


if __name__ == '__main__':
    unittest.main()
