"""Reuse the current authored citation map as a portable book-figure catalogue.

This preserves declared captions and placements. It does not infer depicted
people, evidence support, or original/derivative relationships from filenames.
"""
import hashlib
import json
import re
from pathlib import Path

import booklib
from website_assets import reader_asset


def current_book_map(path, native):
    """Recompute in memory; never refresh the map or overwrite authored work."""
    tree = booklib.Tree()
    if native != tree.src_path.read_text():
        raise ValueError('The book map and website must use the same native genealogy')
    cfg = booklib.load_book_yaml()
    extractor = booklib._load_module('extract-claims.py', 'website_claim_map')
    expected = extractor.build_map(tree, extractor.prose_inputs(tree, cfg))
    saved = json.loads(Path(path).read_text())
    if saved != expected or expected['issues']:
        raise booklib.Stop("The book's citation map is older than its stories. Build the book "
                           'again (flyleaf book), then build the site.')
    root = tree.by_refn.get(booklib.root_refn(cfg))
    if not root:
        raise ValueError('The book root is not present in the native genealogy')
    return saved, root['xref'], cfg.get('title', 'The family book')


def tagged(level, tag, text):
    parts = text.splitlines() or ['']
    return [f'{level} {tag} {parts[0]}', *[f'{level + 1} CONT {part}' for part in parts[1:]]]


def append_book_figures(document, mapping, root_xref, title):
    blocks = [b for b in re.split(r'(?=^0 )', document, flags=re.M) if b.strip()]
    head = next((i for i, b in enumerate(blocks) if b.startswith('0 HEAD\n')), None)
    if head is None or not re.search(r'^2 _ROOT ' + re.escape(root_xref) + r'$', blocks[head], re.M):
        raise ValueError('Book illustrations require the matching website family root')
    records, pointers = {}, []
    for figure in mapping['figures']:
        manuscript = figure['file']
        manuscript_hash = mapping['inputs_sha256'].get(manuscript, '')
        if not re.fullmatch(r'[a-f0-9]{64}', manuscript_hash):
            raise ValueError('A book illustration lacks its authored input hash')
        for artifact in figure['artifacts']:
            path = artifact['path']
            if (not artifact['exists'] or not re.fullmatch(r'[a-f0-9]{64}', artifact.get('sha256', ''))
                    or not path.startswith(booklib.flyleaf_settings.folder_name('images') + '/')
                    or '..' in Path(path).parts):
                raise ValueError(f'Book illustration is not a held publishable image: {path}')
            caption = figure['caption'] or 'Uncaptioned illustration from the family book'
            # Same file/caption placements coalesce; distinct captions remain
            # distinct attachment contexts, with no invented source record.
            pointer = '@WEB_BOOK_' + hashlib.sha256((path + '\0' + caption).encode()).hexdigest()[:24] + '@'
            if pointer not in records:
                if re.search(r'^0 ' + re.escape(pointer) + r' ', document, re.M):
                    raise ValueError('Generated book attachment conflicts with an existing record')
                pointers.append(pointer)
                records[pointer] = [f'0 {pointer} OBJE', f'1 FILE {path}', f"2 _SHA256 {artifact['sha256']}",
                                    *tagged(1, 'TITL', caption), '1 _TYPE book-illustration',
                                    *tagged(1, '_CREDIT', f'Illustration and caption from {title}.')]
            reference = [f'1 _MANUSCRIPT {manuscript}', f'2 _HASH {manuscript_hash}']
            if reference[0] not in records[pointer]:
                records[pointer].extend(reference)
    lines = blocks[head].rstrip('\n').splitlines()
    catalogue = next((i for i, line in enumerate(lines) if line == '1 _ARCHIVE_CATALOG'), None)
    if catalogue is None:
        lines.append('1 _ARCHIVE_CATALOG')
        insert = len(lines)
    else:
        insert = next((i for i in range(catalogue + 1, len(lines)) if lines[i].startswith('1 ')), len(lines))
    lines[insert:insert] = [f'2 OBJE {pointer}' for pointer in pointers]
    blocks[head] = '\n'.join(lines) + '\n'
    trailer = next(i for i, block in enumerate(blocks) if block.startswith('0 TRLR'))
    blocks[trailer:trailer] = ['\n'.join(lines) + '\n' for lines in records.values()]
    return ''.join(blocks)


def verify_book_source_files(document, mapping):
    """Require mapped legacy attachments in their canonical note contexts.

    Filename mentions are historical text. Publication neither expands shorthand
    nor manufactures file links from that text.
    """
    from io import BytesIO
    parser = booklib._enrich.Parser()
    parser.parse(BytesIO(document.encode()), strict=False)
    roots = parser.get_root_child_elements()
    records = {e.get_pointer(): e for e in roots if e.get_pointer()}
    available = {}

    def walk(node, owner):
        if node.get_tag() == 'NOTE' and (node.get_multi_line_value() or '').startswith('[Source]'):
            key = (owner, node.get_multi_line_value())
            available.setdefault(key, set()).update(booklib._enrich.media_paths(node, records))
        for child in node.get_child_elements():
            walk(child, owner)

    for record in roots:
        if record.get_tag() == 'INDI':
            walk(record, booklib._enrich.child_text(record, 'REFN'))
    for claim in mapping['claims']:
        for source in claim['sources']:
            if source.get('native') or source.get('status') != 'resolved':
                continue
            wanted = {a['path'] for a in source.get('artifacts', []) if reader_asset(a['path'])}
            declared = set()
            for note in source.get('raw_notes') or []:
                key = (source['refn'], note)
                if key not in available:
                    raise ValueError('Mapped legacy source lacks its exact canonical owner/note')
                declared.update(available[key])
            if wanted - declared:
                raise ValueError('Mapped source files need explicit native attachments: ' +
                                 ', '.join(sorted(wanted - declared)))
