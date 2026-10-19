import type { Asset, AtlasData } from './gedcom.ts';
import { site } from './settings.ts';
import { createPeopleSearch, relationshipFinder } from './family-browsing.ts';
import {
  identifiedPortrait,
  visualPeople,
  type VisualMedia,
} from './visuals.ts';

export const albumSections = {
  occasions: 'Family occasions',
  family: 'Family portraits and groups',
  captioned: 'Group photographs',
  artwork: 'Artwork',
  places: 'Places and memorials',
  context: 'More pictures',
} as const;
export type AlbumSection = keyof typeof albumSections;
export const albumFilters = { all: 'All', ...albumSections } as const;
export type AlbumFilter = keyof typeof albumFilters;
export type AlbumPeriod =
  | 'all'
  | 'before1900'
  | '1900to1949'
  | '1950to1979'
  | '1980on'
  | 'undated';
export const albumPeriods: Record<AlbumPeriod, string> = {
  all: 'Any year',
  before1900: 'Before 1900',
  '1900to1949': '1900–1949',
  '1950to1979': '1950–1979',
  '1980on': '1980 and later',
  undated: 'No year given',
};
export interface AlbumView {
  asset: Asset;
  visual: VisualMedia;
  combined: boolean;
}
export interface FamilyAlbumEntry extends AlbumView {
  id: string;
  section: AlbumSection;
  views: AlbumView[];
  peopleIds: string[];
  captionYears: number[];
}

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Matches any of the words or phrases, whole and in any case. */
const anyWord = (words: string[]) =>
  new RegExp(`\\b(?:${words.map(escapeRegExp).join('|')})\\b`, 'i');
/** Title words for a family occasion, with the family's own
 * (photos.occasion_words in flyleaf.json). */
const occasionWords = [
  'wedding',
  'graduation',
  'engagement',
  ...site.photos.occasionWords,
];
/** A photograph titled with one of these records a family occasion. */
const occasionTitle = anyWord(occasionWords);
/** A portrait titled with one of these gives the year it was taken: an
 * occasion, a school or passport word, a yearbook's name or another word the
 * family uses (photos.yearbook_names and photos.dated_words). */
const datedTitle = anyWord([
  'yearbook',
  'passport',
  'school',
  'class',
  ...occasionWords,
  ...site.photos.yearbookNames,
  ...site.photos.datedWords,
]);

function sectionFor(
  visual: VisualMedia,
  members?: ReadonlySet<string>,
): AlbumSection {
  const relevant = (ids: string[]) =>
    ids.some((id) => !members || members.has(id));
  // Collection labels describe the recorded occasion, not the identity of
  // every face. A wedding group with unassigned positions stays qualified.
  if (
    visual.content === 'photograph' &&
    ['portrait', 'group'].includes(visual.role) &&
    relevant([
      ...visual.subjectIds,
      ...visual.captionPeople,
      ...visual.associatedIds,
    ]) &&
    occasionTitle.test(visual.title)
  )
    return 'occasions';
  if (
    visual.content === 'artwork' &&
    ['portrait', 'group', 'object'].includes(visual.role)
  )
    return 'artwork';
  if (
    !visual.qualified &&
    ['portrait', 'group'].includes(visual.role) &&
    relevant(visual.subjectIds)
  )
    return 'family';
  if (visual.role === 'group' && relevant(visual.captionPeople))
    return 'captioned';
  if (['place', 'object', 'memorial'].includes(visual.role)) return 'places';
  return 'context';
}

/** Dates in explicitly dated captions/contexts, never filenames, retrieval
 * dates, life-event dates or assumed exposure dates. Unknown/negative clauses
 * cannot provide a year; memorial inscriptions are not photograph dates. */
export function albumCaptionYears(visual: VisualMedia) {
  const dated = visual.publicNote
    .split(/[.!?\n]/)
    .filter(
      (clause) =>
        /\b(?:published|publication|printed|issued|edition|yearbook|notice|passport|caption|photographed|photograph taken)\b/i.test(
          clause,
        ) &&
        !/\b(?:unknown|unstated|not (?:stated|established|known)|unverified|uncertain)\b/i.test(
          clause,
        ),
    );
  if (
    ['portrait', 'group'].includes(visual.role) &&
    datedTitle.test(visual.title)
  )
    dated.push(visual.title);
  return [
    ...new Set(
      dated.flatMap((clause) =>
        [...clause.matchAll(/\b((?:17|18|19|20)\d{2})\b/g)].map((match) =>
          Number(match[1]),
        ),
      ),
    ),
  ].sort((a, b) => a - b);
}

