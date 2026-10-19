import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGedcom, type AtlasData } from '../app/lib/gedcom.ts';
import type {
  BookAnnotations,
  BookMention,
} from '../app/lib/book-annotations.ts';
import type { ReadingSection, WebBookBody } from '../app/lib/native-book.ts';
import type { PlaceFilter, PlaceGroup } from '../app/lib/places.ts';
import {
  listedPlaces,
  placePortraits,
  placeStories,
  placeStoryMatches,
} from '../app/lib/place-stories.ts';
import type { VisualMedia } from '../app/lib/visuals.ts';

function fixture() {
  return parseGedcom(`0 HEAD
1 _ATLAS
2 _ROOT @A@
0 @A@ INDI
1 REFN joan-penhallow
1 NAME Joan /Treloar/
2 NICK Granny Jo
1 NAME Joan /Penhallow/
0 @B@ INDI
1 NAME Beatrice /Other/
0 TRLR`);
}
function section(anchor: string, people = ['joan-penhallow']): ReadingSection {
  return {
    anchor,
    chapter: 'ch-example',
    level: 3,
    title: anchor,
    excerpt: '',
    image: '',
    people,
  };
}
function group(): PlaceGroup {
  return {
    id: 'literal-mineral-point',
    title: 'Mineral Point, Wisconsin',
    location: {
      id: 'mineral-point-wi',
      name: 'Mineral Point, Wisconsin',
      latitude: 42.86,
      longitude: -90.18,
      precision: 'locality',
      sources: [],
    },
    places: [
      {
        place: {
          id: 'literal-mineral-point',
          name: 'Mineral Point Hospital',
          latitude: null,
          longitude: null,
          precision: '',
        },
        geographic: null,
      },
    ],
    events: [],
    people: [],
    readings: [],
  };
}
function body(
  sections: ReadingSection[],
  annotations: BookAnnotations,
): WebBookBody {
  return {
    schema: 1,
    pdfSha256: 'a'.repeat(64),
    sections,
    anchors: sections.map((s) => s.anchor),
    highlights: [],
    legacyRoutes: {},
    html: '<p>Fixture</p>',
    citations: [],
    assets: [],
    annotations,
  };
}
function mention(
  id: string,
  passage: string,
  kind: BookMention['kind'],
  target: string,
  changes: Partial<BookMention> = {},
): BookMention {
  return {
    id,
    passage,
    kind,
    target,
    name: target,
    label: target,
    qualifications: [],
    ...changes,
  };
}
function addPassage(
  annotations: BookAnnotations,
  id: string,
  section: string,
  mentions: BookMention[],
  qualifications: string[] = [],
) {
  annotations.mentions.push(...mentions);
  annotations.passages.push({
    id,
    chapter: 'ch-example',
    section,
    sha256: 'b'.repeat(64),
    mentions: mentions.map((m) => m.id),
    qualifications: qualifications.map((text) => ({
      text,
      kind: 'same-passage',
    })),
  });
}

