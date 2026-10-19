#!/usr/bin/env python3
"""The deploy's family-text check: general warnings, and a family's own errors."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parent.parent / 'scripts' / 'check-family-text.py'


class FamilyTextTests(unittest.TestCase):
    def check(self, lines, text_checks=None, pdf_text=None, warnings=False):
        with tempfile.TemporaryDirectory() as folder:
            family = Path(folder)
            settings = {'maintainer': {'first_name': 'Carol'},
                        'paths': {'site_content': 'site', 'source_gedcom': 'family.ged'},
                        'text_checks': text_checks or {}}
            (family / 'flyleaf.json').write_text(json.dumps(settings))
            (family / 'family.ged').write_text('0 HEAD\n0 TRLR\n')
            story = family / 'book/sketches/0001-story.typ'
            story.parent.mkdir(parents=True)
            story.write_text('\n\n'.join(lines) + '\n')
            if pdf_text is not None:
                (family / 'build').mkdir()
                source = family / 'build/probe.typ'
                source.write_text(pdf_text)
                subprocess.run(['typst', 'compile', str(source), str(family / 'build/book.pdf')],
                               check=True, capture_output=True)
            run = subprocess.run([sys.executable, str(SCRIPT), *(['--warnings'] if warnings else [])],
                                 env={**os.environ, 'FLYLEAF_FAMILY': str(family)},
                                 capture_output=True, text=True)
            return run.returncode, run.stdout

    def test_ordinary_prose_never_stops_a_deploy(self):
        code, out = self.check(['He gave testimony at the inquest.',
                                'The date is provisional.',
                                'She was remembered for her songs.',
                                'Her baptism has not been located.'])
        self.assertEqual(code, 0, out)
        self.assertIn('0 family-text error(s)', out)
        self.assertIn('Run flyleaf coverage --wording', out)

    def test_general_warnings_show_on_request(self):
        code, out = self.check(['Carol supplied the names.', 'The family remembers the mill.'],
                               warnings=True)
        self.assertEqual(code, 0, out)
        self.assertIn('warning: “Carol supplied”', out)
        self.assertIn('warning: “family remembers”', out)

    def test_one_familys_notebook_phrases_are_not_built_in(self):
        code, out = self.check(['From a project conversation.', 'Found via Ancestry in 2020.',
                                'Credit to an Ancestry member.'], warnings=True)
        self.assertEqual(code, 0, out)
        self.assertNotIn('project conversation', out)
        self.assertNotIn('Ancestry', out)

    def test_a_familys_own_errors_stop_a_deploy(self):
        code, out = self.check(['He gave testimony at the inquest.', 'This is pending a word from Carol.',
                                'An ordinary sentence.'],
                               {'errors': [r'\btestimony\b', r'\bpending\b.*\b{maintainer}\b']})
        self.assertEqual(code, 1, out)
        self.assertIn('error: “testimony”', out)
        self.assertIn('error: “pending a word from Carol”', out)
        self.assertIn('2 family-text error(s)', out)

    def test_a_setting_that_is_not_a_list_is_explained(self):
        code, out = self.check(['Text.'], {'errors': 'testimony'})
        self.assertNotEqual(code, 0)

    @unittest.skipUnless(shutil.which('typst') and shutil.which('pdftotext'), 'needs typst and pdftotext')
    def test_the_printed_book_stops_only_on_internal_labels_and_the_familys_phrases(self):
        pdf = 'The correlation is weak.\n\nA retrospective account.\n\nAn ordinary line.\n'
        code, out = self.check(['Text.'], pdf_text=pdf)
        self.assertEqual(code, 0, out)
        code, out = self.check(['Text.'], {'printed_book_errors': [r'\bcorrelat(ed|es|ion)\b']},
                               pdf_text=pdf)
        self.assertEqual(code, 1, out)
        self.assertIn('build/book.pdf:', out)
        self.assertIn('“correlation”', out)
        code, out = self.check(['Text.'], pdf_text='A [Source] label printed.\n')
        self.assertEqual(code, 1, out)
        self.assertIn('internal label “[Source]”', out)


if __name__ == '__main__':
    unittest.main()
