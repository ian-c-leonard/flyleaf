import type { AtlasData, GedNode } from './gedcom.ts';
import { formatGedcomDate } from './date-display.ts';

type Address = { tag: string; index: number }[];
export type CitationPlacement = {
  record: string;
  recordKind: string;
  path: Address;
  via: { record: string; recordKind: string; path: Address }[];
  label: string;
  people: string[];
  sections: string[];
  noteReferences: { index: number; pointer: string }[];
};
export type CitationUse = {
  id: string;
  sourceId: string;
  sourcePointer: string;
  legacyNote: string;
  owner: { kind: string; pointer: string; label: string; people: string[] };
  key: string;
  locator: string;
  notes: string[];
  quay: string;
  placements: CitationPlacement[];
};

const children = (node: GedNode, tag: string) =>
  node.children.filter((n) => n.tag === tag);
const value = (node: GedNode, tag: string) =>
  children(node, tag)[0]?.value || '';
const unique = <T>(items: T[]) => [...new Set(items)];
const recordId = (node: GedNode) =>
  node.pointer || `${node.tag}:${value(node, 'REFN') || value(node, 'TITL')}`;
const eventNames: Record<string, string> = {
  BIRT: 'Birth',
  BAPM: 'Baptism',
  CHR: 'Christening',
  DEAT: 'Death',
  BURI: 'Burial',
  MARR: 'Marriage',
  DIV: 'Divorce',
  CENS: 'Census',
  RESI: 'Residence',
  EMIG: 'Emigration',
  IMMI: 'Immigration',
  NATU: 'Naturalization',
  EDUC: 'Education',
  GRAD: 'Graduation',
  OCCU: 'Occupation',
  RETI: 'Retirement',
  MILI: 'Military service',
  EVEN: 'Event',
  ADOP: 'Adoption',
  PROB: 'Probate',
  WILL: 'Will',
};
/** Display wording only; the recorded TYPE stays unchanged. */
const eventType = (type: string) =>
  type === 'Reported burial' ? 'Burial' : type;

// Content identity, not a security token. Detect any collision instead of
// merging qualifications. Placements are intentionally outside this identity.
function identityHash(text: string) {
  let hash = BigInt('14695981039346656037');
  const prime = BigInt('1099511628211');
  for (const character of text)
    hash = BigInt.asUintN(
      64,
      (hash ^ BigInt(character.codePointAt(0)!)) * prime,
    );
  return hash.toString(36);
}

/** Collect only references already admitted by the existing source reader.
 * This adds qualifications and provenance; it never admits another source,
 * attaches a file to a person, or interprets the note as a new event. */
