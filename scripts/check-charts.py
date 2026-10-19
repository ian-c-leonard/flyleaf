#!/usr/bin/env python3
"""Check compiled chart inventory, continuation numbering and physical width."""
from collections import Counter
import json
from pathlib import Path
import re
import subprocess
import sys

import bookcharts
import booklib

SELECTOR = 'selector(figure.where(kind: "family-chart")).or(<chart-check>).or(<chart-image>)'


def check_charts(manifest, elements):
    expected = {f"chart-{chapter_id}-{p['focus']}": p['number']
                for chapter_id, chapter in manifest['chapters'].items() for p in chapter['panels']}
    sources = Counter('/build/figures/' + p['file']
                      for chapter in manifest['chapters'].values() for p in chapter['panels'])
    figures = [e for e in elements if e.get('func') == 'figure']
    images = [e for e in elements if e.get('label') == '<chart-image>']
    checks = [e.get('value') for e in elements if e.get('label') == '<chart-check>']
    errors = []
    if len(figures) != len(expected) or len(checks) != len(expected):
        errors.append('Compiled chart/metadata counts do not match the expected panels')
    actual = Counter()
    for check in checks:
        if not isinstance(check, dict) or check.get('id') not in expected:
            errors.append('Unknown or invalid chart metadata')
            continue
        actual[check['id']] += 1
        if check.get('number') != expected[check['id']]:
            errors.append(f"Chart numbering disagrees with its continuation labels: {check['id']}")
        if type(check.get('page')) is not int or check['page'] < 1:
            errors.append('Chart has no valid final-layout page')
    if actual != Counter({key: 1 for key in expected}):
        errors.append('Missing or duplicate compiled chart identifier')
    if Counter(i.get('source') for i in images) != sources:
        errors.append('Missing, duplicated or unexpected chart image')
    for image in images:
        width = re.fullmatch(r'0% \+ ([\d.]+)pt', image.get('width', ''))
        if not width or abs(float(width[1]) - manifest['width_pt']) > .001 or image.get('height') != 'auto':
            errors.append(f"Chart has been resized: {image.get('source')}")
    return len(figures), errors


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    src = Path(args[0]) if args else booklib.ROOT / 'build' / 'book.typ'
    try:
        manifest = bookcharts.load_manifest(booklib.Tree())
        proc = subprocess.run(['typst', 'query', '--root', str(booklib.ROOT), str(src), SELECTOR],
                              capture_output=True, text=True)
        if proc.returncode:
            raise ValueError(proc.stderr)
        count, errors = check_charts(manifest, json.loads(proc.stdout))
    except (OSError, ValueError, TypeError, AttributeError, KeyError) as exc:
        sys.stderr.write(f'check-charts: FAIL — {exc}\n')
        return 1
    if errors:
        for error in errors:
            sys.stderr.write(f'check-charts: FAIL — {error}\n')
        return 1
    print(f"check-charts: OK — {count} panels, numbering and images accounted for; "
          f"{manifest['font_pt']}pt lettering at the specified print width")
    return 0


if __name__ == '__main__':
    sys.exit(main())