/** A direct image operation can describe another view of the same depiction.
 * A shared source page/PDF alone never groups its independent photographs. */
function sameDepiction(parent: VisualMedia, child: VisualMedia) {
  if (parent.content !== child.content || parent.qualified !== child.qualified)
    return false;
  if (parent.subjectIds.length || child.subjectIds.length)
    return (
      child.subjectIds.length > 0 &&
      child.subjectIds.every((id) => parent.subjectIds.includes(id))
    );
  const signature = (visual: VisualMedia) =>
    JSON.stringify([
      visual.role,
      [...visual.captionPeople].sort(),
      [...visual.associatedIds].sort(),
      [...visual.commemoratedIds].sort(),
    ]);
  return signature(parent) === signature(child);
}

export function familyAlbum(
  data: AtlasData,
  members?: ReadonlySet<string>,
  referenceId = data.rootId,
): FamilyAlbumEntry[] {
  const assets = new Map(data.assets.map((asset) => [asset.id, asset]));
  const visuals = new Map(
    (data.visuals || [])
      .filter((visual) => assets.has(visual.assetId))
      .map((visual) => [visual.path, visual]),
  );
  const adjacency = new Map<string, Set<string>>();
  const roots = new Map<string, Set<string>>();
  const combined = new Map<string, string[]>();
  for (const relation of data.representations || []) {
    const parent = visuals.get(relation.parent),
      child = visuals.get(relation.child);
    if (!parent || !child || !sameDepiction(parent, child)) continue;
    if (relation.role === 'composite') {
      const additions = combined.get(parent.path) || [];
      additions.push(child.path);
      combined.set(parent.path, additions);
      continue;
    }
    if (!['crop', 'derived', 'extracted-image'].includes(relation.role))
      continue;
    for (const [a, b] of [
      [parent.path, child.path],
      [child.path, parent.path],
    ]) {
      const neighbours = adjacency.get(a) || new Set<string>();
      neighbours.add(b);
      adjacency.set(a, neighbours);
    }
    const ancestors = roots.get(child.path) || new Set<string>();
    ancestors.add(parent.path);
    roots.set(child.path, ancestors);
  }
  const compositeChildren = new Set(
    [...combined.entries()].flatMap(([parent, children]) =>
      visuals.get(parent)?.album === 'display' &&
      (!members ||
        visualPeople(visuals.get(parent)!).some((id) => members.has(id)))
        ? children
        : [],
    ),
  );
  const visited = new Set<string>();
  const entries: FamilyAlbumEntry[] = [];
  const relationship = relationshipFinder(data, referenceId);
  const distance = new Map(
    data.people.map((person) => [
      person.id,
      relationship(person.id)?.path.length ?? Infinity,
    ]),
  );
  const leadPortraits = new Set(
    data.people.flatMap((person) => {
      const portrait = identifiedPortrait(data, person.id);
      return portrait ? [portrait.path] : [];
    }),
  );
  for (const visual of visuals.values()) {
    if (
      visited.has(visual.path) ||
      visual.album !== 'display' ||
      compositeChildren.has(visual.path)
    )
      continue;
    const paths = new Set<string>(),
      pending = [visual.path];
    while (pending.length) {
      const path = pending.pop()!;
      if (paths.has(path)) continue;
      paths.add(path);
      visited.add(path);
      pending.push(...(adjacency.get(path) || []));
    }
    const records = [...paths].map((path) => visuals.get(path)!);
    const eligible = records.filter(
      (record) =>
        record.album === 'display' &&
        (!members || visualPeople(record).some((id) => members.has(id))),
    );
    if (!eligible.length) continue;
    eligible.sort(
      (a, b) =>
        Number(roots.has(a.path)) - Number(roots.has(b.path)) ||
        Number(sectionFor(a, members) !== 'family') -
          Number(sectionFor(b, members) !== 'family') ||
        b.subjectIds.length - a.subjectIds.length ||
        a.title.localeCompare(b.title),
    );
    const primary = eligible[0];
    const layouts = [
      ...new Set(records.flatMap((record) => combined.get(record.path) || [])),
    ];
    const views: AlbumView[] = [
      ...records,
      ...layouts.map((path) => visuals.get(path)!),
    ]
      .sort(
        (a, b) =>
          Number(b.path === primary.path) - Number(a.path === primary.path) ||
          Number(a.album === 'alternate') - Number(b.album === 'alternate') ||
          a.title.localeCompare(b.title),
      )
      .map((record) => ({
        asset: assets.get(record.assetId)!,
        visual: record,
        combined: layouts.includes(record.path),
      }));
    entries.push({
      id: primary.assetId,
      asset: assets.get(primary.assetId)!,
      visual: primary,
      combined: false,
      section: sectionFor(primary, members),
      views,
      peopleIds: [...new Set(records.flatMap(visualPeople))],
      captionYears: albumCaptionYears(primary),
    });
  }
  const proximity = (entry: FamilyAlbumEntry) =>
    Math.min(
      ...entry.visual.subjectIds.map((id) => distance.get(id) ?? Infinity),
    );
  const priority = (entry: FamilyAlbumEntry) =>
    entry.views.some((view) => leadPortraits.has(view.visual.path))
      ? 0
      : entry.visual.role === 'group'
        ? 1
        : 2;
  return entries.sort((a, b) => {
    const nearA = proximity(a),
      nearB = proximity(b);
    return (
      priority(a) - priority(b) ||
      nearA - nearB ||
      Number(b.visual.role === 'group') - Number(a.visual.role === 'group') ||
      a.visual.title.localeCompare(b.visual.title, 'en', { numeric: true }) ||
      a.visual.path.localeCompare(b.visual.path)
    );
  });
}

