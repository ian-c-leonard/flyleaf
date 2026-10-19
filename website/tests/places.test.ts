import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseGedcom, type AtlasData } from '../app/lib/gedcom.ts';
import { branchChoices, familyFocus } from '../app/lib/branches.ts';
import {
  buildPlaceIndex,
  filterPlaces,
  selectedPlaceGroup,
  requestedPlaceSelection,
  validateGeography,
  validatePlaceReadings,
} from '../app/lib/places.ts';
import { homeRoute, readRoute, routeHref } from '../app/lib/navigation.ts';
import type { WebBook } from '../app/lib/native-book.ts';
import type { Geography, PlaceGroup, PlaceReading } from '../app/lib/places.ts';
import { contentFile } from './helpers/family-files.mjs';

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');
const data = parseGedcom(read('../public/data/family.ged'));
const geography = validateGeography(
  JSON.parse(readFileSync(contentFile('geography.json'), 'utf8')),
  data,
);
const readings = JSON.parse(
  readFileSync(contentFile('place-readings.json'), 'utf8'),
) as PlaceReading[];
const book = JSON.parse(read('../public/data/book.json')).webBook as WebBook;
const groups = buildPlaceIndex(data, geography, readings, book);

// An invented family whose places exercise grouping, branch fallback, book-only
// places and validation, independent of the current family's data.
const model = parseGedcom(`0 HEAD
1 _ATLAS
2 _ROOT @T@
0 @T@ INDI
1 REFN tamsin
1 NAME Tamsin /Penhallow/
1 FAMC @F1@
1 BIRT
2 DATE 1990
2 PLAC Dodgeville, Iowa County, Wisconsin
0 @A@ INDI
1 REFN arne
1 NAME Arne /Solberg/
1 DEAT
2 DATE 1995
2 PLAC Mineral Point Hospital, Mineral Point, Wisconsin
0 @D@ INDI
1 REFN david
1 NAME David /Penhallow/
1 FAMC @F2@
1 RESI
2 DATE 1985
2 PLAC Mineral Point, Iowa County, Wisconsin
0 @K@ INDI
1 REFN karin
1 NAME Karin /Solberg/
1 FAMC @F3@
1 OCCU Teacher
2 DATE 1988
2 PLAC Dodgeville, Iowa County, Wisconsin
0 @R@ INDI
1 REFN robert
1 NAME Robert /Penhallow/
1 BIRT
2 DATE 1920
2 PLAC Mineral Point, Iowa County, Wisconsin
0 @F1@ FAM
1 HUSB @D@
1 WIFE @K@
1 CHIL @T@
0 @F2@ FAM
1 HUSB @R@
1 CHIL @D@
0 @F3@ FAM
1 HUSB @A@
1 CHIL @K@
0 @CH@ _CHAP
1 REFN ch-penhallow
1 TITL The Penhallows
1 _SECTION mining-years
2 TITL The mining years
2 PLAC Linden, Iowa County, Wisconsin
2 _PERSON @R@
1 _SECTION farm-years
2 TITL The farm years
2 PLAC Hollandale, Iowa County, Wisconsin
2 _PERSON @A@
0 TRLR`);
const placeId = (name: string) =>
  model.places.find((place) => place.name.startsWith(name + ','))!.id;
const source = (title: string) => [
  { title, url: 'https://example.org/gazetteer' },
];
const modelGeography = validateGeography(
  {
    schema: 1,
    locations: [
      {
        id: 'mineral-point',
        name: 'Mineral Point, Wisconsin',
        latitude: 42.86,
        longitude: -90.18,
        precision: 'locality',
        sources: source('Mineral Point'),
      },
      {
        id: 'dodgeville',
        name: 'Dodgeville, Wisconsin',
        latitude: 42.96,
        longitude: -90.13,
        precision: 'locality',
        sources: source('Dodgeville'),
      },
      {
        id: 'linden',
        name: 'Linden, Wisconsin',
        latitude: 42.92,
        longitude: -90.27,
        precision: 'locality',
        sources: source('Linden'),
      },
    ],
    places: [
      [
        'Mineral Point Hospital',
        'mineral-point',
        'within-locality',
        'In the town.',
      ],
      ['Mineral Point', 'mineral-point', 'same-locality', ''],
      ['Dodgeville', 'dodgeville', 'same-locality', ''],
      ['Linden', 'linden', 'same-locality', ''],
      ['Hollandale', null, 'unlocated', 'The farm is not located.'],
    ].map(([name, location, relation, note]) => ({
      id: placeId(name!),
      name: model.places.find((place) => place.id === placeId(name!))!.name,
      location,
      relation,
      note,
    })),
  },
  model,
);
const modelBook = {
  sections: [
    {
      anchor: 'reading-mining-years',
      chapter: 'ch-penhallow',
      level: 3,
      title: 'The mining years',
      excerpt: '',
      image: '',
      people: ['robert'],
    },
    {
      anchor: 'reading-farm-years',
      chapter: 'ch-penhallow',
      level: 3,
      title: 'The farm years',
      excerpt: '',
      image: '',
      people: ['arne', 'karin'],
    },
  ],
} as WebBook;
const modelReadings: PlaceReading[] = [
  {
    place: placeId('Linden'),
    kind: 'work',
    anchor: 'reading-mining-years',
    people: ['robert'],
    witness: 'Robert worked at the Linden mine.',
  },
  {
    place: placeId('Hollandale'),
    kind: 'homes',
    anchor: 'reading-farm-years',
    people: ['arne', 'karin'],
    witness: 'The family farmed near Hollandale.',
  },
];
const modelGroups = buildPlaceIndex(
  model,
  modelGeography,
  modelReadings,
  modelBook,
);

