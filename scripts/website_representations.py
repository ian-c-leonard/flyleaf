"""Validate the canonical archive derivations and write portable relationships.

data/representations.json is the active authority. Historical capture metadata
remains hash-bound provenance; publishing never interprets its former schemas.
"""
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

import flyleaf_settings
from website_assets import reader_asset
from website_book_archive import tagged


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def load_representations(root, registry, targets):
    """Validate one explicit schema, then retain the requested ancestry."""
    if registry.get('schema') != 1 or not isinstance(registry.get('representations'), list):
        raise ValueError('Unsupported canonical representation schema')
    root = Path(root).resolve()
    required = {'parent', 'child', 'parentSha256', 'childSha256', 'role',
                'method', 'details', 'witness', 'witnessSha256', 'pointer'}
    allowed = required | {'source', 'sourceObject', 'declaredParentSha256', 'declaredChildSha256'}
    cache, identities, edges = {}, set(), []

    def checked(name, expected, *, witness=False):
        if (not isinstance(name, str) or not name or re.search(r'[\r\n\\\\]', name)
                or name.splitlines() != [name]
                or '..' in Path(name).parts or any(p.startswith('.') for p in Path(name).parts)):
            raise ValueError('Unsafe representation path')
        path = (root / name).resolve()
        images = flyleaf_settings.folder_name('images') + '/'
        # A witness records how a version was made. The build reads it only
        # for its hash and never publishes it, so it may be any JSON file in
        # the family folder.
        if (not path.is_relative_to(root) or not path.is_file()
                or (witness and (path.suffix != '.json' or Path(name).name == 'flyleaf.json'))
                or (not witness and (not name.startswith(images)
                                     or not reader_asset(name, 'document', reviewed=True)
                                     or not reader_asset(path.relative_to(root).as_posix(),
                                                         'document', reviewed=True)))):
            raise ValueError('Representation endpoint or witness is not a held permitted file: ' + name)
        if not isinstance(expected, str) or not re.fullmatch(r'[a-f0-9]{64}', expected):
            raise ValueError('Representation lacks a valid recorded hash: ' + name)
        if name not in cache:
            cache[name] = digest(path)
        if cache[name] != expected:
            raise ValueError('Stale representation file or witness: ' + name)
        return path

    for original in registry['representations']:
        if (not isinstance(original, dict) or not required <= original.keys()
                or original.keys() - allowed):
            raise ValueError('Incomplete or unknown canonical representation fields')
        edge = dict(original)
        if (edge['parent'] == edge['child'] or not isinstance(edge['details'], dict)
                or not isinstance(edge['method'], str)
                or edge['role'] not in {'derived', 'crop', 'composite', 'extracted-image', 'page-render'}
                or not isinstance(edge['pointer'], str)
                or (edge['pointer'] and (not edge['pointer'].startswith('/')
                    or edge['pointer'].splitlines() != [edge['pointer']]))
                or ('source' in edge and 'sourceObject' in edge)
                or any(key in edge and (not isinstance(edge[key], str)
                       or not re.fullmatch(r'@[^@\s]+@', edge[key]))
                       for key in ('source', 'sourceObject'))):
            raise ValueError('Invalid canonical representation semantics')
        typed_endpoints = []
        for endpoint in ['parent', 'child']:
            path = checked(edge[endpoint], edge[endpoint + 'Sha256'])
            if (not reader_asset(edge[endpoint])
                    or not reader_asset(path.relative_to(root).as_posix())):
                typed_endpoints.append(endpoint)
            declared = edge.get('declared' + endpoint.title() + 'Sha256')
            if declared is not None and declared != edge[endpoint + 'Sha256']:
                raise ValueError('Stale generation-time endpoint hash')
        checked(edge['witness'], edge['witnessSha256'], witness=True)
        if typed_endpoints:
            # Generated admission metadata, never canonical registry fields.
            # Carry the resolved-path decision from the hash-checking loader;
            # aliases must receive the same explicit type as their held target.
            edge['_typedEndpoints'] = typed_endpoints
        identity = tuple(edge[k] for k in ['parent', 'child', 'witness', 'pointer'])
        if identity in identities:
            raise ValueError('Duplicate canonical representation identity')
        identities.add(identity)
        edges.append(edge)

    parents = defaultdict(set)
    for edge in edges:
        parents[edge['child']].add(edge['parent'])
    checked_nodes, pending = set(), set()

    def visit(path):
        if path in pending:
            raise ValueError('Generation recipes contain a cycle')
        if path in checked_nodes:
            return
        pending.add(path)
        for parent in parents[path]:
            visit(parent)
        pending.remove(path)
        checked_nodes.add(path)

    for path in list(parents):
        visit(path)
    # Explicit source ownership is itself an archive attachment declaration.
    # Keep those versions even when no manuscript uses the child. The exporter
    # admits them only after their owner independently survives source selection;
    # a version must never bootstrap an otherwise excluded source.
    # Upstream unowned steps inherit that selection condition. Otherwise an
    # excluded source's intermediate/original could leak in through HEAD even
    # though its owned final crop was correctly excluded. A separate owned step
    # is independently declared by its own source, so resets the condition.
    incoming = defaultdict(list)
    for index, edge in enumerate(edges):
        incoming[edge['child']].append(index)
    conditions, visited = defaultdict(set), set()
    pending_paths = [(path, None) for path in targets]
    def owner_of(edge):
        return next(((key, edge[key]) for key in ('source', 'sourceObject') if edge.get(key)), None)

    pending_paths.extend((e['child'], owner_of(e)) for e in edges if owner_of(e))
    while pending_paths:
        path, condition = pending_paths.pop()
        if (path, condition) in visited:
            continue
        visited.add((path, condition))
        for index in incoming[path]:
            edge = edges[index]
            owner = owner_of(edge) or condition
            conditions[index].add(owner)
            pending_paths.append((edge['parent'], owner))
    selected = []
    for index, eligible in conditions.items():
        edge = edges[index]
        if not owner_of(edge) and None not in eligible:
            # Generated publication selectors, never canonical ownership.
            for kind, field in [('source', '_selectionSources'),
                                ('sourceObject', '_selectionSourceObjects')]:
                pointers = sorted(pointer for owner_kind, pointer in eligible if owner_kind == kind)
                if pointers:
                    edge[field] = pointers
        selected.append(edge)
    return sorted(selected,
                  key=lambda e: (e['child'], e['parent'], e['witness'], e['pointer']))


