/** A data-only GEDCOM reader. Authored stories are an optional extension
 * (the header's _ATLAS record). */
import { collectCitationUses, type CitationUse } from './citation-uses.ts';
import { collectVisuals, type VisualMedia } from './visuals.ts';
export interface GedNode {
  tag: string;
  value: string;
  pointer: string;
  children: GedNode[];
}
export interface Place {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  precision: string;
}
export interface LifeEvent {
  id: string;
  type: string;
  label: string;
  date: string;
  year: number | null;
  place: Place | null;
  detail: string;
  /** What happened, in the record's own words, without its notes. */
  value?: string;
  partnerId?: string;
}
export interface Asset {
  id: string;
  path: string;
  title: string;
  credit: string;
  rights: string;
  kind?: string;
  sourceIds?: string[];
}
export interface ArchiveFile {
  path: string;
  title?: string;
  note?: string;
  kind: string;
  nature: string;
  locator: string;
  status: string;
  page?: number;
  bookCaptions?: string[];
  representationRole?: string;
}
export interface Representation {
  id: string;
  parent: string;
  child: string;
  role: string;
  method: string;
  recipe: string;
  witness: string;
}
export interface Source {
  id: string;
  pointer?: string;
  legacyNotes?: string[];
  label: string;
  url: string;
  locator: string;
  archivePath: string;
  note: string;
  archives: ArchiveFile[];
  researchOnly?: boolean;
  associatedPeople?: string[];
  uses?: CitationUse[];
}
export interface Person {
  id: string;
  xref: string;
  name: string;
  given: string;
  surname: string;
  /** Recorded names and nicknames; never inferred from a partner's surname. */
  nameVariants?: string[];
  /** A recorded married surname (_MARNM), when the person uses it. */
  marriedSurname?: string;
  sex: string;
  events: LifeEvent[];
  parents: string[];
  parentLinks: { id: string; family: string; kind: string }[];
  partners: string[];
  children: string[];
  siblings: string[];
  narrative: string[];
  assetIds: string[];
  sourceIds: string[];
  relationshipNotes: string[];
  associations?: { id: string; label: string }[];
}
export interface Family {
  id: string;
  parents: string[];
  children: string[];
  events: LifeEvent[];
}
export interface Section {
  id: string;
  title: string;
  year: number | null;
  period: string;
  paragraphs: string[];
  people: string[];
  assetIds: string[];
  sourceIds: string[];
  place: Place | null;
  places: Place[];
}
export interface Chapter {
  id: string;
  title: string;
  subtitle: string;
  sections: Section[];
  authored: boolean;
}
export interface AtlasData {
  title: string;
  subtitle: string;
  rootId: string;
  people: Person[];
  families: Family[];
  assets: Asset[];
  sources: Source[];
  places: Place[];
  chapters: Chapter[];
  warnings: string[];
  representations?: Representation[];
  visuals?: VisualMedia[];
  mediaCaptions?: Asset[];
}

const eventLabels: Record<string, string> = {
  BIRT: 'Born',
  BAPM: 'Baptized',
  CHR: 'Christened',
  DEAT: 'Died',
  BURI: 'Buried',
  MARR: 'Married',
  DIV: 'Divorced',
  CENS: 'Census',
  RESI: 'Residence',
  EMIG: 'Emigrated',
  IMMI: 'Immigrated',
  NATU: 'Naturalized',
  EDUC: 'Education',
  GRAD: 'Graduated',
  OCCU: 'Occupation',
  RETI: 'Retired',
  MILI: 'Military service',
  EVEN: 'Life event',
  ADOP: 'Adopted',
  PROB: 'Probate',
  WILL: 'Will',
};
const children = (node: GedNode, tag: string) =>
  node.children.filter((child) => child.tag === tag);
const child = (node: GedNode, tag: string) => children(node, tag)[0];
const value = (node: GedNode, tag: string) => child(node, tag)?.value ?? '';
const unique = <T>(items: T[]) => [...new Set(items)];
const paragraphs = (text: string) =>
  text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
