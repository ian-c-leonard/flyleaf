#!/usr/bin/env python3
"""A new family's first site: from flyleaf new to the site build.

These tests build real books and sites, so they need Typst and the website's
packages. The full site build runs in a copy of Flyleaf, so it never touches
this checkout's website/public/data.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ENGINE = Path(__file__).resolve().parent.parent
READY = shutil.which('typst') and shutil.which('npm') and (ENGINE / 'website/node_modules').is_dir()

# A first tree: no sources, everyone has died.
TREE = """0 HEAD
1 SOUR AnotherProgram
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Alice /Brown/
1 SEX F
1 BIRT
2 DATE 5 MAY 1920
2 PLAC Boston, Suffolk, Massachusetts, USA
1 DEAT
2 DATE 1 JAN 2010
1 FAMC @F1@
0 @I2@ INDI
1 NAME Robert /Brown/
1 SEX M
1 BIRT
2 DATE 2 MAR 1890
1 DEAT
2 DATE 4 APR 1960
1 FAMS @F1@
0 @I3@ INDI
1 NAME Ruth /Green/
1 SEX F
1 BIRT
2 DATE 7 JUL 1892
1 DEAT
2 DATE 8 AUG 1965
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I3@
1 CHIL @I1@
1 MARR
2 DATE 10 JUN 1915
0 TRLR
"""

# One source, a brother the story names, and a godmother outside the family.
CITED = TREE.replace("2 PLAC Boston, Suffolk, Massachusetts, USA\n",
                     "2 PLAC Boston, Suffolk, Massachusetts, USA\n2 SOUR @S1@\n3 PAGE Entry 12\n"
                     ).replace("1 FAMC @F1@\n", "1 FAMC @F1@\n1 ASSO @I9@\n2 RELA Godmother\n", 1
                     ).replace("1 CHIL @I1@\n", "1 CHIL @I1@\n1 CHIL @I4@\n"
                     ).replace("0 TRLR\n", """0 @I4@ INDI
1 NAME Carl /Brown/
1 SEX M
1 BIRT
2 DATE 3 JUN 1922
1 DEAT
2 DATE 9 SEP 2015
1 FAMC @F1@
0 @I9@ INDI
1 NAME Gwen /Godmother/
1 SEX F
1 BIRT
2 DATE 1898
1 DEAT
2 DATE 1979
0 @S1@ SOUR
1 TITL Boston birth register, 1920
0 TRLR
""")

# Every kind of markup docs/book.md lists for a story.
STORY = r"""// ---
// refn: alice-brown
// covers: [alice-brown, robert-brown, ruth-green]
// ahnentafel: [1]
// citation_people: [carl-brown]
// status: draft
// line: origin
// title: Alice Brown
// continuous: true
// ---

// Every markup form the book guide lists.

== Alice and her brother

Alice was born in Boston in 1920.#src("s1") She was the elder sister of #refp("carl-brown"), and her parents were #refp("robert-brown") and #refp("ruth-green").

Some *bold*, some _italic_ and some `raw text`. She paid \$300 for lot \#1 \@ the fair, and a \*star\*.

#figure(image("/images/house.png"), caption: [The Brown house in Boston.])

#fig("house.png", caption: "The house again.")

She kept a diary.#footnote[A note of the family's own.]

#block(breakable: false)[
A paragraph kept together on one page.
]

#grid(columns: 2, gutter: 1em, [A left cell], [A right cell])

#pagebreak()

The next page.

#pagebreak(weak: true)

