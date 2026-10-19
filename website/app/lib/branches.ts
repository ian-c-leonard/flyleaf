import type { AtlasData, Person } from './gedcom.ts';
import { relationshipFinder } from './family-browsing.ts';
import { connectedFiles } from './representations.ts';
import { visualPeople, visualSources } from './visuals.ts';

export function branchChoices(data: AtlasData) {
  const byId = new Map(data.people.map((p) => [p.id, p]));
  const root = byId.get(data.rootId)!;
  const parents = root.parents.flatMap((id) =>
    byId.get(id) ? [byId.get(id)!] : [],
  );
  return parents.map((person) => ({
    person,
    grandparents: person.parents.flatMap((id) =>
      byId.get(id) ? [byId.get(id)!] : [],
    ),
  }));
}

/** A person's nearest family for Home, in family order: brothers and sisters
 * (with the person), then children and grandchildren when there are any,
 * otherwise parents and grandparents. Twelve at most. */
export function immediateFamily(
  data: AtlasData,
  personId = data.rootId,
): Person[] {
  const byId = new Map(data.people.map((p) => [p.id, p]));
  const pick = (ids: readonly string[]) =>
    ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const familyOf = (person: Person) => {
    const household = data.families.find((f) => f.children.includes(person.id));
    const generation = household ? pick(household.children) : [person];
    const children = pick(person.children);
    const parents = pick(person.parents);
    return children.length
      ? [
          ...generation,
          ...children,
          ...children.flatMap((c) => pick(c.children)),
          ...parents,
        ]
      : [...generation, ...parents, ...parents.flatMap((p) => pick(p.parents))];
  };
  const person = byId.get(personId) || byId.get(data.rootId)!;
  // Someone who married into the family, with no parents or children of
  // their own here, sees their partner's family. Only one partner step is
  // taken, so partners with no family of their own still end the search.
  const partner = pick(person.partners).find((p) => p.id !== person.id);
  const family =
    !person.parents.length && !person.children.length && partner
      ? [person, ...familyOf(partner)]
      : familyOf(person);
  return [...new Map(family.map((p) => [p.id, p])).values()].slice(0, 12);
}

/** Display photographs showing at least three of the root's immediate
 * family, most people first (ties keep album order), for the rotating
 * home-page photograph. */
export function familyGroupPhotos(data: AtlasData) {
  const family = new Set(immediateFamily(data).map((p) => p.id));
  const found: { assetId: string; count: number; order: number }[] = [];
  const seen = new Set<string>();
  (data.visuals || []).forEach((visual, order) => {
    if (visual.content !== 'photograph' || visual.album !== 'display') return;
    if (seen.has(visual.assetId)) return;
    const count = visual.subjectIds.filter((id) => family.has(id)).length;
    if (count < 3) return;
    seen.add(visual.assetId);
    found.push({ assetId: visual.assetId, count, order });
  });
  found.sort((a, b) => b.count - a.count || a.order - b.order);
  return found.flatMap(({ assetId }) => {
    const asset = data.assets.find((a) => a.id === assetId);
    return asset ? [asset] : [];
  });
}

/** Ancestry, the anchor's descendants, and collateral households.
 * Recorded partners stay visible, but a partner does not bring their separate
 * ancestors, other partners or children from another household. This keeps a
 * selected half or quarter recognisable without importing the other ancestry.
 * Shared stories are selected as complete authored units, never rewritten.
 * The canonical model stays intact for relationship navigation outside focus.
 */
