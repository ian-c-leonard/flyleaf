import type { AtlasData, Person } from './gedcom.ts';
import type { WebBookBody, ReadingSection } from './native-book.ts';
import { relationshipFinder } from './family-browsing.ts';

export interface ChapterConnection {
  section: ReadingSection;
  people: Person[];
  initialPerson: string;
}

/** Use reviewed heading mentions first. Section-wide indexes can include a
 * witness, sibling or an ancestor mentioned only briefly in the prose. */
export function chapterConnections(
  data: AtlasData,
  body: WebBookBody,
  chapterId: string,
  headingPassages: ReadonlyMap<string, string>,
) {
  const people = new Map(data.people.map((person) => [person.id, person]));
  const passages = new Map(body.annotations?.passages.map((p) => [p.id, p]));
  const mentions = new Map(body.annotations?.mentions.map((m) => [m.id, m]));
  const reference = people.get(data.rootId) || null;
  const relationship = reference
    ? relationshipFinder(data, reference.id)
    : null;
  const sections: ChapterConnection[] = body.sections
    .filter((section) => section.level === 3 && section.chapter === chapterId)
    .map((section) => {
      const heading = passages.get(headingPassages.get(section.anchor) || '');
      const headingIds = (heading?.mentions || []).flatMap((id) => {
        const mention = mentions.get(id);
        return mention?.kind === 'person' ? [mention.target] : [];
      });
      const members = [
        ...new Set(headingIds.length ? headingIds : section.people),
      ].flatMap((id) => (people.has(id) ? [people.get(id)!] : []));
      const ranked = members
        .map((person) => ({
          person,
          relationship: relationship ? relationship(person.id) : null,
        }))
        .sort((a, b) => {
          const rank = (entry: typeof a) =>
            entry.relationship?.kind === 'self'
              ? 0
              : entry.relationship?.kind === 'ancestor'
                ? entry.relationship.path.length - 1
                : Number.POSITIVE_INFINITY;
          return rank(a) - rank(b);
        });
      return {
        section,
        people: members,
        initialPerson: ranked[0]?.person.id || '',
      };
    });
  // Start a branch at the nearest grandparents (or earlier), rather than the
  // shared parent couple repeated in every printed chart. The reader can select
  // every authored section and every named person in it.
  const initial =
    sections
      .map((entry, index) => {
        const relation =
          relationship && entry.initialPerson
            ? relationship(entry.initialPerson)
            : null;
        const depth =
          relation?.kind === 'ancestor' ? relation.path.length - 1 : -1;
        const couple = entry.people.some((person) =>
          person.partners.some((id) =>
            entry.people.some((other) => other.id === id),
          ),
        );
        return { entry, index, depth, couple };
      })
      .filter((entry) => entry.depth >= 2)
      .sort(
        (a, b) =>
          a.depth - b.depth ||
          Number(b.couple) - Number(a.couple) ||
          a.index - b.index,
      )[0]?.entry || sections[0];
  const chapters = body.sections.filter(
    (s) => s.level === 2 && s.anchor.startsWith('ch-'),
  );
  const index = chapters.findIndex((s) => s.anchor === chapterId);
  return {
    reference,
    sections,
    initialSection: initial?.section.anchor || '',
    previous: index > 0 ? chapters[index - 1] : null,
    next:
      index >= 0 && index < chapters.length - 1 ? chapters[index + 1] : null,
  };
}

/** These are recorded immediate connections, not a claim that child lists or
 * current relationships are complete. Partners never import their families. */
export function chapterFamilyContext(data: AtlasData, id: string) {
  const people = new Map(data.people.map((person) => [person.id, person]));
  const person = people.get(id);
  const members = (ids: string[]) =>
    [...new Set(ids)].flatMap((key) =>
      people.has(key) && key !== id ? [people.get(key)!] : [],
    );
  return {
    parents: members(person?.parents || []),
    partners: members(person?.partners || []),
    children: members(person?.children || []),
    siblings: members(person?.siblings || []),
  };
}

/** An edge label describes only the direction of an actual recorded link. */
export function chapterPathEdge(from: Person, to: Person) {
  if (from.parents.includes(to.id))
    return from.parentLinks.some(
      (link) => link.id === to.id && link.kind === 'adopted',
    )
      ? 'adoptive parent'
      : 'parent';
  if (to.parents.includes(from.id))
    return to.parentLinks.some(
      (link) => link.id === from.id && link.kind === 'adopted',
    )
      ? 'adopted child'
      : 'child';
  if (from.partners.includes(to.id) || to.partners.includes(from.id))
    return 'partner';
  return '';
}