Two notes side by side.#src("s1")#super[, ]#src("s1")
"""

# A small PNG, written without an image library.
PNG = bytes.fromhex(
    '89504e470d0a1a0a0000000d49484452000000040000000308020000003b963991'
    '0000001349444154789c639c5611c500034c70163a070034e0016e2ed7e1830000'
    '000049454e44ae426082')


def flyleaf(engine, *args, family=None):
    env = {k: v for k, v in os.environ.items() if k != 'FLYLEAF_FAMILY'}
    command = [sys.executable, str(engine / 'flyleaf'), *args, *(['--family', str(family)] if family else [])]
    return subprocess.run(command, capture_output=True, text=True, env=env)


def copy_engine(target):
    """Flyleaf without its build output, sharing the installed packages."""
    skip = {'node_modules', 'dist', 'work', '__pycache__', 'test-results', 'outputs', '.git', 'build'}

    def ignore(folder, names):
        here = Path(folder)
        left = {n for n in names if n in skip}
        if here == ENGINE / 'website/public':
            left |= {'data', 'geography', 'pdfjs'} & set(names)
        return left

    shutil.copytree(ENGINE, target, ignore=ignore, symlinks=True)
    (target / 'website/node_modules').symlink_to(ENGINE / 'website/node_modules')


@unittest.skipUnless(READY, 'needs Typst, npm and the website packages')
class NewFamilySite(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.family = self.base / 'brown-family'

    def start(self, tree, engine=ENGINE):
        result = flyleaf(engine, 'new', str(self.family), '--name', 'The Brown family',
                         '--maintainer', 'Ada Brown', '--email', 'ada@example.org')
        self.assertEqual(result.returncode, 0, result.stderr)
        (self.base / 'tree.ged').write_text(tree)
        result = flyleaf(engine, 'import', str(self.base / 'tree.ged'), '--root', 'alice-brown',
                         '--replace', family=self.family)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def book(self, engine=ENGINE):
        flyleaf(engine, 'coverage', '--mark-all', family=self.family)
        result = flyleaf(engine, 'book', family=self.family)
        self.assertEqual(result.returncode, 0, result.stdout[-3000:] + result.stderr[-3000:])

    def site_data(self):
        """The site build's data step, writing only inside this test's folders."""
        env = {**os.environ, 'FLYLEAF_FAMILY': str(self.family)}
        work, data = self.base / 'work', self.base / 'data'
        steps = [['render-source-text.py'],
                 ['compose-website.py', '--book-map', 'book/CLAIMS-MAP.json',
                  '--output', str(work / 'current.ged')],
                 ['export-website.py', '--source', str(work / 'current.ged'), '--output', str(data),
                  '--previews', '--book-receipt', 'build/book-publication.json', '--native-book',
                  '--composition-receipt', str(work / 'current.composition.json')]]
        self.output = ''
        for step in steps:
            run = subprocess.run([sys.executable, str(ENGINE / 'scripts' / step[0]), *step[1:]],
                                 cwd=self.family, env=env, capture_output=True, text=True)
            self.output += run.stdout + run.stderr
            if run.returncode:
                return run
        return run

    def test_a_new_family_with_no_sources_builds_its_site(self):
        engine = self.base / 'flyleaf'
        copy_engine(engine)
        self.start(TREE, engine)
        self.book(engine)
        result = flyleaf(engine, 'site', 'build', family=self.family)
        self.assertEqual(result.returncode, 0, result.stdout[-3000:] + result.stderr[-3000:])
        data = engine / 'website/public/data'
        published = (data / 'family.ged').read_text()
        self.assertIn('Alice /Brown/', published)
        self.assertNotIn('AnotherProgram', published)
        self.assertTrue((engine / 'website/dist').exists())
        self.assertTrue((self.family / 'build/site-data-report.json').is_file())

    def test_every_markup_form_in_the_book_guide_reaches_the_site(self):
        self.start(CITED)
        sketches = self.family / 'book/sketches'
        sketches.mkdir(parents=True, exist_ok=True)
        (sketches / '0001-alice-brown.typ').write_text(STORY)
        # A Mac writes .DS_Store into folders it shows.
        (sketches / '.DS_Store').write_bytes(b'\x00\x00\x00\x01Bud1\x00\xff binary')
        (self.family / 'images').mkdir(exist_ok=True)
        (self.family / 'images/house.png').write_bytes(PNG)
        self.book()
        run = self.site_data()
        self.assertEqual(run.returncode, 0, run.stdout[-3000:] + run.stderr[-3000:])
        published = (self.base / 'data/family.ged').read_text()
        self.assertNotIn('Godmother', published)
        book = json.loads((self.base / 'data/book.json').read_text())
        html = json.loads((self.base / 'data' / book['webBook']['path']).read_text())['html']
        self.assertRegex(html, r'<div>A left cell</div>\s*<div>A right cell</div>')
        self.assertIn('<code>raw text</code>', html)
        self.assertIn('elder sister of', html)
        # Reader annotations are optional: without catalogue files the book
        # pages are plain, and the build says nothing about them.
        self.assertNotIn('arning', self.output)
        self.assertNotIn('annotation', self.output.lower())

    def test_a_sourced_person_outside_the_book_does_not_stop_the_site(self):
        # Someone with a source, linked to no one the book prints.
        self.start(TREE.replace("0 TRLR\n", "0 @I8@ INDI\n1 NAME Una /Related/\n1 BIRT\n2 DATE 1850\n"
                                "2 SOUR @S8@\n1 DEAT\n2 DATE 1920\n0 @S8@ SOUR\n1 TITL A parish register\n"
                                "0 TRLR\n"))
        self.book()
        run = self.site_data()
        self.assertEqual(run.returncode, 0, run.stdout[-3000:] + run.stderr[-3000:])

    def test_a_public_site_stops_for_people_who_may_be_living(self):
        self.start(TREE.replace('2 DATE 5 MAY 1920', '2 DATE 5 MAY 1950').replace('1 DEAT\n2 DATE 1 JAN 2010\n', ''))
        self.book()
        run = self.site_data()
        self.assertEqual(run.returncode, 1, run.stdout[-2000:])
        self.assertNotIn('Traceback', run.stderr)
        self.assertIn('may be living:\n  Alice Brown (alice-brown)', run.stderr)
        settings = json.loads((self.family / 'flyleaf.json').read_text())
        settings['site']['publish_living_people'] = True
        (self.family / 'flyleaf.json').write_text(json.dumps(settings, indent=2))
        run = self.site_data()
        self.assertEqual(run.returncode, 0, run.stdout[-2000:] + run.stderr[-2000:])


if __name__ == '__main__':
    unittest.main()
