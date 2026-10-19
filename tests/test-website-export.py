#!/usr/bin/env python3
"""Tests for faithful web export, independent of the lossy enriched GEDCOM."""
import importlib.util
import contextlib
import hashlib
import io
import json
import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sys
SCRIPTS = Path(__file__).resolve().parent.parent / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from booklib import Tree, SRC_GED
import flyleaf_settings

MODULE = SCRIPTS.joinpath("export-website.py")
RESEARCH_FOLDERS = ["capture", "captures", "correlation", "independent-reading", "review"]


def current_edition(path):
    spec = importlib.util.spec_from_file_location('web_composer', MODULE.with_name('compose-website.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    native = SRC_GED.read_text()
    # A family without a site overlay gets the composer's default one.
    overlay = flyleaf_settings.path('site_content') / 'edition.ged'
    path.write_text(module.compose(native, overlay.read_text() if overlay.is_file()
                                   else module.default_overlay(native)))
    return Tree(path)


class WebExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.tmp.cleanup)
        cls.tree = current_edition(Path(cls.tmp.name) / 'current.ged')

    def export(self, tree=None, edition="document"):
        self.assertTrue(MODULE.exists(), "Website exporter has not been implemented")
        spec = importlib.util.spec_from_file_location("web_export", MODULE)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod.build_data(tree or self.tree, edition=edition)

    def test_relationships_stay_in_scope_and_people_carry_no_private_prose(self):
        data = self.export()
        people = {p["id"]: p for p in data["people"]}
        for person in people.values():
            for relation in ("parents", "partners", "children", "siblings"):
                self.assertTrue(set(person[relation]).issubset(people), person["id"])
            self.assertNotIn("bio", person)
            self.assertNotIn("notes", person)

    def test_no_death_does_not_classify_historic_people_as_living(self):
        data = self.export()
        for person in data["people"]:
            self.assertNotIn("living", person, "Living status requires an explicit policy")

    def test_full_edition_retains_all_people_and_explicit_media(self):
        data = self.export(edition="all")
        self.assertEqual(len(data["people"]), len(Tree().people))
        self.assertEqual(len(data["families"]), len(Tree().fams))
        marriages = sum(any(e["type"] == "MARR" for e in f["events"]) for f in data["families"])
        native_families = [e for e in Tree()._parser.get_element_list() if e.get_level() == 0 and e.get_tag() == 'FAM']
        self.assertEqual(marriages, sum(any(c.get_tag() == 'MARR' for c in e.get_child_elements()) for e in native_families))

    def test_raw_approximate_dates_events_and_source_ids_are_stable(self):
        ged = """0 HEAD
1 SOUR TEST
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Example /Ancestor/
1 REFN example
2 TYPE jsonid
1 SEX F
1 BIRT
2 DATE ABT 1810
2 PLAC Example County, England
1 EVEN
2 TYPE School attendance
2 DATE BET 1820 AND 1824
2 PLAC Village school
1 OBJE
2 FILE images/example.jpg
2 TITL Family photograph
1 NOTE [Source] Parish register — https://example.org/record
0 TRLR
"""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "fixture.ged"
            path.write_text(ged)
            first = self.export(Tree(path), "all")
            person = first["people"][0]
            self.assertEqual(person["events"][0]["date"], "ABT 1810")
            self.assertEqual(person["events"][0]["year"], 1810)
            self.assertTrue(any(e["date"] == "BET 1820 AND 1824" for e in person["events"]))
            self.assertEqual(person["media"][0]["path"], "images/example.jpg")
            self.assertEqual(person["media"][0]["title"], "Family photograph")
            original_id = first["sources"][0]["id"]
            path.write_text(ged.replace("1 NOTE [Source] Parish", "1 NOTE [Source] Another source — https://example.org/other\n1 NOTE [Source] Parish"))
            second = self.export(Tree(path), "all")
            parish = next(s for s in second["sources"] if s["label"] == "Parish register")
            self.assertEqual(parish["id"], original_id)


class FamilyFolder(unittest.TestCase):
    """A family folder and site data folder of the test's own."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name).resolve()
        self.root = self.base / "genealogy"
        self.root.mkdir()
        self.output = self.base / "delivery" / "data"
        self.source = self.root / "input.ged"
        spec = importlib.util.spec_from_file_location("package_under_test", MODULE)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        patcher = patch.object(self.module, "ROOT", self.root)
        patcher.start()
        self.addCleanup(patcher.stop)
        # This family keeps research working files in folders with these
        # names (site.research_folders); the site leaves them out.
        self.settings({"site": {"research_folders": RESEARCH_FOLDERS}})

    def settings(self, value):
        (self.root / "flyleaf.json").write_text(json.dumps(value))
        flyleaf_settings._load.cache_clear()
        family = patch.dict(os.environ, {"FLYLEAF_FAMILY": str(self.root)})
        family.start()
        self.addCleanup(family.stop)


class PackageTests(FamilyFolder):
    """Exercise delivered GEDCOM/files, not only the diagnostic model."""

    def build(self, extra="", tail="", head="", strict=False, previews=False):
        self.source.write_text("0 HEAD\n1 CHAR UTF-8\n" + head +
                               "0 @I1@ INDI\n1 NAME Example /Person/\n" + extra + tail + "0 TRLR\n")
        return self.module.package(Tree(self.source), self.output, strict_assets=strict, previews=previews)

    def test_preview_failure_preserves_the_previous_complete_package(self):
        self.build()
        before = {p.relative_to(self.output): p.read_bytes() for p in self.output.rglob('*') if p.is_file()}
        (self.root / 'images').mkdir()
        (self.root / 'images/broken.jpg').write_bytes(b'invalid image data')
        with self.assertRaises(OSError):
            self.build('1 OBJE\n2 FILE images/broken.jpg\n', strict=True, previews=True)
        self.assertEqual(before, {p.relative_to(self.output): p.read_bytes() for p in self.output.rglob('*') if p.is_file()})

    def test_research_catalogue_follows_scope_without_importing_related_people(self):
        tail = ('0 @I2@ INDI\n1 NAME Outside /Person/\n'
                '0 @WEB_SHARED@ SOUR\n1 TITL Shared research\n1 _STATUS research-only\n'
                '1 _PERSON @I1@\n1 _PERSON @I2@\n'
                '0 @WEB_OUTSIDE@ SOUR\n1 TITL Outside research\n1 _STATUS research-only\n1 _PERSON @I2@\n')
        head = ('1 _ATLAS\n2 _ROOT @I1@\n1 _ARCHIVE_CATALOG\n'
                '2 SOUR @WEB_SHARED@\n2 SOUR @WEB_OUTSIDE@\n')
        self.build(tail=tail, head=head)
        actual = (self.output / 'family.ged').read_text()
        self.assertIn('0 @WEB_SHARED@ SOUR', actual)
        self.assertIn('1 _PERSON @I1@', actual)
        self.assertNotIn('@WEB_OUTSIDE@', actual)
        self.assertNotIn('@I2@', actual)

    def test_excluded_research_versions_do_not_leave_unqualified_files_but_shared_files_survive(self):
        (self.root / 'images').mkdir()
        (self.root / 'images/parent.txt').write_text('full source')
        (self.root / 'images/child.txt').write_text('independently held excerpt')
        tail = ('0 @I2@ INDI\n1 NAME Outside /Person/\n'
                '0 @WEB_OUTSIDE@ SOUR\n1 TITL Outside research\n1 _STATUS research-only\n1 _PERSON @I2@\n'
                '1 _ARCHIVE images/parent.txt\n'
                '0 @INCLUDED@ SOUR\n1 TITL Independently cited excerpt\n1 NOTE Its own qualification.\n'
                '1 _ARCHIVE images/child.txt\n'
                '0 @VERSION@ _REPRESENTATION\n1 FILE images/child.txt\n'
                '1 _PARENT\n2 FILE images/parent.txt\n1 _SOURCE @WEB_OUTSIDE@\n')
        head = ('1 _ATLAS\n2 _ROOT @I1@\n1 _ARCHIVE_CATALOG\n'
                '2 SOUR @WEB_OUTSIDE@\n2 _REPRESENTATION @VERSION@\n')
        self.build('1 SOUR @INCLUDED@\n2 PAGE Independent locator\n', tail=tail, head=head, strict=True)
        actual = (self.output / 'family.ged').read_text()
        self.assertNotIn('@VERSION@', actual)
        self.assertNotIn('@WEB_OUTSIDE@', actual)
        self.assertNotIn('images/parent.txt', actual)
        self.assertFalse((self.output / 'images/parent.txt').exists())
        self.assertIn('2 PAGE Independent locator', actual)
        self.assertIn('1 NOTE Its own qualification.', actual)
        self.assertEqual((self.output / 'images/child.txt').read_text(), 'independently held excerpt')

    def test_preview_control_paths_cannot_be_overwritten_by_source_media(self):
        for path in ['previews.json', 'previews/file.jpg']:
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, 'collides'):
                self.build(f'1 OBJE\n2 FILE {path}\n', previews=True)

    def test_native_source_versions_require_an_independently_retained_citation(self):
        (self.root / 'images').mkdir()
        for name in ['page.txt', 'crop.txt']:
            (self.root / 'images' / name).write_text(name)
        tail = ('0 @I2@ INDI\n1 NAME Outside /Person/\n1 SOUR @PUBLICATION@\n'
                '0 @PUBLICATION@ SOUR\n1 TITL Published source\n1 NOTE Exact source assessment.\n'
                '1 OBJE\n2 FILE images/page.txt\n'
                '0 @VERSION@ _REPRESENTATION\n1 FILE images/crop.txt\n'
                '1 _PARENT\n2 FILE images/page.txt\n1 _SOURCE @PUBLICATION@\n')
        head = '1 _ATLAS\n2 _ROOT @I1@\n1 _ARCHIVE_CATALOG\n2 _REPRESENTATION @VERSION@\n'
        for cited in (False, True):
            with self.subTest(cited=cited):
                self.build('1 SOUR @PUBLICATION@\n2 PAGE Own locator\n' if cited else '',
                           tail=tail, head=head, strict=True)
                actual = (self.output / 'family.ged').read_text()
                self.assertEqual('@VERSION@' in actual, cited)
                self.assertEqual('@PUBLICATION@' in actual, cited)
                self.assertEqual((self.output / 'images/crop.txt').exists(), cited)
                if cited:
                    self.assertIn('1 NOTE Exact source assessment.', actual)
                    self.assertIn('2 PAGE Own locator', actual)

    def test_conditional_ancestry_requires_an_independent_owner_and_consumes_all_selectors(self):
        (self.root / 'images').mkdir()
        for name in ['original.txt', 'intermediate.txt', 'first.txt', 'second.txt']:
            (self.root / 'images' / name).write_text(name)
        tail = ('0 @S1@ SOUR\n1 TITL First independently selected source\n'
                '0 @S2@ SOUR\n1 TITL Second independently selected source\n'
                '0 @UPSTREAM@ _REPRESENTATION\n1 FILE images/intermediate.txt\n'
                '1 _PARENT\n2 FILE images/original.txt\n'
                '0 @FIRST@ _REPRESENTATION\n1 FILE images/first.txt\n'
                '1 _PARENT\n2 FILE images/intermediate.txt\n1 _SOURCE @S1@\n'
                '0 @SECOND@ _REPRESENTATION\n1 FILE images/second.txt\n'
                '1 _PARENT\n2 FILE images/intermediate.txt\n1 _SOURCE @S2@\n')
        head = ('1 _ATLAS\n2 _ROOT @I1@\n1 _ARCHIVE_CATALOG\n'
                '2 _REPRESENTATION @UPSTREAM@\n3 _IF_SOURCE @S1@\n3 _IF_SOURCE @S2@\n'
                '2 _REPRESENTATION @FIRST@\n2 _REPRESENTATION @SECOND@\n')
        for cited in (set(), {'@S1@'}, {'@S2@'}, {'@S1@', '@S2@'}):
            with self.subTest(cited=cited):
                manifest = self.build(''.join(f'1 SOUR {sid}\n' for sid in sorted(cited)),
                                      head=head, tail=tail, strict=True)
                actual = (self.output / 'family.ged').read_text()
                self.assertNotIn('_IF_SOURCE', actual)
                self.assertEqual('@UPSTREAM@' in actual, bool(cited))
                self.assertEqual('@S1@' in actual, '@S1@' in cited)
                self.assertEqual('@S2@' in actual, '@S2@' in cited)
                expected = {'images/original.txt', 'images/intermediate.txt'} if cited else set()
                if '@S1@' in cited: expected.add('images/first.txt')
                if '@S2@' in cited: expected.add('images/second.txt')
                self.assertEqual(set(manifest['assets']), expected)

    def test_conditional_sources_cannot_replace_explicit_ownership_or_retain_excluded_research(self):
        tail = ('0 @I2@ INDI\n1 NAME Outside /Person/\n'
                '0 @S1@ SOUR\n1 TITL Citation\n'
                '0 @S2@ SOUR\n1 TITL Outside research\n1 _STATUS research-only\n1 _PERSON @I2@\n'
                '0 @V@ _REPRESENTATION\n1 _SOURCE @S2@\n')
        head = ('1 _ATLAS\n2 _ROOT @I1@\n1 _ARCHIVE_CATALOG\n2 SOUR @S2@\n'
                '2 _REPRESENTATION @V@\n3 _IF_SOURCE @S1@\n')
        self.build('1 SOUR @S1@\n', head=head, tail=tail)
        actual = (self.output / 'family.ged').read_text()
        self.assertNotIn('@S2@', actual)
        self.assertNotIn('@V@', actual)
        self.assertNotIn('_IF_SOURCE', actual)

    def test_conditional_ancestry_rejects_missing_or_non_source_selectors(self):
        for condition in ['', '@MISSING@', '@I1@', 'not-a-pointer']:
            with self.subTest(condition=condition), self.assertRaisesRegex(ValueError, 'conditional source'):
                self.build(head='1 _ARCHIVE_CATALOG\n2 _REPRESENTATION @V@\n3 _IF_SOURCE ' + condition + '\n',
                           tail='0 @V@ _REPRESENTATION\n')

    def test_shared_obituary_version_requires_its_independently_retained_note_object(self):
        (self.root / 'images').mkdir()
        for name in ['page.txt', 'render.txt']:
            (self.root / 'images' / name).write_text(name)
        note = '1 NOTE [Source] Shared obituary (sister) — exact attribution\n2 PAGE Own locator\n'
        tail = ('0 @I2@ INDI\n1 NAME Outside /Person/\n'
                + note + '2 OBJE @M@\n'
                '0 @M@ OBJE\n1 FILE images/page.txt\n'
                '0 @VERSION@ _REPRESENTATION\n1 FILE images/render.txt\n'
                '1 _PARENT\n2 FILE images/page.txt\n1 _SOURCE_OBJECT @M@\n')
        head = '1 _ATLAS\n2 _ROOT @I1@\n1 _ARCHIVE_CATALOG\n2 _REPRESENTATION @VERSION@\n'
        for attached in (False, True):
            with self.subTest(attached=attached):
                manifest = self.build(note + ('2 OBJE @M@\n' if attached else ''),
                                      tail=tail, head=head, strict=True)
                actual = (self.output / 'family.ged').read_text()
                self.assertIn(note, actual)
                self.assertNotIn('@I2@', actual)
                self.assertEqual('@VERSION@' in actual, attached)
                self.assertEqual('@M@' in actual, attached)
                self.assertEqual(set(manifest['assets']),
                                 {'images/page.txt', 'images/render.txt'} if attached else set())

    def test_mixed_source_and_object_conditions_are_one_union_and_consumed(self):
        (self.root / 'images').mkdir()
        for name in ['original.txt', 'middle.txt', 'first.txt', 'second.txt']:
            (self.root / 'images' / name).write_text(name)
        tail = ('0 @S@ SOUR\n1 TITL Separate source\n'
                '0 @M@ OBJE\n1 FILE images/second.txt\n'
                '0 @UP@ _REPRESENTATION\n1 FILE images/middle.txt\n1 _PARENT\n2 FILE images/original.txt\n'
                '0 @FIRST@ _REPRESENTATION\n1 FILE images/first.txt\n1 _PARENT\n2 FILE images/middle.txt\n1 _SOURCE @S@\n'
                '0 @SECOND@ _REPRESENTATION\n1 FILE images/second.txt\n1 _PARENT\n2 FILE images/middle.txt\n1 _SOURCE_OBJECT @M@\n')
        head = ('1 _ATLAS\n2 _ROOT @I1@\n1 _ARCHIVE_CATALOG\n'
                '2 _REPRESENTATION @UP@\n3 _IF_SOURCE @S@\n3 _IF_SOURCE_OBJECT @M@\n'
                '2 _REPRESENTATION @FIRST@\n2 _REPRESENTATION @SECOND@\n')
        for source, obj in [(False, False), (True, False), (False, True), (True, True)]:
            with self.subTest(source=source, obj=obj):
                links = ('1 SOUR @S@\n' if source else '')
                links += ('1 NOTE [Source] Shared obituary\n2 OBJE @M@\n' if obj else '')
                manifest = self.build(links, tail=tail, head=head, strict=True)
                actual = (self.output / 'family.ged').read_text()
                self.assertEqual('@UP@' in actual, source or obj)
                self.assertEqual('@S@' in actual, source)
                self.assertEqual('@M@' in actual, obj)
                self.assertNotIn('_IF_SOURCE', actual)
                expected = {'images/original.txt', 'images/middle.txt'} if source or obj else set()
                if source: expected.add('images/first.txt')
                if obj: expected.add('images/second.txt')
                self.assertEqual(set(manifest['assets']), expected)

    def test_source_object_ownership_cannot_be_bootstrapped_or_replaced_by_conditions(self):
        tail = ('0 @S@ SOUR\n1 TITL Selected source\n0 @M@ OBJE\n1 TITL Unselected object\n'
                '0 @V@ _REPRESENTATION\n1 _SOURCE_OBJECT @M@\n')
        head = '1 _ARCHIVE_CATALOG\n2 _REPRESENTATION @V@\n3 _IF_SOURCE @S@\n'
        self.build('1 SOUR @S@\n', head=head, tail=tail)
        actual = (self.output / 'family.ged').read_text()
        self.assertIn('@S@', actual)
        self.assertNotIn('@M@', actual)
        self.assertNotIn('@V@', actual)

    def test_source_object_owners_and_selectors_reject_missing_wrong_type_and_dual_owners(self):
        for pointer in ['@MISSING@', '@I1@', '@S@']:
            with self.subTest(pointer=pointer), self.assertRaisesRegex(ValueError, 'source object owner'):
                self.build(head='1 _ARCHIVE_CATALOG\n2 _REPRESENTATION @V@\n',
                           tail=f'0 @S@ SOUR\n1 TITL Source\n0 @V@ _REPRESENTATION\n1 _SOURCE_OBJECT {pointer}\n')
            with self.subTest(condition=pointer), self.assertRaisesRegex(ValueError, 'conditional source object'):
                self.build(head=f'1 _ARCHIVE_CATALOG\n2 _REPRESENTATION @V@\n3 _IF_SOURCE_OBJECT {pointer}\n',
                           tail='0 @S@ SOUR\n1 TITL Source\n0 @V@ _REPRESENTATION\n')
        with self.assertRaisesRegex(ValueError, 'source object owner'):
            self.build(head='1 _ARCHIVE_CATALOG\n2 _REPRESENTATION @V@\n',
                       tail='0 @S@ SOUR\n1 TITL Source\n0 @M@ OBJE\n1 TITL Shared\n0 @V@ _REPRESENTATION\n1 _SOURCE @S@\n1 _SOURCE_OBJECT @M@\n')

    def test_catalog_media_closure_and_per_file_hash_are_checked(self):
        (self.root / 'images').mkdir()
        held = self.root / 'images/illustration.jpg'
        held.write_bytes(b'held illustration fixture')
        expected = hashlib.sha256(held.read_bytes()).hexdigest()
        tail = f'0 @M@ OBJE\n1 FILE images/illustration.jpg\n2 _SHA256 {expected}\n1 TITL Exact book caption\n'
        manifest = self.build(head='1 _ARCHIVE_CATALOG\n2 OBJE @M@\n', tail=tail, strict=True)
        self.assertEqual(manifest['assets'], ['images/illustration.jpg'])
        previous = (self.output / 'images/illustration.jpg').read_bytes()
        held.write_bytes(b'changed illustration')
        with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
            self.build(head='1 _ARCHIVE_CATALOG\n2 OBJE @M@\n', tail=tail, strict=True)
        self.assertEqual((self.output / 'images/illustration.jpg').read_bytes(), previous)

    def test_generation_records_package_both_endpoints_and_require_current_recipe_witness(self):
        (self.root / 'images').mkdir()
        for name in ['page.jpg', 'crop.jpg']:
            (self.root / 'images' / name).write_bytes(name.encode())
        witness = self.root / 'images/recipe.json'
        witness.write_text('{"method":"exact crop"}')
        expected = hashlib.sha256(witness.read_bytes()).hexdigest()
        tail = ('0 @V@ _REPRESENTATION\n1 FILE images/crop.jpg\n1 _PARENT\n2 FILE images/page.jpg\n'
                f'1 _PROVENANCE images/recipe.json\n2 _HASH {expected}\n')
        head = '1 _ARCHIVE_CATALOG\n2 _REPRESENTATION @V@\n'
        manifest = self.build(head=head, tail=tail, strict=True)
        self.assertEqual(set(manifest['assets']), {'images/crop.jpg', 'images/page.jpg'})
        self.assertEqual(manifest['provenance'], {'images/recipe.json': expected})
        self.assertFalse((self.output / 'images/recipe.json').exists())
        previous = (self.output / 'family.ged').read_bytes()
        witness.write_text('{"method":"changed recipe"}')
        with self.assertRaisesRegex(ValueError, 'Stale recipe witness'):
            self.build(head=head, tail=tail, strict=True)
        self.assertEqual((self.output / 'family.ged').read_bytes(), previous)

    def test_private_configuration_is_never_a_publishable_asset(self):
        secret = self.root / 'CREDENTIALS.local.md'
        secret.write_text('FAKE FIXTURE ONLY')
        with self.assertRaisesRegex(ValueError, 'private configuration'):
            self.build('1 OBJE\n2 FILE CREDENTIALS.local.md\n')
        self.assertFalse(self.output.exists())

    def test_strict_asset_boundary_accounts_for_excluded_supporting_files(self):
        (self.root / 'images').mkdir()
        (self.root / 'images/record.jpg').write_bytes(b'held record fixture')
        (self.root / 'images/capture.json').write_text('support metadata')
        manifest = self.build('1 OBJE\n2 FILE images/record.jpg\n1 OBJE\n2 FILE images/capture.json\n', strict=True)
        self.assertEqual(manifest['assets'], ['images/record.jpg'])
        self.assertEqual(manifest['excludedResearchAssets'], ['images/capture.json'])
        self.assertNotIn('capture.json', (self.output / 'family.ged').read_text())

    def test_heic_original_and_portable_display_keep_exact_bytes_and_hash_gate(self):
        (self.root / 'images').mkdir()
        original = b'held HEIC original fixture'
        display = b'ordinary JPEG display fixture'
        (self.root / 'images/photo.HEIC').write_bytes(original)
        (self.root / 'images/display.jpg').write_bytes(display)
        photo = ('1 OBJE\n2 FILE images/photo.HEIC\n3 _KIND photograph\n'
                 f'3 _SHA256 {hashlib.sha256(original).hexdigest()}\n')
        jpeg = ('1 OBJE\n2 FILE images/display.jpg\n3 _KIND photograph\n'
                f'3 _SHA256 {hashlib.sha256(display).hexdigest()}\n')
        result = self.build(photo + jpeg, strict=True)
        self.assertEqual(set(result['assets']), {'images/photo.HEIC', 'images/display.jpg'})
        self.assertEqual((self.output / 'images/photo.HEIC').read_bytes(), original)
        self.assertEqual((self.output / 'images/display.jpg').read_bytes(), display)
        before = (self.output / 'family.ged').read_bytes()
        (self.root / 'images/photo.HEIC').write_bytes(b'changed original')
        with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
            self.build(photo + jpeg, strict=True)
        self.assertEqual((self.output / 'family.ged').read_bytes(), before)

    def test_an_image_alias_cannot_export_private_configuration(self):
        (self.root / 'images').mkdir()
        secret = self.root / 'CREDENTIALS.local.md'
        secret.write_text('FAKE FIXTURE ONLY')
        (self.root / 'images/portrait.jpg').symlink_to(secret)
        with self.assertRaisesRegex(ValueError, 'private configuration'):
            self.build('1 OBJE\n2 FILE images/portrait.jpg\n', strict=True)
        self.assertFalse(self.output.exists())

    def test_structured_reader_keeps_exact_bytes_and_qualifiers_but_not_untyped_metadata(self):
        (self.root / 'images').mkdir()
        content = b'{"body":"Birth date reported by provider: 29 November; original differs."}'
        (self.root / 'images/index.json').write_bytes(content)
        (self.root / 'images/provenance.json').write_text('{"working":true}')
        sha = hashlib.sha256(content).hexdigest()
        file = ('2 FILE images/index.json\n3 _KIND record-index\n3 _NATURE provider-index\n'
                f'3 _SHA256 {sha}\n3 NOTE Derivative index; no original date adopted.\n')
        result = self.build('1 OBJE\n' + file + '1 OBJE\n2 FILE images/provenance.json\n', strict=True)
        self.assertEqual(result['assets'], ['images/index.json'])
        self.assertEqual(result['excludedResearchAssets'], ['images/provenance.json'])
        self.assertEqual((self.output / 'images/index.json').read_bytes(), content)
        self.assertIn('3 NOTE Derivative index; no original date adopted.', (self.output / 'family.ged').read_text())

    def test_structured_reader_requires_matching_hash_and_keeps_previous_package_on_failure(self):
        self.build()
        before = (self.output / 'family.ged').read_bytes()
        (self.root / 'images').mkdir()
        (self.root / 'images/index.json').write_text('{"body":"changed"}')
        for kind in ['record-index', 'research-note']:
            for suffix in ['', '3 _SHA256 ' + '0' * 64 + '\n']:
                with self.subTest(kind=kind, suffix=suffix), self.assertRaises(ValueError):
                    self.build(f'1 OBJE\n2 FILE images/index.json\n3 _KIND {kind}\n' + suffix, strict=True)
                self.assertEqual((self.output / 'family.ged').read_bytes(), before)

    def test_reviewed_structured_capture_keeps_bytes_but_never_admits_private_aliases(self):
        (self.root / 'images/capture').mkdir(parents=True)
        content = b'{"body":"not public"}'
        (self.root / 'images/capture/index.json').write_bytes(content)
        sha = hashlib.sha256(content).hexdigest()
        for kind in ['record-index', 'research-note']:
            with self.subTest(kind=kind):
                result = self.build(f'1 OBJE\n2 FILE images/capture/index.json\n3 _KIND {kind}\n'
                                    f'3 _SHA256 {sha}\n', strict=True)
                self.assertEqual(result['assets'], ['images/capture/index.json'])
                self.assertEqual((self.output / 'images/capture/index.json').read_bytes(), content)
        private = self.root / 'credentials.json'
        private.write_bytes(content)
        (self.root / 'images/index.json').symlink_to(private)
        for kind in ['record-index', 'research-note']:
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, 'private configuration'):
                self.build(f'1 OBJE\n2 FILE images/index.json\n3 _KIND {kind}\n'
                           f'3 _SHA256 {sha}\n', strict=True)

    def test_reviewed_work_folder_files_require_both_explicit_kind_and_exact_hash(self):
        directory = self.root / 'images/independent-reading'
        directory.mkdir(parents=True)
        for name, kind, content in [
            ('detail.png', 'document', b'held reading image'),
            ('reading.txt', 'transcription', b'Literal reading\nUncertain: [name].\n'),
            ('report.md', 'research-note', b'# Assessment\n\nNot an adopted relationship.\n'),
            ('search.json', 'search-capture', b'{"body":"zero matches","query":"Place:1948"}'),
        ]:
            with self.subTest(name=name):
                path = 'images/independent-reading/' + name
                (directory / name).write_bytes(content)
                digest = hashlib.sha256(content).hexdigest()
                declared = f'1 OBJE\n2 FILE {path}\n3 _KIND {kind}\n3 _SHA256 {digest}\n'
                result = self.build(declared, strict=True)
                self.assertEqual(result['assets'], [path])
                self.assertEqual((self.output / path).read_bytes(), content)
                before = (self.output / 'family.ged').read_bytes()
                with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
                    self.build(declared.replace(digest, '0' * 64), strict=True)
                self.assertEqual((self.output / 'family.ged').read_bytes(), before)
                for incomplete in [f'3 _KIND {kind}\n', f'3 _SHA256 {digest}\n',
                                   f'3 _KIND unreviewed\n3 _SHA256 {digest}\n']:
                    result = self.build(f'1 OBJE\n2 FILE {path}\n' + incomplete, strict=True)
                    self.assertEqual(result['assets'], [])
                    self.assertEqual(result['excludedResearchAssets'], [path])

    def test_markdown_requires_explicit_text_role_and_hash_in_every_file_context(self):
        (self.root / 'images').mkdir()
        content = b'# Retained report\n\n<script>literal text</script>\n'
        (self.root / 'images/report.md').write_bytes(content)
        digest = hashlib.sha256(content).hexdigest()
        for tag in ['FILE', '_ARCHIVE']:
            for kind in ['research-note', 'transcription']:
                with self.subTest(tag=tag, kind=kind):
                    declared = f'1 {tag} images/report.md\n2 _KIND {kind}\n'
                    with self.assertRaisesRegex(ValueError, 'reviewed SHA-256'):
                        self.build(declared, strict=True)
                    result = self.build(declared + f'2 _SHA256 {digest}\n', strict=True)
                    self.assertEqual(result['assets'], ['images/report.md'])
                    self.assertEqual((self.output / 'images/report.md').read_bytes(), content)
        result = self.build('1 OBJE\n2 FILE images/report.md\n', strict=True)
        self.assertEqual(result['assets'], [])

    def test_alias_into_work_directory_needs_explicit_review_and_still_rejects_code(self):
        (self.root / 'images/review').mkdir(parents=True)
        content = b'Exact held reading crop'
        (self.root / 'images/review/detail.png').write_bytes(content)
        (self.root / 'images/detail.png').symlink_to(self.root / 'images/review/detail.png')
        with self.assertRaisesRegex(ValueError, 'resolves outside'):
            self.build('1 OBJE\n2 FILE images/detail.png\n', strict=True)
        digest = hashlib.sha256(content).hexdigest()
        result = self.build('1 OBJE\n2 FILE images/detail.png\n3 _KIND document\n'
                            f'3 _SHA256 {digest}\n', strict=True)
        self.assertEqual((self.output / 'images/detail.png').read_bytes(), content)
        (self.root / 'images/review/tool.py').write_bytes(content)
        result = self.build('1 OBJE\n2 FILE images/review/tool.py\n3 _KIND research-note\n'
                            f'3 _SHA256 {digest}\n', strict=True)
        self.assertEqual(result['assets'], [])

    def test_research_reading_keeps_all_fields_under_its_existing_source_and_scope(self):
        (self.root / 'images').mkdir()
        content = b'{"body":"Retained reading", "interpretation":"Identity unproved", "old_status":"unread"}\n'
        for name in ['reading', 'outside', 'untyped']:
            (self.root / f'images/{name}.json').write_bytes(content)
        digest = hashlib.sha256(content).hexdigest()
        sources = ''.join(
            f'0 @{sid}@ SOUR\n1 TITL Saved research\n1 _STATUS research-only\n1 _PERSON @{person}@\n'
            f'1 OBJE\n2 FILE images/{name}.json\n3 _KIND research-note\n3 _SHA256 {digest}\n'
            '3 NOTE Recorded text and interpretation; old status is historical.\n'
            for sid, person, name in [('S1', 'I1', 'reading'), ('S2', 'I2', 'outside')])
        result = self.build(
            head='1 _ATLAS\n2 _ROOT @I1@\n1 _ARCHIVE_CATALOG\n2 SOUR @S1@\n2 SOUR @S2@\n',
            tail=('0 @I2@ INDI\n1 NAME Outside /Person/\n' + sources
                  + '1 OBJE\n2 FILE images/untyped.json\n'), strict=True)
        self.assertEqual(result['assets'], ['images/reading.json'])
        self.assertEqual((self.output / 'images/reading.json').read_bytes(), content)
        delivered = (self.output / 'family.ged').read_text()
        self.assertIn('1 _STATUS research-only', delivered)
        self.assertIn('3 NOTE Recorded text and interpretation; old status is historical.', delivered)
        self.assertNotIn('@S2@', delivered)
        self.assertNotIn('untyped.json', delivered)
        self.assertNotRegex(delivered, r'(?m)^1 SOUR @S1@$')

    def test_typed_finding_aid_and_shared_index_follow_edition_ownership(self):
        (self.root / 'images').mkdir()
        xml = b'<ead><title>Family papers</title></ead>'
        (self.root / 'images/guide.xml').write_bytes(xml)
        index = b'{"body":"Outside family"}'
        (self.root / 'images/outside.json').write_bytes(index)
        result = self.build(
            '1 OBJE @M@\n',
            head='1 _ATLAS\n2 _ROOT @I1@\n1 _ARCHIVE_CATALOG\n2 SOUR @S2@\n',
            tail=('0 @I2@ INDI\n1 NAME Outside /Person/\n'
                  '0 @M@ OBJE\n1 FILE images/guide.xml\n2 _KIND finding-aid\n'
                  f'2 _SHA256 {hashlib.sha256(xml).hexdigest()}\n'
                  '0 @S2@ SOUR\n1 TITL Excluded research\n1 _STATUS research-only\n1 _PERSON @I2@\n'
                  '1 OBJE\n2 FILE images/outside.json\n3 _KIND record-index\n'
                  f'3 _SHA256 {hashlib.sha256(index).hexdigest()}\n'), strict=True)
        self.assertEqual(result['assets'], ['images/guide.xml'])
        self.assertEqual((self.output / 'images/guide.xml').read_bytes(), xml)
        self.assertNotIn('@S2@', (self.output / 'family.ged').read_text())

    def test_all_structured_asset_contexts_require_a_hash(self):
        (self.root / 'images').mkdir()
        content = b'{"body":"Captured index"}'
        (self.root / 'images/index.json').write_bytes(content)
        for kind in ['record-index', 'research-note']:
            for tag in ['_ARCHIVE', 'FILE']:
                with self.subTest(kind=kind, tag=tag), self.assertRaisesRegex(ValueError, 'reviewed SHA-256'):
                    self.build(f'1 {tag} images/index.json\n2 _KIND {kind}\n', strict=True)
                result = self.build(f'1 {tag} images/index.json\n2 _KIND {kind}\n'
                                    f'2 _SHA256 {hashlib.sha256(content).hexdigest()}\n', strict=True)
                self.assertEqual(result['assets'], ['images/index.json'])

    def test_mixed_media_keeps_each_supported_file_and_pointer_target(self):
        (self.root / 'images').mkdir()
        for name in ['front.jpg', 'back.jpg']:
            (self.root / 'images' / name).write_bytes(name.encode())
        (self.root / 'images/capture.json').write_text('support metadata')
        for linked in [False, True]:
            with self.subTest(linked=linked):
                media = '2 FILE images/front.jpg\n2 FILE images/capture.json\n2 FILE images/back.jpg\n'
                extra = '1 OBJE\n' + media
                tail = ''
                if linked:
                    extra = '1 OBJE @M@\n'
                    tail = '0 @M@ OBJE\n' + media.replace('2 FILE', '1 FILE')
                manifest = self.build(extra, tail=tail, strict=True)
                self.assertCountEqual(manifest['assets'], ['images/front.jpg', 'images/back.jpg'])
                self.assertEqual(manifest['excludedResearchAssets'], ['images/capture.json'])
                delivered = (self.output / 'family.ged').read_text()
                self.assertNotIn('capture.json', delivered)
                if linked:
                    self.assertIn('1 OBJE @M@', delivered)
                    self.assertIn('0 @M@ OBJE', delivered)

    def test_media_containing_only_support_files_leaves_no_dangling_pointer(self):
        manifest = self.build('1 OBJE @M@\n', tail='0 @M@ OBJE\n1 FILE images/capture.json\n', strict=True)
        self.assertEqual(manifest['assets'], [])
        self.assertEqual(manifest['excludedResearchAssets'], ['images/capture.json'])
        self.assertNotIn('@M@', (self.output / 'family.ged').read_text())

    def test_supported_media_does_not_hide_a_private_file_in_the_same_object(self):
        with self.assertRaisesRegex(ValueError, 'private configuration'):
            self.build('1 OBJE\n2 FILE images/front.jpg\n2 FILE CREDENTIALS.local.md\n', strict=True)
        self.assertFalse(self.output.exists())

    def test_cli_requires_declared_scope_instead_of_exporting_everyone(self):
        self.source.write_text('0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME A /Person/\n0 TRLR\n')
        with patch('sys.argv', [str(MODULE), '--source', str(self.source), '--output', str(self.output)]):
            with self.assertRaisesRegex(ValueError, 'must declare HEAD/_ATLAS/_ROOT'):
                self.module.main()
        self.assertFalse(self.output.exists())

    def test_asset_destination_cannot_escape_via_parent_segments(self):
        (self.root / "escape.txt").write_text("source")
        with self.assertRaises(ValueError):
            self.build("1 OBJE\n2 FILE ../genealogy/escape.txt\n")
        self.assertFalse((self.output.parent / "genealogy" / "escape.txt").exists())
        self.assertFalse(self.output.exists())

    def test_source_symlink_cannot_copy_a_file_outside_asset_root(self):
        outside = self.base / "private.txt"
        outside.write_text("not a family asset")
        (self.root / "linked.txt").symlink_to(outside)
        with self.assertRaises(ValueError):
            self.build("1 OBJE\n2 FILE linked.txt\n")
        self.assertFalse(self.output.exists())

    def test_output_symlink_cannot_redirect_package_writes(self):
        outside = self.base / "outside"
        outside.mkdir()
        self.output.parent.mkdir()
        self.output.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.build()
        self.assertEqual(list(outside.iterdir()), [])

    def test_repackaging_removes_assets_no_longer_in_scope(self):
        (self.root / "portrait.txt").write_text("held photograph")
        self.build("1 OBJE\n2 FILE portrait.txt\n")
        self.assertTrue((self.output / "portrait.txt").is_file())
        manifest = self.build()
        self.assertEqual(manifest["assets"], [])
        self.assertFalse((self.output / "portrait.txt").exists())

    def test_missing_asset_cannot_leave_a_previously_copied_version(self):
        original = self.root / "portrait.txt"
        original.write_text("outdated copy")
        self.build("1 OBJE\n2 FILE portrait.txt\n")
        original.unlink()
        manifest = self.build("1 OBJE\n2 FILE portrait.txt\n")
        self.assertEqual(manifest["missingAssets"], ["portrait.txt"])
        self.assertFalse((self.output / "portrait.txt").exists())

    def test_package_cannot_replace_unrelated_directory_contents(self):
        self.output.mkdir(parents=True)
        unrelated = self.output / "family-letter.txt"
        unrelated.write_text("authored original")
        with self.assertRaises(ValueError):
            self.build()
        self.assertEqual(unrelated.read_text(), "authored original")

    def test_asset_cannot_overwrite_delivered_gedcom(self):
        (self.root / "family.ged").write_text("not the generated edition")
        with self.assertRaises(ValueError):
            self.build("1 OBJE\n2 FILE family.ged\n")
        self.assertFalse(self.output.exists())

    def test_existing_asset_symlink_cannot_overwrite_external_file(self):
        (self.root / "portrait.txt").write_text("image content")
        self.build("1 OBJE\n2 FILE portrait.txt\n")
        outside = self.base / "outside.txt"
        outside.write_text("external original")
        (self.output / "portrait.txt").unlink()
        (self.output / "portrait.txt").symlink_to(outside)
        with self.assertRaises(ValueError):
            self.build("1 OBJE\n2 FILE portrait.txt\n")
        self.assertEqual(outside.read_text(), "external original")

    def test_failed_manuscript_validation_preserves_last_complete_package(self):
        manuscript = self.root / "chapter.typ"
        manuscript.write_text("Current reviewed prose")
        digest = hashlib.sha256(manuscript.read_bytes()).hexdigest()
        chapter = ("0 @C1@ _CHAP\n1 TITL Chapter\n1 _SECTION section\n"
                   "2 _PERSON @I1@\n2 NOTE Reviewed adaptation\n"
                   f"2 _MANUSCRIPT chapter.typ\n3 _HASH {digest}\n")
        self.build(tail=chapter)
        before = (self.output / "family.ged").read_bytes()
        manuscript.write_text("Changed book evidence")
        with self.assertRaises(ValueError):
            self.build(tail=chapter)
        self.assertEqual((self.output / "family.ged").read_bytes(), before)

    def test_changed_archive_bytes_preserve_last_complete_package(self):
        archive = self.root / "record.pdf"
        archive.write_bytes(b"Original paginated archive")
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        source = ("0 @S1@ SOUR\n1 TITL Verified original\n"
                  f"1 _ARCHIVE record.pdf\n2 _SHA256 {digest}\n")
        self.build("1 SOUR @S1@\n", tail=source)
        before = {path.relative_to(self.output): path.read_bytes()
                  for path in self.output.rglob('*') if path.is_file()}
        archive.write_bytes(b"Replacement with different page numbers")
        with self.assertRaisesRegex(ValueError, 'Archive SHA-256 mismatch.*record.pdf'):
            self.build("1 SOUR @S1@\n", tail=source)
        after = {path.relative_to(self.output): path.read_bytes()
                 for path in self.output.rglob('*') if path.is_file()}
        self.assertEqual(after, before)

    def test_archive_hash_checks_copied_bytes_before_publication(self):
        archive = self.root / "record.pdf"
        archive.write_bytes(b"Verified page sequence")
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        self.build()
        before = (self.output / "family.ged").read_bytes()
        source = ("0 @S1@ SOUR\n1 TITL Verified original\n"
                  f"1 _ARCHIVE record.pdf\n2 _SHA256 {digest}\n")
        real_copy = self.module.shutil.copyfile

        def copy_changed_archive(source, target):
            result = real_copy(source, target)
            Path(target).write_bytes(b"Changed while copying")
            return result

        with patch.object(self.module.shutil, 'copyfile', copy_changed_archive):
            with self.assertRaisesRegex(ValueError, 'Archive SHA-256 mismatch'):
                self.build("1 SOUR @S1@\n", tail=source)
        self.assertEqual((self.output / "family.ged").read_bytes(), before)
        self.assertFalse((self.output / "record.pdf").exists())

    def test_declared_archive_hash_must_be_valid_when_file_is_present(self):
        (self.root / "record.pdf").write_bytes(b"Held archive")
        for digest in ['', 'not-a-digest', 'a' * 63]:
            with self.subTest(digest=digest):
                source = ("0 @S1@ SOUR\n1 TITL Original\n"
                          f"1 _ARCHIVE record.pdf\n2 _SHA256 {digest}\n")
                with self.assertRaisesRegex(ValueError, 'Invalid archive SHA-256.*record.pdf'):
                    self.build("1 SOUR @S1@\n", tail=source)
        self.assertFalse(self.output.exists())

    def test_repeated_archive_declarations_are_deduplicated_and_all_checked(self):
        archive = self.root / "record.pdf"
        archive.write_bytes(b"One archive referenced twice")
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        source = ("0 @S1@ SOUR\n1 TITL First citation\n"
                  f"1 _ARCHIVE record.pdf\n2 _SHA256 {digest}\n"
                  "0 @S2@ SOUR\n1 TITL Second citation\n"
                  f"1 _ARCHIVE record.pdf\n2 _SHA256 {digest.upper()}\n")
        manifest = self.build("1 SOUR @S1@\n1 SOUR @S2@\n", tail=source)
        self.assertEqual(manifest['assets'], ['record.pdf'])
        self.assertEqual((self.output / 'record.pdf').read_bytes(), archive.read_bytes())
        source = source.replace(digest.upper(), '0' * 64)
        with self.assertRaisesRegex(ValueError, 'Archive SHA-256 mismatch'):
            self.build("1 SOUR @S1@\n1 SOUR @S2@\n", tail=source)

    def test_missing_archive_with_declared_hash_stays_in_missing_assets(self):
        source = ("0 @S1@ SOUR\n1 TITL Original archive\n"
                  f"1 _ARCHIVE missing.pdf\n2 _SHA256 {'0' * 64}\n")
        manifest = self.build("1 SOUR @S1@\n", tail=source)
        self.assertEqual(manifest['missingAssets'], ['missing.pdf'])
        self.assertEqual(manifest['assets'], [])
        self.assertFalse((self.output / 'missing.pdf').exists())

    def test_legacy_archive_without_hash_remains_supported(self):
        (self.root / "legacy.pdf").write_bytes(b"Previously held archive")
        source = "0 @S1@ SOUR\n1 TITL Original archive\n1 _ARCHIVE legacy.pdf\n"
        manifest = self.build("1 SOUR @S1@\n", tail=source)
        self.assertEqual(manifest['assets'], ['legacy.pdf'])
        self.assertEqual((self.output / 'legacy.pdf').read_bytes(), b"Previously held archive")

    def test_interrupted_publish_restores_previous_complete_package(self):
        portrait = self.root / "portrait.txt"
        portrait.write_text("Original picture")
        self.build("1 OBJE\n2 FILE portrait.txt\n")
        before = {path.relative_to(self.output): path.read_bytes()
                  for path in self.output.rglob('*') if path.is_file()}
        portrait.write_text("Replacement picture")
        real_rename = Path.rename

        def interrupt_publish(path, target):
            if '-stage-' in str(path) and Path(target) == self.output:
                raise KeyboardInterrupt('Interrupted staged publication')
            return real_rename(path, target)

        with patch.object(Path, 'rename', interrupt_publish):
            with self.assertRaises(KeyboardInterrupt):
                self.build("1 OBJE\n2 FILE portrait.txt\n1 OCCU Revised occupation\n")
        after = {path.relative_to(self.output): path.read_bytes()
                 for path in self.output.rglob('*') if path.is_file()}
        self.assertEqual(after, before)

    def test_interruption_after_moving_previous_package_still_rolls_back(self):
        self.build()
        before = (self.output / 'family.ged').read_bytes()
        real_rename = Path.rename
        interrupted = False

        def interrupt_after_backup(path, target):
            nonlocal interrupted
            result = real_rename(path, target)
            if path == self.output and not interrupted:
                interrupted = True
                raise KeyboardInterrupt('Interrupted immediately after backup move')
            return result

        with patch.object(Path, 'rename', interrupt_after_backup):
            with self.assertRaises(KeyboardInterrupt):
                self.build("1 OCCU Revised occupation\n")
        self.assertTrue((self.output / 'family.ged').is_file())
        self.assertEqual((self.output / 'family.ged').read_bytes(), before)

    def test_cancellation_after_new_package_rename_restores_previous_version(self):
        self.build()
        before = (self.output / 'family.ged').read_bytes()
        real_rename = Path.rename

        def interrupt_after_publish(path, target):
            result = real_rename(path, target)
            if '-stage-' in str(path) and Path(target) == self.output:
                raise SystemExit('Cancelled immediately after staged rename')
            return result

        with patch.object(Path, 'rename', interrupt_after_publish):
            with self.assertRaises(SystemExit):
                self.build("1 OCCU Revised occupation\n")
        self.assertEqual((self.output / 'family.ged').read_bytes(), before)

    def test_failed_rollback_retains_a_recoverable_original_outside_staging(self):
        self.build()
        before = (self.output / 'family.ged').read_bytes()
        real_rename = Path.rename

        def fail_publish_and_restore(path, target):
            if Path(target) == self.output:
                if '-stage-' in str(path):
                    raise KeyboardInterrupt('Interrupted staged publication')
                raise OSError('The previous package cannot currently be restored')
            return real_rename(path, target)

        with patch.object(Path, 'rename', fail_publish_and_restore):
            with self.assertRaisesRegex(RuntimeError, 'preserved at'):
                self.build("1 OCCU Revised occupation\n")
        recovered = list(self.output.parent.glob('.data-previous-*/bundle/family.ged'))
        self.assertEqual(len(recovered), 1)
        self.assertEqual(recovered[0].read_bytes(), before)

    def test_manuscript_validation_requires_existing_file_and_valid_hash(self):
        (self.root / "chapter.typ").write_text("A chapter")
        for path, digest in [("missing.typ", "0" * 64), ("chapter.typ", ""),
                             ("chapter.typ", "0" * 64)]:
            with self.subTest(path=path, digest=digest):
                chapter = ("0 @C1@ _CHAP\n1 TITL Chapter\n1 _SECTION section\n"
                           "2 _PERSON @I1@\n2 NOTE An adaptation\n"
                           f"2 _MANUSCRIPT {path}\n3 _HASH {digest}\n")
                with self.assertRaises(ValueError):
                    self.build(tail=chapter)
        self.assertFalse(self.output.exists())

    def test_scope_prunes_mixed_sections_and_their_source_media_dependencies(self):
        (self.root / "excluded.txt").write_text("Excluded branch image")
        head = "1 _ATLAS 1\n2 _ROOT @I1@\n2 _BOUNDARY @F1@\n"
        tail = ("0 @I2@ INDI\n1 NAME Outside /Person/\n1 FAMS @F1@\n"
                "0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I2@\n"
                "0 @C1@ _CHAP\n1 TITL Retained chapter\n"
                "1 _SECTION retained\n2 _PERSON @I1@\n2 NOTE Included account\n"
                "1 _SECTION mixed\n2 _PERSON @I1@\n2 _PERSON @I2@\n"
                "2 NOTE EXCLUDED PROSE\n2 SOUR @S1@\n2 OBJE @M1@\n"
                "0 @C2@ _CHAP\n1 TITL EXCLUDED CHAPTER\n1 _SECTION outside\n"
                "2 _PERSON @I2@\n2 NOTE EXCLUDED ACCOUNT\n"
                "0 @S1@ SOUR\n1 TITL EXCLUDED EVIDENCE\n1 OBJE @M1@\n"
                "0 @M1@ OBJE\n1 FILE excluded.txt\n")
        manifest = self.build("1 FAMS @F1@\n", tail=tail, head=head)
        result = (self.output / "family.ged").read_text()
        self.assertIn("Included account", result)
        self.assertNotIn("EXCLUDED", result)
        self.assertNotIn("0 @I2@", result)
        self.assertNotIn("0 @S1@", result)
        self.assertNotIn("0 @M1@", result)
        self.assertEqual(manifest["assets"], [])
        pointers = set(re.findall(r"^0 (@[^@]+@)", result, re.M))
        references = set(re.findall(r"^\d+ \S+ (@[^@]+@)$", result, re.M))
        self.assertEqual(references - pointers, set())

    def test_removed_research_note_does_not_leave_orphan_shared_content(self):
        self.build("1 NOTE @N1@\n", tail="0 @N1@ NOTE UNREVIEWED PRIVATE NOTE\n")
        self.assertNotIn("UNREVIEWED", (self.output / "family.ged").read_text())

    def test_unknown_source_pointer_fails_before_writing_a_package(self):
        with self.assertRaises(ValueError):
            self.build("1 BIRT\n2 SOUR @MISSING@\n")
        self.assertFalse(self.output.exists())

    def test_retained_chapter_preserves_transitive_evidence_and_asset_provenance(self):
        (self.root / "portrait.txt").write_text("image content")
        tail = ("0 @C1@ _CHAP\n1 TITL Chapter\n1 _SECTION section\n2 _PERSON @I1@\n"
                "2 NOTE A sourced passage\n3 CONT\n3 CONT Another paragraph\n2 SOUR @S1@\n"
                "0 @S1@ SOUR\n1 TITL Named source\n1 NOTE @N1@\n1 REPO @R1@\n"
                "0 @N1@ NOTE Source provenance\n1 OBJE @M1@\n"
                "0 @R1@ REPO\n1 NAME Original archive\n"
                "0 @M1@ OBJE\n1 FILE portrait.txt\n2 TITL Actual portrait\n"
                "1 _CREDIT Archive contributor\n1 _RIGHTS local-review-only\n")
        manifest = self.build(tail=tail)
        result = (self.output / "family.ged").read_text()
        for expected in ["0 @S1@ SOUR", "0 @N1@ NOTE", "0 @R1@ REPO", "0 @M1@ OBJE",
                         "1 _CREDIT Archive contributor", "1 _RIGHTS local-review-only",
                         "2 NOTE A sourced passage\n3 CONT\n3 CONT Another paragraph"]:
            self.assertIn(expected, result)
        self.assertEqual(manifest["assets"], ["portrait.txt"])
        self.assertEqual((self.output / "portrait.txt").read_text(), "image content")


class PublishedDataTests(FamilyFolder):
    """The site's files carry only what the site shows. A public (static)
    site also leaves out people the tree marks private, stops before it
    lists people who may be living, and serves saved web pages as text."""

    def build(self, extra="", tail="", head="", strict=False, previews=False, **options):
        self.source.write_text("0 HEAD\n1 CHAR UTF-8\n" + head +
                               "0 @I1@ INDI\n1 NAME Example /Person/\n" + extra + tail + "0 TRLR\n")
        return self.module.package(Tree(self.source), self.output, strict_assets=strict,
                                   previews=previews, **options)

    def published(self):
        return (self.output / "family.ged").read_text()

    def test_the_header_keeps_only_what_the_site_reads(self):
        head = ("1 SOUR RootsMagic\n2 VERS 9.1\n1 DEST GEDCOM 5.5.1\n1 DATE 12 MAR 2025\n"
                "1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 SUBM @SUBM1@\n1 SUBN @SUBN1@\n"
                "1 FILE C:\\Users\\jsmith\\Documents\\Smith tree.ged\n1 COPR Copyright 2025 Jane Smith\n"
                "1 NOTE Exported for my cousin.\n1 _ATLAS\n2 TITL The Example family\n2 _ROOT @I1@\n")
        tail = ("0 @SUBM1@ SUBM\n1 NAME Jane Smith\n1 ADDR 12 Elm Street\n1 PHON 555-0100\n"
                "1 EMAIL jane.smith@example.com\n0 @SUBN1@ SUBN\n1 SUBM @SUBM1@\n")
        self.build("1 SUBM @SUBM1@\n1 RESI\n2 PLAC Springfield\n2 ADDR 9 Oak Lane\n2 PHON 555-0199\n"
                   "2 EMAIL ann@example.com\n", tail=tail, head=head)
        published = self.published()
        self.assertIn("1 RESI\n2 PLAC Springfield\n", published)
        header = published.split("\n0 ", 1)[0]
        self.assertEqual(header, "0 HEAD\n1 CHAR UTF-8\n1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n"
                                 "1 _ATLAS\n2 TITL The Example family\n2 _ROOT @I1@")
        for private in ["jsmith", "Jane Smith", "Elm Street", "555-0100", "jane.smith@example.com",
                        "SUBM", "SUBN", "RootsMagic", "my cousin", "Oak Lane", "555-0199", "ann@example.com"]:
            self.assertNotIn(private, published)

    def test_the_sites_tree_says_utf8_whatever_the_export_said(self):
        # PAF wrote "1 CHAR ANSEL" over plain ASCII; the site's reader refuses ANSEL.
        self.source.write_text("0 HEAD\n1 CHAR ANSEL\n1 _ATLAS\n2 TITL The Example family\n"
                               "2 _ROOT @I1@\n0 @I1@ INDI\n1 NAME Mary/Windsor/\n0 TRLR\n")
        self.module.package(Tree(self.source), self.output)
        published = self.published()
        self.assertIn("\n1 CHAR UTF-8\n", published)
        self.assertNotIn("ANSEL", published)

    def test_notes_the_site_never_shows_stay_out(self):
        tail = ("0 @F1@ FAM\n1 HUSB @I1@\n1 NOTE Private family note.\n"
                "1 NOTE The town book lists their children.\n2 SOUR @S1@\n3 PAGE p. 4\n"
                "1 MARR\n2 DATE 1900\n2 NOTE A note on the marriage.\n2 NOTE @N2@\n"
                "0 @S1@ SOUR\n1 TITL Town book\n1 NOTE About the town book.\n"
                "0 @N1@ NOTE Shared private research.\n1 CONT More private lines.\n"
                "0 @N2@ NOTE Shared event note.\n1 SOUR @S1@\n"
                "0 @N3@ NOTE A credit everyone sees.\n"
                "0 @M1@ OBJE\n1 FILE portrait.txt\n1 NOTE @N3@\n")
        (self.root / "portrait.txt").write_text("portrait")
        self.build("1 FAMS @F1@\n1 NOTE Private person note.\n1 NOTE @N1@\n"
                   "1 BIRT\n2 DATE 1880\n2 NOTE Born at home.\n2 NOTE @N1@\n"
                   "2 SOUR @S1@\n3 NOTE A citation qualification.\n"
                   "1 NOTE [Source] An older-style citation\n1 OBJE @M1@\n", tail=tail)
        published = self.published()
        for hidden in ["Private family note.", "Private person note.", "Shared private research.",
                       "More private lines.", "The town book lists their children.", "Shared event note."]:
            self.assertNotIn(hidden, published)
        for shown in ["2 NOTE Born at home.", "2 NOTE A note on the marriage.", "3 NOTE A citation qualification.",
                      "1 NOTE About the town book.", "1 NOTE [Source] An older-style citation",
                      "0 @N3@ NOTE A credit everyone sees."]:
            self.assertIn(shown, published)
        # A note the site does not show keeps the citation it carries.
        self.assertIn("0 @F1@ FAM\n1 HUSB @I1@\n1 NOTE\n2 SOUR @S1@\n3 PAGE p. 4\n", published)
        self.assertIn("0 @N2@ NOTE\n1 SOUR @S1@\n", published)
        self.assertNotIn("@N1@", published)

    def test_build_notes_stay_out_of_the_published_manifest(self):
        manuscript = self.root / "chapter.typ"
        manuscript.write_text("Prose")
        digest = hashlib.sha256(manuscript.read_bytes()).hexdigest()
        tail = ("0 @I2@ INDI\n1 NAME Outside /Person/\n"
                "0 @C1@ _CHAP\n1 TITL Chapter\n1 _MANUSCRIPT chapter.typ\n2 _HASH " + digest + "\n"
                "1 _SECTION kept\n2 _PERSON @I1@\n2 NOTE Kept prose\n"
                "1 _SECTION mixed\n2 _PERSON @I2@\n2 NOTE An opening about someone outside\n")
        report = self.root / "build/site-data-report.json"
        result = self.build("1 OBJE\n2 FILE images/review/capture.jpg\n", tail=tail,
                            head="1 _ATLAS\n2 _ROOT @I1@\n", strict=True, report=report)
        text = (self.output / "manifest.json").read_text()
        manifest = json.loads(text)
        self.assertEqual(set(manifest), {"people", "families", "sourceSha256", "assets", "missingAssets"})
        for note in ["local-review-only", "chapter.typ", "capture.jpg", "someone outside", str(self.base)]:
            self.assertNotIn(note, text)
        for note in ["capture.jpg", "someone outside", str(self.base)]:
            self.assertNotIn(note, self.published())
        notes = json.loads(report.read_text())
        self.assertEqual(notes["manuscripts"], {"chapter.typ": digest})
        self.assertEqual(notes["skippedFiles"], {"images/review/capture.jpg":
                                                 'in the research folder "review" (site.research_folders)'})
        self.assertEqual(result["filteredSections"], ["mixed"])
        # A package from before this change is still replaced.
        manifest["audience"] = "local-review-only"
        (self.output / "manifest.json").write_text(json.dumps(manifest))
        self.build()

    def test_every_skipped_file_has_a_reason(self):
        (self.root / "images/review").mkdir(parents=True)
        (self.root / "images/review/kept.jpg").write_bytes(b"photo")
        for name in ["photo.jpg", "notes.docx", "index.json", ".hidden.jpg"]:
            (self.root / "images" / name).write_bytes(b"file")
        paths = ["C:\\Users\\Someone\\Pictures\\William.jpg", "/Users/someone/Pictures/Ann.jpg",
                 "photos/outside.jpg", "images/notes.docx", "images/index.json", "images/.hidden.jpg",
                 "images/review/kept.jpg", "images/photo.jpg"]
        result = self.build("".join(f"1 OBJE\n2 FILE {path}\n" for path in paths), strict=True)
        self.assertEqual(result["assets"], ["images/photo.jpg"])
        reasons = result["skippedFiles"]
        self.assertEqual(set(reasons), set(paths) - {"images/photo.jpg"})
        self.assertIn('research folder "review"', reasons["images/review/kept.jpg"])
        self.assertIn("Windows", reasons["C:\\Users\\Someone\\Pictures\\William.jpg"])
        self.assertIn("one computer", reasons["/Users/someone/Pictures/Ann.jpg"])
        self.assertEqual(reasons["photos/outside.jpg"], "not inside images/")
        self.assertIn(".docx", reasons["images/notes.docx"])
        self.assertIn("_KIND", reasons["images/index.json"])
        self.assertEqual(reasons["images/.hidden.jpg"], "a hidden file or folder")

    def test_a_build_works_where_it_is_told_and_leaves_nothing_beside_the_site(self):
        # The site copies website/public whole, so the build stages elsewhere.
        work = self.base / "work"
        self.build("1 BIRT\n2 DATE 1850\n", staging=work)
        self.build("1 BIRT\n2 DATE 1851\n", staging=work)  # and replaces it
        self.assertEqual(sorted(p.name for p in self.output.parent.iterdir()), ["data"])
        self.assertEqual(list(work.iterdir()), [])
        self.assertIn("2 DATE 1851", self.published())

    def test_the_builds_working_folders_stay_out_of_git(self):
        # The build stages a family's data, and keeps its previous copy, beside
        # website/public/data. A commit made with "git add -A" during a build
        # must never take them.
        import subprocess
        website = SCRIPTS.parent / "website"
        if subprocess.run(["git", "-C", str(website), "rev-parse"], capture_output=True).returncode:
            self.skipTest("not a git checkout")
        for name in (".data-stage-x1/family.ged", ".data-previous-x1/family.ged"):
            with self.subTest(name=name):
                result = subprocess.run(["git", "-C", str(website), "check-ignore", "-q",
                                         f"public/{name}"])
                self.assertEqual(result.returncode, 0, f"public/{name} is not ignored")

    def test_music_in_every_album_format_publishes(self):
        # docs/family-folder.md promises these for albums.json.
        for name in ("a.mp3", "a.m4a", "a.aac", "a.ogg", "a.opus", "a.wav", "a.flac", "a.aiff"):
            with self.subTest(name=name):
                self.assertIsNone(self.module.skip_reason(f"images/albums/{name}"))

    def test_research_folders_are_the_familys_own_choice(self):
        (self.root / "images/review").mkdir(parents=True)
        (self.root / "images/review/kept.jpg").write_bytes(b"photo")
        # Without the setting, the folders earlier versions left out stay out.
        self.settings({})
        for folder in ("review", "captures", "correlation", "independent-reading", "working"):
            (self.root / "images" / folder).mkdir(parents=True, exist_ok=True)
            (self.root / "images" / folder / "kept.jpg").write_bytes(b"photo")
            result = self.build(f"1 OBJE\n2 FILE images/{folder}/kept.jpg\n", strict=True)
            self.assertEqual(result["assets"], [], folder)
        self.settings({"site": {"research_folders": []}})  # a family that names none
        result = self.build("1 OBJE\n2 FILE images/review/kept.jpg\n", strict=True)
        self.assertEqual(result["assets"], ["images/review/kept.jpg"])
        self.settings({"site": {"research_folders": ["review"]}})
        result = self.build("1 OBJE\n2 FILE images/review/kept.jpg\n", strict=True)
        self.assertEqual(result["assets"], [])

    def test_a_link_to_someone_outside_the_family_is_dropped(self):
        tail = "0 @I9@ INDI\n1 NAME Gwen /Godmother/\n"
        self.build("1 ASSO @I9@\n2 RELA Godmother\n1 ALIA @I9@\n", tail=tail,
                   head="1 _ATLAS\n2 _ROOT @I1@\n")
        published = self.published()
        self.assertNotIn("@I9@", published)
        self.assertNotIn("Godmother", published)

    FAMILY = ("0 @I2@ INDI\n1 NAME Ann /Person/\n1 REFN ann\n2 TYPE jsonid\n1 BIRT\n2 DATE 1990\n1 FAMC @F1@\n"
              "0 @I3@ INDI\n1 NAME Old /Person/\n1 REFN old\n2 TYPE jsonid\n1 BIRT\n2 DATE 1850\n1 FAMS @F1@\n"
              "0 @F1@ FAM\n1 HUSB @I3@\n1 CHIL @I1@\n1 CHIL @I2@\n")

    def test_a_public_site_stops_before_it_lists_people_who_may_be_living(self):
        head = "1 _ATLAS\n2 _ROOT @I1@\n"
        with self.assertRaises(self.module.Stop) as stop:
            self.build("1 BIRT\n2 DATE 1880\n1 FAMC @F1@\n", tail=self.FAMILY, head=head, public=True)
        self.assertIn("1 person who may be living:\n  Ann Person (ann)", str(stop.exception))
        self.assertIn('"publish_living_people": true', str(stop.exception))
        self.assertIn("1 RESN privacy", str(stop.exception))
        self.assertFalse(self.output.exists())
        # On the dev server, on this computer only, they draw a warning.
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            self.build("1 BIRT\n2 DATE 1880\n1 FAMC @F1@\n", tail=self.FAMILY, head=head, public=True,
                       local=True)
        self.assertIn("1 person who may be living", stderr.getvalue())
        # The family may choose to publish them, or build a private site.
        self.build("1 BIRT\n2 DATE 1880\n1 FAMC @F1@\n", tail=self.FAMILY, head=head, public=True,
                   living_people=True)
        self.assertIn("Ann /Person/", self.published())
        self.build("1 BIRT\n2 DATE 1880\n1 FAMC @F1@\n", tail=self.FAMILY, head=head)
        self.assertIn("Ann /Person/", self.published())

    def test_a_person_marked_private_stays_off_a_public_site(self):
        head = "1 _ATLAS\n2 _ROOT @I1@\n"
        tail = self.FAMILY.replace("1 BIRT\n2 DATE 1990\n", "1 BIRT\n2 DATE 1990\n1 RESN privacy\n")
        tail += "0 @S9@ SOUR\n1 TITL A private letter\n1 RESN privacy\n"
        result = self.build("1 BIRT\n2 DATE 1880\n2 RESN confidential\n1 DEAT\n2 DATE 1950\n"
                            "2 SOUR @S9@\n1 FAMC @F1@\n1 ASSO @I2@\n", tail=tail, head=head, public=True)
        published = self.published()
        self.assertNotIn("private letter", published)
        self.assertNotIn("@I2@", published)
        self.assertNotIn("Ann", published)
        self.assertNotIn("1880", published)  # a fact marked private
        self.assertIn("1 DEAT\n2 DATE 1950", published)
        self.assertIn("0 @F1@ FAM\n1 HUSB @I3@\n1 CHIL @I1@\n", published)
        # A couple's marriage goes with a spouse marked private.
        tail = tail.replace("0 @I3@ INDI\n", "0 @I3@ INDI\n1 RESN privacy\n").replace(
            "1 CHIL @I2@\n", "1 CHIL @I2@\n1 MARR\n2 DATE 12 JUN 1878\n2 PLAC Kept Chapel\n")
        self.build("1 BIRT\n2 DATE 1880\n1 DEAT\n2 DATE 1950\n1 FAMC @F1@\n", tail=tail, head=head,
                   public=True)
        self.assertNotIn("Kept Chapel", self.published())
        self.assertNotIn("1878", self.published())
        self.assertEqual(result["people"], 2)
        self.assertEqual(result["privatePeople"], ["ann"])
        # The root person cannot be left out.
        with self.assertRaisesRegex(self.module.Stop, "root person private"):
            self.build("1 RESN locked\n1 BIRT\n2 DATE 1880\n", head=head, public=True)

    def test_a_public_site_checks_the_people_its_book_names(self):
        # The book prints every ancestor and their children, wherever the
        # site's own edition stops.
        receipt = self.root / "book-publication.json"
        receipt.write_text(json.dumps({"rootRefn": "example"}))
        head = "1 _ATLAS\n2 _ROOT @I1@\n2 _BOUNDARY @F1@\n"
        tail = self.FAMILY.replace("1 BIRT\n2 DATE 1990\n", "1 BIRT\n2 DATE 1990\n1 RESN privacy\n")
        person = "1 REFN example\n2 TYPE jsonid\n1 BIRT\n2 DATE 1880\n1 DEAT\n1 FAMC @F1@\n"
        with self.assertRaisesRegex(self.module.Stop, "The book names 1 person the tree marks private"):
            self.build(person, tail=tail, head=head, public=True, book_receipt=receipt)
        with self.assertRaisesRegex(self.module.Stop, "may be living:\n  Ann Person"):
            self.build(person, tail=self.FAMILY, head=head, public=True, book_receipt=receipt)
        # A fact, a family or a source the book prints, marked private.
        dead = person.replace("1 DEAT\n", "1 DEAT\n2 DATE 1950\n")
        family = self.FAMILY.replace("1 BIRT\n2 DATE 1990\n", "1 BIRT\n2 DATE 1890\n")
        for extra, tail in (
                (dead.replace("2 DATE 1880\n", "2 DATE 1880\n2 PLAC Kept Hall\n3 RESN confidential\n"), family),
                (dead + "1 SOUR @S9@\n", family + "0 @S9@ SOUR\n1 TITL A letter\n1 RESN privacy\n"),
                (dead + "1 NOTE @N9@\n", family + "0 @N9@ NOTE A secret\n1 RESN locked\n"),
                (dead, family.replace("0 @F1@ FAM\n", "0 @F1@ FAM\n1 RESN privacy\n"))):
            with self.subTest(extra=extra, tail=tail[-60:]):
                with self.assertRaisesRegex(self.module.Stop, "The book prints facts, families or "
                                            "sources the tree marks private \\(RESN\\) for 1 person"):
                    self.build(extra, tail=tail, head=head, public=True, book_receipt=receipt)
        # Without the marks, the privacy checks pass and the build goes on to
        # read the book's receipt.
        with self.assertRaisesRegex(ValueError, "Build the book first"):
            self.build(dead, tail=family, head=head, public=True, book_receipt=receipt)

    def test_possibly_living_follows_dates_deaths_and_close_relatives(self):
        ged = ("0 HEAD\n0 @A@ INDI\n1 NAME Born /Recent/\n1 BIRT\n2 DATE 1990\n1 FAMS @F@\n"
               "0 @B@ INDI\n1 NAME Died /Recent/\n1 BIRT\n2 DATE 1960\n1 DEAT Y\n"
               "0 @J@ INDI\n1 NAME Buried /Recent/\n1 BIRT\n2 DATE 1961\n1 BURI\n2 PLAC Old churchyard\n"
               "0 @K@ INDI\n1 NAME Noted /Burial/\n1 BIRT\n2 DATE 1962\n1 BURI\n2 NOTE Not yet found.\n"
               "0 @L@ INDI\n1 NAME Ranged /Birth/\n1 BIRT\n2 DATE BET 1900 AND 1980\n"
               "0 @M@ INDI\n1 NAME Two /Births/\n1 BIRT\n2 DATE 1890\n1 BIRT\n2 DATE 1935\n"
               "0 @C@ INDI\n1 NAME Long /Ago/\n1 BIRT\n2 DATE 1890\n"
               "0 @D@ INDI\n1 NAME Undated /Child/\n1 FAMC @F@\n"
               "0 @E@ INDI\n1 NAME Edited /Lately/\n1 CHAN\n2 DATE 12 MAR 2025\n1 FAMC @OLD@\n"
               "0 @N@ INDI\n1 NAME Nothing /Known/\n"
               "0 @G@ INDI\n1 NAME Married /Lately/\n1 FAMS @H@\n"
               "0 @F@ FAM\n1 HUSB @A@\n1 CHIL @D@\n"
               "0 @H@ FAM\n1 HUSB @G@\n1 MARR\n2 DATE 1985\n"
               "0 @OLD@ FAM\n1 HUSB @C@\n1 CHIL @E@\n0 TRLR\n")
        self.source.write_text(ged)
        living = self.module.possibly_living(Tree(self.source), this_year=2026)
        # E's record was edited in 2025, but E is the child of C (1890), so about
        # 1920. N has no date and no relative to go on, so may be living.
        self.assertEqual(living, {"@A@", "@D@", "@G@", "@K@", "@L@", "@M@", "@N@"})

    def test_open_dates_and_empty_deaths_prove_nothing(self):
        ged = ("0 HEAD\n0 @P@ INDI\n1 NAME Born /After/\n1 BIRT\n2 DATE AFT 1700\n"
               "0 @Q@ INDI\n1 NAME Empty /Death/\n1 BIRT\n2 DATE 1960\n1 DEAT\n2 DATE \n"
               "0 @R@ INDI\n1 NAME Long /Dead/\n1 BIRT\n2 DATE AFT 1700\n1 DEAT\n2 DATE 1790\n0 TRLR\n")
        self.source.write_text(ged)
        self.assertEqual(self.module.possibly_living(Tree(self.source), this_year=2026), {"@P@", "@Q@"})

    def test_the_order_of_people_never_changes_who_may_be_living(self):
        # U has no date. A parent (1850) puts U about 1880; through a child
        # and grandchild (1990), U would be about 1930. The nearest wins.
        people = {
            "U": "0 @U@ INDI\n1 NAME Undated /Middle/\n1 FAMC @F1@\n1 FAMS @F2@\n",
            "P": "0 @P@ INDI\n1 NAME Dated /Parent/\n1 BIRT\n2 DATE 1850\n1 DEAT Y\n1 FAMS @F1@\n",
            "C": "0 @C@ INDI\n1 NAME Undated /Child/\n1 FAMC @F2@\n1 FAMS @F3@\n1 DEAT Y\n",
            "D": "0 @D@ INDI\n1 NAME Dated /Grandchild/\n1 BIRT\n2 DATE 1990\n1 FAMC @F3@\n",
        }
        families = ("0 @F1@ FAM\n1 HUSB @P@\n1 CHIL @U@\n0 @F2@ FAM\n1 HUSB @U@\n1 CHIL @C@\n"
                    "0 @F3@ FAM\n1 HUSB @C@\n1 CHIL @D@\n")
        results = []
        for order in ("UPCD", "CDUP", "DCPU"):
            self.source.write_text("0 HEAD\n" + "".join(people[k] for k in order) + families + "0 TRLR\n")
            results.append(self.module.possibly_living(Tree(self.source), this_year=2026))
        self.assertEqual(results[0], {"@D@"})
        self.assertTrue(all(r == results[0] for r in results))

    def test_a_public_site_serves_saved_web_pages_as_text(self):
        (self.root / "images/pages").mkdir(parents=True)
        page = b"<html><body><p>Obituary</p><script>alert('ran')</script></body></html>"
        (self.root / "images/pages/obituary.html").write_bytes(page)
        sha = hashlib.sha256(page).hexdigest()
        tail = ("0 @S1@ SOUR\n1 TITL Saved obituary\n"
                f"1 _ARCHIVE images/pages/obituary.html\n2 _KIND web-page\n2 _SHA256 {sha}\n")
        result = self.build("1 BIRT\n2 DATE 1850\n1 SOUR @S1@\n", tail=tail, strict=True, public=True)
        self.assertEqual(result["assets"], ["images/pages/obituary.html.txt"])
        self.assertFalse((self.output / "images/pages/obituary.html").exists())
        self.assertEqual((self.output / "images/pages/obituary.html.txt").read_bytes(), page)
        self.assertIn("1 _ARCHIVE images/pages/obituary.html.txt\n2 _KIND web-page", self.published())
        self.assertNotIn("obituary.html\n", self.published())
        # The Worker serves originals as attachments, so its files keep their names.
        result = self.build("1 SOUR @S1@\n", tail=tail, strict=True)
        self.assertEqual(result["assets"], ["images/pages/obituary.html"])
        # XML can hold a page with scripts of its own, so it goes as text too.
        aid = b'<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></html>'
        (self.root / "images/pages/aid.xml").write_bytes(aid)
        tail = ("0 @S1@ SOUR\n1 TITL Finding aid\n1 _ARCHIVE images/pages/aid.xml\n2 _KIND finding-aid\n"
                f"2 _SHA256 {hashlib.sha256(aid).hexdigest()}\n")
        result = self.build("1 BIRT\n2 DATE 1850\n1 SOUR @S1@\n", tail=tail, strict=True, public=True)
        self.assertEqual(result["assets"], ["images/pages/aid.xml.txt"])


class PlainStopTests(unittest.TestCase):
    def test_a_changed_story_stops_the_build_with_one_line_naming_the_fix(self):
        import subprocess
        with tempfile.TemporaryDirectory() as tmp:
            family = Path(tmp)
            (family / "flyleaf.json").write_text(json.dumps({"paths": {"source_gedcom": "tree.ged", "generated_gedcom": "out.ged", "book": "book"}}))
            (family / "chapter.typ").write_text("Changed prose")
            (family / "tree.ged").write_text(
                "0 HEAD\n1 _ATLAS\n2 _ROOT @I1@\n0 @I1@ INDI\n1 NAME A /Person/\n"
                "0 @C1@ _CHAP\n1 TITL Chapter\n1 _SECTION s\n2 _PERSON @I1@\n2 NOTE An adaptation\n"
                "2 _MANUSCRIPT chapter.typ\n3 _HASH " + "0" * 64 + "\n0 TRLR\n")
            run = subprocess.run([sys.executable, str(MODULE), "--source", str(family / "tree.ged"),
                                  "--output", str(family / "out")], cwd=family, capture_output=True,
                                 text=True, env={**os.environ, "FLYLEAF_FAMILY": str(family)})
            self.assertEqual(run.returncode, 1, run.stderr)
            self.assertNotIn("Traceback", run.stderr)
            self.assertEqual([line for line in run.stderr.splitlines() if line.strip()],
                             ["The site build stopped. Stale manuscript adaptation: chapter.typ changed "
                              "after the site's version of it was checked. Check that chapter, then run: "
                              "flyleaf repin"])


class RealPackageTests(unittest.TestCase):
    def test_current_document_package_is_self_contained(self):
        spec = importlib.util.spec_from_file_location("real_package", MODULE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "edition"
            manifest = module.package(current_edition(Path(tmp) / 'current.ged'), output)
            result = (output / "family.ged").read_text()
            pointers = re.findall(r"^0 (@[^@]+@)", result, re.M)
            references = set(re.findall(r"^\d+ \S+ (@[^@]+@)$", result, re.M))
            self.assertEqual(len(pointers), len(set(pointers)))
            self.assertEqual(references - set(pointers), set())
            self.assertEqual(manifest["missingAssets"], [])
            self.assertTrue(all((output / path).is_file() for path in manifest["assets"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