export function collectCitationUses(
  records: GedNode[],
  data: Pick<AtlasData, 'people' | 'families' | 'chapters'>,
  admitted: ReadonlyMap<GedNode, string>,
  hash = identityHash,
): CitationUse[] {
  const recordMap = new Map(
    records.filter((r) => r.pointer).map((r) => [r.pointer, r]),
  );
  const people = new Map(data.people.map((p) => [p.xref, p]));
  const peopleById = new Map(data.people.map((p) => [p.id, p]));
  const uses = new Map<string, CitationUse>();
  const identities = new Map<string, string>();
  const ownerOf = (record: GedNode) => {
    const person = people.get(record.pointer);
    const family = data.families.find((f) => f.id === record.pointer);
    const names = family?.parents.flatMap((id) => {
      const name = peopleById.get(id)?.name;
      return name ? [name] : [];
    });
    return {
      kind: record.tag,
      pointer: recordId(record),
      label:
        person?.name ||
        (names?.length ? names.join(' & ') : '') ||
        value(record, 'TITL') ||
        (record.tag === 'NOTE'
          ? 'Shared note'
          : record.tag === 'OBJE'
            ? 'Picture or document'
            : 'Book chapter'),
      people: person ? [person.id] : family?.parents || [],
    };
  };
  type Scope = { people: string[]; sections: string[] };

  function walk(
    node: GedNode,
    record: GedNode,
    scope: Scope,
    path: Address,
    via: CitationPlacement['via'],
    label: string,
    ancestors: Set<GedNode>,
  ) {
    if (ancestors.has(node)) return;
    const seen = new Set(ancestors).add(node);
    const counts = new Map<string, number>();
    for (const n of node.children) {
      const index = counts.get(n.tag) || 0;
      counts.set(n.tag, index + 1);
      const address = [...path, { tag: n.tag, index }];
      let nextScope = scope;
      let nextLabel = label;
      if (eventNames[n.tag])
        nextLabel =
          n.tag === 'BURI' &&
          n.value !== 'Y' &&
          !value(n, 'DATE') &&
          !value(n, 'PLAC')
            ? 'Burial'
            : [
                eventType(value(n, 'TYPE')) || eventNames[n.tag],
                formatGedcomDate(value(n, 'DATE')),
                value(n, 'PLAC'),
              ]
                .filter(Boolean)
                .join(' · ');
      else if (n.tag === 'NOTE')
        nextLabel =
          label === 'General' || label === 'General note reference'
            ? 'General note reference'
            : label.startsWith('Note on ')
              ? label
              : `Note on ${label}`;
      else if (n.tag === 'OBJE')
        nextLabel =
          label === 'General'
            ? 'Picture or document'
            : `Picture or document for ${label}`;
      else if (n.tag === '_NARRATIVE') nextLabel = 'Life story';
      else if (n.tag === '_SECTION' && record.tag === '_CHAP') {
        const chapterId =
          value(record, 'REFN') || record.pointer.replace(/@/g, '');
        const sectionIndex = children(record, '_SECTION')
          .sort(
            (a, b) => Number(value(a, '_ORDER')) - Number(value(b, '_ORDER')),
          )
          .indexOf(n);
        const sectionId = n.value || `${record.pointer}-${sectionIndex}`;
        nextScope = {
          people: children(n, '_PERSON').flatMap((p) =>
            people.has(p.value) ? [people.get(p.value)!.id] : [],
          ),
          sections: [`${chapterId}/${sectionId}`],
        };
        nextLabel = value(n, 'TITL') || 'Book chapter';
      }
      const sourceId = admitted.get(n);
      const target = recordMap.get(n.value);
      if (sourceId) {
        const sourcePointer = target?.tag === 'SOUR' ? target.pointer : '';
        const legacyNote = sourcePointer
          ? ''
          : target?.tag === 'NOTE'
            ? target.value
            : n.value;
        const key = value(n, '_KEY') || (target ? value(target, '_KEY') : '');
        const locator =
          value(n, 'PAGE') ||
          (target?.tag === 'NOTE' ? value(target, 'PAGE') : '');
        const noteReferences: CitationPlacement['noteReferences'] = [];
        const notes = children(n, 'NOTE').map((note, index) => {
          let text = note.value;
          const chain = new Set<string>();
          while (recordMap.get(text)?.tag === 'NOTE' && !chain.has(text)) {
            chain.add(text);
            noteReferences.push({ index, pointer: text });
            text = recordMap.get(text)!.value;
          }
          return text;
        });
        const quay = value(n, 'QUAY');
        const owner = ownerOf(record);
        const identity = JSON.stringify([
          'citation-use-v1',
          owner.kind,
          owner.pointer,
          sourcePointer,
          legacyNote,
          sourceId,
          key,
          locator,
          notes,
          quay,
        ]);
        const id = 'citation-' + hash(identity);
        if (identities.has(id) && identities.get(id) !== identity)
          throw new Error(
            'Citation-use identity collision; qualifications cannot be merged.',
          );
        identities.set(id, identity);
        const placement: CitationPlacement = {
          record: recordId(record),
          recordKind: record.tag,
          path: address,
          via,
          label: nextLabel,
          people: nextScope.people,
          sections: nextScope.sections,
          noteReferences,
        };
        const existing = uses.get(id);
        if (existing) {
          existing.owner.people = unique([
            ...existing.owner.people,
            ...nextScope.people,
          ]);
          if (
            !existing.placements.some(
              (p) => JSON.stringify(p) === JSON.stringify(placement),
            )
          )
            existing.placements.push(placement);
        } else
          uses.set(id, {
            id,
            sourceId,
            sourcePointer,
            legacyNote,
            owner: {
              ...owner,
              people: unique([...owner.people, ...nextScope.people]),
            },
            key,
            locator,
            notes,
            quay,
            placements: [placement],
          });
      }
      // Shared source-labelled notes are cited at the reference, retaining
      // reference-level PAGE/NOTE. Ordinary shared notes and media keep their
      // declaring record as owner and the entire reference path separately.
      const legacy =
        n.tag === 'NOTE' && (target || n).value.startsWith('[Source]');
      if (
        target &&
        ((n.tag === 'NOTE' && target.tag === 'NOTE' && !legacy) ||
          (n.tag === 'OBJE' && target.tag === 'OBJE'))
      ) {
        walk(
          target,
          target,
          nextScope,
          [],
          [
            ...via,
            {
              record: recordId(record),
              recordKind: record.tag,
              path: address,
            },
          ],
          nextLabel,
          seen,
        );
      }
      walk(n, record, nextScope, address, via, nextLabel, seen);
    }
  }
  // HEAD/_ARCHIVE_CATALOG discovers files; it is not a person/fact citation.
  // A media citation is explicitly owned by its OBJE record, including media
  // without a person association. Unreferenced NOTE/SOUR definitions are not uses.
  for (const record of records) {
    if (!['INDI', 'FAM', '_CHAP', 'OBJE'].includes(record.tag)) continue;
    const owner = ownerOf(record);
    walk(
      record,
      record,
      { people: owner.people, sections: [] },
      [],
      [],
      record.tag === 'OBJE' ? 'Picture or document' : 'General',
      new Set(),
    );
  }
  return [...uses.values()];
}

export function citationUseLabel(
  use: CitationUse,
  people?: ReadonlySet<string>,
) {
  const placements = use.placements.filter(
    (p) => !people || p.people.some((id) => people.has(id)),
  );
  const labels = unique(
    (placements.length ? placements : use.placements).map((p) => p.label),
  );
  return use.owner.label + ' · ' + labels.join('; ');
}

/** Scope affects the offered choices, never source/file/branch membership. */
export function citationUsesInScope(
  uses: CitationUse[],
  members: ReadonlySet<string>,
  sections: ReadonlySet<string>,
  person = '',
) {
  return uses.filter((use) =>
    use.placements.some((placement) =>
      person
        ? placement.people.includes(person)
        : placement.people.some((id) => members.has(id)) ||
          placement.sections.some((id) => sections.has(id)),
    ),
  );
}
