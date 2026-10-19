#!/usr/bin/env python3
"""Re-pin the site's edition.ged after deliberate edits to records or prose.

edition.ged lives in the family's site content folder (paths.site_content in
flyleaf.json, "site" for a new family). Each person entry there carries the
hash of the tree record it adds to, and each chapter adaptation carries the
hash of its book story, so an unchecked change stops the site build. After
you have edited and checked a record in the tree or a story in the book's
sketches folder, run `flyleaf repin` to record the new hashes. It prints each
change.
"""
import hashlib
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import flyleaf_settings  # noqa: E402

ROOT = flyleaf_settings.family_root()
SOURCE = flyleaf_settings.path('source_gedcom')
OVERLAY = flyleaf_settings.path('site_content') / 'edition.ged'


def records(text):
    return [b for b in re.split(r'(?=^0 )', text, flags=re.M) if b.strip()]


def key(block):
    match = re.match(r'0 (?:(@[^@]+@) )?(\S+)', block)
    return match[1] or match[2]


def main():
    if not OVERLAY.is_file():
        print('No site overlay (edition.ged); nothing to re-pin.')
        return
    native = {key(b): b for b in records(SOURCE.read_text(encoding='utf-8'))}
    blocks = records(OVERLAY.read_text(encoding='utf-8'))
    changed = []
    for i, block in enumerate(blocks):
        expected = re.search(r'^1 _BASE_HASH ([a-f0-9]{64})$', block, re.M)
        if not expected or key(block) not in native:
            continue
        actual = hashlib.sha256(native[key(block)].encode('utf-8')).hexdigest()
        if actual != expected[1]:
            blocks[i] = block.replace(expected[0], f'1 _BASE_HASH {actual}')
            changed.append(key(block))
    text = ''.join(blocks)

    def manuscript(match):
        # A story line at any level, with its hash on the line below it.
        if int(match[4]) != int(match[2]) + 1:
            return match[0]
        actual = hashlib.sha256((ROOT / match[3]).read_bytes()).hexdigest()
        if actual != match[5]:
            changed.append(match[3])
        return f'{match[1]}{actual}'

    text = re.sub(r'(^(\d+) _MANUSCRIPT (\S+)\n(\d+) _HASH )([a-f0-9]{64})$', manuscript, text, flags=re.M)
    if changed:
        OVERLAY.write_text(text, encoding='utf-8')
    for record in dict.fromkeys(changed):
        print('re-pinned', record)
    print(f'{len(set(changed))} pin(s) refreshed.')


if __name__ == '__main__':
    main()
