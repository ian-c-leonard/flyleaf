#!/usr/bin/env python3
"""Publication failures must not destroy the previous readable edition."""
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

import sys
SCRIPTS = Path(__file__).resolve().parent.parent / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import booklib

# The book template as the Typst compiler (root: the family folder) sees it.
IMPORT = f'#import "{booklib.TEMPLATE_IMPORT}"'
import book_publication as publication

builder = booklib._load_module('build-book.py', 'publication_builder_test')


@unittest.skipUnless(shutil.which('typst'), 'Typst required for PDF reproducibility')
class PdfReproducibilityTests(unittest.TestCase):
    """Exercise the real print template and compiler, including local midnight."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=booklib.ROOT)
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.source = self.directory / 'edition.typ'
        self.pdf = self.directory / 'edition.pdf'

    def compile(self, local_time, body='Same dated edition.'):
        timestamp = str(int(datetime.fromisoformat(local_time).replace(
            tzinfo=ZoneInfo('America/New_York')).timestamp()))
        self.source.write_text(
            IMPORT + ': book\n'
            '#show: book.with(title: "Reproducibility fixture", author: "Family")\n'
            + body + '\n')
        env = dict(os.environ, TZ='America/New_York', SOURCE_DATE_EPOCH=timestamp)
        result = subprocess.run(
            ['typst', 'compile', '--root', str(booklib.ROOT),
             '--creation-timestamp', timestamp, str(self.source), str(self.pdf)],
            env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = self.pdf.read_bytes()
        fields = {}
        for name, pattern in (
            ('creation', rb'/CreationDate \(D:([^)]*)\)'),
            ('modification', rb'/ModDate \(D:([^)]*)\)'),
            ('xmpCreation', rb'<xmp:CreateDate>([^<]+)</xmp:CreateDate>'),
            ('xmpModification', rb'<xmp:ModifyDate>([^<]+)</xmp:ModifyDate>'),
            ('document', rb'<xmpMM:DocumentID>([^<]+)</xmpMM:DocumentID>'),
            ('instance', rb'<xmpMM:InstanceID>([^<]+)</xmpMM:InstanceID>'),
        ):
            values = re.findall(pattern, data)
            self.assertEqual(len(values), 1, (name, values))
            fields[name] = values[0]
        trailer = re.findall(rb'/ID \[\(([^)]+)\) \(([^)]+)\)\]', data)
        self.assertEqual(trailer, [(fields['document'], fields['instance'])])
        return data, fields

    def test_different_seconds_on_one_local_day_produce_identical_pdfs(self):
        first, first_fields = self.compile('2026-09-14T00:00:01')
        second, second_fields = self.compile('2026-09-14T23:59:59')
        self.assertEqual(first, second)
        self.assertEqual(first_fields, second_fields)
        # Typst 0.14.2 normalizes the date-only value to midnight in PDF/XMP.
        self.assertEqual(first_fields['creation'], b'20260914000000Z')
        self.assertEqual(first_fields['modification'], b'20260914000000Z')
        self.assertEqual(first_fields['xmpCreation'], b'2026-09-14T00:00:00Z')
        self.assertEqual(first_fields['xmpModification'], b'2026-09-14T00:00:00Z')

    def test_utc_midnight_does_not_change_the_local_edition_date(self):
        first, fields = self.compile('2026-09-14T19:59:59')
        second, _ = self.compile('2026-09-14T20:00:01')
        self.assertEqual(first, second)
        self.assertEqual(fields['creation'], b'20260914000000Z')

    def test_local_midnight_changes_the_pdf_date_and_instance(self):
        first, first_fields = self.compile('2026-09-14T23:59:59')
        second, second_fields = self.compile('2026-09-15T00:00:01')
        self.assertNotEqual(first, second)
        self.assertEqual(first_fields['creation'], b'20260914000000Z')
        self.assertEqual(second_fields['creation'], b'20260915000000Z')
        self.assertEqual(first_fields['document'], second_fields['document'])
        self.assertNotEqual(first_fields['instance'], second_fields['instance'])

    def test_changed_content_on_the_same_day_changes_the_pdf_and_instance(self):
        first, first_fields = self.compile('2026-09-14T12:00:00')
        second, second_fields = self.compile('2026-09-14T12:00:01', 'An actual revision.')
        self.assertNotEqual(first, second)
        self.assertEqual(first_fields['creation'], second_fields['creation'])
        self.assertEqual(first_fields['document'], second_fields['document'])
        self.assertNotEqual(first_fields['instance'], second_fields['instance'])


class PublicationTests(unittest.TestCase):
    def test_install_failure_restores_all_previous_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            stage, output = root / 'stage', root / 'output'
            stage.mkdir(); output.mkdir()
            names = ('book.typ', 'book.pdf', 'book-publication.json')
            for name in names:
                (stage / name).write_text('new ' + name)
                (output / name).write_text('previous ' + name)
            replace = Path.replace

            def fail_receipt(path, target):
                if path == stage / 'book-publication.json':
                    raise OSError('simulated receipt installation failure')
                return replace(path, target)

            with patch.object(Path, 'replace', fail_receipt):
                with self.assertRaises(OSError):
                    builder.install(stage, output)
            for name in names:
                self.assertEqual((output / name).read_text(), 'previous ' + name)
            self.assertEqual(sorted(p.name for p in output.iterdir()), sorted(names))

    def test_failed_rollback_keeps_a_recovery_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            stage, output = root / 'stage', root / 'output'
            stage.mkdir(); output.mkdir()
            for name in ('book.typ', 'book.pdf', 'book-publication.json'):
                (stage / name).write_text('new ' + name)
                (output / name).write_text('previous ' + name)
            replace = Path.replace

            def fail(path, target):
                if path.name == 'book-publication.json' or path.parent.name.startswith('.book-previous-'):
                    raise OSError('simulated filesystem failure')
                return replace(path, target)

            with patch.object(Path, 'replace', fail):
                with self.assertRaisesRegex(RuntimeError, 'Restore the previous book'):
                    builder.install(stage, output)
            recovery, = output.glob('.book-previous-*')
            for name in ('book.typ', 'book.pdf', 'book-publication.json'):
                self.assertEqual((recovery / name).read_text(), 'previous ' + name)

    def test_interrupt_after_successful_replace_still_restores_the_previous_pdf(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            stage, output = root / 'stage', root / 'output'
            stage.mkdir(); output.mkdir()
            names = ('book.typ', 'book.pdf', 'book-publication.json')
            for name in names:
                (stage / name).write_text('new ' + name)
                (output / name).write_text('previous ' + name)
            replace = Path.replace

            def interrupt(path, target):
                result = replace(path, target)
                if path == stage / 'book.pdf':
                    raise KeyboardInterrupt()
                return result

            with patch.object(Path, 'replace', interrupt):
                with self.assertRaises(KeyboardInterrupt):
                    builder.install(stage, output)
            for name in names:
                self.assertEqual((output / name).read_text(), 'previous ' + name)

    def test_receipt_detects_omitted_dependencies_and_changed_pdf_metadata(self):
        receipt = {'schema': 1, 'status': 'checked-build',
                   'dependencies': {'build/flyleaf/template.typ': 'a' * 64},
                   'book': {'pages': 467}}
        receipt['integritySha256'] = publication.seal(receipt)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'receipt.json'
            for changed in ({**receipt, 'dependencies': {}}, {**receipt, 'book': {'pages': 1}}):
                path.write_text(json.dumps(changed))
                with self.assertRaisesRegex(ValueError, 'does not match'):
                    publication.verify_receipt(path)


def setUpModule():
    # Typst fixtures import the template, which imports the family's fonts.
    booklib.stage_templates()


if __name__ == '__main__':
    unittest.main()
