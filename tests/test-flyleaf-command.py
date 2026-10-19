#!/usr/bin/env python3
"""The flyleaf command: start a family, import a tree from another program."""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ENGINE = Path(__file__).resolve().parent.parent
COMMAND = ENGINE / "flyleaf"

# A tree as another program might export it: no Flyleaf ids, two people with
# the same name, one person who already has an id.
EXPORTED = """0 HEAD
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Ada /Example/
1 SEX F
1 BIRT
2 DATE 1990
1 FAMC @F1@
0 @I2@ INDI
1 NAME John /Example/
1 SEX M
1 BIRT
2 DATE 1960
1 FAMS @F1@
1 FAMC @F2@
0 @I3@ INDI
1 NAME Mary /Smith/
1 SEX F
1 FAMS @F1@
0 @I4@ INDI
1 NAME John /Example/
1 SEX M
1 BIRT
2 DATE 1930
1 FAMS @F2@
0 @I5@ INDI
1 REFN kept-id
2 TYPE jsonid
1 NAME Søren /Ånström/
1 SEX M
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I3@
1 CHIL @I1@
0 @F2@ FAM
1 HUSB @I4@
1 CHIL @I2@
0 TRLR
"""


def full_pedigree(generations):
    """A tree in which every ancestor is known, for that many generations."""
    text = "0 HEAD\n1 CHAR UTF-8\n"
    for n in range(1, 2 ** generations):
        text += (f"0 @P{n}@ INDI\n1 NAME Person{n} /Name{n if n % 2 or n == 1 else n // 2}/\n"
                 f"1 SEX {'F' if n % 2 and n > 1 else 'M'}\n")
        if n < 2 ** (generations - 1):
            text += f"1 FAMC @F{n}@\n"
        if n > 1:
            text += f"1 FAMS @F{n // 2}@\n"
    for n in range(1, 2 ** (generations - 1)):
        text += f"0 @F{n}@ FAM\n1 HUSB @P{2 * n}@\n1 WIFE @P{2 * n + 1}@\n1 CHIL @P{n}@\n"
    return text + "0 TRLR\n"


def flyleaf(*args, family=None):
    env = dict(os.environ)
    env.pop("FLYLEAF_FAMILY", None)
    command = [sys.executable, str(COMMAND), *args] + (["--family", str(family)] if family else [])
    return subprocess.run(command, capture_output=True, text=True, env=env)


