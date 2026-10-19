#!/usr/bin/env python3
"""Add reviewed presentation to current native GEDCOM without editing its facts.

The overlay can append Atlas prose, media and archive associations only. Existing
person/source records are hash-bound to the author's reviewed baseline. Facts,
relationships, confidence and source descriptions cannot be replaced by it.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

from website_visuals import VISUAL_FIELDS, validate_visual_media
import flyleaf_settings

ROOT = flyleaf_settings.family_root()


class NeedsRepin(ValueError):
    """The tree changed under the site's additions; flyleaf repin fixes it."""


def records(text):
    return [b for b in re.split(r'(?=^0 )', text, flags=re.M) if b.strip()]


def identity(block):
    match = re.match(r'0 (?:(@[^@]+@) )?(\S+)', block)
    if not match:
        raise ValueError('Invalid GEDCOM record')
    return match[1] or match[2], match[2]


def digest(block):
    return hashlib.sha256(block.encode('utf-8')).hexdigest()


def validate_overlay(patches):
    schema = {
        'HEAD': {'_ATLAS', '_ARCHIVE_CATALOG'},
        'INDI': {'_BASE_HASH', '_NARRATIVE', 'OBJE'},
        '_ATLAS': {'TITL', 'NAME', '_ROOT', '_BOUNDARY', '_INCLUDE', '_SUBTITLE'},
        '_ARCHIVE_CATALOG': {'SOUR', 'OBJE'},
        '_CHAP': {'REFN', 'TITL', '_SUBTITLE', '_ORDER', '_STATUS', '_SECTION', '_MANUSCRIPT', '_PERSON'},
        '_SECTION': {'TITL', '_ORDER', 'DATE', '_PERIOD', 'NOTE', '_PERSON', 'OBJE', 'PLAC', 'SOUR', '_MANUSCRIPT'},
        'OBJE': {'FILE', 'TITL', '_CAPTION', '_CREDIT', '_RIGHTS', '_TYPE', 'SOUR', '_MANUSCRIPT'} | VISUAL_FIELDS,
        '_DISCOVERY_NOTE': {'CONT', 'CONC'},
        '_PUBLIC_NOTE': {'CONT', 'CONC'},
        '_OTHER_SUBJECT': {'CONT', 'CONC'},
        'FILE': {'FORM', 'TITL', '_SHA256', '_KIND'},
        '_NARRATIVE': {'CONT', 'CONC', 'SOUR', '_MANUSCRIPT', '_PERSON'},
        'NOTE': {'CONT', 'CONC'},
        'PLAC': {'MAP', '_PRECISION', '_SOURCE'},
        'MAP': {'LATI', 'LONG'},
        '_MANUSCRIPT': {'_HASH'},
        '_ARCHIVE': {'_KIND', '_NATURE', '_SHA256', '_LOCATOR', '_PAGE', '_STATUS'},
    }
    roots_found = []
    for block in patches:
        key, root_tag = identity(block)
        stack = [root_tag]
        for line in block.splitlines()[1:]:
            if not line.strip():
                continue
            match = re.match(r'^(\d+) (\S+)(?: (.*))?$', line)
            if not match:
                raise ValueError(f'Invalid overlay line: {key}')
            level, tag, value = int(match[1]), match[2], match[3] or ''
            if level < 1 or level > len(stack):
                raise ValueError(f'Invalid overlay hierarchy: {key}')
            parent = stack[level - 1]
            permitted = schema.get(parent, set())
            if parent == 'SOUR':
                permitted = ({'_BASE_HASH', '_ARCHIVE', 'TITL', 'ABBR', '_URL', 'NOTE', '_STATUS', '_PERSON'}
                             if level == 1 else {'PAGE'})
            if tag not in permitted:
                raise ValueError(f'Overlay cannot add {parent}/{tag}: {key}')
            if parent == 'SOUR' and level == 1 and tag in {'_STATUS', '_PERSON'}:
                if not key.startswith('@WEB_') or (tag == '_STATUS' and value != 'research-only'):
                    raise ValueError('Research associations belong to explicit website research sources')
            stack = stack[:level] + [tag]
            if stack == ['HEAD', '_ATLAS', '_ROOT']:
                roots_found.append(value)
    if len(roots_found) != 1 or not re.fullmatch(r'@[^@]+@', roots_found[0]):
        raise ValueError('A hosted edition requires exactly one HEAD/_ATLAS/_ROOT')


