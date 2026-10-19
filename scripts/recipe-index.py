#!/usr/bin/env python3
"""Find candidate recipe names in the family's recipe book, for review.

Reads the text layer of the original PDFs (family-recipes.json) and writes
build/recipe-index-candidates.json: each line that looks like a recipe title,
with its volume and page, and the cook credited beside it when there is one.
The PDFs are never changed, and neither is the family's own recipe index
(recipe-index.json): copy the candidates you keep into it by hand.

How titles are found is set in family-recipes.json, under "indexing", for
every volume or for one volume (a volume's own "indexing" wins):

    "indexing": {
      "header_lines": 3,
      "credit_gap": 3,
      "not_titles": ["PASTRY", "FILLING"],
      "skip_category_headings": true
    }

- header_lines: lines at the top of each page to skip, such as a running
  head. Default 0.
- credit_gap: a run of this many spaces separates a title from a credit on
  the same line. 0 means titles have no credits beside them. Default 3.
- not_titles: lines in capitals that are not recipes, such as section names
  inside a recipe. HINT, HINTS, NOTE, NOTES, TIP and TIPS are always skipped.
- skip_category_headings: true when the contents pages' category headings
  are section titles in the book rather than the first recipe of each
  section. Default false.

A title is a line written in capitals, with at least three letters.

    python3 scripts/recipe-index.py [--out FILE]
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import flyleaf_settings  # noqa: E402

ROOT = flyleaf_settings.family_root()
CATALOG = flyleaf_settings.path('site_content') / 'family-recipes.json'
CURATED = flyleaf_settings.path('site_content') / 'recipe-index.json'
OUT = ROOT / 'build' / 'recipe-index-candidates.json'

DEFAULTS = {'header_lines': 0, 'credit_gap': 3, 'not_titles': [],
            'skip_category_headings': False}
NOT_TITLES = {'HINT', 'HINTS', 'NOTE', 'NOTES', 'TIP', 'TIPS'}
SMALL = {'a', 'an', 'and', 'or', 'of', 'the', 'in', 'on', 'for', 'with',
         'to', 'au', 'al', 'alla', 'di', 'de', 'en', "'n", '’n'}


def title_case(text):
    words = []
    for i, word in enumerate(text.lower().split()):
        if i and word in SMALL:
            words.append(word)
            continue
        # Capitalise after slashes and hyphens too: Blue/Gorgonzola, Roll-Ups.
        words.append(re.sub(r'(^|[/\-(“"])(\w)',
                            lambda m: m.group(1) + m.group(2).upper(), word))
    return ' '.join(words)


def rules_for(catalog, volume):
    """The indexing rules for one volume: Flyleaf's defaults, then the
    catalogue's, then the volume's own."""
    rules = dict(DEFAULTS)
    for layer in (catalog.get('indexing') or {}, volume.get('indexing') or {}):
        unknown = set(layer) - set(DEFAULTS)
        if unknown:
            raise SystemExit(f"{volume['id']}: unknown indexing settings {sorted(unknown)}; "
                             f"use {', '.join(DEFAULTS)}")
        rules.update(layer)
    for key in ('header_lines', 'credit_gap'):
        if type(rules[key]) is not int or rules[key] < 0:
            raise SystemExit(f"{volume['id']}: indexing {key} must be a whole number")
    return rules


def page_text(pdf, page):
    return subprocess.run(
        ['pdftotext', '-layout', '-f', str(page), '-l', str(page), str(pdf), '-'],
        capture_output=True, text=True, check=True).stdout


def recipes_in(volume, rules, read=page_text):
    pdf = ROOT / volume['path']
    skip = NOT_TITLES | set(rules['not_titles'])
    if rules['skip_category_headings']:
        skip |= {c['heading'] for c in volume['categories']}
    gap = rules['credit_gap']
    title = re.compile(r'^(\S(?:.*?\S)?)' + (rf'(?:\s{{{gap},}}(\S.*))?$' if gap else r'()$'))
    for page in range(volume['contentsPages'] + 1, volume['pages'] + 1):
        for line in read(pdf, page).split('\n')[rules['header_lines']:]:
            # A title starts at the left margin.
            match = title.match(line.rstrip())
            if not match:
                continue
            name, credit = match.group(1).strip(), (match.group(2) or '').strip()
            letters = re.sub(r'[^A-Za-zÀ-ÿ]', '', name)
            if len(letters) < 3 or letters != letters.upper() or name in skip:
                continue
            row = {'name': title_case(name), 'volume': volume['id'], 'page': page}
            if credit and not credit.isupper():
                row['credit'] = credit
            yield row


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--out', type=Path, default=OUT)
    args = parser.parse_args(argv)
    if args.out.resolve() == CURATED.resolve():
        sys.exit(f'{CURATED.name} is the family\'s own index; write the candidates elsewhere')
    catalog = json.loads(CATALOG.read_text()) if CATALOG.is_file() else None
    if catalog is None:
        print('No recipe book (family-recipes.json); nothing to index.')
        return
    volumes, recipes = {}, []
    for volume in catalog['volumes']:
        if volume['kind'] == 'letter':
            continue
        digest = hashlib.sha256((ROOT / volume['path']).read_bytes()).hexdigest()
        if digest != volume['sha256']:
            raise SystemExit(f"{volume['id']}: PDF does not match the catalogue")
        volumes[volume['id']] = digest
        recipes.extend(recipes_in(volume, rules_for(catalog, volume)))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    # One recipe per line keeps the file small and its diffs readable.
    rows = ',\n'.join(json.dumps(row, ensure_ascii=False) for row in recipes)
    args.out.write_text('{"version": 1, "volumes": ' + json.dumps(volumes)
                        + ',\n"recipes": [\n' + rows + '\n]}\n')
    curated = json.loads(CURATED.read_text()) if CURATED.is_file() else {'recipes': []}
    known = {(r['volume'], r['page'], r['name'].casefold()) for r in curated['recipes']}
    new = [r for r in recipes if (r['volume'], r['page'], r['name'].casefold()) not in known]
    print(f'{len(recipes)} candidate recipes -> {args.out}; '
          f'{len(new)} are not in {CURATED.name} yet')


if __name__ == '__main__':
    main()
