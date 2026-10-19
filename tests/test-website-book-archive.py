#!/usr/bin/env python3
"""Book publication reuses exact mappings without inventing personal links."""
import copy
import json
import re
import tempfile
import unittest
from pathlib import Path

import sys
SCRIPTS = Path(__file__).resolve().parent.parent / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import booklib
import flyleaf_settings
from website_book_archive import append_book_figures, verify_book_source_files, current_book_map

DOCUMENT = '0 HEAD\n1 _ATLAS\n2 _ROOT @I1@\n1 _ARCHIVE_CATALOG\n2 SOUR @S1@\n0 @I1@ INDI\n1 NAME Example /Person/\n0 @S1@ SOUR\n1 TITL Existing source\n0 TRLR\n'


class BookArchiveTests(unittest.TestCase):
    def mapping(self):
        return {
            'inputs_sha256': {'book/sketches/example.typ': 'a' * 64},
            'figures': [{'file': 'book/sketches/example.typ', 'caption': 'An identified group.\nOne sitter remains uncertain.',
                         'artifacts': [{'path': 'images/group.jpg', 'exists': True, 'sha256': 'b' * 64}]}],
        }

    def test_caption_paths_and_declared_hashes_survive_without_person_or_source_invention(self):
        result = append_book_figures(DOCUMENT, self.mapping(), '@I1@', 'Family history')
        self.assertIn('1 TITL An identified group.\n2 CONT One sitter remains uncertain.', result)
        self.assertIn('1 FILE images/group.jpg\n2 _SHA256 ' + 'b' * 64, result)
        self.assertIn('1 _MANUSCRIPT book/sketches/example.typ\n2 _HASH ' + 'a' * 64, result)
        self.assertIn('2 OBJE @WEB_BOOK_', result)
        self.assertIn('0 @I1@ INDI\n1 NAME Example /Person/\n0 @S1@ SOUR\n1 TITL Existing source\n', result)
        self.assertEqual(result.count(' SOUR'), DOCUMENT.count(' SOUR'))
        self.assertNotIn('_PERSON', result)

    def test_duplicate_placements_coalesce_but_different_captions_remain(self):
        mapping = self.mapping()
        mapping['figures'].append(copy.deepcopy(mapping['figures'][0]))
        self.assertEqual(append_book_figures(DOCUMENT, mapping, '@I1@', 'Book').count('2 OBJE @WEB_BOOK_'), 1)
        mapping['figures'][1]['caption'] = 'A second explicit caption.'
        self.assertEqual(append_book_figures(DOCUMENT, mapping, '@I1@', 'Book').count('2 OBJE @WEB_BOOK_'), 2)

    def test_family_mismatch_missing_artifact_and_generated_record_collision_fail(self):
        with self.assertRaisesRegex(ValueError, 'matching website family'):
            append_book_figures(DOCUMENT, self.mapping(), '@OTHER@', 'Book')
        mapping = self.mapping()
        mapping['figures'][0]['artifacts'][0]['exists'] = False
        with self.assertRaisesRegex(ValueError, 'held publishable image'):
            append_book_figures(DOCUMENT, mapping, '@I1@', 'Book')
        once = append_book_figures(DOCUMENT, self.mapping(), '@I1@', 'Book')
        with self.assertRaisesRegex(ValueError, 'conflicts'):
            append_book_figures(once, self.mapping(), '@I1@', 'Book')

    def test_actual_map_is_current_and_a_changed_caption_cannot_be_published_as_current(self):
        path = booklib.BOOK_DIR / 'CLAIMS-MAP.json'
        native = booklib.SRC_GED.read_text()
        mapping, root, title = current_book_map(path, native)
        # The book's root person is the website family's root.
        edition = flyleaf_settings.content_file('edition.ged')
        if edition.is_file():
            head = edition.read_text().split('\n0 ', 1)[0]
            self.assertEqual(re.findall(r'^2 _ROOT (\S+)$', head, re.M), [root])
        self.assertTrue(title)
        with self.assertRaisesRegex(ValueError, 'same native genealogy'):
            current_book_map(path, native + '\n')
        if not mapping['figures']:
            self.skipTest("this family's book has no figures to alter")
        with tempfile.TemporaryDirectory() as directory:
            altered = Path(directory) / 'map.json'
            mapping['figures'][0]['caption'] = 'Unreviewed replacement caption'
            altered.write_text(json.dumps(mapping))
            with self.assertRaisesRegex(ValueError, 'older than its stories'):
                current_book_map(altered, native)


class CanonicalSourceFilesTests(unittest.TestCase):
    def test_explicit_attachment_and_exact_owner_are_required(self):
        note = '[Source] A profile — archived images/first.pdf'
        document = ('0 HEAD\n0 @I1@ INDI\n1 REFN first-reader\n1 NOTE ' + note +
                    '\n2 OBJE @M1@\n0 @M1@ OBJE\n1 FILE images/first.pdf\n0 TRLR\n')
        mapping = {'claims': [{'sources': [{'native': False, 'status': 'resolved',
            'refn': 'first-reader', 'raw_notes': [note],
            'artifacts': [{'path': 'images/first.pdf'}]}]}]}
        verify_book_source_files(document, mapping)
        with self.assertRaisesRegex(ValueError, 'explicit native attachments'):
            verify_book_source_files(document.replace('2 OBJE @M1@\n', ''), mapping)
        with self.assertRaisesRegex(ValueError, 'exact canonical owner'):
            verify_book_source_files(document.replace('REFN first-reader', 'REFN another-reader'), mapping)

    def test_a_different_citation_cannot_supply_the_missing_attachment(self):
        note = '[Source] A profile'
        document = ('0 HEAD\n0 @I1@ INDI\n1 REFN first-reader\n1 NOTE ' + note +
                    '\n1 NOTE [Source] A different record\n2 OBJE\n3 FILE images/first.pdf\n0 TRLR\n')
        mapping = {'claims': [{'sources': [{'status': 'resolved', 'refn': 'first-reader',
            'raw_notes': [note], 'artifacts': [{'path': 'images/first.pdf'}]}]}]}
        with self.assertRaisesRegex(ValueError, 'explicit native attachments'):
            verify_book_source_files(document, mapping)


if __name__ == '__main__':
    unittest.main()
