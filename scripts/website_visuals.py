"""Validate reviewed file-level visual descriptions independently of media uses."""
from io import BytesIO
from pathlib import PurePosixPath
import re

import flyleaf_settings

PERSON_FIELDS = {'_SUBJECT', '_RELATED', '_CAPTION_PERSON', '_COMMEMORATES'}
VISUAL_FIELDS = PERSON_FIELDS | {'_CONTENT', '_ALBUM', '_AVATAR', '_VISUAL_ROLE',
                                 '_DISCOVERY_NOTE', '_PUBLIC_NOTE', '_OTHER_SUBJECT', '_QUALIFIED', '_AVATAR_POSITION'}


def caption_patterns():
    """What a photograph's title or note must not contain: a tree pointer such
    as @I12@, and the family's own phrases (text_checks.caption_errors in
    flyleaf.json, regular expressions matched without case)."""
    extra = flyleaf_settings.get('text_checks.caption_errors', [])
    if not isinstance(extra, list) or not all(isinstance(p, str) and p for p in extra):
        raise SystemExit('flyleaf.json: text_checks.caption_errors must be a list of patterns')
    return [r'@[^@\s]+@', *extra]


def validate_public_caption(text):
    """Check authored presentation fields, never the contents of original records."""
    for pattern in caption_patterns():
        match = re.search(pattern, text, re.I)
        if match:
            raise ValueError(f'A photograph caption has text meant for the family tree, '
                             f'not for readers: "{match[0]}" in "{text[:120]}"')


def validate_visual_roots(records):
    pointers = {r.get_pointer(): r for r in records if r.get_pointer()}
    seen_paths = set()

    def walk(node, parent=None):
        tag = node.get_tag()
        if tag in VISUAL_FIELDS and (parent is None or parent.get_tag() != 'OBJE'):
            raise ValueError(f'Visual metadata must belong to an OBJE: {tag}')
        kids = node.get_child_elements()
        if tag == 'OBJE' and any(k.get_tag() in VISUAL_FIELDS for k in kids):
            if node.get_value():
                raise ValueError('Visual metadata belongs on the media object, not its reference')
            by_tag = {}
            for k in kids:
                by_tag.setdefault(k.get_tag(), []).append(k)

            def one(name, required=False):
                items = by_tag.get(name, [])
                if len(items) > 1 or (required and not items):
                    raise ValueError(f'Visual media requires one {name}')
                text = items[0].get_multi_line_value() if items else ''
                if required and not text.strip():
                    raise ValueError(f'Visual media requires nonempty {name}')
                return text.strip()

            path = one('FILE', True).replace('\\', '/')
            images = flyleaf_settings.folder_name('images') + '/'
            if (path != by_tag['FILE'][0].get_value() or not path.startswith(images)
                    or any(part in {'', '.', '..'} for part in path.split('/'))):
                raise ValueError('Visual media requires a canonical relative images path')
            if PurePosixPath(path).suffix.lower() not in {'.jpg', '.jpeg', '.png', '.webp', '.gif'}:
                raise ValueError('Visual media requires a supported raster file')
            if path in seen_paths:
                raise ValueError(f'Only one visual description is allowed per file: {path}')
            seen_paths.add(path)
            hashes = [k.get_value() for k in by_tag['FILE'][0].get_child_elements()
                      if k.get_tag() == '_SHA256']
            if len(hashes) != 1 or not re.fullmatch(r'[a-f0-9]{64}', hashes[0]):
                raise ValueError('Visual media requires one reviewed FILE SHA-256')
            medium = one('_CONTENT', True)
            if medium not in {'photograph', 'artwork'}:
                raise ValueError('Unknown visual medium')
            if one('_ALBUM', True) not in {'display', 'alternate'}:
                raise ValueError('Visual media requires an explicit album selection')
            role = one('_VISUAL_ROLE', True)
            if role not in {'portrait', 'group', 'place', 'object', 'memorial'}:
                raise ValueError('Unknown visual role')
            validate_public_caption(one('TITL', True))
            one('_DISCOVERY_NOTE')
            validate_public_caption(one('_PUBLIC_NOTE'))
            for subject in by_tag.get('_OTHER_SUBJECT', []):
                validate_public_caption(subject.get_multi_line_value())
            for field in PERSON_FIELDS:
                nodes = by_tag.get(field, [])
                values = [k.get_value() for k in nodes]
                if len(values) != len(set(values)):
                    raise ValueError(f'Duplicate visual person relation: {field}')
                if (any(k.get_child_elements() for k in nodes)
                        or any(v not in pointers or pointers[v].get_tag() != 'INDI' for v in values)):
                    raise ValueError(f'Visual relation must identify an individual: {field}')
            avatar = one('_AVATAR')
            qualified = one('_QUALIFIED')
            position = one('_AVATAR_POSITION')
            if position and (not avatar or position not in {'top', 'center', 'bottom'}):
                raise ValueError('Avatar position requires approval and top, center or bottom')
            if avatar not in {'', 'Y'} or qualified not in {'', 'Y'}:
                raise ValueError('Visual flags accept only Y or absence')
            if avatar and (role != 'portrait'
                           or qualified or len(by_tag.get('_SUBJECT', [])) != 1):
                raise ValueError('Avatar approval requires one identified unqualified portrait')
        for k in kids:
            walk(k, node)

    for record in records:
        walk(record)
    return seen_paths


def validate_visual_media(document):
    if not any(re.search(rf'^\d+ {tag}(?: |$)', document, re.M) for tag in VISUAL_FIELDS):
        return set()
    from gedcom.parser import Parser
    parser = Parser()
    parser.parse(BytesIO(document.encode('utf-8')), strict=False)
    return validate_visual_roots(parser.get_root_child_elements())