/** Each branch's place groups still select the full edition's group by its id,
 * including through a reviewed location when the first literal name is gone.
 * Returns how many selections went through a location. */
function checkBranchSelections(
  data: AtlasData,
  geography: Geography,
  readings: PlaceReading[],
  book: WebBook,
  groups: PlaceGroup[],
) {
  let aliasesChecked = 0;
  for (const branch of branchChoices(data).flatMap((choice) => [
    choice.person,
    ...choice.grandparents,
  ])) {
    const focused = familyFocus(data, branch.id).data;
    const local = buildPlaceIndex(focused, geography, readings, book);
    for (const group of groups) {
      if (!group.location) continue;
      const match = local.find(
        (candidate) => candidate.location?.id === group.location!.id,
      );
      if (!match) continue;
      assert.equal(selectedPlaceGroup(local, group.id, geography), match);
      assert.ok(
        match.people.every((person) =>
          focused.people.some((p) => p.id === person.id),
        ),
      );
      if (!match.places.some((p) => p.place.id === group.id)) aliasesChecked++;
    }
  }
  return aliasesChecked;
}

void test('an exact Book place opens outside every branch without importing other places into its index', () => {
  const branches = branchChoices(data).flatMap((choice) => [
    choice.person,
    ...choice.grandparents,
  ]);
  let outside = 0;
  for (const branch of branches) {
    const focused = buildPlaceIndex(
      familyFocus(data, branch.id).data,
      geography,
      readings,
      book,
    );
    const before = JSON.stringify(focused);
    for (const place of data.places) {
      const result = requestedPlaceSelection(
        focused,
        groups,
        place.id,
        geography,
      );
      assert.ok(result.selected?.places.some((p) => p.place.id === place.id));
      const local = focused.find((g) =>
        g.places.some((p) => p.place.id === place.id),
      );
      assert.equal(result.outsideBranch, !local);
      assert.equal(
        result.selected,
        local ||
          groups.find((g) => g.places.some((p) => p.place.id === place.id)),
      );
      if (result.outsideBranch) outside++;
    }
    assert.equal(JSON.stringify(focused), before);
  }
  assert.ok(outside > 0);
});

void test('outside-branch fallback never substitutes a nearby literal or invents an unknown destination', () => {
  const full = modelGroups.find((group) => group.places.length > 1)!;
  const requested = full.places[1].place.id;
  const partial = { ...full, places: [full.places[0]], people: [] };
  const selected = requestedPlaceSelection(
    [partial],
    modelGroups,
    requested,
    modelGeography,
  );
  assert.equal(selected.selected, full);
  assert.equal(selected.outsideBranch, true);
  assert.equal(
    requestedPlaceSelection([partial], modelGroups, 'missing', modelGeography)
      .selected,
    null,
  );
});

void test('every actual person/event use survives grouping with its exact wording and identity', () => {
  const key = (
    person: string,
    event: {
      id: string;
      type: string;
      label: string;
      date: string;
      detail: string;
      place: { id: string; name: string } | null;
    },
  ) =>
    JSON.stringify([
      person,
      event.id,
      event.type,
      event.label,
      event.date,
      event.detail,
      event.place?.id,
      event.place?.name,
    ]);
  const original = data.people
    .flatMap((person) =>
      person.events
        .filter((event) => event.place)
        .map((event) => key(person.id, event)),
    )
    .sort();
  const displayed = groups
    .flatMap((group) =>
      group.events.flatMap((entry) =>
        entry.people.map((person) => key(person.id, entry.event)),
      ),
    )
    .sort();
  assert.deepEqual(displayed, original);
  const places = new Set(
    groups.flatMap((group) => group.places.map((p) => p.place.id)),
  );
  assert.equal(places.size, data.places.length);
});

