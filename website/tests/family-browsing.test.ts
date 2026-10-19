import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPeopleSearch,
  relationshipFinder,
  relationshipTo,
} from '../app/lib/family-browsing.ts';
import { parseGedcom } from '../app/lib/gedcom.ts';

const data = parseGedcom(`0 HEAD
1 _ATLAS
2 _ROOT @TAMSIN@
0 @TAMSIN@ INDI
1 REFN tamsin
1 NAME Tamsin Ada /Penhallow/
1 SEX F
0 @DAVID@ INDI
1 REFN david-penhallow
1 NAME David Robert /Penhallow/
2 NICK Davy
1 SEX M
0 @KARIN@ INDI
1 REFN karin-otrevan
1 NAME Karin Ingrid /O'Trevan/
1 NAME Karin /Penhallow/
1 SEX F
0 @JORY@ INDI
1 NAME Jory /Penhallow/
1 SEX M
0 @JOAN@ INDI
1 REFN joan-penhallow
1 NAME Joan Mary /Treloar/
2 NICK Gran
1 NAME Joan /Penhallow/
1 SEX F
0 @ROBERT@ INDI
1 NAME Robert /Penhallow/
1 SEX M
0 @CAROL@ INDI
1 NAME Carol /Penhallow/
1 NAME Carol /Kessler/
1 SEX F
0 @WALTER@ INDI
1 NAME Walter /Kessler/
1 SEX M
0 @COUSIN@ INDI
1 NAME Paul /Kessler/
1 SEX M
0 @ADOPTED@ INDI
1 NAME Robin /Example/
1 FAMC @KESSLER@
2 PEDI adopted
0 @ARNE@ INDI
1 NAME Arne Lund /O’Trevan/
1 SEX M
0 @HILDA@ INDI
1 NAME Hilda /Berg/
1 SEX F
0 @ERIK@ INDI
1 NAME Erik Lund /O'Trevan/
1 SEX M
0 @RUTH@ INDI
1 NAME Ruth /Vogel/
1 SEX F
0 @HALF@ INDI
1 NAME Casey /Example/
1 SEX M
0 @SUSAN@ INDI
1 NAME Susan /Dahl/
1 SEX F
0 @MARGARET@ INDI
1 NAME Margaret /Hale/
1 NAME Peggy /Hale/
1 SEX F
0 @WILLIAM@ INDI
1 NAME William /Penhallow/
0 @MAY@ INDI
1 NAME May /Penhallow/
1 SEX F
0 @TOM@ INDI
1 NAME Tom /Ashby/
0 @SAM@ INDI
1 NAME Sam /Ashby/
0 @ACCENT@ INDI
1 NAME José-François /D’Amboise/
2 NICK Jo
0 @OTHER@ INDI
1 NAME Other /Penhallow/
1 ASSO @DAVID@
2 RELA Possible identity; unproved
0 @FAMILY@ FAM
1 HUSB @DAVID@
1 WIFE @KARIN@
1 CHIL @TAMSIN@
1 CHIL @JORY@
0 @PENHALLOW@ FAM
1 HUSB @ROBERT@
1 WIFE @JOAN@
1 CHIL @DAVID@
1 CHIL @CAROL@
0 @OTREVAN@ FAM
1 HUSB @ARNE@
1 WIFE @HILDA@
1 CHIL @KARIN@
1 CHIL @ERIK@
0 @KESSLER@ FAM
1 HUSB @WALTER@
1 WIFE @CAROL@
1 CHIL @COUSIN@
1 CHIL @ADOPTED@
0 @RUTH_FAMILY@ FAM
1 HUSB @DAVID@
1 WIFE @RUTH@
1 CHIL @HALF@
0 @JORY_FAMILY@ FAM
1 HUSB @JORY@
1 WIFE @SUSAN@
0 @MARGARET_FAMILY@ FAM
1 HUSB @ROBERT@
1 WIFE @MARGARET@
0 @EARLIER@ FAM
1 HUSB @WILLIAM@
1 CHIL @ROBERT@
1 CHIL @MAY@
0 @ASHBY@ FAM
1 WIFE @MAY@
1 CHIL @TOM@
0 @ASHBY_CHILD@ FAM
1 HUSB @TOM@
1 CHIL @SAM@
0 TRLR`);

