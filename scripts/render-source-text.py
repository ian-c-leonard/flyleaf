#!/usr/bin/env python3
"""Replay declared readable companions without changing their source records.

The recipe fixes parent bytes, selected JSON values, section roles and output
bytes. Default mode checks held outputs; --output-dir writes a separate copy.
It never overwrites a differing file or extracts additional fields implicitly.
"""
import argparse
import hashlib
import json
from pathlib import Path
from website_assets import reader_asset
import flyleaf_settings

ROOT = flyleaf_settings.family_root()


def digest(body):
    return hashlib.sha256(body).hexdigest()


def value_digest(value):
    return digest(json.dumps(value, ensure_ascii=False, sort_keys=True,
                             separators=(',', ':')).encode('utf-8'))


def pointer_value(document, pointer):
    if not pointer.startswith('/'):
        raise ValueError('Expected a JSON pointer')
    value = document
    for part in pointer[1:].split('/'):
        key = part.replace('~1', '/').replace('~0', '~')
        value = value[int(key)] if isinstance(value, list) else value[key]
    return value


def held_path(root, relative):
    path = Path(relative)
    if path.as_posix() != relative:
        raise ValueError('Expected a canonical archive path: ' + relative)
    if not reader_asset(relative, 'research-note'):
        raise ValueError('Outside the readable archive boundary: ' + relative)
    images = flyleaf_settings.folder_name('images')
    if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] != images:
        raise ValueError(f'Expected a path within {images}: ' + relative)
    resolved = (root / path).resolve()
    if not resolved.is_relative_to(root.resolve() / images):
        raise ValueError(f'Path leaves {images}: ' + relative)
    if not reader_asset(resolved.relative_to(root.resolve()).as_posix(), 'research-note'):
        raise ValueError('Resolved path is outside the readable archive boundary')
    return resolved


def reading_notes(value, depth=0):
    """Display every selected authored value in order, with readable labels."""
    if isinstance(value, str):
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, list):
        if all(isinstance(item, int) and not isinstance(item, bool) for item in value):
            return ', '.join(str(item) for item in value)
        return '\n\n'.join(reading_notes(item, depth + 1) for item in value)
    if isinstance(value, dict):
        return '\n\n'.join(
            (key if key.isupper() else key.replace('_', ' ').capitalize())
            + ':\n' + reading_notes(item, depth + 1) for key, item in value.items())
    raise ValueError('Unsupported retained reading value')


# A family's own names for these formats (source_texts.format_aliases).
FORMAT_ALIASES = flyleaf_settings.get('source_texts.format_aliases', {})


def section_text(section, value):
    mode = FORMAT_ALIASES.get(section['format'], section['format'])
    if mode == 'text' and isinstance(value, str):
        return value
    if mode == 'names' and isinstance(value, list) and all(isinstance(x, str) for x in value):
        return '; '.join(value)
    if mode == 'officers' and isinstance(value, list):
        if any(set(item) != {'name', 'office'} for item in value):
            raise ValueError('Unexpected officer fields')
        return '\n'.join(item['name'] + ' — ' + item['office'] for item in value)
    if mode == 'register-entries' and isinstance(value, list):
        readings = []
        for item in value:
            if set(item) - {'printed_page', 'name', 'parent_clause', 'date_as_printed', 'date_meaning'}:
                raise ValueError('Unexpected entry fields')
            name, sep, expansion = item['name'].partition(' [')
            lines = ['Printed page: ' + str(item['printed_page']), 'Name: ' + name]
            if sep:
                if not expansion.endswith(']'):
                    raise ValueError('Unclosed editorial surname annotation')
                lines.append('Editorial surname annotation: [' + expansion)
            if 'parent_clause' in item:
                lines.append('Parent clause: ' + item['parent_clause'])
            lines.extend(['Date as printed: ' + item['date_as_printed'],
                          'Interpretation of date: ' + item['date_meaning']])
            readings.append('\n'.join(lines))
        return '\n\n'.join(readings)
    if mode == 'authored-notes':
        return reading_notes(value)
    raise ValueError('Unexpected section format or value: ' + mode)


def render(recipe, root=ROOT):
    parent = held_path(root, recipe['parent']['path']).read_bytes()
    if digest(parent) != recipe['parent']['sha256']:
        raise ValueError('Changed parent: ' + recipe['parent']['path'])
    document = json.loads(parent)
    parts = [recipe['title'], recipe['locator'], *recipe['sourceUrls'], recipe['introduction']]
    for section in recipe['sections']:
        if section['role'] not in {'retained-text', 'authored-assessment', 'structured-reading'}:
            raise ValueError('Unknown reading role')
        value = pointer_value(document, section['pointer'])
        if value_digest(value) != section['valueSha256']:
            raise ValueError('Changed selected field: ' + section['pointer'])
        parts.append(section['heading'] + '\n' + section_text(section, value))
    parts.extend(['Reading limits\n' + recipe['notes'],
                  'Complete saved record\n' + Path(recipe['parent']['path']).name
                  + '\nThe complete saved record is available with this source. '
                  'Its earlier work and review notes describe their recorded state.'])
    return ('\n\n'.join(parts) + '\n').encode('utf-8')


def prepare(manifest, root=ROOT):
    if manifest['schema'] != 'source-text-companions/v1':
        raise ValueError('Unknown source-text recipe schema')
    outputs = {}
    resolved_outputs = set()
    for recipe in manifest['companions']:
        relative = recipe['output']['path']
        resolved = held_path(root, relative)
        if relative in outputs or resolved in resolved_outputs:
            raise ValueError('Duplicate companion output: ' + relative)
        resolved_outputs.add(resolved)
        body = render(recipe, root)
        if digest(body) != recipe['output']['sha256'] or len(body) != recipe['output']['bytes']:
            raise ValueError('Companion differs from reviewed output: ' + relative)
        outputs[relative] = body
    return outputs


def check_or_copy(outputs, destination, write=False):
    targets = [(held_path(destination, path), body) for path, body in outputs.items()]
    if len({path for path, _ in targets}) != len(targets):
        raise ValueError('Duplicate resolved output destination')
    # Validate the full set before writing anything, including existing copies.
    for path, body in targets:
        if path.exists() and path.read_bytes() != body:
            raise ValueError('Refusing differing output: ' + str(path))
        if not write and not path.is_file():
            raise ValueError('Missing held companion: ' + str(path))
    if write:
        for path, body in targets:
            path.parent.mkdir(parents=True, exist_ok=True)
            try:
                with path.open('xb') as stream:
                    stream.write(body)
            except FileExistsError:
                if path.read_bytes() != body:
                    raise ValueError('Refusing differing output: ' + str(path))
    for path, body in targets:
        if path.read_bytes() != body:
            raise ValueError('Output differs after copy/check: ' + str(path))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=ROOT / 'data/source-text-companions.json')
    parser.add_argument('--output-dir', type=Path)
    args = parser.parse_args()
    # A family without transcribed companions has none to check.
    manifest = (json.loads(args.manifest.read_text()) if args.manifest.is_file()
                else {'schema': 'source-text-companions/v1', 'companions': []})
    outputs = prepare(manifest)
    check_or_copy(outputs, args.output_dir or ROOT, write=bool(args.output_dir))
    n = len(outputs)
    print(f"Text versions of documents: {n} checked against their originals."
          if not args.output_dir else f"Text versions of documents: {n} written to {args.output_dir}.")


if __name__ == '__main__':
    main()