void test('direct locality mentions retain their exact sections and same-passage people; shared people alone stay related', () => {
  const data = fixture(),
    annotations: BookAnnotations = { schema: 1, passages: [], mentions: [] };
  addPassage(
    annotations,
    'P1',
    'reading-college',
    [
      mention('M1', 'P1', 'context', 'mineral-point-wi', {
        location: 'mineral-point-wi',
        label: 'Mineral Point Academy',
        qualifications: ['Town reference only, not a campus point.'],
      }),
      mention('M2', 'P1', 'person', 'joan-penhallow'),
    ],
    ['The account reports a planned post, not a completed appointment.'],
  );
  const index = body(
    [
      section('reading-college', ['joan-penhallow', 'B']),
      section('reading-other-town'),
    ],
    annotations,
  );
  const result = placeStories(data, group(), index);
  assert.deepEqual(
    result.direct.map((s) => s.section.anchor),
    ['reading-college'],
  );
  assert.deepEqual(
    result.people.map((p) => p.id),
    ['joan-penhallow'],
  );
  assert.deepEqual(result.direct[0].names, ['Mineral Point Academy']);
  assert.deepEqual(result.direct[0].passages, ['P1']);
  assert.deepEqual(result.direct[0].qualifications, [
    'Town reference only, not a campus point.',
    'The account reports a planned post, not a completed appointment.',
  ]);
  assert.deepEqual(
    result.related.map((s) => s.anchor),
    ['reading-other-town'],
  );
});
void test('literal locations and reviewed area contexts match without substituting another town, layer or passage', () => {
  const data = fixture(),
    annotations: BookAnnotations = { schema: 1, passages: [], mentions: [] };
  addPassage(annotations, 'P1', 'reading-exact', [
    mention('M1', 'P1', 'place', 'literal-mineral-point'),
    mention('M2', 'P1', 'person', 'joan-penhallow'),
  ]);
  addPassage(annotations, 'P2', 'reading-county', [
    mention('M3', 'P2', 'context', 'iowa-county', {
      location: 'iowa-county',
    }),
    mention('M4', 'P2', 'person', 'joan-penhallow'),
  ]);
  addPassage(annotations, 'P3', 'reading-wrong-link', [
    mention('M5', 'different-passage', 'context', 'mineral-point-wi', {
      location: 'mineral-point-wi',
    }),
  ]);
  const result = placeStories(
    data,
    group(),
    body(
      [
        section('reading-exact'),
        section('reading-county'),
        section('reading-wrong-link'),
      ],
      annotations,
    ),
  );
  assert.deepEqual(
    result.direct.map((s) => s.section.anchor),
    ['reading-exact'],
  );
});
void test('branch boundaries do not assign the wider section’s people to an outside passage or an unkeyed heading', () => {
  const all = fixture(),
    data = {
      ...all,
      people: all.people.filter((p) => p.id === 'joan-penhallow'),
    };
  const annotations: BookAnnotations = {
    schema: 1,
    passages: [],
    mentions: [],
  };
  addPassage(annotations, 'P1', 'reading-shared-section', [
    mention('M1', 'P1', 'context', 'mineral-point-wi', {
      location: 'mineral-point-wi',
    }),
    mention('M2', 'P1', 'person', 'B'),
  ]);
  addPassage(annotations, 'NP-H1', 'reading-heading', [
    mention('M3', 'NP-H1', 'context', 'mineral-point-wi', {
      location: 'mineral-point-wi',
    }),
  ]);
  const result = placeStories(
    data,
    group(),
    body(
      [
        section('reading-shared-section', ['joan-penhallow', 'B']),
        section('reading-heading'),
      ],
      annotations,
    ),
  );
  assert.deepEqual(
    result.direct.map((s) => s.section.anchor),
    ['reading-heading'],
  );
  assert.deepEqual(result.people, []);
  assert.deepEqual(result.direct[0].people, []);
});
void test('every direct book section remains available beyond four or five preview cards', () => {
  const data = fixture(),
    annotations: BookAnnotations = { schema: 1, passages: [], mentions: [] };
  const sections = Array.from({ length: 9 }, (_, i) =>
    section(`reading-section-${i}`),
  );
  for (const [i, s] of sections.entries())
    addPassage(annotations, `P${i}`, s.anchor, [
      mention(`M${i}`, `P${i}`, 'context', 'mineral-point-wi', {
        location: 'mineral-point-wi',
      }),
      mention(`A${i}`, `P${i}`, 'person', 'joan-penhallow'),
    ]);
  assert.deepEqual(
    placeStories(data, group(), body(sections, annotations)).direct.map(
      (s) => s.section.anchor,
    ),
    sections.map((s) => s.anchor),
  );
});
void test('checked curated reading links remain usable before the native book body opens', () => {
  const data = fixture(),
    selected = group();
  selected.readings = [
    {
      ...section('reading-curated'),
      placeConnections: [{ kind: 'work', people: [data.people[0]] }],
    },
  ];
  const result = placeStories(data, selected, null);
  assert.equal(result.direct[0].section.anchor, 'reading-curated');
  assert.equal(result.direct[0].people[0].id, 'joan-penhallow');
  assert.deepEqual(result.related, []);
});
void test('place portraits require reviewed identified subjects and preserve the actual medium', () => {
  const data: AtlasData = fixture();
  const add = (id: string, changes: Partial<VisualMedia>) => {
    const asset = {
      id,
      path: `images/${id}.jpg`,
      title: id,
      credit: '',
      rights: '',
    };
    data.assets.push(asset);
    (data.visuals ||= []).push({
      path: asset.path,
      assetId: id,
      title: id,
      content: 'photograph',
      album: 'display',
      role: 'portrait',
      avatarEligible: false,
      avatarPosition: 'top',
      qualified: false,
      subjectIds: ['joan-penhallow'],
      associatedIds: [],
      captionPeople: [],
      commemoratedIds: [],
      otherSubjects: [],
      publicNote: '',
      note: '',
      ...changes,
    });
  };
  add('association', { subjectIds: ['B'], associatedIds: ['joan-penhallow'] });
  add('qualified', { avatarEligible: true, qualified: true });
  add('painted', { avatarEligible: true, content: 'artwork' });
  const portraits = placePortraits(data, [data.people[0]]);
  assert.equal(portraits.length, 1);
  assert.equal(portraits[0].asset.id, 'painted');
  assert.equal(portraits[0].visual.content, 'artwork');
});
void test('place story search finds direct caption names and accepted relatives without indexing source instructions', () => {
  const data = fixture(),
    annotations: BookAnnotations = { schema: 1, passages: [], mentions: [] };
  addPassage(annotations, 'P1', 'reading-college', [
    mention('M1', 'P1', 'context', 'mineral-point-wi', {
      location: 'mineral-point-wi',
      label: 'Mineral Point Academy',
      qualifications: ['private-code-secret'],
    }),
    mention('M2', 'P1', 'person', 'joan-penhallow'),
  ]);
  const selected = group(),
    stories = placeStories(
      data,
      selected,
      body([section('reading-college')], annotations),
    );
  assert.ok(
    placeStoryMatches(data, selected, stories, 'Mineral Point Academy'),
  );
  assert.ok(placeStoryMatches(data, selected, stories, 'Joan Penhallow'));
  assert.ok(placeStoryMatches(data, selected, stories, 'Granny Jo'));
  assert.ok(!placeStoryMatches(data, selected, stories, 'private-code-secret'));
});

