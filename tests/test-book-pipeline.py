#!/usr/bin/env python3
"""Regression tests for the book pipeline.

Each test guards a kind of mistake, not one case of it. Run `flyleaf test`
before committing pipeline changes.

Run: .venv/bin/python3 tests/test-book-pipeline.py
"""
import importlib.util
import contextlib
import copy
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from collections import Counter
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent / 'scripts'
sys.path.insert(0, str(HERE))
import booklib  # noqa: E402

# The book template as the Typst compiler (root: the family folder) sees it.
FAMILY_IMPORT = f'#import "{booklib.TEMPLATE_IMPORT}"'
# Layout fixtures use a copy of the template set in Flyleaf's bundled open
# fonts, so their pages break the same way whichever fonts a family chooses.
FIXTURE_TEMPLATES = booklib.STAGED_TEMPLATES.parent / 'flyleaf-fixtures'
FIXTURE_TEMPLATE_IMPORT = '/build/flyleaf-fixtures/template.typ'
IMPORT = f'#import "{FIXTURE_TEMPLATE_IMPORT}"'
import bookcharts  # noqa: E402
import bookbib  # noqa: E402


def load(fname, mod):
    spec = importlib.util.spec_from_file_location(mod, HERE / fname)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


coverage_mod = load("book-coverage.py", "bc_test")
validate_mod = load("validate-gedcom.py", "vg_test")
assemble_mod = load("book-assemble.py", "ba_test")
enrich_mod = load("enrich-gedcom.py", "eg_test")
claims_mod = load("extract-claims.py", "claims_test")
footnotes_mod = load("check-footnotes.py", "footnotes_test")
register_sources_mod = load("check-register-sources.py", "register_sources_test")
charts_check_mod = load("check-charts.py", "charts_check_test")
bibliography_mod = load("check-bibliography.py", "bibliography_test")
place_readings_mod = load("validate-website-place-readings.py", "place_readings_test")


# ---------- fixtures ----------

class TestBuildLock(unittest.TestCase):
    """A killed build's lock is reclaimed; a live build's lock still blocks."""

    def setUp(self):
        self.bb = load('build-book.py', 'build_book_lock_t')
        self.tmp = Path(tempfile.mkdtemp())
        self.lock = self.tmp / '.book-publication-lock'

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_reclaims_lock_of_dead_build(self):
        dead = subprocess.Popen([sys.executable, '-c', 'pass'])
        dead.wait()
        self.lock.mkdir()
        (self.lock / 'pid').write_text(str(dead.pid))
        self.bb.acquire_lock(self.lock)
        self.assertEqual((self.lock / 'pid').read_text(), str(os.getpid()))

    def test_live_build_still_blocks(self):
        self.lock.mkdir()
        (self.lock / 'pid').write_text(str(os.getpid()))
        with self.assertRaises(FileExistsError):
            self.bb.acquire_lock(self.lock)

    def test_fresh_ownerless_lock_blocks_but_old_one_is_reclaimed(self):
        self.lock.mkdir()
        with self.assertRaises(FileExistsError):
            self.bb.acquire_lock(self.lock)
        self.bb.acquire_lock(self.lock, stale_after=0)
        self.assertTrue((self.lock / 'pid').exists())


class TestBuildClock(unittest.TestCase):
    """SOURCE_DATE_EPOCH pins every date a build writes into its outputs."""

    def test_pinned_epoch_sets_edition_date_and_timestamp(self):
        import build_clock
        from datetime import datetime
        with patch.dict(os.environ, {'SOURCE_DATE_EPOCH': '1792202120'}):
            self.assertEqual(build_clock.epoch(), 1792202120)
            self.assertEqual(build_clock.today(), datetime.fromtimestamp(1792202120).date())
            self.assertEqual(int(build_clock.now_utc().timestamp()), 1792202120)

    def test_unpinned_build_uses_today(self):
        import build_clock
        from datetime import date
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop('SOURCE_DATE_EPOCH', None)
            self.assertIsNone(build_clock.epoch())
            self.assertEqual(build_clock.today(), date.today())

    def test_output_writers_read_the_shared_clock(self):
        # A direct date.today() in these files would make a pinned rebuild drift.
        for name in ('book-assemble.py', 'enrich-gedcom.py'):
            text = (HERE / name).read_text()
            self.assertNotIn('date.today()', text, name)
            self.assertIn('build_clock.today()', text, name)


class TestBookFonts(unittest.TestCase):
    """Typefaces and the Typst version come from flyleaf.json, with open defaults."""

    def test_without_settings_the_book_uses_the_bundled_open_fonts(self):
        with patch.object(booklib.flyleaf_settings, 'get', return_value=None):
            fonts = booklib.font_settings()
            module = booklib.font_module()
        self.assertEqual(fonts['serif'], ['Libertinus Serif'])
        self.assertEqual(fonts['sans'], ['Libertinus Sans'])
        self.assertTrue(fonts['files'])
        for path in fonts['files']:
            self.assertTrue(path.is_file(), path)
            self.assertTrue(path.is_relative_to(booklib.TEMPLATES / 'fonts'), path)
        self.assertIn('#let serif = ("Libertinus Serif",)', module)
        self.assertIn('#let sans = ("Libertinus Sans",)', module)

    def test_family_fonts_and_files_come_from_settings(self):
        chosen = {'serif': ['Family Serif', 'Fallback'], 'sans': ['Family Sans'],
                  'files': ['fonts/family.otf', '/abs/family-sans.ttf']}
        with patch.object(booklib.flyleaf_settings, 'get', return_value=chosen):
            fonts = booklib.font_settings()
            module = booklib.font_module()
        self.assertEqual(fonts['files'], [booklib.ROOT / 'fonts/family.otf',
                                          Path('/abs/family-sans.ttf')])
        self.assertIn('#let serif = ("Family Serif", "Fallback",)', module)

    def test_template_takes_its_typefaces_from_the_generated_module(self):
        template = (booklib.TEMPLATES / 'template.typ').read_text()
        self.assertIn('#import "fonts.typ": serif, sans', template)
        self.assertNotIn('Iowan Old Style', template)

    def test_default_charts_use_the_bundled_serif(self):
        with patch.object(booklib.flyleaf_settings, 'get', return_value=None):
            fonts = booklib.font_settings()
        self.assertEqual(fonts['chart_file'].name, 'LibertinusSerif-Regular.otf')
        self.assertTrue(fonts['chart_file'].is_file())

    def test_chart_manifest_names_files_without_the_home_folder(self):
        import bookcharts
        from types import SimpleNamespace
        # A book plan of its own, so the family's plan is not read with a stand-in tree.
        digest = bookcharts.inputs_digest(SimpleNamespace(src_path=booklib.SRC_GED), {'chapters': []})
        for name in digest:
            self.assertFalse(name.startswith(str(Path.home())), name)
        self.assertIn('scripts/bookcharts.py', digest)

    def test_templates_are_staged_inside_the_family_folder(self):
        staged = booklib.stage_templates()
        self.assertTrue(staged.is_relative_to(booklib.ROOT))
        for name in ('template.typ', 'web-template.typ'):
            self.assertEqual((staged / name).read_bytes(), (booklib.TEMPLATES / name).read_bytes())
        self.assertEqual(booklib.FONTS_TYP.read_text(), booklib.font_module())
        self.assertEqual(booklib.TEMPLATE_IMPORT, '/build/flyleaf/template.typ')

    def test_typst_version_must_match_the_setting(self):
        with patch.object(booklib.flyleaf_settings, 'get', return_value='0.14.2'):
            booklib.check_typst_version('typst 0.14.2 (b33de9de)')
            for wrong in ('typst 0.13.1 (8ace67d9)', 'typst', ''):
                with self.assertRaises(SystemExit):
                    booklib.check_typst_version(wrong)
        with patch.object(booklib.flyleaf_settings, 'get', return_value=None):
            booklib.check_typst_version('typst 0.13.1 (8ace67d9)')


class TestStableFileNames(unittest.TestCase):
    """Build records name files the same way whichever folder holds the other."""

    def names(self, engine, family):
        import flyleaf_settings
        with patch.object(flyleaf_settings, 'ENGINE', engine), \
                patch.object(flyleaf_settings, 'family_root', return_value=family):
            names = (flyleaf_settings.logical(engine / 'scripts/x.py'),
                     flyleaf_settings.logical(family / 'build/book.typ'))
            for path in (engine / 'scripts/x.py', family / 'build/book.typ'):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()
            found = tuple(flyleaf_settings.locate(n) for n in names)
        return names, found

    def check(self, engine, family):
        names, found = self.names(engine, family)
        self.assertEqual(names, ('scripts/x.py', 'build/book.typ'))
        self.assertEqual(found, (engine / 'scripts/x.py', family / 'build/book.typ'))

    def test_every_layout(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            self.check(root / 'a/flyleaf', root / 'a')      # Flyleaf inside the family
            self.check(root / 'b', root / 'b/sample')       # the family inside Flyleaf
            self.check(root / 'c/flyleaf', root / 'c/family')  # side by side


class TestContentDefaults(unittest.TestCase):
    """A family may leave out any site content file; Flyleaf has an empty one."""

    def test_missing_family_file_falls_back_to_the_default(self):
        import flyleaf_settings
        with tempfile.TemporaryDirectory() as tmp, \
                patch.object(flyleaf_settings, 'path', return_value=Path(tmp)):
            self.assertEqual(flyleaf_settings.content_file('geography.json'),
                             flyleaf_settings.CONTENT_DEFAULTS / 'geography.json')
            (Path(tmp) / 'geography.json').write_text('{}')
            self.assertEqual(flyleaf_settings.content_file('geography.json'),
                             Path(tmp) / 'geography.json')


class TestRegionRule(unittest.TestCase):
    """'at' before a region is a style warning only for the regions a family names."""

    def load_with(self, regions):
        real = booklib.flyleaf_settings.get
        with patch.object(booklib.flyleaf_settings, 'get', side_effect=lambda key, default=None:
                          regions if key == 'places.region_names' else real(key, default)):
            return load('book-coverage.py', 'bc_regions_' + str(len(regions)))

    def rule(self, module):
        return next(rx for code, rx, *_ in module.PROSE_RULES if code == 'L12')

    def test_no_regions_means_no_warnings(self):
        rule = self.rule(self.load_with([]))
        for text in ('at Mineral Point', 'at home', 'at the time'):
            self.assertIsNone(rule.search(text), text)

    def test_named_regions_are_still_checked(self):
        rule = self.rule(self.load_with(['Cornwall']))
        self.assertTrue(rule.search('born at Cornwall'))
        self.assertIsNone(rule.search('born at Penzance'))


class TestEveryTestFileRuns(unittest.TestCase):
    """A test file that make test never runs goes stale without anyone noticing."""

    def test_make_test_runs_every_test_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            # A stand-in Python records each test file make test runs; it
            # passes everything else (make's own settings lookup) to Python.
            log = Path(tmp) / "ran.txt"
            stand_in = Path(tmp) / "python"
            stand_in.write_text(f"""#!/bin/sh
case "$1" in *tests/test-*.py) echo "$1" >> {log}; exit 0;; esac
exec {sys.executable} "$@"
""")
            stand_in.chmod(0o755)
            result = subprocess.run(["make", "--no-print-directory", "-C", str(HERE.parent), "test",
                                     f"PYTHON={stand_in}", f"FLYLEAF_FAMILY={booklib.ROOT}"],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            ran = [Path(line).name for line in log.read_text().splitlines()]
        present = sorted(p.name for p in (HERE.parent / 'tests').glob('test-*.py'))
        self.assertEqual(ran, present)

    def test_make_test_works_from_a_folder_with_spaces(self):
        with tempfile.TemporaryDirectory() as tmp:
            engine = Path(tmp) / "my flyleaf"
            (engine / "tests").mkdir(parents=True)
            shutil.copy(HERE.parent / "Makefile", engine / "Makefile")
            shutil.copytree(HERE, engine / "scripts", ignore=shutil.ignore_patterns("__pycache__"))
            for name in ("test-a.py", "test-b.py"):
                (engine / "tests" / name).write_text("")
            log = Path(tmp) / "ran.txt"
            stand_in = Path(tmp) / "a python" / "python"
            stand_in.parent.mkdir()
            stand_in.write_text(f"""#!/bin/sh
case "$1" in *tests/test-*.py) echo "$1" >> '{log}'; exit 0;; esac
exec {sys.executable} "$@"
""")
            stand_in.chmod(0o755)
            result = subprocess.run(["make", "--no-print-directory", "-C", str(engine), "test",
                                     f"PYTHON={stand_in}", f"FLYLEAF_FAMILY={booklib.ROOT}"],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            ran = log.read_text().splitlines()
        self.assertEqual([Path(line).name for line in ran], ["test-a.py", "test-b.py"])
        self.assertTrue(all("/my flyleaf/tests/" in line for line in ran), ran)


class TestFamilyMemoryHedges(unittest.TestCase):
    """Vague 'the family remembers' wording is flagged before it reaches family readers."""

    def setUp(self):
        self.patterns = load('check-family-text.py', 'family_text_hedges').GENERAL_WARNINGS

    def flagged(self, text):
        return any(re.search(p, text, re.I) for p in self.patterns)

    def test_vague_family_memory_is_flagged(self):
        for text in ("The family remembers the cold mornings at the quarry cottage.",
                     "The family remembered her teaching the whole street to swim.",
                     "Family lore says the clock came over on the ship.",
                     "According to family, she crossed the bay by sledge in 1871.",
                     "They are remembered in a long letter to a cousin.",
                     "She was remembered as having knitted a scarf for every grandchild."):
            self.assertTrue(self.flagged(text), text)

    def test_named_accounts_and_quoted_epithets_pass(self):
        for text in ("Demelza Penhallow's account of the family says he kept the toll gate.",
                     "The family account tells of carol singing and pasty suppers there.",
                     'In the valley he was remembered as "the singing ferryman."'):
            self.assertFalse(self.flagged(text), text)


class TestEngineNamesNoFamily(unittest.TestCase):
    """A family's names, addresses and file names live in its flyleaf.json or
    content, never as literals in the shared engine (Flyleaf). Comments may
    still cite examples; code may not."""

    SETTINGS = ['family.name', 'maintainer.name', 'maintainer.email',
                'book.pdf_name', 'book.subjects_label']
    # The sample family uses Flyleaf's own domain, so only a family kept
    # outside Flyleaf has a domain of its own to check.
    OWN_DOMAIN = ['site.domain', 'site.origin']
    SITE = ['website/app', 'website/worker', 'website/public/login', 'website/scripts']

    def code_files(self):
        files = [p for p in HERE.glob('*.py') if not p.name.startswith('test-')]
        return files + [f for folder in self.SITE for f in (HERE.parent / folder).rglob('*')
                        if f.suffix in ('.ts', '.tsx', '.js', '.mjs', '.sh')]

    def test_engine_code_holds_none_of_the_familys_settings(self):
        import flyleaf_settings
        keys = self.SETTINGS + ([] if booklib.ROOT.is_relative_to(HERE.parent) else self.OWN_DOMAIN)
        values = [v for v in map(flyleaf_settings.get, keys) if isinstance(v, str) and v]
        self.assertTrue(values)
        found = []
        for path in self.code_files():
            comment = r'(?:^|\s)#' if path.suffix in ('.py', '.sh') else r'(?:^|\s)//'
            for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
                code = re.split(comment, line, maxsplit=1)[0]
                found += [f'{path.relative_to(HERE.parent)}:{number}: {value}'
                          for value in values if value in code]
        self.assertEqual(found, [])


class TestPlaceReadingText(unittest.TestCase):
    def test_links_and_emphasis_preserve_exact_words_and_punctuation(self):
        html = ('<h3 id="school">School</h3><p><a>Ada</a> attended '
                '<em>Example High School</em> in <a><i>Penryn</i></a>.</p>'
                '<p>His <strong>later</strong> occupation is uncertain.</p>')
        place_readings_mod.validate_readings(html, [{
            'anchor': 'school',
            'witness': 'Ada attended Example High School in Penryn.',
            'requiredContext': ['His later occupation is uncertain.'],
        }])

    def test_block_boundaries_separate_but_inline_boundaries_do_not(self):
        html = '<h3 id="s">School</h3><p>First.</p><p>Second<br>line.</p>'
        place_readings_mod.validate_readings(html, [{
            'anchor': 's', 'witness': 'School First. Second line.',
        }])

    def test_changed_wording_or_missing_qualification_still_fails(self):
        reading = {'anchor': 's', 'witness': 'At Penryn.',
                   'requiredContext': ['Probably a pupil.']}
        for html in [
            '<h3 id="s">School</h3><p>At <a>Penryn</a>!</p><p>Probably a pupil.</p>',
            '<h3 id="s">School</h3><p>At <a>Truro</a>.</p><p>Probably a pupil.</p>',
            '<h3 id="s">School</h3><p>At <a>Penryn</a>.</p><p>A pupil.</p>',
        ]:
            with self.subTest(html=html), self.assertRaisesRegex(ValueError, 'wording needs review'):
                place_readings_mod.validate_readings(html, [reading])

    def test_other_sections_cannot_supply_required_context(self):
        with self.assertRaisesRegex(ValueError, 'wording needs review'):
            place_readings_mod.validate_readings(
                '<h3 id="s">School</h3><p>At Penryn.</p>'
                '<h3 id="other">Later</h3><p>Probably a pupil.</p>',
                [{'anchor': 's', 'witness': 'At Penryn.',
                  'requiredContext': ['Probably a pupil.']}])

    def test_duplicate_headings_and_malformed_context_fail(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate native book heading'):
            place_readings_mod.validate_readings('<h3 id="s">A</h3><h3 id="s">B</h3>', [])
        with self.assertRaisesRegex(ValueError, 'Malformed book/place context'):
            place_readings_mod.validate_readings('<h3 id="s">A</h3>', [
                {'anchor': 's', 'witness': 'A', 'requiredContext': 'B'}])


class TestCitationPunctuation(unittest.TestCase):
    def test_bibliography_uses_its_own_displayed_label_for_access_punctuation(self):
        rec = {'label': 'Citation locator without terminal punctuation',
               'source_label': 'Published source; date unresolved.',
               'url': 'https://www.familysearch.org/ark:/fixture', 'tier': 'compiled-secondary'}
        assembler = assemble_mod.Assembler.__new__(assemble_mod.Assembler)
        assembler.src_keys = {'subject': {'record': rec}}
        assembler.cited_uses = {assemble_mod.citation_identity(rec)}
        result = assembler.bibliography()
        self.assertIn('Published source; date unresolved. Viewed at #link(', result)
        self.assertNotIn('., viewed at', result)

    def test_full_citation_does_not_append_comma_after_terminal_punctuation(self):
        for label in ['Index entry; birth year unresolved.', 'Which year?', 'A. N. Author, U.S.']:
            with self.subTest(label=label):
                result = assemble_mod.citation_body({
                    'label': label, 'url': 'https://www.familysearch.org/ark:/fixture',
                    'tier': 'secondary'})
                self.assertIn(assemble_mod.esc(label) + ' Viewed at #link(', result)
                self.assertNotIn('., viewed at', result)

    def test_full_citation_preserves_unpunctuated_and_unlinked_labels(self):
        rec = {'label': 'A. N. Author, family history, p. 14',
               'url': 'https://www.familysearch.org/ark:/fixture', 'tier': 'secondary'}
        self.assertIn('p. 14, viewed at #link(', assemble_mod.citation_body(rec))
        rec.update(label='Index entry; unresolved.', url='')
        self.assertIn('unresolved. #text', assemble_mod.citation_body(rec))


# Five generations: the Root line runs from no. 1 to no. 32; no. 9 and her
# father no. 18 found the Line line. No. 4 had a second family.
CHART_FAMILY = """0 @I1@ INDI
1 REFN chart-kid
2 TYPE jsonid
1 NAME Kid /Root/
1 FAMC @F1@
0 @I2@ INDI
1 REFN thomas-root
2 TYPE jsonid
1 NAME Thomas /Root/
1 SEX M
1 BIRT
2 DATE 1850
1 FAMS @F1@
1 FAMC @F2@
0 @I3@ INDI
1 REFN mary-mum
2 TYPE jsonid
1 NAME Mary /Mum/
1 SEX F
1 FAMS @F1@
0 @I4@ INDI
1 REFN henry-root
2 TYPE jsonid
1 NAME Henry /Root/
1 SEX M
1 FAMS @F2@
1 FAMS @F3@
1 FAMC @F4@
0 @I5@ INDI
1 REFN grace-gran
2 TYPE jsonid
1 NAME Grace /Gran/
1 SEX F
1 FAMS @F2@
0 @I6@ INDI
1 REFN james-root
2 TYPE jsonid
1 NAME James /Root/
1 FAMC @F2@
0 @I7@ INDI
1 REFN thomas-root-1855
2 TYPE jsonid
1 NAME Thomas /Root/
1 BIRT
2 DATE 1855
1 FAMC @F2@
0 @I8@ INDI
1 REFN grace-root
2 TYPE jsonid
1 NAME Grace /Root/
1 FAMC @F2@
0 @I9@ INDI
1 REFN other-wife
2 TYPE jsonid
1 NAME Other /Wife/
1 SEX F
1 FAMS @F3@
0 @I10@ INDI
1 REFN half-root
2 TYPE jsonid
1 NAME Half /Root/
1 FAMC @F3@
0 @I11@ INDI
1 REFN old-root
2 TYPE jsonid
1 NAME Old /Root/
1 SEX M
1 BIRT
2 DATE ABT 12 MAY 1778
1 DEAT
2 DATE 1860
1 FAMS @F4@
1 FAMC @F5@
0 @I12@ INDI
1 REFN lena-line
2 TYPE jsonid
1 NAME Lena /Line/
1 SEX F
1 FAMS @F4@
1 FAMC @F6@
0 @I13@ INDI
1 REFN elder-root
2 TYPE jsonid
1 NAME Elder /Root/
1 SEX M
1 FAMS @F5@
1 FAMC @F7@
0 @I14@ INDI
1 REFN eldest-root
2 TYPE jsonid
1 NAME Eldest /Root/
1 SEX M
1 FAMS @F7@
0 @I15@ INDI
1 REFN luke-line
2 TYPE jsonid
1 NAME Luke /Line/
1 SEX M
1 FAMS @F6@
0 @I16@ INDI
1 REFN chart-sister
2 TYPE jsonid
1 NAME Sister /Root/
1 FAMC @F1@
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I3@
1 CHIL @I1@
1 CHIL @I16@
0 @F2@ FAM
1 HUSB @I4@
1 WIFE @I5@
1 CHIL @I6@
1 CHIL @I2@
1 CHIL @I7@
1 CHIL @I8@
0 @F3@ FAM
1 HUSB @I4@
1 WIFE @I9@
1 CHIL @I10@
0 @F4@ FAM
1 HUSB @I11@
1 WIFE @I12@
1 CHIL @I4@
0 @F5@ FAM
1 HUSB @I13@
1 CHIL @I11@
0 @F6@ FAM
1 HUSB @I15@
1 CHIL @I12@
0 @F7@ FAM
1 HUSB @I14@
1 CHIL @I13@
"""


class TestPrintCharts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # The current family's tree and chapters, for checks that hold for any family.
        cls.tree = booklib.Tree()
        cls.cfg = booklib.load_book_yaml()
        cls.root = booklib.root_refn(cls.cfg)
        cls.table = cls.tree.ahnentafel(cls.root)
        cls.typesetter = bookcharts.Typesetter()
        cls.chart_tree = fixture_tree(CHART_FAMILY)
        cls.chart_table = cls.chart_tree.ahnentafel('chart-kid')

    def graph(self, chapter):
        ch = next(c for c in self.cfg['chapters'] if c['id'] == chapter)
        return bookcharts.chapter_graph(self.tree, self.table, ch['lines'])

    def chart_graph(self, lines=('root',), tree=None):
        return bookcharts.chapter_graph(tree or self.chart_tree, self.chart_table, list(lines))

    def test_year_reduction_retains_bounds_estimates_ranges_and_calendar(self):
        cases = {'ABT 12 MAY 1778': 'c. 1778', 'EST 1800': 'est. 1800',
                 'CAL 1900': 'calc. 1900', 'BEF 1901': 'before 1901',
                 'AFT 1900': 'after 1900', 'BET 1899 AND 1901': 'between 1899 and 1901',
                 'BET 19 OCT 1887 AND 20 OCT 1887': '1887',
                 'BET JAN 1884 AND DEC 1884': '1884',
                 'FROM 1899 TO 1901': 'from 1899 to 1901', 'TO 1901': 'to 1901',
                 'FROM 1 JAN 1884 TO 31 DEC 1884': '1884',
                 '1 JAN 1734/35': '1734/35', 'possibly 1901': 'possibly 1901',
                 '0044 B.C.': '0044 B.C.', 'INT 1850 (memory)': 'INT 1850 (memory)',
                 '@#DJULIAN@ 2 FEB 1700': '1700 (Julian)', '@#DGREGORIAN@ 2 FEB 1700': '1700',
                 'ABT @#DJULIAN@ 1700': 'c. 1700 (Julian)',
                 '20 MAY 1900': '1900', '': ''}
        for value, expected in cases.items():
            with self.subTest(value=value):
                self.assertEqual(booklib.date_year(value), expected)

    def test_year_only_reduction_preserves_the_underlying_day_range(self):
        person = {'birth_date': 'BET 19 OCT 1887 AND 20 OCT 1887',
                  'death_date': '1962'}
        self.assertEqual(bookcharts.lifespan(person), '1887–1962')
        self.assertEqual(assemble_mod.prose_date(person['birth_date']),
                         'between 19 October 1887 and 20 October 1887')
        self.assertEqual(assemble_mod.child_date(person['birth_date']),
                         'between 19 Oct. 1887 and 20 Oct. 1887')

    def test_unsupported_or_qualified_range_expressions_remain_visible(self):
        for value in ['BET ABT 1884 AND ABT 1884', 'BET 1884 OR 1884',
                      'FROM 1884 AND 1884', 'BET 1884 AND 1884 (uncertain)',
                      'BET CAL 1884 AND EST 1885']:
            with self.subTest(value=value):
                self.assertEqual(booklib.date_year(value), value)

    def test_narrative_headings_and_charts_share_qualified_lifespan(self):
        p = self.chart_tree.by_refn['old-root']
        self.assertEqual(assemble_mod.years(p), 'b. c. 1778; d. 1860')
        self.assertEqual(self.chart_graph()['nodes'][8]['people'][0]['years'], assemble_mod.years(p))

    def test_all_current_people_and_parent_links_fit_readable_panels(self):
        for chapter in [c for c in self.cfg['chapters'] if c['lines'] != ['origin']]:
            graph = self.graph(chapter['id'])
            panels = bookcharts.plan_panels(graph, self.typesetter)
            bookcharts.validate_panels(graph, panels, self.typesetter)
            expected = {n for n in self.table if self.tree.line_of(n, self.table) in chapter['lines']}
            displayed = {p['n'] for node in graph['nodes'].values() for p in node['people']}
            self.assertTrue(expected <= displayed)
            owner = {p['n']: n for n, node in graph['nodes'].items() for p in node['people']}
            for edge in graph['edges']:
                parent = graph['nodes'][edge['parent']]['people'][0]['n']
                self.assertEqual(edge['child_person'], parent // 2)
                self.assertEqual(edge['child'], owner[parent // 2])
            for panel in panels:
                self.assertLessEqual(panel['geometry']['height'], 396)
                xml = bookcharts.render_panel(graph, panel)
                self.assertIn('width="313.2pt"', xml)
                self.assertIn('font-size="9"', xml)
            self.assertIn(self.root, {p['refn'] for p in graph['nodes'][1]['root_children']})

    def test_root_box_names_the_root_and_siblings(self):
        graph = self.chart_graph()
        self.assertEqual([p['refn'] for p in graph['nodes'][1]['root_children']],
                         ['chart-kid', 'chart-sister'])

    def test_missing_intermediate_generations_are_added_not_skipped(self):
        graph = self.chart_graph(['line'])
        displayed = {p['n'] for node in graph['nodes'].values() for p in node['people']}
        self.assertTrue({1, 2, 3, 4, 9, 18} <= displayed)
        for edge in graph['edges']:
            self.assertEqual(graph['nodes'][edge['parent']]['generation'],
                             graph['nodes'][edge['child']]['generation'] + 1)

    def test_mother_without_father_is_not_folded_away(self):
        tree = fixture_tree(MOTHER_ONLY)
        graph = bookcharts.chapter_graph(tree, tree.ahnentafel('root-kid'), ['known'])
        self.assertEqual(set(graph['nodes']), {1, 3})
        self.assertEqual(graph['edges'], [{'parent': 3, 'child': 1, 'child_person': 1}])

    def test_children_from_another_marriage_do_not_enter_a_couples_box(self):
        tree = copy.deepcopy(self.chart_tree)
        parent = tree.by_refn['henry-root']
        # Add a hypothetical child only to the other marriage; it is not a
        # child of the pair drawn above Thomas in this chapter.
        other = next(f for f in tree.spouse_families(parent['xref']) if f['xref'] == '@F3@')
        other['chil'].append(tree.by_refn['chart-kid']['xref'])
        graph = self.chart_graph(tree=tree)
        children = {p['refn'] for p in graph['nodes'][4]['siblings']}
        self.assertNotIn('chart-kid', children)
        self.assertNotIn('half-root', children)
        self.assertEqual(len(children), 3)

    def test_named_children_and_two_thomases_stay_distinguishable(self):
        graph = self.chart_graph()
        self.assertEqual([p['label'] for p in graph['nodes'][4]['siblings']],
                         ['James', 'Thomas (1855)', 'Grace'])
        self.assertEqual([p['name'] for p in graph['nodes'][4]['siblings']],
                         ['James Root', 'Thomas Root', 'Grace Root'])

    def test_long_names_wrap_without_reducing_type_or_clipping(self):
        text = 'Averylongunbrokenfamilynamewithmanyletters and another name'
        lines = self.typesetter.wrap(text, 55)
        self.assertEqual(''.join(''.join(lines).split()), ''.join(text.split()))
        self.assertTrue(all(self.typesetter.length(line) <= 55 for line in lines))

    def test_other_children_end_with_one_period_without_changing_suffixes(self):
        for labels, expected in [(['Ada', 'Edward Jr.'], 'Other children shown: Ada; Edward Jr.'),
                                 (['Edward Jr.', 'Ada'], 'Other children shown: Edward Jr.; Ada.'),
                                 (['James III'], 'Other children shown: James III.')]:
            with self.subTest(labels=labels):
                node = {'n': 2, 'people': [], 'siblings': [{'label': s} for s in labels]}
                lines = self.typesetter.node_lines(node, 1000)
                self.assertEqual(' '.join(s for s, role in lines if role == 'siblings'), expected)
                self.assertEqual([p['label'] for p in node['siblings']], labels)

    def test_missing_nodes_and_disconnected_panels_fail(self):
        graph = {'nodes': {1: {}, 2: {}}, 'edges': [{'parent': 2, 'child': 1, 'child_person': 1}]}
        with self.assertRaisesRegex(ValueError, 'complete chapter graph'):
            bookcharts.validate_panels(graph, [{'nodes': [1]}], self.typesetter)
        with self.assertRaisesRegex(ValueError, 'parent–child link'):
            bookcharts.validate_panels(graph, [{'nodes': [1]}, {'nodes': [2]}], self.typesetter)

    def test_wrong_continuation_or_overlapping_boxes_fail(self):
        graph = self.chart_graph()
        panels = bookcharts.plan_panels(graph, self.typesetter)
        broken = copy.deepcopy(panels)
        n = next(iter(broken[0]['earlier']))
        broken[0]['earlier'][n] = broken[0]['number']
        with self.assertRaisesRegex(ValueError, 'wrong person'):
            bookcharts.validate_panels(graph, broken, self.typesetter)
        boxes = list(panels[0]['geometry']['positions'].values())
        boxes[1]['x'], boxes[1]['y'] = boxes[0]['x'], boxes[0]['y']
        with self.assertRaisesRegex(ValueError, 'overlap'):
            bookcharts.validate_panels(graph, panels, self.typesetter)

    def test_modified_chart_and_changed_source_cannot_reuse_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            result = bookcharts.generate(self.tree, self.cfg, directory)
            bookcharts.load_manifest(self.tree, directory, self.cfg)
            chapter = next(c for c in result['chapters'].values() if c['panels'])
            path = directory / chapter['panels'][0]['file']
            path.write_text(path.read_text() + '\n')
            with self.assertRaisesRegex(ValueError, 'has changed'):
                bookcharts.load_manifest(self.tree, directory, self.cfg)
            with patch.object(bookcharts, 'inputs_digest', return_value={}):
                with self.assertRaisesRegex(ValueError, 'stale'):
                    bookcharts.load_manifest(self.tree, directory, self.cfg)


class TestCompiledChartChecks(unittest.TestCase):
    manifest = {'width_pt': 313.2, 'chapters': {'family': {'panels': [
        {'focus': 2, 'number': 1, 'file': 'one.svg'}]}}}

    def elements(self):
        return [{'func': 'figure'},
                {'func': 'image', 'label': '<chart-image>', 'source': '/build/figures/one.svg',
                 'width': '0% + 313.2pt', 'height': 'auto'},
                {'label': '<chart-check>', 'value': {'id': 'chart-family-2', 'number': 1, 'page': 4}}]

    def test_complete_inventory_and_print_width_pass(self):
        self.assertEqual(charts_check_mod.check_charts(self.manifest, self.elements()), (1, []))

    def test_missing_or_duplicate_instrumentation_fails(self):
        for elements in [[], self.elements()[:-1], self.elements() + self.elements()[-1:]]:
            self.assertTrue(charts_check_mod.check_charts(self.manifest, elements)[1])

    def test_wrong_continuation_number_or_image_fails(self):
        for which in ('number', 'image'):
            elements = self.elements()
            if which == 'number':
                elements[-1]['value']['number'] = 3
            else:
                elements[1]['source'] = '/build/figures/wrong.svg'
            self.assertTrue(charts_check_mod.check_charts(self.manifest, elements)[1])

    def test_rescaling_cannot_silently_shrink_chart_type(self):
        for width, height in [('0% + 200pt', 'auto'), ('100%', 'auto'), ('0% + 313.2pt', '200pt')]:
            elements = self.elements()
            elements[1].update(width=width, height=height)
            self.assertTrue(charts_check_mod.check_charts(self.manifest, elements)[1])

    @unittest.skipUnless(shutil.which('typst'), 'Typst required for chart layout integration')
    def test_template_keeps_chart_size_and_separate_numbering(self):
        with tempfile.TemporaryDirectory(dir=booklib.ROOT) as tmp:
            directory = Path(tmp)
            (directory / 'panel.svg').write_text(
                '<svg xmlns="http://www.w3.org/2000/svg" width="313.2pt" height="100pt">'
                '<text x="10" y="20" font-size="9">Chart fixture</text></svg>')
            src = directory / 'charts.typ'
            src.write_text(IMPORT + ''': *
#show: book.with(title: "Chart fixture")
#figure(image("panel.svg", width: 1in), caption: [First source])
#book-chart("panel.svg", [First chart]) <chart-family-2>
#pagebreak()
#figure(image("panel.svg", width: 1in), caption: [Second source])
#book-chart("panel.svg", [Second chart]) <chart-family-4>
#context [#metadata(counter(figure.where(kind: image)).get().first()) <ordinary-count>]
'''.replace('"panel.svg"', json.dumps('/' + directory.name + '/panel.svg')))
            proc = subprocess.run(['typst', 'query', '--root', str(booklib.ROOT), str(src),
                                   'selector(metadata).or(<chart-image>)'],
                                  capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            elements = json.loads(proc.stdout)
            charts = [e['value'] for e in elements if e.get('label') == '<chart-check>']
            self.assertEqual([(c['id'], c['number']) for c in charts],
                             [('chart-family-2', 1), ('chart-family-4', 2)])
            ordinary = [e['value'] for e in elements if e.get('label') == '<ordinary-count>']
            self.assertEqual(ordinary, [2])
            images = [e for e in elements if e.get('label') == '<chart-image>']
            self.assertEqual(len(images), 2)
            self.assertTrue(all(e['width'] == '0% + 313.2pt' and e['height'] == 'auto'
                                for e in images))


class TestRepeatedAncestors(unittest.TestCase):
    """Cousins who marry share ancestors. Each prints in full once, under the
    first number; a royal pedigree otherwise runs to thousands of pages."""
    # 5 and 6 are brother and sister: their parents X and Y are 10 and 11,
    # and again 12 and 13. X's father Z is 20, and again 24.
    TABLE = {1: '@R@', 2: '@F@', 3: '@M@', 4: '@A@', 5: '@B@', 6: '@C@', 7: '@D@',
             10: '@X@', 11: '@Y@', 12: '@X@', 13: '@Y@', 20: '@Z@', 24: '@Z@'}

    def test_a_repeated_ancestor_and_their_line_print_once(self):
        shown, repeats = booklib.first_appearances(self.TABLE)
        self.assertEqual(list(shown), [1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 20])
        self.assertEqual(repeats, {12: 10, 13: 11})

    def test_the_ancestor_table_says_where_a_repeat_is_listed(self):
        assembler = assemble_mod.Assembler.__new__(assemble_mod.Assembler)
        assembler.table = self.TABLE
        assembler.cov = {'gaps': [21, 22, 23, 25, 26, 27]}
        names = {x: {'given': x.strip('@'), 'surname': 'Example'} for x in set(self.TABLE.values())}
        assembler.tree = SimpleNamespace(by_xref=names)
        with patch.object(booklib, 'repeated_ancestors_once', return_value=True):
            out = assembler.ahnentafel_table()
        self.assertIn('[12], [X Example, see no.~10], [], [],', out)
        self.assertNotIn('[24]', out)
        # Unknown parents of a repeat are not listed again either.
        self.assertIn('[21]', out)
        self.assertNotIn('[25]', out)
        self.assertNotIn('[26]', out)
        self.assertIn('listed in full once', out)
        with patch.object(booklib, 'repeated_ancestors_once', return_value=False):
            every = assembler.ahnentafel_table()
        self.assertIn('[24]', every)
        self.assertNotIn('see no.', every)

    def test_a_chart_box_says_where_a_repeats_earlier_generations_are(self):
        node = {'n': 12, 'people': [{'n': 12, 'name': 'X Example', 'years': '1800–1860', 'see': 10}],
                'siblings': []}
        lines = [text for text, _ in bookcharts.Typesetter().node_lines(node, 180)]
        self.assertIn('See no. 10.', lines)


@unittest.skipUnless(shutil.which('typst') and shutil.which('pdftotext'),
                     'Typst and poppler required for table geometry')
class TestAncestryTableLayout(unittest.TestCase):
    def test_last_rows_stay_with_the_closing_note(self):
        # A long table once ended with a single row alone on its last page.
        assembler = assemble_mod.Assembler.__new__(assemble_mod.Assembler)
        assembler.table = {}
        assembler.cov = {'gaps': list(range(100, 160))}
        assembler.tree = SimpleNamespace(by_xref={})
        out = assembler.ahnentafel_table()
        tail = out[out.index('#block(breakable: false'):]
        self.assertIn('research frontier', tail)
        self.assertEqual(tail.count('\n  ['), assemble_mod.AHNENTAFEL_TAIL_ROWS)
        self.assertEqual(out.count('table.header'), 1)

    def test_long_date_ranges_do_not_collapse_or_overlap_the_person_column(self):
        # The actual failure requires the assembled table's auto date columns:
        # they consumed the available width and overprinted the names.
        assembler = assemble_mod.Assembler.__new__(assemble_mod.Assembler)
        assembler.table = {122: '@I1@', 1838: '@I2@'}
        assembler.cov = {'gaps': [1871]}
        assembler.tree = SimpleNamespace(by_xref={
            '@I1@': {'given': 'Wenna', 'surname': 'Example',
                     'birth_date': 'BET 19 OCT 1887 AND 20 OCT 1887',
                     'death_date': 'BET 1961 AND 1963'},
            '@I2@': {'given': 'Ysella', 'surname': 'Polglase',
                     'birth_date': 'CAL MAR 1811', 'death_date': '17 NOV 1886'},
        })
        with tempfile.TemporaryDirectory(dir=booklib.ROOT) as tmp:
            src = Path(tmp) / 'ancestry.typ'
            pdf = src.with_suffix('.pdf')
            src.write_text(IMPORT + ': *\n'
                           '#show: book.with(title: "Ancestry fixture")\n'
                           '#set page(header: none, numbering: none)\n'
                           + assembler.ahnentafel_table())
            proc = subprocess.run(['typst', 'compile', '--root', str(booklib.ROOT),
                                   str(src), str(pdf)], capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            proc = subprocess.run(['pdftotext', '-bbox-layout', str(pdf), '-'],
                                  capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            ns = {'x': 'http://www.w3.org/1999/xhtml'}
            pages = ET.fromstring(proc.stdout).findall('.//x:page', ns)
            for page in pages:
                words = page.findall('.//x:word', ns)
                text = {word.text for word in words}
                if 'born' not in text:
                    continue
                for expected in ('person', 'Wenna', 'Example', 'Ysella', 'Polglase'):
                    self.assertIn(expected, text)
                number = next(word for word in words if word.text == '1838')
                name = next(word for word in words if word.text == 'Ysella')
                # Both neighboring cells have 4.5pt insets; allow 0.5pt for
                # glyph bounding-box differences while retaining that gap.
                self.assertGreaterEqual(float(name.get('xMin')) - float(number.get('xMax')), 8.5,
                                        'Four-digit ancestor number encroaches on the column rule')
                for i, left in enumerate(words):
                    for right in words[i + 1:]:
                        overlap_x = min(float(left.get('xMax')), float(right.get('xMax'))) - max(float(left.get('xMin')), float(right.get('xMin')))
                        overlap_y = min(float(left.get('yMax')), float(right.get('yMax'))) - max(float(left.get('yMin')), float(right.get('yMin')))
                        self.assertFalse(overlap_x > 0.8 and overlap_y > 0.8,
                                         f'Overlapping printed words: {left.text!r}, {right.text!r}')
                break
            else:
                self.fail('Rendered ancestry table was not found')


class TestFootnoteEntryStarts(unittest.TestCase):
    """A split entry's end page concealed its start before the anchor."""

    @staticmethod
    def elements(start=2, anchor=2, **fields):
        value = dict(entry_start=start, anchor=anchor, number=17)
        value.update(fields)
        return [{"func": "entry"},
                {"func": "metadata", "label": "<fn-check>", "value": value}]

    def test_early_start_fails_even_when_end_would_pass(self):
        count, errors = footnotes_mod.check_entries(
            self.elements(start=2, anchor=3, entry_end=3))
        self.assertEqual(count, 1)
        self.assertEqual(len(errors), 1)
        self.assertIn("footnote 17 starts on PDF page 2", errors[0])

    def test_same_or_later_page_starts_pass(self):
        for start in (2, 3):
            self.assertEqual(footnotes_mod.check_entries(
                self.elements(start=start, anchor=2)), (1, []))

    def test_missing_or_partial_instrumentation_fails(self):
        for elements in ([], [{"func": "entry"}],
                         self.elements() + [{"func": "entry"}]):
            self.assertTrue(footnotes_mod.check_entries(elements)[1])

    def test_old_end_page_schema_is_rejected(self):
        elements = self.elements()
        value = elements[1]["value"]
        value["entry"] = value.pop("entry_start")
        self.assertIn("entry_start", footnotes_mod.check_entries(elements)[1][0])

    @unittest.skipUnless(shutil.which("typst"), "Typst required for layout integration")
    def test_template_measures_start_of_a_real_split_note(self):
        with tempfile.TemporaryDirectory(dir=booklib.ROOT) as tmp:
            src = Path(tmp) / "split.typ"
            src.write_text(IMPORT + ''': *
#show: book.with(title: "Footnote fixture")
#set page(width: 5in, height: 3in, margin: 0.5in, header: none, numbering: none)
Text.#footnote[#lorem(300) #context [#metadata(here().page()) <note-end>]]
''')
            proc = subprocess.run(
                ["typst", "query", str(src), "metadata", "--root", str(booklib.ROOT)],
                capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            values = {e["label"]: e["value"] for e in json.loads(proc.stdout)}
            check = values["<fn-check>"]
            self.assertEqual(check["entry_start"], check["anchor"])
            self.assertLess(check["entry_start"], values["<note-end>"])
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(footnotes_mod.main([str(src)]), 0)

    @unittest.skipUnless(shutil.which("typst"), "Typst required for layout integration")
    def test_long_child_list_does_not_start_notes_before_child(self):
        # Four children with uneven citation loads reproduce the actual
        # register failure: notes 5-8 started before the fourth child's page.
        with tempfile.TemporaryDirectory(dir=booklib.ROOT) as tmp:
            src = Path(tmp) / "children.typ"
            src.write_text(IMPORT + ''': *
#show: book.with(title: "Children footnote fixture")
#set page(header: none, numbering: none)
He married in Cornwall in 1838. Their four children follow.
#children([Children of Jory and Ada:], (
  child-fwd("44", "i", [Kenwyn, born in 1839.]),
  child-plain("ii", [Edith, born about 1842#footnote[#lorem(90)]; died 1871; burial reported at the parish cemetery#footnote[#lorem(60)].]),
  child-plain("iii", [Davey, born 1845#footnote[#lorem(90)]; died 1903; burial reported at Penwith Cemetery#footnote[#lorem(60)].]),
  child-plain("iv", [Nora, born about 1849#footnote[#lorem(90)]#footnote[#lorem(90)]#footnote[#lorem(90)]; died 1867#footnote[#lorem(60)]; burial recorded at the parish cemetery#footnote[#lorem(60)]#footnote[#lorem(60)].]),
))
''')
            proc = subprocess.run(
                ["typst", "query", str(src), footnotes_mod.SELECTOR,
                 "--root", str(booklib.ROOT)], capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            elements = json.loads(proc.stdout)
            count, errors = footnotes_mod.check_entries(elements)
            self.assertEqual(count, 10)
            self.assertEqual(errors, [])
            checks = [e["value"] for e in elements if e.get("label") == "<fn-check>"]
            # Citation overflow must still exercise more than one page;
            # the fixed layout may keep all four children on the first page.
            self.assertGreater(max(c["entry_start"] for c in checks), checks[0]["anchor"])


@unittest.skipUnless(shutil.which("typst") and shutil.which("pdftotext"),
                     "Typst and poppler required for page furniture checks")
class TestRectoFillerPages(unittest.TestCase):
    def render(self, body, *, assembled=False, template=IMPORT):
        with tempfile.TemporaryDirectory(dir=booklib.ROOT) as tmp:
            src = Path(tmp) / "filler.typ"
            pdf = src.with_suffix(".pdf")
            if not assembled:
                body = (template + ': *\n'
                        '#show: book.with(title: "Fixture running title")\n' + body)
            src.write_text(body)
            proc = subprocess.run(["typst", "compile", str(src), str(pdf),
                                   "--root", str(booklib.ROOT)], capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            proc = subprocess.run(["pdftotext", "-layout", str(pdf), "-"],
                                  capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            return proc.stdout.split("\f")[:-1]

    def assembled_pages(self, front_matter):
        # Exercise the actual assembly call site: its numbering setting can
        # change page layout before the template's part-page function runs.
        with tempfile.TemporaryDirectory(dir=booklib.ROOT) as tmp:
            book_dir = Path(tmp)
            (book_dir / 'front-matter').mkdir()
            (book_dir / 'front-matter/02-methodology.typ').write_text(front_matter)
            assembly = SimpleNamespace(
                cfg={'title': 'Fixture running title'}, cov={'ancestors': []},
                process_prose=lambda body, *_: body,
                narrative=lambda: '= First narrative\nNarrative body.',
                register=lambda: '= Register\nRegister body.',
                register_references=lambda: '', bibliography=lambda: '',
                ahnentafel_table=lambda: '', name_index=lambda: '')
            with patch.object(booklib, 'BOOK_DIR', book_dir), \
                    patch.object(booklib, 'TEMPLATE_IMPORT', FIXTURE_TEMPLATE_IMPORT):
                source = assemble_mod.Assembler.assemble(assembly)
            return self.render(source, assembled=True)

    def test_assembled_front_matter_numbering_boundary(self):
        scenarios = {
            'odd': '= Methodology\nUnique methods paragraph.\n',
            'even': ('= Methodology\nUnique methods paragraph.\n'
                     '#pagebreak()\nUnique methods continuation.\n'),
            'continued-note': ('= Methodology\nUnique methods paragraph.'
                               '#footnote[#lorem(1600)]\n'),
        }
        for case, front_matter in scenarios.items():
            with self.subTest(case=case):
                pages = self.assembled_pages(front_matter)
                methods = next(i for i, page in enumerate(pages)
                               if 'Unique methods paragraph.' in page)
                part = next(i for i, page in enumerate(pages)
                            if 'The Narrative' in page and
                            re.search(r'P\s*A\s*R\s*T\s*I\b', page))
                self.assertEqual((part + 1) % 2, 1, 'Part I must open recto')
                self.assertEqual(pages[part].strip().splitlines()[-1].strip(), '1')
                self.assertEqual(pages[part + 1].strip(), '')
                self.assertIn('Narrative body.', pages[part + 2])
                self.assertEqual(pages[part + 2].strip().splitlines()[-1].strip(), '3')
                if case == 'even':
                    self.assertEqual(part, methods + 2)
                    self.assertIn('Unique methods continuation.', pages[part - 1])
                    substantive = range(methods, part)
                else:
                    self.assertEqual(pages[part - 1].strip(), '',
                                     'The blank verso must have no header or folio')
                    substantive = range(methods, part - 1)
                    if case == 'odd':
                        self.assertEqual(part, methods + 2)
                    else:
                        self.assertGreaterEqual(len(substantive), 2,
                                                'Exercise a continued footnote')
                for number in substantive:
                    self.assertRegex(pages[number].strip().splitlines()[-1].strip(),
                                     r'^[ivxlcdm]+$',
                                     'Substantive front-matter pages keep Roman folios')

    def test_empty_recto_filler_has_no_running_head_or_folio(self):
        pages = self.render('= First\nOpening text.\n= Second\nEnding text.\n')
        self.assertEqual(len(pages), 3)
        self.assertEqual(pages[1].strip(), "")
        self.assertTrue(pages[0].rstrip().endswith("i"))
        self.assertTrue(pages[2].rstrip().endswith("iii"))

    def test_substantive_page_keeps_furniture_and_arabic_numbering(self):
        pages = self.render('#set page(numbering: "1")\n'
                            '= First\nOpening text.\n#pagebreak()\n'
                            'Continuation text.\n= Second\nEnding text.\n')
        self.assertEqual(len(pages), 3)
        self.assertIn("Continuation text", pages[1])
        self.assertIn("FIXTURERUNNINGTITLE", pages[1].replace(" ", ""))
        self.assertTrue(pages[1].rstrip().endswith("2"))
        self.assertTrue(pages[2].rstrip().endswith("3"))

    def test_title_page_suppresses_custom_footer(self):
        pages = self.render('#title-page(title: "Fixture title")\n= First\nBody.\n')
        self.assertIn("Fixture title", pages[0])
        self.assertNotRegex(pages[0].rstrip(), r"\n\s*[ivx0-9]+$")
        self.assertEqual(pages[1].strip(), "")

    def test_full_book_title_author_and_stamp_fit_on_one_leaf(self):
        # The family's own title page, set in the family's own fonts.
        cfg = booklib.load_book_yaml()
        args = ', '.join(f'{key}: {json.dumps(cfg.get(key, ""))}'
                         for key in ('title', 'subtitle', 'author'))
        pages = self.render(f'#title-page({args}, stamp: "September 2026 edition")\n'
                            '= Contents\nContents text.\n', template=FAMILY_IMPORT)
        self.assertIn("September 2026 edition", pages[0])
        self.assertEqual(pages[1].strip(), "")
        self.assertEqual(len(pages), 3)

    def test_part_page_restarts_at_one_and_next_chapter_is_recto(self):
        pages = self.render('#set page(numbering: "1")\n'
                            '#part-page("Part I", "The Narrative", restart: true)\n'
                            '= First\nOpening text.\n')
        self.assertTrue(pages[0].rstrip().endswith("1"))
        self.assertEqual(pages[1].strip(), "")
        self.assertIn("First", pages[2])
        self.assertTrue(pages[2].rstrip().endswith("3"))

    def test_footnote_continuations_keep_folios(self):
        pages = self.render('#set page(numbering: "1", height: 4in)\n'
                            'Anchor.#footnote[#lorem(650)]\n'
                            '= Next chapter\nClosing text.\n')
        notes = [(i, page) for i, page in enumerate(pages, 1)
                 if i > 1 and len(page.split()) > 30 and "Closing text" not in page]
        self.assertTrue(notes, "fixture must produce a footnote continuation page")
        for i, page in notes:
            self.assertTrue(page.rstrip().endswith(str(i)), (i, page))


class TestRegisterSourceAccounting(unittest.TestCase):
    expected = Counter({("parent", "one"): 1, ("child", "two"): 1})

    @staticmethod
    def elements(*pairs):
        return [{"value": {"refn": refn, "key": key}} for refn, key in pairs]

    def test_all_keys_once_pass(self):
        count, errors = register_sources_mod.check_sources(
            self.expected, self.elements(*self.expected))
        self.assertEqual((count, errors), (2, []))

    def test_missing_duplicate_unexpected_and_wrong_person_fail(self):
        cases = [[], [("parent", "one")],
                 [("parent", "one"), ("child", "two"), ("child", "two")],
                 [("parent", "one"), ("child", "two"), ("other", "three")],
                 [("parent", "one"), ("parent", "two")]]
        for pairs in cases:
            with self.subTest(pairs=pairs):
                self.assertTrue(register_sources_mod.check_sources(
                    self.expected, self.elements(*pairs))[1])

    def test_malformed_query_fails(self):
        for elements in (None, {}, [None], [{"value": {"refn": "parent"}}]):
            self.assertTrue(register_sources_mod.check_sources(self.expected, elements)[1])

    def test_query_failure_is_not_a_preservation_pass(self):
        with patch.object(register_sources_mod.subprocess, "run", side_effect=OSError("unavailable")):
            with contextlib.redirect_stderr(io.StringIO()) as err:
                self.assertEqual(register_sources_mod.main([]), 1)
            self.assertIn("unavailable", err.getvalue())

    @unittest.skipUnless(shutil.which("typst") and shutil.which("pdftotext"),
                         "Typst and poppler required for reference spacing")
    def test_reference_text_has_clear_space_below_register_pointer(self):
        # Bounding boxes exposed actual overlap between the italic pointer
        # and first source. Check printed geometry, not a template constant.
        with tempfile.TemporaryDirectory(dir=booklib.ROOT) as tmp:
            src = Path(tmp) / "references.typ"
            pdf = src.with_suffix(".pdf")
            src.write_text(IMPORT + ''': *
#show: book.with(title: "Reference fixture")
#set page(header: none, numbering: none)
=== 16. #smallcaps[Jory Penhallow]

_Register entry: page 151._

#register-sources((
  (refn: "jory", keys: ("death",), body: [First reference gives the exact volume and page.]),
  (refn: "jory", keys: ("birth",), body: [Second reference retains its own qualification.]),
))
''')
            proc = subprocess.run(["typst", "compile", str(src), str(pdf),
                                   "--root", str(booklib.ROOT)], capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            proc = subprocess.run(["pdftotext", "-bbox-layout", str(pdf), "-"],
                                  capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            ns = {"x": "http://www.w3.org/1999/xhtml"}
            lines = {" ".join(w.text or "" for w in line.findall("x:word", ns)): line
                     for line in ET.fromstring(proc.stdout).findall(".//x:line", ns)}
            pointer = lines["Register entry: page 151."]
            first = lines["First reference gives the exact volume and page."]
            second = lines["Second reference retains its own qualification."]
            self.assertGreaterEqual(float(first.get("yMin")) - float(pointer.get("yMax")), 3)
            self.assertGreater(float(second.get("yMin")), float(first.get("yMax")))


# Fixture files live here until the tests finish (tearDownModule removes it).
# A Tree reads its file again later, to hash a person's record.
FIXTURES = tempfile.TemporaryDirectory(prefix="flyleaf-fixtures-")


def fixture_file(text, suffix):
    handle, name = tempfile.mkstemp(suffix=suffix, dir=FIXTURES.name)
    with os.fdopen(handle, "w", encoding="utf-8") as f:
        f.write(text)
    return Path(name)


def fixture_tree(text):
    """Write a minimal GEDCOM and load a Tree over it."""
    return booklib.Tree(fixture_file("0 HEAD\n1 CHAR UTF-8\n" + text + "0 TRLR\n", ".ged"))


MOTHER_ONLY = """0 @I1@ INDI
1 REFN root-kid
2 TYPE jsonid
1 NAME Kid /Example/
1 SEX F
1 FAMC @F1@
0 @I2@ INDI
1 REFN known-mother
2 TYPE jsonid
1 NAME Mother /Known/
1 SEX F
1 FAMS @F1@
0 @F1@ FAM
1 WIFE @I2@
1 CHIL @I1@
"""


class TestLineOfCrash(unittest.TestCase):
    """A family with a known mother and an unknown father must not crash any script."""

    def test_mother_only_does_not_crash(self):
        tree = fixture_tree(MOTHER_ONLY)
        table = tree.ahnentafel("root-kid")
        self.assertEqual(set(table), {1, 3})
        for n in table:
            line = tree.line_of(n, table)   # must not raise KeyError
            self.assertIsInstance(line, str)
        self.assertEqual(tree.line_of(3, table), "known")  # her own surname


TWO_SAMPLE_LINES = """0 @I1@ INDI
1 REFN root-kid
2 TYPE jsonid
1 NAME Kid /Root/
1 SEX F
1 FAMC @F1@
0 @I2@ INDI
1 REFN dad-root
2 TYPE jsonid
1 NAME Dad /Root/
1 SEX M
1 FAMS @F1@
1 FAMC @F2@
0 @I3@ INDI
1 REFN mum-other
2 TYPE jsonid
1 NAME Mum /Other/
1 SEX F
1 FAMS @F1@
1 FAMC @F3@
0 @I4@ INDI
1 REFN first-sample
2 TYPE jsonid
1 NAME Ezra /Sample/
1 SEX M
1 FAMS @F2@
0 @I5@ INDI
1 REFN second-sample
2 TYPE jsonid
1 NAME Silas /Sample/
1 SEX M
1 FAMS @F3@
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I3@
1 CHIL @I1@
0 @F2@ FAM
1 HUSB @I4@
1 CHIL @I2@
0 @F3@ FAM
1 HUSB @I5@
1 CHIL @I3@
"""


class TestSharedSurnameLines(unittest.TestCase):
    """Two unrelated lines with one surname must not share a chapter line."""

    def test_second_line_is_named_for_its_founder(self):
        tree = fixture_tree(TWO_SAMPLE_LINES)
        table = tree.ahnentafel("root-kid")
        self.assertEqual(tree.line_of(2, table), "sample")
        self.assertEqual(tree.line_of(6, table), "sample-second-sample")
        self.assertEqual(tree.line_of(3, table), "sample-second-sample")


class TestDuplicateGuards(unittest.TestCase):
    """A duplicate FAMS must not print a family twice; a duplicate id must not hide a person."""

    def test_duplicate_fams_deduped(self):
        tree = fixture_tree("""0 @I1@ INDI
1 REFN a
2 TYPE jsonid
1 NAME A /A/
1 SEX M
1 FAMS @F1@
1 FAMS @F1@
0 @I2@ INDI
1 REFN b
2 TYPE jsonid
1 NAME B /B/
1 SEX F
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
""")
        self.assertEqual(len(tree.spouse_families(tree.by_refn["a"]["xref"])), 1)

    def test_duplicate_refn_raises(self):
        with self.assertRaises(ValueError):
            fixture_tree("""0 @I1@ INDI
1 REFN same
2 TYPE jsonid
1 NAME A /A/
0 @I2@ INDI
1 REFN same
2 TYPE jsonid
1 NAME B /B/
""")


class TestProcessInLabel(unittest.TestCase):
    """[PROCESS-IN-LABEL] class: acquisition/process text must not survive in
    citation labels (it renders verbatim in footnotes and the bibliography)."""

    def test_purchase_date_clause_flagged(self):
        self.assertIsNotNone(validate_mod.process_text_hit(
            "Parish register entry 4 (purchased own-provenance 2026-01-02) — text"))

    def test_bare_purchased_date_flagged(self):
        self.assertIsNotNone(validate_mod.process_text_hit(
            "Census 1851, page 2 (purchased 2026-01-02) — text"))

    def test_image_queued_flagged(self):
        self.assertIsNotNone(validate_mod.process_text_hit(
            "Marriage index — m. 1 Jun 1790 — index consulted 2026-01-02; image queued"))

    def test_archive_clause_masked(self):
        # provenance inside the stripped "image archived <path>" clause is allowed
        self.assertIsNone(validate_mod.process_text_hit(
            "Parish register entry 4 — quote — image archived images/a/x.jpg "
            "(own-provenance purchase 2026-01-02) — Example Archive"))

    def test_content_purchase_not_flagged(self):
        # deed-content "purchased" (no ISO date) is legitimate record content
        self.assertIsNone(validate_mod.process_text_hit(
            "Example County Registry of Deeds — John purchased 20 acres in 1882"))

    def test_finding_aid_flagged(self):
        self.assertIsNotNone(validate_mod.process_text_hit(
            'Death register, vol. 2 — "Tamar…"; locate by searching "Tamar"'))

    def test_access_date_not_flagged(self):
        self.assertIsNone(validate_mod.process_text_hit(
            "Marriage index — m. 1 Jun 1790 — index consulted 2026-01-02"))


class TestNewFamilyValidation(unittest.TestCase):
    """A new family's first check speaks of sources, not of one family's
    note format, and does not list every person import linked from a tree."""

    def test_unsourced_tree_links_are_counted_not_listed(self):
        tree = SMALL_TREE.replace("2 SOUR @S1@\n3 PAGE p. 4\n3 _KEY ada-birth\n", "").replace(
            "0 @S1@ SOUR\n1 TITL Example birth register\n",
            "0 @I2@ INDI\n1 REFN ben-example\n2 TYPE jsonid\n1 NAME Ben /Example/\n"
            "1 _CONFLEVEL memoir\n")
        with tempfile.TemporaryDirectory() as tmp:
            family = small_family(Path(tmp), tree=tree)
            self.assertEqual(run_script(family, "enrich-gedcom.py").returncode, 0)
            result = run_script(family, "validate-gedcom.py")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("[Source]", result.stdout)
        self.assertNotIn("ada-example", result.stdout)
        self.assertIn("1 person linked from another tree (tree-link) cites no source yet", result.stdout)
        self.assertIn("[NO-SOURCE] @I2@ (ben-example) Ben Example: confidence=memoir but no source "
                      "is cited", result.stdout)

    def test_a_failed_check_says_what_to_do_next(self):
        tree = SMALL_TREE.replace("1 _CONFLEVEL tree-link", "1 _CONFLEVEL primary").replace(
            "1 TITL Example birth register", "1 TITL Example family tree\n1 _TIER lead")
        with tempfile.TemporaryDirectory() as tmp:
            family = small_family(Path(tmp), tree=tree)
            self.assertEqual(run_script(family, "enrich-gedcom.py").returncode, 0)
            result = run_script(family, "validate-gedcom.py")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Fix the errors above, then run flyleaf book again.", result.stdout)
        self.assertNotIn("commit", result.stdout)


class TestStructuralValidator(unittest.TestCase):
    """Structural checks: family links that disagree, duplicate links and ids."""

    def test_chil_without_famc(self):
        errs, _ = validate_mod.structural_issues(
            "0 @I1@ INDI\n1 REFN a\n0 @F1@ FAM\n1 CHIL @I1@\n")
        self.assertTrue(any("S3-CHIL-NO-FAMC" in e for e in errs))

    def test_famc_without_chil(self):
        errs, _ = validate_mod.structural_issues(
            "0 @I1@ INDI\n1 REFN a\n1 FAMC @F1@\n0 @F1@ FAM\n1 HUSB @I9@\n")
        self.assertTrue(any("S3-FAMC-NO-CHIL" in e for e in errs))

    def test_family_citation_repeating_a_person_citation_is_caught(self):
        # The register prints a person's and their family's general
        # citations together; one source and page twice cannot be split.
        import tempfile
        ged = ("0 HEAD\n0 @I1@ INDI\n1 REFN a\n1 SOUR @S1@\n2 PAGE p. 1\n2 _KEY one\n"
               "1 FAMS @F1@\n0 @F1@ FAM\n1 HUSB @I1@\n1 NOTE Sons.\n2 SOUR @S1@\n"
               "3 PAGE p. 1\n3 _KEY two\n0 @S1@ SOUR\n1 TITL Paper\n0 TRLR\n")
        parser = validate_mod.Parser()
        parser.parse_file(str(fixture_file(ged, '.ged')), strict=False)
        roots = parser.get_root_child_elements()
        indi = next(e for e in roots if e.get_tag() == 'INDI')
        families = {e.get_pointer(): e for e in roots if e.get_tag() == 'FAM'}
        errs = validate_mod.citation_issues(indi, families, '@I1@')
        self.assertTrue(any('DUP-CITATION-USE' in e for e in errs))
        self.assertEqual(validate_mod.citation_issues(indi, {}, '@I1@'), [])

    def test_citation_with_two_keys_is_caught(self):
        # An insert between a citation's PAGE and its _KEY moves the key
        # onto the inserted citation; the misplaced key then names the
        # wrong source.
        bad = ("0 @I1@ INDI\n1 REFN a\n1 DEAT\n2 SOUR @S1@\n3 PAGE p. 1\n"
               "2 SOUR @S2@\n3 PAGE p. 2\n3 _KEY new\n3 _KEY old\n")
        errs, _ = validate_mod.structural_issues(bad)
        self.assertTrue(any("S7-MULTI-KEY" in e for e in errs))
        good = ("0 @I1@ INDI\n1 REFN a\n1 DEAT\n2 SOUR @S1@\n3 PAGE p. 1\n3 _KEY old\n"
                "2 SOUR @S2@\n3 PAGE p. 2\n3 _KEY new\n1 SOUR @S1@\n2 _KEY top\n")
        errs, _ = validate_mod.structural_issues(good)
        self.assertFalse(any("S7-MULTI-KEY" in e for e in errs))

    def test_duplicate_refn_detected(self):
        errs, _ = validate_mod.structural_issues(
            "0 @I1@ INDI\n1 REFN x\n2 TYPE jsonid\n0 @I2@ INDI\n1 REFN x\n2 TYPE jsonid\n")
        self.assertTrue(any("S1-DUP-REFN" in e for e in errs))

    def test_duplicate_fams_detected(self):
        errs, _ = validate_mod.structural_issues(
            "0 @I1@ INDI\n1 REFN a\n1 FAMS @F1@\n1 FAMS @F1@\n"
            "0 @F1@ FAM\n1 HUSB @I1@\n")
        self.assertTrue(any("S2-DUP-FAMS" in e for e in errs))

    def test_refn_charset(self):
        errs, _ = validate_mod.structural_issues(
            "0 @I1@ INDI\n1 REFN Bad Name!\n2 TYPE jsonid\n")
        self.assertTrue(any("S6-REFN-CHARSET" in e for e in errs))

    def test_other_programs_reference_numbers_are_not_flyleaf_ids(self):
        # A REFN without TYPE jsonid is another program's reference number:
        # it may repeat and use any characters. Flyleaf's ids are still checked.
        text = ("0 @I1@ INDI\n1 REFN Box 4, No. 12\n1 REFN ada\n2 TYPE jsonid\n"
                "0 @I2@ INDI\n1 REFN Box 4, No. 12\n2 TYPE user\n1 REFN ben\n2 TYPE jsonid\n")
        errs, _ = validate_mod.structural_issues(text)
        self.assertEqual([e for e in errs if "S1" in e or "S6" in e], [])
        errs, _ = validate_mod.structural_issues(text.replace("REFN ben", "REFN ada"))
        self.assertTrue(any("S1-DUP-REFN" in e and "'ada'" in e for e in errs), errs)


class TestLintIntegrity(unittest.TestCase):
    """A lint waiver is narrow: it never hides L3, never reaches the next
    paragraph and never hides a paragraph entirely."""

    def _lint(self, body, covers=("root-kid",)):
        tree = fixture_tree(MOTHER_ONLY)
        path = fixture_file("// ---\n// refn: root-kid\n// covers: [root-kid]\n// ---\n\n" + body,
                            ".typ")
        sec = {"path": path, "covers": list(covers)}
        return coverage_mod.lint_section(tree, sec)

    def test_l3_runs_under_suppression(self):
        findings = self._lint(
            "// cite-lint: ok — testing\nAn event happened in 1777 they say.\n")
        self.assertTrue(any("L3" in f and "1777" in f for f in findings),
                        f"L3 must fire under suppression; got {findings}")

    def test_suppression_does_not_bleed(self):
        body = ("// cite-lint: ok — first para only\nShort note from 1777.\n\n"
                + "A second paragraph. " * 12 + "It mentions the year 1778 too.\n")
        findings = self._lint(body)
        self.assertTrue(any("L1" in f or "L2" in f for f in findings),
                        f"second paragraph must still be style-linted; got {findings}")

    def test_attached_comment_still_lints_paragraph(self):
        body = "// a plain comment, no waiver\n" + ("Uncited words here. " * 35)
        findings = self._lint(body)
        self.assertTrue(any("L1" in f for f in findings),
                        f"comment-attached paragraph must not vanish; got {findings}")

    def test_certainty_language_flagged(self):
        findings = self._lint("This identification is a fact confirmed by tradition.\n")
        self.assertTrue(any("L15" in f for f in findings))

    def test_name_drift_flagged(self):
        # "Mothar" is one edit from person name "Mother" and nowhere in the GEDCOM
        findings = self._lint("The record names Mothar as the informant.\n")
        self.assertTrue(any("L16" in f and "Mothar" in f for f in findings),
                        f"drifted spelling must be flagged; got {findings}")

    def test_name_in_gedcom_text_not_flagged(self):
        # "Mother" appears in the GEDCOM (as a name) — exact spellings pass
        findings = self._lint("Her Mother appears in the census.\n")
        self.assertFalse(any("L16" in f for f in findings), findings)


class TestCitationKeyStability(unittest.TestCase):
    """Reordering sources must not change their keys."""

    def _keys(self, order):
        labels = [
            "Harbour Families of the Western Shore, a register of the first settlers Vol 17 Part 1",
            "Harbour Families of the Western Shore, a register of the first settlers Vol 17 Part 3",
        ]
        srcs = "".join(f"1 NOTE [Source] {labels[i]} — https://example.org/{i}\n" for i in order)
        tree = fixture_tree("0 @I1@ INDI\n1 REFN p\n2 TYPE jsonid\n1 NAME P /P/\n" + srcs)
        return tree.sources_by_person()["p"]

    def test_keys_stable_under_reorder(self):
        k1 = self._keys([0, 1])
        k2 = self._keys([1, 0])
        m1 = {v["label"]: k for k, v in k1.items()}
        m2 = {v["label"]: k for k, v in k2.items()}
        self.assertEqual(m1, m2, "keys must be content-derived, not order-derived")
        self.assertEqual(len(set(m1.values())), 2, "colliding labels must get distinct keys")


class TestShortFormNeverBareRepo(unittest.TestCase):
    """A repeat citation must never shorten to a bare repository name like
    "Ancestry." — it identifies nothing."""

    def test_repo_prefixed_label_keeps_content(self):
        m = booklib_module_assemble()
        a = m.Assembler.__new__(m.Assembler)
        a.src_keys = {"p": {"k": {"label": "Ancestry — 1870 US Census IMAGE, Example twp", "tier": "primary", "url": ""}}}
        rec = a.src_keys["p"]["k"]
        a.cited_full = {bookbib.identity(rec): "prose"}
        a.cited_uses = set()
        out = a.footnote_typ(["p"], "k")
        self.assertIn("1870 US Census", out)
        self.assertIn("Example twp", out)
        self.assertNotIn("Primary record", out)


class TestDisplayLabelStripsImageMarker(unittest.TestCase):
    """The internal IMAGE/IMAGES capture marker must not appear in reader-facing citations ("1910 US Census IMAGE" reads as
    clutter). display_label() strips it for footnotes/bibliography only —
    raw labels stay the identity for slugs and first-citation tracking."""

    def _dl(self, s):
        return booklib_module_assemble().display_label(s)

    def test_strips_plain_marker(self):
        self.assertEqual(self._dl("1910 US Census IMAGE — Example Twp"),
                         "1910 US Census — Example Twp")

    def test_strips_marker_with_colon(self):
        self.assertEqual(self._dl("Ancestry 1940 Census record — IMAGE: Example twp"),
                         "Ancestry 1940 Census record — Example twp")

    def test_strips_before_parenthetical(self):
        self.assertEqual(self._dl("1900 US Census IMAGE (Jory as infant) — ED 238"),
                         "1900 US Census (Jory as infant) — ED 238")

    def test_drops_image_archived_clause(self):
        self.assertEqual(self._dl("Find a Grave #1 — image archived images/x.jpg"),
                         "Find a Grave #1")

    def test_preserves_lowercase_image_mid_prose(self):
        s = "Find a Grave #1 — the image shows three children at the farm"
        self.assertEqual(self._dl(s), s)

    def test_preserves_words_containing_image(self):
        s = "Imagery Institute records — IMAGERY dept"
        self.assertEqual(self._dl(s), s)

    def test_strips_research_emphasis_asterisks(self):
        # GEDCOM **emphasis** typesets as literal \*\* in Typst — never display
        self.assertEqual(
            self._dl("1861 Census — **John Penhallow, BROTHER, 14** — via SP"),
            "1861 Census — John Penhallow, BROTHER, 14 — via SP")

    def test_scrubs_surviving_repo_path(self):
        # When enrich eats an archive clause's em-dash, "member-share copy also
        # held images/…jpg" glues onto the citation text. A bare repo path
        # must never reach print, whatever clause it rides in.
        self.assertEqual(
            self._dl("Census 1841 — page 6 member-share copy also held images/a/x.jpg"),
            "Census 1841 — page 6")

    def test_scrubs_bare_path_without_leadin(self):
        self.assertEqual(
            self._dl("Find a Grave #1 — see images/web-sources/fg.pdf for detail"),
            "Find a Grave #1 — see for detail")


class TestEnrichArchiveClauseStrip(unittest.TestCase):
    """Enrich strips archive clauses from [Source] labels; a trailing
    member-share path segment must go with them."""

    def _label(self, text):
        _, _, _, src = enrich_mod.parse_note(text)
        return src["label"]

    def test_consumes_member_share_tail(self):
        self.assertEqual(
            self._label("[Source] Census 1841 IMAGE — page 6 — Example Archive — image archived "
                        "images/a/a.jpg; member-share copy also held images/a/b.jpg"),
            "Census 1841 IMAGE — page 6 — Example Archive")

    def test_plain_archive_clause_still_stripped(self):
        self.assertEqual(
            self._label("[Source] Find a Grave #1 — image archived images/x.jpg"),
            "Find a Grave #1")


class TestDisplayLabelDropsClauses(unittest.TestCase):
    """display_label() clause-level stripping (paths, QA notes, URLs)."""

    def _dl(self, s):
        return booklib_module_assemble().display_label(s)

    def test_drops_bare_path_clause(self):
        self.assertEqual(
            self._dl("Death register 1872, entry 12 — father Peder Example — images/a/1872-x.pdf — Example Archive"),
            "Death register 1872, entry 12 — father Peder Example — Example Archive")

    def test_drops_archive_and_qa_clauses(self):
        self.assertEqual(
            self._dl('Example Surnames (1931), p. 2 IMAGE (Penrose entry) — "PENROSE…" — full page image archived images/a/p2.jpg — VERIFIED against the actual page 2026-01-02'),
            'Example Surnames (1931), p. 2 (Penrose entry) — "PENROSE…"')

    def test_never_drops_first_clause(self):
        # pathological label whose first clause looks like a path: keep it
        self.assertEqual(self._dl("images/foo.jpg — Ancestry"), "images/foo.jpg — Ancestry")

    def test_drops_bare_url_clause_and_scan_archived(self):
        self.assertEqual(
            self._dl("Births of Example, vol. 3 — https://archive.org/details/x — original scan archived images/a/x.pdf"),
            "Births of Example, vol. 3")

    def test_scrubs_uploader_usernames(self):
        # Pseudonymous Ancestry handles never display; real-name credits
        # (photographers, institutions) are untouched.
        self.assertEqual(
            self._dl('Member photo (user Examplefan_1) — a print'),
            'Member photo (member-contributed) — a print')
        out = self._dl('Gravestone photograph (by Alice Example; shared on Ancestry by member Exampleuser 2021)')
        self.assertNotIn('Exampleuser', out)
        self.assertIn('Alice Example', out)

    def test_scrubs_inline_urls(self):
        self.assertEqual(
            self._dl("WikiTree Penhallow-41 (b. 19 Oct 1887, see https://www.wikitree.com/wiki/Penhallow-41) — details"),
            "WikiTree Penhallow-41 (b. 19 Oct 1887, see) — details")
        # emptied parenthetical vanishes entirely
        self.assertEqual(self._dl("Find a Grave #1 (https://findagrave.com/x) — detail"),
                         "Find a Grave #1 — detail")



class TestShortFormCarriesSpecificLocator(unittest.TestCase):
    """Do not guess where an unstructured citation's identifying detail ends."""

    def _short(self, label, short=None):
        m = booklib_module_assemble()
        a = m.Assembler.__new__(m.Assembler)
        a.src_keys = {"p": {"k": {"label": label, "short": short, "tier": "primary", "url": ""}}}
        a.cited_full = {bookbib.identity(a.src_keys["p"]["k"]): "prose"}
        a.cited_uses = set()
        return a.footnote_typ(["p"], "k")

    def test_generic_collection_absorbs_person_clause(self):
        out = self._short("Marriage index — Ada Example m. 1921 — via collection 1")
        self.assertIn("Ada Example", out)

    def test_explicit_short_title_is_used(self):
        out = self._short("Find a Grave #100000001 (Jory Penhallow) — https://x — details",
                          short="Find a Grave #100000001 (Jory Penhallow)")
        self.assertIn("#100000001", out)
        self.assertNotIn("details", out)

    def test_late_locator_and_qualification_survive_uncurated_repeat(self):
        label = ("A long collection title with a person's name and a date, 1900 — "
                 "volume 31, page 207, entry 46 — transcription only; original not seen")
        out = self._short(label)
        self.assertIn("volume 31, page 207, entry 46", out)
        self.assertIn("transcription only; original not seen", out)


class TestRelationTagline(unittest.TestCase):
    """Every narrative heading carries a plain-English relation to the
    book's subjects; names must keep their capitals."""

    def _tag(self, ahn, covers, sex):
        assemble = booklib_module_assemble()
        return assemble.relation_tagline(ahn, covers, sex)

    def test_phrases(self):
        assemble = booklib_module_assemble()
        f = assemble.relation_tagline
        with patch.object(assemble, "SUBJECTS", "Ada, Ben, and Cora"):
            self.assertIsNone(f([1], 1, "F"))
            self.assertEqual(f([2], 1, "M"), "Father of Ada, Ben, and Cora")
            self.assertEqual(f([10], 2, "M"),
                             "Paternal great-grandparents of Ada, Ben, and Cora")
            self.assertEqual(f([11], 1, "F"),
                             "Paternal great-grandmother of Ada, Ben, and Cora")
            self.assertEqual(f([12], 2, "M"),
                             "Maternal great-grandparents of Ada, Ben, and Cora")
            self.assertEqual(f([80], 2, "M"),
                             "Paternal fourth great-grandparents of Ada, Ben, and Cora")
            # The names keep their capitals.
            self.assertIn("Ada, Ben, and Cora", f([40], 2, "M"))


def booklib_module_assemble():
    import importlib.util, pathlib
    p = HERE / "book-assemble.py"
    spec = importlib.util.spec_from_file_location("book_assemble_t", p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class TestArchiveClauseStripping(unittest.TestCase):
    """Wiring an archive path into a [Source] line must never change the label-derived slug, whatever qualifier the clause
    uses (image/images/text/cert image/whole source/page images/RE-CAPTURED)."""

    BASE = "Marriage certificate 1916-0001 — https://example.org/x"

    def _key(self, line):
        tree = fixture_tree(
            "0 @I1@ INDI\n1 REFN p\n2 TYPE jsonid\n1 NAME P /P/\n"
            f"1 NOTE [Source] {line}\n")
        return list(tree.sources_by_person()["p"].keys())[0]

    def test_status_annotations_strip(self):
        want = self._key(self.BASE)
        for clause in [
            " — [DEAD 2026-01-02: page gone]",
            " ; [WALLED 2026-01-02: sign-in needed]",
            " — [CAPTURE-PENDING 2026-01-02]",
        ]:
            got = self._key(self.BASE + clause)
            self.assertEqual(got, want, f"slug changed by annotation {clause!r}")

    def test_all_archive_clause_forms_strip(self):
        want = self._key(self.BASE)
        for clause in [
            " — archived images/a/b.pdf",
            " — image archived images/a/b.jpg",
            " — images archived images/a/b.jpg + images/a/c.jpg",
            " — text archived images/a/b.txt",
            " — cert image archived images/a/b.pdf",
            " — whole source archived images/a/b.txt + images/a/b.epub",
            " — page images archived images/a/b.jpg",
        ]:
            got = self._key(self.BASE + clause)
            self.assertEqual(got, want, f"slug changed by clause {clause!r}")


class TestIndexSortKey(unittest.TestCase):
    """Index filing: Mc interfiles with Mac, and diacritics are ignored."""

    def test_mc_interfiles_with_mac(self):
        k = assemble_mod.index_sort_key
        self.assertEqual(k("McAlister"), "macalister")
        # interfiled: McAlister sorts inside the Mac- block, before Madison
        self.assertTrue(k("McAlister") < k("MacBride") < k("Madison"))

    def test_diacritics_stripped(self):
        self.assertEqual(assemble_mod.index_sort_key("Penhallòw"),
                         assemble_mod.index_sort_key("Penhallow"))


class TestNamesInEveryAlphabet(unittest.TestCase):
    """Ids and the index handle names beyond plain English: accents fold,
    other alphabets keep distinct ids, and a missing surname reads well."""

    def test_line_ids_fold_accents_and_keep_other_alphabets_apart(self):
        self.assertEqual(booklib.line_slug("Müller"), "muller")
        self.assertEqual(booklib.line_slug("Ó Súilleabháin"), "o-suilleabhain")
        self.assertEqual(booklib.line_slug("Παπαδόπουλος"), "papadopoulos")
        self.assertEqual(booklib.line_slug("Шевченко"), "shevchenko")
        others = {booklib.line_slug(name) for name in ("王", "李", "Ἀθανάσιος", "Иванов")}
        self.assertEqual(len(others), 4)
        self.assertTrue(all(assemble_mod.LABEL_SAFE.fullmatch(i) for i in others), others)

    def test_source_keys_keep_their_form(self):
        # Stories cite [Source] notes by these keys; folding would rename them.
        self.assertEqual(booklib.slugify("Kirchenbuch Müllheim"), "kirchenbuch-m-llheim")

    def index(self, people):
        a = assemble_mod.Assembler.__new__(assemble_mod.Assembler)
        a.table, a.index, a.indexed_people = {}, {}, {}
        a.tree = SimpleNamespace(by_xref={}, spouse_families=lambda x: [])
        for i, (given, surname) in enumerate(people):
            person = {'xref': f'@I{i}@', 'given': given, 'surname': surname, 'sex': 'M'}
            a.tree.by_xref[person['xref']] = person
            a.add_index(person, str(i + 2))
        return a.name_index()

    def test_index_heads_by_the_folded_letter_and_lists_given_names_alone(self):
        out = self.index([("Ann", "Ó Briain"), ("Tom", "Oakes"), ("Sarah", ""), ("Ruth", "")])
        self.assertEqual(re.findall(r"^\*(.+)\* \\$", out, re.M), ["Surname not recorded", "O"])
        self.assertLess(out.index("\nRuth — 5 \\"), out.index("\nSarah — 4 \\"))
        self.assertLess(out.index("\nSarah — 4 \\"), out.index("*O*"))
        self.assertNotIn(", Sarah", out)
        self.assertIn("Ó Briain, Ann — 2", out)


class TestUnresolvedReferencesFatal(unittest.TestCase):
    """A #src, #fig or #refp that names nothing would silently drop a
    footnote, picture or link, so assembly stops instead."""

    def test_a_citation_that_names_no_source_stops_assembly(self):
        for call, said in (('#src("no-such-source")', 'matches no source'),
                           ('#refp("no-such-person")', 'unknown refn'),
                           ('#fig("photographs/missing.jpg")', 'not found')):
            with self.subTest(call=call), tempfile.TemporaryDirectory() as tmp:
                family = small_family(Path(tmp), story=f"Ada was born in 1990.{call}\n")
                out = family / "build" / "assembled.typ"
                result = run_script(family, "book-assemble.py", "--out", str(out))
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertIn(said, result.stderr)
                self.assertIn("book-assemble: 1 unresolved", result.stderr)
                ok = small_family(Path(tmp) / "fine", story="Ada was born in 1990.#src(\"ada-birth\")\n")
                self.assertEqual(run_script(ok, "book-assemble.py", "--out", str(out)).returncode, 0)


class TestShortFormCitations(unittest.TestCase):
    """A full first citation, then a short form and cross-reference on
    register repeats — never a full duplicate."""

    def test_repeat_gets_short_form(self):
        class FakeAsm:
            src_keys = {"p": {"k1": {"label": "1900 US Census, Example twp — ED 291",
                                     "tier": "primary", "url": None}}}
            cited_full = {}
            cited_uses = set()
        asm = FakeAsm()
        first = assemble_mod.Assembler.footnote_typ(asm, ["p"], "k1", reg_no=4)
        again = assemble_mod.Assembler.footnote_typ(asm, ["p"], "k1", reg_no=8)
        self.assertIn("1900 US Census", first)
        self.assertIn("ED 291", first)
        self.assertIn("cited in full at no. 4", again)
        self.assertIn("ED 291", again)

    def test_consecutive_same_entry_repeat_coalesces(self):
        # Five consecutive identical footnotes in one register entry are
        # citation spam: a run cites once.
        class FakeAsm:
            src_keys = {"p": {"k1": {"label": "Some Source", "tier": "primary",
                                     "url": None}}}
            cited_full = {}
            cited_uses = set()
        asm = FakeAsm()
        a = assemble_mod.Assembler.footnote_typ(asm, ["p"], "k1", reg_no=4)
        b = assemble_mod.Assembler.footnote_typ(asm, ["p"], "k1", reg_no=4)
        self.assertIn("Some Source", a)
        self.assertEqual(b, "")

    def test_nonconsecutive_same_entry_repeat_shortens_without_self_reference(self):
        # An intervening citation breaks the run. Repeat the anchor using a
        # short title; avoid both a full duplicate and a self cross-reference.
        class FakeAsm:
            src_keys = {"p": {"k1": {"label": "Some Source", "tier": "primary", "url": None},
                              "k2": {"label": "Other Source 1900", "tier": "primary", "url": None}}}
            cited_full = {}
            cited_uses = set()
        asm = FakeAsm()
        a = assemble_mod.Assembler.footnote_typ(asm, ["p"], "k1", reg_no=4)
        assemble_mod.Assembler.footnote_typ(asm, ["p"], "k2", reg_no=4)
        b = assemble_mod.Assembler.footnote_typ(asm, ["p"], "k1", reg_no=4)
        self.assertIn('Primary record', a)
        self.assertIn('Some Source', b)
        self.assertNotIn('Primary record', b)
        self.assertNotIn('cited in full', b)

    def test_prose_repeat_gets_short_form_without_crossref(self):
        # Book-wide full-then-short: a non-consecutive prose repeat
        # shortens but does not cross-reference a register number.
        class FakeAsm:
            src_keys = {"p": {"k1": {"label": "Some Source — https://x", "tier": "primary",
                                     "url": None},
                              "k2": {"label": "Other Source 1900", "tier": "primary",
                                     "url": None}}}
            cited_full = {}
            cited_uses = set()
        asm = FakeAsm()
        first = assemble_mod.Assembler.footnote_typ(asm, ["p"], "k1")
        assemble_mod.Assembler.footnote_typ(asm, ["p"], "k2")
        again = assemble_mod.Assembler.footnote_typ(asm, ["p"], "k1")
        # Raw URLs never display, even in the full form.
        self.assertNotIn("https", first)
        self.assertIn("Primary record", first)   # full form carries the tier
        self.assertNotIn("https", again)
        self.assertNotIn("Primary record", again)  # short form does not
        self.assertNotIn("cited in full at no", again)
        self.assertIn("Some Source", again)


class TestEscaping(unittest.TestCase):
    """Leading structural tokens must not become Typst syntax."""

    def test_leading_tokens_escaped(self):
        for bad in ("= Heading", "- item", "+ item", "/ term"):
            out = assemble_mod.esc(bad)
            self.assertTrue(out.startswith("\\"), f"{bad!r} -> {out!r}")

    def test_comment_and_specials(self):
        self.assertNotIn("//", assemble_mod.esc("http://x//y").replace("\\/", ""))
        self.assertIn("\\~", assemble_mod.esc("a~b"))


class TestPlacePhrase(unittest.TestCase):
    """G3 companion: '(likely)' in PLAC is data, not commentary — it must
    render Register-style, never print verbatim."""

    def test_uncertainty_qualifier_rendered(self):
        out = assemble_mod.place_phrase("Example County, New York (likely)")
        self.assertEqual(out, "probably in Example County, New York")

    def test_possibly_kept_verbatim(self):
        out = assemble_mod.place_phrase("Penryn, New York (possibly)")
        self.assertTrue(out.startswith("possibly at "))

    def test_plain_place_unchanged(self):
        self.assertEqual(assemble_mod.place_phrase("Kirkton, Fife, Scotland"),
                         "at Kirkton, Fife, Scotland")

    def test_a_place_of_one_part_is_a_region_only_when_it_names_one(self):
        for place in ("Norway", "Canada", "Germany", "Wales", "New South Wales", "Bavaria",
                      "France (likely Toulouse)", "USA (army service)", "Plymouth Colony"):
            with self.subTest(place=place):
                self.assertEqual(assemble_mod.at_or_in(place), "in")
        # A town or a cemetery recorded on its own keeps "at".
        for place in ("Bergen, Norway", "Halifax, Nova Scotia, Canada", "Mainz, Germany",
                      "Penryn", "Orchard Hill Cemetery", "Old burying ground"):
            with self.subTest(place=place):
                self.assertEqual(assemble_mod.at_or_in(place), "at")

    def test_a_familys_region_names_take_in(self):
        real = booklib.flyleaf_settings.get
        with patch.object(booklib.flyleaf_settings, 'get', side_effect=lambda key, default=None:
                          ['Bavaria'] if key == 'places.region_names' else real(key, default)):
            module = load('book-assemble.py', 'ba_regions')
        self.assertEqual(module.at_or_in("Bavaria, Germany"), "in")
        self.assertEqual(module.at_or_in("Munich, Bavaria, Germany"), "at")


class TestPersonHashLiveness(unittest.TestCase):
    """If person_hash compared @X@-form xrefs against bare block ids, every
    hash would be sha256("")[:12] and the stale detector could never fire.
    Hashes must be non-degenerate and must react to both INDI and FAM edits."""

    EMPTY = "e3b0c44298fc"  # sha256("")[:12]

    BASE = """0 @I1@ INDI
1 REFN subject
2 TYPE jsonid
1 NAME Subject /Person/
1 SEX M
1 NOTE bio v1
1 FAMS @F1@
0 @I2@ INDI
1 REFN wife
2 TYPE jsonid
1 NAME Wife /Person/
1 SEX F
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1 JAN 1900
"""

    def test_hash_not_degenerate_and_distinct(self):
        tree = fixture_tree(self.BASE)
        h_subj, h_wife = tree.person_hash("subject"), tree.person_hash("wife")
        self.assertNotEqual(h_subj, self.EMPTY, "person_hash degenerated to sha256('') — inert staleness")
        self.assertNotEqual(h_wife, self.EMPTY)

    def test_hash_reacts_to_indi_and_fam_edits(self):
        h1 = fixture_tree(self.BASE).person_hash("subject")
        h2 = fixture_tree(self.BASE.replace("bio v1", "bio v2")).person_hash("subject")
        h3 = fixture_tree(self.BASE.replace("1 JAN 1900", "2 JAN 1900")).person_hash("subject")
        self.assertNotEqual(h1, h2, "INDI edit must change person_hash")
        self.assertNotEqual(h1, h3, "FAM edit must change person_hash")

    def test_live_tree_hashes_not_degenerate(self):
        tree = booklib.Tree()
        for refn in (booklib.root_refn(booklib.load_book_yaml()),):
            self.assertNotEqual(tree.person_hash(refn), self.EMPTY)


class TestEnrichmentPreservation(unittest.TestCase):
    """FE-011: export must retain source facts, not recreate a small whitelist."""

    @staticmethod
    def parse(text):
        from io import BytesIO
        parser = enrich_mod.Parser()
        parser.parse(BytesIO(text.encode('utf-8')), strict=False)
        return parser

    def export(self, text):
        from contextlib import redirect_stdout
        from io import StringIO
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = (Path(tmp) / n for n in ('src.ged', 'out.ged'))
            src.write_text(text)
            with patch.multiple(enrich_mod, INPUT_GED=src, OUTPUT_GED=dst), \
                    redirect_stdout(StringIO()):
                enrich_mod.main()
            return dst.read_text()

    @staticmethod
    def record(parser, pointer):
        return next(e for e in parser.get_root_child_elements()
                    if e.get_pointer() == pointer)

    @staticmethod
    def children(element, tag):
        return [c for c in element.get_child_elements() if c.get_tag() == tag]

    @classmethod
    def signature(cls, element):
        return (element.get_tag(), element.get_pointer(), element.get_multi_line_value(),
                tuple(cls.signature(c) for c in element.get_child_elements()
                      if c.get_tag() not in ('CONC', 'CONT')))

    BASE = '''0 HEAD
1 CHAR UTF-8
1 SUBM @U1@
1 NOTE Export header provenance
0 @U1@ SUBM
1 NAME Original Contributor
0 @I1@ INDI
1 REFN example
2 TYPE jsonid
1 NAME Recorded /Person/
2 NICK Nickname
1 NAME Alternate /Spelling/
1 BIRT Y
2 DATE ABT 1900
2 PLAC Recorded birthplace
2 SOUR @S001@
3 PAGE entry 4
3 DATA
4 TEXT First part
5 CONC joined
5 CONT Next line
1 DEAT Y
2 DATE BEF 1980
2 CAUS Recorded cause
1 BURI
2 DATE 1 JAN 1980
2 PLAC Recorded cemetery
2 NOTE Plot A
1 BAPM
2 DATE 1901
1 RESI
2 DATE 1920
2 PLAC First residence
1 RESI
2 DATE 1930
2 PLAC Second residence
1 EDUC School
1 OCCU Teacher
1 _CUSTOM Retain this too
2 NOTE A nested extension
1 OBJE
2 FILE images/example.jpg
3 FORM jpg
2 TITL A photograph
1 OBJE @M001@
1 FAMC @F1@
2 PEDI adopted
1 FAMC @F2@
2 PEDI birth
1 NOTE First line
2 CONC joined
2 CONT Second line
2 SOUR @S001@
1 NOTE [Notes] Analysis first line
2 CONT Analysis second line
1 NOTE Buried Wrong cemetery. [Confidence] tree-link
1 NOTE [Source] Find a Grave memorial fixture — https://www.findagrave.com/memorial/1
1 NOTE [Source] 1920 US Census — Detected place
1 NOTE [Source] A death certificate
0 @F1@ FAM
1 CHIL @I1@
1 MARR
2 DATE 1 JAN 1899
2 PLAC Marriage place
2 SOUR @S001@
3 PAGE 17
1 DIV
2 DATE 1905
1 NOTE Family note
2 CONT With a new line
1 OBJE @M001@
0 @F2@ FAM
1 CHIL @I1@
0 @S001@ SOUR
1 TITL Original source
1 REPO @R001@
2 CALN Original call number
0 @R001@ REPO
1 NAME Original repository
0 @M001@ OBJE
1 FILE images/original.pdf
2 FORM pdf
2 TITL Original object
0 TRLR
'''

    def test_family_records_preserved_with_nested_events_and_notes(self):
        before, after = self.parse(self.BASE), self.parse(self.export(self.BASE))
        for pointer in ('@F1@', '@F2@'):
            self.assertEqual(self.signature(self.record(before, pointer)),
                             self.signature(self.record(after, pointer)))

    def test_structured_fields_and_nested_event_details_survive(self):
        before, after = self.parse(self.BASE), self.parse(self.export(self.BASE))
        original = self.record(before, '@I1@')
        exported = self.record(after, '@I1@')
        for child in original.get_child_elements():
            if child.get_tag() in ('NOTE', 'BIRT', 'DEAT', 'BURI'):
                continue
            self.assertIn(self.signature(child),
                          [self.signature(c) for c in exported.get_child_elements()])
        for tag in ('BIRT', 'DEAT', 'BURI'):
            old, = self.children(original, tag)
            new, = self.children(exported, tag)
            self.assertEqual(old.get_value(), new.get_value())
            for child in old.get_child_elements():
                self.assertIn(self.signature(child),
                              [self.signature(c) for c in new.get_child_elements()])
        self.assertNotIn('2 PLAC Wrong cemetery', self.export(self.BASE))

    def test_notes_preserve_continuations_and_their_own_citations(self):
        output = self.parse(self.export(self.BASE))
        notes = self.children(self.record(output, '@I1@'), 'NOTE')
        first = next(n for n in notes if n.get_multi_line_value().startswith('First line'))
        self.assertEqual(first.get_multi_line_value(), 'First linejoined\nSecond line')
        self.assertEqual(self.children(first, 'SOUR')[0].get_value(), '@S001@')
        self.assertTrue(any(n.get_multi_line_value() == 'Analysis first line\nAnalysis second line'
                            for n in notes))

    def test_referenced_records_and_original_ids_survive_generated_collisions(self):
        output = self.parse(self.export(self.BASE))
        original = self.parse(self.BASE)
        for pointer in ('@S001@', '@R001@', '@M001@', '@U1@'):
            self.assertEqual(self.signature(self.record(original, pointer)),
                             self.signature(self.record(output, pointer)))
        ids = [e.get_pointer() for e in output.get_root_child_elements() if e.get_pointer()]
        self.assertEqual(len(ids), len(set(ids)), 'generated IDs collided with source records')
        for element in output.get_element_list():
            if re.fullmatch(r'@[^@]+@', element.get_value()):
                self.assertIn(element.get_value(), ids, 'export created a dangling reference')

    def test_explicit_census_and_service_suppress_heuristic_duplicates(self):
        text = self.BASE.replace('1 _CUSTOM Retain this too', '''1 CENS
2 DATE 1920
2 PLAC Recorded census place
1 MILI
2 DATE FROM 1862 TO 1865
2 NOTE Recorded service
1 NOTE Mustered in 14 Aug 1862 at Camp Example; mustered out 27 Jun 1865.
1 _CUSTOM Retain this too''')
        original, output = self.parse(text), self.parse(self.export(text))
        for tag in ('CENS', 'MILI'):
            self.assertEqual([self.signature(e) for e in self.children(self.record(original, '@I1@'), tag)],
                             [self.signature(e) for e in self.children(self.record(output, '@I1@'), tag)])

    def test_repeated_vital_events_are_not_collapsed_or_guessed_between(self):
        text = self.BASE.replace('1 DEAT Y', '1 BIRT\n2 DATE 1902\n2 PLAC Alternative birthplace\n1 DEAT Y')
        original, output = self.parse(text), self.parse(self.export(text))
        self.assertEqual([self.signature(e) for e in self.children(self.record(original, '@I1@'), 'BIRT')],
                         [self.signature(e) for e in self.children(self.record(output, '@I1@'), 'BIRT')])

    def test_native_media_and_links_pass_through_once(self):
        # Media lives in the source GEDCOM; enrichment never adds or merges it.
        original, output = self.parse(self.BASE), self.parse(self.export(self.BASE))
        media = [e for e in output.get_root_child_elements() if e.get_tag() == 'OBJE']
        self.assertEqual(len(media), 1)
        self.assertEqual(self.signature(self.record(original, '@M001@')),
                         self.signature(media[0]))
        links = [c.get_value() for c in self.children(self.record(output, '@I1@'), 'OBJE')]
        self.assertEqual(links.count('@M001@'),
                         [c.get_value() for c in self.children(self.record(original, '@I1@'), 'OBJE')].count('@M001@'))

    def test_structured_marker_note_keeps_its_metadata(self):
        text = self.BASE.replace('1 NOTE First line', '1 NOTE [Source] Structured note')
        original, output = self.parse(text), self.parse(self.export(text))
        note = next(n for n in self.children(self.record(original, '@I1@'), 'NOTE')
                    if n.get_value().startswith('[Source] Structured'))
        self.assertIn(self.signature(note),
                      [self.signature(n) for n in self.children(self.record(output, '@I1@'), 'NOTE')])

    def test_declared_source_note_media_preserves_citation_and_repeated_export(self):
        label = '[Source] Find a Grave memorial fixture — https://www.findagrave.com/memorial/1'
        updated = self.BASE.replace('1 NOTE ' + label, '1 NOTE ' + label + '\n2 OBJE @M001@')
        before = enrich_mod.collect_individual_data(self.parse(self.BASE))[0]
        after = enrich_mod.collect_individual_data(self.parse(updated))[0]
        first = next(p for p in before if p['xref'] == '@I1@')
        second = next(p for p in after if p['xref'] == '@I1@')
        self.assertEqual(first['bio'], second['bio'])
        for field in ('label', 'url', 'raw_notes'):
            self.assertEqual(first['sources'][0][field], second['sources'][0][field])
        self.assertEqual(second['sources'][0]['paths'], ['images/original.pdf'])
        once = self.export(updated)
        twice = self.export(once)
        for result in (once, twice):
            people = enrich_mod.collect_individual_data(self.parse(result))[0]
            person = next(p for p in people if p['xref'] == '@I1@')
            matches = [s for s in person['sources'] if s['label'] == first['sources'][0]['label']]
            self.assertEqual(len(matches), 1)
            self.assertEqual(matches[0]['paths'], ['images/original.pdf'])
            self.assertNotIn(label, person['bio'] or '')
        broken = updated.replace('2 OBJE @M001@', '2 OBJE @ABSENT@')
        with self.assertRaisesRegex(ValueError, 'missing OBJE'):
            enrich_mod.collect_individual_data(self.parse(broken))

    def test_long_recorded_notes_wrap_without_losing_text_or_paragraphs(self):
        text = self.BASE.replace('1 NOTE Family note',
                                 '1 NOTE ' + ('Unabridged recorded detail; ' * 80))
        exported = self.export(text)
        self.assertTrue(all(len(line) <= 255 for line in exported.splitlines()))
        self.assertEqual(self.signature(self.record(self.parse(text), '@F1@')),
                         self.signature(self.record(self.parse(exported), '@F1@')))

    def test_header_metadata_and_generated_submitter_collision(self):
        text = self.BASE.replace('1 SUBM @U1@\n', '').replace('@U1@', '@SUB001@')
        output = self.parse(self.export(text))
        header, = [e for e in output.get_root_child_elements() if e.get_tag() == 'HEAD']
        self.assertEqual(self.children(header, 'NOTE')[0].get_value(), 'Export header provenance')
        link, = self.children(header, 'SUBM')
        self.assertNotEqual(link.get_value(), '@SUB001@')
        self.assertEqual(self.record(output, link.get_value()).get_tag(), 'SUBM')
        self.assertEqual(self.record(output, '@SUB001@').get_tag(), 'SUBM')

    def test_repeated_export_does_not_multiply_records_or_events(self):
        once = self.parse(self.export(self.BASE))
        twice = self.parse(self.export(self.export(self.BASE)))
        for pointer in ('@I1@', '@F1@', '@F2@', '@S001@', '@M001@', '@U1@'):
            from collections import Counter
            self.assertEqual(Counter(self.signature(c) for c in self.record(once, pointer).get_child_elements()),
                             Counter(self.signature(c) for c in self.record(twice, pointer).get_child_elements()))

    def test_real_source_structured_content_is_preserved(self):
        from collections import Counter
        text = booklib.SRC_GED.read_text()
        original, output = self.parse(text), self.parse(self.export(text))

        def paths(element, prefix=()):
            node = prefix + ((element.get_tag(), element.get_pointer(), element.get_multi_line_value()),)
            yield node
            for child in element.get_child_elements():
                if child.get_tag() not in ('CONC', 'CONT'):
                    yield from paths(child, node)

        for record in original.get_root_child_elements():
            if record.get_tag() not in ('INDI', 'FAM'):
                continue
            exported = self.record(output, record.get_pointer())
            for child in record.get_child_elements():
                if record.get_tag() == 'INDI' and child.get_tag() == 'NOTE':
                    continue  # marker conversion has dedicated tests above
                expected = Counter(paths(child))
                actual = Counter(p for c in exported.get_child_elements() for p in paths(c))
                self.assertFalse(expected - actual,
                                 f'{record.get_pointer()} lost {child.get_tag()} structure')

    def test_physical_line_endings_keep_every_record_and_event(self):
        expected = self.parse(self.export(self.BASE))
        for ending in ('\n', '\r\n', '\r'):
            for terminated in (True, False):
                with self.subTest(ending=repr(ending), terminated=terminated):
                    text = self.BASE.replace('\n', ending)
                    if not terminated:
                        text = text.removesuffix(ending)
                    actual = self.parse(self.export(text))
                    self.assertEqual(
                        [self.signature(e) for e in expected.get_root_child_elements()],
                        [self.signature(e) for e in actual.get_root_child_elements()])

    def test_invalid_input_does_not_overwrite_previous_export(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp) / 'src.ged', Path(tmp) / 'out.ged'
            src.write_text(self.BASE.replace('1 BIRT Y', 'INVALID RECORD LINE'))
            dst.write_bytes(b'previous verified export')
            with patch.multiple(enrich_mod, INPUT_GED=src, OUTPUT_GED=dst):
                with self.assertRaises(Exception):
                    enrich_mod.main()
            self.assertEqual(dst.read_bytes(), b'previous verified export')

    def test_unicode_separators_remain_inside_recorded_values(self):
        for separator in ('\u2028', '\u2029', '\x85'):
            with self.subTest(separator=repr(separator)):
                text = self.BASE.replace('1 _CUSTOM Retain this too',
                                         '1 _CUSTOM Alpha' + separator + 'Beta')
                actual = self.parse(self.export(text))
                value, = self.children(self.record(actual, '@I1@'), '_CUSTOM')
                self.assertEqual(value.get_value(), 'Alpha' + separator + 'Beta')

    def test_malformed_generated_output_preserves_previous_export(self):
        from contextlib import redirect_stdout
        from io import StringIO
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp) / 'src.ged', Path(tmp) / 'out.ged'
            src.write_text(self.BASE)
            dst.write_bytes(b'previous verified export')
            with patch.multiple(enrich_mod, INPUT_GED=src, OUTPUT_GED=dst), \
                    patch.object(enrich_mod, 'build_enriched_gedcom',
                                 return_value='0 HEAD\nINVALID RECORD LINE\n0 TRLR\n'), \
                    redirect_stdout(StringIO()):
                with self.assertRaises(Exception):
                    enrich_mod.main()
            self.assertEqual(dst.read_bytes(), b'previous verified export')

    def test_continuation_children_keep_their_original_attachment(self):
        for marker in ('', '[Notes] ', '[Source] '):
            for continuation in ('CONC', 'CONT'):
                with self.subTest(marker=marker, continuation=continuation):
                    note = (f'1 NOTE {marker}First part\n2 {continuation} second part\n'
                            '3 _PROVENANCE Recorded context\n4 NOTE Nested assessment')
                    text = self.BASE.replace('1 _CUSTOM Retain this too', note)
                    actual = self.parse(self.export(text))
                    original = self.parse(text)
                    expected = next(n for n in self.children(self.record(original, '@I1@'), 'NOTE')
                                    if n.get_value() == marker + 'First part')
                    found = next(n for n in self.children(self.record(actual, '@I1@'), 'NOTE')
                                 if n.get_value() == marker + 'First part')
                    # Inspect CONT/CONC and its descendants explicitly; the
                    # ordinary text signature intentionally normalizes wrapping.
                    def raw_tree(node):
                        return (node.get_tag(), node.get_value(),
                                tuple(raw_tree(c) for c in node.get_child_elements()))
                    self.assertEqual(raw_tree(found), raw_tree(expected))

    def test_legacy_titles_cannot_invent_source_provenance(self):
        labels = [
            'Harbour Families Vol 17 (HFSOC) — standard reference',
            'Sample Genealogy — compiled secondary',
            'Ezra Example 1903', 'Silas Sample', 'Penhallow Genealogy',
            'Find a Grave memorial transcript', 'FamilySearch tree printout',
            'Ancestry 1930 US Census — https://www.ancestry.com/record/1',
        ]
        for label in labels:
            with self.subTest(label=label):
                text = '0 @I1@ INDI\n1 NAME Test /Person/\n1 NOTE [Source] ' + label + '\n0 TRLR\n'
                actual = self.parse(self.export(text))
                source, = [e for e in actual.get_root_child_elements() if e.get_tag() == 'SOUR']
                for tag in ('AUTH', 'PUBL', 'REPO'):
                    self.assertFalse(self.children(source, tag))
                title, = self.children(source, 'TITL')
                self.assertIn(title.get_multi_line_value(), label)
                if 'https://' in label:
                    self.assertIn(label.rsplit(' — ', 1)[1], self.export(text))

    def test_family_repositories_come_from_settings(self):
        # A family's own archives live in its settings, not in Flyleaf.
        family = {'county': {'name': 'Example County Archives',
                             'url': 'https://records.example.org/',
                             'address': '1 Main Street',
                             'domain': 'records.example.org'},
                  'no_domain': {'name': 'A monument', 'url': 'https://example.net/'}}
        real = enrich_mod.flyleaf_settings.get
        with patch.object(enrich_mod.flyleaf_settings, 'get',
                          lambda key, default=None: family if key == 'gedcom.repositories'
                          else real(key, default)):
            module = load("enrich-gedcom.py", "eg_family_repos")
        self.assertEqual(module.url_to_repo('https://records.example.org/item/1'), 'county')
        self.assertEqual(module.url_to_repo('https://www.findagrave.com/memorial/1'), 'findagrave')
        self.assertIsNone(module.url_to_repo('https://example.net/page'))
        self.assertIsNone(enrich_mod.url_to_repo('https://records.example.org/item/1'))

    def test_multiple_legacy_urls_keep_all_locations_without_a_repository_guess(self):
        cases = [
            (['https://archive.org/details/a', 'https://familysearch.org/ark/b'], False),
            (['https://archive.org/details/a', 'https://unknown.example/b'], False),
            (['https://archive.org/details/a', 'https://archive.org/details/b'], True),
        ]
        for urls, repository_expected in cases:
            with self.subTest(urls=urls):
                text = '0 @I1@ INDI\n1 NAME Test /Person/\n' + ''.join(
                    '1 NOTE [Source] Same recorded title — ' + url + '\n' for url in urls) + '0 TRLR\n'
                actual = self.parse(self.export(text))
                source, = [e for e in actual.get_root_child_elements() if e.get_tag() == 'SOUR']
                repositories = self.children(source, 'REPO')
                self.assertEqual(bool(repositories), repository_expected)
                locations = ([c.get_multi_line_value() for c in self.children(repositories[0], 'CALN')]
                             if repositories else [c.get_multi_line_value() for c in self.children(source, 'NOTE')])
                self.assertEqual(locations, sorted(urls))
        for misleading_url in ('https://example.org/familysearch.org/record',
                               'https://familysearch.org.example.org/record'):
            self.assertIsNone(enrich_mod.url_to_repo(misleading_url))

    def test_conflicting_confidence_notes_do_not_choose_by_order(self):
        notes = ['1 NOTE Current assessment [Confidence] primary\n',
                 '1 NOTE Prior biography superseded [Confidence] tree-link\n']
        for ordered in (notes, list(reversed(notes))):
            for explicit in ('', '1 _CONFLEVEL primary\n'):
                with self.subTest(notes=ordered, explicit=explicit):
                    text = '0 @I1@ INDI\n1 NAME Test /Person/\n' + explicit + ''.join(ordered) + '0 TRLR\n'
                    actual = self.parse(self.export(text))
                    person = self.record(actual, '@I1@')
                    self.assertEqual([c.get_value() for c in self.children(person, '_CONFLEVEL')],
                                     ['primary'] if explicit else [])
                    self.assertEqual([n.get_multi_line_value() for n in self.children(person, 'NOTE')],
                                     [n.removeprefix('1 NOTE ').removesuffix('\n') for n in ordered])
                    self.assertEqual(self.signature(person), self.signature(self.record(
                        self.parse(self.export(self.export(text))), '@I1@')))


class TestPersonConfidence(unittest.TestCase):
    """FE-012: active confidence is explicit, or unanimous eligible legacy text."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    @staticmethod
    def document(fields):
        return ('0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Test /Person/\n'
                '1 REFN subject\n2 TYPE jsonid\n' + fields +
                '1 BIRT\n2 DATE 1980\n2 SOUR @S1@\n3 _KEY birth-evidence\n3 QUAY 1\n'
                '0 @S1@ SOUR\n1 TITL Explicit birth record\n1 _TIER primary\n0 TRLR\n')

    def collected(self, fields):
        parser = TestEnrichmentPreservation.parse(self.document(fields))
        people, _ = enrich_mod.collect_individual_data(parser)
        element = TestEnrichmentPreservation.record(parser, '@I1@')
        validated = validate_mod.collect_indi_data(element)
        self.assertEqual(people[0]['confidence'], validated['conflevel'])
        for key in ('confidence_errors', 'confidence_warnings'):
            self.assertEqual(people[0][key], validated[key])
        return people[0]

    def tree(self, fields):
        path = self.root / 'subject.ged'
        path.write_text(self.document(fields))
        return booklib.Tree(path)

    def assembler(self, tree, root='subject'):
        cfg = {'root_refn': root, 'chapters': [
            {'id': 'fixture', 'title': 'Fixture', 'lines': ['person']}]}
        a = assemble_mod.Assembler.__new__(assemble_mod.Assembler)
        a.tree, a.cfg, a.root = tree, cfg, root
        a.table = tree.ahnentafel(root)
        a.nums = tree.numbers_by_xref(a.table)
        with patch.multiple(booklib, SKETCH_DIR=self.root / 'empty-sketches',
                            BOOK_DIR=self.root, SYNC_JSON=self.root / 'missing-sync.json'):
            a.cov = coverage_mod.gather(tree, cfg)
        a.src_keys = tree.sources_by_person()
        a.index, a.cited_full, a.cited_uses, a.reg_anchor = {}, {}, set(), {}
        a.warnings = []
        return a

    def test_native_values_are_active_without_legacy_notes(self):
        for value in ('primary', 'tree-link', 'memoir', 'unknown'):
            with self.subTest(value=value):
                p = self.collected(f'1 _CONFLEVEL {value}\n')
                self.assertEqual(p['confidence'], value)
                self.assertEqual(p['confidence_errors'], [])
                self.assertEqual(p['confidence_warnings'], [])
                self.assertEqual(self.tree(f'1 _CONFLEVEL {value}\n').by_refn[
                    'subject']['confidence'], value)

    def test_native_overrides_legacy_history_in_both_orders_with_diagnostics(self):
        for old in ('tree-link', 'bogus'):
            native, legacy = '1 _CONFLEVEL primary\n', f'1 NOTE History [Confidence] {old}\n'
            for fields in (native + legacy, legacy + native):
                with self.subTest(fields=fields):
                    p = self.collected(fields)
                    self.assertEqual(p['confidence'], 'primary')
                    self.assertEqual(p['confidence_errors'], [])
                    self.assertIn('[CONF-HISTORY]', p['confidence_warnings'][0])
                    self.assertIn(old, p['confidence_warnings'][0])
                    self.assertEqual(self.tree(fields).by_refn['subject']['confidence'], 'primary')

    def test_absence_and_agreeing_legacy_repetition_remain_distinct_from_errors(self):
        for fields, expected in (('', None), ('1 NOTE Ordinary recorded note\n', None),
                                ('1 NOTE First [Confidence] primary\n'
                                 '1 NOTE Source superseded, current assessment [Confidence] primary\n',
                                 'primary')):
            with self.subTest(fields=fields):
                p = self.collected(fields)
                self.assertEqual(p['confidence'], expected)
                self.assertEqual(p['confidence_errors'], [])
                self.assertEqual(p['confidence_warnings'], [])
                self.assertEqual(self.tree(fields).by_refn['subject']['confidence'], expected)

    def test_legacy_conflicts_do_not_select_by_order_or_history_wording(self):
        notes = ['1 NOTE Current assessment [Confidence] primary\n',
                 '1 NOTE Prior biography superseded [Confidence] tree-link\n']
        diagnostics = []
        for ordered in (notes, list(reversed(notes)), notes + notes[:1]):
            with self.subTest(notes=ordered):
                p = self.collected(''.join(ordered))
                self.assertIsNone(p['confidence'])
                diagnostics.append(p['confidence_errors'])
                with self.assertRaises(ValueError) as raised:
                    self.tree(''.join(ordered))
                for expected in ('[CONF-CONFLICT]', '@I1@', 'subject', 'primary', 'tree-link'):
                    self.assertIn(expected, str(raised.exception))
        self.assertEqual(diagnostics[0], diagnostics[1])
        self.assertEqual(diagnostics[0], diagnostics[2])

    def test_invalid_or_duplicate_native_fields_cannot_fall_back(self):
        for native in ('1 _CONFLEVEL\n', '1 _CONFLEVEL bogus\n', '1 _CONFLEVEL PRIMARY\n',
                       '1 _CONFLEVEL primary\n1 _CONFLEVEL primary\n',
                       '1 _CONFLEVEL primary\n1 _CONFLEVEL tree-link\n'):
            fields = native + '1 NOTE Otherwise usable [Confidence] primary\n'
            with self.subTest(native=native):
                p = self.collected(fields)
                self.assertIsNone(p['confidence'])
                self.assertIn('[CONF-NATIVE]', p['confidence_errors'][0])
                with self.assertRaisesRegex(ValueError, r'CONF-NATIVE.*@I1@.*subject'):
                    self.tree(fields)

    def test_invalid_legacy_fallback_fails_visibly(self):
        fields = '1 NOTE Assessment [Confidence] almost-primary\n'
        p = self.collected(fields)
        self.assertIsNone(p['confidence'])
        self.assertIn('almost-primary', p['confidence_errors'][0])
        with self.assertRaisesRegex(ValueError, 'CONF-LEGACY'):
            self.tree(fields)

    def test_only_plain_terminal_non_source_markers_are_eligible(self):
        excluded = [
            '1 NOTE Metadata [Confidence] tree-link\n2 _PROV Recorded author\n',
            '1 NOTE Metadata\n2 CONT [Confidence] tree-link\n3 _PROV Recorded author\n',
            '1 NOTE Metadata [Confi\n2 CONC dence] tree-link\n3 _PROV Recorded author\n',
            '1 NOTE [Source] Historical label [Confidence] tree-link\n',
            '1 NOTE Nonterminal [Confidence] tree-link in a quotation\n',
        ]
        for fields in excluded:
            with self.subTest(fields=fields):
                p = self.collected(fields)
                self.assertIsNone(p['confidence'])
                self.assertEqual(p['confidence_errors'], [])
                self.assertEqual(p['confidence_warnings'], [])
        for fields in ('1 NOTE Assessment [Confi\n2 CONC dence] tree-link\n',
                       '1 NOTE Assessment\n2 CONT [Confidence] tree-link\n'):
            with self.subTest(fields=fields):
                p = self.collected(fields)
                self.assertEqual(p['confidence'], 'tree-link')
                self.assertEqual(p['confidence_errors'], [])

    def test_validation_reports_conflicts_and_native_history_warnings(self):
        for fields, code, marker in (
                ('1 NOTE Current [Confidence] primary\n1 NOTE Old [Confidence] tree-link\n',
                 1, '[CONF-CONFLICT]'),
                ('1 _CONFLEVEL primary\n1 NOTE Old [Confidence] tree-link\n',
                 0, '[CONF-HISTORY]')):
            with self.subTest(fields=fields):
                path = self.root / 'validate.ged'
                path.write_text(self.document(fields))
                output = io.StringIO()
                with patch.object(validate_mod, 'INPUT_GED', path), \
                     contextlib.redirect_stdout(output), self.assertRaises(SystemExit) as raised:
                    validate_mod.main()
                self.assertEqual(raised.exception.code, code)
                for expected in (marker, '@I1@', 'subject', 'primary', 'tree-link'):
                    self.assertIn(expected, output.getvalue())

    def test_numbered_output_uses_native_confidence_without_changing_citation_meaning(self):
        for value in ('primary', 'tree-link', 'memoir', 'unknown'):
            with self.subTest(value=value):
                tree = self.tree(f'1 _CONFLEVEL {value}\n')
                a = self.assembler(tree)
                row = a.cov['ancestors']['subject']
                self.assertEqual(row['conf'], value)
                rendered = '\n'.join(a.register_entry(row))
                # The family book never prints research confidence tiers.
                self.assertNotIn('reg-tier', rendered)
                self.assertNotIn('Evidence tier', rendered)
                source, = tree.by_refn['subject']['sources']
                self.assertEqual((source['tier'], source['quay'], source['facts']),
                                 ('primary', '1', [{'kind': 'birth', 'family': None}]))
                self.assertEqual(tree.by_refn['subject']['birth_date'], '1980')

    def test_collateral_confidence_does_not_create_an_independent_tier(self):
        text = ('0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Root /Person/\n'
                '1 REFN root\n2 TYPE jsonid\n1 _CONFLEVEL primary\n1 FAMC @F1@\n'
                '0 @I2@ INDI\n1 NAME Parent /Person/\n1 REFN parent\n2 TYPE jsonid\n'
                '1 SEX M\n1 _CONFLEVEL primary\n1 FAMS @F1@\n'
                '0 @I3@ INDI\n1 NAME Sibling /Person/\n1 REFN sibling\n2 TYPE jsonid\n'
                '1 _CONFLEVEL tree-link\n1 FAMC @F1@\n0 @F1@ FAM\n1 HUSB @I2@\n'
                '1 CHIL @I1@\n1 CHIL @I3@\n0 TRLR\n')
        path = self.root / 'collateral.ged'
        path.write_text(text)
        tree = booklib.Tree(path)
        a = self.assembler(tree, 'root')
        self.assertEqual(tree.by_refn['sibling']['confidence'], 'tree-link')
        self.assertNotIn('sibling', a.cov['ancestors'])
        rendered = '\n'.join(a.register_entry(a.cov['ancestors']['parent']))
        self.assertIn('Sibling Person', rendered)
        self.assertNotIn('#reg-tier', rendered)

    def test_valid_native_and_enriched_inputs_read_the_same_active_confidence(self):
        for fields in ('1 _CONFLEVEL tree-link\n', '1 NOTE Assessment [Confidence] primary\n',
                       '1 _CONFLEVEL primary\n1 NOTE Prior [Confidence] tree-link\n'):
            with self.subTest(fields=fields):
                before = self.tree(fields).by_refn['subject']
                path = self.root / 'export.ged'
                path.write_text(TestEnrichmentPreservation().export(self.document(fields)))
                after = booklib.Tree(path).by_refn['subject']
                for key in ('confidence', 'confidence_errors', 'confidence_warnings',
                            'birth_date', 'birth_place'):
                    self.assertEqual(before[key], after[key])
                self.assertEqual(before['sources'], after['sources'])

    def test_claim_map_fingerprint_includes_confidence_resolver(self):
        tree = self.tree('1 _CONFLEVEL primary\n')
        config = self.root / 'book.yaml'
        config.write_text('fixture: true\n')
        helper = HERE / 'gedcom_confidence.py'
        with patch.object(booklib, 'BOOK_YAML', config):
            before = claims_mod.build_map(tree, [])
            self.assertEqual(before['inputs_sha256']['scripts/gedcom_confidence.py'],
                             hashlib.sha256(helper.read_bytes()).hexdigest())
            read_bytes = Path.read_bytes
            with patch.object(Path, 'read_bytes', autospec=True,
                              side_effect=lambda p: b'changed resolver' if p == helper else read_bytes(p)):
                after = claims_mod.build_map(tree, [])
        self.assertNotEqual(before['inputs_sha256'], after['inputs_sha256'])


class TestBibliography(unittest.TestCase):
    """Cited collateral records belong; titles cannot classify or merge sources."""

    BASE = '''0 @I1@ INDI
1 REFN parent
2 TYPE jsonid
1 NAME Parent /Example/
1 SEX M
1 FAMS @F1@
1 SOUR @GENERAL@
1 SOUR @CENSUS@
1 SOUR @BIRTH@
1 SOUR @PROFILE@
0 @I2@ INDI
1 REFN child
2 TYPE jsonid
1 NAME Child /Example/
1 FAMC @F1@
1 BIRT
2 DATE ABT 1820
2 SOUR @REGISTER@
3 _KEY parish-birth
3 PAGE entry 7
3 NOTE Birth estimated from reported age
1 DEAT
2 DATE 1830
2 SOUR @REGISTER@
3 _KEY parish-death
3 PAGE entry 8
3 NOTE Death recorded by the registrar
0 @I3@ INDI
1 REFN unrelated
2 TYPE jsonid
1 NAME Unrelated /Example/
1 SOUR @UNUSED@
0 @F1@ FAM
1 HUSB @I1@
1 CHIL @I2@
0 @REGISTER@ SOUR
1 TITL Collateral parish register
1 ABBR Parish register
1 _KEY parish
1 _TIER primary
1 _URL https://www.familysearch.org/ark:/61903/example
0 @GENERAL@ SOUR
1 TITL Family correspondence
1 _KEY letters
1 _TIER family-testimony
0 @CENSUS@ SOUR
1 TITL Household schedule, 1900
1 _KEY household
1 _TIER primary
0 @BIRTH@ SOUR
1 TITL Birth certificate with a census discrepancy
1 _KEY certificate
1 _TIER primary
0 @PROFILE@ SOUR
1 TITL FamilySearch profile citing a census
1 _KEY profile
1 _TIER lead
0 @UNUSED@ SOUR
1 TITL Unused family history
1 _KEY unused
1 _TIER compiled-secondary
'''

    def assembler(self):
        a = TestExplicitCitationSupport().assembler(self.BASE)
        a.cov['ancestors'] = {'parent': {'refn': 'parent'}}
        a.bibliography_policy = {'schema': 1, 'census_sources': [{'source_id': '@CENSUS@'}]}
        return a

    @staticmethod
    def entry(rec):
        return {'label': '<bibliography-entry>', 'value': bookbib.token(rec)}

    @staticmethod
    def use(person, key):
        return {'label': '<bibliography-use>', 'value': {'person': person, 'key': key}}

    def test_collateral_citation_is_included_and_unused_source_is_not(self):
        a = self.assembler()
        register = '\n'.join(a.register_entry({'refn': 'parent', 'ahnentafel': [2]}))
        self.assertIn('b. ca. 1820', register)
        self.assertIn('Birth estimated from reported age', register)
        self.assertNotIn('child', a.cov['ancestors'])
        bibliography = a.bibliography()
        self.assertIn('- Collateral parish register, viewed at ', bibliography)
        self.assertIn('[FamilySearch.org]', bibliography)
        self.assertNotIn('Unused family history', bibliography)
        self.assertNotIn('Family correspondence', bibliography)  # not yet emitted

    def test_native_title_survives_and_qualified_uses_share_one_entry(self):
        a = self.assembler()
        keys = list(a.src_keys['child'])
        self.assertEqual(len(keys), 2)
        notes = []
        for number in (2, 4):
            notes.extend(a.footnote_typ(['child'], key, reg_no=number) for key in keys)
        self.assertEqual(sum('Birth estimated from reported age' in note for note in notes), 2)
        self.assertEqual(sum('Death recorded by the registrar' in note for note in notes), 2)
        self.assertEqual(sum('entry 7' in note for note in notes), 2)
        self.assertEqual(sum('entry 8' in note for note in notes), 2)
        self.assertTrue(all(r['source_label'] == 'Collateral parish register'
                            for r in a.src_keys['child'].values()))
        bibliography = a.bibliography()
        self.assertEqual(bibliography.count('<bibliography-entry>'), 1)
        self.assertNotIn('entry 7', bibliography)
        self.assertNotIn('Birth estimated', bibliography)

    def test_same_title_different_native_ids_remain_separate(self):
        a = self.assembler()
        original = a.src_keys['parent']['letters']
        a.src_keys['parent']['other'] = dict(original, source_id='@OTHER@')
        a.reference_notes('parent', ['letters', 'other'], 2)
        bibliography = a.bibliography()
        self.assertEqual(bibliography.count('- Family correspondence'), 2)
        self.assertEqual(bibliography.count('<bibliography-entry>'), 2)

    def test_legacy_same_title_different_url_or_tier_remain_separate(self):
        a = self.assembler()
        records = [dict(label='Shared title', source_label='Shared title', source_id=None,
                        tier=tier, url=url)
                   for url, tier in [('https://example.org/one', 'lead'),
                                     ('https://example.org/two', 'lead'),
                                     ('https://example.org/one', 'compiled-secondary')]]
        a.src_keys['legacy'] = dict(zip(('one', 'two', 'three'), records))
        a.reference_notes('legacy', ['one', 'two', 'three'], 2)
        self.assertEqual(a.bibliography().count('- Shared title'), 3)

    def test_last_entries_stay_together_at_the_end(self):
        # The bibliography once ended with two lines of one entry alone on a page.
        a = self.assembler()
        records = [dict(label=f'Leftover note {i}', source_label=f'Leftover note {i}',
                        source_id=None, tier='unclassified', url=None) for i in range(6)]
        a.src_keys['legacy'] = {f'n{i}': rec for i, rec in enumerate(records)}
        a.reference_notes('legacy', [f'n{i}' for i in range(6)], 2)
        bibliography = a.bibliography()
        tail = bibliography[bibliography.rindex('#block(breakable: false'):]
        self.assertEqual(tail.count('<bibliography-entry>'), assemble_mod.BIBLIOGRAPHY_TAIL_ENTRIES)
        self.assertIn('Leftover note 5', tail)
        self.assertEqual(bibliography.count('#block(breakable: false'), 1)

    def test_only_reviewed_census_omission_applies_and_notes_remain(self):
        a = self.assembler()
        footnote = a.footnote_typ(['parent'], 'household', reg_no=2)
        references = a.reference_notes('parent', ['household', 'certificate', 'profile'], 2)
        bibliography = a.bibliography()
        self.assertIn('Household schedule, 1900', footnote)
        self.assertIn('Household schedule, 1900', references)
        self.assertNotIn('Household schedule, 1900', bibliography)
        self.assertIn('Birth certificate with a census discrepancy', bibliography)
        self.assertIn('FamilySearch profile citing a census', bibliography)
        self.assertEqual(bibliography.count('<bibliography-entry>'), 2)

    def test_invalid_stale_ambiguous_and_duplicate_omissions_fail(self):
        a = self.assembler()
        invalid = [None, {'schema': True, 'census_sources': []},
                   {'schema': 1, 'census_sources': {}},
                   *({'schema': 1, 'census_sources': selectors} for selectors in (
                       [None], [{}], [{'source_id': 'CENSUS'}],
                       [{'source_id': '@MISSING@'}], [{'person': 'parent', 'key': 'missing'}],
                       [{'person': '', 'key': 'household'}],
                       [{'source_id': '@CENSUS@', 'key': 'household'}],
                       [{'source_id': '@CENSUS@'}, {'person': 'parent', 'key': 'household'}]))]
        for policy in invalid:
            with self.subTest(policy=policy), self.assertRaises(ValueError):
                bookbib.census_omissions(a.src_keys, policy)
        a.src_keys['parent']['ambiguous'] = dict(a.src_keys['parent']['household'],
                                                url='https://example.org/different')
        with self.assertRaisesRegex(ValueError, 'ambiguous'):
            bookbib.census_omissions(a.src_keys, a.bibliography_policy)

    def test_compiled_inventory_reconciles_repeats_and_census_omission(self):
        a = self.assembler()
        elements = [self.use('parent', key) for key in ['letters', 'household', 'letters']]
        elements.append(self.entry(a.src_keys['parent']['letters']))
        stats, errors = bookbib.check_inventory(a.src_keys, a.bibliography_policy, elements)
        self.assertEqual(errors, [])
        self.assertEqual(stats, {'uses': 3, 'sources': 2, 'entries': 1, 'census_omissions': 1})

    def test_a_source_of_someone_the_book_does_not_print_is_not_expected(self):
        # An unsourced family with one unrelated, sourced person in the tree.
        a = self.assembler()
        unprinted = {'parent': {}, 'unrelated': a.src_keys['unrelated']}
        people = a.tree.register_people('parent')
        self.assertEqual(people, {'parent', 'child'})
        policy = {'schema': 1, 'census_sources': []}
        self.assertEqual(bookbib.check_inventory(unprinted, policy, [], people=people)[1], [])
        self.assertTrue(bookbib.check_inventory(unprinted, policy, [],
                                                people=people | {'unrelated'})[1])

    @unittest.skipUnless(shutil.which('typst') and shutil.which('pdfinfo'), 'Typst and Poppler needed')
    def test_an_unsourced_book_builds_beside_an_unrelated_sourced_person(self):
        tree = SMALL_TREE.replace('2 SOUR @S1@\n3 PAGE p. 4\n3 _KEY ada-birth\n', '').replace(
            '0 @S1@ SOUR', '0 @I9@ INDI\n1 REFN stranger\n2 TYPE jsonid\n1 NAME Sam /Stranger/\n'
            '1 _CONFLEVEL tree-link\n1 SOUR @S1@\n0 @S1@ SOUR')
        with tempfile.TemporaryDirectory() as tmp:
            family = small_family(Path(tmp), tree=tree)
            result = run_script(family, "build-book.py")
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertTrue((family / "build" / "book.pdf").is_file())

    def test_compiled_inventory_missing_duplicate_uncited_and_unknown_uses_fail(self):
        a = self.assembler()
        uses = [self.use('parent', 'letters')]
        entry = self.entry(a.src_keys['parent']['letters'])
        for elements in [uses, uses + [entry, entry],
                         uses + [entry, self.entry(a.src_keys['unrelated']['unused'])],
                         uses + [entry, self.use('child', 'letters')],
                         uses + [entry, self.entry(a.src_keys['parent']['household'])],
                         [entry], []]:
            with self.subTest(elements=elements):
                self.assertTrue(bookbib.check_inventory(a.src_keys, a.bibliography_policy, elements)[1])

    def test_malformed_query_or_failed_typst_cannot_pass(self):
        a = self.assembler()
        for elements in [None, {}, [None], [{'label': '<bibliography-use>', 'value': {}}],
                         [{'label': '<bibliography-entry>', 'value': 123}]]:
            self.assertTrue(bookbib.check_inventory(a.src_keys, a.bibliography_policy, elements)[1])
        with patch.object(bibliography_mod.subprocess, 'run', side_effect=OSError('unavailable')):
            with contextlib.redirect_stderr(io.StringIO()) as err:
                self.assertEqual(bibliography_mod.main([]), 1)
            self.assertIn('unavailable', err.getvalue())

    @unittest.skipUnless(shutil.which('typst') and shutil.which('pdftotext'),
                         'Typst and poppler required for bibliography integration')
    def test_compiled_notes_references_and_printed_bibliography_agree(self):
        a = self.assembler()
        register = '\n'.join(a.register_entry({'refn': 'parent', 'ahnentafel': [2]}))
        references = a.reference_notes('parent', ['letters', 'household', 'certificate', 'profile'], 2)
        body = (IMPORT + ': *\n#show: book.with(title: "Bibliography fixture")\n'
                + register + '\n= Sources for the Register <sources-parent>\n' + references
                + '\n' + a.bibliography())
        with tempfile.TemporaryDirectory(dir=booklib.ROOT) as tmp:
            src, pdf = Path(tmp) / 'fixture.typ', Path(tmp) / 'fixture.pdf'
            src.write_text(body)
            query = subprocess.run(['typst', 'query', str(src),
                                    'selector(<bibliography-use>).or(<bibliography-entry>)',
                                    '--root', str(booklib.ROOT)], capture_output=True, text=True)
            self.assertEqual(query.returncode, 0, query.stderr)
            stats, errors = bookbib.check_inventory(a.src_keys, a.bibliography_policy,
                                                    json.loads(query.stdout))
            self.assertEqual(errors, [])
            self.assertEqual(stats, {'uses': 6, 'sources': 5, 'entries': 4, 'census_omissions': 1})
            compiled = subprocess.run(['typst', 'compile', str(src), str(pdf), '--root',
                                       str(booklib.ROOT)], capture_output=True, text=True)
            self.assertEqual(compiled.returncode, 0, compiled.stderr)
            text = subprocess.run(['pdftotext', str(pdf), '-'], capture_output=True, text=True)
            self.assertEqual(text.returncode, 0, text.stderr)
            before, bibliography = text.stdout.rsplit('Bibliography', 1)
            self.assertEqual(before.count('Collateral parish register'), 1)
            self.assertIn('Birth estimated from reported age', before)
            self.assertIn('Death recorded by the registrar', before)
            self.assertIn('entry 8', before)
            self.assertIn('Household schedule, 1900', before)
            self.assertNotIn('Household schedule, 1900', bibliography)
            self.assertIn('Collateral parish register', bibliography)
            self.assertIn('viewed at FamilySearch.org', bibliography)
            self.assertNotIn('https://', bibliography)
            self.assertNotIn('Unused family history', text.stdout)


class TestSourceFirstCitation(unittest.TestCase):
    """A new locator is a new use of a source, not a new source title."""

    def test_new_locator_shortens_title_but_keeps_its_own_qualification(self):
        a = TestBibliography().assembler()
        first = a.footnote_typ(['child'], 'parish-birth', reg_no=2)
        second = a.footnote_typ(['child'], 'parish-death', reg_no=2)
        self.assertIn('Collateral parish register', first)
        self.assertIn('#footnote[Parish register — entry 8', second)
        self.assertIn('Death recorded by the registrar', second)
        self.assertNotIn('Birth estimated', second)
        self.assertNotIn('entry 7', second)
        self.assertNotIn('Primary record', second)
        self.assertNotIn('cited in full', second)  # no self-reference
        self.assertEqual((first + second).count('<bibliography-use>'), 2)
        self.assertEqual(a.bibliography().count('<bibliography-entry>'), 1)

    def test_other_person_and_locator_reference_the_actual_first_source_location(self):
        a = TestExplicitCitationSupport().assembler()
        full = a.reference_notes('father', ['child-register'], 2)
        later = a.footnote_typ(['child'], 'child-register', reg_no=4)
        self.assertIn('A register entry whose title does not name an event', full)
        self.assertIn('#footnote[Parish register — entry 7', later)
        self.assertIn('#link(<sources-father>)[Sources for the Register, no. 2]', later)
        self.assertNotIn('Primary record', later)

    def test_general_reference_after_event_note_keeps_its_own_locator(self):
        a = TestBibliography().assembler()
        a.footnote_typ(['child'], 'parish-birth', reg_no=4)
        notes = a.reference_notes('child', ['parish-death'], 4)
        self.assertIn('Parish register — entry 8', notes)
        self.assertIn('Death recorded by the registrar', notes)
        self.assertIn('cited in full at no. 4', notes)
        self.assertNotIn('Collateral parish register', notes)
        self.assertNotIn('entry 7', notes)

    def test_general_reference_group_shortens_subsequent_qualified_use(self):
        a = TestBibliography().assembler()
        notes = a.reference_notes('child', ['parish-birth', 'parish-death'], 4)
        self.assertEqual(notes.count('Collateral parish register'), 1)
        self.assertIn('Parish register — entry 8', notes)
        self.assertIn('Birth estimated from reported age', notes)
        self.assertIn('Death recorded by the registrar', notes)
        self.assertNotIn('cited in full', notes)
        self.assertEqual(notes.count('<bibliography-use>'), 2)

    def test_distinct_source_id_url_or_tier_still_gets_a_full_citation(self):
        for field, value in [('source_id', '@OTHER@'), ('url', 'https://example.org/other'),
                             ('tier', 'compiled-secondary')]:
            with self.subTest(field=field):
                a = TestBibliography().assembler()
                a.src_keys['child']['parish-death'][field] = value
                a.footnote_typ(['child'], 'parish-birth', reg_no=2)
                later = a.footnote_typ(['child'], 'parish-death', reg_no=4)
                self.assertIn('Collateral parish register', later)
                self.assertNotIn('cited in full', later)
                self.assertIn('entry 8', later)

    def test_no_curated_abbreviation_keeps_the_title_and_current_locator(self):
        a = TestExplicitCitationSupport().assembler(
            TestBibliography.BASE.replace('1 ABBR Parish register\n', ''))
        a.footnote_typ(['child'], 'parish-birth', reg_no=2)
        later = a.footnote_typ(['child'], 'parish-death', reg_no=4)
        self.assertIn('Collateral parish register — entry 8', later)
        self.assertIn('Death recorded by the registrar', later)
        self.assertNotIn('entry 7', later)


class TestGeneralSourceKinds(unittest.TestCase):
    """The built-in patterns name general kinds of record, in several
    languages. A family's own patterns decide for the sources they name."""

    def test_general_kinds_of_record(self):
        tier = self.classifier({"patterns": {}}).classify_source
        for text, expected in (("1881 census of England, Example parish", "primary"),
                               ("Kirchenbuch Musterstadt, Taufen 1820", "primary"),
                               ("Registro parroquial de Ejemplo, bautismos", "primary"),
                               ("Passenger list of the ship Example, 1852", "primary"),
                               ("Will of Ada Example, proved 1790", "primary"),
                               # An index or abstract is compiled from the records.
                               ("1881 census index, Example parish", "compiled-secondary"),
                               ("Probate abstracts of Example County", "compiled-secondary"),
                               ("Obituary of Ada Example, The Example Gazette", "compiled-secondary"),
                               ("A history of Example County", "compiled-secondary"),
                               ("The Example family Bible", "family-testimony"),
                               ("Ada's page in an online tree", "lead"),
                               ("Photograph of a luggage tag", "unclassified"),
                               ("A local guidebook", "unclassified")):
            with self.subTest(text=text):
                self.assertEqual(tier(text), expected)

    def classifier(self, rules):
        import source_tiers
        path = fixture_file(json.dumps(rules), ".json")
        real = source_tiers.flyleaf_settings.get
        with patch.object(source_tiers.flyleaf_settings, "get", side_effect=lambda key, default=None:
                          str(path) if key == "paths.source_tier_patterns" else real(key, default)):
            return load("source_tiers.py", "source_tiers_t" + str(len(json.dumps(rules))))

    def test_a_familys_patterns_come_first_and_may_stand_alone(self):
        family = self.classifier({"patterns": {"compiled-secondary": [r"\bExample Chronicle\b"]}})
        # The family's pattern decides, though "passenger list" is a primary kind.
        self.assertEqual(family.classify_source("Example Chronicle, passenger list"), "compiled-secondary")
        self.assertEqual(family.classify_source("Passenger list, 1852"), "primary")
        alone = self.classifier({"general_patterns": False,
                                 "patterns": {"lead": [r"\bExample Chronicle\b"]}})
        self.assertEqual(alone.classify_source("Example Chronicle"), "lead")
        self.assertEqual(alone.classify_source("Passenger list, 1852"), "unclassified")

    def test_the_check_and_the_book_classify_a_source_alike(self):
        # A neutral title with a recognised address: once the check ignored
        # the address and the book used it.
        text = ("0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 REFN ada\n2 TYPE jsonid\n"
                "1 NAME Ada /Example/\n1 SOUR @S1@\n0 @S1@ SOUR\n1 TITL Profile page\n"
                "1 _URL https://www.wikitree.com/wiki/Example-1\n0 TRLR\n")
        path = fixture_file(text, ".ged")
        parser = validate_mod.Parser()
        parser.parse_file(str(path), strict=False)
        checked = validate_mod.classify_source(validate_mod.collect_sour_records(parser)["@S1@"])
        built = next(iter(booklib.Tree(path).sources_by_person()["ada"].values()))["tier"]
        self.assertEqual((checked, built), ("lead", "lead"))


class TestCuratedSourceClassification(unittest.TestCase):
    def test_curated_tier_overrides_title_in_both_directions(self):
        self.assertEqual(validate_mod.classify_source('Household schedule', 'primary'), 'primary')
        self.assertEqual(validate_mod.classify_source('US Census index', 'lead'), 'lead')
        self.assertEqual(validate_mod.classify_source('Birth Certificate abstract',
                         'compiled-secondary'), 'compiled-secondary')
        self.assertEqual(validate_mod.classify_source('US Census', 'unclassified'), 'unclassified')

    def test_legacy_fallback_and_invalid_curated_value(self):
        self.assertEqual(validate_mod.classify_source('US Census'), 'primary')
        with self.assertRaisesRegex(ValueError, 'invalid source _TIER'):
            validate_mod.classify_source('US Census', 'almost-primary')

    def test_source_record_tier_is_distinct_from_citation_quality(self):
        text = '''0 HEAD
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Example /Person/
1 _CONFLEVEL primary
1 SOUR @S1@
2 QUAY 3
2 _TIER primary
0 @S1@ SOUR
1 TITL US Census family-tree extract
1 _TIER lead
0 TRLR
'''
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'sources.ged'
            path.write_text(text)
            parser = validate_mod.Parser()
            parser.parse_file(str(path), strict=False)
            tiers = validate_mod.collect_sour_tiers(parser)
            self.assertEqual(tiers, {'@S1@': 'lead'})
            labels = validate_mod.collect_sour_records(parser)
            self.assertEqual(validate_mod.classify_source(labels['@S1@'], tiers['@S1@']), 'lead')

    def test_empty_or_conflicting_native_tiers_fail_both_readers(self):
        for tier_lines in ('1 _TIER\n', '1 _TIER primary\n1 _TIER lead\n'):
            text = TestExplicitCitationSupport.BASE.replace(
                '1 _TIER primary\n', tier_lines, 1)
            with self.subTest(tiers=tier_lines), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / 'sources.ged'
                path.write_text(text)
                parser = validate_mod.Parser()
                parser.parse_file(str(path), strict=False)
                with self.assertRaisesRegex(ValueError, '_TIER'):
                    validate_mod.collect_sour_tiers(parser)
                with self.assertRaisesRegex(ValueError, '_TIER'):
                    fixture_tree(text)

    def test_main_uses_native_tier_without_borrowing_citation_quality(self):
        template = '''0 HEAD
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
0 @I1@ INDI
1 REFN example-person
2 TYPE jsonid
1 NAME Example /Person/
1 _CONFLEVEL primary
1 SOUR @S1@
2 QUAY 3
2 _TIER primary
0 @S1@ SOUR
1 TITL US Census index
1 _TIER TIER_VALUE
0 TRLR
'''
        for tier, expected in (('primary', 0), ('lead', 1), ('unclassified', 1),
                               ('invalid-category', 1)):
            with self.subTest(tier=tier), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / 'sources.ged'
                path.write_text(template.replace('TIER_VALUE', tier))
                output = io.StringIO()
                with patch.object(validate_mod, 'INPUT_GED', path), \
                     patch.object(validate_mod, 'structural_issues', return_value=([], [])), \
                     contextlib.redirect_stdout(output), self.assertRaises(SystemExit) as exc:
                    validate_mod.main()
                self.assertEqual(exc.exception.code, expected)
                if tier in ('lead', 'unclassified'):
                    self.assertIn('[CONF-MISMATCH]', output.getvalue())
                if tier == 'invalid-category':
                    self.assertIn('[SOURCE-TIER]', output.getvalue())


class TestExplicitCitationSupport(unittest.TestCase):
    """FE-012: source words cannot choose the subject, event, or marriage."""

    BASE = '''0 @I1@ INDI
1 REFN father
2 TYPE jsonid
1 NAME Father /Example/
1 SEX M
1 BIRT
2 DATE 1800
1 DEAT
2 DATE 1880
1 SOUR @CHILDDEATH@
1 NOTE [Source] Death certificate of another relative
1 NOTE [Confidence] primary
1 FAMS @F1@
1 FAMS @F2@
0 @I2@ INDI
1 REFN child
2 TYPE jsonid
1 NAME Child /Example/
1 DEAT
2 DATE 1830
2 SOUR @CHILDDEATH@
3 PAGE entry 7
3 QUAY 3
0 @I3@ INDI
1 REFN first-wife
2 TYPE jsonid
1 NAME First /Wife/
1 FAMS @F1@
0 @I4@ INDI
1 REFN second-wife
2 TYPE jsonid
1 NAME Second /Wife/
1 FAMS @F2@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I3@
1 MARR
2 DATE 1820
2 SOUR @FIRST@
3 PAGE first marriage entry
0 @F2@ FAM
1 HUSB @I1@
1 WIFE @I4@
1 MARR
2 DATE 1840
2 SOUR @SECOND@
3 PAGE second marriage entry
0 @CHILDDEATH@ SOUR
1 TITL A register entry whose title does not name an event
1 ABBR Parish register
1 _KEY child-register
1 _TIER primary
0 @FIRST@ SOUR
1 TITL First union record
1 _KEY first-union
0 @SECOND@ SOUR
1 TITL Second union record
1 _KEY second-union
'''

    def assembler(self, text=None):
        a = assemble_mod.Assembler.__new__(assemble_mod.Assembler)
        a.tree = fixture_tree(text or self.BASE)
        a.src_keys = a.tree.sources_by_person()
        a.cited_full = {}
        a.cited_uses = set()
        a.index = {}
        a.nums = {'@I1@': [2], '@I3@': [3]}
        a.cov = {'states': {}}
        a.reg_anchor = {}
        return a

    def test_title_never_assigns_another_persons_death(self):
        a = self.assembler()
        groups = a.cites_by_fact('father')
        self.assertEqual(groups['death'], [])
        self.assertIn('child-register', groups['general'])
        self.assertIn('death-certificate-of-another-relative', groups['general'])
        self.assertEqual(a.cites_by_fact('child')['death'], ['child-register'])

    def test_each_marriage_receives_only_its_own_citation(self):
        a = self.assembler()
        result = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))
        first = next(line for line in result.splitlines() if 'He married in 1820,' in line)
        second = next(line for line in result.splitlines() if 'Father Example married in 1840,' in line)
        self.assertIn('first marriage entry', first)
        self.assertNotIn('second marriage entry', first)
        self.assertIn('second marriage entry', second)
        self.assertNotIn('first marriage entry', second)

    def spouse_vital_fixture(self):
        return self.BASE.replace('1 NAME Second /Wife/\n', '''1 NAME Second /Wife/
1 BIRT
2 DATE 1810
2 SOUR @SV@
3 _KEY spouse-birth
3 PAGE spouse birth entry
3 NOTE Retrospective birth report
1 BAPM
2 DATE 1811
2 SOUR @SV@
3 _KEY spouse-baptism
3 PAGE spouse baptism entry
1 DEAT
2 DATE 1870
2 SOUR @SV@
3 _KEY spouse-death
3 PAGE spouse death entry
1 BURI
2 TYPE Reported burial
2 PLAC Spouse Cemetery
2 SOUR @SV@
3 _KEY spouse-burial
3 PAGE spouse burial entry
''') + '''0 @SV@ SOUR
1 TITL Spouse vital register
1 ABBR Spouse register
1 _KEY spouse-vitals
1 _TIER compiled-secondary
'''

    def test_unnumbered_spouse_vitals_keep_their_subject_and_event_citations(self):
        a = self.assembler(self.spouse_vital_fixture())
        result = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))
        vital = next(line for line in result.splitlines() if 'was born in 1810' in line)
        self.assertIn('Second Wife', vital)
        for locator in ('spouse birth entry', 'spouse baptism entry',
                        'spouse death entry', 'spouse burial entry'):
            self.assertIn(locator, vital)
            self.assertEqual(result.count(locator), 1)
        self.assertIn('Retrospective birth report', vital)
        self.assertIn('was baptized in 1811', vital)
        self.assertIn('died in 1870', vital)
        self.assertIn('Burial is reported at Spouse Cemetery', vital)
        self.assertNotIn('Spouse Cemetery in 1870', vital)
        self.assertNotIn('second marriage entry', vital)
        marriage = next(line for line in result.splitlines() if 'Father Example married in 1840,' in line)
        self.assertIn('second marriage entry', marriage)
        self.assertNotIn('spouse birth entry', marriage)
        self.assertLess(result.index(marriage), result.index(vital))
        self.assertEqual(result.count('<reg-collateral-second-wife>'), 1)

    def test_numbered_spouse_vitals_stay_in_own_entry(self):
        a = self.assembler(self.spouse_vital_fixture())
        a.nums['@I4@'] = [5]
        result = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))
        self.assertNotIn('spouse birth entry', result)
        self.assertNotIn('Spouse Cemetery', result)
        own = '\n'.join(a.register_entry({'refn': 'second-wife', 'ahnentafel': [5]}))
        self.assertIn('spouse birth entry', own)
        self.assertIn('spouse death entry', own)
        self.assertIn('Spouse Cemetery', own)

    def test_relative_break_keeps_unnumbered_spouse_union_and_vitals_together(self):
        a = self.assembler(self.spouse_vital_fixture())
        a._collateral_breaks = {'second-wife'}
        a._used_collateral_breaks = set()
        result = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))
        self.assertEqual(a._used_collateral_breaks, {'second-wife'})
        before, after = result.split('#pagebreak(weak: true)')
        self.assertIn('first marriage entry', before)
        self.assertIn('Father Example married in 1840,', after)
        for locator in ('second marriage entry', 'spouse birth entry', 'spouse death entry'):
            self.assertIn(locator, after)
            self.assertEqual(result.count(locator), 1)
        self.assertEqual(result.count('<reg-collateral-second-wife>'), 1)

    def test_spouse_without_vitals_does_not_gain_an_empty_vital_paragraph(self):
        a = self.assembler()
        result = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))
        self.assertEqual(result.count('Second Wife'), 1)
        self.assertEqual(result.count('<reg-collateral-second-wife>'), 1)

    def test_recorded_alias_uses_only_its_persons_register_locations(self):
        text = self.BASE.replace('1 NAME First /Wife/\n', '1 NAME Loveday K. /Pellow/\n')
        text = text.replace('1 NAME Second /Wife/\n',
                            '1 NAME Loveday K. /Pellow/\n1 NAME Loveday K. /Marrack/\n2 TYPE recorded name\n')
        a = self.assembler(text)
        result = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))
        self.assertIn('Loveday K. Pellow', result)
        self.assertEqual(a.tree.by_refn['second-wife']['alternate_names'],
                         [{'given': 'Loveday K.', 'surname': 'Marrack', 'type': 'recorded name'}])
        self.assertEqual(a.index[('Marrack', 'Loveday K.')], {'under 2'})
        self.assertEqual(a.indexed_people['@I4@'], {'under 2'})
        self.assertEqual(a.indexed_people['@I3@'], {'3'})
        # The namesake's number does not leak into the recorded alias.
        self.assertNotIn('3', a.index[('Marrack', 'Loveday K.')])

    def test_recorded_alias_boldfaces_only_its_owners_register_number(self):
        text = self.BASE.replace('1 NAME First /Wife/\n',
                                 '1 NAME Loveday K. /Pellow/\n1 NAME Loveday K. /Marrack/\n')
        text = text.replace('1 NAME Second /Wife/\n', '1 NAME Loveday K. /Marrack/\n')
        a = self.assembler(text)
        a.table = {2: '@I1@', 3: '@I3@'}
        a.register_entry({'refn': 'father', 'ahnentafel': [2]})
        index = a.name_index()
        alias = next(line for line in index.splitlines() if line.startswith('Marrack, Loveday K. —'))
        self.assertIn('*3*', alias)
        self.assertIn('under 2', alias)
        self.assertNotIn('*under 2*', alias)

    def test_child_ranges_and_bounds_render_as_readable_dates(self):
        cases = {'BET 1866 AND 1868': 'between 1866 and 1868',
                 'BET 1 JAN 1866 AND 17 NOV 1868': 'between 1 Jan. 1866 and 17 Nov. 1868',
                 'FROM 1900 TO 1903': 'from 1900 to 1903',
                 'FROM 1900': 'from 1900', 'TO 1903': 'to 1903',
                 'ABT 1867': 'ca. 1867', 'BEF 1868': 'bef. 1868',
                 'AFT 1866': 'aft. 1866', 'CAL 1867': 'calculated 1867',
                 'EST 1867': 'estimated 1867'}
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(assemble_mod.child_date(raw), expected)
        text = self.BASE.replace('1 REFN child\n', '1 BIRT\n2 DATE BET 1866 AND 1868\n1 REFN child\n')
        text = text.replace('1 WIFE @I3@\n', '1 WIFE @I3@\n1 CHIL @I2@\n')
        a = self.assembler(text)
        result = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))
        self.assertIn('b. between 1866 and 1868', result)
        self.assertNotIn('BET 1866 AND 1868', result)
        self.assertEqual(assemble_mod.prose_date('BET 1866 AND 1868'), 'between 1866 and 1868')

    def test_general_references_move_without_claim_assignment(self):
        a = self.assembler()
        entry = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))
        self.assertIn('ref(<sources-father>, form: "page")', entry)
        self.assertLess(entry.index('ref(<sources-father>'), entry.index('was born'))
        self.assertNotIn('Death certificate of another relative', entry)
        self.assertNotIn('child-register', entry)
        keys = a.cites_by_fact('father')['general']
        notes = a.reference_notes('father', keys, 2)
        self.assertIn('Death certificate of another relative', notes)
        self.assertIn('child-register', notes)
        self.assertNotIn('#footnote', notes)
        expected = register_sources_mod.expected_keys(a.tree, 'father')
        self.assertEqual(set(expected), {('father', key) for key in keys})
        self.assertEqual(set(a.cites_by_fact('father')['death']), set())

    def test_aliases_share_text_but_keep_every_key(self):
        a = self.assembler()
        original = a.src_keys['father']['child-register']
        a.src_keys['father']['alias'] = dict(original)
        notes = a.reference_notes('father', ['child-register', 'alias'], 2)
        self.assertEqual(notes.count(original['label']), 1)
        self.assertIn('keys: ("child-register", "alias",)', notes)

    def test_repeated_native_note_keeps_qualification(self):
        a = self.assembler(self.BASE.replace('3 PAGE entry 7',
            '3 PAGE entry 7\n3 NOTE Transcription only; original not examined'))
        a.footnote_typ(['child'], 'child-register', reg_no=8)
        repeat = a.footnote_typ(['child'], 'child-register', reg_no=16)
        self.assertIn('Parish register', repeat)
        self.assertIn('entry 7', repeat)
        self.assertIn('Transcription only; original not examined', repeat)

    def test_distinct_source_ids_or_urls_do_not_coalesce(self):
        for field, value in [('source_id', '@DIFFERENT@'), ('url', 'https://example.org/other')]:
            with self.subTest(field=field):
                a = self.assembler()
                original = a.src_keys['father']['child-register']
                a.src_keys['father']['other'] = dict(original, **{field: value})
                a.footnote_typ(['father'], 'child-register', reg_no=2)
                second = a.footnote_typ(['father'], 'other', reg_no=2)
                self.assertIn('Primary record', second)

    def test_source_note_cross_reference_names_its_actual_location(self):
        a = self.assembler()
        a.reference_notes('father', ['child-register'], 2)
        repeat = a.footnote_typ(['father'], 'child-register', reg_no=8)
        self.assertIn('#link(<sources-father>)[Sources for the Register, no. 2]', repeat)
        self.assertNotIn('cited in full at no. 2', repeat)

    def test_reference_section_retains_numbered_ancestors_and_keys(self):
        a = self.assembler()
        a.cfg = {'chapters': [{'id': 'example', 'title': 'Example family', 'lines': ['example']}]}
        a.cov['ancestors'] = {
            refn: {'refn': refn, 'line': 'example', 'generation': 1, 'ahnentafel': [n]}
            for n, refn in [(2, 'father'), (3, 'child')]}
        result = a.register_references()
        self.assertIn('=== 2. #smallcaps[Father Example] <sources-father>', result)
        self.assertIn('ref(<reg-father>, form: "page")', result)
        self.assertNotIn('<sources-child>', result)  # only event evidence on the child
        for key in a.cites_by_fact('father')['general']:
            self.assertIn('"' + key + '"', result)

    @unittest.skipUnless(shutil.which("typst"), "Typst required for reference pagination")
    def test_generated_reference_heading_and_pointer_stay_with_first_source(self):
        a = self.assembler()
        a.cfg = {'chapters': [{'id': 'example', 'title': 'Example family', 'lines': ['example']}]}
        a.cov['ancestors'] = {'father': {
            'refn': 'father', 'line': 'example', 'generation': 1, 'ahnentafel': [2]}}
        # Exercise the actual generated entry. At 480pt, the former plain
        # pointer left the heading on page 1 and the first source on page 2.
        entry = '=== ' + a.register_references().split('=== ', 1)[1]
        with tempfile.TemporaryDirectory(dir=booklib.ROOT) as tmp:
            for space, page in ((450, 1), (480, 2)):
                with self.subTest(space=space):
                    src = Path(tmp) / 'pointer.typ'
                    src.write_text(IMPORT + ': *\n'
                                   '#show: book.with(title: "Pointer fixture")\n'
                                   '#set page(header: none, numbering: "1")\n'
                                   '#metadata(none) <reg-father>\nPrior text.\n\n'
                                   + f'#v({space}pt)\n' + entry + '''
#context [#metadata((
  heading: query(<sources-father>).first().location().page(),
  source: query(<register-source>).first().location().page(),
)) <result>]
''')
                    proc = subprocess.run(['typst', 'query', str(src), '<result>',
                                           '--root', str(booklib.ROOT)], capture_output=True, text=True)
                    self.assertEqual(proc.returncode, 0, proc.stderr)
                    self.assertEqual(json.loads(proc.stdout)[0]['value'],
                                     {'heading': page, 'source': page})

    def test_native_key_survives_a_title_correction(self):
        a = self.assembler()
        b = self.assembler(self.BASE.replace('A register entry whose title does not name an event',
                                            'Corrected collection title'))
        self.assertEqual(set(a.src_keys['child']), set(b.src_keys['child']))
        self.assertIn('child-register', b.src_keys['child'])

    def test_unknown_native_source_fails_instead_of_dropping_a_citation(self):
        with self.assertRaisesRegex(ValueError, 'MISSING'):
            self.assembler(self.BASE.replace('1 SOUR @CHILDDEATH@', '1 SOUR @MISSING@'))

    def test_confidence_does_not_generate_citation_quality_or_inferred_events(self):
        text = ('0 HEAD\n1 CHAR UTF-8\n' + self.BASE.replace(
            '1 NOTE [Confidence] primary',
            '1 NOTE Buried This is prose, not a recorded burial. [Confidence] primary\n'
            '1 NOTE [Source] 1920 US Census — Guessed residence') + '0 TRLR\n')
        output = TestEnrichmentPreservation().parse(TestEnrichmentPreservation().export(text))
        father = TestEnrichmentPreservation.record(output, '@I1@')
        self.assertFalse(TestEnrichmentPreservation.children(father, 'BURI'))
        self.assertFalse(TestEnrichmentPreservation.children(father, 'CENS'))
        for citation in TestEnrichmentPreservation.children(father, 'SOUR'):
            self.assertFalse(TestEnrichmentPreservation.children(citation, 'QUAY'))
        child = TestEnrichmentPreservation.record(output, '@I2@')
        death, = TestEnrichmentPreservation.children(child, 'DEAT')
        citation, = TestEnrichmentPreservation.children(death, 'SOUR')
        self.assertEqual(TestEnrichmentPreservation.children(citation, 'QUAY')[0].get_value(), '3')

    def test_shared_source_edits_stale_users_but_not_unrelated_people(self):
        before = fixture_tree(self.BASE)
        after = fixture_tree(self.BASE.replace('A register entry whose title does not name an event',
                                              'Revised title of the same source'))
        self.assertNotEqual(before.person_hash('child'), after.person_hash('child'))
        self.assertNotEqual(before.person_hash('father'), after.person_hash('father'))
        self.assertEqual(before.person_hash('first-wife'), after.person_hash('first-wife'))

    def test_invalid_tier_is_rejected_before_bibliography_can_drop_it(self):
        with self.assertRaisesRegex(ValueError, '_TIER'):
            self.assembler(self.BASE.replace('1 _TIER primary', '1 _TIER misspelled'))

    def test_note_citation_does_not_claim_the_enclosing_events_date(self):
        text = self.BASE.replace('2 SOUR @CHILDDEATH@\n3 PAGE entry 7\n3 QUAY 3',
                                '2 NOTE An explanatory note\n3 SOUR @CHILDDEATH@')
        groups = self.assembler(text).cites_by_fact('child')
        self.assertEqual(groups['death'], [])
        self.assertIn('child-register', groups['general'])

    def test_native_source_ids_fit_the_gedcom_pointer_limit(self):
        tree = booklib.Tree()
        native_ids = {s['source_id'] for p in tree.people for s in p.get('sources', [])
                      if s.get('native')}
        if not native_ids:
            self.skipTest("this family's tree cites no GEDCOM source records")
        self.assertTrue(all(len(pointer) <= 22 for pointer in native_ids))

    def test_collateral_children_get_their_own_event_citations(self):
        text = self.BASE.replace('1 MARR\n2 DATE 1820',
                                 '1 CHIL @I2@\n1 MARR\n2 DATE 1820')
        text = text.replace('1 NAME Child /Example/',
                            '1 NAME Child /Example/\n1 BIRT\n2 DATE 1829\n'
                            '2 SOUR @CHILDDEATH@\n3 PAGE entry 7\n3 QUAY 3')
        a = self.assembler(text)
        result = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))
        child_line = next(line for line in result.splitlines() if 'child-plain' in line)
        self.assertIn('1830', child_line)
        self.assertIn('entry 7', child_line)
        self.assertIn(r']\; d. 1830#footnote[', child_line)

    def test_invalid_quality_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'QUAY'):
            self.assembler(self.BASE.replace('3 QUAY 3', '3 QUAY 8'))

    def test_short_citation_keeps_the_explicit_locator(self):
        a = self.assembler()
        a.footnote_typ(['child'], 'child-register', reg_no=4)
        a._last_fn = None
        repeat = a.footnote_typ(['child'], 'child-register', reg_no=8)
        self.assertIn('entry 7', repeat)
        self.assertIn('Parish register', repeat)

    def test_same_entry_short_citation_retains_its_locator_and_separate_anchor(self):
        a = self.assembler()
        first = a.fn('child', ['child-register'], reg_no=4)
        repeat = a.fn('child', ['child-register'], reg_no=4)
        self.assertIn('A register entry whose title does not name an event', first)
        self.assertIn('#footnote[Parish register — entry 7.', repeat)
        self.assertNotIn('cited in full', repeat)


class TestRecordedNameSuffixes(unittest.TestCase):
    BASE = '''0 @R@ INDI
1 REFN root
2 TYPE jsonid
1 NAME Root /O'Example/
1 FAMC @F0@
0 @P@ INDI
1 REFN parent
2 TYPE jsonid
1 NAME Carried /O'Example/
1 SEX M
1 FAMS @F0@
1 FAMC @F1@
1 BIRT
2 DATE 1911
0 @M@ INDI
1 REFN mother
2 TYPE jsonid
1 NAME Mother /Example/
1 FAMS @F0@
0 @GF@ INDI
1 REFN grandfather
2 TYPE jsonid
1 NAME Jago R. /O'Example/ Sr.
2 GIVN Jago R.
2 SURN O'Example
2 NSFX Sr.
1 NAME Jago Ruan /O'Example/ Senior
2 TYPE recorded
1 SEX M
1 FAMS @F1@
0 @GM@ INDI
1 REFN grandmother
2 TYPE jsonid
1 NAME Morwen /Example/
1 SEX F
1 FAMS @F1@
0 @C@ INDI
1 REFN collateral
2 TYPE jsonid
1 NAME Jago Ruan /O'Example/ Jr.
2 GIVN Jago Ruan
2 SURN O'Example
2 NSFX Jr.
1 NAME Jacca R. /O'Example/ Jr.
2 TYPE recorded
1 NAME Jago R. /O'Example/
2 NSFX Jr.
2 TYPE recorded
1 SEX M
1 FAMC @F1@
1 FAMS @FC@
1 BIRT
2 DATE ABT 1914
2 SOUR @BIRTH@
3 _KEY child-birth
3 NOTE Age-derived birth; exact date unestablished.
1 SOUR @GENERAL@
0 @S@ INDI
1 REFN partner
2 TYPE jsonid
1 NAME Partner /Hendra/
1 SEX F
1 FAMS @FC@
0 @G@ INDI
1 REFN grandchild
2 TYPE jsonid
1 NAME Later /O'Example/
1 FAMC @FC@
0 @F0@ FAM
1 HUSB @P@
1 WIFE @M@
1 CHIL @R@
0 @F1@ FAM
1 HUSB @GF@
1 WIFE @GM@
1 CHIL @P@
1 CHIL @C@
0 @FC@ FAM
1 HUSB @C@
1 WIFE @S@
1 CHIL @G@
1 MARR
2 DATE 1939
0 @BIRTH@ SOUR
1 TITL Synthetic birth source
1 _TIER primary
0 @GENERAL@ SOUR
1 TITL Synthetic personal reference
1 _KEY personal-reference
1 _TIER primary
'''

    def assembler(self, text=None):
        a = TestExplicitCitationSupport().assembler(text or self.BASE)
        a.table = a.tree.ahnentafel('root')
        a.nums = a.tree.numbers_by_xref(a.table)
        a.warnings = []
        a.register_chapters = lambda: [({'title': 'Test family'},
                                        [{'refn': 'grandfather', 'ahnentafel': [4]}])]
        return a

    def test_primary_and_alternate_suffixes_parse_and_export_without_given_name_changes(self):
        for raw_name in ("1 NAME Jago Ruan /O'Example/ Jr.\n2 NSFX Jr.",
                         "1 NAME Jago Ruan /O'Example/ Jr.",
                         "1 NAME Jago Ruan /O'Example/\n2 NSFX Jr."):
            with self.subTest(name=raw_name):
                text = ("0 @I1@ INDI\n1 REFN subject\n2 TYPE jsonid\n" + raw_name +
                        "\n2 GIVN Must not replace the raw primary name\n"
                        "1 NAME Jacca R. /O'Example/ Jr.\n2 TYPE recorded\n"
                        "1 NAME Jago R. /O'Example/\n2 NSFX Jr.\n")
                p = fixture_tree(text).by_refn['subject']
                self.assertEqual((p['given'], p['surname'], p['suffix']),
                                 ('Jago Ruan', "O'Example", 'Jr.'))
                self.assertEqual([n['suffix'] for n in p['alternate_names']], ['Jr.', 'Jr.'])
                document = '0 HEAD\n1 CHAR UTF-8\n' + text + '0 TRLR\n'
                helper = TestEnrichmentPreservation()
                before = helper.record(helper.parse(document), '@I1@')
                after = helper.record(helper.parse(helper.export(document)), '@I1@')
                self.assertEqual([helper.signature(n) for n in helper.children(before, 'NAME')],
                                 [helper.signature(n) for n in helper.children(after, 'NAME')])

    def test_suffixless_primary_and_alternate_names_keep_existing_semantics(self):
        tree = fixture_tree("0 @I1@ INDI\n1 REFN subject\n2 TYPE jsonid\n"
                            "1 NAME Recorded /Person/\n2 GIVN Different\n"
                            "1 NAME Old /Spelling/\n2 GIVN Preferred\n2 TYPE recorded\n")
        p = tree.by_refn['subject']
        self.assertEqual((p['given'], p['surname']), ('Recorded', 'Person'))
        self.assertNotIn('suffix', p)
        self.assertEqual(p['alternate_names'],
                         [{'given': 'Preferred', 'surname': 'Spelling', 'type': 'recorded'}])
        self.assertEqual(assemble_mod.display_name(p), 'Recorded Person')
        self.assertEqual(bookcharts.name(p), 'Recorded Person')
        self.assertEqual(booklib.index_name(p), ('Person', 'Recorded'))
        helper = TestEnrichmentPreservation()
        document = tree.src_path.read_text()
        before = helper.record(helper.parse(document), '@I1@')
        after = helper.record(helper.parse(helper.export(document)), '@I1@')
        self.assertEqual([helper.signature(n) for n in helper.children(before, 'NAME')],
                         [helper.signature(n) for n in helper.children(after, 'NAME')])

    def test_collateral_suffix_and_aliases_keep_own_number_distinct_from_father(self):
        for suffix in (' Sr.', ''):
            with self.subTest(father_suffix=suffix):
                text = self.BASE.replace("/O'Example/ Sr.\n2 GIVN Jago R.\n2 SURN O'Example\n2 NSFX Sr.",
                                         "/O'Example/" + suffix)
                a = self.assembler(text)
                register = '\n'.join(a.register_entry({'refn': 'grandfather', 'ahnentafel': [4]}))
                index = a.name_index()
                self.assertIn("#smallcaps[Jago Ruan O'Example Jr.]", register)
                self.assertEqual(register.count('key: "child-birth"'), 1)
                self.assertIn('Age-derived birth; exact date unestablished.', register)
                for given in ('Jago Ruan', 'Jacca R.', 'Jago R.'):
                    self.assertEqual(a.index[("O'Example", given + ' Jr.')], {'under 4'})
                    self.assertIn("O'Example, " + given + ' Jr. — under 4', index)
                self.assertIn("O'Example, Jago R." + suffix + ' — *4*', index)
                self.assertIn("O'Example, Jago Ruan Senior — *4*", index)
                self.assertNotIn('@C@', a.nums)

    def test_suffix_reaches_family_headings_sources_appendix_and_parent_intro(self):
        a = self.assembler()
        register = '\n'.join(a.register_entry({'refn': 'grandfather', 'ahnentafel': [4]}))
        self.assertIn("=== 4. #smallcaps[Jago R. O'Example Sr.]", register)
        self.assertIn("Children of Jago R. O'Example Sr. and Morwen Example", register)
        self.assertIn("*Family of Jago Ruan O'Example Jr.*", register)
        self.assertIn("Recorded child of Jago Ruan O'Example Jr. and Partner Hendra", register)
        self.assertIn("=== under 4. #smallcaps[Jago Ruan O'Example Jr.]", a.register_references())
        self.assertIn("Jago R. O'Example Sr.", a.ahnentafel_table())

    def test_chart_ancestor_and_collateral_labels_retain_suffixes(self):
        a = self.assembler()
        graph = bookcharts.chapter_graph(a.tree, a.table, ["oexample"])
        self.assertEqual(graph['nodes'][4]['people'][0]['name'], "Jago R. O'Example Sr.")
        sibling, = graph['nodes'][4]['siblings']
        self.assertEqual((sibling['name'], sibling['label']),
                         ("Jago Ruan O'Example Jr.", 'Jago Ruan Jr.'))

    def test_person_references_and_claim_text_use_the_same_suffix(self):
        a = self.assembler()
        text = '#refp("collateral") appears here.'
        self.assertIn("Jago Ruan O'Example Jr.", a.process_prose(text, ['collateral'], 'test'))
        doc = claims_mod.Document(text, 'fixture.typ', ['collateral'], a.src_keys, a.tree, booklib.ROOT)
        doc.walk()
        self.assertEqual(doc.claims[0]['text'], "Jago Ruan O'Example Jr. appears here.")


class TestCollateralRegister(unittest.TestCase):
    """Nonancestor families retain identity, event ownership and a finite scope."""

    def test_state_level_collateral_birthplaces_use_in(self):
        for place in ('Idaho, United States', 'Wyoming, USA'):
            self.assertEqual(assemble_mod.place_phrase(place), 'in ' + place)
        self.assertEqual(assemble_mod.place_phrase('Boise, Idaho, USA'),
                         'at Boise, Idaho, USA')
        # Every state is a region, not a town (Pennsylvania, Maryland and
        # Virginia once printed "at").
        for place in ('Pennsylvania, USA', 'Maryland, USA', 'Virginia, USA', 'West Virginia, USA'):
            self.assertEqual(assemble_mod.place_phrase(place), 'in ' + place)
        self.assertEqual(assemble_mod.place_phrase('Washington, Pennsylvania, USA'),
                         'at Washington, Pennsylvania, USA')

    def test_scoped_child_and_family_breaks_preserve_union_content(self):
        a = self.assembler()
        a.cfg['chapters'][0].update(register_break_before_child=['grandchild'],
                                    register_break_before_collateral=['child'])
        reg = a.register()
        self.assertIn('#pagebreak(weak: true)\n\n#block(sticky: true)[*Family of Child Example*', reg)
        self.assertIn('#pagebreak(weak: true)\n\n#children([Recorded child of First and Child', reg)
        self.assertEqual(reg.count('first child union'), 1)
        self.assertEqual(reg.count('<reg-collateral-grandchild>'), 1)

    def test_misspelled_or_out_of_scope_breaks_fail(self):
        for field in ('register_break_before_child', 'register_break_before_collateral'):
            a = self.assembler()
            a.cfg['chapters'][0][field] = ['same-name-unrelated']
            with self.assertRaisesRegex(ValueError, 'Unused relative break targets'):
                a.register()

    def test_repeated_child_breaks_keep_original_numerals_and_one_continued_label(self):
        a = self.assembler()
        a._child_breaks = {'second-child', 'great-grandchild'}
        a._used_child_breaks = set()
        kids = [a.tree.by_refn[r] for r in ('grandchild', 'second-child', 'great-grandchild')]
        result = a.children_block(a.tree.by_refn['first-partner'], a.tree.by_refn['child'],
                                  kids, {'ahnentafel': [2]})
        self.assertEqual(result.count('#pagebreak(weak: true)'), 2)
        self.assertEqual(result.count('(continued)'), 2)
        self.assertNotIn('(continued) (continued)', result)
        for numeral in ('i', 'ii', 'iii'):
            self.assertIn(f'child-plain("{numeral}",', result)

    def assembler(self):
        base = TestExplicitCitationSupport.BASE
        base = base.replace('1 NAME Child /Example/', '1 NAME Child /Example/\n1 SEX F\n1 FAMS @F3@\n1 FAMS @F4@')
        base = base.replace('0 @F1@ FAM\n', '0 @F1@ FAM\n1 CHIL @I2@\n')
        base += '''0 @I5@ INDI
1 REFN first-partner
1 NAME First /Holder/
1 SEX M
1 FAMS @F3@
1 DEAT
2 DATE 1870
2 SOUR @PARTNERDEATH@
3 PAGE spouse death entry
0 @I6@ INDI
1 REFN grandchild
1 NAME Grand /Holder/
1 SEX F
1 FAMC @F3@
1 FAMS @F5@
1 SOUR @GENERAL@
0 @I7@ INDI
1 REFN second-partner
1 NAME Second /Later/
1 SEX M
1 FAMS @F4@
0 @I8@ INDI
1 REFN second-child
1 NAME Other /Later/
1 FAMC @F4@
0 @I9@ INDI
1 REFN grand-partner
1 NAME Spouse /Next/
1 SEX M
1 FAMS @F5@
0 @I10@ INDI
1 REFN great-grandchild
1 NAME Great /Next/
1 FAMC @F5@
1 SOUR @GENERAL@
0 @I11@ INDI
1 REFN same-name-unrelated
1 NAME Child /Example/
1 SEX F
1 FAMS @F6@
0 @I12@ INDI
1 REFN unrelated-spouse
1 NAME Stranger /Different/
1 SEX M
1 FAMS @F6@
0 @F3@ FAM
1 HUSB @I5@
1 WIFE @I2@
1 CHIL @I6@
1 MARR
2 DATE 1820
2 SOUR @M3@
3 PAGE first child union
1 DIV
2 DATE 1825
2 SOUR @D3@
3 PAGE first child divorce
0 @F4@ FAM
1 HUSB @I7@
1 WIFE @I2@
1 CHIL @I8@
1 MARR
2 DATE 1826
2 SOUR @M4@
3 PAGE second child union
0 @F5@ FAM
1 HUSB @I9@
1 WIFE @I6@
1 CHIL @I10@
1 MARR Y
0 @F6@ FAM
1 HUSB @I12@
1 WIFE @I11@
1 MARR Y
0 @M3@ SOUR
1 TITL First child marriage record
1 _KEY marriage-first
0 @D3@ SOUR
1 TITL First child divorce record
1 _KEY divorce-first
0 @M4@ SOUR
1 TITL Second child marriage record
1 _KEY marriage-second
0 @PARTNERDEATH@ SOUR
1 TITL Partner death record
1 _KEY partner-death
0 @GENERAL@ SOUR
1 TITL Descendant context
1 _KEY descendant-context
'''
        base = re.sub(r'(?m)^(1 REFN .+)\n(?!2 TYPE)', r'\1\n2 TYPE jsonid\n', base)
        a = TestExplicitCitationSupport().assembler(base)
        a.table = {2: '@I1@', 3: '@I3@'}
        a.cfg = {'chapters': [{'id': 'example', 'title': 'Example', 'lines': ['example']}]}
        a.cov['ancestors'] = {
            r: {'refn': r, 'line': 'example', 'generation': 1, 'ahnentafel': [n]}
            for n, r in ((2, 'father'), (3, 'first-wife'))}
        return a

    def two_chapter_assembler(self):
        """The same register, with the second wife in a later chapter."""
        a = self.assembler()
        a.cfg['chapters'].append({'id': 'other', 'title': 'Other', 'lines': ['other']})
        a.cov['ancestors']['second-wife'] = {'refn': 'second-wife', 'line': 'other',
                                            'generation': 1, 'ahnentafel': [5]}
        return a

    def test_each_union_keeps_its_children_divorce_and_citations(self):
        a = self.assembler()
        reg = a.register()
        first = reg.index('Child Example married in 1820, First Holder')
        second = reg.index('Child Example married in 1826, Second Later')
        one, two = reg[first:second], reg[second:]
        self.assertIn('first child union', one)
        self.assertIn('first child divorce', one)
        self.assertIn('Grand Holder', one)
        self.assertNotIn('second child union', one)
        self.assertIn('second child union', two)
        self.assertIn('Other Later', two)
        self.assertNotIn('first child divorce', two)
        self.assertIn('Recorded child of First and Child (Example) Holder', one)
        self.assertNotIn('Recorded child of Child and First', one)
        spouse = next(line for line in one.splitlines() if 'died in 1870' in line)
        self.assertIn('spouse death entry', spouse)
        self.assertNotIn('entry 7', spouse)
        self.assertIn('Family of Grand Holder', two)
        self.assertIn('Great Next', two)
        self.assertLess(reg.index('Father Example married in 1840,'), reg.index('Family of Child Example'))

    def test_union_without_marriage_event_never_becomes_marriage(self):
        for event in (None, False):
            with self.subTest(event=event):
                a = self.assembler()
                a.tree.fams['@F3@']['marr_recorded'] = event
                reg = a.register()
                self.assertIn('links Child Example and First Holder; no marriage event is recorded', reg)
                self.assertNotIn('Child Example married in 1820,', reg)
                self.assertNotIn('first child union', reg)
                self.assertIn('first child divorce', reg)
        base = TestExplicitCitationSupport.BASE.replace('1 MARR\n2 DATE 1820', '1 MARR N\n2 DATE 1820')
        self.assertFalse(fixture_tree(base).fams['@F1@']['marr_recorded'])
        a = self.assembler()
        self.assertTrue(a.tree.fams['@F5@']['marr_recorded'])
        self.assertIn('Grand Holder married Spouse Next.', a.register())

    def test_shared_and_cyclic_links_do_not_duplicate_continuations(self):
        a = self.assembler()
        a.tree.by_refn['child']['fams'].append('@F3@')
        a.tree.fams['@F5@']['chil'].extend(['@I2@', '@I1@', '@I5@'])
        a.tree.fams['@F4@']['chil'].append('@I6@')
        reg = a.register()
        self.assertEqual(reg.count('<family-child>'), 1)
        self.assertEqual(reg.count('<family-grandchild>'), 1)
        self.assertEqual(reg.count('first child union'), 1)
        self.assertEqual(reg.count('<reg-collateral-child>'), 1)
        self.assertNotIn('<family-father>', reg)
        refs = a.register_references()
        self.assertEqual(refs.count(' <sources-grandchild>'), 1)
        self.assertEqual(refs.count(' <sources-great-grandchild>'), 1)

    def test_married_aliases_use_person_identity_not_identical_names(self):
        a = self.assembler()
        a.register()
        a._augment_index_married_names()
        self.assertEqual(a.index[('Holder', 'Child (Example)')], {'under 2'})
        self.assertEqual(a.index[('Later', 'Child (Example)')], {'under 2'})
        self.assertNotIn(('Different', 'Child (Example)'), a.index)
        a.add_index(a.tree.by_refn['same-name-unrelated'], 'under 16')
        a._augment_index_married_names()
        self.assertEqual(a.index[('Different', 'Child (Example)')], {'under 16'})
        self.assertEqual(a.index[('Holder', 'Child (Example)')], {'under 2'})

    def test_descendant_sources_are_expected_independently_and_locatable(self):
        a = self.assembler()
        reg, refs = a.register(), a.register_references()
        expected = register_sources_mod.expected_keys(a.tree, 'father')
        self.assertIn(('great-grandchild', 'descendant-context'), expected)
        self.assertNotIn(('same-name-unrelated', 'descendant-context'), expected)
        self.assertIn('=== under 2. #smallcaps[Great Next] <sources-great-grandchild>', refs)
        self.assertIn('ref(<reg-collateral-great-grandchild>, form: "page")', refs)
        self.assertIn('<reg-collateral-great-grandchild>', reg)
        self.assertIn('ref(<sources-great-grandchild>, form: "page")', reg)
        # General context remains separate from the union's event proof.
        marriage = next(line for line in reg.splitlines() if 'Grand Holder married' in line)
        self.assertNotIn('Descendant context', marriage)
        repeat = a.fn('great-grandchild', ['descendant-context'], reg_no=8)
        self.assertIn('Sources for the Register, under 2', repeat)
        self.assertNotIn('no. under', repeat)

    def test_single_parent_continuation_keeps_the_known_parents_full_name(self):
        a = self.assembler()
        a.tree.fams['@F3@']['husb'] = None
        reg = a.register()
        self.assertIn('Recorded child of Child Example', reg)
        self.assertNotIn('Child Example married First Holder', reg)
        self.assertIn('Grand Holder', reg)


class TestNamedSpouseHouseholdRegister(unittest.TestCase):
    """A named spouse's recorded child has coverage, without importing ancestry."""

    def assembler(self):
        base = TestExplicitCitationSupport.BASE.replace(
            '1 NAME Second /Wife/\n1 FAMS @F2@',
            '1 NAME Second /Wife/\n1 FAMS @F2@\n1 FAMS @F3@\n'
            '1 FAMS @F5@\n1 FAMC @F4@')
        base += '''0 @I5@ INDI
1 REFN named-child
2 TYPE jsonid
1 NAME Named /Sample/
1 FAMC @F3@
1 SOUR @NAMEDCHILD@
0 @I6@ INDI
1 REFN spouse-parent-one
2 TYPE jsonid
1 NAME Unrelated /Ancestor/
1 FAMS @F4@
1 SOUR @NAMEDCHILD@
0 @I7@ INDI
1 REFN spouse-parent-two
2 TYPE jsonid
1 NAME Other /Ancestor/
1 FAMS @F4@
1 SOUR @NAMEDCHILD@
0 @I8@ INDI
1 REFN childless-partner
2 TYPE jsonid
1 NAME Separate /Partner/
1 FAMS @F5@
1 SOUR @NAMEDCHILD@
0 @F3@ FAM
1 WIFE @I4@
1 CHIL @I5@
1 SOUR @CHILDROLE@
0 @F4@ FAM
1 HUSB @I6@
1 WIFE @I7@
1 CHIL @I4@
0 @F5@ FAM
1 HUSB @I8@
1 WIFE @I4@
1 MARR Y
0 @NAMEDCHILD@ SOUR
1 TITL Named participant testimony
1 _KEY named-child-context
1 _TIER family-testimony
0 @CHILDROLE@ SOUR
1 TITL Reported single-parent role
1 _KEY single-parent-role
1 _TIER family-testimony
'''
        a = TestExplicitCitationSupport().assembler(base)
        a.table = {2: '@I1@', 3: '@I3@'}
        a.cfg = {'chapters': [{'id': 'example', 'title': 'Example', 'lines': ['example']}]}
        a.cov['ancestors'] = {
            r: {'refn': r, 'line': 'example', 'generation': 1, 'ahnentafel': [n]}
            for n, r in ((2, 'father'), (3, 'first-wife'))}
        return a

    def test_named_spouses_separate_child_has_own_register_references_and_index(self):
        a = self.assembler()
        reg, refs = a.register(), a.register_references()
        a.name_index()
        self.assertIn('Recorded child of Second Wife:', reg)
        self.assertEqual(reg.count('<reg-collateral-named-child>'), 1)
        self.assertEqual(refs.count(' <sources-named-child>'), 1)
        self.assertIn('ref(<reg-collateral-named-child>, form: "page")', refs)
        self.assertIn('ref(<sources-named-child>, form: "page")', reg)
        self.assertIn('Named participant testimony', refs)
        self.assertIn(('named-child', 'named-child-context'),
                      register_sources_mod.expected_keys(a.tree, 'father'))
        self.assertEqual(a.index[('Sample', 'Named')], {'under 2'})
        self.assertNotIn('@I5@', a.nums)
        self.assertNotIn('Children of Father and Second', reg)
        continuation = reg[reg.index('*Family of Second Wife*'):]
        self.assertNotRegex(continuation, r'(?i)\b(married|unknown|biological|adopted)\b')
        self.assertIsNone(a.tree.parents_of('@I5@')[0])
        self.assertEqual(a.tree.parents_of('@I5@')[1], '@I4@')

    def test_spouse_ancestry_and_separate_childless_union_stay_out_of_scope(self):
        a = self.assembler()
        reg, refs = a.register(), a.register_references()
        a.name_index()
        self.assertIn('Named Sample', reg)
        for refn in ('spouse-parent-one', 'spouse-parent-two', 'childless-partner'):
            self.assertNotIn(f'<reg-collateral-{refn}>', reg)
            self.assertNotIn(f'<sources-{refn}>', refs)
            self.assertNotIn(a.tree.by_refn[refn]['xref'], a.indexed_people)
        self.assertNotIn('Second Wife married Separate Partner', reg)
        expected = register_sources_mod.expected_keys(a.tree, 'father')
        self.assertIn(('named-child', 'named-child-context'), expected)
        self.assertFalse(any(refn in {'spouse-parent-one', 'spouse-parent-two', 'childless-partner'}
                             for refn, _key in expected))

    def test_duplicate_and_cyclic_spouse_child_links_have_one_continuation(self):
        a = self.assembler()
        a.tree.by_refn['second-wife']['fams'].append('@F3@')
        a.tree.by_refn['named-child']['fams'].append('@F3@')
        reg, refs = a.register(), a.register_references()
        self.assertEqual(reg.count('<family-second-wife>'), 1)
        self.assertEqual(reg.count('<reg-collateral-named-child>'), 1)
        self.assertEqual(refs.count(' <sources-named-child>'), 1)

    def test_limited_partner_visit_does_not_suppress_later_descendant_coverage(self):
        a = self.assembler()
        # Synthetic graph with a dual role: named partner and recorded child.
        # The compiler must honor both scopes, not treat the first as exhaustive.
        a.tree.fams['@F1@']['chil'].append('@I4@')
        reg, refs = a.register(), a.register_references()
        self.assertEqual(reg.count('<family-second-wife>'), 1)
        self.assertIn('Family of Second Wife (continued)', reg)
        self.assertIn('<reg-collateral-childless-partner>', reg)
        self.assertEqual(refs.count(' <sources-childless-partner>'), 1)
        self.assertIn(('childless-partner', 'named-child-context'),
                      register_sources_mod.expected_keys(a.tree, 'father'))


class TestBaptismRendering(unittest.TestCase):
    """Recorded baptisms must not disappear or turn into births."""

    def assembler(self):
        fixture = TestExplicitCitationSupport()
        text = fixture.BASE.replace(
            '1 DEAT\n2 DATE 1830\n2 SOUR @CHILDDEATH@\n3 PAGE entry 7\n3 QUAY 3',
            '1 BAPM\n2 DATE 22 JUN 1751\n2 PLAC Kirkton, Scotland\n'
            '2 SOUR @CHILDDEATH@\n3 PAGE baptism entry 7\n'
            '1 BAPM\n2 DATE 1767\n2 SOUR @LATER@\n3 PAGE later entry 8')
        text = text.replace('0 @F1@ FAM\n', '0 @F1@ FAM\n1 CHIL @I2@\n')
        text += ('0 @LATER@ SOUR\n1 TITL Later baptism record\n'
                 '1 _KEY later-baptism\n')
        return fixture.assembler(text)

    def test_baptism_dates_and_sources_stay_separate_from_birth(self):
        a = self.assembler()
        p = a.tree.by_refn['child']
        self.assertFalse(p['birth_date'])
        self.assertEqual([b['date'] for b in p['baptisms']], ['22 JUN 1751', '1767'])
        self.assertEqual(a.cites_by_fact('child')['birth'], [])
        self.assertEqual(a.cites_by_fact('child')['baptism'], ['child-register', 'later-baptism'])
        self.assertNotIn('child-register', a.cites_by_fact('child')['general'])

    def test_register_prints_each_baptism_with_its_own_source(self):
        a = self.assembler()
        result = '\n'.join(a.register_entry({'refn': 'child', 'ahnentafel': [4]}))
        self.assertIn('was baptized at Kirkton, Scotland, 22 June 1751', result)
        self.assertNotIn('was born', result)
        first, second = result.split('was baptized in 1767') if 'was baptized in 1767' in result else result.split('was baptized 1767')
        self.assertIn('baptism entry 7', first)
        self.assertNotIn('later entry 8', first)
        self.assertIn('later entry 8', second)
        self.assertNotIn('baptism entry 7', second)

    def test_collateral_child_retains_baptism_without_a_birth_date(self):
        a = self.assembler()
        result = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))
        self.assertIn('bp. 22 June 1751', result)
        self.assertIn('bp. 1767', result)
        self.assertIn('baptism entry 7', result)
        self.assertIn('later entry 8', result)
        self.assertNotIn('b. 22 June 1751', result)

    def test_validator_counts_baptism_and_spousal_family_sources(self):
        a = self.assembler()
        parser = a.tree._parser
        records = {e.get_pointer(): e for e in parser.get_root_child_elements()
                   if e.get_pointer()}
        child = validate_mod.collect_indi_data(records['@I2@'], records)
        wife = validate_mod.collect_indi_data(records['@I3@'], records)
        self.assertIn('__SOUR_REF__@CHILDDEATH@', child['sources'])
        self.assertIn('__SOUR_REF__@LATER@', child['sources'])
        self.assertIn('__SOUR_REF__@FIRST@', wife['sources'])
        self.assertNotIn('__SOUR_REF__@CHILDDEATH@', wife['sources'])

    def test_one_register_source_can_support_birth_and_baptism_separately(self):
        fixture = TestExplicitCitationSupport()
        text = fixture.BASE.replace(
            '1 DEAT\n2 DATE 1830\n2 SOUR @CHILDDEATH@\n3 PAGE entry 7\n3 QUAY 3',
            '1 BIRT\n2 DATE 14 JUN 1751\n2 SOUR @CHILDDEATH@\n3 PAGE entry 7\n'
            '1 BAPM\n2 DATE 22 JUN 1751\n2 SOUR @CHILDDEATH@\n3 PAGE entry 7')
        a = fixture.assembler(text)
        result = '\n'.join(a.register_entry({'refn': 'child', 'ahnentafel': [4]}))
        birth, baptism = result.split('was baptized')
        self.assertIn('14 June 1751#footnote[', birth)
        self.assertIn('22 June 1751#footnote[', baptism)
        self.assertIn('entry 7', birth)
        self.assertIn('entry 7', baptism)


class TestBurialRendering(unittest.TestCase):
    """Burial evidence keeps its dates, uncertainty, subject, and locators."""

    def assembler(self, event=None):
        fixture = TestExplicitCitationSupport()
        event = event if event is not None else '''1 BURI
2 DATE 3 APR 1830
2 PLAC Orchard Cemetery, Example County (lot 7)
2 SOUR @BURIAL@
3 PAGE burial ledger, page 9, row 4
'''
        text = fixture.BASE.replace('1 NAME Child /Example/\n',
                                    '1 NAME Child /Example/\n' + event)
        text = text.replace('1 MARR\n2 DATE 1820',
                            '1 CHIL @I2@\n1 MARR\n2 DATE 1820')
        text += '''0 @BURIAL@ SOUR
1 TITL Cemetery register
1 ABBR Burial ledger
1 _KEY burial-ledger
1 _TIER primary
'''
        return fixture.assembler(text)

    def entry(self, a):
        return '\n'.join(a.register_entry({'refn': 'child', 'ahnentafel': [4]}))

    def test_burial_page_boundary_preserves_words_sources_and_order(self):
        def without_layout(lines):
            controls = {'#block(breakable: false)[', ']', '#pagebreak(weak: true)'}
            return ' '.join(' '.join(line for line in lines if line not in controls).split())

        for event, label in [('1 BURI', 'Burial was recorded'),
                             ('1 BURI\n2 TYPE Reported burial', 'Burial is reported'),
                             ('1 EVEN\n2 TYPE Planned burial', 'Burial was planned')]:
            with self.subTest(label=label):
                event += '\n2 DATE 3 APR 1830\n2 PLAC Orchard Cemetery\n2 SOUR @BURIAL@\n3 PAGE row 4\n'
                row = {'refn': 'child', 'ahnentafel': [4]}
                before = self.assembler(event).register_entry(row)
                after = self.assembler(event).register_entry(row, break_before_burial=True)
                self.assertEqual(without_layout(before), without_layout(after))
                first, second = '\n'.join(after).split('#pagebreak(weak: true)')
                self.assertIn('entry 7', first)  # the death citation stays with death
                self.assertNotIn('row 4', first)
                self.assertIn(label, second)
                self.assertIn('3 April 1830.#footnote[', second)
                self.assertIn('row 4', second)

    def test_burial_page_boundary_keeps_marriage_and_child_continuation(self):
        fixture = TestExplicitCitationSupport()
        text = fixture.BASE.replace('1 DEAT\n2 DATE 1880\n', '1 DEAT\n2 DATE 1880\n1 BURI\n'
                                    '2 TYPE Reported burial\n2 PLAC Orchard Cemetery\n')
        text = text.replace('1 MARR\n2 DATE 1820', '1 CHIL @I2@\n1 MARR\n2 DATE 1820')
        row = {'refn': 'father', 'ahnentafel': [2]}
        result = '\n'.join(fixture.assembler(text).register_entry(row, break_before_burial=True))
        burial = result.index('Burial is reported')
        marriage = result.index('He married')
        children = result.index('#children(')
        self.assertLess(result.index('#pagebreak(weak: true)'), burial)
        self.assertLess(burial, marriage)
        self.assertLess(marriage, children)

    def test_burial_page_boundary_rejects_invalid_targets(self):
        for target, message in [('second-wife', 'outside example'),
                                ('missing-person', 'outside example'),
                                ('father', 'has no burial events')]:
            with self.subTest(target=target):
                a = TestCollateralRegister().two_chapter_assembler()
                if message == 'has no burial events':
                    a.tree.by_refn[target]['burials'] = []
                ch = next(c for c in a.cfg['chapters'] if c['id'] == 'example')
                ch['register_break_before_burial'] = [target]
                with self.assertRaisesRegex(ValueError, message):
                    a.register()

    def test_burial_keeps_its_own_date_place_plot_and_citation(self):
        a = self.assembler()
        result = self.entry(a)
        death, burial = result.split('Burial was recorded')
        self.assertIn('1830#footnote[', death)
        self.assertIn('entry 7', death)
        self.assertNotIn('burial ledger, page 9', death)
        self.assertIn('Orchard Cemetery, Example County (lot 7)', burial)
        self.assertIn('3 April 1830.#footnote[', burial)
        self.assertIn('burial ledger, page 9, row 4', burial)
        self.assertNotIn('entry 7', burial)
        self.assertEqual(a.cites_by_fact('child')['burial'], ['burial-ledger'])
        self.assertNotIn('burial-ledger', a.cites_by_fact('child')['general'])
        self.assertEqual(a.cites_by_fact('father')['burial'], [])

    def test_missing_burial_date_never_uses_death_date(self):
        a = self.assembler('1 BURI\n2 PLAC Orchard Cemetery\n2 SOUR @BURIAL@\n')
        self.assertEqual(a.tree.by_refn['child']['burials'][0]['date'], '')
        burial = self.entry(a).split('Burial was recorded')[1]
        self.assertIn('Orchard Cemetery.#footnote[', burial)
        self.assertNotIn('1830', burial)

    def test_year_only_and_occurrence_only_burials(self):
        a = self.assembler('1 BURI\n2 DATE 1831\n2 SOUR @BURIAL@\n')
        self.assertIn('Burial was recorded in 1831.#footnote[', self.entry(a))
        a = self.assembler('1 BURI Y\n2 SOUR @BURIAL@\n')
        self.assertIn('Burial was recorded.#footnote[', self.entry(a))

    def test_multiple_interments_keep_separate_sources(self):
        a = self.assembler('''1 BURI
2 DATE 1830
2 PLAC First Cemetery
2 SOUR @BURIAL@
3 PAGE first interment, row 1
1 BURI
2 TYPE Reinterment
2 DATE 1860
2 PLAC Second Cemetery
2 SOUR @BURIAL@
3 _KEY reinterment-ledger
3 PAGE reinterment, row 99
''')
        first, second = self.entry(a).split('Burial was recorded')[1:]
        self.assertIn('First Cemetery in 1830', first)
        self.assertIn('first interment, row 1', first)
        self.assertNotIn('row 99', first)
        self.assertIn('Second Cemetery in 1860', second)
        self.assertIn('reinterment, row 99', second)
        self.assertNotIn('row 1', second)

    def test_reported_and_planned_are_explicit_not_title_inferences(self):
        for event, phrase in [('BURI\n2 TYPE Reported burial', 'Burial is reported'),
                              ('EVEN\n2 TYPE Planned burial', 'Burial was planned')]:
            with self.subTest(event=event):
                a = self.assembler('1 '+event+'\n2 PLAC Orchard Cemetery\n2 SOUR @BURIAL@\n')
                self.assertIn(phrase+' at Orchard Cemetery.#footnote[', self.entry(a))
                self.assertEqual(a.cites_by_fact('child')['burial'], ['burial-ledger'])
        a = self.assembler()
        a.src_keys['child']['burial-ledger']['label'] = 'Planned burial announcement'
        self.assertIn('Burial was recorded', self.entry(a))
        a = self.assembler('1 EVEN\n2 TYPE Funeral\n2 DATE 1830\n2 SOUR @BURIAL@\n')
        self.assertEqual(a.tree.by_refn['child']['burials'], [])
        self.assertEqual(a.cites_by_fact('child')['burial'], [])
        self.assertIn('burial-ledger', a.cites_by_fact('child')['general'])

    def test_notes_only_event_does_not_assert_occurrence_or_lose_source(self):
        a = self.assembler('1 BURI\n2 NOTE Burial place unknown\n2 SOUR @BURIAL@\n')
        self.assertEqual(a.tree.by_refn['child']['burials'], [])
        self.assertNotIn('Burial was recorded', self.entry(a))
        self.assertIn('burial-ledger', a.cites_by_fact('child')['general'])

    def test_nested_note_does_not_certify_burial(self):
        a = self.assembler('1 BURI\n2 PLAC Orchard Cemetery\n2 NOTE Research context\n3 SOUR @BURIAL@\n')
        self.assertEqual(a.tree.by_refn['child']['burials'][0]['source_keys'], [])
        self.assertEqual(a.cites_by_fact('child')['burial'], [])
        self.assertIn('burial-ledger', a.cites_by_fact('child')['general'])

    def test_invalid_burial_and_plan_encoding_fail(self):
        with self.assertRaisesRegex(ValueError, 'BURI supports only'):
            self.assembler('1 BURI N\n')
        with self.assertRaisesRegex(ValueError, 'Planned burial must use EVEN'):
            self.assembler('1 BURI\n2 TYPE Planned burial\n2 PLAC Orchard Cemetery\n')

    def test_person_with_only_burial_still_gets_the_event(self):
        a = self.assembler()
        p = dict(a.tree.by_refn['child'], death_date='', death_place='')
        result = a.vitals(p, {'burials': ['#footnote[ledger]']})
        self.assertIn('*#smallcaps[Child Example]*. Burial was recorded', result)
        self.assertIn('3 April 1830.#footnote[ledger]', result)

    def test_a_birth_with_only_a_citation_keeps_its_note(self):
        a = self.assembler()
        p = dict(a.tree.by_refn['child'], birth_date='', birth_place='')
        result = a.vitals(p, {'birth': '#footnote[register]', 'death': '#footnote[stone]'})
        self.assertIn('*#smallcaps[Child Example]* was born#footnote[register] and died', result)
        self.assertIn('#footnote[stone]', result)

    def test_collateral_child_gets_burial_but_carried_child_does_not_repeat_it(self):
        a = self.assembler()
        result = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))
        child = next(line for line in result.splitlines() if 'child-plain' in line)
        self.assertIn('bur. Orchard Cemetery', child)
        self.assertIn('burial ledger, page 9, row 4', child)
        a = self.assembler()
        a.nums['@I2@'] = [4]
        result = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))
        self.assertNotIn('Orchard Cemetery', result)
        self.assertIn('Orchard Cemetery', self.entry(a))

    def test_planned_and_reported_events_survive_export(self):
        text = '''0 HEAD
1 CHAR UTF-8
0 @I1@ INDI
1 REFN example
1 NAME Example /Person/
1 EVEN
2 TYPE Planned burial
2 DATE 27 FEB 1938
2 PLAC Planned Cemetery
2 SOUR @S1@
3 PAGE announcement, page 6B
1 BURI
2 TYPE Reported burial
2 PLAC Reported Cemetery
2 SOUR @S1@
3 PAGE later memorial
0 @S1@ SOUR
1 TITL Evidence
1 _KEY evidence
0 TRLR
'''
        preservation = TestEnrichmentPreservation()
        before = preservation.record(preservation.parse(text), '@I1@')
        after = preservation.record(preservation.parse(preservation.export(text)), '@I1@')
        for tag in ('EVEN', 'BURI'):
            self.assertEqual([x.to_gedcom_string(recursive=True) for x in preservation.children(before, tag)],
                             [x.to_gedcom_string(recursive=True) for x in preservation.children(after, tag)])


class TestContinuousNarrative(unittest.TestCase):
    """A chapter may span generations while retaining subject-specific sources."""

    def test_register_break_keeps_complete_entry_and_order(self):
        before = TestCollateralRegister().assembler().register()
        a = TestCollateralRegister().assembler()
        a.cfg['chapters'][0]['register_break_before'] = ['first-wife']
        after = a.register()
        strip_breaks = lambda text: text.replace('#pagebreak(weak: true)\n\n', '')
        self.assertEqual(strip_breaks(after), strip_breaks(before))
        self.assertIn('#pagebreak(weak: true)\n\n#block(breakable: false)[\n'
                      '=== 3. #smallcaps[First Wife]', after)

    def test_register_break_rejects_wrong_chapter_or_unknown_target(self):
        for target in ('second-wife', 'missing-person'):
            with self.subTest(target=target):
                a = TestCollateralRegister().two_chapter_assembler()
                a.cfg['chapters'][0]['register_break_before'] = [target]
                with self.assertRaisesRegex(ValueError, 'Register break targets outside example'):
                    a.register()

    def narrative(self, assembler):
        # These checks must also run before a book has been built locally.
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            bookcharts.generate(assembler.tree, assembler.cfg, directory)
            with patch.object(assemble_mod, 'FIGURES', directory):
                return assembler.narrative()

    def test_qualified_source_chooses_the_named_person(self):
        a = TestExplicitCitationSupport().assembler()
        a.warnings = []
        original = dict(a.src_keys['father']['child-register'])
        a.src_keys['father']['shared-key'] = dict(original, label='Father evidence')
        a.src_keys['child']['shared-key'] = dict(original, label='Child evidence')
        result = a.process_prose('#src("child::shared-key")', ['father', 'child'], 'fixture')
        self.assertIn('Child evidence', result)
        self.assertNotIn('Father evidence', result)
        self.assertEqual(a.warnings, [])
        self.assertTrue(coverage_mod.CITE_RE.fullmatch('#src("child::shared-key")'))

    def test_parentage_only_family_does_not_invent_another_marriage(self):
        fixture = TestExplicitCitationSupport()
        a = fixture.assembler(fixture.BASE.replace('1 WIFE @I4@\n', ''))
        result = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))
        self.assertEqual(result.count('He married'), 1)
        self.assertNotIn('He married, first', result)

    def test_qualified_source_cannot_escape_the_sections_people(self):
        a = TestExplicitCitationSupport().assembler()
        a.warnings = []
        result = a.process_prose('#src("child::child-register")', ['father'], 'fixture')
        self.assertIn('unresolved citation', result)
        self.assertEqual(len(a.warnings), 1)

    def test_prose_keeps_repeated_claim_notes_and_separates_adjacent_markers(self):
        a = TestExplicitCitationSupport().assembler()
        a.warnings = []
        citation = '#src("father::child-register")'
        separate = a.process_prose('First claim.' + citation + '\n\nSecond claim.' + citation,
                                   ['father'], 'fixture')
        self.assertEqual(separate.count('#footnote['), 2)
        duplicate = a.process_prose(citation + citation, ['father'], 'fixture')
        self.assertEqual(duplicate.count('#footnote['), 1)
        distinct = a.process_prose(citation + '#src("father::first-union")', ['father'], 'fixture')
        self.assertEqual(distinct.count('#footnote['), 2)
        self.assertIn(']#super[, ]#footnote[', distinct)

    def test_person_reference_targets_its_own_register_entry(self):
        # A chapter's primary person can cover relatives in other generations.
        # Every referenced person's number must still link to that person's
        # separate register entry, including two parents in the same chapter.
        a = assemble_mod.Assembler()
        register = a.register()
        entries = set(re.findall(r'^=== .*<reg-([^>]+)>$', register, flags=re.M))
        covered_by_someone_else = [refn for refn in entries
                                   if a.reg_anchor.get(refn, refn) != refn]
        if len(covered_by_someone_else) < 2:
            self.skipTest("this family's book has no story that covers several people")
        for refn in sorted(entries):
            with self.subTest(refn=refn):
                rendered = a.process_prose(f'#refp("{refn}")', [refn], 'reference check')
                destination, = re.findall(r'#link\(<reg-([^>]+)>\)', rendered)
                self.assertEqual(destination, refn)
                self.assertIn(f'(no.\u00a0{a.num_of_refn(refn)})', rendered)
        self.assertEqual(a.warnings, [])

    def test_continuous_chapter_preserves_register_and_narrative_links(self):
        a = assemble_mod.Assembler()
        narrative = self.narrative(a)
        register = a.register()
        people = set(a.cov['ancestors'])
        self.assertEqual(a.cov['errors'], [])
        entries = re.findall(r'^=== .*<reg-([^>]+)>$', register, flags=re.M)
        self.assertEqual(set(entries), people)
        self.assertEqual(len(entries), len(people))
        targets = set(re.findall(r'<nar-([^>]+)>', narrative))
        links = set(re.findall(r'#link\(<nar-([^>]+)>\)', register))
        self.assertTrue(links <= targets)
        # A continuous section keeps a link target in place of its heading.
        for section in a.cov['sections']:
            refn = section['meta'].get('refn')
            if section['meta'].get('continuous') == 'true' and refn in people:
                self.assertIn(f'#metadata(none) <nar-{refn}>', narrative)
        self.assertEqual(a.warnings, [])

    def test_change_to_any_covered_person_stales_the_chapter(self):
        a = assemble_mod.Assembler()
        section = next((s for s in a.cov['sections']
                        if len(s['covers']) > 1 and s['meta'].get('refn') in a.cov['ancestors']), None)
        if section is None:
            self.skipTest("this family's book has no story that covers several people")
        refn, other = section['meta']['refn'], section['covers'][1]
        for person in a.cov['states']:
            a.cov['states'][person] = 'draft'
        a.cov['states'][other] = 'stale'
        narrative = self.narrative(a)
        start = narrative.index(f'<nar-{refn}>')
        end = narrative.find('<nar-', start + 1)
        self.assertIn('updated since this prose was written',
                      narrative[start:end if end > 0 else None])


class TestRegisterFamilyEvents(unittest.TestCase):
    def test_later_unrecorded_marriage_names_subject_after_child_block(self):
        for missing_partner in (False, True):
            with self.subTest(missing_earlier_partner=missing_partner):
                a = TestExplicitCitationSupport().assembler()
                a.tree.fams['@F1@']['chil'].append('@I2@')
                if missing_partner:
                    a.tree.fams['@F1@']['wife'] = None
                a.tree.fams['@F2@']['marr_recorded'] = False
                result = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))
                child_at = result.index('Child Example')
                partner = next(line for line in result[child_at:].splitlines()
                               if 'Second Wife' in line)
                self.assertTrue(partner.startswith('Partner of Father Example: '))
                self.assertIn('Second Wife', partner)
                self.assertNotIn('married', partner)
                self.assertNotIn('1840', partner)
                self.assertNotIn('second marriage entry', partner)

    def test_first_unrecorded_marriage_keeps_plain_partner_without_claim(self):
        a = TestExplicitCitationSupport().assembler()
        a.tree.fams['@F1@']['marr_recorded'] = False
        result = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))
        partner = next(line for line in result.splitlines() if 'First Wife' in line)
        self.assertTrue(partner.startswith('Partner:'))
        self.assertNotIn('Partner of', partner)
        self.assertNotIn('married', partner)
        self.assertNotIn('1820', partner)
        self.assertNotIn('first marriage entry', partner)

    def test_recorded_later_partner_retains_subject_without_marriage_claim(self):
        # A minimal name and family projection: the later family has no MARR,
        # and other vitals and sources are omitted.
        text = '''0 @I1@ INDI
1 REFN lowen-sample
2 TYPE jsonid
1 NAME Lowen Petroc /Sample/
2 GIVN Lowen Petroc
2 SURN Sample
1 SEX M
1 FAMS @F1@
1 FAMS @F2@
0 @I2@ INDI
1 REFN senara-holder
2 TYPE jsonid
1 NAME Senara Wynn /Holder/
2 GIVN Senara Wynn
2 SURN Holder
1 SEX F
1 FAMS @F1@
0 @I3@ INDI
1 REFN cador-sample
2 TYPE jsonid
1 NAME Cador Austell /Sample/
2 GIVN Cador Austell
2 SURN Sample
1 SEX M
1 FAMC @F1@
0 @I4@ INDI
1 REFN elowen-sample
2 TYPE jsonid
1 NAME Elowen /Sample/
2 GIVN Elowen
2 SURN Sample
1 SEX F
1 FAMC @F1@
0 @I5@ INDI
1 REFN morvoren-later
2 TYPE jsonid
1 NAME Morvoren Jenna /Later/
2 GIVN Morvoren Jenna
2 SURN Later
1 SEX F
1 FAMS @F2@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 9 MAY 1953
1 CHIL @I3@
1 CHIL @I4@
0 @F2@ FAM
1 HUSB @I1@
1 WIFE @I5@
'''
        a = TestExplicitCitationSupport().assembler(text)
        a.nums = {'@I1@': [4], '@I2@': [5], '@I3@': [2]}
        families_before = copy.deepcopy(a.tree.fams)
        result = '\n'.join(a.register_entry({'refn': 'lowen-sample', 'ahnentafel': [4]}))
        child_at = result.index('Elowen Sample')
        partner = next(line for line in result[child_at:].splitlines()
                       if 'Morvoren Jenna Later' in line)
        self.assertTrue(partner.startswith('Partner of Lowen Petroc Sample: Morvoren Jenna Later.'))
        self.assertNotIn('married', partner)
        self.assertNotIn('date', partner)
        self.assertEqual(a.tree.fams, families_before)
        self.assertFalse(a.tree.fams['@F2@']['marr_recorded'])

    def test_subsequent_numbered_unions_restate_recorded_subject_after_children(self):
        a = TestExplicitCitationSupport().assembler()
        a.tree.fams['@F1@']['chil'].append('@I2@')
        result = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))
        child_at = result.index('Child Example')
        second = next(line for line in result[child_at:].splitlines()
                      if 'second marriage entry' in line)
        self.assertTrue(second.startswith('Father Example married in 1840,'))
        self.assertNotIn('He married', second)
        self.assertNotIn('first marriage entry', second)

    def test_missing_partner_child_block_cannot_reset_later_marriage_to_pronoun(self):
        a = TestExplicitCitationSupport().assembler()
        a.tree.fams['@F1@']['wife'] = None
        a.tree.fams['@F1@']['chil'].append('@I2@')
        result = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))
        self.assertIn('Recorded child of Father Example:', result)
        second = next(line for line in result.splitlines() if 'second marriage entry' in line)
        self.assertTrue(second.startswith('Father Example married in 1840,'))
        self.assertNotIn('He married', second)
        self.assertNotIn('unknown spouse', result.lower())
        self.assertNotIn('first marriage entry', result)

    def test_first_numbered_union_keeps_explicit_pronoun_with_immediate_subject(self):
        for sex, subject in [('M', 'He'), ('F', 'She')]:
            with self.subTest(sex=sex):
                a = TestExplicitCitationSupport().assembler()
                a.tree.by_refn['father']['sex'] = sex
                result = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))
                first = next(line for line in result.splitlines() if 'first marriage entry' in line)
                self.assertTrue(first.startswith(subject + ' married in 1820,'))

    def test_recorded_marriage_list_never_implies_an_exhaustive_ordinal(self):
        for reverse in (False, True):
            with self.subTest(reverse=reverse):
                a = TestExplicitCitationSupport().assembler()
                if reverse:
                    a.tree.by_refn['father']['fams'].reverse()
                result = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))
                self.assertEqual(result.count('He married'), 1)
                self.assertEqual(result.count('Father Example married'), 1)
                self.assertNotRegex(result, r'married, (?:first|second|third|fourth),')
                self.assertIn('first marriage entry', result)
                self.assertIn('second marriage entry', result)
                self.assertIn(' <reg-collateral-second-wife>', result)

    def test_unknown_sex_main_entry_uses_name_without_inventing_sex(self):
        for sex in ('', None, 'U', 'X'):
            with self.subTest(sex=sex):
                a = TestExplicitCitationSupport().assembler()
                a.tree.by_refn['father']['sex'] = sex
                result = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))
                self.assertIn('Father Example married', result)
                self.assertNotIn('She married', result)
                self.assertNotIn('He married', result)
                self.assertEqual(a.tree.by_refn['father']['sex'], sex)

    def test_explicit_source_marriage_order_wording_remains_in_its_citation(self):
        text = TestExplicitCitationSupport.BASE.replace(
            '3 PAGE second marriage entry',
            '3 PAGE source calls this the fifth marriage; other marriages unspecified')
        a = TestExplicitCitationSupport().assembler(text)
        result = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))
        self.assertIn('source calls this the fifth marriage; other marriages unspecified', result)
        self.assertNotIn('married, second,', result)

    def test_numbered_entry_does_not_infer_marriage_or_ordinals_from_family_link(self):
        for absent in ('@F1@', '@F2@'):
            with self.subTest(absent=absent):
                a = TestExplicitCitationSupport().assembler()
                a.tree.fams['@F1@']['chil'].append('@I2@')
                a.tree.fams[absent]['marr_recorded'] = False
                result = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))
                self.assertEqual(len(re.findall(r'(?m)^Partner(?: of [^:\n]+)?:', result)), 1)
                self.assertEqual(len(re.findall(r'(?m)^(?:He|Father Example) married', result)), 1)
                self.assertNotIn('He married, first', result)
                self.assertNotIn('He married, second', result)
                self.assertIn('First Wife', result)
                self.assertIn('Second Wife', result)
                self.assertIn('Child Example', result)
                self.assertIn('[no. 3]', result)
                self.assertIn('second-wife', result)
                # A missing structured event cannot deny evidence in other notes.
                self.assertNotIn('no marriage', result)
                self.assertNotIn('first marriage entry' if absent == '@F1@'
                                 else 'second marriage entry', result)

    def assembler(self):
        fixture = TestExplicitCitationSupport()
        text = fixture.BASE.replace('0 @F2@ FAM', '''1 DIV
2 DATE 1830
2 PLAC First Court, Example County
2 SOUR @DIV1@
3 PAGE first decree, page 2
0 @F2@ FAM''').replace('0 @CHILDDEATH@ SOUR', '''1 DIV
2 DATE 1850
2 PLAC Second Court, Example County
2 SOUR @DIV2@
3 PAGE second decree, page 5
0 @CHILDDEATH@ SOUR''')
        text += '''0 @DIV1@ SOUR
1 TITL First divorce register
1 _KEY first-divorce
0 @DIV2@ SOUR
1 TITL Second divorce register
1 _KEY second-divorce
'''
        return fixture.assembler(text)

    def test_divorce_dates_places_and_citations_stay_with_their_own_union(self):
        a = self.assembler()
        lines = a.register_entry({'refn': 'father', 'ahnentafel': [2]})
        divorce_lines = [line for line in lines if 'Their divorce was recorded' in line]
        self.assertEqual(len(divorce_lines), 2)
        for line, court, year, page, other in (
            (divorce_lines[0], 'First Court', '1830', 'first decree, page 2', 'second decree'),
            (divorce_lines[1], 'Second Court', '1850', 'second decree, page 5', 'first decree')):
            self.assertIn(court, line)
            self.assertIn(year, line)
            self.assertIn(page, line)
            self.assertNotIn(other, line)
        result = '\n'.join(lines)
        self.assertLess(result.index('He married in 1820,'), result.index(divorce_lines[0]))
        self.assertLess(result.index(divorce_lines[0]), result.index('Father Example married in 1840,'))
        self.assertLess(result.index('Father Example married in 1840,'), result.index(divorce_lines[1]))
        self.assertNotIn('first-divorce', a.cites_by_fact('father')['general'])
        self.assertEqual(a.cites_by_fact('father')['divorce'], ['first-divorce', 'second-divorce'])
        self.assertEqual(a.src_keys['first-wife']['first-divorce']['facts'],
                         [{'kind': 'divorce', 'family': '@F1@'}])

    def test_marriage_page_break_preserves_all_union_text_and_citations(self):
        row = {'refn': 'father', 'ahnentafel': [2]}
        before = self.assembler().register_entry(row)
        after = self.assembler().register_entry(row, break_before_marriage=True)
        self.assertEqual(after.count('#pagebreak(weak: true)'), 1)
        break_at = after.index('#pagebreak(weak: true)')
        self.assertTrue(next(line for line in after[break_at + 1:] if line).startswith('He married'))
        del after[break_at:break_at + 2]
        self.assertEqual(after, before)

    def test_marriage_page_break_rejects_an_entry_without_its_own_marriage(self):
        with self.assertRaisesRegex(ValueError, 'no rendered marriage'):
            self.assembler().register_entry({'refn': 'first-wife', 'ahnentafel': [3]},
                                            break_before_marriage=True)

    def test_index_letters_are_kept_with_the_first_entry_and_preserve_every_reference(self):
        a = self.assembler()
        a.table = {}
        a.index = {('Alpha', 'Ada'): {'2'}, ('Alpha', 'Ben'): {'under 2'},
                   ('Jones', 'Jo'): {'8'}, ('Zed', 'Zoe'): {'under 8'}}
        result = a.name_index()
        groups = re.findall(r'#block\(breakable: false, above: 1.1em, below: auto\)\[(.*?)\n\]',
                            result, re.S)
        self.assertEqual(len(groups), 3)
        for group, letter, first in zip(groups, ['A', 'J', 'Z'],
                                       ['Alpha, Ada', 'Jones, Jo', 'Zed, Zoe']):
            self.assertIn(f'*{letter}*', group)
            self.assertIn(first + ' — ', group)
            self.assertEqual(group.count(' — '), 1)
        self.assertEqual(result.count(' — '), 4)
        self.assertIn('Alpha, Ben — under 2', result)

    @unittest.skipUnless(shutil.which('typst') and shutil.which('pdftotext'),
                         'Typst and poppler required for index spacing')
    def test_index_first_entry_keeps_normal_spacing_before_the_second(self):
        a = self.assembler()
        a.table = {}
        a.index = {('Alpha', given): {'under 2'} for given in ['Ada', 'Ben', 'Cora']}
        with tempfile.TemporaryDirectory(dir=booklib.ROOT) as tmp:
            src = Path(tmp) / 'index.typ'
            pdf = src.with_suffix('.pdf')
            src.write_text(IMPORT + ': *\n'
                           '#show: book.with(title: "Index spacing")\n' + a.name_index())
            proc = subprocess.run(['typst', 'compile', str(src), str(pdf),
                                   '--root', str(booklib.ROOT)], capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            proc = subprocess.run(['pdftotext', '-bbox-layout', str(pdf), '-'],
                                  capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            ns = {'x': 'http://www.w3.org/1999/xhtml'}
            lines = {' '.join(w.text or '' for w in line.findall('x:word', ns)): line
                     for line in ET.fromstring(proc.stdout).findall('.//x:line', ns)}
            rows = [next(line for text, line in lines.items() if text.startswith('Alpha, ' + given))
                    for given in ['Ada', 'Ben', 'Cora']]
            starts = [float(row.get('yMin')) for row in rows]
            self.assertAlmostEqual(starts[1] - starts[0], starts[2] - starts[1], delta=0.2)
            self.assertGreater(float(rows[1].get('yMin')) - float(rows[0].get('yMax')), 1)

    def test_second_numbered_spouse_does_not_repeat_the_couples_event(self):
        a = self.assembler()
        result = '\n'.join(a.register_entry({'refn': 'first-wife', 'ahnentafel': [3]}))
        self.assertNotIn('divorce was recorded', result)
        self.assertNotIn('first decree', result)

    def test_undated_divorce_is_not_dropped_or_assigned_the_marriage_date(self):
        a = self.assembler()
        event = a.tree.fams['@F1@']['divorces'][0]
        event['date'] = event['place'] = ''
        result = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))
        line = next(line for line in result.splitlines() if line.startswith('Their divorce was recorded.'))
        self.assertIn('first decree', line)
        self.assertNotIn('1820', line)

    def test_source_words_do_not_invent_a_divorce(self):
        fixture = TestExplicitCitationSupport()
        a = fixture.assembler(fixture.BASE.replace('First union record', 'A divorce index used for a marriage fact'))
        result = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))
        self.assertNotIn('divorce was recorded', result)
        self.assertEqual(a.cites_by_fact('father')['divorce'], [])

    def test_wife_carries_event_when_spouse_is_not_in_the_ancestor_table(self):
        a = self.assembler()
        a.nums.pop('@I1@')
        result = '\n'.join(a.register_entry({'refn': 'first-wife', 'ahnentafel': [3]}))
        self.assertIn('Their divorce was recorded at First Court, Example County, in 1830.', result)
        self.assertIn('first decree, page 2', result)


ADOPTED_AND_BIRTH = """0 @I1@ INDI
1 REFN kid
2 TYPE jsonid
1 NAME Kid /Birth/
1 SEX F
1 FAMC @F2@
2 PEDI adopted
1 FAMC @F1@
2 PEDI birth
0 @I2@ INDI
1 REFN birth-father
2 TYPE jsonid
1 NAME Father /Birth/
1 SEX M
1 FAMS @F1@
0 @I3@ INDI
1 REFN adoptive-father
2 TYPE jsonid
1 NAME Father /Adoptive/
1 SEX M
1 FAMS @F2@
0 @F1@ FAM
1 HUSB @I2@
1 CHIL @I1@
0 @F2@ FAM
1 HUSB @I3@
1 CHIL @I1@
"""


class TestSourceShapesFromOtherPrograms(unittest.TestCase):
    """GEDCOM allows a source record without a title, and a citation note
    that points to a shared NOTE record. Both print as readable text."""

    TREE = """0 @I1@ INDI
1 REFN ada
2 TYPE jsonid
1 NAME Ada /Example/
1 BIRT
2 DATE 1900
2 SOUR @SHORT@
3 NOTE @N1@
1 DEAT
2 DATE 1980
2 SOUR @AUTHOR@
1 SOUR @NOTHING@
0 @SHORT@ SOUR
1 ABBR Parish register
0 @AUTHOR@ SOUR
1 AUTH Jane Smith
0 @NOTHING@ SOUR
1 PUBL Somewhere
0 @N1@ NOTE The entry is in the margin.
1 CONT It names both parents.
"""

    def test_titles_fall_back_and_shared_notes_print_their_text(self):
        sources = fixture_tree(self.TREE).sources_by_person()["ada"]
        labels = sorted(source["label"] for source in sources.values())
        self.assertEqual(labels, ["Jane Smith", "Parish register — The entry is in the margin.\n"
                                                 "It names both parents.", "Untitled source"])
        self.assertFalse(any("@N1@" in label for label in labels))


class TestEveryRecordedEventPrints(unittest.TestCase):
    """Every vital event a tree records reaches the register with the
    citations of that event and no other: a second birth record, a
    christening, a cremation, an event with a place and no date, and a
    date in another calendar."""

    TREE = '''0 @I1@ INDI
1 REFN father
2 TYPE jsonid
1 NAME Jan /Nowak/
1 SEX M
1 BIRT
2 DATE 1720/21
2 PLAC Gdańsk, Pomerania, Poland
2 SOUR @REG@
3 PAGE entry 4
3 _KEY gdansk-register
1 BIRT
2 DATE ABT 1721
2 PLAC Warsaw, Poland
2 SOUR @TREE@
3 _KEY warsaw-tree
1 CHR
2 DATE 2 MAR 1721
2 PLAC St Mary's, Gdańsk, Poland
2 SOUR @CHURCH@
3 _KEY church-book
1 DEAT
2 DATE @#DJULIAN@ 14 MAR 1789
1 CREM
2 PLAC Kraków, Poland
2 SOUR @CREM@
3 _KEY cremation-register
1 FAMS @F1@
0 @I2@ INDI
1 REFN child
2 TYPE jsonid
1 NAME Anna /Nowak/
1 SEX F
1 BIRT
2 PLAC Halifax, Yorkshire
2 SOUR @CHILDREG@
3 PAGE birth entry
3 _KEY child-birth
1 DEAT
2 PLAC Leeds
2 SOUR @CHILDREG@
3 PAGE death entry
3 _KEY child-death
1 FAMC @F1@
0 @F1@ FAM
1 HUSB @I1@
1 CHIL @I2@
0 @REG@ SOUR
1 TITL Gdańsk birth register
0 @TREE@ SOUR
1 TITL A family tree giving Warsaw
0 @CHURCH@ SOUR
1 TITL St Mary's church book
0 @CREM@ SOUR
1 TITL Kraków cremation register
0 @CHILDREG@ SOUR
1 TITL Halifax and Leeds registers
'''

    def setUp(self):
        a = TestExplicitCitationSupport().assembler(self.TREE)
        a.nums = {'@I1@': [2]}
        self.a = a
        self.entry = '\n'.join(a.register_entry({'refn': 'father', 'ahnentafel': [2]}))

    def sentence_with(self, words):
        return next(part for part in re.split(r'(?<=\.) (?=[A-Z*])', self.entry) if words in part)

    def test_the_printed_birth_has_only_its_own_footnote(self):
        birth = self.sentence_with('was born')
        self.assertIn('was born at Gdańsk, Pomerania, Poland, in 1720/21#footnote[Gdańsk birth register', birth)
        self.assertNotIn('Warsaw', birth.split('Birth was also recorded')[0])
        other = self.sentence_with('Birth was also recorded')
        self.assertIn('Birth was also recorded at Warsaw, Poland, about 1721.#footnote['
                      'A family tree giving Warsaw', other)
        self.assertNotIn('Gdańsk birth register', other)

    def test_christening_and_cremation_print_with_their_citations(self):
        self.assertIn("was christened at St Mary's, Gdańsk, Poland, 2 March 1721#footnote[St Mary's church book",
                      self.entry.replace("\\'", "'"))
        self.assertIn('was cremated at Kraków, Poland#footnote[Kraków cremation register', self.entry)
        groups = self.a.cites_by_fact('father')
        self.assertEqual(groups['christening'], ['church-book'])
        self.assertEqual(groups['cremation'], ['cremation-register'])
        self.assertEqual(groups['general'], [])

    def test_another_calendar_is_named_not_printed_as_code(self):
        self.assertIn('died 14 March 1789 (Julian)', self.entry)
        self.assertNotIn('@#D', self.entry)
        self.assertNotIn('\\@\\#D', self.entry)

    def test_a_childs_event_with_a_place_and_no_date_keeps_place_and_citation(self):
        child = next(line for line in self.entry.splitlines() if 'child-plain' in line)
        self.assertIn('b. Halifax, Yorkshire#footnote[Halifax and Leeds registers — birth entry', child)
        self.assertIn('d. Leeds#footnote[Halifax and Leeds registers — death entry', child)

    def test_the_register_source_check_counts_them_as_event_notes(self):
        # The register's source check counts christening and cremation
        # citations as event notes, like birth and death.
        register = register_sources_mod.expected_keys(self.a.tree, 'father')
        self.assertNotIn(('father', 'church-book'), register)
        self.assertNotIn(('father', 'cremation-register'), register)


class TestSecondSetOfParents(unittest.TestCase):
    """A person with birth and adoptive parents (two FAMC, each with PEDI)."""

    def test_book_numbers_the_birth_parents_whatever_the_order(self):
        tree = fixture_tree(ADOPTED_AND_BIRTH)
        self.assertEqual(tree.ahnentafel('kid')[2], '@I2@')
        self.assertEqual([link['kind'] for link in tree.by_refn['kid']['parent_families']],
                         ['adopted', 'birth'])

    def test_pedigree_choice(self):
        choose = enrich_mod.pedigree_family
        adopted, plain, birth = ({'family': f, 'kind': k} for f, k in
                                 (('@A@', 'adopted'), ('@U@', ''), ('@B@', 'birth')))
        self.assertEqual(choose([adopted, plain]), '@U@')
        self.assertEqual(choose([plain, birth]), '@B@')
        self.assertEqual(choose([adopted]), '@A@')
        self.assertIsNone(choose([]))

    def test_children_list_marks_an_adopted_child_in_that_family_only(self):
        a = TestExplicitCitationSupport().assembler()
        kid = {'xref': '@K1@', 'refn': 'kid-1', 'given': 'Ada', 'surname': 'Example',
               'birth_date': '1990', 'parent_families': [{'family': '@F9@', 'kind': 'adopted'}]}
        args = (a.tree.by_refn['father'], a.tree.by_refn['first-wife'], [kid],
                {'refn': 'father', 'ahnentafel': [2]})
        self.assertIn('adopted\\; b. 1990', a.children_block(*args, family='@F9@'))
        self.assertNotIn('adopted', a.children_block(*args, family='@F1@'))


class TestRegisterChildOrder(unittest.TestCase):
    def render(self, dates, baptisms=None):
        a = TestExplicitCitationSupport().assembler()
        kids = [{'xref': f'@K{i}@', 'refn': f'kid-{i}', 'given': name, 'surname': 'Example',
                 'birth_date': date, 'baptisms': (baptisms or {}).get(name, [])}
                for i, (name, date) in enumerate(dates)]
        result = a.children_block(a.tree.by_refn['father'], a.tree.by_refn['first-wife'], kids,
                                  {'refn': 'father', 'ahnentafel': [2]})
        self.assertEqual([k['given'] for k in kids], [name for name, _ in dates])
        return result

    def test_an_undated_older_child_keeps_the_recorded_position(self):
        result = self.render([('Older', ''), ('Middle', '1996'), ('Younger', '')])
        self.assertLess(result.index('Older Example'), result.index('Middle Example'))
        self.assertLess(result.index('Middle Example'), result.index('Younger Example'))
        self.assertIn('listed in recorded order', result)
        self.assertEqual(result.count('b. '), 1)

    def test_all_dated_children_still_use_chronological_display(self):
        result = self.render([('Younger', '1900'), ('Older', '1890')])
        self.assertLess(result.index('Older Example'), result.index('Younger Example'))
        self.assertNotIn('listed in recorded order', result)

    def test_baptism_order_remains_qualified_and_does_not_invent_births(self):
        result = self.render([('Younger', '1800'), ('Older', '')],
                             {'Older': [{'date': '1750', 'place': '', 'source_keys': []}]})
        self.assertLess(result.index('Older Example'), result.index('Younger Example'))
        self.assertIn('ordered by recorded birth or baptism year; birth order uncertain', result)
        self.assertIn('bp. 1750', result)
        self.assertNotIn('b. 1750', result)

    def test_an_undated_child_prevents_a_partial_baptism_sort(self):
        result = self.render([('First', ''), ('Second', ''), ('Third', '1800')],
                             {'Second': [{'date': '1750', 'place': '', 'source_keys': []}]})
        self.assertLess(result.index('First Example'), result.index('Second Example'))
        self.assertLess(result.index('Second Example'), result.index('Third Example'))
        self.assertIn('listed in recorded order', result)

    def test_a_birth_bound_cannot_be_used_as_an_exact_ordering_year(self):
        for date in ('BEF 1900', 'AFT 1800', 'BET 1800 AND 1900', ''):
            with self.subTest(date=date):
                result = self.render([('First', date), ('Second', '1850')])
                self.assertLess(result.index('First Example'), result.index('Second Example'))
                self.assertIn('listed in recorded order', result)


class TestClaimSourceIdentity(unittest.TestCase):
    """Duplicate notes must not shift later files onto unrelated citations."""

    def tree(self, notes):
        return fixture_tree('0 @I1@ INDI\n1 REFN p\n2 TYPE jsonid\n1 NAME P /Example/\n' + notes)

    def test_duplicate_sources_merge_captures_without_shifting_the_next_source(self):
        notes = ['1 NOTE [Source] First record — archived images/first.jpg\n',
                 '1 NOTE [Source] First record — archived images/first.pdf\n',
                 '1 NOTE [Source] No saved capture\n',
                 '1 NOTE [Source] Last record — archived images/last.jpg\n']
        for order in (notes, list(reversed(notes))):
            with self.subTest(order=order):
                records = self.tree(''.join(order)).sources_by_person()['p']
                self.assertEqual(records['first-record']['paths'], ['images/first.jpg', 'images/first.pdf'])
                self.assertEqual(len(records['first-record']['raw_notes']), 2)
                self.assertEqual(records['no-saved-capture']['paths'], [])
                self.assertEqual(records['last-record']['paths'], ['images/last.jpg'])

    def test_legacy_multiple_extensions_and_trailing_punctuation(self):
        rec = enrich_mod.parse_note('[Source] Test — archived images/scan.pdf.html; '
                                    'images/second.tiff.\nimages/third.JPG)')[3]
        self.assertEqual(rec['paths'], ['images/scan.pdf.html', 'images/second.tiff', 'images/third.JPG'])

    def test_colliding_long_labels_keep_their_own_paths(self):
        prefix = 'A source title with a sufficiently long shared beginning for a collision '
        tree = self.tree(f'1 NOTE [Source] {prefix}A — archived images/a.jpg\n'
                         f'1 NOTE [Source] {prefix}B — archived images/b.jpg\n')
        sources = tree.sources_by_person()['p']
        self.assertEqual(len(sources), 2)
        for source in sources.values():
            self.assertEqual(source['paths'], [f'images/{source["label"][-1].lower()}.jpg'])

    def test_native_media_follow_ids_and_keep_use_metadata(self):
        tree = self.tree('''1 FAMS @F1@
1 BIRT
2 SOUR @S1@
3 PAGE volume 2, page 6
3 QUAY 2
3 OBJE
4 FILE images/citation copy.pdf
0 @I2@ INDI
1 REFN q
2 TYPE jsonid
1 NAME Q /Example/
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 SOUR @S2@
3 PAGE page 8
0 @S1@ SOUR
1 TITL Native birth record
1 _KEY birth
1 NOTE Old assessment mentions images/unrelated.jpg, not an attachment.
1 OBJE @O1@
1 OBJE
2 FILE images/inline.jpg
0 @O1@ OBJE
1 FILE images/source.pdf.html
0 @S2@ SOUR
1 TITL Marriage register
1 _KEY marriage
1 OBJE @O1@
''')
        sources = tree.sources_by_person()
        birth = sources['p']['birth']
        self.assertEqual(birth['paths'], ['images/citation copy.pdf', 'images/inline.jpg', 'images/source.pdf.html'])
        self.assertEqual(birth['source_id'], '@S1@')
        self.assertEqual(birth['uses'], [{'page': 'volume 2, page 6', 'quay': '2',
                                        'facts': [{'kind': 'birth', 'family': None}]}])
        for person in ('p', 'q'):
            self.assertEqual(sources[person]['marriage']['paths'], ['images/source.pdf.html'])
            self.assertEqual(sources[person]['marriage']['facts'], [{'kind': 'marriage', 'family': '@F1@'}])

    def test_missing_shared_media_fails_visibly(self):
        with self.assertRaisesRegex(ValueError, 'missing OBJE'):
            self.tree('1 SOUR @S@\n0 @S@ SOUR\n1 TITL Source\n1 OBJE @MISSING@\n')

    def test_map_and_footnote_resolve_the_same_qualified_source(self):
        a = TestExplicitCitationSupport().assembler()
        a.src_keys['father']['shared'] = dict(a.src_keys['father']['child-register'], label='Father record')
        a.src_keys['child']['shared'] = dict(a.src_keys['child']['child-register'], label='Child record')
        for resolve in (lambda: booklib.resolve_source(a.src_keys, ['father', 'child'], 'shared'),
                        lambda: a.footnote_typ(['father', 'child'], 'shared')):
            with self.assertRaisesRegex(ValueError, 'ambiguous citation'):
                resolve()
        doc = claims_mod.Document('Claim.#src("child::shared")', 'fixture.typ',
                                  ['father', 'child'], a.src_keys, a.tree, booklib.ROOT)
        doc.walk()
        source = doc.claims[0]['sources'][0]
        self.assertEqual((source['refn'], source['label']), ('child', 'Child record'))
        self.assertIn(source['label'], a.footnote_typ(['father', 'child'], 'child::shared'))

    def test_resolution_has_no_global_or_out_of_scope_fallback(self):
        a = TestExplicitCitationSupport().assembler()
        for key in ('child-register', 'child::child-register'):
            self.assertIsNone(booklib.resolve_source(a.src_keys, ['second-wife'], key))
        # Identical source identity attached to both people remains usable.
        a.src_keys['father']['child-register'] = dict(a.src_keys['child']['child-register'])
        person, source = booklib.resolve_source(a.src_keys, ['father', 'child'], 'child-register')
        self.assertEqual(person, 'father')
        self.assertEqual(source['source_id'], '@CHILDDEATH@')


class TestDeclaredCitationPeople(unittest.TestCase):
    """Collateral source ownership must not alter ancestor coverage."""

    GED = '''0 @I1@ INDI
1 REFN subject
2 TYPE jsonid
1 NAME Subject /Example/
1 SOUR @S1@
0 @I2@ INDI
1 REFN brother
2 TYPE jsonid
1 NAME Brother /Example/
1 SOUR @S2@
0 @I3@ INDI
1 REFN unrelated
2 TYPE jsonid
1 NAME Other /Person/
1 SOUR @S3@
0 @S1@ SOUR
1 TITL Subject account
1 _KEY subject-account
0 @S2@ SOUR
1 TITL Brother's logbook from a 1923 voyage
1 _KEY brother-account
0 @S3@ SOUR
1 TITL Unrelated account
1 _KEY other-account
'''

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.tree = fixture_tree(self.GED)
        self.addCleanup(self.tree.src_path.unlink)
        self.sketches = self.root / 'sketches'
        self.sketches.mkdir()
        self.sketch = self.sketches / '0001-subject.typ'
        self.sync = self.root / 'sync.json'
        self.cfg = {'root_refn': 'subject', 'chapters': [
            {'id': 'present', 'title': 'Present', 'lines': ['origin']}]}
        self.write_sketch()
        self.paths = patch.multiple(booklib, SKETCH_DIR=self.sketches,
                                    BOOK_DIR=self.root, SYNC_JSON=self.sync)
        self.paths.start()
        self.addCleanup(self.paths.stop)

    def write_sketch(self, declaration='// citation_people: [brother]\n'):
        self.sketch.write_text('// ---\n// refn: subject\n// covers: [subject]\n'
                               '// status: draft\n' + declaration + '// ---\n\n'
                               'He kept a logbook on a 1923 voyage.#src("brother::brother-account")\n')

    def gather(self):
        return coverage_mod.gather(self.tree, self.cfg)

    def assembler(self):
        a = TestExplicitCitationSupport().assembler(self.GED)
        a.tree = self.tree
        a.src_keys = self.tree.sources_by_person()
        a.warnings = []
        return a

    def test_declared_owner_resolves_in_assembly_and_claims_without_covering_him(self):
        meta, body = booklib.parse_front_matter(self.sketch)
        a = self.assembler()
        rendered = a.process_prose(body, ['subject'], 'fixture', meta=meta)
        self.assertIn('Brother', rendered)
        self.assertIn('person: "brother", key: "brother-account"', rendered)
        self.assertEqual(a.warnings, [])
        result = claims_mod.build_map(self.tree, [(self.sketch, ['subject'])], self.root)
        self.assertEqual(result['issues'], [])
        claim, = result['claims']
        self.assertEqual(claim['covers'], ['subject'])
        self.assertEqual(claim['sources'][0]['refn'], 'brother')
        self.assertEqual(claim['sources'][0]['source_id'], '@S2@')
        gathered = self.gather()
        self.assertEqual(gathered['errors'], [])
        self.assertEqual(set(gathered['ancestors']), {'subject'})
        self.assertEqual(gathered['table'], self.tree.ahnentafel('subject'))
        self.assertEqual(gathered['sections'][0]['covers'], ['subject'])

    def test_undeclared_explicit_or_unqualified_owner_still_fails(self):
        for call in ('brother::brother-account', 'brother-account', 'unrelated::other-account'):
            with self.subTest(call=call):
                a = self.assembler()
                body = f'Claim.#src("{call}")'
                meta = {'citation_people': ['brother']} if call.startswith('unrelated') else {}
                rendered = a.process_prose(body, ['subject'], 'fixture', meta=meta)
                self.assertIn('unresolved citation', rendered)
                self.assertEqual(len(a.warnings), 1)
                doc = claims_mod.Document(body, 'fixture.typ', ['subject'], a.src_keys,
                                          self.tree, self.root, meta=meta)
                doc.walk()
                self.assertEqual(len(doc.issues), 1)

    def test_scope_does_not_silently_choose_between_same_key_owners(self):
        a = self.assembler()
        a.src_keys['subject']['collision'] = a.src_keys['subject']['subject-account']
        a.src_keys['brother']['collision'] = a.src_keys['brother']['brother-account']
        meta = {'citation_people': ['brother']}
        with self.assertRaisesRegex(ValueError, 'ambiguous citation'):
            a.process_prose('#src("collision")', ['subject'], 'fixture', meta=meta)
        actual = a.process_prose('#src("brother::collision")', ['subject'], 'fixture', meta=meta)
        self.assertIn('1923', actual)

    def test_invalid_or_redundant_declarations_are_errors(self):
        for value in ('brother', None, ['missing'], ['brother', 'brother'], ['subject'], [3]):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'citation_people'):
                booklib.citation_scope({'citation_people': value}, ['subject'], self.tree)
        self.write_sketch('// citation_people: [missing]\n')
        self.assertTrue(any('citation_people' in e for e in self.gather()['errors']))
        self.write_sketch('// citation_people: [brother\n')
        self.assertTrue(any('citation_people' in e for e in self.gather()['errors']))

    def test_declaration_is_sketch_local_not_inherited_by_intro(self):
        chapter = self.root / 'chapters/present-intro.typ'
        chapter.parent.mkdir()
        chapter.write_text('Introduction.#src("brother::brother-account")')
        inputs = claims_mod.prose_inputs(self.tree, self.cfg)
        result = claims_mod.build_map(self.tree, inputs, self.root)
        self.assertEqual(len(result['issues']), 1)
        self.assertEqual(result['issues'][0]['file'], 'chapters/present-intro.typ')
        chapter.write_text('// ---\n// citation_people: [brother]\n// ---\nIntroduction.')
        self.assertTrue(any('citation_people is supported only in sketches' in e
                            for e in self.gather()['errors']))

    def test_lint_uses_declared_records_without_allowing_arbitrary_years(self):
        r = self.gather()
        self.assertFalse(any('L3 year 1923' in w for w in r['warns']))
        self.sketch.write_text(self.sketch.read_text().replace('1923 voyage', '1777 voyage'))
        self.assertTrue(any('L3 year 1777' in w for w in self.gather()['warns']))

    def test_added_removed_and_changed_dependency_require_acknowledgment(self):
        self.sync.write_text(json.dumps({'subject': {'gedcom_sha': self.tree.person_hash('subject')}}))
        self.assertEqual(self.gather()['states']['subject'], 'stale')
        entry = coverage_mod.current_sync_entry(self.tree, self.gather(), 'subject')
        self.assertEqual(entry['citation_people'], {'brother': self.tree.person_hash('brother')})
        self.sync.write_text(json.dumps({'subject': entry}))
        self.assertEqual(self.gather()['states']['subject'], 'draft')
        original = self.tree.src_path.read_text()
        self.tree.src_path.write_text(original.replace('Unrelated account', 'Updated other account'))
        self.assertEqual(self.gather()['states']['subject'], 'draft')
        self.tree.src_path.write_text(original.replace('1923 voyage', '1924 voyage'))
        self.assertEqual(self.tree.person_hash('subject'), entry['gedcom_sha'])
        self.assertEqual(self.gather()['states']['subject'], 'stale')
        self.tree.src_path.write_text(original)
        self.write_sketch('')
        self.assertEqual(self.gather()['states']['subject'], 'stale')
        self.assertNotIn('citation_people', coverage_mod.current_sync_entry(
            self.tree, self.gather(), 'subject'))

    def test_mark_records_exact_dependencies_and_preserves_other_sync_rows(self):
        untouched = {'gedcom_sha': 'preserve-me', 'accepted_at': '2000-01-01'}
        self.sync.write_text(json.dumps({'unrelated': untouched}))
        with patch.object(booklib, 'Tree', return_value=self.tree), \
             patch.object(booklib, 'load_book_yaml', return_value=self.cfg), \
             patch.object(coverage_mod, 'COVERAGE_MD', self.root / 'COVERAGE.md'), \
             patch.object(sys, 'argv', ['book-coverage.py', '--mark-current', 'subject', '--quiet']), \
             contextlib.redirect_stdout(io.StringIO()):
            coverage_mod.main()
        written = json.loads(self.sync.read_text())
        self.assertEqual(written['unrelated'], untouched)
        self.assertEqual(written['subject']['citation_people'],
                         {'brother': self.tree.person_hash('brother')})
        self.assertEqual(self.gather()['states']['subject'], 'draft')


class TestClaimSegments(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source_map = {'p': {key: {'label': key, 'url': '', 'paths': [f'images/{key}.pdf']}
                                 for key in ('a', 'b')}}
        self.tree = SimpleNamespace(by_refn={'p': {'given': 'Pat', 'surname': 'Example'}})

    def parse(self, text):
        doc = claims_mod.Document(text, 'book/test.typ', ['p'], self.source_map, self.tree, self.root)
        doc.walk()
        return doc

    def test_adjacent_sources_share_a_segment_but_uncited_tail_does_not(self):
        doc = self.parse('First sentence. Second sentence.#src("p::a") \n#super[, ]#src("b") Uncited tail.')
        self.assertEqual([c['keys'] for c in doc.claims], [['p::a', 'b'], []])
        self.assertEqual(doc.claims[0]['text'], 'First sentence. Second sentence.')
        self.assertEqual(doc.claims[1]['text'], 'Uncited tail.')
        self.assertEqual(doc.issues, [])

    def test_headings_and_paragraphs_are_boundaries_even_without_empty_lines(self):
        doc = self.parse('Before.\n== Heading\nAfter.#src("a")\n\nNew paragraph.')
        self.assertEqual([c['text'] for c in doc.claims], ['Before.', 'After.', 'New paragraph.'])
        self.assertEqual([c['keys'] for c in doc.claims], [[], ['a'], []])

    def test_comments_front_matter_and_original_offsets(self):
        text = '// ---\n// refn: p\n// ---\n\n// #src("nonexistent")\nActual claim.#src("a")'
        claim, = self.parse(text).claims
        self.assertEqual(claim['line'], 6)
        self.assertEqual(claim['raw'], text[claim['start']:claim['end']])
        self.assertEqual(claim['raw'], 'Actual claim.#src("a")')

    def test_explicit_note_does_not_borrow_or_supply_a_body_citation(self):
        doc = self.parse('Body.#src("a")#footnote[Explanation.#src("b")] More body.')
        self.assertEqual([(c['kind'], c['text'], c['keys']) for c in doc.claims],
                         [('prose', 'Body.', ['a']), ('note', 'Explanation.', ['b']),
                          ('prose', 'More body.', [])])

    def test_figures_and_fixed_size_portrait_have_separate_captions(self):
        path = self.root / 'images/portrait.jpg'
        path.parent.mkdir(); path.write_bytes(b'fixture')
        doc = self.parse('Before.#src("a")\n#fig("portrait.jpg", caption: "First caption.")\n'
                         '#figure(image("/images/portrait.jpg", width: 2.2in), '
                         'caption: text(size: 9pt, "A caption with (parentheses), and an escaped \\"quote\\"."))\nAfter.')
        self.assertEqual([c['kind'] for c in doc.claims], ['prose', 'caption', 'caption', 'prose'])
        self.assertEqual(len(doc.figures), 2)
        for claim in doc.claims[1:3]:
            self.assertEqual(claim['keys'], [])
            self.assertEqual(claim['figure_artifacts'], [{'path': 'images/portrait.jpg', 'exists': True,
                'sha256': hashlib.sha256(b'fixture').hexdigest()}])

    def test_literal_caption_content_records_its_own_inline_sources(self):
        path = self.root / 'images/portrait.jpg'
        path.parent.mkdir(); path.write_bytes(b'fixture')
        text = ('Before.#src("a")\n'
                '#figure(image("/images/portrait.jpg", width: 100%), '
                'caption: text(size: 8.6pt, fill: iron, '
                '[The complete photograph; attributed names.#src("b")]))\n'
                'After.')
        doc = self.parse(text)
        self.assertEqual([(c['kind'], c['text'], c['keys']) for c in doc.claims],
                         [('prose', 'Before.', ['a']),
                          ('caption', 'The complete photograph; attributed names.', ['b']),
                          ('prose', 'After.', [])])
        self.assertEqual(doc.figures[0]['caption'], 'The complete photograph; attributed names.')
        caption = doc.claims[1]
        self.assertEqual(caption['sources'][0]['status'], 'resolved')
        self.assertIn('#src("b")', caption['raw'])
        self.assertEqual(caption['figure_artifacts'][0]['path'], 'images/portrait.jpg')
        self.assertEqual(doc.issues, [])
        for invalid in ('Hidden #unknown[words]', '#src("b")', 'Words #src(variable)',
                        'Visible words. // #src("b")\nRemaining words.',
                        'Visible words. /* #src("b") */ Remaining words.',
                        '*Formatted words*#src("b")', '$1+1$#src("b")',
                        '_Emphasized words_#src("b")', '@a-reference#src("b")',
                        '= A heading\nWords.#src("b")', '- A list item#src("b")'):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                self.parse('#figure(image("/images/portrait.jpg"), caption: text(size: 9pt, [' + invalid + ']))')

    def test_generated_figures_use_the_same_precedence_as_assembly(self):
        for path in ('build/figures/chart.svg', 'build/figures/chart.png', 'images/chart'):
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True); target.write_text('fixture')
        doc = self.parse('#fig("chart", caption: "Diagram.")')
        self.assertEqual(doc.figures[0]['artifacts'][0]['path'], 'build/figures/chart.svg')

    def test_missing_figure_is_retained_even_without_caption(self):
        doc = self.parse('#fig("missing.jpg")')
        self.assertEqual(doc.figures[0]['artifacts'], [{'path': 'images/missing.jpg', 'exists': False}])

    def test_block_content_and_person_reference_are_indexed(self):
        doc = self.parse('#block(breakable: false)[#refp("p") lived here.#src("a")]')
        self.assertEqual(doc.claims[0]['text'], 'Pat Example lived here.')
        self.assertEqual(doc.claims[0]['keys'], ['a'])

    def test_page_breaks_separate_claims_without_borrowing_citations(self):
        for pagebreak in ('#pagebreak()', '#pagebreak(weak: true)', '#pagebreak(weak: false,)'):
            with self.subTest(pagebreak=pagebreak):
                doc = self.parse('Before.#src("a")' + pagebreak + 'After.#src("b")')
                self.assertEqual([(c['text'], c['keys']) for c in doc.claims],
                                 [('Before.', ['a']), ('After.', ['b'])])
                doc = self.parse('Before.' + pagebreak + '#src("b")After.')
                self.assertEqual([(c['text'], c['keys']) for c in doc.claims],
                                 [('Before.', []), ('', ['b']), ('After.', [])])
                self.assertIn('without preceding', doc.issues[0]['message'])

    def test_grid_cells_preserve_claims_notes_captions_and_offsets(self):
        text = ('Before.#src("a")\n#grid(columns: (2.45in, 1.7in), gutter: 0.2in,\n'
                '[Pat worked here.#src("a") #footnote[An explanation.#src("b")]],\n'
                '// This comment must not shift original offsets.\n'
                '[#figure(image("/images/portrait.jpg", width: 1.7in), '
                'caption: text(size: 8.6pt, "Pat, at home (date unknown)."))],\n'
                ')\nAfter.#src("b")')
        doc = self.parse(text)
        self.assertEqual([(c['kind'], c['text'], c['keys']) for c in doc.claims], [
            ('prose', 'Before.', ['a']),
            ('prose', 'Pat worked here.', ['a']),
            ('note', 'An explanation.', ['b']),
            ('caption', 'Pat, at home (date unknown).', []),
            ('prose', 'After.', ['b']),
        ])
        self.assertEqual(doc.issues, [])
        self.assertEqual(doc.figures[0]['artifacts'],
                         [{'path': 'images/portrait.jpg', 'exists': False}])
        for claim in doc.claims:
            self.assertEqual(claim['raw'], text[claim['start']:claim['end']])
            self.assertEqual(claim['line'], text.count('\n', 0, claim['start']) + 1)
            self.assertTrue(claim['raw'].startswith(claim['text'].split('.')[0])
                            or claim['kind'] == 'caption')

    def test_grid_cell_citations_do_not_leak_or_borrow_text(self):
        doc = self.parse('#grid(columns: 2, [Repeated.#src("a")], '
                         '[Repeated.], [#src("b")]) After.')
        self.assertEqual([(c['text'], c['keys']) for c in doc.claims],
                         [('Repeated.', ['a']), ('Repeated.', []), ('', ['b']), ('After.', [])])
        self.assertIn('without preceding', doc.issues[0]['message'])
        self.assertLess(doc.claims[0]['start'], doc.claims[1]['start'])

    def test_nested_static_grid_cells_are_walked(self):
        doc = self.parse('#grid(columns: (1fr, 2fr), [#grid(columns: 1, '
                         '[Nested.#src("a")])], [Outer.#src("b")])')
        self.assertEqual([(c['text'], c['keys']) for c in doc.claims],
                         [('Nested.', ['a']), ('Outer.', ['b'])])
        self.assertEqual(doc.issues, [])

    def test_grid_rejects_content_that_could_be_hidden_in_expressions(self):
        for text in ('#grid(columns: widths, [Text.])',
                     '#grid(columns: (1in, width), [Text.])',
                     '#grid(columns: 2, gutter: calculate(), [Text.])',
                     '#grid(columns: 2, ..cells)',
                     '#grid(columns: 2, [One.] + [Two.])',
                     '#grid(columns: 2, "Hidden prose")',
                     '#grid(columns: 2, fill: [Hidden.#src("a")], [Text.])',
                     '#grid(columns: 2, columns: 1, [Text.])',
                     '#grid(columns: 2, [Text.])[Hidden.#src("a")]',
                     '#grid(columns: 2, [#unknown[Hidden.#src("a")]])',
                     '#grid[Hidden.#src("a")]', '#grid(columns: 2)', '#grid([Text.])'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                self.parse(text)

    def test_literal_code_and_escaped_macros_do_not_become_citations(self):
        doc = self.parse(r'Example `#src("fake")` and \#src("fake") in literal text.')
        self.assertEqual(doc.claims[0]['keys'], [])
        self.assertEqual(doc.issues, [])

    def test_orphan_and_unknown_citations_report_issues(self):
        self.assertIn('without preceding', self.parse('#src("a")').issues[0]['message'])
        for key in ('unknown', 'outside::a'):
            doc = self.parse(f'Text.#src("{key}")')
            self.assertEqual(doc.claims[0]['sources'][0]['status'], 'unresolved')
            self.assertEqual(len(doc.issues), 1)

    def test_unsupported_syntax_fails_instead_of_disappearing(self):
        for text in ('#unknown[Hidden prose]', '#src(key)', '#footnote[Unclosed',
                     '#pagebreak()[Hidden prose.#src("a")]', '#pagebreak[Hidden prose]',
                     '#pagebreak(weak: condition)', '#pagebreak',
                     'Body. // #src("a")',
                     '#figure(image("relative.jpg"), caption: "Caption")'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                self.parse(text)


class TestClaimMapOutput(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.tree = fixture_tree('0 @I1@ INDI\n1 REFN p\n2 TYPE jsonid\n1 NAME P /Example/\n')
        self.prose = self.root / 'book/a.typ'
        self.prose.parent.mkdir(); self.prose.write_text('Uncited claim.')
        self.inputs = [(self.prose, ['p'])]

    def build(self):
        return claims_mod.build_map(self.tree, self.inputs, self.root)

    def test_hashes_track_prose_data_and_pipeline_and_output_is_deterministic(self):
        first = self.build()
        self.assertEqual(first, self.build())
        for name in ('extract-claims.py', 'booklib.py', 'book-assemble.py', 'bookbib.py',
                     'enrich-gedcom.py'):
            self.assertTrue(any(p.endswith('/' + name) for p in first['inputs_sha256']))
        self.prose.write_text('Changed claim.')
        self.assertNotEqual(first, self.build())
        before = self.build()['inputs_sha256']
        self.tree.src_path.write_text(self.tree.src_path.read_text().replace('P /Example/', 'Other /Example/'))
        self.assertNotEqual(before, self.build()['inputs_sha256'])

    def test_source_identity_helper_changes_stale_the_map(self):
        before = self.build()
        read_bytes = Path.read_bytes
        with patch.object(Path, 'read_bytes', lambda p: read_bytes(p) +
                          (b'\n# changed source identity\n' if p.name == 'bookbib.py' else b'')):
            after = self.build()
        changed = [p for p in before['inputs_sha256']
                   if before['inputs_sha256'][p] != after['inputs_sha256'][p]]
        self.assertEqual([Path(p).name for p in changed], ['bookbib.py'])
        self.assertNotEqual(before, after)

    def test_slices_keep_uncited_text_and_do_not_delete_reviews_or_collide(self):
        second = self.root / 'book/other/a.typ'
        second.parent.mkdir(); second.write_text('Second file.')
        self.inputs.append((second, ['p']))
        out = self.root / 'build/claims/current'
        out.mkdir(parents=True)
        verdict = out.parent / 'VERDICTS.json'; verdict.write_text('historical review')
        local_review = out / 'review.json'; local_review.write_text('current review')
        claims_mod.write_slices(self.build(), out)
        index = json.loads((out / 'index.json').read_text())
        self.assertEqual(index['active_slices'], ['book/a.json', 'book/other/a.json'])
        self.assertEqual(json.loads((out / 'book/a.json').read_text())['claims'][0]['keys'], [])
        self.inputs.pop()
        claims_mod.write_slices(self.build(), out)
        self.assertEqual(json.loads((out / 'index.json').read_text())['active_slices'], ['book/a.json'])
        self.assertEqual(verdict.read_text(), 'historical review')
        self.assertEqual(local_review.read_text(), 'current review')

    def test_check_is_read_only_and_errors_preserve_the_previous_map(self):
        out = self.root / 'map.json'; slices = self.root / 'slices'
        args = ['--out', str(out), '--slices-dir', str(slices)]
        build = claims_mod.build_map
        with patch.object(claims_mod.booklib, 'Tree', return_value=self.tree), \
             patch.object(claims_mod, 'prose_inputs', return_value=self.inputs), \
             patch.object(claims_mod, 'build_map', side_effect=lambda tree, inputs, **options: build(tree, inputs, self.root, **options)), \
             contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(claims_mod.main(args), 0)
            before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.rglob('*.json')}
            self.assertEqual(claims_mod.main(args + ['--check']), 0)
            self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in before})
            slice_path = slices / 'book/a.json'
            slice_path.write_text('stale slice')
            self.assertEqual(claims_mod.main(args + ['--check']), 1)
            self.assertEqual(slice_path.read_text(), 'stale slice')
            self.assertEqual(claims_mod.main(args), 0)
            before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in before}
            self.prose.write_text('Changed claim.')
            self.assertEqual(claims_mod.main(args + ['--check']), 1)
            self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in before})
            self.prose.write_text('Broken claim.#src("nonexistent")')
            self.assertEqual(claims_mod.main(args), 1)
            self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in before})

    def test_missing_uncaptioned_figure_appears_in_the_map_summary(self):
        self.prose.write_text('#fig("missing.jpg")')
        self.assertEqual(self.build()['stats']['missing_artifacts'], ['images/missing.jpg'])

    def test_replacing_or_removing_an_artifact_changes_the_map(self):
        self.prose.write_text('#fig("image.jpg", caption: "Caption.")')
        image = self.root / 'images/image.jpg'
        image.parent.mkdir(); image.write_bytes(b'original capture')
        first = self.build()
        image.write_bytes(b'replacement capture')
        second = self.build()
        self.assertNotEqual(first, second)
        image.unlink()
        self.assertNotEqual(second, self.build())
        self.assertEqual(self.build()['stats']['missing_artifacts'], ['images/image.jpg'])


class TestCurrentBookClaimMap(unittest.TestCase):
    def test_every_active_source_call_and_authored_figure_is_indexed(self):
        tree = booklib.Tree()
        inputs = claims_mod.prose_inputs(tree, booklib.load_book_yaml())
        payload = claims_mod.build_map(tree, inputs)
        self.assertEqual(payload['issues'], [])
        expected_keys, expected_figures = [], 0
        for path, _ in inputs:
            self.assertNotIn('archive', path.parts)
            body = re.sub(r'(?m)^[ \t]*//[^\n]*', '', path.read_text())
            expected_keys.extend(claims_mod.SRC.findall(body))
            expected_figures += len(re.findall(r'#fig(?:ure)?\(', body))
        self.assertCountEqual([key for c in payload['claims'] for key in c['keys']], expected_keys)
        self.assertEqual(len(payload['figures']), expected_figures)
        # Every citation of a GEDCOM source record names its record and uses.
        native = [s for c in payload['claims'] for s in c['sources'] if s.get('native')]
        self.assertTrue(all(s['source_id'] and s['uses'] for s in native))


class TestFootnoteFullStop(unittest.TestCase):
    def test_a_quotation_ending_its_sentence_takes_no_second_full_stop(self):
        rec = {'label': 'Example, Annals', 'short': 'Example, Annals — p. 377: "She moved inland that spring."'}
        self.assertTrue(assemble_mod.citation_body(rec, first='prose', reg_no=None).endswith('spring."'))

    def test_a_quotation_ending_in_a_closed_parenthesis_takes_no_second_full_stop(self):
        rec = {'label': 'Sample', 'short': 'Sample — p. 42: "bapt. Oct. 3, 1791. (Example Parish Book.)"'}
        self.assertTrue(assemble_mod.citation_body(rec, first='prose', reg_no=None).endswith('Book.)"'))

    def test_a_quotation_ending_its_sentence_starts_a_new_viewed_at_sentence(self):
        label = assemble_mod.linked_source_label('Author — p. 118: "Paid to the carter in full."',
                                                 'https://archive.org/details/x')
        self.assertNotIn(', viewed at', label)
        self.assertIn(' Viewed at ', label)

    def test_a_quotation_closing_a_quote_within_it_takes_no_second_full_stop(self):
        rec = {'label': 'Penhallow', 'short': 'Penhallow — p. 86: "Deacon Hale. \u2018She kept the inn for thirty seasons.\u2019"'}
        self.assertTrue(assemble_mod.citation_body(rec, first='prose', reg_no=None).endswith('seasons.\u2019"'))

    def test_a_short_citation_without_closing_punctuation_still_ends_with_one(self):
        rec = {'label': 'Example, Annals', 'short': 'Example, Annals — p. 377'}
        self.assertTrue(assemble_mod.citation_body(rec, first=1, reg_no=2).endswith('p. 377 (cited in full at no. 1).'))


class TestSketchParagraphBlocks(unittest.TestCase):
    def test_every_paragraph_block_keeps_a_gap_below_it(self):
        # A paragraph alone in a block loses its first-line indent, so without
        # this gap consecutive paragraphs run together on the page.
        bare = [f'{path.name}:{n}' for path in sorted(booklib.SKETCH_DIR.glob('*.typ'))
                for n, line in enumerate(path.read_text().splitlines(), 1)
                if line.startswith('#block(breakable: false)[')]
        self.assertEqual(bare, [])



# ---------- a small family folder, for scripts run as the build runs them ----------

SMALL_TREE = """0 HEAD
1 CHAR UTF-8
0 @I1@ INDI
1 REFN ada-example
2 TYPE jsonid
1 NAME Ada /Example/
1 SEX F
1 _CONFLEVEL tree-link
1 BIRT
2 DATE 1990
2 SOUR @S1@
3 PAGE p. 4
3 _KEY ada-birth
0 @S1@ SOUR
1 TITL Example birth register
0 TRLR
"""


def small_family(folder, tree=SMALL_TREE, story=None, chapters=None, settings=None):
    """A family folder from Flyleaf's starter: the tree, one chapter for the
    root and, if given, the root's story."""
    shutil.copytree(HERE.parent / "starter", folder, dirs_exist_ok=True)
    config = json.loads((folder / "flyleaf.json").read_text())
    config["maintainer"].update(name="Ada Example", first_name="Ada", email="ada@example.org")
    for dotted, value in (settings or {}).items():
        node = config
        *parents, last = dotted.split(".")
        for part in parents:
            node = node.setdefault(part, {})
        node[last] = value
    (folder / "flyleaf.json").write_text(json.dumps(config))
    book = folder / config["paths"]["book"]
    if config["paths"]["book"] != "book":
        (folder / "book").rename(book)
    (folder / "data" / "family.src.ged").write_text(tree)
    root = re.search(r"^1 REFN (\S+)\n2 TYPE jsonid", tree, re.M)[1]
    text = (book / "book.yaml").read_text().replace("root_refn:", f"root_refn: {root}")
    (book / "book.yaml").write_text(text + (chapters or
        '  - {id: present, title: "The Present Generation", lines: [origin], charts: false}\n'))
    if story is not None:
        (book / "sketches").mkdir()
        (book / "sketches" / f"0001-{root}.typ").write_text(
            f"// ---\n// refn: {root}\n// covers: [{root}]\n// ahnentafel: [1]\n"
            f"// status: draft\n// line: origin\n// ---\n\n{story}")
    return folder


def run_script(family, script, *args):
    """Run one engine script on a family folder, as the Makefile does."""
    return subprocess.run([sys.executable, str(HERE / script), *args], cwd=family,
                          env=dict(os.environ, FLYLEAF_FAMILY=str(family)),
                          capture_output=True, text=True)


# Text from a tree, in the shapes that would be Typst code if printed raw.
HOSTILE = ['#read("/secret.txt")', '#import "/secret.typ": leaked', '$x^2$', '@ref <label>',
           '*bold* _italic_', 'back\\slash', '[brackets]', '`raw`', 'a // comment', '/* block */',
           '~tilde', '== Heading', '1. Numbered', '- item', '+ item', '/ term: x']


def printed(text):
    """PDF text without Typst's typographic quotes, and with single spaces."""
    for curly, plain in (("“", '"'), ("”", '"'), ("‘", "'"), ("’", "'")):
        text = text.replace(curly, plain)
    return " ".join(text.split())


class TestTreeTextPrintsAsWritten(unittest.TestCase):
    """Names, places, dates and source titles from a tree reach Typst markup
    and strings in many places. Whatever they hold prints as written, and
    nothing in them runs as Typst code or reads a file."""

    def test_escaped_text_prints_literally_in_every_markup_position(self):
        esc = assemble_mod.esc
        with tempfile.TemporaryDirectory(dir=booklib.ROOT) as tmp:
            folder = Path(tmp)
            (folder / "secret.txt").write_text("SECRET-FILE-TEXT")
            (folder / "secret.typ").write_text('#let leaked = "SECRET-MODULE-TEXT"')
            body = ['#set page(width: 30cm, height: auto, margin: 1cm)',
                    '#set text(hyphenate: false)', '#set par(justify: false)']
            for i, text in enumerate(HOSTILE):
                body += [f"{esc(text)}", "",
                         f"#footnote[{esc(text)}] Note {i}.", "",
                         f"#smallcaps[{esc(text)}] and #link(\"https://example.org\")[{esc(text)}]", "",
                         f"#table(columns: 1, [{esc(text)}])", "",
                         f"== {esc(text)}", ""]
            src = folder / "hostile.typ"
            src.write_text("\n".join(body) + "\n")
            pdf, deps = folder / "hostile.pdf", folder / "deps.json"
            proc = subprocess.run(["typst", "compile", "--root", str(folder), "--deps", str(deps),
                                   str(src), str(pdf)], capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            text = printed(subprocess.run(["pdftotext", str(pdf), "-"], capture_output=True,
                                          text=True, check=True).stdout)
            read = json.loads(deps.read_text())["inputs"]
        self.assertNotIn("SECRET", text)
        self.assertFalse([name for name in read if "secret" in name], read)
        for raw in HOSTILE:
            # At a line start, in a note, in small capitals, in a link, in a
            # table and in a heading.
            self.assertEqual(text.count(printed(raw)), 6, raw)

    def test_text_that_starts_a_line_cannot_start_a_heading_or_list(self):
        esc = assemble_mod.esc
        for text in ("== Heading", "1. Numbered", "12. Twelve", "-", "- item", "+ item",
                     "/ term: x", "first\n= second", "first\n  - second", "first\n3. third"):
            with self.subTest(text=text):
                for line in esc(text).splitlines():
                    self.assertIsNone(re.match(r"\s*(=+|[-+/]|\d+\.)(\s|$)", line), line)
        self.assertEqual(esc("1900 - 1910 at no. 1. Street"), "1900 - 1910 at no. 1. Street")

    def test_people_and_chapter_ids_must_be_plain_slugs(self):
        tree = fixture_tree("0 @I1@ INDI\n1 REFN Ada <x>\n2 TYPE jsonid\n1 NAME Ada /Example/\n")
        with patch.object(booklib, "Tree", return_value=tree), \
                patch.object(booklib, "load_book_yaml",
                             return_value={"root_refn": "Ada <x>", "chapters": []}):
            with self.assertRaisesRegex(ValueError, "lowercase letters, digits and hyphens"):
                assemble_mod.Assembler()


class TestCitationKeysPerUse(unittest.TestCase):
    """A tree from another program cites one source on several pages without
    a _KEY. Each different use gets its own key; a source cited one way
    keeps the plain key it had before."""

    TREE = """0 @I1@ INDI
1 REFN ada
2 TYPE jsonid
1 NAME Ada /Example/
1 SEX F
1 BIRT
2 DATE 1900
2 SOUR @S1@
3 PAGE p. 4
1 BAPM
2 DATE 1900
2 SOUR @S1@
3 PAGE p. 9
1 SOUR @S1@
2 PAGE p. 4
1 SOUR @S2@
2 PAGE the only page
1 FAMS @F1@
0 @I2@ INDI
1 REFN ben
2 TYPE jsonid
1 NAME Ben /Example/
1 SEX M
1 SOUR @S1@
2 PAGE p. 77
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I1@
1 DIV
2 DATE 1930
2 SOUR @S1@
3 PAGE p. 12
0 @S1@ SOUR
1 TITL Parish register
0 @S2@ SOUR
1 TITL Census
"""

    def test_each_different_use_has_its_own_key(self):
        tree = fixture_tree(self.TREE)
        ada = tree.sources_by_person()["ada"]
        self.assertEqual(sorted(ada), ["s1-p-12", "s1-p-4", "s1-p-9", "s2"])
        self.assertEqual(ada["s1-p-4"]["label"], "Parish register — p. 4")
        # The same use on the birth and as a general reference stays one key.
        self.assertEqual({f["kind"] for f in ada["s1-p-4"]["facts"]}, {"birth", "general"})
        self.assertEqual(tree.by_refn["ada"]["baptisms"][0]["source_keys"], ["s1-p-9"])
        divorce = next(iter(tree.fams.values()))["divorces"][0]
        self.assertEqual(tree.keys_for(tree.by_refn["ada"], divorce["uses"]), ["s1-p-12"])
        self.assertEqual(tree.keys_for(tree.by_refn["ben"], divorce["uses"]), ["s1-p-12"])

    def test_a_source_cited_one_way_keeps_its_key(self):
        # Ben's own uses differ from Ada's, but each person's are consistent.
        tree = fixture_tree(self.TREE.replace("3 PAGE p. 12\n", "3 PAGE p. 77\n"))
        ben = tree.sources_by_person()["ben"]
        self.assertEqual(sorted(ben), ["s1"])
        divorce = next(iter(tree.fams.values()))["divorces"][0]
        self.assertEqual(tree.keys_for(tree.by_refn["ben"], divorce["uses"]), ["s1"])
        self.assertIn("s1-p-77", tree.sources_by_person()["ada"])
        self.assertEqual(tree.keys_for(tree.by_refn["ada"], divorce["uses"]), ["s1-p-77"])

    def test_the_register_cites_each_use_with_its_own_page(self):
        a = assemble_mod.Assembler.__new__(assemble_mod.Assembler)
        a.tree = fixture_tree(self.TREE)
        a.src_keys = a.tree.sources_by_person()
        a.cited_full, a.cited_uses, a.index, a.reg_anchor = {}, set(), {}, {}
        a.nums = {"@I2@": [2], "@I1@": [3]}
        a.cov = {"states": {}}
        ben = "\n".join(a.register_entry({"refn": "ben", "ahnentafel": [2]}))
        self.assertIn("Their divorce was recorded in 1930.#footnote[Parish register — p. 12 ", ben)
        self.assertIn('key: "s1-p-12"', ben)
        ada = "\n".join(a.register_entry({"refn": "ada", "ahnentafel": [3]}))
        self.assertIn("#footnote[Parish register — p. 4 ", ada)
        self.assertIn("#footnote[Parish register — p. 9 ", ada)

    def test_keys_never_collide_with_another_sources_key(self):
        sources = [{"key": "s1", "label": "T — p. 4", "source_label": "T", "derived_key": True},
                   {"key": "s1", "label": "T — p 4", "source_label": "T", "derived_key": True},
                   {"key": "s1-p-4", "label": "Other", "source_label": "Other"}]
        out, renamed = enrich_mod.distinct_keys(sources)
        keys = [s["key"] for s in out]
        self.assertEqual(len(set(keys)), 3, keys)
        self.assertTrue(all(re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", k) for k in keys), keys)
        self.assertEqual(sources[0]["key"], "s1")  # the caller's records are not changed
        self.assertEqual(set(renamed), {("s1", "T — p. 4"), ("s1", "T — p 4")})

    def test_a_key_on_the_source_record_is_split_by_page_too(self):
        tree = fixture_tree(self.TREE.replace("0 @S1@ SOUR\n", "0 @S1@ SOUR\n1 _KEY parish\n"))
        ada = tree.sources_by_person()["ada"]
        self.assertEqual(sorted(ada), ["parish-p-12", "parish-p-4", "parish-p-9", "s2"])

    def test_a_citations_own_key_is_kept(self):
        tree = fixture_tree(self.TREE.replace("2 SOUR @S1@\n3 PAGE p. 9\n",
                                              "2 SOUR @S1@\n3 PAGE p. 9\n3 _KEY ada-baptism\n"))
        ada = tree.sources_by_person()["ada"]
        self.assertIn("ada-baptism", ada)
        self.assertEqual(tree.by_refn["ada"]["baptisms"][0]["source_keys"], ["ada-baptism"])

    def test_people_keep_no_working_fields(self):
        tree = fixture_tree(self.TREE)
        for person in tree.people:
            self.assertFalse([s for s in person["sources"] if "derived_key" in s])


def line_of_fathers(generations):
    """A tree of one person, their father, his father, and so on."""
    text = ""
    for g in range(generations):
        text += (f"0 @I{g}@ INDI\n1 REFN man-{g}\n2 TYPE jsonid\n1 NAME Man{g} /Deep/\n1 SEX M\n"
                 + (f"1 FAMS @F{g - 1}@\n" if g else "")
                 + (f"1 FAMC @F{g}@\n" if g < generations - 1 else ""))
    for g in range(generations - 1):
        text += f"0 @F{g}@ FAM\n1 HUSB @I{g + 1}@\n1 CHIL @I{g}@\n"
    return text


class TestDeepTrees(unittest.TestCase):
    """A tree of any depth makes a book. Only a real loop of parent links,
    where someone is their own ancestor, is an error."""

    def test_sixty_generations_are_not_a_loop(self):
        tree = fixture_tree(line_of_fathers(60))
        table = tree.ahnentafel("man-0")
        self.assertEqual(len(table), 60)
        self.assertEqual(tree.generation(max(table)), 59)
        self.assertEqual(tree.line_of(max(table), table), "deep")

    def test_a_person_who_is_their_own_ancestor_is_named(self):
        looped = line_of_fathers(5) + "0 @F4@ FAM\n1 HUSB @I0@\n1 CHIL @I4@\n"
        looped = looped.replace("1 NAME Man4 /Deep/\n", "1 NAME Man4 /Deep/\n1 FAMC @F4@\n")
        looped = looped.replace("1 NAME Man0 /Deep/\n", "1 NAME Man0 /Deep/\n1 FAMS @F4@\n")
        with self.assertRaisesRegex(ValueError, "loop: man-0 -> man-1 -> man-2 -> man-3 -> man-4 -> man-0"):
            fixture_tree(looped).ahnentafel("man-0")

    def test_repeated_ancestors_are_worked_out_once(self):
        # Every generation is one couple, the parents of both people in the
        # generation below: 2**14 ahnentafel places for 28 people.
        generations, text = 14, ""
        for g in range(generations):
            for sex, who in (("M", "h"), ("F", "w")):
                text += (f"0 @{who}{g}@ INDI\n1 REFN {who}-{g}\n2 TYPE jsonid\n"
                         f"1 NAME {who.upper()}{g} /{'Line' if who == 'h' else 'Wife'}{g}/\n1 SEX {sex}\n"
                         + (f"1 FAMS @F{g}@\n" if g else "")
                         + (f"1 FAMC @F{g + 1}@\n" if g < generations - 1 else ""))
        for g in range(1, generations):
            text += f"0 @F{g}@ FAM\n1 HUSB @h{g}@\n1 WIFE @w{g}@\n1 CHIL @h{g - 1}@\n1 CHIL @w{g - 1}@\n"
        tree = fixture_tree(text)
        table = tree.ahnentafel("h-0")
        self.assertEqual(len(table), 2 ** generations - 1)
        started = __import__("time").monotonic()
        lines = {tree.line_of(n, table) for n in table}
        self.assertLess(__import__("time").monotonic() - started, 5)
        self.assertIn("line13", lines)


class TestRelationBeyondEightGreats(unittest.TestCase):
    """Every generation gets its own label, however far back."""

    def test_far_generations_are_counted(self):
        f = assemble_mod.relation_tagline
        with patch.object(assemble_mod, "SUBJECTS", "Ada"):
            for n, covers, sex, words in (
                    (1 << 10, 2, "M", "Paternal eighth great-grandparents of Ada"),
                    (1 << 11, 1, "M", "Paternal ninth great-grandfather of Ada"),
                    ((1 << 12) + 1, 1, "F", "Paternal tenth great-grandmother of Ada"),
                    (3 << 12, 2, "M", "Maternal eleventh great-grandparents of Ada"),
                    (1 << 22, 1, "M", "Paternal twentieth great-grandfather of Ada"),
                    (1 << 23, 1, "M", "Paternal twenty-first great-grandfather of Ada"),
                    (1 << 40, 1, "M", "Paternal thirty-eighth great-grandfather of Ada")):
                with self.subTest(n=n):
                    self.assertEqual(f([n], covers, sex), words)
        # No label falls back to a bare "grandparents" past the second generation.
        for g in range(3, 41):
            with self.subTest(g=g):
                self.assertIn("great-", f([1 << g], 2, "M", "Ada"))


class TestChapterIds(unittest.TestCase):
    """Each chapter needs its own id: it names the chapter's links and files."""

    def proposal_for(self, father_surname, mother_surname):
        tree = fixture_tree(f"""0 @I1@ INDI
1 REFN kid
2 TYPE jsonid
1 NAME Kid /{father_surname}/
1 SEX F
1 FAMC @F1@
0 @I2@ INDI
1 REFN father
2 TYPE jsonid
1 NAME Dad /{father_surname}/
1 SEX M
1 FAMS @F1@
0 @I3@ INDI
1 REFN mother
2 TYPE jsonid
1 NAME Mum /{mother_surname}/
1 SEX F
1 FAMS @F1@
1 FAMC @F2@
0 @I4@ INDI
1 REFN grandfather
2 TYPE jsonid
1 NAME Grandad /{mother_surname}/
1 SEX M
1 FAMS @F2@
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I3@
1 CHIL @I1@
0 @F2@ FAM
1 HUSB @I4@
1 CHIL @I3@
""")
        return load("book-chapters.py", "chapters_t").proposal(tree, "kid")

    def test_two_sides_with_one_surname_get_different_ids(self):
        for father, mother in (("Smith", "Smith"), ("Present", "Smith"), ("", ""), ("李", "王")):
            with self.subTest(father=father, mother=mother):
                ids = [c["id"] for c in self.proposal_for(father, mother)]
                self.assertEqual(len(ids), len(set(ids)), ids)
                self.assertTrue(all(assemble_mod.LABEL_SAFE.fullmatch(i) for i in ids), ids)
        self.assertEqual([c["id"] for c in self.proposal_for("Smith", "Smith")],
                         ["smith", "smith-2", "present"])

    def test_titles_never_hold_what_book_yaml_reads_as_comment_or_quote(self):
        chapters = self.proposal_for('Ha#sh', 'Qu"ote')
        for chapter in chapters:
            self.assertNotRegex(chapter["title"], r'[#"]')
        mod = load("book-chapters.py", "chapters_t2")
        lines = "".join(mod.render(c) + "\n" for c in chapters)
        yaml = fixture_file("title: T\nroot_refn: kid\nchapters:\n" + lines, ".yaml")
        self.assertEqual([c["title"] for c in booklib.load_book_yaml(yaml)["chapters"]],
                         [c["title"] for c in chapters])

    def test_coverage_refuses_duplicate_or_unsafe_ids_and_a_line_in_two_chapters(self):
        tree = fixture_tree(MOTHER_ONLY)
        for chapters, said in (
                ([{"id": "a", "lines": ["origin"]}, {"id": "a", "lines": ["known"]}], "2 chapters have the id 'a'"),
                ([{"id": "A b", "lines": ["origin", "known"]}], "may use only lowercase"),
                ([{"id": "a", "lines": ["origin", "known"]}, {"id": "b", "lines": ["known"]}],
                 "the line 'known' is in two chapters")):
            with self.subTest(said=said), patch.object(booklib, "SKETCH_DIR", Path(FIXTURES.name) / "none"):
                report = coverage_mod.gather(tree, {"root_refn": "root-kid", "chapters": chapters})
                self.assertTrue(any(said in e for e in report["errors"]), report["errors"])


class TestStoryHeaderNamesItsPerson(unittest.TestCase):
    """The book prints a story under the person its header's refn names. A
    refn that names no ancestor, or one the story does not cover, stops the
    build; it never leaves the story out of the book."""

    def coverage(self, refn, covers):
        sketches = Path(tempfile.mkdtemp(dir=FIXTURES.name))
        (sketches / "0001-story.typ").write_text(
            f"// ---\n// refn: {refn}\n// covers: [{covers}]\n// status: draft\n// ---\n\n"
            "Kid was born.\n")
        with patch.object(booklib, "SKETCH_DIR", sketches):
            return coverage_mod.gather(fixture_tree(MOTHER_ONLY), {
                "root_refn": "root-kid",
                "chapters": [{"id": "present", "lines": ["origin", "known"]}]})

    def test_a_mistyped_or_uncovered_refn_is_an_error(self):
        for refn, covers, said in (("root-kd", "root-kid", "refn 'root-kd' is not an ancestor"),
                                   ("known-mother", "root-kid", "refn 'known-mother' is not in "
                                                                "its covers list")):
            with self.subTest(refn=refn):
                errors = self.coverage(refn, covers)["errors"]
                self.assertTrue(any(said in e for e in errors), errors)

    def test_a_correct_header_has_no_error(self):
        self.assertEqual(self.coverage("root-kid", "root-kid")["errors"], [])


class TestScaffoldCoversEveryone(unittest.TestCase):
    """A wife is left to her husband's story only when that story covers her."""

    TREE = MOTHER_ONLY.replace("1 FAMS @F1@\n0 @F1@ FAM\n1 WIFE @I2@", """1 FAMS @F1@
0 @I3@ INDI
1 REFN known-father
2 TYPE jsonid
1 NAME Father /Example/
1 SEX M
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I3@
1 WIFE @I2@""")

    def scaffold(self, existing):
        mod = load("book-scaffold.py", "scaffold_t")
        folder = Path(tempfile.mkdtemp(dir=FIXTURES.name))
        sketches = folder / "sketches"
        sketches.mkdir()
        for name, covers in existing.items():
            (sketches / name).write_text(f"// ---\n// refn: {covers[0]}\n// covers: [{', '.join(covers)}]\n"
                                         "// status: draft\n// ---\n\nWritten.\n")
        tree = fixture_tree(self.TREE)
        with patch.object(mod.booklib, "Tree", return_value=tree), \
                patch.object(mod.booklib, "load_book_yaml",
                             return_value={"root_refn": "root-kid", "chapters": []}), \
                patch.multiple(mod.booklib, SKETCH_DIR=sketches, SYNC_JSON=folder / "sync.json"), \
                patch.object(sys, "argv", ["book-scaffold.py"]), contextlib.redirect_stdout(io.StringIO()):
            mod.main()
        covered = {}
        for path in sorted(sketches.glob("*.typ")):
            meta, _ = booklib.parse_front_matter(path)
            covered[path.name] = meta["covers"]
        return covered

    def test_a_wife_gets_her_own_story_when_her_husbands_covers_only_him(self):
        made = self.scaffold({"0002-known-father.typ": ["known-father"]})
        self.assertIn(["known-mother"], made.values())
        self.assertEqual(sorted(c for covers in made.values() for c in covers),
                         ["known-father", "known-mother", "root-kid"])

    def test_a_couple_still_shares_one_new_story(self):
        made = self.scaffold({})
        self.assertIn(["known-father", "known-mother"], made.values())
        self.assertEqual(len(made), 2)

    def test_a_wife_already_covered_by_her_husbands_story_gets_no_second_one(self):
        made = self.scaffold({"0002-known-father.typ": ["known-father", "known-mother"]})
        self.assertEqual(sorted(made), ["0001-root-kid.typ", "0002-known-father.typ"])


class TestResearchSections(unittest.TestCase):
    """Chapters about the research are named in flyleaf.json, not in code.
    In them a family's own stop phrases (text_checks.errors) only warn."""

    def check(self, research_sections, book='book'):
        with tempfile.TemporaryDirectory() as folder:
            family = Path(folder)
            settings = {'maintainer': {'first_name': 'Carol'},
                        'paths': {'site_content': 'site', 'source_gedcom': 'family.ged',
                                  'book': book},
                        'book': {'research_sections': research_sections},
                        'text_checks': {'errors': [r'\bhas not been located\b']}}
            (family / 'flyleaf.json').write_text(json.dumps(settings))
            (family / 'family.ged').write_text('0 HEAD\n0 TRLR\n')
            for name, title in (('front-matter/02-how-we-searched.typ', 'How we searched'),
                                ('back-matter/98-open-questions.typ', 'Open Questions')):
                (family / book / name).parent.mkdir(parents=True, exist_ok=True)
                (family / book / name).write_text(
                    f'= {title}\n\nHer baptism has not been located.\n')
            run = subprocess.run([sys.executable, str(HERE / 'check-family-text.py')],
                                 env={**os.environ, 'FLYLEAF_FAMILY': str(family)},
                                 capture_output=True, text=True)
            return run.returncode, run.stdout

    def test_listed_chapters_only_warn(self):
        code, out = self.check(['How we searched', 'Open Questions'])
        self.assertEqual(code, 0, out)

    def test_unlisted_chapters_are_checked(self):
        code, out = self.check(['How we searched'])
        self.assertEqual(code, 1, out)
        self.assertIn('98-open-questions.typ', out)
        self.assertNotIn('02-how-we-searched.typ', out)

    def test_no_chapter_is_exempt_by_its_file_name(self):
        code, out = self.check([])
        self.assertEqual(code, 1, out)
        self.assertIn('98-open-questions.typ', out)
        self.assertIn('02-how-we-searched.typ', out)

    def test_a_renamed_book_folder_is_checked(self):
        code, out = self.check(['How we searched'], book='our-book')
        self.assertEqual(code, 1, out)
        self.assertIn('our-book/back-matter/98-open-questions.typ', out)

    def test_a_title_no_chapter_has_is_an_error(self):
        code, out = self.check(['How we searched', 'Open Questions', 'Methodology'])
        self.assertEqual(code, 1, out)
        self.assertIn('\u201cMethodology\u201d', out)


class TestFamilyFolders(unittest.TestCase):
    """A family may rename its book folder (paths.book); every script finds
    it there. The images folder keeps its name."""

    def test_site_content_defaults_to_site_as_the_website_reads_it(self):
        import flyleaf_settings
        probe = ("import sys; sys.path.insert(0, sys.argv[1]); import flyleaf_settings as f; "
                 "print(f.path('site_content').name)")
        for paths, expected in (({}, "site"), ({"site_content": "content"}, "content")):
            with self.subTest(paths=paths), tempfile.TemporaryDirectory() as tmp:
                (Path(tmp) / "flyleaf.json").write_text(json.dumps({"paths": paths}))
                result = subprocess.run([sys.executable, "-c", probe, str(HERE)], capture_output=True,
                                        text=True, env=dict(os.environ, FLYLEAF_FAMILY=tmp))
                self.assertEqual((result.returncode, result.stdout.strip()), (0, expected),
                                 result.stderr)
        # Other paths are still required.
        self.assertNotIn("source_gedcom", flyleaf_settings.PATH_DEFAULTS)

    def test_the_edition_date_reads_day_month_year(self):
        from datetime import date
        self.assertEqual(booklib.edition_date(date(2026, 10, 7)), "7 October 2026")

    def test_book_folder_comes_from_settings(self):
        with tempfile.TemporaryDirectory() as tmp:
            family = small_family(Path(tmp) / "family", settings={"paths.book": "our-book"},
                story='Ada was born in 1990.#src("ada-birth")\n\n#fig("photos/ada.jpg", caption: "Ada")\n')
            (family / "images" / "photos").mkdir(parents=True)
            shutil.copy(next((HERE.parent / "sample" / "images").rglob("*.jpg")),
                        family / "images" / "photos" / "ada.jpg")
            probe = run_script(family, "book-coverage.py")
            self.assertEqual(probe.returncode, 0, probe.stdout + probe.stderr)
            self.assertTrue((family / "our-book" / "COVERAGE.md").is_file())
            self.assertFalse((family / "book").exists())
            out = family / "build" / "book.typ"
            result = run_script(family, "book-assemble.py", "--out", str(out))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('"/images/photos/ada.jpg"', out.read_text())
            self.assertIn("Ada was born in 1990.", out.read_text())
            claims = run_script(family, "extract-claims.py")
            self.assertEqual(claims.returncode, 0, claims.stderr)
            figure, = json.loads((family / "our-book" / "CLAIMS-MAP.json").read_text())["figures"]
            self.assertEqual([a["path"] for a in figure["artifacts"]], ["images/photos/ada.jpg"])

    def test_the_images_folder_cannot_be_renamed(self):
        with tempfile.TemporaryDirectory() as tmp:
            family = small_family(Path(tmp) / "family", settings={"paths.images": "media"},
                                  story='Ada was born in 1990.#src("ada-birth")\n')
            result = run_script(family, "book-coverage.py")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('paths.images cannot be changed', result.stdout + result.stderr)

    def test_page_size_comes_from_book_yaml(self):
        page = booklib.page_settings({"trim_width": "5.5in", "trim_height": "8.5in"})
        self.assertEqual(page["text_width_pt"], 277.2)  # 5.5in less 1.65in of side margins
        module = booklib.page_module({"trim_width": "152mm", "trim_height": "229mm"})
        self.assertIn("#let page-width = 152mm", module)
        self.assertIn("#let page-height = 229mm", module)
        default = booklib.page_module({})
        for line in ("#let page-width = 6in", "#let page-height = 9in",
                     "#let chart-width = 313.2pt", "#let tall-figure-height = 396pt",
                     "#let margins = (inside: 0.95in, outside: 0.7in, top: 0.8in, bottom: 0.85in)"):
            self.assertIn(line, default)
        for bad in ("6", "six inches", "6 in 9"):
            with self.subTest(bad=bad), self.assertRaises(SystemExit):
                booklib.page_settings({"trim_width": bad})
        with self.assertRaises(SystemExit):
            booklib.page_settings({"trim_width": "2in"})

    def test_the_pdf_takes_the_trim_size_and_charts_fit_its_column(self):
        with tempfile.TemporaryDirectory(dir=booklib.ROOT) as tmp:
            folder = Path(tmp)
            for name in ("template.typ", "fonts.typ"):
                shutil.copy(FIXTURE_TEMPLATES / name, folder / name)
            (folder / "page.typ").write_text(booklib.page_module(
                {"trim_width": "5.5in", "trim_height": "8.5in"}))
            (folder / "chart.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg" '
                                              'width="277.2pt" height="100pt"/>')
            rel = folder.relative_to(booklib.ROOT).as_posix()
            src = folder / "trim.typ"
            src.write_text(f'#import "/{rel}/template.typ": *\n#show: book.with(title: "Trim")\n'
                           f'#book-chart("/{rel}/chart.svg", [A chart.]) <chart-x>\nText.\n')
            pdf = folder / "trim.pdf"
            proc = subprocess.run(["typst", "compile", "--root", str(booklib.ROOT), str(src), str(pdf)],
                                  capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            info = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True).stdout
            self.assertRegex(info, r"Page size:\s+396 x 612 pts")
            query = subprocess.run(["typst", "query", "--root", str(booklib.ROOT), str(src),
                                    "<chart-image>"], capture_output=True, text=True)
            self.assertEqual(query.returncode, 0, query.stderr)
            self.assertEqual(json.loads(query.stdout)[0]["width"], "0% + 277.2pt")


class TestReceiptCoversEverythingThatChangesTheBook(unittest.TestCase):
    """The build receipt goes stale when anything that can change the PDF
    changes: a book setting, a helper script, the family's source rules."""

    def test_book_settings_are_in_the_receipt_inputs(self):
        publication = load("book_publication.py", "publication_inputs_t")
        real = publication.flyleaf_settings.get

        def changed(key, default=None):
            value = real(key, default)
            if key == "book":
                value = dict(value or {}, subjects_label="Someone else entirely")
            return value
        before = publication.settings_digest()
        with patch.object(publication.flyleaf_settings, "get", side_effect=changed):
            self.assertNotEqual(publication.settings_digest(), before)

        def described(key, default=None):
            value = real(key, default)
            return dict(value or {}, description="Only the website shows this.") if key == "book" else value
        with patch.object(publication.flyleaf_settings, "get", side_effect=described):
            self.assertEqual(publication.settings_digest(), before)

    def test_every_script_the_build_loads_is_in_the_receipt(self):
        publication = load("book_publication.py", "publication_code_t")
        build = (HERE / "build-book.py").read_text()
        # The scripts the build runs: its own steps, and the Makefile's
        # validate and book-figures targets.
        steps = set(re.findall(r"scripts/([\w-]+\.py)", build))
        checks = re.search(r"for name in \(([^)]*)\):\s+run\(\[sys\.executable, "
                           r"ENGINE / f'scripts/check-\{name\}\.py'", build)
        steps |= {f"check-{name}.py" for name in re.findall(r"'([\w-]+)'", checks[1])}
        steps |= {"build-book.py", "enrich-gedcom.py", "validate-gedcom.py", "book-figures.py"}
        # Load each one as the build would, and list every Flyleaf script
        # that comes with it.
        probe = """
import importlib.util, sys
folder = sys.argv[1]
sys.path.insert(0, folder)
for name in sys.argv[2:]:
    spec = importlib.util.spec_from_file_location(name[:-3].replace("-", "_"), f"{folder}/{name}")
    spec.loader.exec_module(importlib.util.module_from_spec(spec))
for module in list(sys.modules.values()):
    if (getattr(module, "__file__", None) or "").startswith(folder):
        print(module.__file__)
"""
        result = subprocess.run([sys.executable, "-c", probe, str(HERE), *sorted(steps)],
                                capture_output=True, text=True, cwd=booklib.ROOT)
        self.assertEqual(result.returncode, 0, result.stderr)
        loaded = {Path(line).name for line in result.stdout.split()} | steps
        self.assertGreater(len(loaded), 10)
        self.assertEqual(sorted(loaded - set(publication.CODE)), [])

    def test_a_familys_source_rules_are_in_the_receipt(self):
        publication = load("book_publication.py", "publication_tiers_t")
        rules = fixture_file('{"patterns": {}}', ".json")
        real = publication.flyleaf_settings.get
        with patch.object(publication.flyleaf_settings, "get",
                          side_effect=lambda key, default=None: str(rules)
                          if key == "paths.source_tier_patterns" else real(key, default)):
            self.assertIn(flyleaf_settings_logical(rules), publication.inputs())


def flyleaf_settings_logical(path):
    import flyleaf_settings
    return flyleaf_settings.logical(path)


class TestRecipeCandidates(unittest.TestCase):
    """Recipe extraction suggests; the family's own index decides."""

    def module(self, family):
        with patch.dict(os.environ, {"FLYLEAF_FAMILY": str(family)}):
            import flyleaf_settings
            flyleaf_settings._load.cache_clear()
            try:
                return load("recipe-index.py", "recipe_t")
            finally:
                flyleaf_settings._load.cache_clear()

    def test_the_sample_booklet_gives_its_recipes_with_its_layout_rules(self):
        sample = HERE.parent / "sample"
        mod = self.module(sample)
        catalog = json.loads(mod.CATALOG.read_text())
        volume = catalog["volumes"][0]
        curated = json.loads(mod.CURATED.read_text())["recipes"]
        names = lambda rows: [(r["page"], r["name"].casefold()) for r in rows]
        # Without rules the booklet's ingredient headings look like titles.
        bare = {k: v for k, v in volume.items() if k != "indexing"}
        plain = list(mod.recipes_in(bare, mod.rules_for({}, bare)))
        self.assertIn((2, "pastry"), names(plain))
        # The sample's own rules (family-recipes.json "indexing") give its index.
        ruled = list(mod.recipes_in(volume, mod.rules_for(catalog, volume)))
        self.assertEqual(names(ruled), names(curated))
        # A volume's own rules win over the catalogue's.
        both = mod.rules_for({"indexing": {"header_lines": 3}}, dict(volume, indexing={"header_lines": 0}))
        self.assertEqual(both["header_lines"], 0)
        with self.assertRaises(SystemExit):
            mod.rules_for({"indexing": {"header_line": 3}}, volume)

    def test_extraction_never_writes_the_familys_index(self):
        with tempfile.TemporaryDirectory() as tmp:
            family = Path(tmp) / "sample"
            shutil.copytree(HERE.parent / "sample", family,
                            ignore=shutil.ignore_patterns("build", "family.ged"))
            curated = family / "site" / "recipe-index.json"
            before = curated.read_bytes()
            result = run_script(family, "recipe-index.py")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(curated.read_bytes(), before)
            candidates = json.loads((family / "build" / "recipe-index-candidates.json").read_text())
            self.assertTrue(candidates["recipes"])
            refused = run_script(family, "recipe-index.py", "--out", str(curated))
            self.assertNotEqual(refused.returncode, 0)
            self.assertEqual(curated.read_bytes(), before)


class TestFontCoverage(unittest.TestCase):
    def test_letters_the_bundled_fonts_lack_are_found(self):
        self.assertEqual(booklib.letters_the_fonts_lack(["Zoë Müller", "Ελένη", "Иван", "שרה"]), set())
        self.assertEqual(booklib.letters_the_fonts_lack(["小明 王", "Ada"]), {"小", "明", "王"})


class TestQuestionnaireFacts(unittest.TestCase):
    def test_a_marriage_date_is_kept_back_for_a_partner_who_may_be_living(self):
        module = load("book-questionnaire.py", "questionnaire_facts")
        tree = type("Tree", (), {"by_xref": {"@W@": {"given": "Wren", "surname": "Lee"}},
                                 "spouse_families": lambda self, x: [
                                     {"husb": "@G@", "wife": "@W@", "marr_recorded": True,
                                      "marr_date": "1950"}]})()
        grandfather = {"xref": "@G@", "birth_date": "1920", "death_date": "1990"}
        self.assertIn("married Wren Lee (1950)", module.fact_line(grandfather, tree))
        line = module.fact_line(grandfather, tree, {"@W@"})
        self.assertIn("married Wren Lee", line)
        self.assertNotIn("1950", line)


class TestBookTextMarkup(unittest.TestCase):
    """The book's text may use the markup the claim map reads. Anything else
    stops the build before a PDF is made, naming the file, line and call."""

    def test_unsupported_markup_is_named_with_its_file_and_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            family = small_family(Path(tmp), story='Ada was born in 1990.#src("ada-birth")\n\n'
                                                   'She #emph[loved] music.\n')
            result = run_script(family, "extract-claims.py", "--validate")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("book/sketches/0001-ada-example.typ, line 11: #emph is not markup "
                          "the book supports", result.stderr)
            self.assertFalse((family / "book" / "CLAIMS-MAP.json").exists())

    def test_a_stale_citation_map_stops_the_site_in_one_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            family = small_family(Path(tmp), story='Ada was born in 1990.#src("ada-birth")\n',
                                  settings={"family.name": "The Example family"})
            stale = family / "build" / "stale-map.json"
            stale.parent.mkdir(exist_ok=True)
            stale.write_text("{}")
            result = run_script(family, "compose-website.py", "--book-map", str(stale),
                                "--output", str(family / "build" / "current.ged"))
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertNotIn("Traceback", result.stderr)
            self.assertIn("The site build stopped. The book's citation map is older than its "
                          "stories", result.stderr)

    def test_hidden_files_in_book_folders_are_never_stories(self):
        # macOS leaves ._name copies beside files on some drives.
        with tempfile.TemporaryDirectory() as tmp:
            family = small_family(Path(tmp), story='Ada was born in 1990.#src("ada-birth")\n')
            (family / "book" / "sketches" / "._0001-ada-example.typ").write_bytes(
                b"\x00\x05\x16\x07\x00\x02\x00\x00Mac OS X        \xff\xfe")
            for script, args in (("book-coverage.py", ()), ("extract-claims.py", ("--validate",))):
                with self.subTest(script=script):
                    result = run_script(family, script, *args)
                    self.assertEqual(result.returncode, 0, result.stderr)

    def test_code_and_calls_in_headings_are_refused(self):
        for text, message in (
                ('Ada was born in 1990.#src("ada-birth")\n\n#{read("notes.txt")}\n',
                 "line 11: # starts Typst code here"),
                ('Ada was born in 1990.#src("ada-birth")\n\nShe paid #("1" + "0") pence.\n',
                 "line 11: # starts Typst code here"),
                ('== Her #emph[early] years\n\nAda was born in 1990.#src("ada-birth")\n',
                 "line 9: a heading holds plain text only"),
                # \\ prints a backslash, so the # after it still starts code.
                ('== Her \\\\#read("notes.txt") years\n\nAda was born in 1990.#src("ada-birth")\n',
                 "line 9: a heading holds plain text only"),
                ('== Her $ std.read("notes.txt") $ years\n\nAda was born in 1990.#src("ada-birth")\n',
                 "line 9: a heading holds plain text only"),
                # Typst math can read a file with no # at all.
                ('Ada was born in 1990.#src("ada-birth")\n\nShe paid $ std.read("notes.txt") $.\n',
                 "line 11: $ starts Typst math"),
                # Code chained onto an allowed call runs with it.
                ('Ada was born in 1990.#src("ada-birth")\n\n#block[Kept].func()(read("notes.txt"))\n',
                 "line 11: #block must end at its closing bracket"),
                ('Ada was born in 1990.#src("ada-birth")#footnote[A note.][#read("notes.txt")]\n',
                 "line 9: #footnote must end at its closing bracket"),
                # The site cannot show a code block.
                ('Ada was born in 1990.#src("ada-birth")\n\n```\nsome code\n```\n',
                 "line 11: ``` starts a code block"),
                # `` is empty raw text to Typst, so what follows it runs.
                ('Ada was born in 1990.#src("ada-birth")\n\nShe ``#read("notes.txt")`` wrote.\n',
                 "line 11: #read is not markup"),
                # Typst skips a block comment, and so would hide what is in it.
                ('Ada was born in 1990.#src("ada-birth")\n\nShe /* ` */ wrote ` it.\n',
                 "line 11: /* starts a block comment")):
            with self.subTest(text=text), tempfile.TemporaryDirectory() as tmp:
                family = small_family(Path(tmp), story=text)
                result = run_script(family, "extract-claims.py", "--validate")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("book/sketches/0001-ada-example.typ, " + message, result.stderr)

    def test_settings_of_allowed_calls_cannot_run_code(self):
        # Typst evaluates every argument of a call, so code hidden in a
        # setting would run even though the call itself is allowed.
        read = 'read("/flyleaf.json")'
        attacks = [f'#footnote(numbering: (..n) => {read})[A note.]',
                   f'#footnote({read})[A note.]',
                   f'#block(fill: {read})[Kept.]', f'#block(below: {read})[Kept.]',
                   f'#block({read})[Kept.]', f'#super(typographic: {read})[,]',
                   f'#refp("ada-example")[#{read}]', f'#fig("x.jpg", caption: "A.", width: {read})',
                   f'#figure(image("/images/x.jpg", alt: {read}), caption: [A.])',
                   f'#figure(image("/images/x.jpg"), supplement: {read}, caption: [A.])',
                   f'#figure(image("/images/x.jpg"), caption: {read})',
                   f'#figure(image("/images/x.jpg"), caption: text(fill: {read}, [A.]))',
                   f'#figure(image("/images/x.jpg"), caption: text(size: {read}, [A.]))',
                   f'#figure(image("/images/x.jpg"))[#{read}]',
                   '#figure(image("/flyleaf.json", format: "svg"), caption: [A.])',
                   '#figure(image("/images/../flyleaf.json"), caption: [A.])',
                   f'#grid(columns: 2, gutter: {read}, [A.])',
                   f'#pagebreak(weak: {read})']
        for attack in attacks:
            with self.subTest(attack=attack), tempfile.TemporaryDirectory() as tmp:
                family = small_family(Path(tmp), story='Ada was born in 1990.#src("ada-birth")\n\n'
                                                       + attack + '\n')
                result = run_script(family, "extract-claims.py", "--validate")
                self.assertNotEqual(result.returncode, 0, attack)
                self.assertIn("book/sketches/0001-ada-example.typ, line 11:", result.stderr)

    def test_plain_settings_still_pass(self):
        story = ('Ada was born in 1990.#src("ada-birth")\n\n'
                 '#block(breakable: false, below: 1.36em)[Kept.]\n\n'
                 '#block(width: 4.2in, inset: (left: 0pt, right: 0pt), above: 1em)[Kept.]\n\n'
                 '#figure(image("/images/x.jpg", width: 100%), '
                 'caption: text(size: 8.6pt, fill: iron, [A caption.#src("ada-birth")]))\n\n'
                 '#figure(image("/images/x.jpg", width: 1.45in), caption: [A caption.])\n\n'
                 '#grid(columns: (2.1in, 2.1in), gutter: 0.25in, [One.], [Two.])\n\n'
                 'She paid \\$5 for it.#footnote[A note.]. Then she left. \\\\ A new line.\n\n'
                 '== Her \\#1 song cost \\$2\n')
        with tempfile.TemporaryDirectory() as tmp:
            family = small_family(Path(tmp), story=story)
            result = run_script(family, "extract-claims.py", "--validate")
            self.assertEqual(result.returncode, 0, result.stderr)

    @unittest.skipUnless(shutil.which("typst"), "Typst needed")
    def test_a_setting_that_reads_a_file_never_reaches_the_pdf(self):
        with tempfile.TemporaryDirectory() as tmp:
            family = small_family(Path(tmp), story=(
                'Ada was born in 1990.#src("ada-birth")'
                '#footnote(numbering: (..n) => read("/flyleaf.json"))[A note.]\n'))
            result = run_script(family, "build-book.py")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("#footnote cannot take numbering", result.stderr)
            self.assertFalse((family / "build" / "book.pdf").exists())

    def test_supported_markup_passes(self):
        story = ('= A heading\n\nAda was born in 1990.#src("ada-birth")#super[, ]#src("ada-birth") '
                 '*Strong* and _emphasis_, \\#1, `raw`.\n\n#block(breakable: false)[Kept together.'
                 '#footnote[A note.]]\n\n#pagebreak(weak: true)\n\n#refp("ada-example")\n'
                 '// a comment on its own line\n')
        with tempfile.TemporaryDirectory() as tmp:
            family = small_family(Path(tmp), story=story)
            result = run_script(family, "extract-claims.py", "--validate")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((family / "book" / "CLAIMS-MAP.json").exists())

    @unittest.skipUnless(shutil.which("typst"), "Typst needed")
    def test_the_build_stops_before_it_makes_a_pdf(self):
        with tempfile.TemporaryDirectory() as tmp:
            family = small_family(Path(tmp), story='Ada was born in 1990.#src("ada-birth")\n\n'
                                                   '#proven[A ledger card.]\n')
            (family / "build").mkdir()
            previous = family / "build" / "book.pdf"
            previous.write_bytes(b"the previous edition")
            result = run_script(family, "build-book.py")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("book/sketches/0001-ada-example.typ, line 11: #proven is not markup",
                          result.stderr)
            self.assertIn("The book was not built; the previous book is unchanged.", result.stderr)
            self.assertEqual(previous.read_bytes(), b"the previous edition")
            self.assertEqual(sorted(p.name for p in (family / "build").glob("*.pdf")), ["book.pdf"])


class TestBookFolderHoldsTypstOnly(unittest.TestCase):
    """A story left as Markdown would be read as Typst, or left out. It
    stops the build, naming the file."""

    def test_a_markdown_file_in_a_book_folder_is_an_error(self):
        for folder in ("sketches", "front-matter"):
            with self.subTest(folder=folder), tempfile.TemporaryDirectory() as tmp:
                family = small_family(Path(tmp), story='Ada was born in 1990.#src("ada-birth")\n')
                (family / "book" / folder).mkdir(exist_ok=True)
                (family / "book" / folder / "0002-old.md").write_text("---\nrefn: ada-example\n---\n\nOld.\n")
                result = run_script(family, "book-coverage.py", "--quiet")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(f"book/{folder}/0002-old.md: the book reads only .typ files", result.stderr)


class TestCitationYearRange(unittest.TestCase):
    """The citation checks read every year a record can give, not a range
    tuned to one family's centuries."""

    def test_years_from_1000_to_this_year(self):
        this_year = coverage_mod.build_clock.today().year
        self.assertEqual(coverage_mod.years_in(f"In 1066, 1499, 1850 and {this_year}."),
                         ["1066", "1499", "1850", str(this_year)])
        self.assertEqual(coverage_mod.years_in(f"Lot 0999 and {this_year + 1} and 3000 acres."), [])
        # A house number is not a year.
        self.assertEqual(coverage_mod.years_in("They lived at 1412 Elm Street from 1931."), ["1931"])
        self.assertEqual(coverage_mod.years_in("At 1600 Pennsylvania Avenue in 1901."), ["1901"])


class TestOtherEditionsUseTheBookFonts(unittest.TestCase):
    """The archival PDF and the preview pages are set in the book's own font
    files, never in fonts the computer happens to have."""

    def test_editions_compile_with_only_the_books_fonts(self):
        with tempfile.TemporaryDirectory() as tmp:
            family = small_family(Path(tmp) / "family")
            (family / "build").mkdir()
            bin_dir = Path(tmp) / "bin"
            bin_dir.mkdir()
            record = Path(tmp) / "typst-calls.json"
            fake = bin_dir / "typst"
            fake.write_text(f"#!{sys.executable}\nimport json, os, sys\n"
                            "fonts = os.environ.get('TYPST_FONT_PATHS', '')\n"
                            f"open({str(record)!r}, 'a').write(json.dumps({{'args': sys.argv[1:], "
                            "'ignore': os.environ.get('TYPST_IGNORE_SYSTEM_FONTS'), "
                            "'fonts': sorted(os.listdir(fonts)) if os.path.isdir(fonts) else None}) + '\\n')\n")
            fake.chmod(0o755)
            env = dict(os.environ, FLYLEAF_FAMILY=str(family), PATH=f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
            for option in ("--archival", "--preview"):
                result = subprocess.run([sys.executable, str(HERE / "build-book.py"), option], cwd=family,
                                        env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            calls = [json.loads(line) for line in record.read_text().splitlines()]
        with patch.object(booklib.flyleaf_settings, "get", return_value=None):
            bundled = sorted(path.name for path in booklib.font_settings()["files"])
        self.assertEqual(len(calls), 2)
        for call in calls:
            self.assertEqual(call["ignore"], "true")
            self.assertEqual(call["fonts"], bundled)
        self.assertIn("a-2b", calls[0]["args"])
        self.assertIn("png", calls[1]["args"])


class TestGeneratedTextFitsTheBook(unittest.TestCase):
    """The book's own sentences describe the book it is in: no pointer to a
    chapter it lacks, and dates in its day-month-year style."""

    def assemble(self, family):
        result = subprocess.run([sys.executable, str(HERE / "book-assemble.py"), "--out",
                                 str(family / "book.typ")], cwd=family, capture_output=True, text=True,
                                env=dict(os.environ, FLYLEAF_FAMILY=str(family),
                                         SOURCE_DATE_EPOCH="1792204575"))
        self.assertEqual(result.returncode, 0, result.stderr)
        return (family / "book.typ").read_text()

    def test_a_new_family_book_names_no_missing_chapter_or_census_note(self):
        with tempfile.TemporaryDirectory() as tmp:
            family = small_family(Path(tmp))
            (family / "book" / "front-matter").mkdir()
            (family / "book" / "front-matter" / "01-introduction.typ").write_text(
                "= Introduction\n\nThis edition was compiled on {{stat:date}}.\n")
            book = self.assemble(family)
            self.assertIn("This edition was compiled on 16 October 2026.", book)
            self.assertNotIn("October 16, 2026", book)
            self.assertNotIn("Open Questions", book)
            self.assertNotIn("Census schedules", book)
            # Ada's one birth date is exact, so the table claims no provisional dates.
            self.assertNotIn("provisional and disputed dates", book)
            tree = family / "data" / "family.src.ged"
            tree.write_text(tree.read_text().replace("2 DATE 1990", "2 DATE ABT 1990"))
            self.assertIn("See the Register entries for the evidence", self.assemble(family))
            (family / "book" / "back-matter").mkdir()
            (family / "book" / "back-matter" / "98-open-questions.typ").write_text(
                "= Open Questions\n\nWho were Ada's parents?\n")
            self.assertIn("See the Register entries and Open Questions for the evidence",
                          self.assemble(family))

    def test_the_census_note_prints_when_census_sources_are_left_out(self):
        a = TestBibliography().assembler()
        a.reference_notes('parent', ['letters', 'household'], 2)
        self.assertIn("Census schedules are cited in the notes", a.bibliography())
        a.bibliography_policy = {'schema': 1, 'census_sources': []}
        self.assertNotIn("Census schedules", a.bibliography())


class TestStrandedFootnotes(unittest.TestCase):
    """A page that holds only the end of a footnote from the page before
    looks like a mistake. The build warns about it."""

    def compile(self, after):
        with tempfile.TemporaryDirectory(dir=booklib.ROOT) as tmp:
            src = Path(tmp) / "notes.typ"
            src.write_text(IMPORT + ': *\n#show: book.with(title: "Stranded note fixture")\n'
                           '#v(5.6in)\nA last line of text.#footnote[#lorem(160)]\n' + after)
            pdf = src.with_suffix(".pdf")
            proc = subprocess.run(["typst", "compile", "--root", str(booklib.ROOT), str(src), str(pdf)],
                                  capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            return footnotes_mod.stranded_notes(pdf, booklib.MARGINS_IN, starts={1})

    def test_a_page_with_only_a_continued_note_is_found(self):
        self.assertEqual(self.compile(""), [(2, "ii")])

    def test_a_continued_note_below_text_is_fine(self):
        self.assertEqual(self.compile("\n" + "More of the story. " * 120 + "\n"), [])



def stage_fixture_templates():
    """Stage the template beside a font module naming the bundled open fonts.
    Like the book build, Typst then reads only listed font files: the bundled
    ones and the family's own, which its title page uses."""
    with patch.object(booklib.flyleaf_settings, 'get', return_value=None):
        bundled = booklib.font_settings()['files']
        wanted = {FIXTURE_TEMPLATES / 'fonts.typ': booklib.font_module().encode(),
                  FIXTURE_TEMPLATES / 'page.typ': booklib.page_module({}).encode(),
                  FIXTURE_TEMPLATES / 'template.typ': (booklib.TEMPLATES / 'template.typ').read_bytes()}
    FIXTURE_TEMPLATES.mkdir(parents=True, exist_ok=True)
    for path, data in wanted.items():
        if not path.is_file() or path.read_bytes() != data:
            path.write_bytes(data)
    folders = sorted({str(path.parent) for path in bundled + booklib.font_settings()['files']})
    os.environ.update(TYPST_FONT_PATHS=os.pathsep.join(folders),
                      TYPST_IGNORE_SYSTEM_FONTS='true', TYPST_IGNORE_EMBEDDED_FONTS='true')


def setUpModule():
    # Typst fixtures import a template, which imports its fonts.
    booklib.stage_templates()
    stage_fixture_templates()


class TestTitlePageClaimsOnlyWhatTheEditorSays(unittest.TestCase):
    """A book is called documented only when its editor says so: a tree with
    no sources builds too, and must not be presented as proven."""

    def test_the_strapline_is_neutral_unless_set(self):
        self.assertEqual(booklib.strapline({}), "A Family History")
        self.assertEqual(booklib.strapline({"strapline": "A Documented Family History"}),
                         "A Documented Family History")
        for name in ("template.typ", "web-template.typ"):
            template = (booklib.TEMPLATES / name).read_text()
            self.assertNotIn("Documented Family History", template, name)
            self.assertIn("upper(strapline)", template, name)
        assemble = (HERE / "book-assemble.py").read_text()
        self.assertIn("booklib.strapline(cfg)", assemble)
        self.assertNotIn("Full documented detail", assemble)


def tearDownModule():
    FIXTURES.cleanup()


if __name__ == "__main__":
    unittest.main(verbosity=2)
