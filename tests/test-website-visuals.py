#!/usr/bin/env python3
"""Visual discovery keeps reviewed media and respects the exported people scope."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import sys
SCRIPTS = Path(__file__).resolve().parent.parent / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from booklib import Tree
from website_visuals import validate_visual_media

spec = importlib.util.spec_from_file_location('visual_export_test', SCRIPTS.joinpath('export-website.py'))
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)

import flyleaf_settings  # noqa: E402

RESEARCH_FOLDERS = ['capture', 'captures', 'correlation', 'independent-reading', 'review']


def family_settings(test, root, value):
    """Run the test with a family folder of its own, holding these settings."""
    (root / 'flyleaf.json').write_text(json.dumps(value))
    flyleaf_settings._load.cache_clear()
    family = patch.dict(os.environ, {'FLYLEAF_FAMILY': str(root)})
    family.start()
    test.addCleanup(family.stop)


# One family's own caption rules (text_checks.caption_errors): phrases from
# its research notes that must never reach a photograph's public caption.
CAPTION_ERRORS = [
    r'\breviews/',
    r'\bPDF object\s+\d+',
    r'\b(?:names|identifications|occasion)(?: and (?:names|occasion))? (?:were )?(?:supplied|provided|confirmed) by\b',
    r'\b(?:supplied|provided|confirmed) (?:the )?names and occasion\b',
    r'\b(?:names|identifications) follow (?:the )?existing (?:family )?records\b',
    r'(?:^|[.!?]\s+)(?:Retain the existing|Preserve the qualified|Do not (?:reconstruct|derive|assign|take)|Withhold default avatar)',
]


class VisualExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.path = 'images/independent-reading/portrait.jpg'
        file = self.root / self.path
        file.parent.mkdir(parents=True)
        file.write_bytes(b'fixture for file selection, not a rendered photograph')
        self.digest = hashlib.sha256(file.read_bytes()).hexdigest()
        family_settings(self, self.root, {'site': {'research_folders': RESEARCH_FOLDERS},
                                          'text_checks': {'caption_errors': CAPTION_ERRORS}})

    def document(self, *, inline=False, typed=True):
        media = f'''0 @V@ OBJE
1 FILE {self.path}
2 _SHA256 {self.digest}
''' + ('2 _KIND photograph\n' if typed else '') + '''1 TITL Reviewed portrait
1 _CONTENT photograph
1 _ALBUM display
1 _VISUAL_ROLE portrait
1 _SUBJECT @B@
1 _RELATED @B@
1 _CAPTION_PERSON @B@
1 _COMMEMORATES @B@
1 _AVATAR Y
1 _AVATAR_POSITION bottom
1 _DISCOVERY_NOTE The original identification is retained.
2 CONT This second line must survive.
1 _PUBLIC_NOTE The photograph is undated.
2 CONT The source names Beatrice.
'''
        if inline:
            level = 2 if inline == 'catalogue' else 1
            media = str(level) + ' OBJE\n' + '\n'.join(
                str(int(line.split(' ', 1)[0]) + level) + ' ' + line.split(' ', 1)[1]
                for line in media.splitlines()[1:]) + '\n'
        base = '''0 HEAD
1 CHAR UTF-8
1 _ATLAS
2 _ROOT @A@
1 _ARCHIVE_CATALOG
2 SOUR @S@
0 @A@ INDI
1 NAME Alice /Example/
1 REFN alice
1 SOUR @S@
0 @B@ INDI
1 NAME Beatrice /Example/
1 REFN beatrice
0 @S@ SOUR
1 TITL A held photograph
'''
        if inline == 'catalogue':
            return base.replace('2 SOUR @S@\n', '2 SOUR @S@\n' + media) + '0 TRLR\n'
        return base + (media if inline else '1 OBJE @V@\n' + media) + '0 TRLR\n'

    def export(self, document):
        source = self.root / 'fixture.ged'
        source.write_text(document)
        with patch.object(exporter, 'ROOT', self.root):
            manifest = exporter.package(Tree(source), self.root / 'output', strict_assets=True)
        return (self.root / 'output/family.ged').read_text(), manifest

    def test_shared_and_inline_media_keep_the_file_but_do_not_import_excluded_people(self):
        for inline in [False, True, 'catalogue']:
            with self.subTest(inline=inline):
                output, manifest = self.export(self.document(inline=inline))
                self.assertEqual(manifest['people'], 1)
                self.assertEqual(manifest['assets'], [self.path])
                self.assertEqual(validate_visual_media(output), {self.path})
                self.assertNotIn('@B@', output)
                self.assertNotIn('_AVATAR', output)
                self.assertNotIn(' _DISCOVERY_NOTE', output)
                self.assertNotIn('This second line must survive.', output)
                self.assertIn(' _PUBLIC_NOTE', output)
                self.assertIn('The photograph is undated.', output)
                self.assertIn('The source names Beatrice.', output)

    def test_public_captions_cannot_publish_research_directives_but_private_notes_remain_valid(self):
        original = self.document()
        for text in ['Retain the existing obituary source.', 'PDF object 12',
                     'Reviewed in reviews/internal.json', 'Identified as @I0001@',
                     'Do not reconstruct letters.']:
            with self.subTest(text=text):
                with self.assertRaisesRegex(ValueError, 'meant for the family tree'):
                    validate_visual_media(original.replace('The photograph is undated.', text))
        self.assertEqual(validate_visual_media(original.replace(
            'The original identification is retained.', 'Retain the existing obituary source.')),
            {self.path})

    def test_all_authored_visual_labels_are_guarded_without_filtering_original_records(self):
        original = self.document()
        for document in [original.replace('1 TITL Reviewed portrait',
                                           '1 TITL See reviews/internal-review.json'),
                         original.replace('1 _PUBLIC_NOTE',
                                          '1 _OTHER_SUBJECT Extract PDF object 24\n1 _PUBLIC_NOTE')]:
            with self.assertRaisesRegex(ValueError, 'meant for the family tree'):
                validate_visual_media(document)
        self.assertEqual(validate_visual_media(original.replace(
            '1 TITL A held photograph', '1 TITL Preserve the qualified wording in the original')),
            {self.path})

    def test_public_captions_exclude_intake_method_but_preserve_credits_and_private_provenance(self):
        original = self.document()
        for text in ['Jory supplied the names and occasion.',
                     'Names and occasion supplied by Jory Penhallow.',
                     'The names follow the existing family records.',
                     'Identifications were confirmed by the contributor.']:
            with self.subTest(text=text):
                with self.assertRaisesRegex(ValueError, 'meant for the family tree'):
                    validate_visual_media(original.replace('The photograph is undated.', text))
                self.assertEqual(validate_visual_media(original.replace(
                    'The original identification is retained.', text)), {self.path})
                self.assertEqual(validate_visual_media(original.replace(
                    '1 TITL A held photograph', '1 TITL ' + text)), {self.path})
        for text in ['Photograph courtesy of Jory Penhallow.',
                     'Karin gave these recipes to Edith.',
                     'Family at Nora’s graduation from the village school.']:
            with self.subTest(text=text):
                self.assertEqual(validate_visual_media(original.replace(
                    'The photograph is undated.', text)), {self.path})

    def test_a_family_without_caption_rules_is_stopped_only_by_a_tree_pointer(self):
        family_settings(self, self.root, {})
        original = self.document()
        for text in ['Retain the existing obituary source.', 'PDF object 12',
                     'Names and occasion supplied by Jory Penhallow.', 'Do not reconstruct letters.']:
            with self.subTest(text=text):
                self.assertEqual(validate_visual_media(original.replace('The photograph is undated.', text)),
                                 {self.path})
        for text in ['Identified as @I0001@', 'See @P12@ in the tree.']:
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, 'meant for the family tree'):
                validate_visual_media(original.replace('The photograph is undated.', text))

    def test_explicit_approved_portrait_artwork_is_valid_but_groups_and_qualified_images_are_not(self):
        art = self.document().replace('_CONTENT photograph', '_CONTENT artwork')
        self.assertEqual(validate_visual_media(art), {self.path})
        for invalid in [art.replace('_VISUAL_ROLE portrait', '_VISUAL_ROLE group'),
                        art.replace('1 _AVATAR Y', '1 _AVATAR Y\n1 _QUALIFIED Y')]:
            with self.assertRaisesRegex(ValueError, 'unqualified portrait'):
                validate_visual_media(invalid)

    def test_explicit_reviewed_media_must_not_disappear_at_the_reader_boundary(self):
        for inline in [False, True, 'catalogue']:
            with self.subTest(inline=inline):
                with self.assertRaisesRegex(ValueError, 'Reviewed visual media is outside'):
                    self.export(self.document(inline=inline, typed=False))

    def test_native_visual_person_fields_reject_wrong_types_and_nested_content(self):
        for target in ['@S@', '@MISSING@', '@B@\n2 NOTE wrong child']:
            with self.subTest(target=target):
                with self.assertRaises(ValueError):
                    self.export(self.document().replace('_SUBJECT @B@', '_SUBJECT ' + target))

    def test_noncanonical_paths_cannot_classify_one_file_twice(self):
        for path in ['images/./portrait.jpg', 'images//portrait.jpg', 'images/../portrait.jpg']:
            with self.subTest(path=path):
                with self.assertRaisesRegex(ValueError, 'canonical relative'):
                    self.export(self.document().replace(self.path, path))

    def test_the_reviewed_file_hash_is_checked_on_the_actual_staged_bytes(self):
        with self.assertRaisesRegex(ValueError, 'Archive SHA-256 mismatch'):
            self.export(self.document().replace(self.digest, 'f' * 64))


if __name__ == '__main__':
    unittest.main()