void test('shared family events count once while distinct records with similar wording remain separate', () => {
  const model = parseGedcom(`0 HEAD
0 @I1@ INDI
1 NAME Ada /Example/
1 REFN ada
1 CENS
2 DATE ABT 1900
2 PLAC Town, Country
1 CENS
2 DATE ABT 1900
2 PLAC Town, Country
1 FAMS @F1@
0 @I2@ INDI
1 NAME Ben /Example/
1 REFN ben
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I1@
1 MARR
2 DATE BET 1890 AND 1892
2 PLAC Town, Country
0 TRLR`);
  const index = buildPlaceIndex(model, {
    schema: 1,
    locations: [],
    places: [],
  });
  assert.equal(index.length, 1);
  const marriages = index[0].events.filter(
    (entry) => entry.event.type === 'MARR',
  );
  assert.equal(marriages.length, 1);
  assert.equal(marriages[0].people.length, 2);
  assert.equal(marriages[0].event.date, 'BET 1890 AND 1892');
  assert.equal(
    index[0].events.filter((entry) => entry.event.type === 'CENS').length,
    2,
  );
});

void test('a selected geographic group survives every half/quarter even if its first literal name disappears', () => {
  checkBranchSelections(data, geography, readings, book, groups);
  assert.ok(
    checkBranchSelections(
      model,
      modelGeography,
      modelReadings,
      modelBook,
      modelGroups,
    ) > 0,
    'the branches exercise alias-only selections as well as complete place groups',
  );
});

void test('book-only places retain their actual people and chapter without inventing events', () => {
  validatePlaceReadings(modelReadings, model, modelBook);
  const linden = selectedPlaceGroup(
    modelGroups,
    placeId('Linden'),
    modelGeography,
  )!;
  assert.equal(linden.events.length, 0);
  assert.deepEqual(
    linden.people.map((person) => person.id),
    ['robert'],
  );
  assert.deepEqual(
    linden.readings.map((section) => section.anchor),
    ['reading-mining-years'],
  );
  const hollandale = selectedPlaceGroup(
    modelGroups,
    placeId('Hollandale'),
    modelGeography,
  )!;
  assert.equal(hollandale.location, null);
  assert.equal(hollandale.events.length, 0);
  assert.deepEqual(hollandale.people.map((person) => person.id).sort(), [
    'arne',
    'karin',
  ]);
  assert.ok(
    filterPlaces(modelGroups, 'Hollandale', 'all').includes(hollandale),
  );
  assert.ok(
    filterPlaces(modelGroups, 'Hollandale', 'homes').includes(hollandale),
  );
  assert.ok(filterPlaces(modelGroups, 'Robert', 'work').includes(linden));
  assert.ok(
    !filterPlaces(modelGroups, 'Hollandale', 'work').includes(hollandale),
  );
  assert.ok(!filterPlaces(modelGroups, 'Karin', 'work').includes(linden));
});

void test('place, search, filter and branch round-trip through actual route parsing', () => {
  const route = {
    ...homeRoute,
    view: 'places' as const,
    branch: 'karin',
    place: placeId('Dodgeville'),
    placeQuery: 'Dodgeville 1988',
    placeKind: 'family' as const,
  };
  const restored = readRoute(routeHref(route), model, modelBook);
  for (const key of [
    'view',
    'branch',
    'place',
    'placeQuery',
    'placeKind',
  ] as const)
    assert.equal(restored[key], route[key]);
  assert.equal(
    readRoute('#view=places&placeKind=constructor', model).placeKind,
    'all',
  );
  assert.equal(readRoute('#view=places&place=missing', model).place, '');
  assert.equal(
    readRoute('#placeQuery=' + 'a'.repeat(300), model).placeQuery.length,
    120,
  );
});

void test('geographic names, completeness, point ranges and sources are required before publication', () => {
  for (const mutate of [
    (copy: Geography) => {
      copy.places[0].name += ' changed';
    },
    (copy: Geography) => {
      copy.places.pop();
    },
    (copy: Geography) => {
      copy.places.push(copy.places[0]);
    },
    (copy: Geography) => {
      copy.locations[0].latitude = 100;
    },
    (copy: Geography) => {
      copy.locations[0].sources = [];
    },
    (copy: Geography) => {
      copy.locations[0].sources[0].url = 'javascript:alert(1)';
    },
  ]) {
    const copy = structuredClone(modelGeography);
    mutate(copy);
    assert.throws(() => validateGeography(copy, model));
  }
  const wrongPeople = structuredClone(modelReadings);
  wrongPeople[0].people = ['tamsin'];
  assert.throws(() => validatePlaceReadings(wrongPeople, model, modelBook));
});
