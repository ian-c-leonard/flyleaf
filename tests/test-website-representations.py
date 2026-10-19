#!/usr/bin/env python3
"""Canonical derivations retain recorded recipes and fail closed on stale inputs."""
import copy
import hashlib
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys
SCRIPTS = Path(__file__).resolve().parent.parent / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from booklib import Tree
from website_representations import append_representations, load_representations

import flyleaf_settings  # noqa: E402

RESEARCH_FOLDERS = ['capture', 'captures', 'correlation', 'independent-reading', 'review']


def family_settings(test, root, value):
    """Run the test with a family folder of its own, holding these settings."""
    (root / 'flyleaf.json').write_text(json.dumps(value))
    flyleaf_settings._load.cache_clear()
    family = patch.dict(os.environ, {'FLYLEAF_FAMILY': str(root)})
    family.start()
    test.addCleanup(family.stop)


class RepresentationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'images').mkdir()
        for name in ['page.jpg', 'crop.jpg', 'plate.jpg', 'other.jpg']:
            (self.root / 'images' / name).write_bytes(name.encode())
        (self.root / 'images/recipe.json').write_text('{"historical": "witness"}')
        # This family keeps research working files in folders with these names.
        family_settings(self, self.root, {'site': {'research_folders': RESEARCH_FOLDERS}})

    def edge(self, parent='page.jpg', child='crop.jpg'):
        return {'parent': 'images/' + parent, 'child': 'images/' + child,
                'parentSha256': hashlib.sha256(parent.encode()).hexdigest(),
                'childSha256': hashlib.sha256(child.encode()).hexdigest(),
                'role': 'crop', 'method': '', 'details': {'crop_ltrb': [1, 2, 3, 4]},
                'witness': 'images/recipe.json',
                'witnessSha256': hashlib.sha256((self.root / 'images/recipe.json').read_bytes()).hexdigest(),
                'pointer': '/generation'}

    def load(self, edges, targets=None):
        return load_representations(self.root, {'schema': 1, 'representations': edges},
                                    {'images/plate.jpg'} if targets is None else targets)

    def test_explicit_ancestry_and_original_recipe_survive(self):
        edges = [self.edge(), self.edge('crop.jpg', 'plate.jpg'), self.edge('page.jpg', 'other.jpg')]
        actual = self.load(edges)
        self.assertEqual({e['child'] for e in actual}, {'images/crop.jpg', 'images/plate.jpg'})
        self.assertEqual(actual[0], edges[0])
        self.assertEqual(edges[0]['details']['crop_ltrb'], [1, 2, 3, 4])

    def test_audio_listening_copy_keeps_original_bytes_and_source_scope(self):
        for name in ['track.wav', 'track.mp3']:
            (self.root / 'images' / name).write_bytes(name.encode())
        edge = self.edge('track.wav', 'track.mp3')
        edge.update(role='derived', source='@ALBUM@', method='MP3 listening copy', details={'codec': 'mp3'})
        loaded = self.load([edge], set())
        self.assertEqual(loaded, [edge])
        # Owning source survives the portable representation and must be selected
        # independently; it cannot bootstrap an excluded album into the site.
        document = append_representations('0 HEAD\n0 TRLR\n', loaded)
        self.assertIn('1 _SOURCE @ALBUM@\n', document)
        self.assertIn('images/track.wav', document)
        self.assertIn('images/track.mp3', document)
        (self.root / 'images/track.mp3').write_bytes(b'changed audio')
        with self.assertRaisesRegex(ValueError, 'Stale'):
            self.load([edge], set())

    def test_a_witness_may_live_in_any_family_folder_but_not_be_the_settings(self):
        (self.root / 'research').mkdir()
        (self.root / 'research/recipe.json').write_text('{"crop": "by hand"}')
        edge = self.edge()
        edge['witness'] = 'research/recipe.json'
        edge['witnessSha256'] = hashlib.sha256((self.root / 'research/recipe.json').read_bytes()).hexdigest()
        self.assertEqual(self.load([edge], {'images/crop.jpg'}), [edge])
        edge['witness'] = 'flyleaf.json'
        edge['witnessSha256'] = hashlib.sha256((self.root / 'flyleaf.json').read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, 'not a held permitted file'):
            self.load([edge], {'images/crop.jpg'})

    def test_endpoint_and_witness_changes_fail_without_rebinding_hashes(self):
        for name in ['page.jpg', 'crop.jpg', 'recipe.json']:
            edge = self.edge()
            path = self.root / 'images' / name
            original = path.read_bytes()
            path.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'Stale'):
                self.load([edge], {'images/crop.jpg'})
            path.write_bytes(original)

    def test_source_owned_reading_crop_does_not_require_a_manuscript_use(self):
        owned = self.edge('page.jpg', 'crop.jpg')
        owned['source'] = '@S1@'
        unused = self.edge('page.jpg', 'other.jpg')
        actual = self.load([owned, unused], {'images/page.jpg'})
        self.assertEqual(actual, [owned])
        document = append_representations('0 HEAD\n0 TRLR\n', actual)
        self.assertIn('1 _SOURCE @S1@\n', document)
        self.assertNotIn('images/other.jpg', document)

    def test_recorded_work_folder_crop_keeps_explicit_hashes_and_owner(self):
        directory = self.root / 'images/independent-reading'
        directory.mkdir()
        (directory / 'crop.jpg').write_bytes(b'crop.jpg')
        edge = self.edge()
        edge.update(child='images/independent-reading/crop.jpg', source='@S1@')
        actual = self.load([edge], set())
        self.assertEqual(actual, [dict(edge, _typedEndpoints=['child'])])
        self.assertNotIn('_typedEndpoints', edge)
        exported = append_representations('0 HEAD\n0 TRLR\n', actual)
        self.assertIn('1 FILE images/independent-reading/crop.jpg\n2 _SHA256 ' + edge['childSha256'] + '\n2 _KIND document\n', exported)
        self.assertNotIn('3 _KIND document', exported)
        self.assertIn('1 _SOURCE @S1@', exported)
        (directory / 'crop.jpg').write_bytes(b'changed reading crop')
        with self.assertRaisesRegex(ValueError, 'Stale'):
            self.load([edge], set())

    def test_resolved_endpoint_admission_is_carried_to_the_portable_writer(self):
        directory = self.root / 'images/review'
        directory.mkdir()
        for name in ['page.jpg', 'crop.jpg']:
            original = self.root / 'images' / name
            original.rename(directory / name)
            original.symlink_to(directory / name)
        edge = self.edge()
        edge['source'] = '@S1@'
        actual = self.load([edge], set())
        self.assertEqual(actual, [dict(edge, _typedEndpoints=['parent', 'child'])])
        self.assertNotIn('_typedEndpoints', edge)
        exported = append_representations('0 HEAD\n0 TRLR\n', actual)
        self.assertIn('2 _SHA256 ' + edge['childSha256'] + '\n2 _KIND document\n', exported)
        self.assertIn('3 _SHA256 ' + edge['parentSha256'] + '\n3 _KIND document\n', exported)
        # Exercise the loader -> portable writer -> actual exporter boundary.
        document = append_representations(
            '0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Example /Person/\n'
            '1 SOUR @S1@\n0 @S1@ SOUR\n1 TITL Example source\n0 TRLR\n', actual)
        input_path = self.root / 'input.ged'
        input_path.write_text(document)
        spec = importlib.util.spec_from_file_location(
            'representation_export', SCRIPTS.joinpath('export-website.py'))
        exporter = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(exporter)
        output = self.root / 'package'
        with patch.object(exporter, 'ROOT', self.root):
            manifest = exporter.package(Tree(input_path), output, strict_assets=True)
        self.assertEqual(manifest['assets'], ['images/crop.jpg', 'images/page.jpg'])
        for name in manifest['assets']:
            self.assertEqual((output / name).read_bytes(), (self.root / name).read_bytes())
        # A moved target must still pass the actual resolved-path boundary.
        private = self.root / 'images/private'
        directory.rename(private)
        (self.root / 'images/page.jpg').unlink()
        (self.root / 'images/page.jpg').symlink_to(private / 'page.jpg')
        with self.assertRaises(ValueError):
            self.load([edge], set())

    def test_cycles_and_duplicate_witnesses_fail(self):
        with self.assertRaisesRegex(ValueError, 'cycle'):
            self.load([self.edge(), self.edge('crop.jpg', 'page.jpg')])
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            self.load([self.edge(), self.edge()])

    def test_shared_upstream_steps_require_one_of_their_independent_owners(self):
        upstream = self.edge()
        first = self.edge('crop.jpg', 'plate.jpg'); first['source'] = '@S1@'
        second = self.edge('crop.jpg', 'other.jpg'); second['source'] = '@S2@'
        edges = [upstream, first, second]
        before = copy.deepcopy(edges)
        actual = self.load(edges, set())
        shared = next(e for e in actual if e['child'] == 'images/crop.jpg')
        self.assertEqual(shared['_selectionSources'], ['@S1@', '@S2@'])
        self.assertEqual(edges, before)
        document = append_representations('0 HEAD\n0 TRLR\n', actual)
        self.assertIn('3 _IF_SOURCE @S1@\n3 _IF_SOURCE @S2@\n', document)
        # An independently declared original target needs no owner condition.
        actual = self.load(edges, {'images/crop.jpg'})
        self.assertEqual(next(e for e in actual if e['child'] == 'images/crop.jpg'), upstream)

    def test_ancestry_resets_at_an_explicitly_owned_step(self):
        upstream = self.edge()
        middle = self.edge('crop.jpg', 'plate.jpg'); middle['source'] = '@S1@'
        last = self.edge('plate.jpg', 'other.jpg'); last['source'] = '@S2@'
        actual = self.load([upstream, middle, last], {'images/other.jpg'})
        self.assertEqual(next(e for e in actual if e['child'] == 'images/crop.jpg')['_selectionSources'], ['@S1@'])
        self.assertEqual(next(e for e in actual if e['child'] == 'images/plate.jpg'), middle)

    def test_shared_source_object_and_mixed_ancestry_retain_distinct_owner_types(self):
        upstream = self.edge()
        first = self.edge('crop.jpg', 'plate.jpg'); first['source'] = '@S1@'
        second = self.edge('crop.jpg', 'other.jpg'); second['sourceObject'] = '@M1@'
        edges = [upstream, first, second]
        original = copy.deepcopy(edges)
        actual = self.load(edges, set())
        shared = next(e for e in actual if e['child'] == 'images/crop.jpg')
        self.assertEqual(shared['_selectionSources'], ['@S1@'])
        self.assertEqual(shared['_selectionSourceObjects'], ['@M1@'])
        self.assertEqual(edges, original)
        document = append_representations('0 HEAD\n0 TRLR\n', actual)
        self.assertIn('3 _IF_SOURCE @S1@\n3 _IF_SOURCE_OBJECT @M1@\n', document)
        self.assertIn('1 _SOURCE_OBJECT @M1@\n', document)
        actual = self.load(edges, {'images/crop.jpg'})
        self.assertEqual(next(e for e in actual if e['child'] == 'images/crop.jpg'), upstream)
        # Crossing an explicitly object-owned step resets inherited SOUR scope.
        first.pop('source'); first['sourceObject'] = '@M1@'
        second['parent'] = 'images/plate.jpg'
        second['parentSha256'] = first['childSha256']
        second.pop('sourceObject'); second['source'] = '@S1@'
        actual = self.load(edges, set())
        shared = next(e for e in actual if e['child'] == 'images/crop.jpg')
        self.assertNotIn('_selectionSources', shared)
        self.assertEqual(shared['_selectionSourceObjects'], ['@M1@'])

    def test_source_object_owner_is_a_single_valid_pointer(self):
        for value in ['', None, 1, '@M@\n0 @INJECTED@ INDI', 'not-a-pointer']:
            edge = self.edge(); edge['sourceObject'] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.load([edge])
        edge = self.edge(); edge.update(source='@S1@', sourceObject='@M1@')
        with self.assertRaises(ValueError):
            self.load([edge])

    def test_unsafe_unknown_or_incomplete_records_fail(self):
        for field, value in [('parent', '../page.jpg'), ('parent', 'images/private/access.pdf'),
                             ('childSha256', ''), ('role', 'same-person'), ('surprise', 'field')]:
            edge = self.edge(); edge[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.load([edge])
        edge = self.edge(); del edge['parentSha256']
        with self.assertRaises(ValueError): self.load([edge])

    def test_generation_hash_cannot_be_replaced_by_a_current_hash(self):
        edge = self.edge(); edge['declaredParentSha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'generation-time'):
            self.load([edge])

    def test_scalar_fields_cannot_introduce_gedcom_records(self):
        for separator in ('\n', '\r\n', '\u2028', '\v'):
            edge = self.edge()
            edge['pointer'] = '/parts' + separator + '0 @INJECTED@ INDI'
            with self.subTest(separator=repr(separator)), self.assertRaises(ValueError):
                self.load([edge])

    def test_source_owner_and_multiple_composite_witnesses_are_retained(self):
        first = self.edge('page.jpg', 'plate.jpg')
        first.update(source='@S1@', role='composite', details={'components': [{'order': 0}]})
        second = self.edge('other.jpg', 'plate.jpg')
        second.update(source='@S1@', role='composite', details={'components': [{'order': 1}]})
        actual = self.load([first, second])
        self.assertEqual(len(actual), 2)
        self.assertEqual({e['source'] for e in actual}, {'@S1@'})

    def test_portable_records_preserve_every_parent_without_creating_sources_or_people(self):
        document = '0 HEAD\n1 _ARCHIVE_CATALOG\n0 @I1@ INDI\n1 NAME Example /Person/\n0 TRLR\n'
        edges = [{'parent': p, 'child': 'images/paired.jpg', 'parentSha256': 'a' * 64,
                  'childSha256': 'b' * 64, 'witness': 'images/pair.json', 'witnessSha256': 'c' * 64,
                  'pointer': '/parts', 'role': 'composite', 'method': 'Two publications.',
                  'details': {'components': [{'order': i}]}}
                 for i, p in enumerate(['images/one.jpg', 'images/two.jpg'])]
        result = append_representations(document, edges)
        self.assertEqual(result.count('2 _REPRESENTATION @WEB_VERSION_'), 2)
        self.assertIn('2 FILE images/one.jpg\n3 _SHA256 ' + 'a' * 64, result)
        self.assertIn('2 FILE images/two.jpg', result)
        self.assertNotIn(' SOUR', result)
        self.assertNotIn(' OBJE', result)
        self.assertIn('0 @I1@ INDI\n1 NAME Example /Person/\n', result)
        with self.assertRaisesRegex(ValueError, 'conflicts'):
            append_representations(result, edges)


if __name__ == '__main__':
    unittest.main()