def compose(native, overlay):
    base = records(native)
    by_id = {identity(b)[0]: i for i, b in enumerate(base)}
    if len(by_id) != len(base):
        raise ValueError('Duplicate native identity')
    patches = records(overlay)
    validate_overlay(patches)
    seen = set()
    allowed = {'HEAD': {'_ATLAS', '_ARCHIVE_CATALOG'},
               'INDI': {'_NARRATIVE', 'OBJE'}, 'SOUR': {'_ARCHIVE'}}
    for patch in patches:
        key, tag = identity(patch)
        if key in seen:
            raise ValueError(f'Duplicate overlay identity: {key}')
        seen.add(key)
        if tag == 'TRLR':
            continue
        if tag in {'_CHAP', 'OBJE'} or (tag == 'SOUR' and key.startswith('@WEB_')):
            if key in by_id:
                raise ValueError(f'Overlay would replace an existing record: {key}')
            base.insert(-1, patch)
            # Insertions shift the trailer, so refresh the index.
            by_id = {identity(b)[0]: i for i, b in enumerate(base)}
            continue
        if key not in by_id or tag not in allowed:
            raise ValueError(f'Overlay cannot introduce facts or sources: {key}')
        original = base[by_id[key]]
        if identity(original)[1] != tag:
            raise ValueError(f'Overlay record type mismatch: {key}')
        expected = re.search(r'^1 _BASE_HASH ([a-f0-9]{64})$', patch, re.M)
        if tag != 'HEAD' and (not expected or expected[1] != digest(original)):
            raise NeedsRepin(f'{key} changed in the tree after the site\'s additions to it were '
                             'checked. Look over its entry in the site\'s edition.ged, then run: '
                             'flyleaf repin')
        lines = patch.splitlines()[1:]
        content = []
        for line in lines:
            if not line.strip():
                continue
            match = re.match(r'^(\d+) (\S+)', line)
            if not match or int(match[1]) < 1:
                raise ValueError(f'Invalid overlay hierarchy: {key}')
            if int(match[1]) == 1:
                if match[2] == '_BASE_HASH':
                    continue
                if match[2] not in allowed[tag]:
                    raise ValueError(f'Overlay cannot change {tag}/{match[2]}')
                if tag == 'HEAD' and re.search(rf'^1 {match[2]}(?: |$)', original, re.M):
                    raise ValueError(f'Conflicting native presentation: {match[2]}')
            content.append(line)
        base[by_id[key]] = original.rstrip('\n') + ('\n' + '\n'.join(content) if content else '') + '\n'
    result = ''.join(b if b.endswith('\n') else b + '\n' for b in base)
    # Presentation may use pointers, but may not silently name absent records.
    keys = {identity(b)[0] for b in records(result)}
    for pointer in re.findall(r'^\d+ \S+ (@[^@]+@)$', overlay, re.M):
        if pointer not in keys:
            raise ValueError(f'Unknown presentation reference: {pointer}')
    research_sources = {identity(b)[0] for b in records(result)
                        if identity(b)[1] == 'SOUR' and re.search(r'^1 _STATUS research-only$', b, re.M)}
    for block in records(result):
        if identity(block)[1] == 'HEAD':
            continue
        if research_sources.intersection(re.findall(r'^\d+ SOUR (@[^@]+@)$', block, re.M)):
            raise ValueError('Research-only archive sources cannot serve as factual or narrative citations')
    validate_visual_media(result)
    return result


