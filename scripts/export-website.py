#!/usr/bin/env python3
"""Package the document-declared family edition without losing GEDCOM structure.

The browser consumes family.ged, not the diagnostic JSON returned by build_data.
The edition's scope and presentation come from the tree's HEAD/_ATLAS header,
which compose-website.py adds from the family's site/edition.ged.
"""
import argparse
import hashlib
import json
import os
import sys
import re
import shutil
import tempfile
from pathlib import Path

import booklib
from booklib import ROOT, SRC_GED, Tree, possibly_living
from website_assets import PAGE_FORMATS, reader_asset, skip_reason, STRUCTURED_READER_KINDS
from website_visuals import PERSON_FIELDS, VISUAL_FIELDS, validate_visual_roots, validate_visual_media
import flyleaf_settings

EVENTS = {'BIRT', 'BAPM', 'CHR', 'DEAT', 'BURI', 'MARR', 'DIV', 'CENS', 'RESI',
          'EMIG', 'IMMI', 'NATU', 'EDUC', 'GRAD', 'OCCU', 'RETI', 'MILI', 'EVEN', 'ADOP', 'PROB', 'WILL'}
POINTER = re.compile(r'@[^@\s]+@')
# The header lines the site reads. A program's other header lines (the file's
# path on its maker's computer, the submitter, notes) stay out of the site.
HEAD_FIELDS = {'GEDC', 'CHAR', '_ATLAS', '_ARCHIVE_CATALOG'}
# Submitter records hold a name, address, phone and email. The site never shows
# them, nor anyone's address, phone, email or fax.
SUBMITTER_RECORDS = {'SUBM', 'SUBN'}
CONTACT_FIELDS = {'ADDR', 'PHON', 'EMAIL', 'FAX'}
# Where the site shows a note: on media and their files, on sources and each
# citation of them, on archive files and in chapter sections. A note written
# directly on an event shows too; a shared note on an event does not.
NOTE_PARENTS = {'OBJE', 'FILE', 'SOUR', '_ARCHIVE', '_SECTION'}
# GEDCOM RESN values that keep a person or family off a public site.
RESTRICTED = {'confidential', 'locked', 'privacy'}
REPORT = 'site-data-report.json'  # build notes, in the family's build folder


Stop = booklib.Stop  # a problem the family can fix, printed without a traceback


def restricted(element):
    """A record or fact the tree marks private with RESN."""
    return any((c.get_value() or '').strip().lower() in RESTRICTED for c in children(element, 'RESN'))


def marked_within(element, by_pointer, seen=None):
    """Whether a record, any fact in it, or a source, note or media record it
    points to is marked private with RESN."""
    seen = set() if seen is None else seen
    if restricted(element):
        return True
    for child in element.get_child_elements():
        target = by_pointer.get((child.get_value() or '').strip())
        if (target is not None and target.get_tag() in {'SOUR', 'NOTE', 'OBJE', 'REPO'}
                and target.get_pointer() not in seen):
            seen.add(target.get_pointer())
            if marked_within(target, by_pointer, seen):
                return True
        if marked_within(child, by_pointer, seen):
            return True
    return False


def hosting():
    """site.hosting in flyleaf.json, read as the site build reads it."""
    value = flyleaf_settings.get('site.hosting') or 'worker'
    if value not in {'worker', 'static'}:
        raise Stop(f'flyleaf.json: site.hosting is "{value}". Use "worker" or "static".')
    return value


def children(element, tag):
    return [c for c in element.get_child_elements() if c.get_tag() == tag]


def val(element, tag):
    nodes = children(element, tag)
    return (nodes[0].get_value() or '').strip() if nodes else ''


def roots(tree):
    return [e for e in tree._parser.get_element_list() if e.get_level() == 0]


def scope(tree, edition='document'):
    records = roots(tree)
    head = next((e for e in records if e.get_tag() == 'HEAD'), None)
    atlas = children(head, '_ATLAS') if head else []
    if edition == 'all' or not atlas or not val(atlas[0], '_ROOT'):
        return set(tree.by_xref)
    config = atlas[0]
    root = val(config, '_ROOT')
    if root not in tree.by_xref:
        raise ValueError('The Atlas root does not identify a person in this GEDCOM')
    boundary = {c.get_value() for c in children(config, '_BOUNDARY')}
    adjacency = {xref: set() for xref in tree.by_xref}
    for fid, family in tree.fams.items():
        if fid in boundary:
            continue
        members = {x for x in [family['husb'], family['wife'], *family['chil']] if x in adjacency}
        for xref in members:
            adjacency[xref].update(members - {xref})
    included, pending = set(), [root]
    while pending:
        current = pending.pop()
        if current not in included:
            included.add(current)
            pending.extend(adjacency[current] - included)
    for node in children(config, '_INCLUDE'):
        if node.get_value() not in tree.by_xref:
            raise ValueError('An Atlas inclusion points to an absent person')
        included.add(node.get_value())
    return included