const person = (id: string) =>
  data.people.find((candidate) => candidate.id === id)!;

void test('recorded collateral relationships explain cousins, aunts, uncles and removals', () => {
  assert.equal(relationshipTo(data, 'COUSIN')?.label, 'First cousin');
  assert.deepEqual(
    relationshipTo(data, 'COUSIN')?.path.map((p) => p.id),
    ['tamsin', 'david-penhallow', 'ROBERT', 'CAROL', 'COUSIN'],
  );
  assert.equal(relationshipTo(data, 'CAROL')?.label, 'Aunt');
  assert.equal(relationshipTo(data, 'ERIK')?.label, 'Uncle');
  assert.equal(relationshipTo(data, 'MAY')?.label, 'Great-aunt');
  assert.equal(relationshipTo(data, 'TOM')?.label, 'First cousin once removed');
  assert.equal(relationshipTo(data, 'SAM')?.label, 'Second cousin');
  assert.equal(relationshipTo(data, 'tamsin', 'COUSIN')?.label, 'First cousin');
});

void test('partner paths distinguish recorded family context from biological or current-marriage claims', () => {
  assert.equal(relationshipTo(data, 'WALTER')?.label, 'Aunt’s partner');
  assert.equal(relationshipTo(data, 'RUTH')?.label, 'Father’s partner');
  assert.equal(relationshipTo(data, 'SUSAN')?.label, 'Brother’s partner');
  assert.equal(
    relationshipTo(data, 'MARGARET')?.label,
    'Grandfather’s partner',
  );
  assert.equal(
    relationshipTo(data, 'RUTH', 'david-penhallow')?.label,
    'Partner',
  );
  assert.equal(
    relationshipTo(data, 'tamsin', 'ROBERT')?.label,
    'Granddaughter',
  );
  assert.equal(relationshipTo(data, 'OTHER'), null);
  assert.equal(relationshipTo(data, 'missing'), null);
});

void test('recorded marriages name spouses without inventing marriages for other unions', () => {
  const married = structuredClone(data);
  const union = married.families.find(
    (family) =>
      family.parents.includes('JORY') && family.parents.includes('SUSAN'),
  )!;
  union.events.push({
    id: 'marriage',
    type: 'MARR',
    label: 'Married',
    date: '',
    year: null,
    place: null,
    detail: '',
  });
  assert.equal(relationshipTo(married, 'SUSAN')?.label, 'Brother’s wife');
  assert.equal(relationshipTo(married, 'SUSAN', 'JORY')?.label, 'Wife');
  assert.equal(relationshipTo(married, 'JORY', 'SUSAN')?.label, 'Husband');
  assert.equal(relationshipTo(married, 'RUTH')?.label, 'Father’s partner');
  married.people.find((candidate) => candidate.id === 'SUSAN')!.sex = '';
  assert.equal(relationshipTo(married, 'SUSAN', 'JORY')?.label, 'Spouse');
  union.events.push({
    id: 'divorce',
    type: 'DIV',
    label: 'Divorced',
    date: '',
    year: null,
    place: null,
    detail: '',
  });
  assert.equal(
    relationshipTo(married, 'JORY', 'SUSAN')?.label,
    'Former husband',
  );
  assert.equal(relationshipTo(data, 'SUSAN')?.label, 'Brother’s partner');
});

void test('half-sibling and adoptive paths retain what the recorded parent links establish', () => {
  assert.equal(relationshipTo(data, 'HALF')?.label, 'Half-brother');
  const adopted = relationshipTo(data, 'ADOPTED');
  assert.equal(adopted?.kind, 'cousin');
  assert.equal(adopted?.includesAdoptiveConnection, true);
  assert.match(adopted!.label, /by adoption/);
  const oneKnownParent = parseGedcom(`0 HEAD
1 _ATLAS
2 _ROOT @A@
0 @A@ INDI
1 NAME First /Sibling/
0 @B@ INDI
1 NAME Second /Sibling/
0 @P@ INDI
1 NAME Parent /Family/
0 @F@ FAM
1 HUSB @P@
1 CHIL @A@
1 CHIL @B@
0 TRLR`);
  assert.equal(relationshipTo(oneKnownParent, 'B')?.label, 'Sibling');
});