def default_overlay(native):
    """The site header for a family without site/edition.ged: its name and
    the book's root person. Nothing else is added."""
    import booklib
    root = booklib.root_refn(booklib.load_book_yaml())
    match = re.search(rf'^0 (@[^@]+@) INDI\n(?:[1-9].*\n)*?1 REFN {re.escape(root)}\n2 TYPE jsonid$',
                      native, re.M)
    if not match:
        raise ValueError(f'The book root {root!r} is not in the tree')
    title = flyleaf_settings.require('family.name')
    return f'0 HEAD\n1 _ATLAS\n2 TITL {title}\n2 _ROOT {match[1]}\n0 TRLR\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=flyleaf_settings.path('source_gedcom'))
    parser.add_argument('--overlay', type=Path,
                        default=flyleaf_settings.path('site_content') / 'edition.ged')
    parser.add_argument('--output', type=Path,
                        default=flyleaf_settings.ENGINE / 'website/work/current.ged')
    parser.add_argument('--book-map', type=Path, help='Reuse the current authored book figure/caption map')
    parser.add_argument('--representations', type=Path, help='Read canonical archive derivations')
    args = parser.parse_args()
    if args.output.resolve() in {args.source.resolve(), args.overlay.resolve()}:
        raise ValueError('Composition must not overwrite authored input')
    own_overlay = args.overlay.is_file()
    input_paths = [args.source, *([args.overlay] if own_overlay else []),
                   *([args.book_map] if args.book_map else []),
                   *([args.representations] if args.representations else [])]
    receipt_path = args.output.with_suffix('.composition.json')
    if any(output.resolve() == source.resolve()
           for output in (args.output, receipt_path) for source in input_paths):
        raise ValueError('Composition outputs must not overwrite any authored input')
    input_bytes = {path: path.read_bytes() for path in input_paths}
    native = input_bytes[args.source].decode('utf-8')
    overlay = input_bytes[args.overlay].decode('utf-8') if own_overlay else default_overlay(native)
    try:
        result = compose(native, overlay)
    except NeedsRepin as error:
        sys.exit(f'\nThe site build stopped. {error}')
    if args.book_map:
        from website_book_archive import current_book_map, append_book_figures, verify_book_source_files
        mapping, root_xref, title = current_book_map(args.book_map, native)
        result = append_book_figures(result, mapping, root_xref, title)
        verify_book_source_files(native, mapping)
    if args.representations:
        if not args.book_map:
            raise ValueError('Representation selection requires the current book map')
        from website_representations import load_representations, append_representations
        targets = {a['path'] for f in mapping['figures'] for a in f['artifacts']}
        images = re.escape(flyleaf_settings.folder_name('images'))
        targets.update(re.findall(rf'^\d+ FILE ({images}/.+)$', result, re.M))
        edges = load_representations(ROOT, json.loads(args.representations.read_text()), targets)
        result = append_representations(result, edges)
    if any(path.read_bytes() != value for path, value in input_bytes.items()):
        raise ValueError('Composition inputs changed during publication; retry')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(result)
    # Written last: an interrupted pair fails the downstream digest check.
    receipt = {'schema': 1, 'nativeSha256': hashlib.sha256(input_bytes[args.source]).hexdigest(),
               'composedSha256': hashlib.sha256(result.encode('utf-8')).hexdigest(),
               'inputs': {flyleaf_settings.logical(path):
                          hashlib.sha256(value).hexdigest() for path, value in input_bytes.items()}}
    receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')
    print('Combined the tree with the website overlay (site/edition.ged).')


if __name__ == '__main__':
    try:
        main()
    except ValueError as problem:
        # A problem the family can fix (booklib.Stop) prints without a
        # traceback. booklib is loaded only by the steps that raise it.
        booklib = sys.modules.get('booklib')
        if booklib is None or not isinstance(problem, booklib.Stop):
            raise
        sys.exit(f'\nThe site build stopped. {problem}')