export function familyFocus(data: AtlasData, anchorId: string) {
  const byId = new Map(data.people.map((p) => [p.id, p]));
  const anchor = byId.get(anchorId);
  if (!anchor) return { data, anchor: null, members: new Set(byId.keys()) };
  const ancestors = new Set<string>();
  const pending = [anchor.id];
  while (pending.length) {
    const id = pending.pop()!;
    if (ancestors.has(id) || !byId.has(id)) continue;
    ancestors.add(id);
    pending.push(...byId.get(id)!.parents);
  }
  // A grandparent's branch also includes their children and grandchildren.
  // Stop a malformed descendant cycle when it rejoins the ancestry; otherwise
  // it could turn an ancestor's other descendants into a route across branches.
  const descendants = new Set<string>();
  pending.push(...anchor.children);
  while (pending.length) {
    const id = pending.pop()!;
    if (ancestors.has(id) || descendants.has(id) || !byId.has(id)) continue;
    descendants.add(id);
    pending.push(...byId.get(id)!.children);
  }
  const collateral = new Set<string>();
  for (const id of ancestors) {
    const person = byId.get(id)!;
    pending.push(...person.siblings);
    // A shared parent's other union also supplies siblings. The parser's
    // sibling list alone only covers children within the same family record.
    for (const parent of person.parents)
      pending.push(...(byId.get(parent)?.children || []));
  }
  while (pending.length) {
    const id = pending.pop()!;
    if (
      ancestors.has(id) ||
      descendants.has(id) ||
      collateral.has(id) ||
      !byId.has(id)
    )
      continue;
    collateral.add(id);
    pending.push(...byId.get(id)!.children);
  }
  const core = new Set([...ancestors, ...descendants, ...collateral]);
  const members = new Set(core);
  // Walk partners once from the selected family, never from newly added
  // partners. A relative's spouse is family context, not an ancestry selector.
  for (const id of core)
    for (const partner of byId.get(id)!.partners)
      if (byId.has(partner)) members.add(partner);
  const people = data.people.filter((p) => members.has(p.id));
  const chapters = data.chapters
    .map((chapter) => ({
      ...chapter,
      sections: chapter.sections.filter((section) =>
        section.people.some((id) => members.has(id)),
      ),
    }))
    .filter((c) => c.sections.length);
  const sections = chapters.flatMap((c) => c.sections);
  const sourceIds = new Set([
    ...people.flatMap((p) => p.sourceIds),
    ...sections.flatMap((s) => s.sourceIds),
    ...data.sources
      .filter((s) => s.associatedPeople?.some((id) => members.has(id)))
      .map((s) => s.id),
  ]);
  const assetIds = new Set([
    ...people.flatMap((p) => p.assetIds),
    ...sections.flatMap((s) => s.assetIds),
  ]);
  for (const visual of data.visuals || [])
    if (visualPeople(visual).some((id) => members.has(id))) {
      assetIds.add(visual.assetId);
      for (const source of visualSources(data, visual.path))
        sourceIds.add(source.id);
    }
  for (const asset of data.assets)
    if (assetIds.has(asset.id))
      for (const id of asset.sourceIds || []) sourceIds.add(id);
  const directFiles = new Set([
    ...data.sources
      .filter((s) => sourceIds.has(s.id))
      .flatMap((s) => s.archives.map((f) => f.path)),
    ...data.assets.filter((a) => assetIds.has(a.id)).map((a) => a.path),
  ]);
  const graphFiles = new Set(
    (data.representations || []).flatMap((r) => [r.parent, r.child]),
  );
  const contextFiles = connectedFiles(
    data.representations || [],
    [...directFiles].filter((path) => graphFiles.has(path)),
  );
  for (const asset of data.assets)
    if (
      contextFiles.has(asset.path) ||
      (asset.kind === 'book-illustration' && directFiles.has(asset.path))
    )
      assetIds.add(asset.id);
  for (const source of data.sources)
    if (source.archives.some((f) => contextFiles.has(f.path)))
      sourceIds.add(source.id);
  const retainedPaths = new Set([
    ...directFiles,
    ...contextFiles,
    ...data.sources
      .filter((s) => sourceIds.has(s.id))
      .flatMap((s) => s.archives.map((f) => f.path)),
  ]);
  const visuals = (data.visuals || []).filter((v) => retainedPaths.has(v.path));
  for (const visual of visuals) assetIds.add(visual.assetId);
  const placeIds = new Set([
    ...people.flatMap((p) =>
      p.events.flatMap((e) => (e.place ? [e.place.id] : [])),
    ),
    ...sections.flatMap((s) => s.places.map((p) => p.id)),
  ]);
  return {
    anchor,
    members,
    data: {
      ...data,
      rootId: anchor.id,
      people,
      chapters,
      assets: data.assets.filter((a) => assetIds.has(a.id)),
      visuals,
      mediaCaptions: (data.mediaCaptions || []).filter((c) =>
        retainedPaths.has(c.path),
      ),
      sources: data.sources.filter((s) => sourceIds.has(s.id)),
      representations: (data.representations || []).filter(
        (r) => contextFiles.has(r.parent) && contextFiles.has(r.child),
      ),
      places: data.places.filter((p) => placeIds.has(p.id)),
    },
  };
}