void test('a category lists only places with matching records; prose-only places appear under Everything', () => {
  const data = fixture(),
    annotations: BookAnnotations = { schema: 1, passages: [], mentions: [] };
  addPassage(annotations, 'P1', 'reading-college', [
    mention('M1', 'P1', 'context', 'mineral-point-wi', {
      location: 'mineral-point-wi',
      label: 'Mineral Point Academy',
    }),
    mention('M2', 'P1', 'person', 'joan-penhallow'),
  ]);
  const book = body([section('reading-college')], annotations);
  const joan = data.people.find((p) => p.id === 'joan-penhallow')!;
  // The same place, once named only in prose and once with a recorded home.
  const proseOnly = group();
  const home: PlaceGroup = { ...group(), id: 'with-home', people: [joan] };
  home.events = [
    {
      id: 'home',
      place: home.places[0].place,
      geographic: null,
      people: [joan],
      event: {
        id: 'home',
        type: 'RESI',
        label: 'Lived',
        date: '1900',
        year: 1900,
        place: home.places[0].place,
        detail: '',
      },
    },
  ];
  const groups = [proseOnly, home];
  const stories = new Map(
    groups.map((g) => [g.id, placeStories(data, g, book)]),
  );
  assert.ok(stories.get(proseOnly.id)!.direct.length);
  const listed = (query: string, kind: PlaceFilter) =>
    listedPlaces(data, groups, stories, query, kind).map((g) => g.id);
  for (const query of ['', 'Joan', 'Mineral Point Academy']) {
    assert.deepEqual(listed(query, 'all'), [proseOnly.id, home.id], query);
    assert.deepEqual(listed(query, 'family'), [], query);
    assert.deepEqual(listed(query, 'work'), [], query);
  }
  // Within a category, the search reads that category's records only.
  assert.deepEqual(listed('Joan', 'homes'), [home.id]);
  assert.deepEqual(listed('Mineral Point Academy', 'homes'), []);
});