def people_count(n):
    """'1 person', '3 people'."""
    return f'{n} person' if n == 1 else f'{n} people'


def listing(tree, people, limit=25):
    """One line per person, by surname, for a message."""
    ordered = sorted(people, key=lambda x: (tree.by_xref[x]['surname'], tree.by_xref[x]['given'], x))
    lines = [f"  {tree.by_xref[x]['given']} {tree.by_xref[x]['surname']}".rstrip()
             + f" ({tree.by_xref[x]['refn'] or x.strip('@')})" for x in ordered[:limit]]
    if len(ordered) > limit:
        lines.append(f'  and {len(ordered) - limit} more')
    return '\n'.join(lines)


def book_people(tree, root_refn):
    """Everyone the book's register names, as tree pointers."""
    names = tree.register_people(root_refn)
    return {xref for xref, person in tree.by_xref.items() if person['refn'] and person['refn'] in names}


def raw_events(element):
    output = []
    for event in element.get_child_elements():
        if event.get_tag() not in EVENTS:
            continue
        date = val(event, 'DATE')
        year = re.search(r'\b(\d{3,4})\b', date)
        output.append({'type': event.get_tag(), 'date': date,
                       'year': int(year[1]) if year else None, 'place': val(event, 'PLAC')})
    return output


def build_data(tree, edition='document'):
    """Small diagnostic model used to verify the raw source packaging contract."""
    included = scope(tree, edition)
    records = {e.get_pointer(): e for e in roots(tree) if e.get_pointer()}
    ids = {x: p['refn'] or x.strip('@') for x, p in tree.by_xref.items() if x in included}
    families, people, sources = [], [], []
    for fid, f in tree.fams.items():
        members = {x for x in [f['husb'], f['wife'], *f['chil']] if x}
        if not members.issubset(included):
            continue
        families.append({'id': fid, 'parents': [ids[x] for x in [f['husb'], f['wife']] if x in ids],
                         'children': [ids[x] for x in f['chil'] if x in ids], 'events': raw_events(records[fid])})
    for xref, pid in ids.items():
        person = tree.by_xref[xref]
        element = records[xref]
        entry = {'id': pid, 'name': f"{person['given']} {person['surname']}".strip(),
                 'events': raw_events(element), 'parents': [], 'partners': [], 'children': [], 'siblings': [], 'media': []}
        for family in families:
            if pid in family['parents']:
                entry['partners'].extend(x for x in family['parents'] if x != pid)
                entry['children'].extend(family['children'])
                entry['events'].extend(family['events'])
            if pid in family['children']:
                entry['parents'].extend(family['parents'])
                entry['siblings'].extend(x for x in family['children'] if x != pid)
        for relation in ['parents', 'partners', 'children', 'siblings']:
            entry[relation] = list(dict.fromkeys(entry[relation]))
        for media in children(element, 'OBJE'):
            obj = records.get(media.get_value(), media)
            for file in children(obj, 'FILE'):
                entry['media'].append({'path': file.get_value(), 'title': val(obj, 'TITL') or val(file, 'TITL')})
        for source in person['sources']:
            sid = 'source-' + hashlib.sha256((source['label'] + source.get('url', '')).encode()).hexdigest()[:16]
            if not any(s['id'] == sid for s in sources):
                sources.append({'id': sid, **source})
        people.append(entry)
    return {'people': people, 'families': families, 'sources': sources}