/** All retains the curated portrait/family ordering. Occasions form a timeline
 * using only the already admitted caption/source years, with undated images
 * last. A filename or a person's graduation year cannot date a photograph. */
export function albumCollection(
  entries: FamilyAlbumEntry[],
  section: AlbumFilter,
) {
  if (section === 'all') return entries;
  const selected = entries.filter((entry) => entry.section === section);
  if (section !== 'occasions') return selected;
  const year = (entry: FamilyAlbumEntry) =>
    entry.captionYears.length ? Math.max(...entry.captionYears) : -Infinity;
  return selected.sort((a, b) => {
    const left = year(a),
      right = year(b);
    return left === right ? 0 : left > right ? -1 : 1;
  });
}

const normal = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .toLocaleLowerCase()
    .trim();
const searchIndexes = new WeakMap<
  AtlasData,
  ReturnType<typeof createPeopleSearch>
>();
export function albumMatches(
  data: AtlasData,
  entry: FamilyAlbumEntry,
  options: { query?: string; personId?: string; period?: AlbumPeriod },
) {
  if (options.personId && !entry.peopleIds.includes(options.personId))
    return false;
  const period = options.period || 'all';
  if (period === 'undated' && entry.captionYears.length) return false;
  if (
    period !== 'all' &&
    period !== 'undated' &&
    !entry.captionYears.some((year) =>
      period === 'before1900'
        ? year < 1900
        : period === '1900to1949'
          ? year >= 1900 && year < 1950
          : period === '1950to1979'
            ? year >= 1950 && year < 1980
            : year >= 1980,
    )
  )
    return false;
  if (!options.query?.trim()) return true;
  const publicText = normal(
    [
      entry.visual.title,
      entry.visual.publicNote,
      ...data.people
        .filter((person) => entry.peopleIds.includes(person.id))
        .map((person) => person.name),
    ].join(' '),
  );
  const tokens = normal(options.query).split(' ');
  if (tokens.every((token) => publicText.includes(token))) return true;
  let search = searchIndexes.get(data);
  if (!search) {
    search = createPeopleSearch(data);
    searchIndexes.set(data, search);
  }
  return data.people.some(
    (person) =>
      entry.peopleIds.includes(person.id) && search(person, options.query!),
  );
}