const stableId = (text: string) => {
  let hash = 2166136261;
  for (const char of text) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

/** The id the site and the book use for a person: the REFN marked TYPE
 * jsonid, which Flyleaf adds, else the first REFN, else the GEDCOM pointer.
 * Other programs may write their own REFNs, in any order. */
export function personId(individual: GedNode): string {
  const refns = children(individual, 'REFN').filter((n) => n.value.trim());
  const flyleaf = refns.find((n) =>
    children(n, 'TYPE').some((t) => t.value.trim() === 'jsonid'),
  );
  return (
    (flyleaf || refns[0])?.value.trim() || individual.pointer.replace(/@/g, '')
  );
}

/** Every person id in a GEDCOM file. */
export function personIds(text: string): Set<string> {
  return new Set(
    parseRecords(text)
      .filter((n) => n.tag === 'INDI')
      .map(personId),
  );
}

export function parseRecords(text: string): GedNode[] {
  const roots: GedNode[] = [];
  const stack: GedNode[] = [];
  const pointers = new Set<string>();
  for (const [index, line] of text
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/)
    .entries()) {
    if (!line.trim()) continue;
    const match = line.match(
      /^(\d+)\s+(?:(@[^@]+@)\s+)?([A-Za-z0-9_]+)(?: (.*))?$/,
    );
    if (!match)
      throw new Error(`This is not a valid GEDCOM line (${index + 1}).`);
    const level = Number(match[1]);
    if (level > 0 && !stack[level - 1])
      throw new Error(`Missing GEDCOM parent at line ${index + 1}.`);
    const node: GedNode = {
      tag: match[3].toUpperCase(),
      value: match[4] ?? '',
      pointer: match[2] ?? '',
      children: [],
    };
    if (node.pointer) {
      if (pointers.has(node.pointer))
        throw new Error(`Duplicate GEDCOM identity ${node.pointer}.`);
      pointers.add(node.pointer);
    }
    if (node.tag === 'CONT' || node.tag === 'CONC') {
      if (!stack[level - 1])
        throw new Error(`Invalid continuation at line ${index + 1}.`);
      stack[level - 1].value += (node.tag === 'CONT' ? '\n' : '') + node.value;
    } else {
      (level === 0 ? roots : stack[level - 1].children).push(node);
    }
    stack.length = level;
    stack[level] = node;
  }
  if (!roots.some((n) => n.tag === 'HEAD'))
    throw new Error('This file has no GEDCOM header.');
  return roots;
}

export function yearOf(date: string): number | null {
  const found = date.match(/(?:^|\s)(\d{3,4})(?:\/(\d{1,2}))?(?:\b|\/)/);
  if (!found) return null;
  const base = Number(found[1]);
  // A dual year (1 JAN 1655/56) is a January-March date under both calendars;
  // its year by the modern reckoning is the later one, as the book prints it.
  if (!found[2]) return base;
  const tail = found[2];
  const later =
    Math.floor(base / 10 ** tail.length) * 10 ** tail.length + Number(tail);
  return later > base ? later : later + 10 ** tail.length;
}

function coordinate(raw: string, latitude: boolean): number | null {
  if (!raw) return null;
  const text = raw.trim().toUpperCase();
  const pattern = latitude
    ? /^(?:[NS]\d+(?:\.\d+)?|[+-]?\d+(?:\.\d+)?)$/
    : /^(?:[EW]\d+(?:\.\d+)?|[+-]?\d+(?:\.\d+)?)$/;
  if (!pattern.test(text)) return null;
  const number = Number(text.replace(/[NSEW]/g, ''));
  if (!Number.isFinite(number) || Math.abs(number) > (latitude ? 90 : 180))
    return null;
  return /^[SW]/.test(text) ? -Math.abs(number) : number;
}

function readPlace(node: GedNode | undefined): Place | null {
  if (!node?.value) return null;
  const map = child(node, 'MAP');
  return {
    id: stableId(node.value),
    name: node.value,
    latitude: map ? coordinate(value(map, 'LATI'), true) : null,
    longitude: map ? coordinate(value(map, 'LONG'), false) : null,
    precision: value(node, '_PRECISION') || 'Locality',
  };
}

