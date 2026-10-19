import type { AtlasData, LifeEvent, Person, Place } from './gedcom.ts';
import type { ReadingSection, WebBook } from './native-book.ts';

export type PlaceReading = {
  place: string;
  kind: Exclude<PlaceFilter, 'all'>;
  anchor: string;
  people: string[];
  witness: string;
  requiredContext?: string[];
};

export type GeographicLocation = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  precision: 'locality' | 'county' | 'region' | 'country';
  sources: { title: string; url: string; locator?: string }[];
};
export type PlaceRelation =
  | 'same-locality'
  | 'within-locality'
  | 'historical-context'
  | 'uncertain'
  | 'unlocated';
export type GeographicPlace = {
  id: string;
  name: string;
  location: string | null;
  relation: PlaceRelation;
  note: string;
};
export type Geography = {
  schema: 1;
  attributions?: { text: string; url: string }[];
  locations: GeographicLocation[];
  places: GeographicPlace[];
};
export const placeFilters = {
  all: 'Everything',
  homes: 'Homes',
  family: 'Births, marriages and deaths',
  work: 'Work and school',
} as const;
export type PlaceFilter = keyof typeof placeFilters;
export type PlaceEvent = {
  id: string;
  event: LifeEvent;
  place: Place;
  people: Person[];
  geographic: GeographicPlace | null;
};
export type PlaceGroup = {
  id: string;
  title: string;
  location: GeographicLocation | null;
  places: { place: Place; geographic: GeographicPlace | null }[];
  events: PlaceEvent[];
  people: Person[];
  readings: (ReadingSection & {
    placeConnections: { kind: Exclude<PlaceFilter, 'all'>; people: Person[] }[];
  })[];
};

/** Geography describes display context only. It never rewrites a GEDCOM place. */
export function validateGeography(value: unknown, data: AtlasData): Geography {
  const geo = value as Geography;
  if (
    geo?.schema !== 1 ||
    !Array.isArray(geo.locations) ||
    !Array.isArray(geo.places)
  )
    throw new Error('The geographic index is not a supported edition.');
  if (
    geo.attributions &&
    (!Array.isArray(geo.attributions) ||
      geo.attributions.some(
        (a) =>
          !a ||
          typeof a.text !== 'string' ||
          !a.text.trim() ||
          typeof a.url !== 'string' ||
          !/^https:\/\/[^\s]+$/.test(a.url),
      ))
  )
    throw new Error('The geographic attribution is malformed.');
  const locations = new Set<string>();
  for (const location of geo.locations) {
    if (
      !location ||
      !/^[a-z0-9-]+$/.test(location.id) ||
      locations.has(location.id) ||
      typeof location.name !== 'string' ||
      !location.name.trim() ||
      !Number.isFinite(location.latitude) ||
      Math.abs(location.latitude) > 85 ||
      !Number.isFinite(location.longitude) ||
      Math.abs(location.longitude) > 180 ||
      !['locality', 'county', 'region', 'country'].includes(
        location.precision,
      ) ||
      !Array.isArray(location.sources) ||
      !location.sources.length ||
      location.sources.some(
        (source) =>
          !source ||
          typeof source.title !== 'string' ||
          !source.title.trim() ||
          typeof source.url !== 'string' ||
          !/^https:\/\/[^\s]+$/.test(source.url),
      )
    )
      throw new Error(
        'A geographic reference lacks a valid identity, point or source.',
      );
    locations.add(location.id);
  }
  const recorded = new Map(data.places.map((place) => [place.id, place.name]));
  // A family that has not started its map yet: every place is off the map.
  // Once the index lists any place, it must account for all of them.
  if (!geo.places.length)
    return {
      ...geo,
      places: [...recorded].map(([id, name]) => ({
        id,
        name,
        location: null,
        relation: 'unlocated',
        note: '',
      })),
    };
  const seen = new Set<string>();
  for (const place of geo.places) {
    if (
      !place ||
      seen.has(place.id) ||
      recorded.get(place.id) !== place.name ||
      ![
        'same-locality',
        'within-locality',
        'historical-context',
        'uncertain',
        'unlocated',
      ].includes(place.relation) ||
      typeof place.note !== 'string' ||
      (place.location !== null && !locations.has(place.location)) ||
      (place.relation === 'unlocated' && place.location !== null) ||
      (place.relation !== 'unlocated' && place.location === null) ||
      (place.relation !== 'same-locality' && !place.note.trim())
    )
      throw new Error(
        'A geographic association does not match its recorded place.',
      );
    seen.add(place.id);
  }
  if (seen.size !== recorded.size)
    throw new Error(
      'The geographic index does not account for every recorded place.',
    );
  return geo;
}