class NewAndImport(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.family = Path(self.tmp.name) / "example-family"
        self.exported = Path(self.tmp.name) / "exported.ged"
        self.exported.write_text(EXPORTED)

    def start(self):
        result = flyleaf("new", str(self.family), "--name", "The Example family",
                         "--maintainer", "Ada Example", "--email", "ada@example.org")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_new_fills_in_the_family_and_maintainer(self):
        self.start()
        settings = json.loads((self.family / "flyleaf.json").read_text())
        self.assertEqual(settings["family"]["name"], "The Example family")
        self.assertEqual(settings["site"]["id"], "example-family")
        self.assertEqual(settings["maintainer"]["first_name"], "Ada")
        self.assertEqual(settings["email"]["from"], "ada@example.org")
        self.assertIn("title: Example family", (self.family / "book/book.yaml").read_text())
        agents = (self.family / "AGENTS.md").read_text()
        self.assertNotIn("{{", agents)
        self.assertIn(f"`{os.path.relpath(ENGINE, self.family.resolve())}/flyleaf`", agents)
        for name in ("CLAUDE.md", "PLAN.md", "research/questions.md", "research/requests.md"):
            self.assertTrue((self.family / name).is_file(), name)
        again = flyleaf("new", str(self.family))
        self.assertNotEqual(again.returncode, 0)

    def test_import_gives_everyone_a_unique_id_and_keeps_existing_ones(self):
        self.start()
        result = flyleaf("import", str(self.exported), family=self.family)
        self.assertEqual(result.returncode, 0, result.stderr)
        tree = (self.family / "data/family.src.ged").read_text()
        ids = [line.split(" ", 2)[2] for line in tree.splitlines() if line.startswith("1 REFN ")]
        self.assertEqual(ids, ["ada-example", "john-example", "mary-smith", "john-example-1930",
                               "kept-id"])
        self.assertEqual(tree.count("1 _CONFLEVEL tree-link"), 5)
        self.assertIn("1 NAME Søren /Ånström/", tree)

    def test_root_sets_the_book_and_proposes_chapters(self):
        self.start()
        result = flyleaf("import", str(self.exported), "--root", "Ada Example", family=self.family)
        self.assertEqual(result.returncode, 0, result.stderr)
        book = (self.family / "book/book.yaml").read_text()
        self.assertIn("root_refn: ada-example", book)
        self.assertIn('- {id: example, title: "The Example Side", lines: [example]}', book)
        # Mary's parents are unknown, so she joins her husband's line.
        self.assertNotIn('Smith Side', book)
        self.assertIn("lines: [origin], charts: false}", book)

    def test_new_never_writes_over_a_folders_files(self):
        self.family.mkdir()
        (self.family / "README.md").write_text("mine")
        result = flyleaf("new", str(self.family))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("README.md", result.stderr)
        self.assertEqual((self.family / "README.md").read_text(), "mine")

    def test_import_again_needs_replace_and_keeps_a_backup(self):
        self.start()
        self.assertEqual(flyleaf("import", str(self.exported), family=self.family).returncode, 0)
        tree = self.family / "data/family.src.ged"
        tree.write_text(tree.read_text() + "0 @N1@ NOTE hand edit\n")
        again = flyleaf("import", str(self.exported), family=self.family)
        self.assertNotEqual(again.returncode, 0)
        self.assertIn("--replace", again.stderr)
        self.assertIn("hand edit", tree.read_text())
        replaced = flyleaf("import", str(self.exported), "--replace", family=self.family)
        self.assertEqual(replaced.returncode, 0, replaced.stderr)
        backups = list((self.family / "data").glob("family.src.ged.*.bak"))
        self.assertEqual(len(backups), 1)
        self.assertIn("hand edit", backups[0].read_text())

    def test_a_tree_that_is_not_utf8_is_explained(self):
        self.start()
        latin = Path(self.tmp.name) / "latin.ged"
        latin.write_bytes(EXPORTED.replace("Søren", "S\u00f8ren").encode("latin-1"))
        result = flyleaf("import", str(latin), family=self.family)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("UTF-8", result.stderr)

    @unittest.skipUnless(shutil.which("typst") and shutil.which("pdfinfo"), "Typst and Poppler needed")
    def test_a_new_family_outside_flyleaf_builds_its_book(self):
        self.start()
        self.assertFalse(self.family.is_relative_to(ENGINE))
        self.assertEqual(flyleaf("import", str(self.exported), "--root", "ada-example",
                                 family=self.family).returncode, 0)
        # Story stubs, as a writer starts them, must not stop the build.
        scaffold = flyleaf("scaffold", family=self.family)
        self.assertEqual(scaffold.returncode, 0, scaffold.stdout[-2000:] + scaffold.stderr[-2000:])
        self.assertTrue(list((self.family / "book/sketches").glob("*.typ")))
        result = flyleaf("book", family=self.family)
        self.assertEqual(result.returncode, 0, result.stdout[-3000:] + result.stderr[-3000:])
        pdf = self.family / "build/book.pdf"
        self.assertTrue(pdf.is_file())
        # Coverage also runs the check deploy runs on what readers see.
        coverage = flyleaf("coverage", family=self.family)
        self.assertEqual(coverage.returncode, 0, coverage.stdout[-2000:] + coverage.stderr[-2000:])
        self.assertIn("family-text error(s)", coverage.stdout)
        fonts = subprocess.run(["pdffonts", str(pdf)], capture_output=True, text=True).stdout
        self.assertIn("LibertinusSerif", fonts)

    def test_a_failed_import_changes_nothing(self):
        self.start()
        book = self.family / "book/book.yaml"
        tree = self.family / "data/family.src.ged"
        before = book.read_text()
        # A root that matches nobody, and a tree the book cannot use (two
        # people with one Flyleaf id), are refused before anything is written.
        broken = Path(self.tmp.name) / "broken.ged"
        broken.write_text(EXPORTED.replace("1 NAME Ada /Example/", "1 REFN kept-id\n2 TYPE jsonid\n"
                                           "1 NAME Ada /Example/"))
        for args in ((str(self.exported), "--root", "Nobody Here"),
                     (str(broken), "--root", "Søren")):
            with self.subTest(args=args):
                result = flyleaf("import", *args, family=self.family)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(tree.exists())
                self.assertEqual(book.read_text(), before)
                self.assertEqual(sorted(p.name for p in (self.family / "data").iterdir()), [".keep"])
        self.assertIn("nothing in the family folder has changed", result.stderr)
        # A replacing import that fails keeps the old tree, without a backup.
        self.assertEqual(flyleaf("import", str(self.exported), "--root", "Ada Example",
                                 family=self.family).returncode, 0)
        kept, planned = tree.read_text(), book.read_text()
        result = flyleaf("import", str(broken), "--root", "Søren", "--replace", family=self.family)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(tree.read_text(), kept)
        self.assertEqual(book.read_text(), planned)
        self.assertEqual(sorted(p.name for p in (self.family / "data").iterdir()),
                         [".keep", "family.src.ged"])

    @unittest.skipUnless(shutil.which("typst") and shutil.which("pdftotext"), "Typst and Poppler needed")
    def test_text_in_the_tree_prints_as_written_and_reads_no_file(self):
        self.start()
        (self.family / "secret.txt").write_text("SECRET-FILE-TEXT")
        (self.family / "secret.typ").write_text('#let leaked = "SECRET-MODULE-TEXT"')
        code = '#read("/secret.txt") #import "/secret.typ": leaked $x$ @ref <label> *b* _i_ [x] \\ `r`'
        # A GEDCOM name has no slashes inside it; the slashes mark the surname.
        # In a name, import also writes an underscore as a space (as PAF did).
        named = code.replace("/", "").replace("_", " ")
        hostile = EXPORTED.replace("1 NAME Ada /Example/", f"1 NAME #Ada {named} /#Example $1/") \
            .replace("2 DATE 1990", f"2 DATE 1990\n2 PLAC Penzance {code}\n2 SOUR @S1@\n"
                                    f"3 PAGE == p. 4 {code}") \
            .replace("0 TRLR", f"0 @S1@ SOUR\n1 TITL 1. Register {code}\n1 _URL https://example.org/a\"b\n0 TRLR")
        tree = Path(self.tmp.name) / "hostile.ged"
        tree.write_text(hostile)
        result = flyleaf("import", str(tree), "--root", "@I1@", family=self.family)
        self.assertEqual(result.returncode, 0, result.stderr)
        result = flyleaf("book", family=self.family)
        self.assertEqual(result.returncode, 0, result.stdout[-3000:] + result.stderr[-3000:])
        text = subprocess.run(["pdftotext", str(self.family / "build/book.pdf"), "-"],
                              capture_output=True, text=True, check=True).stdout
        # Typst's typographic quotes, and words hyphenated at a line end.
        for curly, plain in (("“", '"'), ("”", '"'), ("‘", "'"), ("’", "'"), ("\u00ad\n", "")):
            text = text.replace(curly, plain)
        text = " ".join(text.split())
        self.assertNotIn("SECRET", text)
        # The register and its notes, the bibliography, the ancestor table's
        # heading and the index of names.
        for words in (f"#Ada {named} #Example $1 was born at Penzance {code} in 1990",
                      f"1. Register {code} — == p. 4 {code}", f"Other sources • 1. Register {code}",
                      f"Ahnentafel of #Ada {named} #Example $1", "#Ada is no. 1.",
                      f"# #Example $1, #Ada {named} — 1"):
            self.assertIn(" ".join(words.split()), text)
        receipt = json.loads((self.family / "build/book-publication.json").read_text())
        self.assertFalse([name for name in receipt["dependencies"] if "secret" in name])

    def test_new_names_a_family_folder_once(self):
        family = Path(self.tmp.name) / "smith-family"
        self.assertEqual(flyleaf("new", str(family)).returncode, 0)
        # The wording check that coverage and a public build run needs no maintainer yet.
        self.assertEqual(flyleaf("import", str(self.exported), family=family).returncode, 0)
        env = {**os.environ, "FLYLEAF_FAMILY": str(family)}
        wording = subprocess.run([sys.executable, str(ENGINE / "scripts/check-family-text.py")],
                                 capture_output=True, text=True, env=env, cwd=family)
        self.assertEqual(wording.returncode, 0, wording.stdout + wording.stderr)
        self.assertEqual(json.loads((family / "flyleaf.json").read_text())["family"]["name"],
                         "The Smith family")
        self.assertIn("title: Smith family", (family / "book/book.yaml").read_text())

    def test_new_says_the_next_command_as_the_reader_would_type_it(self):
        env = dict(os.environ)
        env.pop("FLYLEAF_FAMILY", None)
        env["PATH"] = os.defpath
        here = subprocess.run([sys.executable, "flyleaf", "new", str(self.family)],
                              capture_output=True, text=True, env=env, cwd=ENGINE)
        self.assertEqual(here.returncode, 0, here.stderr)
        self.assertIn("  ./flyleaf import your-tree.ged --family ", here.stdout)
        other = Path(self.tmp.name) / "other-family"
        there = subprocess.run([sys.executable, str(COMMAND), "new", "other-family"],
                               capture_output=True, text=True, env=env, cwd=self.tmp.name)
        self.assertEqual(there.returncode, 0, there.stderr)
        self.assertTrue(other.is_dir())
        self.assertIn(" import your-tree.ged --family other-family --root", there.stdout)
        self.assertNotIn("./flyleaf import", there.stdout)

    def test_version_matches_the_changelog_and_the_website(self):
        result = flyleaf("--version")
        self.assertEqual(result.returncode, 0, result.stderr)
        version = re.search(r"Flyleaf (\d+\.\d+\.\d+)", result.stdout).group(1)
        package = json.loads((ENGINE / "website/package.json").read_text())
        self.assertEqual(package["version"], version)
        first = re.search(r"^## (\d+\.\d+\.\d+)", (ENGINE / "CHANGELOG.md").read_text(), re.M)
        self.assertEqual(first.group(1), version)

    def test_ordinary_mistakes_get_plain_messages(self):
        self.start()
        missing = flyleaf("import", "no-such-tree.ged", family=self.family)
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn("no-such-tree.ged: no such file", missing.stderr)
        self.assertNotIn("Traceback", missing.stderr)
        settings = self.family / "flyleaf.json"
        settings.write_text(settings.read_text().replace('"site": {', '"site": {,', 1))
        broken = flyleaf("doctor", family=self.family)
        self.assertNotEqual(broken.returncode, 0)
        self.assertRegex(broken.stderr, r"flyleaf\.json, line \d+, column \d+")
        self.assertNotIn("Traceback", broken.stderr)

    def test_importing_again_keeps_each_persons_id(self):
        def tree(*people):
            text = "0 HEAD\n1 CHAR UTF-8\n"
            for xref, name, year in people:
                text += f"0 @{xref}@ INDI\n1 NAME {name}\n1 BIRT\n2 DATE {year}\n"
            return text + "0 TRLR\n"
        def ids(family):
            text = (family / "data/family.src.ged").read_text()
            found = {}
            for record in text.split("\n0 ")[1:]:
                xref = record.split()[0]
                refn = next((line.split(" ", 2)[2] for line in record.splitlines()
                             if line.startswith("1 REFN ")), None)
                if refn:
                    found[xref] = refn
            return found
        self.start()
        older, younger = ("I2", "John /Smith/", "1960"), ("I4", "John /Smith/", "1930")
        first = Path(self.tmp.name) / "first.ged"
        first.write_text(tree(older, younger, ("I6", "Mary /Jones/", "1935")))
        self.assertEqual(flyleaf("import", str(first), family=self.family).returncode, 0)
        before = ids(self.family)
        self.assertEqual(len(set(before.values())), 3)
        again = Path(self.tmp.name) / "again.ged"
        # The same people in another order, one name spelled anew, and one
        # program's new record numbers: everyone keeps their id.
        again.write_text(tree(younger, ("I6", "Mary Ann /Jones/", "1935"), older))
        result = flyleaf("import", str(again), "--replace", family=self.family)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(ids(self.family), before)
        renumbered = Path(self.tmp.name) / "renumbered.ged"
        renumbered.write_text(tree(("P1", "John /Smith/", "1930"), ("P2", "John /Smith/", "1960"),
                                   ("P3", "Mary Ann /Jones/", "1935")))
        self.assertEqual(flyleaf("import", str(renumbered), "--replace", family=self.family).returncode, 0)
        self.assertEqual(sorted(ids(self.family).values()), sorted(before.values()))
        self.assertEqual(ids(self.family)["@P1@"], before["@I4@"])
        # Someone left out, and a namesake added: the namesake gets a new id,
        # never the one that belonged to the person who left.
        namesake = Path(self.tmp.name) / "namesake.ged"
        namesake.write_text(tree(("P1", "John /Smith/", "1930"), ("P3", "Mary Ann /Jones/", "1935"),
                                 ("P9", "John /Smith/", "1990")))
        result = flyleaf("import", str(namesake), "--replace", family=self.family)
        self.assertEqual(result.returncode, 0, result.stderr)
        after = ids(self.family)
        self.assertNotIn(before["@I2@"], after.values())
        self.assertIn(before["@I2@"], result.stdout)

    def test_blank_and_indented_lines_are_tidied_on_import(self):
        # GEDCOM tells readers to ignore them; the book's reader is strict.
        self.start()
        tidy = Path(self.tmp.name) / "spaced.ged"
        tidy.write_text(EXPORTED.replace("1 SEX F\n", "  1 SEX F\n\n").replace("0 TRLR\n", "0 TRLR\n\n  \n"))
        result = flyleaf("import", str(tidy), family=self.family)
        self.assertEqual(result.returncode, 0, result.stderr)
        tree = (self.family / "data/family.src.ged").read_text()
        self.assertTrue(tree.endswith("0 TRLR\n"))
        self.assertFalse([line for line in tree.splitlines() if not line or line[0] == " "])

    def test_underscores_in_names_become_spaces_on_import(self):
        # PAF and other older programs wrote a space inside a name part as "_".
        self.start()
        paf = Path(self.tmp.name) / "paf.ged"
        paf.write_text(EXPORTED.replace("1 NAME Ada /Example/", "1 NAME Ada_Mary of_Example//"))
        result = flyleaf("import", str(paf), family=self.family)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("names with spaces where the file had underscores", result.stdout)
        tree = (self.family / "data/family.src.ged").read_text()
        self.assertIn("1 NAME Ada Mary of Example//", tree)
        self.assertIn("1 REFN ada-mary-of-example", tree)

    def test_every_import_checks_the_tree_it_installs(self):
        self.start()
        broken = Path(self.tmp.name) / "broken.ged"
        broken.write_text(EXPORTED.replace("1 SEX F\n", "1 SEX F\nnot a gedcom line\n", 1))
        result = flyleaf("import", str(broken), "--root", "Ada Example", family=self.family)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("nothing in the family folder has changed", result.stderr)
        self.assertFalse((self.family / "data/family.src.ged").exists())
        # Once the book has a root, a new tree without that person is refused,
        # even when the import names no root of its own.
        self.assertEqual(flyleaf("import", str(self.exported), "--root", "Ada Example",
                                 family=self.family).returncode, 0)
        kept = (self.family / "data/family.src.ged").read_text()
        renamed = Path(self.tmp.name) / "renamed.ged"
        # Someone else in Ada's place: another name and another birth year.
        renamed.write_text(EXPORTED.replace("1 NAME Ada /Example/\n1 SEX F\n1 BIRT\n2 DATE 1990",
                                            "1 NAME Beth /Other/\n1 SEX F\n1 BIRT\n2 DATE 1991"))
        result = flyleaf("import", str(renamed), "--replace", family=self.family)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ada-example", result.stderr)
        self.assertEqual((self.family / "data/family.src.ged").read_text(), kept)

    def test_a_first_import_without_a_root_says_how_to_name_one(self):
        self.start()
        unrooted = flyleaf("import", str(self.exported), family=self.family)
        self.assertEqual(unrooted.returncode, 0, unrooted.stderr)
        self.assertIn("--replace and --root", unrooted.stdout)
        empty = Path(self.tmp.name) / "empty.ged"
        empty.write_text("0 HEAD\n1 CHAR UTF-8\n0 TRLR\n")
        result = flyleaf("import", str(empty), "--replace", family=self.family)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("has no people in it", result.stderr)

    def test_an_older_programs_character_set_is_written_as_utf8(self):
        self.start()
        paf = Path(self.tmp.name) / "paf.ged"
        paf.write_text("0 HEAD\n1 SOUR PAF\n1 CHAR ANSEL\n0 @I1@ INDI\n1 NAME Mary/Windsor/\n"
                       "1 SEX F\n0 TRLR\n")
        result = flyleaf("import", str(paf), "--root", "Mary", family=self.family)
        self.assertEqual(result.returncode, 0, result.stderr)
        tree = (self.family / "data/family.src.ged").read_text()
        self.assertIn("\n1 CHAR UTF-8\n", tree)
        self.assertNotIn("ANSEL", tree)

    def test_a_family_folder_is_never_made_inside_flyleaf(self):
        # A real family's tree inside a copy of public code is one commit from public.
        inside = ENGINE / "family-made-by-a-test"
        result = flyleaf("new", str(inside))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("inside Flyleaf's own folder", result.stderr)
        self.assertFalse(inside.exists())

    def test_names_in_any_alphabet_get_readable_ids(self):
        self.start()
        names = EXPORTED.replace("Ada /Example/", "Zoë /Müller/").replace(
            "Mary /Smith/", "Ελένη /Παπαδοπούλου/").replace("John /Example/\n1 SEX M\n1 BIRT\n2 DATE 1930",
                                                           "小明 /王/\n1 SEX M\n1 BIRT\n2 DATE 1930")
        imported = Path(self.tmp.name) / "names.ged"
        imported.write_text(names)
        result = flyleaf("import", str(imported), family=self.family)
        self.assertEqual(result.returncode, 0, result.stderr)
        tree = (self.family / "data/family.src.ged").read_text()
        ids = [line.split(" ", 2)[2] for line in tree.splitlines() if line.startswith("1 REFN ")]
        self.assertEqual(ids, ["zoe-muller", "john-example", "eleni-papadopoulou",
                               "u5c0f-u660e-u738b", "kept-id"])

    def test_a_deep_trees_chapter_plan_names_its_nearer_lines(self):
        self.start()
        deep = Path(self.tmp.name) / "deep.ged"
        deep.write_text(full_pedigree(8))
        result = flyleaf("import", str(deep), "--root", "@P1@", family=self.family)
        self.assertEqual(result.returncode, 0, result.stderr)
        plan = [line for line in (self.family / "book/book.yaml").read_text().splitlines()
                if line.startswith("  - {")]
        self.assertEqual(len(plan), 3)
        for line in plan[:2]:
            lines = line.split("lines: [")[1].split("]")[0].split(", ")
            self.assertLessEqual(len(lines), 8, line)
        self.assertIn("other_lines: father", plan[0])
        self.assertIn("other_lines: mother", plan[1])
        self.assertIn("more distant lines", result.stdout)
        # The rest of the lines still reach the book through other_lines.
        scaffold = flyleaf("scaffold", family=self.family)
        self.assertEqual(scaffold.returncode, 0, scaffold.stdout[-2000:] + scaffold.stderr[-2000:])
        coverage = flyleaf("coverage", family=self.family)
        self.assertEqual(coverage.returncode, 0, coverage.stdout[-2000:] + coverage.stderr[-2000:])
        self.assertNotIn("unmapped-line", coverage.stdout)

    def test_doctor_checks_make_git_and_this_familys_fonts(self):
        self.start()
        settings = json.loads((self.family / "flyleaf.json").read_text())
        settings["book"]["fonts"] = {"files": ["fonts/missing-face.otf"]}
        (self.family / "flyleaf.json").write_text(json.dumps(settings))
        result = flyleaf("doctor", family=self.family)
        self.assertIn("make", result.stdout)
        self.assertIn("git", result.stdout)
        self.assertIn("!!  book fonts", result.stdout)
        self.assertIn("missing-face.otf", result.stdout)

    def test_questionnaire_shows_recorded_facts_and_keeps_the_living_private(self):
        self.start()
        died = Path(self.tmp.name) / "died.ged"
        died.write_text(EXPORTED.replace("2 DATE 1930\n", "2 DATE 1930\n1 DEAT\n2 DATE 2000\n")
                        .replace("2 DATE 1960\n", "2 DATE 1960\n1 NOTE [TODO] Ask about his divorce papers.\n")
                        .replace("2 DATE 1990\n", "2 DATE 1990\n1 NOTE [TODO] Where did Ada go to school?\n"))
        self.assertEqual(flyleaf("import", str(died), "--root", "Ada Example",
                                 family=self.family).returncode, 0)
        result = flyleaf("questionnaire", "john-example", family=self.family)
        self.assertEqual(result.returncode, 0, result.stderr)
        form = (self.family / "questionnaires/questionnaire-john-example.md").read_text()
        # A family record without a marriage event links partners; it does not marry them.
        self.assertIn("**You** — John Example: born 1960; partner of Mary Smith", form)
        self.assertNotIn("married", form)
        self.assertIn("**Your father** — John Example: born 1930; died 2000", form)
        self.assertEqual(form.count("Our records do not name John Example's father or mother"), 1)
        self.assertNotIn("public-record level", form)
        result = flyleaf("questionnaire", "ada-example", family=self.family)
        self.assertEqual(result.returncode, 0, result.stderr)
        form = (self.family / "questionnaires/questionnaire-ada-example.md").read_text()
        self.assertIn("**Your father** — John Example: (may be living: facts not shown here)", form)
        self.assertIn("**You** — Ada Example: born 1990", form)
        # Her own open question is asked; research notes about her father, who
        # may be living, stay out of a form she might pass around.
        self.assertIn("Where did Ada go to school?", form)
        self.assertNotIn("divorce papers", form)
        unknown = flyleaf("questionnaire", "nobody", family=self.family)
        self.assertNotEqual(unknown.returncode, 0)
        self.assertIn("No one in the tree has the id 'nobody'", unknown.stderr)

    def test_an_ambiguous_root_is_refused(self):
        self.start()
        result = flyleaf("import", str(self.exported), "--root", "John Example", family=self.family)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("matches 2 people", result.stderr)
        self.assertIn("John Example (john-example)", result.stderr)
        self.assertIn("(john-example-1930)", result.stderr)


if __name__ == "__main__":
    unittest.main()
