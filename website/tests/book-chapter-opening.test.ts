import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGedcom } from '../app/lib/gedcom.ts';
import {
  chapterConnections,
  chapterFamilyContext,
  chapterPathEdge,
} from '../app/lib/book-chapter-opening.ts';
import type { WebBookBody, ReadingSection } from '../app/lib/native-book.ts';
import { relationshipTo } from '../app/lib/family-browsing.ts';

const data = parseGedcom(`0 HEAD
1 _ATLAS
2 _ROOT @T@
0 @T@ INDI
1 REFN tamsin
1 NAME Tamsin /Penhallow/
1 FAMC @PARENTS@
0 @D@ INDI
1 REFN david
1 NAME David /Penhallow/
1 FAMC @GRANDPARENTS@
0 @K@ INDI
1 REFN karin
1 NAME Karin /Solberg/
0 @R@ INDI
1 REFN robert
1 NAME Robert /Penhallow/
0 @J@ INDI
1 REFN joan
1 NAME Joan /Treloar/
0 @S@ INDI
1 REFN sibling
1 NAME Jory /Penhallow/
1 FAMC @PARENTS@
0 @W@ INDI
1 REFN witness
1 NAME Unrelated /Witness/
1 ASSO @R@
2 RELA Possible identity; unproved
0 @U@ INDI
1 REFN ruth
1 NAME Ruth /Kessler/
0 @X@ INDI
1 REFN separate-child
1 NAME Separate /Household/
0 @PARENTS@ FAM
1 HUSB @D@
1 WIFE @K@
1 CHIL @T@
1 CHIL @S@
0 @GRANDPARENTS@ FAM
1 HUSB @R@
1 WIFE @J@
1 CHIL @D@
0 @OTHERUNION@ FAM
1 HUSB @D@
1 WIFE @U@
0 @SEPARATE@ FAM
1 WIFE @U@
1 CHIL @X@
0 TRLR`);
const section = (
  anchor: string,
  chapter: string,
  level: number,
  people: string[] = [],
): ReadingSection => ({
  anchor,
  chapter,
  level,
  people,
  title: anchor,
  excerpt: '',
  image: '',
});
const body: WebBookBody = {
  schema: 1,
  pdfSha256: 'a'.repeat(64),
  html: '',
  citations: [],
  assets: [],
  anchors: [],
  highlights: [],
  legacyRoutes: {},
  sections: [
    section('reading-introduction', 'reading-introduction', 2),
    section('ch-present', 'ch-present', 2),
    section('reading-present', 'ch-present', 3, ['tamsin']),
    section('ch-family', 'ch-family', 2),
    section('reading-parents', 'ch-family', 3, ['david', 'karin']),
    section('reading-joan', 'ch-family', 3, ['joan']),
    section('reading-robert-joan', 'ch-family', 3, [
      'robert',
      'joan',
      'witness',
    ]),
    section('reading-unrelated', 'ch-family', 3, ['witness']),
    section('ch-other', 'ch-other', 2),
    section('reg-ch-family', 'reg-ch-family', 2),
  ],
  annotations: {
    schema: 1,
    passages: [
      {
        id: 'heading-couple',
        chapter: 'ch-family',
        section: 'reading-robert-joan',
        sha256: 'b'.repeat(64),
        mentions: ['robert', 'joan', 'absent'],
        qualifications: [],
      },
    ],
    mentions: [
      {
        id: 'robert',
        passage: 'heading-couple',
        kind: 'person',
        target: 'robert',
        name: 'Robert',
        label: '',
        qualifications: [],
      },
      {
        id: 'joan',
        passage: 'heading-couple',
        kind: 'person',
        target: 'joan',
        name: 'Joan',
        label: '',
        qualifications: [],
      },
      {
        id: 'absent',
        passage: 'heading-couple',
        kind: 'person',
        target: 'not-in-tree',
        name: 'Missing',
        label: '',
        qualifications: [],
      },
    ],
  },
};
void test('reviewed heading people connect to Tamsin without promoting witnesses or possible identities', () => {
  const original = structuredClone(data);
  const guide = chapterConnections(
    data,
    body,
    'ch-family',
    new Map([['reading-robert-joan', 'heading-couple']]),
  );
  const couple = guide.sections.find(
    (entry) => entry.section.anchor === 'reading-robert-joan',
  )!;
  assert.deepEqual(
    couple.people.map((person) => person.id),
    ['robert', 'joan'],
  );
  assert.deepEqual(
    relationshipTo(data, couple.initialPerson, 'tamsin')?.path.map(
      (person) => person.id,
    ),
    ['tamsin', 'david', 'robert'],
  );
  assert.equal(guide.initialSection, 'reading-robert-joan');
  assert.equal(relationshipTo(data, 'witness', 'tamsin'), null);
  assert.deepEqual(data, original);
});
void test('neighbours follow narrative order, excluding front matter and registers', () => {
  const guide = chapterConnections(data, body, 'ch-family', new Map());
  assert.equal(guide.previous?.anchor, 'ch-present');
  assert.equal(guide.next?.anchor, 'ch-other');
  assert.equal(
    chapterConnections(data, body, 'ch-present', new Map()).previous,
    null,
  );
  assert.equal(
    chapterConnections(data, body, 'ch-other', new Map()).next,
    null,
  );
  assert.equal(
    chapterConnections(data, body, 'not-a-chapter', new Map()).sections.length,
    0,
  );
});
void test('immediate family stays reachable without importing a partner’s separate children', () => {
  const context = chapterFamilyContext(data, 'david');
  assert.deepEqual(
    context.parents.map((person) => person.id),
    ['robert', 'joan'],
  );
  assert.deepEqual(
    context.partners.map((person) => person.id),
    ['karin', 'ruth'],
  );
  assert.deepEqual(
    context.children.map((person) => person.id),
    ['tamsin', 'sibling'],
  );
  assert.ok(!context.children.some((person) => person.id === 'separate-child'));
  const people = new Map(data.people.map((person) => [person.id, person]));
  assert.equal(
    chapterPathEdge(people.get('tamsin')!, people.get('david')!),
    'parent',
  );
  assert.equal(
    chapterPathEdge(people.get('david')!, people.get('tamsin')!),
    'child',
  );
  assert.equal(
    chapterPathEdge(people.get('david')!, people.get('ruth')!),
    'partner',
  );
  assert.equal(
    chapterPathEdge(people.get('witness')!, people.get('robert')!),
    '',
  );
});
void test('adoptive path direction stays explicit', () => {
  const child = structuredClone(
    data.people.find((person) => person.id === 'tamsin')!,
  );
  const parent = data.people.find((person) => person.id === 'david')!;
  child.parentLinks = [{ id: parent.id, family: 'PARENTS', kind: 'adopted' }];
  assert.equal(chapterPathEdge(child, parent), 'adoptive parent');
  assert.equal(chapterPathEdge(parent, child), 'adopted child');
});