void test('search recognises explicit recorded variants and nicknames without assigning spouse surnames', () => {
  const matches = createPeopleSearch(data);
  for (const query of ['Davy', 'Davy Penhallow', 'David Robert'])
    assert.ok(matches(person('david-penhallow'), query), query);
  for (const query of [
    'Karin Penhallow',
    'Karin O’Trevan',
    'Karin Penhallow!!!',
  ])
    assert.ok(matches(person('karin-otrevan'), query), query);
  for (const query of ['Gran', 'Joan Penhallow', 'Joan Treloar'])
    assert.ok(matches(person('joan-penhallow'), query), query);
  assert.ok(matches(person('CAROL'), 'Kessler'));
  assert.ok(matches(person('MARGARET'), 'Peggy'));
  assert.ok(!matches(person('RUTH'), 'Ruth Penhallow'));
  assert.ok(!matches(person('SUSAN'), 'Susan Penhallow'));
  assert.ok(!matches(person('OTHER'), 'Davy'));
});

void test('search handles apostrophes, accents, punctuation, spacing and supported kinship', () => {
  const matches = createPeopleSearch(data);
  for (const query of [
    'OTrevan',
    'O’Trevan',
    "O'Trevan",
    'O Trevan',
    'Lund OTrevan',
  ])
    assert.ok(matches(person('ERIK'), query), query);
  for (const query of [
    'Jose Francois DAmboise',
    'José-François D’Amboise',
    'Jo',
  ])
    assert.ok(matches(person('ACCENT'), query), query);
  assert.ok(matches(person('COUSIN'), 'cousin Kessler'));
  assert.ok(!matches(person('COUSIN'), 'uncle'));
  assert.ok(matches(person('CAROL'), 'aunt'));
  assert.ok(matches(person('tamsin'), '   '));
});

void test('cyclic pedigrees terminate without creating an unrelated kinship path', () => {
  const cycle = parseGedcom(`0 HEAD
1 _ATLAS
2 _ROOT @A@
0 @A@ INDI
1 NAME First /Cycle/
0 @B@ INDI
1 NAME Second /Cycle/
0 @U@ INDI
1 NAME Unrelated /Person/
0 @F1@ FAM
1 HUSB @A@
1 CHIL @B@
0 @F2@ FAM
1 HUSB @B@
1 CHIL @A@
0 TRLR`);
  assert.ok(relationshipTo(cycle, 'B'));
  assert.equal(relationshipTo(cycle, 'U'), null);
});

void test('a tree of 4,095 people gets every relationship and its search quickly', () => {
  // Twelve generations of ancestors, each couple married.
  const total = 4095;
  const lines = ['0 HEAD', '1 _ATLAS', '2 _ROOT @I1@'];
  for (let n = 1; n <= total; n++) {
    lines.push(`0 @I${n}@ INDI`, `1 NAME Person ${n} /Penhallow/`);
    lines.push(`1 SEX ${n % 2 ? 'F' : 'M'}`);
    if (n * 2 < total) lines.push(`1 FAMC @F${n}@`);
  }
  for (let n = 1; n * 2 < total; n++)
    lines.push(
      `0 @F${n}@ FAM`,
      `1 HUSB @I${n * 2}@`,
      `1 WIFE @I${n * 2 + 1}@`,
      `1 CHIL @I${n}@`,
      '1 MARR',
    );
  const large = parseGedcom([...lines, '0 TRLR'].join('\n'));
  assert.equal(large.people.length, total);
  const started = performance.now();
  const relationship = relationshipFinder(large, 'I1');
  const search = createPeopleSearch(large, 'I1', relationship);
  const labels = large.people.map((person) => relationship(person.id)?.label);
  const elapsed = performance.now() - started;
  // About six seconds before the indexes were shared; well under one now.
  assert.ok(elapsed < 2000, `took ${Math.round(elapsed)} ms`);
  assert.equal(labels[1], 'Father');
  assert.equal(labels[total - 1], '9× great-grandmother');
  assert.ok(search(large.people[total - 1], 'great grandmother'));
  // A finder works each relationship out once and agrees with a single lookup.
  assert.equal(relationship('I4095'), relationship('I4095'));
  assert.deepEqual(relationship('I77'), relationshipTo(large, 'I77', 'I1'));
});