def append_representations(document, edges):
    """Use dependency records rather than new sources or personal media."""
    blocks = [b for b in re.split(r'(?=^0 )', document, flags=re.M) if b.strip()]
    head = next(i for i, b in enumerate(blocks) if b.startswith('0 HEAD\n'))
    lines = blocks[head].rstrip('\n').splitlines()
    catalogue = next((i for i, line in enumerate(lines) if line == '1 _ARCHIVE_CATALOG'), None)
    if catalogue is None:
        lines.append('1 _ARCHIVE_CATALOG')
        insert = len(lines)
    else:
        insert = next((i for i in range(catalogue + 1, len(lines)) if lines[i].startswith('1 ')), len(lines))
    records, references = [], []
    for edge in edges:
        identity = '\0'.join(edge[k] for k in ['parent', 'child', 'witness', 'pointer'])
        pointer = '@WEB_VERSION_' + hashlib.sha256(identity.encode()).hexdigest()[:24] + '@'
        if re.search(r'^0 ' + re.escape(pointer) + ' ', document, re.M):
            raise ValueError('Generated representation conflicts with an existing record')
        references.append(f'2 _REPRESENTATION {pointer}')
        references.extend(f'3 _IF_SOURCE {source}' for source in edge.get('_selectionSources', []))
        references.extend(f'3 _IF_SOURCE_OBJECT {obj}' for obj in edge.get('_selectionSourceObjects', []))
        # Canonical endpoints carry checked hashes. Explicitly type only those
        # whose historical work-directory names otherwise suppress admission.
        typed_endpoints = edge.get('_typedEndpoints', [])
        child_kind = (['2 _KIND document']
                      if 'child' in typed_endpoints or not reader_asset(edge['child']) else [])
        parent_kind = (['3 _KIND document']
                       if 'parent' in typed_endpoints or not reader_asset(edge['parent']) else [])
        records.append('\n'.join([
            f'0 {pointer} _REPRESENTATION', f"1 FILE {edge['child']}",
            f"2 _SHA256 {edge['childSha256']}", *child_kind, '1 _PARENT', f"2 FILE {edge['parent']}",
            f"3 _SHA256 {edge['parentSha256']}", *parent_kind, f"1 _ROLE {edge['role']}",
            *tagged(1, '_METHOD', edge['method']),
            '1 _RECIPE ' + json.dumps(edge['details'], ensure_ascii=False, sort_keys=True),
            f"1 _PROVENANCE {edge['witness']}", f"2 _HASH {edge['witnessSha256']}",
            f"2 _POINTER {edge['pointer']}",
            *([f"1 _SOURCE {edge['source']}"] if edge.get('source') else []),
            *([f"1 _SOURCE_OBJECT {edge['sourceObject']}"] if edge.get('sourceObject') else []),
        ]) + '\n')
    lines[insert:insert] = references
    blocks[head] = '\n'.join(lines) + '\n'
    trailer = next(i for i, block in enumerate(blocks) if block.startswith('0 TRLR'))
    blocks[trailer:trailer] = records
    return ''.join(blocks)
