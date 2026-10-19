#!/usr/bin/env python3
"""Checks for source fidelity and fail-closed readable-text recipes."""
import copy
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
spec = importlib.util.spec_from_file_location('source_text', SCRIPTS.joinpath('render-source-text.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

import flyleaf_settings  # noqa: E402

RESEARCH_FOLDERS = ['capture', 'captures', 'correlation', 'independent-reading', 'review']


def family_settings(test, root, value):
    """Run the test with a family folder of its own, holding these settings."""
    (root / 'flyleaf.json').write_text(json.dumps(value))
    flyleaf_settings._load.cache_clear()
    family = patch.dict(os.environ, {'FLYLEAF_FAMILY': str(root)})
    family.start()
    test.addCleanup(family.stop)


class SourceTextTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'images').mkdir()
        # This family keeps research working files in folders with these names.
        family_settings(self, self.root, {'site': {'research_folders': RESEARCH_FOLDERS}})
        self.original = {'caption': 'THE CHOIR TAKES ITS PLACES FOR THE CON-\nCERT.',
                         'account': 'Authored summary, not a transcript.',
                         'old_status': 'Not yet reviewed'}
        self.body = (json.dumps(self.original) + '\n').encode()
        (self.root / 'images/reading.json').write_bytes(self.body)
        self.recipe = {
            'parent': {'path': 'images/reading.json', 'sha256': module.digest(self.body)},
            'output': {'path': 'images/companion.txt'},
            'title': 'Retained caption and reading', 'locator': 'Printed page 67',
            'sourceUrls': ['https://example.org/source'],
            'introduction': 'Caption followed by a separately labelled authored summary.',
            'notes': 'The caption does not identify an unkeyed person.',
            'sections': [
                {'pointer': '/caption', 'heading': 'Caption', 'format': 'text', 'role': 'retained-text',
                 'valueSha256': module.value_digest(self.original['caption'])},
                {'pointer': '/account', 'heading': 'Account summary (not a transcript)', 'format': 'text',
                 'role': 'authored-assessment', 'valueSha256': module.value_digest(self.original['account'])},
            ],
        }
        self.expected = module.render(self.recipe, self.root)
        self.recipe['output'].update(sha256=module.digest(self.expected), bytes=len(self.expected))
        self.manifest = {'schema': 'source-text-companions/v1', 'companions': [self.recipe]}

    def test_replay_keeps_literal_linebreaks_and_separate_summary_without_old_workflow_status(self):
        outputs = module.prepare(self.manifest, self.root)
        text = outputs['images/companion.txt'].decode()
        self.assertIn('Caption\n' + self.original['caption'], text)
        self.assertIn('Account summary (not a transcript)\n' + self.original['account'], text)
        self.assertNotIn(self.original['old_status'], text)
        self.assertEqual((self.root / 'images/reading.json').read_bytes(), self.body)

    def test_parent_change_fails_even_when_selected_caption_stays_the_same(self):
        changed = {**self.original, 'old_status': 'Changed provenance'}
        (self.root / 'images/reading.json').write_text(json.dumps(changed))
        with self.assertRaisesRegex(ValueError, 'Changed parent'):
            module.prepare(self.manifest, self.root)

    def test_field_or_output_changes_require_a_new_reviewed_recipe(self):
        for part in ['field', 'output', 'heading']:
            manifest = copy.deepcopy(self.manifest)
            recipe = manifest['companions'][0]
            if part == 'field':
                recipe['sections'][0]['valueSha256'] = '0' * 64
            elif part == 'output':
                recipe['output']['sha256'] = '0' * 64
            else:
                recipe['sections'][1]['heading'] = 'Misleading transcript label'
            with self.subTest(part=part), self.assertRaises(ValueError):
                module.prepare(manifest, self.root)

    def test_duplicate_outputs_and_unknown_modes_fail(self):
        manifest = copy.deepcopy(self.manifest)
        manifest['companions'].append(copy.deepcopy(self.recipe))
        with self.assertRaisesRegex(ValueError, 'Duplicate companion'):
            module.prepare(manifest, self.root)
        for key, value in [('format', 'unknown'), ('role', 'unknown')]:
            changed = copy.deepcopy(self.recipe)
            changed['sections'][0][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                module.render(changed, self.root)

    def test_support_private_and_alias_paths_are_not_recipe_inputs(self):
        for path in ['../outside.json', '/tmp/outside.json', 'images/capture/item.json',
                     'images/private/item.json', 'images/.env.json', 'images/./reading.json',
                     'images//reading.json']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                module.held_path(self.root, path)
        outside = self.root / 'outside.json'
        outside.write_bytes(self.body)
        (self.root / 'images/alias.json').symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'Path leaves images'):
            module.held_path(self.root, 'images/alias.json')

    def test_resolved_output_aliases_cannot_skip_a_reviewed_copy(self):
        destination = self.root / 'copies'
        (destination / 'images').mkdir(parents=True)
        (destination / 'images/alias.txt').symlink_to(destination / 'images/first.txt')
        outputs = {'images/first.txt': b'first reading', 'images/alias.txt': b'different reading'}
        with self.assertRaisesRegex(ValueError, 'Duplicate resolved'):
            module.check_or_copy(outputs, destination, write=True)
        self.assertFalse((destination / 'images/first.txt').exists())

    def test_a_file_created_after_preflight_is_not_overwritten_or_silently_skipped(self):
        destination = self.root / 'copies'
        target = (destination / 'images/copy.txt').resolve()
        original_open = Path.open

        def competing_open(path, mode='r', *args, **kwargs):
            if path == target and mode == 'xb':
                with original_open(path, 'wb') as stream:
                    stream.write(b'competing content')
            return original_open(path, mode, *args, **kwargs)

        with patch.object(Path, 'open', competing_open):
            with self.assertRaisesRegex(ValueError, 'Refusing differing output'):
                module.check_or_copy({'images/copy.txt': b'reviewed content'}, destination, write=True)
        self.assertEqual(target.read_bytes(), b'competing content')

    def test_separate_copy_and_replay_verify_actual_bytes_without_rewriting_equal_files(self):
        destination = self.root / 'copies'
        outputs = module.prepare(self.manifest, self.root)
        module.check_or_copy(outputs, destination, write=True)
        target = destination / 'images/companion.txt'
        previous = target.stat().st_mtime_ns
        module.check_or_copy(outputs, destination, write=True)
        module.check_or_copy(outputs, destination)
        self.assertEqual(target.read_bytes(), self.expected)
        self.assertEqual(target.stat().st_mtime_ns, previous)

    def test_structured_entry_separates_printed_date_from_interpretation_and_editorial_name(self):
        entry = {'printed_page': 212, 'name': 'Ada Treloar [TRELOAR surname carried under heading]',
                 'parent_clause': 'of Thomas and Mary J.', 'date_as_printed': 'May 14, 1871',
                 'date_meaning': 'Baptism; no birth date supplied.'}
        text = module.section_text({'format': 'register-entries'}, [entry])
        self.assertIn('Name: Ada Treloar\nEditorial surname annotation: [TRELOAR surname carried under heading]', text)
        self.assertIn('Date as printed: May 14, 1871\nInterpretation of date: Baptism; no birth date supplied.', text)
        with self.assertRaisesRegex(ValueError, 'Unexpected entry fields'):
            module.section_text({'format': 'register-entries'}, [{**entry, 'new_claim': 'unsupported'}])


if __name__ == '__main__':
    unittest.main()
