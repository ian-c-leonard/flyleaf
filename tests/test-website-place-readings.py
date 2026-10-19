"""Keep place/book assertions and their qualifications bound to the real section."""
from copy import deepcopy
from pathlib import Path
from html import escape
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parent.parent / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import flyleaf_settings

ROOT = flyleaf_settings.ENGINE
CONTENT = flyleaf_settings.path('site_content')

# An invented native book and its curated place readings. The last reading
# carries a qualification that must stay in the same section.
FIXTURE_HTML = ('<h2 id="ch-test">A family</h2>'
                '<h3 id="reading-the-farm">The farm</h3>'
                '<p>Edith attended the village school in Penzance.</p>'
                '<h3 id="reading-the-house">The house</h3>'
                '<p>A parish history says Joan grew up in the cottage by the harbour wall. '
                'The cottage was rebuilt twice, so the rooms she knew may not survive.</p>')
FIXTURE_READINGS = [
    {'place': 'penzance', 'kind': 'work', 'anchor': 'reading-the-farm', 'people': ['edith'],
     'witness': 'Edith attended the village school in Penzance.'},
    {'place': 'harbour-cottage', 'kind': 'family', 'anchor': 'reading-the-house', 'people': ['joan'],
     'witness': 'A parish history says Joan grew up in the cottage by the harbour wall.',
     'requiredContext': ['The cottage was rebuilt twice, so the rooms she knew may not survive.']},
]


def fixture():
    """The invented book metadata, book body and readings."""
    return {'webBook': {'path': 'native-book/fixture.json'}}, {'html': FIXTURE_HTML}, deepcopy(FIXTURE_READINGS)


def current():
    """The current family's built book metadata, book body and readings."""
    metadata = json.loads((ROOT / 'website/public/data/book.json').read_text())
    body = json.loads((ROOT / 'website/public/data' / metadata['webBook']['path']).read_bytes())
    readings = json.loads(flyleaf_settings.content_file('place-readings.json').read_text())
    return metadata, body, readings


def probe(mutate, *, optimized=False, inputs=fixture):
    with tempfile.TemporaryDirectory(prefix='family-place-reading-') as directory:
        root = Path(directory)
        (root / 'scripts').mkdir()
        (root / 'website/public/data').mkdir(parents=True)
        (root / 'website/content').mkdir(parents=True)
        script = root / 'scripts/validate-website-place-readings.py'
        shutil.copyfile(ROOT / 'scripts/validate-website-place-readings.py', script)
        shutil.copyfile(ROOT / 'scripts/flyleaf_settings.py', root / 'scripts/flyleaf_settings.py')
        (root / 'flyleaf.json').write_text(json.dumps({'paths': {'site_content': 'website/content'}}))
        metadata, body, readings = inputs()
        book = metadata['webBook']
        mutate(body, readings)
        raw = json.dumps(body).encode()
        # Simulate a legitimate new book generation: the guard must check
        # the changed wording even when its new length/hash are correct.
        book.update(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
        payload = root / 'website/public/data' / book['path']
        payload.parent.mkdir(parents=True, exist_ok=True)
        payload.write_bytes(raw)
        (root / 'website/public/data/book.json').write_text(json.dumps(metadata))
        (root / 'website/content/place-readings.json').write_text(json.dumps(readings))
        return subprocess.run([sys.executable, *(['-O'] if optimized else []), str(script)],
                              capture_output=True, text=True,
                              env=dict(os.environ, FLYLEAF_FAMILY=str(root)))


class PlaceReadingChecks:
    """The guard's rules, run against the book and readings from probe()."""

    def probe(self, mutate, *, optimized=False):
        return probe(mutate, optimized=optimized)

    def test_current_associations_pass(self):
        result = self.probe(lambda body, readings: None)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_missing_qualification_rejects_even_with_updated_payload_hash(self):
        def remove_context(body, readings):
            qualification = escape(readings[-1]['requiredContext'][0])
            self.assertEqual(body['html'].count(qualification), 1)
            body['html'] = body['html'].replace(qualification, '')
        for optimized in (False, True):
            with self.subTest(optimized=optimized):
                result = self.probe(remove_context, optimized=optimized)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Book/place wording needs review', result.stderr)

    def test_qualification_in_a_different_section_does_not_count(self):
        def move_context(body, readings):
            qualification = escape(readings[-1]['requiredContext'][0])
            self.assertEqual(body['html'].count(qualification), 1)
            body['html'] = body['html'].replace(qualification, '')
            body['html'] += '<h2 id="unrelated-section">Another section</h2>' + qualification
        result = self.probe(move_context)
        self.assertNotEqual(result.returncode, 0)

    def test_missing_primary_witness_rejects_under_optimized_python(self):
        result = self.probe(lambda body, readings: readings[0].update(witness='Absent place witness'),
                            optimized=True)
        self.assertNotEqual(result.returncode, 0)


class PlaceReadingTests(PlaceReadingChecks, unittest.TestCase):
    def test_the_current_family_readings_match_its_built_book(self):
        result = probe(lambda body, readings: None, inputs=current)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
