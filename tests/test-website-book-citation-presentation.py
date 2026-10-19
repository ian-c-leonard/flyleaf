#!/usr/bin/env python3
from copy import deepcopy
import unittest
import sys
from pathlib import Path
SCRIPTS = Path(__file__).resolve().parent.parent / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from website_native_book import Node
from website_book_citation_presentation import (build_citation_presentation,
    citation_presentation_selector, citation_context)
from website_book_annotations import content_digest

class CitationPresentationTests(unittest.TestCase):
    def setUp(self):
        self.citation = {'person': 'edith', 'key': 'source', 'sourcePointer': '@SRC@',
            'legacyNotes': [], 'label': 'Named primary source', 'url': 'https://example.org/source',
            'locators': ['p. 2'], 'files': ['images/source.png']}
        self.note = Node('li', {'id': 'loc-1', 'data-book-note': ''}, [
            Node('a', {'role': 'doc-backlink', 'href': '#marker-1'}, ['3']),
            'Actual source note. Candidate status, not a degree award.',
            Node('span', {'data-book-person': 'edith', 'data-book-key': 'source'})])
        self.body = Node('root', children=[self.note])
        self.entry = citation_presentation_selector(self.body, self.citation,
            title='Named primary source, p. 2', context='The programme lists Edith as a candidate.',
            qualifications=['A candidate listing does not confirm a degree award.'], preferredFile='images/source.png')

    def check(self, body=None, citations=None, entries=None, admitted=None):
        return build_citation_presentation(body or self.body, citations or [self.citation],
            entries if entries is not None else [self.entry], admitted if admitted is not None else {'images/source.png'})

    def test_output_preserves_exact_canonical_tree_and_authored_display(self):
        before = deepcopy(self.body)
        self.assertEqual(self.check(), [self.entry])
        self.assertEqual(self.body, before)
        self.assertEqual(self.note.text({'doc-backlink'}), 'Actual source note. Candidate status, not a degree award.')

    def test_renumbering_repetition_and_note_order_do_not_stale_meaning(self):
        body = deepcopy(self.body)
        body.children[0].attrs['id'] = 'loc-999'
        body.children[0].children[0].children = ['999']
        body.children.append(deepcopy(body.children[0]))
        self.assertEqual(content_digest(citation_context(body, self.citation)), self.entry['contextSha256'])
        self.check(body=body)

    def test_source_identity_file_locator_and_actual_caution_changes_require_review(self):
        for field, value in [('sourcePointer','@OTHER@'), ('files',['images/new.png']), ('locators',['p. 3'])]:
            citation=deepcopy(self.citation);citation[field]=value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError,'context changed'):
                self.check(citations=[citation])
        body=deepcopy(self.body);body.children[0].children[1]='A differently qualified note.'
        with self.assertRaisesRegex(ValueError,'context changed'):self.check(body=body)

    def test_preferred_file_must_be_exact_citation_endpoint_and_admitted(self):
        bad=deepcopy(self.entry);bad['preferredFile']='images/uncited.png'
        with self.assertRaisesRegex(ValueError,'exact admitted'):self.check(entries=[bad])
        with self.assertRaisesRegex(ValueError,'exact admitted'):self.check(admitted=set())

    def test_reviewed_physical_pdf_page_requires_exact_pdf_endpoint(self):
        citation=deepcopy(self.citation);citation['files']=['images/complete-programme.pdf']
        entry=citation_presentation_selector(self.body,citation,title='Named primary programme',
            context='The programme lists a candidate.',qualifications=['Not a degree certificate.'],
            preferredFile=citation['files'][0],preferredPdfPage=65)
        self.assertEqual(self.check(citations=[citation],entries=[entry],admitted=set(citation['files'])),[entry])
        for page in (0,-1,1.5,True,'65',None,9007199254740992):
            bad=deepcopy(entry);bad['preferredPdfPage']=page
            with self.subTest(page=page),self.assertRaisesRegex(ValueError,'physical PDF page'):
                self.check(citations=[citation],entries=[bad],admitted=set(citation['files']))
        bad=deepcopy(entry);bad.pop('preferredFile')
        with self.assertRaisesRegex(ValueError,'physical PDF page'):
            self.check(citations=[citation],entries=[bad],admitted=set(citation['files']))
        bad=deepcopy(self.entry);bad['preferredPdfPage']=65
        with self.assertRaisesRegex(ValueError,'physical PDF page'):self.check(entries=[bad])

    def test_missing_duplicate_unbound_and_private_entries_fail_closed(self):
        self.assertEqual(self.check(entries=[]), [])
        with self.assertRaisesRegex(ValueError,'duplicate'):self.check(entries=[self.entry,self.entry])
        for field, value in [('title','private@example.org'), ('context','private@example.org')]:
            bad=deepcopy(self.entry);bad[field]=value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError,'contact address'):self.check(entries=[bad])
        body=deepcopy(self.body);body.children[0].children[1]+=' private@example.org'
        entry=citation_presentation_selector(body,self.citation,title='Citation',context='Human sentence.',qualifications=[])
        with self.assertRaisesRegex(ValueError,'Canonical public note'):self.check(body=body,entries=[entry])

if __name__=='__main__':unittest.main()