def package(tree, output, edition='document', strict_assets=False, previews=False,
            book_receipt=None, composition_receipt=None, native_book=False, public=False,
            living_people=False, report=None, local=False, staging=None):
    """Replace an owned package only after preparing a complete valid bundle.

    A section naming any out-of-scope _PERSON is excluded in full, including
    its prose and dependent evidence/media. Empty chapters are excluded too.
    Dependency closure is computed after this pruning and note removal.
    _BOUNDARY/_INCLUDE are authoring selectors, consumed by this export; the
    delivered document already contains the selected edition.

    A public (static) site leaves out people and facts the tree marks RESN
    confidential, locked or privacy. It stops when its book prints anything so
    marked, and when it would list someone who may be living, unless
    living_people (site.publish_living_people) is set. A local build for the
    dev server (local) warns about people who may be living instead.
    The package is made in `staging` (default: beside the output), on the
    same disk, and moved into place whole.
    It publishes saved web pages as text, so a browser cannot run them.
    Build notes for the family go to the report file, never into the site.
    """
    if native_book and not book_receipt:
        raise ValueError('Native Book requires the matching checked PDF receipt')
    if book_receipt:
        parsed_bytes = tree.src_path.read_bytes()
        tree = Tree(tree.src_path)
        if tree.src_path.read_bytes() != parsed_bytes:
            raise ValueError('Website genealogy changed during parsing')
    included = scope(tree, edition)
    records = roots(tree)
    validate_visual_roots(records)
    by_pointer = {e.get_pointer(): e for e in records if e.get_pointer()}
    if len(by_pointer) != sum(bool(e.get_pointer()) for e in records):
        raise ValueError('Duplicate GEDCOM record pointers prevent an unambiguous package')
    family_ids = {fid for fid, f in tree.fams.items()
                  if {x for x in [f['husb'], f['wife'], *f['chil']] if x}.issubset(included)}
    private = set()
    if public:
        marked = {x for x in tree.by_xref if restricted(by_pointer[x])}
        private = included & marked
        head = next((e for e in records if e.get_tag() == 'HEAD'), None)
        atlas = children(head, '_ATLAS') if head else []
        if atlas and val(atlas[0], '_ROOT') in private:
            raise Stop('The tree marks the site\'s root person private (RESN). A public site '
                       'needs its root person. Choose another root, or use a private site '
                       '(site.hosting "worker").')
        included -= private
        family_ids = {fid for fid in family_ids if not restricted(by_pointer[fid])
                      and {x for x in [tree.fams[fid]['husb'], tree.fams[fid]['wife'],
                                       *tree.fams[fid]['chil']] if x} & included}
        # The site also carries the book, whose register names the ancestors,
        # their partners and their descendants, whatever the tree's scope.
        named = set()
        book_root = json.loads(Path(book_receipt).read_text()).get('rootRefn') if book_receipt else None
        if book_root in tree.by_refn:
            named = book_people(tree, book_root)
        if named & marked:
            raise Stop(f'The book names {people_count(len(named & marked))} the tree marks private '
                       f'(RESN):\n{listing(tree, named & marked)}\nA public site carries the book, '
                       'so it cannot leave them out. Remove the mark, or use a private site '
                       '(see docs/hosting.md).')
        # The book prints these people's facts, marriages and sources as the
        # tree has them, so a mark on any one of them stops the site too.
        held = {x for x in named if marked_within(by_pointer[x], by_pointer)}
        for fid, family in tree.fams.items():
            members = {x for x in [family['husb'], family['wife'], *family['chil']] if x}
            if members & named and marked_within(by_pointer[fid], by_pointer):
                held |= ({family['husb'], family['wife']} & named) or (members & named)
        if held:
            raise Stop(f'The book prints facts, families or sources the tree marks private (RESN) '
                       f'for {people_count(len(held))}:\n{listing(tree, held)}\nA public site carries the '
                       'book, so it cannot leave them out. Remove the marks, or use a private site '
                       '(see docs/hosting.md).')
        if not living_people:
            living = possibly_living(tree) & (included | named)
            if living and local:
                print(f'\nThis site shows {people_count(len(living))} who may be living. That is '
                      'fine on your own computer, but a build to publish will stop for them:\n'
                      f'{listing(tree, living)}\n', file=sys.stderr)
            elif living:
                raise Stop(
                    f'This public site would show {people_count(len(living))} who may be living:\n'
                    f'{listing(tree, living)}\n'
                    'If someone has died, add a death or burial record with its date or '
                    'place, or "1 DEAT Y" when neither is known.\n'
                    'To leave someone out of the site, mark them "1 RESN privacy" in the tree. '
                    'This cannot leave out someone the book names.\n'
                    'To publish them anyway, set "publish_living_people": true under "site" in '
                    'flyleaf.json.\n'
                    'For a private site with sign-in, see docs/hosting.md.')
    filtered = []
    excluded_assets = {}  # path -> (reason, the record that names it)
    deferred_versions = []
    blank = set()  # notes that keep their citations but lose their text
    current = None  # the record being pruned
    private_couples = {fid for fid, f in tree.fams.items() if {f['husb'], f['wife']} & private}

    def source_walk(element):
        yield element
        for child in element.get_child_elements():
            yield from source_walk(child)

    def eligible_file(element):
        path = element.get_value() or ''
        reviewed = bool(re.fullmatch(r'[a-fA-F0-9]{64}', val(element, '_SHA256')))
        eligible = reader_asset(path, val(element, '_KIND'), reviewed=reviewed)
        if (strict_assets and eligible
                and Path(path).suffix.lower() in STRUCTURED_READER_KINDS
                and not re.fullmatch(r'[a-fA-F0-9]{64}', val(element, '_SHA256'))):
            raise ValueError('A structured reader file requires a reviewed SHA-256: ' + path)
        if not eligible:
            excluded_assets.setdefault(path, set()).add(
                (skip_reason(path, val(element, '_KIND'), reviewed=reviewed), id(current)))
        return eligible

    def target_of(value):
        value = value.strip()
        return by_pointer.get(value) if POINTER.fullmatch(value) else None

    def note_shown(element, record_tag, parent_tag):
        """Whether the site shows this note's words where it stands."""
        target = target_of(element.get_value() or '')
        if ((target if target is not None else element).get_value() or '').startswith('[Source]'):
            return True  # an older-style citation
        if parent_tag in NOTE_PARENTS:
            return True
        return (target is None and parent_tag in EVENTS and element.get_level() == 2
                and record_tag in {'INDI', 'FAM'})

    def prune(element, record_tag, parent_tag=None):
        tag, value = element.get_tag(), element.get_value() or ''
        pointed = target_of(value)
        if record_tag == 'HEAD' and element.get_level() == 1 and tag not in HEAD_FIELDS:
            return None
        if (pointed is not None and pointed.get_tag() in SUBMITTER_RECORDS) or tag in CONTACT_FIELDS:
            return None
        if public and element.get_level() > 0 and (
                restricted(element) or (pointed is not None and restricted(pointed))):
            return None
        # A couple's marriage and other shared events say as much about a
        # spouse marked private as about the other one, so they stay out.
        if (public and record_tag == 'FAM' and element.get_level() == 1 and tag in EVENTS
                and current.get_pointer() in private_couples):
            return None
        if tag == 'SOUR':
            target = by_pointer.get(value, element)
            if (val(target, '_STATUS') == 'research-only'
                    and children(target, '_PERSON')
                    and not any(p.get_value() in included for p in children(target, '_PERSON'))):
                return None
        if tag == '_REPRESENTATION':
            target = by_pointer.get(value, element)
            owner_id = val(target, '_SOURCE')
            owner = by_pointer.get(owner_id)
            if owner_id and (not owner or owner.get_tag() != 'SOUR'):
                raise ValueError('A representation has no valid source owner')
            object_id = val(target, '_SOURCE_OBJECT')
            source_object = by_pointer.get(object_id)
            if object_id and (owner_id or not source_object or source_object.get_tag() != 'OBJE'):
                raise ValueError('A representation has no valid shared source object owner')
            conditions = {child.get_value() for child in children(element, '_IF_SOURCE')}
            object_conditions = {child.get_value() for child in children(element, '_IF_SOURCE_OBJECT')}
            if (conditions or object_conditions) and parent_tag != '_ARCHIVE_CATALOG':
                raise ValueError('Representation selection conditions require a catalogue reference')
            if any(source not in by_pointer or by_pointer[source].get_tag() != 'SOUR'
                   for source in conditions):
                raise ValueError('A representation has no valid conditional source')
            if any(pointer not in by_pointer or by_pointer[pointer].get_tag() != 'OBJE'
                   for pointer in object_conditions):
                raise ValueError('A representation has no valid conditional source object')
            if (owner and val(owner, '_STATUS') == 'research-only'
                    and children(owner, '_PERSON')
                    and not any(p.get_value() in included for p in children(owner, '_PERSON'))):
                return None
            if (owner_id or object_id or conditions or object_conditions) and parent_tag == '_ARCHIVE_CATALOG':
                # A graph must not import an otherwise excluded source. Select
                # its owner through actual citations/catalogue entries first.
                deferred_versions.append((element, owner_id, object_id, conditions, object_conditions))
                return None
        # Review directives remain in the authored/source archive. The family
        # presentation gets only the separately reviewed public explanation.
        if tag == '_DISCOVERY_NOTE':
            return None
        if parent_tag == 'OBJE' and tag in PERSON_FIELDS and value not in included:
            return None
        if record_tag == 'SOUR' and tag == '_PERSON' and value not in included:
            return None
        if tag in {'FILE', '_ARCHIVE'}:
            reader_asset(value)  # Private configuration is forbidden in every mode.
        if strict_assets and tag == '_ARCHIVE' and not eligible_file(element):
            return None
        if strict_assets and tag == 'FILE' and parent_tag == 'OBJE' and not eligible_file(element):
            return None
        if strict_assets and tag == 'OBJE':
            target = by_pointer.get(value, element)
            files = children(target, 'FILE')
            excluded = [file.get_value() for file in files if not eligible_file(file)]
            if excluded:
                if any(k.get_tag() in VISUAL_FIELDS for k in target.get_child_elements()):
                    raise ValueError('Reviewed visual media is outside the reader boundary: ' + ', '.join(excluded))
                # A media object can contain several representations. Remove
                # unsupported FILE children without discarding held images.
                # Drop an object/link only when none of its files survive.
                if len(excluded) == len(files):
                    return None
        if record_tag == 'HEAD' and parent_tag == '_ATLAS' and tag in {'_BOUNDARY', '_INCLUDE'}:
            return None
        if tag in {'FAMC', 'FAMS'} and value not in family_ids:
            return None
        if tag in {'_SECTION', '_NARRATIVE'} and any(
                node.get_tag() == '_PERSON' and node.get_value() not in included
                for node in source_walk(element)):
            filtered.append((value or tag)[:80])
            return None
        if tag == '_CHAP' and any(node.get_value() not in included for node in children(element, '_PERSON')):
            return None
        # A link to someone the site leaves out, such as a godparent from
        # another family (ASSO), goes too.
        if pointed is not None and element.get_level() > 0 and (
                (pointed.get_tag() == 'INDI' and value.strip() not in included)
                or (pointed.get_tag() == 'FAM' and value.strip() not in family_ids)):
            return None
        kept = [child for original in element.get_child_elements()
                if (child := prune(original, record_tag, tag)) is not None]
        if tag == 'NOTE' and element.get_level() > 0 and not note_shown(element, record_tag, parent_tag):
            # The site does not show this note here. Keep the citations it
            # carries, without its words; drop it when it carries none.
            if pointed is not None:
                if pointed.get_tag() != 'NOTE' or not any(
                        c.get_tag() not in {'CONT', 'CONC'} for c in pointed.get_child_elements()):
                    return None
            else:
                kept = [child for child in kept if child[0].get_tag() not in {'CONT', 'CONC'}]
                if not kept:
                    return None
                blank.add(id(element))
        if tag == 'OBJE' and not any(child[0].get_tag() == '_SUBJECT' for child in kept):
            kept = [child for child in kept if child[0].get_tag() not in {'_AVATAR', '_AVATAR_POSITION'}]
        if tag == '_CHAP' and children(element, '_SECTION') and not any(
                child[0].get_tag() == '_SECTION' for child in kept):
            return None
        return element, kept

    def walk(node):
        yield node[0]
        for child in node[1]:
            yield from walk(child)

    renamed = {}  # saved web pages, published as text on a public site

    def line(element):
        if id(element) in blank:
            pointer = element.get_pointer()
            return f"{element.get_level()} {pointer + ' ' if pointer else ''}{element.get_tag()}"
        if element.get_tag() in {'FILE', '_ARCHIVE'} and (element.get_value() or '') in renamed:
            return f"{element.get_level()} {element.get_tag()} {renamed[element.get_value()]}"
        return element.to_gedcom_string().rstrip('\r\n')

    def render(node):
        return '\n'.join(line(element) for element in walk(node))

    pruned = {}
    for record in records:
        current = record
        pruned[id(record)] = prune(record, record.get_tag())
    selected = [pruned[id(e)] for e in records
                if (e.get_tag() in {'HEAD', '_CHAP'} or e.get_pointer() in included | family_ids)
                and pruned[id(e)] is not None]
    wanted = {node[0].get_pointer() for node in selected if node[0].get_pointer()}
    # Resolve only retained references. An omitted person, missing source, or
    # filtered chapter must never become a dangling link in the delivered file.
    def dependencies():
        for node in selected:
            for element in walk(node):
                value = (element.get_value() or '').strip()
                if id(element) in blank or not re.fullmatch(r'@[^@]+@', value) or value in wanted:
                    continue
                target = by_pointer.get(value)
                if (target is None or target.get_tag() in {'INDI', 'FAM', *SUBMITTER_RECORDS}
                        or pruned[id(target)] is None):
                    raise ValueError(f'Retained GEDCOM reference has no included target: {value}')
                wanted.add(value)
                selected.append(pruned[id(target)])

    dependencies()
    independent_sources = {pointer for pointer in wanted if by_pointer[pointer].get_tag() == 'SOUR'}
    independent_objects = {pointer for pointer in wanted if by_pointer[pointer].get_tag() == 'OBJE'}
    for reference, owner_id, object_id, conditions, object_conditions in deferred_versions:
        if ((owner_id and owner_id not in independent_sources)
                or (object_id and object_id not in independent_objects)
                or ((conditions or object_conditions)
                    and not (conditions & independent_sources or object_conditions & independent_objects))):
            continue
        head = next(n for n in selected if n[0].get_tag() == 'HEAD')
        catalogue = next(n for n in head[1] if n[0].get_tag() == '_ARCHIVE_CATALOG')
        # Consume the selectors. Retaining them would let a shared ancestor
        # import its other, excluded owners during the next pointer closure.
        catalogue[1].append((reference, []))
    dependencies()
    # A shared note keeps its words only when a retained link shows them;
    # otherwise only the citations it carries remain.
    shown_notes = set()
    for node in selected:
        for element in walk(node):
            value = (element.get_value() or '').strip()
            parent = element.get_parent_element()
            record = element
            while record.get_parent_element() is not None:
                record = record.get_parent_element()
            if (element.get_tag() == 'NOTE' and element.get_level() > 0 and POINTER.fullmatch(value)
                    and note_shown(element, record.get_tag(), parent.get_tag() if parent else None)):
                shown_notes.add(value)
    for index, node in enumerate(selected):
        element = node[0]
        if element.get_tag() == 'NOTE' and element.get_level() == 0 and element.get_pointer() not in shown_notes:
            blank.add(id(element))
            selected[index] = (element, [c for c in node[1] if c[0].get_tag() not in {'CONT', 'CONC'}])

    source_root = ROOT.resolve()

    def local_path(value, purpose, kind='', *, reviewed=False):
        rel = value.replace('\\', '/')
        parts = Path(rel).parts
        if purpose == 'Asset' and strict_assets:
            if not reader_asset(rel, kind, reviewed=reviewed):
                raise ValueError(f'Asset is outside the publishable archive boundary: {rel}')
        path = Path(rel)
        if not rel or path.is_absolute() or '..' in path.parts or re.match(r'^[a-zA-Z][\w+.-]*:', rel):
            raise ValueError(f'Unsafe {purpose} path: {value}')
        resolved = (source_root / path).resolve()
        if not resolved.is_relative_to(source_root):
            raise ValueError(f'{purpose} path leaves the family folder: {value}')
        if purpose == 'Asset':
            resolved_eligible = reader_asset(resolved.relative_to(source_root).as_posix(), kind,
                                            reviewed=reviewed)
            if strict_assets and not resolved_eligible:
                raise ValueError(f'Asset resolves outside the publishable archive boundary: {rel}')
        return rel, resolved

    digest_cache = {}

    def sha256(path):
        # Shared citations can point at the same large archive/manuscript.
        # Stream each distinct file once instead of loading PDFs into memory.
        path = path.resolve()
        if path not in digest_cache:
            digest = hashlib.sha256()
            with path.open('rb') as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(block)
            digest_cache[path] = digest.hexdigest()
        return digest_cache[path]

    assets, manuscripts, provenance, archive_hashes = {}, {}, {}, {}
    for node in selected:
        for element in walk(node):
            tag, value = element.get_tag(), element.get_value() or ''
            media_file = (tag == 'FILE' and element.get_parent_element() is not None
                          and element.get_parent_element().get_tag() == 'OBJE')
            if tag in {'FILE', '_ARCHIVE'} and (node[0].get_tag() != 'HEAD' or media_file):
                # Apply the same typed-file/hash contract at the final boundary,
                # including older _ARCHIVE and any non-OBJE FILE context.
                if strict_assets and Path(value).suffix.lower() in STRUCTURED_READER_KINDS:
                    eligible_file(element)
                reviewed = bool(re.fullmatch(r'[a-fA-F0-9]{64}', val(element, '_SHA256')))
                rel, resolved = local_path(value, 'Asset', val(element, '_KIND'), reviewed=reviewed)
                if public and Path(rel).suffix.lower() in PAGE_FORMATS:
                    renamed[value] = rel = rel + '.txt'
                if Path(rel).parts[0] in {'family.ged', 'manifest.json', 'previews.json', 'previews'}:
                    raise ValueError(f'Asset path collides with a package control file: {rel}')
                if assets.get(rel, resolved) != resolved:
                    raise ValueError(f'Two files would publish as one: {rel}')
                assets[rel] = resolved
                if tag in {'_ARCHIVE', 'FILE'}:
                    archive_hashes.setdefault(rel, set()).update(
                        (child.get_value() or '').strip().lower()
                        for child in children(element, '_SHA256'))
            elif tag in {'_MANUSCRIPT', '_PROVENANCE'}:
                purpose = 'Manuscript' if tag == '_MANUSCRIPT' else 'Recipe witness'
                rel, resolved = local_path(value, purpose)
                expected = val(element, '_HASH')
                if not resolved.is_file() or not re.fullmatch(r'[a-fA-F0-9]{64}', expected):
                    raise ValueError(f'{purpose} requires an existing file and SHA-256 hash: {rel}')
                actual = sha256(resolved)
                if actual != expected.lower() and tag == '_MANUSCRIPT':
                    raise Stop(f'Stale manuscript adaptation: {rel} changed after the site\'s '
                               'version of it was checked. Check that chapter, then run: flyleaf repin')
                if actual != expected.lower():
                    raise Stop(f'Stale recipe witness: {rel} changed after its version record was '
                               'made. Record its new SHA-256 in data/representations.json.')
                (manuscripts if tag == '_MANUSCRIPT' else provenance)[rel] = actual

    manifest = {'people': len(included), 'families': len(family_ids),
                'sourceSha256': hashlib.sha256(parsed_bytes if book_receipt else tree.src_path.read_bytes()).hexdigest(),
                'assets': [], 'missingAssets': []}
    # Build notes for the family, kept out of the published site. Files are
    # listed when a record the site keeps names them.
    kept_records = {id(node[0]) for node in selected}
    skipped = {path: sorted(reason for reason, record in uses if record in kept_records)[0]
               for path, uses in excluded_assets.items()
               if any(record in kept_records for _, record in uses)}
    notes = {'manuscripts': manuscripts, 'provenance': provenance, 'filteredSections': filtered,
             'excludedResearchAssets': sorted(skipped), 'skippedFiles': dict(sorted(skipped.items())),
             'privatePeople': sorted(tree.by_xref[x]['refn'] or x.strip('@') for x in private),
             'publishedAsText': dict(sorted(renamed.items()))}
    publication = None
    if book_receipt:
        from book_publication import verify_receipt, digest as publication_digest
        head = next(e for e in records if e.get_tag() == 'HEAD')
        atlas = children(head, '_ATLAS')
        if len(atlas) != 1 or not val(atlas[0], '_ROOT'):
            raise ValueError('A book publication requires a declared family root')
        receipt = verify_receipt(book_receipt, root=val(atlas[0], '_ROOT'))
        if not composition_receipt:
            raise ValueError('Book publication requires the matching composition receipt')
        composition_bytes = Path(composition_receipt).read_bytes()
        composition = json.loads(composition_bytes)
        if (composition.get('schema') != 1 or composition.get('nativeSha256') != receipt['nativeSha256']
                or composition.get('composedSha256') != manifest['sourceSha256']):
            raise ValueError('The composed website bytes do not match the book composition receipt')
        publication = receipt['book']
        assets[publication['path']] = ROOT / 'build/book.pdf'
        archive_hashes[publication['path']] = {publication['sha256']}
        manifest['book'] = publication
    output = Path(output).absolute()
    if output.is_symlink():
        raise ValueError('The package output must not be a symlink')
    output = output.resolve()
    if source_root.is_relative_to(output) or tree.src_path.resolve().is_relative_to(output):
        raise ValueError('The package output must not contain its source workspace or GEDCOM')
    if output.exists() and any(output.iterdir()):
        prior_manifest = output / 'manifest.json'
        try:
            prior = json.loads(prior_manifest.read_text())
        except (OSError, ValueError):
            raise ValueError('Refusing to replace a nonempty directory without a package manifest') from None
        if not isinstance(prior.get('assets'), list) or not isinstance(prior.get('sourceSha256'), str):
            raise ValueError('The output folder holds files this build did not make')
        if any(path.is_symlink() for path in output.rglob('*')):
            raise ValueError('The existing package contains a symlink')
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(staging) if staging else output.parent
    staging.mkdir(parents=True, exist_ok=True)
    # Staging is a fresh directory: no stale asset or pre-existing
    # destination symlink can survive a successful replacement.
    with tempfile.TemporaryDirectory(prefix=f'.{output.name}-stage-', dir=staging) as tmp:
        stage = Path(tmp) / 'bundle'
        stage.mkdir()
        document = '\n'.join(render(node) for node in selected) + '\n0 TRLR\n'
        # The site's tree is always written as UTF-8, whatever character set an
        # older program put in the header (PAF wrote ANSEL for plain ASCII).
        document = re.sub(r'^1 CHAR .*$', '1 CHAR UTF-8', document, count=1, flags=re.M)
        validate_visual_media(document)
        (stage / 'family.ged').write_text(document, encoding='utf-8')
        for rel, source in assets.items():
            if not source.is_file():
                manifest['missingAssets'].append(rel)
                continue
            if source.is_relative_to(output):
                raise ValueError(f'An asset depends on the output being replaced: {rel}')
            target = (stage / rel).resolve()
            if not target.is_relative_to(stage):
                raise ValueError(f'Asset destination leaves the package: {rel}')
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            manifest['assets'].append(rel)
        # Check the final staged bytes, after all copies, before replacing the
        # previous package. Missing local originals remain missingAssets.
        for rel in manifest['assets']:
            expected_hashes = archive_hashes.get(rel, set())
            if any(not re.fullmatch(r'[a-f0-9]{64}', expected) for expected in expected_hashes):
                raise ValueError(f'Invalid archive SHA-256: {rel}')
            if expected_hashes and expected_hashes != {sha256(stage / rel)}:
                raise ValueError(f'Archive SHA-256 mismatch: {rel}')
        if previews:
            from website_previews import build_previews
            preview_manifest = build_previews(stage, manifest['assets'], output if output.exists() else None)
            manifest['previewImages'] = len(preview_manifest['files'])
            manifest['previewFiles'] = sorted({variant['path'] for entry in preview_manifest['files'].values()
                                               for variant in entry['variants'].values()})
            manifest['previewBytes'] = sum((stage / rel).stat().st_size for rel in manifest['previewFiles'])
        if publication:
            web_book = None
            if native_book:
                from website_native_book import build_web_book
                web_book = build_web_book(book_receipt, stage, manifest['assets'], renamed=renamed)
                manifest['webBook'] = web_book
            # Recheck provenance after asynchronous-sized file copying and
            # preview work, before replacing the previous complete package.
            if verify_receipt(book_receipt, root=val(atlas[0], '_ROOT'))['book'] != publication:
                raise ValueError('Book publication changed during packaging')
            if (Path(composition_receipt).read_bytes() != composition_bytes or
                    publication_digest(tree.src_path) != composition['composedSha256']):
                raise ValueError('Website composition changed during packaging')
            staged_pdf = stage / publication['path']
            if (publication_digest(staged_pdf) != publication['sha256'] or
                    staged_pdf.stat().st_size != publication['bytes']):
                raise ValueError('Staged book PDF changed during packaging')
            (stage / 'book.json').write_text(json.dumps({'schema': 1,
                'gedcomSha256': sha256(stage / 'family.ged'), 'book': publication,
                **({'webBook': web_book} if web_book else {})}, indent=2) + '\n')
        (stage / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        # The backup must outlive staging cleanup if cancellation or a second
        # filesystem failure prevents rollback. Both renames belong inside
        # the protected block: interruption can follow a completed rename.
        backup_directory = Path(tempfile.mkdtemp(prefix=f'.{output.name}-previous-', dir=staging))
        backup = backup_directory / 'bundle'
        try:
            if output.exists():
                output.rename(backup)
            stage.rename(output)
        except BaseException:
            try:
                if backup.exists():
                    if output.exists():
                        output.rename(stage)
                    backup.rename(output)
            except BaseException as rollback_error:
                raise RuntimeError(f'Publication failed; the previous package is preserved at {backup}') from rollback_error
            backup_directory.rmdir()
            raise
        else:
            shutil.rmtree(backup_directory)
    notes['missingAssets'] = manifest['missingAssets']
    if report:
        Path(report).parent.mkdir(parents=True, exist_ok=True)
        Path(report).write_text(json.dumps(notes, indent=2) + '\n')
    return {**manifest, **notes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=SRC_GED)
    site_data = flyleaf_settings.ENGINE / 'website/public/data'
    parser.add_argument('--output', type=Path, default=site_data)
    parser.add_argument('--all', action='store_true', help='Package all people rather than the document-declared edition')
    parser.add_argument('--previews', action='store_true', help='Include full-frame browsing derivatives of held images')
    parser.add_argument('--book-receipt', type=Path, help='Include the matching checked living PDF publication')
    parser.add_argument('--composition-receipt', type=Path, help='Bind a book publication to its composed native input')
    parser.add_argument('--native-book', action='store_true', help='Include the full checked native book and chapter selections')
    args = parser.parse_args()
    tree = Tree(args.source)
    head = next(e for e in roots(tree) if e.get_tag() == 'HEAD')
    atlas = children(head, '_ATLAS')
    if not args.all and (len(atlas) != 1 or not val(atlas[0], '_ROOT')):
        raise ValueError('An exported edition must declare HEAD/_ATLAS/_ROOT; use --all explicitly for a complete GEDCOM')
    report = ROOT / 'build' / REPORT
    try:
        living_people = flyleaf_settings.get('site.publish_living_people', False)
        if not isinstance(living_people, bool):
            raise Stop('flyleaf.json: site.publish_living_people must be true or false.')
        result = package(tree, args.output, 'all' if args.all else 'document', strict_assets=True,
                         previews=args.previews, book_receipt=args.book_receipt,
                         composition_receipt=args.composition_receipt, native_book=args.native_book,
                         public=hosting() == 'static', living_people=living_people, report=report,
                         local=os.environ.get('FLYLEAF_LOCAL_PREVIEW') == '1',
                         # Not in website/public, which the site copies whole:
                         # a build cut off mid-way must leave nothing there.
                         staging=(flyleaf_settings.ENGINE / 'website/work'
                                  if args.output.resolve() == site_data.resolve() else None))
    except Stop as error:
        sys.exit(f'\nThe site build stopped. {error}')
    print(json.dumps({k: v for k, v in result.items()
                      if k in {'people', 'families', 'missingAssets', 'previewImages', 'previewBytes'}},
                     indent=2))
    print(f'Build notes: {flyleaf_settings.logical(report)}')
    for title, files in [
            ('file(s) the tree names are not in the family folder, so the site cannot show them. '
             'Copy them in, or fix their paths in the tree:', dict.fromkeys(result['missingAssets'], '')),
            ('file(s) the tree names are left out of the site:', result['skippedFiles'])]:
        if not files:
            continue
        print(f"\nWarning: {len(files)} {title}", file=sys.stderr)
        for rel, reason in list(files.items())[:12]:
            print(f"  {rel}" + (f": {reason}" if reason else ''), file=sys.stderr)
        if len(files) > 12:
            print(f"  and {len(files) - 12} more, listed in {flyleaf_settings.logical(report)}",
                  file=sys.stderr)


if __name__ == '__main__':
    main()