export function validatePlaceReadings(
  readings: PlaceReading[],
  data: AtlasData,
  book: WebBook,
) {
  const seen = new Set<string>();
  for (const reading of readings) {
    const key = `${reading.place}:${reading.anchor}`;
    const section = book.sections.find(
      (section) => section.anchor === reading.anchor,
    );
    if (
      seen.has(key) ||
      !data.places.some((place) => place.id === reading.place) ||
      !section ||
      !Array.isArray(reading.people) ||
      !reading.people.length ||
      new Set(reading.people).size !== reading.people.length ||
      reading.people.some(
        (id) =>
          !data.people.some((person) => person.id === id) ||
          !section.people.includes(id),
      ) ||
      !['homes', 'work', 'family'].includes(reading.kind) ||
      typeof reading.witness !== 'string' ||
      !reading.witness.trim() ||
      (reading.requiredContext !== undefined &&
        (!Array.isArray(reading.requiredContext) ||
          !reading.requiredContext.length ||
          reading.requiredContext.some(
            (text) => typeof text !== 'string' || !text.trim(),
          )))
    )
      throw new Error(
        'A book/place connection lacks its place, passage, people or literal witness.',
      );
    seen.add(key);
  }
}

export function buildPlaceIndex(
  data: AtlasData,
  geography: Geography,
  readings: PlaceReading[] = [],
  book: WebBook | null = null,
): PlaceGroup[] {
  const annotations = new Map(
    geography.places.map((place) => [place.id, place]),
  );
  const locations = new Map(
    geography.locations.map((location) => [location.id, location]),
  );
  const groups = new Map<string, PlaceGroup>();
  const byPlace = new Map<string, PlaceGroup>();
  for (const place of data.places) {
    const annotation = annotations.get(place.id);
    // A changed name cannot inherit a previously reviewed point at runtime.
    const geographic = annotation?.name === place.name ? annotation : null;
    const location = geographic?.location
      ? locations.get(geographic.location) || null
      : null;
    const key = location ? `location:${location.id}` : `place:${place.id}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        id: place.id,
        title: location?.name || place.name,
        location,
        places: [],
        events: [],
        people: [],
        readings: [],
      };
      groups.set(key, group);
    }
    group.places.push({ place, geographic });
    byPlace.set(place.id, group);
  }
  for (const person of data.people) {
    for (const event of person.events) {
      const group = event.place ? byPlace.get(event.place.id) : null;
      if (!group || !event.place) continue;
      // Shared family events use the same GEDCOM event identity. Date or place
      // similarity alone is never enough to merge two recorded events.
      let entry = group.events.find(
        (candidate) =>
          candidate.id === event.id &&
          candidate.place.id === event.place!.id &&
          candidate.event.type === event.type &&
          candidate.event.label === event.label &&
          candidate.event.date === event.date &&
          candidate.event.detail === event.detail,
      );
      if (!entry) {
        entry = {
          id: event.id,
          event,
          place: event.place,
          people: [],
          geographic:
            group.places.find((p) => p.place.id === event.place!.id)
              ?.geographic || null,
        };
        group.events.push(entry);
      }
      if (!entry.people.some((p) => p.id === person.id))
        entry.people.push(person);
      if (!group.people.some((p) => p.id === person.id))
        group.people.push(person);
    }
  }
  for (const reading of readings) {
    const group = byPlace.get(reading.place);
    const section = book?.sections.find(
      (section) => section.anchor === reading.anchor,
    );
    const people = data.people.filter((person) =>
      reading.people.includes(person.id),
    );
    if (!group || !section || !people.length) continue;
    let passage = group.readings.find(
      (previous) => previous.anchor === section.anchor,
    );
    if (!passage) {
      passage = { ...section, placeConnections: [] };
      group.readings.push(passage);
    }
    passage.placeConnections.push({ kind: reading.kind, people });
    for (const person of people)
      if (!group.people.some((p) => p.id === person.id))
        group.people.push(person);
  }
  for (const group of groups.values()) {
    group.places.sort((a, b) => a.place.name.localeCompare(b.place.name));
    group.events.sort(
      (a, b) =>
        (a.event.year ?? Infinity) - (b.event.year ?? Infinity) ||
        a.event.date.localeCompare(b.event.date) ||
        a.id.localeCompare(b.id),
    );
    group.people.sort((a, b) => a.name.localeCompare(b.name));
  }
  return [...groups.values()]
    .filter((group) => group.events.length || group.readings.length)
    .sort(
      (a, b) =>
        b.people.length - a.people.length ||
        b.events.length - a.events.length ||
        a.title.localeCompare(b.title),
    );
}

export function eventMatches(event: LifeEvent, filter: PlaceFilter) {
  if (filter === 'all') return true;
  if (filter === 'homes')
    return ['RESI', 'CENS', 'EMIG', 'IMMI', 'NATU'].includes(event.type);
  if (filter === 'work')
    return ['EDUC', 'GRAD', 'OCCU', 'RETI', 'MILI'].includes(event.type);
  return [
    'BIRT',
    'BAPM',
    'CHR',
    'MARR',
    'DIV',
    'DEAT',
    'BURI',
    'ADOP',
  ].includes(event.type);
}

export function selectedPlaceGroup(
  groups: PlaceGroup[],
  placeId: string,
  geography: Geography,
) {
  const direct = groups.find((group) =>
    group.places.some((p) => p.place.id === placeId),
  );
  if (direct) return direct;
  // The route selected a display group through a literal name in the previous
  // branch. Preserve the reviewed geographic context without importing its people.
  const location = geography.places.find(
    (place) => place.id === placeId,
  )?.location;
  return location
    ? groups.find((group) => group.location?.id === location) || null
    : null;
}

/** An explicit Book destination remains reachable without resetting the branch. */
export function requestedPlaceSelection(
  groups: PlaceGroup[],
  allGroups: PlaceGroup[],
  placeId: string,
  geography: Geography,
) {
  const exact = (choices: PlaceGroup[]) =>
    choices.find((group) => group.places.some((p) => p.place.id === placeId));
  const withinBranch = exact(groups);
  if (withinBranch) return { selected: withinBranch, outsideBranch: false };
  const fullEdition = exact(allGroups);
  if (fullEdition) return { selected: fullEdition, outsideBranch: true };
  return {
    selected: selectedPlaceGroup(groups, placeId, geography),
    outsideBranch: false,
  };
}

const normalized = (value: string) =>
  value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
export function filterPlaces(
  groups: PlaceGroup[],
  query: string,
  kind: PlaceFilter,
) {
  const terms = normalized(query.trim()).split(/\s+/).filter(Boolean);
  return groups.filter((group) => {
    const events = group.events.filter((entry) =>
      eventMatches(entry.event, kind),
    );
    const readings = group.readings.filter(
      (section) =>
        kind === 'all' ||
        section.placeConnections.some((connection) => connection.kind === kind),
    );
    const text = normalized(
      [
        group.title,
        ...group.places.map((p) => p.place.name),
        ...events.flatMap((entry) => [
          entry.event.date,
          entry.event.label,
          entry.event.detail,
          ...entry.people.map((person) => person.name),
        ]),
        ...readings.flatMap((section) => [
          section.title,
          ...section.placeConnections
            .filter((connection) => kind === 'all' || connection.kind === kind)
            .flatMap((connection) =>
              connection.people.map((person) => person.name),
            ),
        ]),
      ].join(' '),
    );
    return (
      (events.length > 0 || readings.length > 0) &&
      terms.every((term) => text.includes(term))
    );
  });
}

export function placePeriod(group: PlaceGroup) {
  const years = group.events
    .map((entry) => entry.event.year)
    .filter((year): year is number => year !== null);
  if (!years.length) return group.events.length ? '' : 'Named in the book';
  const first = Math.min(...years),
    last = Math.max(...years);
  // An overview of recorded years; individual entries retain ABT/BEF/ranges.
  return first === last ? `${first}` : `${first}–${last}`;
}