export function ancestryPath(data: AtlasData, target: string): Person[] {
  const byId = new Map(data.people.map((p) => [p.id, p]));
  const queue = [[data.rootId]];
  const visited = new Set<string>();
  while (queue.length) {
    const path = queue.shift()!;
    const id = path[path.length - 1];
    if (visited.has(id)) continue;
    visited.add(id);
    if (id === target)
      return path.flatMap((p) => (byId.get(p) ? [byId.get(p)!] : []));
    for (const parent of byId.get(id)?.parents || [])
      queue.push([...path, parent]);
  }
  return [];
}

/** Years a life may last, and years between generations, in the rule for
 * who may still be living. */
const LIFESPAN = 100;
const GENERATION = 30;

/** Could this person still be alive? The same rule as the privacy check on
 * a public site (scripts/booklib.py, possibly_living):
 * - No one with a recorded death, burial, cremation or probate.
 * - Anyone born or christened within the last 100 years; without a birth,
 *   the latest of their dated facts counts.
 * - With no date, the year is estimated from relatives: 30 years after a
 *   parent's, the same as a partner's, or 30 years before a child's,
 *   whichever is latest. Estimates follow relatives up to three steps away.
 * Unlike the privacy check, someone with nothing to go on is left out. */
export function mayBeLiving(
  data: AtlasData,
  person: Person,
  now = new Date().getFullYear(),
): boolean {
  const byId = new Map(data.people.map((p) => [p.id, p]));
  const birth = (p: Person, steps: number): number | null => {
    // A date with no end, such as "AFT 1900", does not say how late.
    const open = (date: string) =>
      /^\s*AFT\b/i.test(date) ||
      (/\bFROM\b/i.test(date) && !/\bTO\b/i.test(date));
    const years = (types?: string[]) =>
      p.events
        .filter(
          (e) =>
            e.year != null &&
            !open(e.date) &&
            (!types || types.includes(e.type)),
        )
        .map((e) => e.year as number);
    const own = years(['BIRT', 'CHR', 'BAPM']).length
      ? years(['BIRT', 'CHR', 'BAPM'])
      : years();
    const year = own.length ? Math.max(...own) : null;
    if (year !== null || steps === 0) return year;
    const from = (ids: string[], offset: number) =>
      ids.flatMap((id) => {
        const relative = byId.get(id);
        const estimate = relative ? birth(relative, steps - 1) : null;
        return estimate === null ? [] : [estimate + offset];
      });
    const estimates = [
      ...from(p.parents, GENERATION),
      ...from(p.partners, 0),
      ...from(p.children, -GENERATION),
    ];
    return estimates.length ? Math.max(...estimates) : null;
  };
  // Death, burial, cremation or probate: as scripts/booklib.py's
  // possibly_living, which the privacy check on a public site uses.
  if (
    person.events.some((e) => ['DEAT', 'BURI', 'CREM', 'PROB'].includes(e.type))
  )
    return false;
  const year = birth(person, 3);
  return year !== null && year > now - LIFESPAN;
}

/** The people an administrator may see the site as: everyone who may be
 * living, and every relative the family has given a sign-in (viewers),
 * nearest to the root person first. */
export function viewpointChoices(
  data: AtlasData,
  viewers: readonly string[] = [],
  now = new Date().getFullYear(),
): Person[] {
  const fromRoot = relationshipFinder(data, data.rootId);
  const distance = (p: Person) => fromRoot(p.id)?.path.length ?? Infinity;
  return data.people
    .filter((p) => viewers.includes(p.id) || mayBeLiving(data, p, now))
    .sort((a, b) => distance(a) - distance(b) || a.name.localeCompare(b.name));
}
