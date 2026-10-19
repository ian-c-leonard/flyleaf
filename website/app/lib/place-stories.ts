import type { Asset, AtlasData, Person } from './gedcom.ts';
import type { BookMention } from './book-annotations.ts';
import type { ReadingSection, WebBookBody } from './native-book.ts';
import { filterPlaces, type PlaceFilter, type PlaceGroup } from './places.ts';
import { identifiedPortrait, visualFor, type VisualMedia } from './visuals.ts';
import { createPeopleSearch, relationshipFinder } from './family-browsing.ts';

export interface PlaceStory {
  section: ReadingSection;
  people: Person[];
  names: string[];
  passages: string[];
  qualifications: string[];
}
export interface PlaceStories {
  direct: PlaceStory[];
  related: ReadingSection[];
  people: Person[];
}

/** The caller supplies the verified native book body. A person appearing in
 * another account is not evidence that its places belong to this locality. */
export function placeStories(
  data: AtlasData,
  group: PlaceGroup,
  book: WebBookBody | null,
): PlaceStories {
  const byPerson = new Map(data.people.map((person) => [person.id, person]));
  const direct = new Map<string, PlaceStory>();
  for (const reading of group.readings) {
    direct.set(reading.anchor, {
      section: reading,
      people: [
        ...new Map(
          reading.placeConnections
            .flatMap((connection) => connection.people)
            .map((person) => [person.id, person]),
        ).values(),
      ],
      names: [],
      passages: [],
      qualifications: [],
    });
  }
  const placeIds = new Set(group.places.map(({ place }) => place.id));
  const matches = (mention: BookMention) =>
    mention.kind !== 'person' &&
    (placeIds.has(mention.target) ||
      (!!group.location && mention.location === group.location.id));
  const mentions = new Map(
    book?.annotations?.mentions.map((mention) => [mention.id, mention]) || [],
  );
  const sections = new Map(
    book?.sections.map((section) => [section.anchor, section]) || [],
  );
  for (const passage of book?.annotations?.passages || []) {
    const passageMentions = passage.mentions.flatMap((id) => {
      const mention = mentions.get(id);
      return mention && mention.passage === passage.id ? [mention] : [];
    });
    const located = passageMentions.filter(matches);
    const section = sections.get(passage.section);
    if (!located.length || !section) continue;
    const personIds = [
      ...new Set(
        passageMentions
          .filter((mention) => mention.kind === 'person')
          .map((mention) => mention.target),
      ),
    ];
    const people = personIds.flatMap((id) => {
      const person = byPerson.get(id);
      return person ? [person] : [];
    });
    // The complete book is shared across branches. A heading/caption without
    // person mentions can follow its section's scope, but cannot assign those
    // section-level people to a place or infer a new life event.
    if (
      (!people.length && personIds.length) ||
      (!people.length && !section.people.some((id) => byPerson.has(id)))
    )
      continue;
    const story = direct.get(section.anchor) || {
      section,
      people: [],
      names: [],
      passages: [],
      qualifications: [],
    };
    story.people = [
      ...new Map(
        [...story.people, ...people].map((person) => [person.id, person]),
      ).values(),
    ];
    story.names = [
      ...new Set([...story.names, ...located.map((m) => m.label)]),
    ];
    story.passages.push(passage.id);
    story.qualifications = [
      ...new Set([
        ...story.qualifications,
        ...located.flatMap((mention) => mention.qualifications),
        ...passage.qualifications.map((qualification) => qualification.text),
      ]),
    ];
    direct.set(section.anchor, story);
  }
  const people = [
    ...new Map(
      [...direct.values()]
        .flatMap((story) => story.people)
        .map((person) => [person.id, person]),
    ).values(),
  ];
  const relevant = new Set([
    ...people.map((person) => person.id),
    ...group.people.map((person) => person.id),
  ]);
  const order = new Map(
    book?.sections.map((section, index) => [section.anchor, index]) || [],
  );
  return {
    direct: [...direct.values()].sort(
      (a, b) =>
        (order.get(a.section.anchor) ?? Infinity) -
          (order.get(b.section.anchor) ?? Infinity) ||
        a.section.title.localeCompare(b.section.title),
    ),
    related: (book?.sections || []).filter(
      (section) =>
        !direct.has(section.anchor) &&
        section.chapter.startsWith('ch-') &&
        section.level === 3 &&
        section.people.some((id) => relevant.has(id)),
    ),
    people,
  };
}

/** Recognition pictures of explicitly identified people, not a claim that
 * these photographs were taken at the selected place. Every picture has the
 * same reviewed subject/medium as its profile portrait. */
export function placePortraits(
  data: AtlasData,
  people: Person[],
): { asset: Asset; visual: VisualMedia }[] {
  const found = new Map<string, { asset: Asset; visual: VisualMedia }>();
  for (const person of people) {
    const asset = identifiedPortrait(data, person.id);
    const visual = asset ? visualFor(data, asset.path) : null;
    if (asset && visual) found.set(asset.id, { asset, visual });
  }
  const relationship = relationshipFinder(data);
  const distance = new Map(
    people.map((person) => [
      person.id,
      relationship(person.id)?.path.length ?? Infinity,
    ]),
  );
  return [...found.values()].sort(
    (a, b) =>
      Math.min(
        ...a.visual.subjectIds.map((id) => distance.get(id) ?? Infinity),
      ) -
        Math.min(
          ...b.visual.subjectIds.map((id) => distance.get(id) ?? Infinity),
        ) || a.visual.title.localeCompare(b.visual.title),
  );
}

const searchIndexes = new WeakMap<
  AtlasData,
  ReturnType<typeof createPeopleSearch>
>();
export function placeStoryMatches(
  data: AtlasData,
  group: PlaceGroup,
  stories: PlaceStories,
  query: string,
) {
  const normal = (text: string) =>
    text
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/['’]/g, '')
      .toLocaleLowerCase();
  const terms = normal(query.trim()).split(/\s+/).filter(Boolean);
  const text = normal(
    [
      group.title,
      ...group.places.map(({ place }) => place.name),
      ...stories.direct.flatMap((story) => [
        story.section.title,
        ...story.names,
        ...story.people.flatMap((person) => [
          person.name,
          ...(person.nameVariants || []),
        ]),
      ]),
    ].join(' '),
  );
  if (terms.every((term) => text.includes(term))) return true;
  let matchesPerson = searchIndexes.get(data);
  if (!matchesPerson) {
    matchesPerson = createPeopleSearch(data);
    searchIndexes.set(data, matchesPerson);
  }
  return stories.people.some((person) => matchesPerson!(person, query));
}

/** The places listed for a search and a category. Recorded events and the
 * book links classified as homes, work or family follow the category. A
 * place found only in the book's prose has no category, so it is listed only
 * under "Everything". */
export function listedPlaces(
  data: AtlasData,
  groups: PlaceGroup[],
  stories: ReadonlyMap<string, PlaceStories>,
  query: string,
  kind: PlaceFilter,
) {
  const recorded = new Set(
    filterPlaces(groups, query, kind).map((group) => group.id),
  );
  return groups.filter((group) => {
    if (recorded.has(group.id)) return true;
    const found = stories.get(group.id);
    return (
      kind === 'all' &&
      !!found?.direct.length &&
      placeStoryMatches(data, group, found, query)
    );
  });
}