function eventsOf(node: GedNode): LifeEvent[] {
  return node.children
    .filter((n) => eventLabels[n.tag])
    .map((event, index) => ({
      id: `${node.pointer}:${event.tag}:${index}`,
      type: event.tag,
      // Display wording only; the recorded TYPE stays unchanged.
      label:
        (value(event, 'TYPE') === 'Reported burial'
          ? 'Burial'
          : value(event, 'TYPE')) || eventLabels[event.tag],
      date: value(event, 'DATE'),
      year: yearOf(value(event, 'DATE')),
      place: readPlace(child(event, 'PLAC')),
      value: event.value === 'Y' ? '' : event.value,
      detail: [
        event.value === 'Y' ? '' : event.value,
        ...children(event, 'NOTE')
          // Only direct literal event notes are public event qualifications.
          // Shared-note pointers may lead to private research; do not resolve
          // them or display their identifiers as prose.
          .filter(
            (note) =>
              note.value.trim() && !/^@[^@\s]+@/.test(note.value.trim()),
          )
          .map((note) => note.value),
      ]
        .filter(Boolean)
        .join('\n\n'),
    }));
}

/** How the site shows names (the family's names settings). */
export interface NameOptions {
  /** Show married women as "Given (Maiden) Married" (names.married_surnames).
   * Off by default: everyone appears under their recorded name. */
  marriedSurnames?: boolean;
}

export function parseGedcom(
  text: string,
  options: NameOptions = {},
): AtlasData {
  if (text.includes('\uFFFD'))
    throw new Error(
      'Some characters could not be decoded. Export this GEDCOM as UTF-8 and try again.',
    );
  const records = parseRecords(text);
  const atlas = child(
    records.find((n) => n.tag === 'HEAD')!,
    '_ATLAS',
  );
  const recordMap = new Map(
    records.filter((n) => n.pointer).map((n) => [n.pointer, n]),
  );
  const individuals = records.filter((n) => n.tag === 'INDI');
  if (!individuals.length)
    throw new Error('This GEDCOM contains no individual people.');
  if (records.some((n) => (n.tag === 'INDI' || n.tag === 'FAM') && !n.pointer))
    throw new Error('An individual or family has no GEDCOM identity pointer.');
  const ids = new Map(individuals.map((n) => [n.pointer, personId(n)]));
  if (new Set(ids.values()).size !== ids.size)
    throw new Error('Duplicate person reference names in this GEDCOM.');
  const warnings: string[] = [];
  const resolve = (pointer: string) => {
    const id = ids.get(pointer);
    if (pointer && !id)
      warnings.push(`A relationship points to an absent person: ${pointer}`);
    return id;
  };
  const sources: Source[] = [];
  const assets: Asset[] = [];
  const mediaCaptions: Asset[] = [];
  const notes = (node: GedNode) =>
    children(node, 'NOTE')
      .map((note) => {
        const shared = recordMap.get(note.value);
        return shared?.tag === 'NOTE' ? shared.value : note.value;
      })
      .filter(Boolean)
      .join('\n\n');
  // Follow media and shared notes, without turning source citations or family
  // pointers into photographs of the person who happens to cite them.
  const mediaNodes = (
    node: GedNode,
    seen = new Set<GedNode>(),
    skipCitations = false,
  ): GedNode[] => {
    if (seen.has(node)) return [];
    seen.add(node);
    return node.children.flatMap((n) => {
      const target = n.tag === 'NOTE' ? recordMap.get(n.value) : undefined;
      if (
        skipCitations &&
        (n.tag === 'SOUR' ||
          (n.tag === 'NOTE' && (target || n).value.startsWith('[Source]')))
      )
        return [];
      if (n.tag === 'OBJE') return [n];
      return mediaNodes(target || n, seen, skipCitations);
    });
  };
  const mediaFiles = (node: GedNode): ArchiveFile[] => {
    const target = recordMap.get(node.value) || node;
    return children(target, 'FILE')
      .filter((file) => file.value)
      .map((file) => ({
        path: file.value.replace(/\\/g, '/'),
        title:
          value(node, '_CAPTION') ||
          value(file, 'TITL') ||
          value(target, 'TITL'),
        note: [notes(file), notes(target)].filter(Boolean).join('\n\n'),
        kind: value(file, '_KIND'),
        nature: value(file, '_NATURE'),
        locator: value(file, '_LOCATOR'),
        status: value(file, '_STATUS'),
        page: Number(value(file, '_PAGE')) || undefined,
      }));
  };
  const admittedCitations = new Map<GedNode, string>();
  const addSource = (node: GedNode): string => {
    const target = recordMap.get(node.value);
    const sourceRecord = target?.tag === 'SOUR' ? target : undefined;
    const sourceNote = target?.tag === 'NOTE' ? target : node;
    const label = sourceRecord
      ? value(sourceRecord, 'TITL') ||
        value(sourceRecord, 'ABBR') ||
        'Family record'
      : sourceNote.value
          .replace(/^\[Source\]\s*/, '')
          .split(/\s+—\s+https?:/)[0];
    const rawUrl = sourceRecord
      ? value(sourceRecord, 'WWW') ||
        value(sourceRecord, '_URL') ||
        sourceRecord.children
          .map((n) => n.value)
          .find((t) => /^https?:/.test(t)) ||
        ''
      : sourceNote.value.match(/https?:\/\/[^\s]+/)?.[0] || '';
    const locator =
      value(node, 'PAGE') ||
      (sourceNote !== node ? value(sourceNote, 'PAGE') : '');
    const nativeFiles = [
      ...(target ? mediaNodes(target) : []),
      ...mediaNodes(node),
    ].flatMap(mediaFiles);
    const curated: ArchiveFile[] = target
      ? children(target, '_ARCHIVE').map((file) => ({
          ...nativeFiles.find((f) => f.path === file.value.replace(/\\/g, '/')),
          path: file.value.replace(/\\/g, '/'),
          title:
            value(file, 'TITL') ||
            nativeFiles.find((f) => f.path === file.value)?.title,
          note:
            notes(file) || nativeFiles.find((f) => f.path === file.value)?.note,
          kind: value(file, '_KIND'),
          nature: value(file, '_NATURE'),
          locator: value(file, '_LOCATOR'),
          status: value(file, '_STATUS'),
          page: Number(value(file, '_PAGE')) || undefined,
        }))
      : [];
    // Reviewed descriptions take precedence for an exact file, while every
    // other native attachment remains available. Citation PAGE stays separate.
    const files = new Map(curated.map((file) => [file.path, file]));
    for (const file of nativeFiles)
      if (!files.has(file.path)) files.set(file.path, file);
    const archives = [...files.values()];
    const id = `source-${stableId((sourceRecord?.pointer || label + rawUrl) + locator)}`;
    const existing = sources.find((s) => s.id === id);
    if (existing) {
      if (!sourceRecord)
        existing.legacyNotes = unique([
          ...(existing.legacyNotes || []),
          sourceNote.value,
        ]);
      for (const file of archives)
        if (!existing.archives.some((f) => f.path === file.path))
          existing.archives.push(file);
      existing.archivePath = existing.archives[0]?.path || '';
    } else
      sources.push({
        id,
        ...(sourceRecord ? { pointer: sourceRecord.pointer } : {}),
        ...(!sourceRecord ? { legacyNotes: [sourceNote.value] } : {}),
        label,
        url: /^https?:\/\//.test(rawUrl) ? rawUrl : '',
        locator,
        archivePath: archives[0]?.path || '',
        archives,
        note: target ? notes(target) : '',
        ...(sourceRecord
          ? {
              ...(value(sourceRecord, '_STATUS') === 'research-only'
                ? { researchOnly: true }
                : {}),
              associatedPeople: children(sourceRecord, '_PERSON').flatMap(
                (n) => {
                  const id = resolve(n.value);
                  return id ? [id] : [];
                },
              ),
            }
          : {}),
      });
    admittedCitations.set(node, id);
    return id;
  };
  const addAssets = (node: GedNode): string[] => {
    const target = recordMap.get(node.value) || node;
    return mediaFiles(node).map((file) => {
      const caption = file.title || file.path.split('/').pop() || 'Family file';
      const id = `image-${stableId(file.path + caption)}`;
      const citationIds = unique(
        [
          ...children(target, 'SOUR'),
          ...(node === target ? [] : children(node, 'SOUR')),
        ].map(addSource),
      );
      const context = {
        path: file.path,
        title: caption,
        credit: value(target, '_CREDIT') || notes(target),
        rights: value(target, '_RIGHTS'),
        kind: value(target, '_TYPE'),
        sourceIds: [...citationIds].sort(),
      };
      if (!child(target, '_CONTENT')) {
        const contextId = `caption-${stableId(JSON.stringify(context))}`;
        if (!mediaCaptions.some((c) => c.id === contextId))
          mediaCaptions.push({ id: contextId, ...context });
      }
      const existing = assets.find((a) => a.id === id);
      if (existing)
        existing.sourceIds = unique([
          ...(existing.sourceIds || []),
          ...citationIds,
        ]);
      else
        assets.push({
          id,
          path: file.path,
          title: caption,
          credit: value(target, '_CREDIT') || notes(target),
          rights: value(target, '_RIGHTS'),
          kind: value(target, '_TYPE'),
          sourceIds: citationIds,
        });
      return id;
    });
  };
  const sourceIds = (node: GedNode) => {
    const found: string[] = [];
    const seen = new Set<GedNode>();
    const visit = (parent: GedNode) => {
      if (seen.has(parent)) return;
      seen.add(parent);
      for (const n of parent.children) {
        const target = n.tag === 'NOTE' ? recordMap.get(n.value) : undefined;
        const legacy =
          n.tag === 'NOTE' && (target || n).value.startsWith('[Source]');
        if (n.tag === 'SOUR' || legacy) found.push(addSource(n));
        // A shared source note is cited at the reference, preserving its PAGE.
        // Ordinary shared notes may contain citations and may form cycles.
        if (target?.tag === 'NOTE' && !legacy) visit(target);
        visit(n);
      }
    };
    visit(node);
    return unique(found);
  };
  const assetIds = (node: GedNode) =>
    unique(mediaNodes(node, new Set(), true).flatMap(addAssets));
  const people: Person[] = individuals.map((node) => {
    const nameNode = child(node, 'NAME');
    const rawName = nameNode?.value || 'Name not recorded';
    const surname = nameNode
      ? value(nameNode, 'SURN') || rawName.match(/\/([^/]*)\//)?.[1] || ''
      : '';
    const given = nameNode
      ? value(nameNode, 'GIVN') || rawName.split('/')[0].trim()
      : rawName;
    return {
      id: ids.get(node.pointer)!,
      xref: node.pointer,
      // A slash marks the surname; PAF wrote "Mary/Windsor/" with no space.
      name: rawName.replace(/\//g, ' ').replace(/\s+/g, ' ').trim(),
      given,
      surname,
      marriedSurname: nameNode ? value(nameNode, '_MARNM') : '',
      nameVariants: unique(
        children(node, 'NAME')
          .flatMap((name) => [
            name.value.replace(/\//g, ' ').replace(/\s+/g, ' ').trim(),
            ...children(name, 'NICK').map((nick) => nick.value.trim()),
          ])
          .concat(children(node, 'NICK').map((nick) => nick.value.trim()))
          .filter(Boolean),
      ),
      sex: value(node, 'SEX'),
      events: eventsOf(node),
      parents: [],
      parentLinks: [],
      partners: [],
      children: [],
      siblings: [],
      narrative: children(node, '_NARRATIVE').flatMap((n) =>
        paragraphs(n.value),
      ),
      assetIds: assetIds(node),
      sourceIds: sourceIds(node),
      relationshipNotes: children(node, 'FAMC').flatMap((f) =>
        children(f, 'PEDI').map((n) => n.value),
      ),
      associations: children(node, 'ASSO').flatMap((association) => {
        const id = resolve(association.value);
        return id
          ? [
              {
                id,
                label: value(association, 'RELA') || 'Connection',
              },
            ]
          : [];
      }),
    };
  });
  const pedigreeByPerson = new Map(
    individuals.map((n) => [
      ids.get(n.pointer)!,
      new Map(children(n, 'FAMC').map((f) => [f.value, value(f, 'PEDI')])),
    ]),
  );
  const personMap = new Map(people.map((p) => [p.id, p]));
  const families: Family[] = records
    .filter((n) => n.tag === 'FAM')
    .map((node) => ({
      id: node.pointer,
      parents: node.children
        .filter((n) => n.tag === 'HUSB' || n.tag === 'WIFE')
        .map((n) => resolve(n.value))
        .filter((id): id is string => !!id),
      children: children(node, 'CHIL')
        .map((n) => resolve(n.value))
        .filter((id): id is string => !!id),
      events: eventsOf(node),
    }));
  for (const family of families) {
    for (const id of family.parents) {
      const person = personMap.get(id)!;
      const record = recordMap.get(family.id)!;
      person.sourceIds = unique([...person.sourceIds, ...sourceIds(record)]);
      person.assetIds = unique([...person.assetIds, ...assetIds(record)]);
      person.partners.push(...family.parents.filter((p) => p !== id));
      person.children.push(...family.children);
      person.events.push(
        ...family.events.map((e) => ({
          ...e,
          partnerId: family.parents.find((p) => p !== id),
        })),
      );
    }
    for (const id of family.children) {
      const person = personMap.get(id)!;
      person.parents.push(...family.parents);
      person.parentLinks.push(
        ...family.parents.map((id) => ({
          id,
          family: family.id,
          kind:
            pedigreeByPerson.get(person.id)?.get(family.id) || 'unspecified',
        })),
      );
      person.siblings.push(...family.children.filter((p) => p !== id));
    }
  }
  for (const person of people) {
    person.parents = unique(person.parents);
    person.partners = unique(person.partners);
    person.children = unique(person.children);
    person.siblings = unique(person.siblings);
    person.events.sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity));
  }
  let chapters: Chapter[] = records
    .filter((n) => n.tag === '_CHAP')
    .sort((a, b) => Number(value(a, '_ORDER')) - Number(value(b, '_ORDER')))
    .map((node) => ({
      id: value(node, 'REFN') || node.pointer.replace(/@/g, ''),
      title: value(node, 'TITL') || value(node, 'NAME') || 'Family stories',
      subtitle: value(node, '_SUBTITLE'),
      authored: true,
      sections: children(node, '_SECTION')
        .sort((a, b) => Number(value(a, '_ORDER')) - Number(value(b, '_ORDER')))
        .map((section, index) => {
          const places = children(section, 'PLAC')
            .map(readPlace)
            .filter((p): p is Place => !!p);
          return {
            id: section.value || `${node.pointer}-${index}`,
            title: value(section, 'TITL') || 'A family story',
            year: yearOf(value(section, 'DATE')),
            period: value(section, '_PERIOD') || value(section, 'DATE'),
            paragraphs: children(section, 'NOTE').flatMap((n) =>
              paragraphs(recordMap.get(n.value)?.value || n.value),
            ),
            people: children(section, '_PERSON')
              .map((n) => resolve(n.value))
              .filter((id): id is string => !!id),
            assetIds: assetIds(section),
            sourceIds: sourceIds(section),
            place: places[0] || null,
            places,
          };
        }),
    }));
  chapters = chapters.filter((chapter) => chapter.sections.length > 0);
  if (!chapters.length) {
    const groups = new Map<
      number | null,
      { person: Person; event: LifeEvent }[]
    >();
    for (const person of people)
      for (const event of person.events) {
        const key =
          event.year === null ? null : Math.floor(event.year / 10) * 10;
        groups.set(key, [...(groups.get(key) || []), { person, event }]);
      }
    const sections: Section[] = [...groups.entries()]
      .sort(([a], [b]) => (a ?? Infinity) - (b ?? Infinity))
      .map(([decade, rows]) => {
        const firstYear = Math.min(
          ...rows.map((r) => r.event.year ?? Infinity),
        );
        const places = rows.flatMap((r) =>
          r.event.place ? [r.event.place] : [],
        );
        return {
          id: `years-${decade ?? 'undated'}`,
          title:
            decade === null
              ? 'Lives without a recorded date'
              : `${decade}–${decade + 9}`,
          period:
            decade === null ? 'Date not recorded' : `${decade}–${decade + 9}`,
          year: Number.isFinite(firstYear) ? firstYear : null,
          paragraphs: rows.map(
            ({ person, event }) =>
              `${person.name} — ${event.label.toLowerCase()}${event.date ? `, ${event.date}` : ''}${event.place ? `, ${event.place.name}` : ''}${event.detail ? `. ${event.detail}` : ''}.`,
          ),
          people: unique(rows.map((r) => r.person.id)),
          assetIds: unique(rows.flatMap((r) => r.person.assetIds)),
          sourceIds: [],
          place: places[0] || null,
          places,
        };
      });
    if (!sections.length)
      sections.push({
        id: 'family',
        title: 'Family tree',
        period: '',
        year: null,
        paragraphs: [
          `${people.length} people are recorded in this family. Select a name to follow their relationships.`,
        ],
        people: people.map((p) => p.id),
        assetIds: [],
        sourceIds: [],
        place: null,
        places: [],
      });
    chapters = [
      {
        id: 'recorded-lives',
        title: 'Family timeline',
        subtitle: 'From the family records',
        authored: false,
        sections,
      },
    ];
  }
  const catalog = child(
    records.find((n) => n.tag === 'HEAD')!,
    '_ARCHIVE_CATALOG',
  );
  if (catalog) {
    sourceIds(catalog);
    assetIds(catalog);
  }
  const representations: Representation[] = catalog
    ? children(catalog, '_REPRESENTATION').map((reference) => {
        const record = recordMap.get(reference.value);
        const parent = record && child(record, '_PARENT');
        if (
          !record ||
          record.tag !== '_REPRESENTATION' ||
          !parent ||
          !value(record, 'FILE') ||
          !value(parent, 'FILE')
        )
          throw new Error(
            'An archive representation has incomplete file links.',
          );
        return {
          id: record.pointer.replace(/@/g, ''),
          parent: value(parent, 'FILE'),
          child: value(record, 'FILE'),
          role: value(record, '_ROLE'),
          method: value(record, '_METHOD'),
          recipe: value(record, '_RECIPE'),
          witness: value(record, '_PROVENANCE'),
        };
      })
    : [];
  const allPlaces = [
    ...people.flatMap((p) =>
      p.events.flatMap((e) => (e.place ? [e.place] : [])),
    ),
    ...chapters.flatMap((c) => c.sections.flatMap((s) => s.places)),
  ];
  const placeMap = new Map<string, Place>();
  for (const place of allPlaces)
    if (!placeMap.has(place.id) || place.latitude !== null)
      placeMap.set(place.id, place);
  const configuredRoot = atlas ? ids.get(value(atlas, '_ROOT')) : undefined;
  const rootId =
    configuredRoot ||
    people.find((p) => !p.children.length)?.id ||
    people[0].id;
  if (options.marriedSurnames) applyMarriedNames(people, families);
  const title = atlas ? value(atlas, 'TITL') || value(atlas, 'NAME') : '';
  const visuals = collectVisuals(records, ids, addAssets);
  const citationUses = collectCitationUses(
    records,
    { people, families, chapters },
    admittedCitations,
  );
  for (const source of sources) {
    const uses = citationUses.filter((use) => use.sourceId === source.id);
    if (uses.length) source.uses = uses;
  }
  return {
    title: title || 'The family archive',
    subtitle: atlas ? value(atlas, '_SUBTITLE') : '',
    rootId,
    people,
    families,
    assets,
    sources,
    places: [...placeMap.values()],
    chapters,
    warnings: unique(warnings),
    representations,
    visuals,
    mediaCaptions,
  };
}

const months = 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ');
/** A GEDCOM date as a number that sorts by year, then month, then day. */
function dateOrder(date: string): number | null {
  const year = yearOf(date);
  if (year === null) return null;
  const words = date.toUpperCase().split(/\s+/);
  const month = words.findIndex((word) => months.includes(word));
  const day = month > 0 ? Number(words[month - 1]) || 0 : 0;
  return (
    year * 10000 +
    (month < 0 ? 0 : months.indexOf(words[month]) + 1) * 100 +
    day
  );
}

/** The convention family histories use for a married woman, "Given (Maiden)
 * Married", for families that choose it (names.married_surnames). A recorded
 * married surname (_MARNM) is used where there is one. Otherwise a woman who
 * has died takes her husband's surname: the husband of her latest marriage by
 * date, or, when a marriage has no date, of her last marriage in the records.
 * When her recorded surname is already the married one, a last given name
 * that matches her father's surname is shown as her maiden name. Living women
 * keep their recorded name. The recorded form stays searchable. */
export function applyMarriedNames(people: Person[], families: Family[]) {
  const byId = new Map(people.map((p) => [p.id, p]));
  for (const person of people) {
    if (person.sex !== 'F') continue;
    const deceased = person.events.some(
      (e) => e.type === 'DEAT' || e.type === 'BURI',
    );
    const marriages = families.flatMap((f) => {
      const marriage = f.events.find((e) => e.type === 'MARR');
      const husband = byId.get(f.parents.find((id) => id !== person.id) || '');
      return f.parents.includes(person.id) && marriage && husband?.sex === 'M'
        ? [{ husband, order: dateOrder(marriage.date) }]
        : [];
    });
    // Sorting is stable, so marriages on the same date keep record order.
    const latest = marriages.every((m) => m.order !== null)
      ? [...marriages].sort((a, b) => a.order! - b.order!).at(-1)
      : marriages.at(-1);
    const married =
      person.marriedSurname || (deceased ? latest?.husband.surname : '');
    if (!married) continue;
    let given = person.given;
    let maiden = person.surname;
    if (maiden === married) {
      // Some records keep the married surname, with the maiden name as the
      // last given name. Accept that only when it is her father's surname.
      const father = person.parents
        .map((id) => byId.get(id))
        .find((p) => p?.sex === 'M');
      const words = given.split(' ');
      if (
        !father?.surname ||
        words.at(-1) !== father.surname ||
        words.length < 2
      )
        continue;
      maiden = words.pop()!;
      given = words.join(' ');
    }
    person.nameVariants = [
      ...new Set([...(person.nameVariants || []), person.name]),
    ];
    // An unknown maiden name leaves the name she was known by.
    person.name = maiden
      ? `${given} (${maiden}) ${married}`
      : `${given} ${married}`;
  }
}

export function lifespan(person: Person): string {
  const birth = person.events.find((e) => e.type === 'BIRT');
  const death = person.events.find((e) => e.type === 'DEAT');
  function dateLabel(event?: LifeEvent) {
    if (!event?.year) return '';
    const raw = event.date;
    const years = raw.match(/\b\d{3,4}\b/g);
    if (/^(BET|FROM) /.test(raw) && years && years.length > 1)
      return [...new Set(years)].join('–');
    const qualifier = raw.match(/^(ABT|BEF|AFT|EST|CAL)/)?.[0];
    const prefix =
      qualifier === 'BEF'
        ? 'before '
        : qualifier === 'AFT'
          ? 'after '
          : qualifier
            ? 'about '
            : '';
    return `${prefix}${event.year}`;
  }
  const by = dateLabel(birth),
    dy = dateLabel(death);
  if (by && dy)
    return by.includes('–') || dy.includes('–')
      ? `Born ${by}; died ${dy}`
      : `${by}–${dy}`;
  if (by) return `Born ${by}`;
  if (dy) return `Died ${dy}`;
  return '';
}

export function decodeGedcom(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder('utf-16be').decode(bytes);
  const text = new TextDecoder('utf-8').decode(bytes);
  if (/^1 CHAR ANSEL/m.test(text))
    throw new Error(
      'Please export this file as UTF-8; ANSEL encoding is not supported.',
    );
  return text;
}
