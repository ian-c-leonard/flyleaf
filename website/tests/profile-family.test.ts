import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseGedcom } from '../app/lib/gedcom.ts';
import { profileEventLabel, profileUnions } from '../app/lib/profile-family.ts';

const fixture = `0 HEAD
0 @I1@ INDI
1 REFN subject
1 NAME Recorded /Subject/
1 FAMS @F1@
1 FAMS @F2@
1 FAMS @F3@
0 @I2@ INDI
1 REFN first
1 NAME First /Spouse/
1 SEX F
0 @I3@ INDI
1 REFN later
1 NAME Later /Spouse/
0 @I4@ INDI
1 REFN partner
1 NAME Recorded /Partner/
1 SEX M
0 @I5@ INDI
1 REFN child
1 NAME Recorded /Child/
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE BEF 1983
2 NOTE A letter from a neighbour places the couple as married by this year.
1 DIV
2 DATE 22 SEP 1988
0 @F2@ FAM
1 HUSB @I1@
1 WIFE @I3@
1 MARR Y
2 NOTE A recollection from a cousin is the only account of this marriage.
0 @F3@ FAM
1 HUSB @I1@
1 WIFE @I4@
1 CHIL @I5@
0 TRLR`;

await test('marriage labels use that event’s exact family partner, never partner order', () => {
  const data = parseGedcom(fixture);
  const person = data.people.find((person) => person.id === 'subject')!;
  const marriageLabels = person.events
    .filter((event) => event.type === 'MARR')
    .map((event) => profileEventLabel(event, [...data.people].reverse()));
  assert.deepEqual(marriageLabels, [
    'Married to First Spouse',
    'Married to Later Spouse',
  ]);
  assert.equal(
    profileEventLabel(
      person.events.find((event) => event.type === 'DIV')!,
      data.people,
    ),
    'Divorced',
  );
});

await test('a missing recorded spouse remains unnamed rather than selecting another union', () => {
  const data = parseGedcom(fixture);
  const event = data.people
    .find((person) => person.id === 'subject')!
    .events.find((event) => event.type === 'MARR')!;
  assert.equal(
    profileEventLabel({ ...event, partnerId: undefined }, data.people),
    'Married',
  );
  assert.equal(
    profileEventLabel({ ...event, partnerId: 'not-published' }, data.people),
    'Married',
  );
});

await test('mixed unions separate structured marriage from a family without a marriage event', () => {
  const data = parseGedcom(fixture);
  const before = JSON.stringify(data);
  const rows = profileUnions(data, 'subject');
  assert.deepEqual(
    rows.map((row) => [row.person.id, row.married, row.role, row.summary]),
    [
      [
        'first',
        true,
        'Wife',
        'Married before 1983 · Divorced 22 September 1988',
      ],
      ['later', true, 'Spouse', 'Married'],
      ['partner', false, 'Partner', ''],
    ],
  );
  assert.deepEqual(rows[0].details, [
    'A letter from a neighbour places the couple as married by this year.',
  ]);
  assert.deepEqual(rows[1].details, [
    'A recollection from a cousin is the only account of this marriage.',
  ]);
  assert.equal(JSON.stringify(data), before);
  assert.ok(
    !rows.some((row) =>
      /current|first wife|second|biological|unmarried/i.test(row.summary),
    ),
  );
});

await test('child and single-parent families create no partner, marriage, sex or parent-kind inference', () => {
  const data = parseGedcom(fixture + '\n');
  assert.deepEqual(profileUnions(data, 'child'), []);
  const oneParent = {
    ...data,
    families: [{ ...data.families[2], parents: ['subject'] }],
  };
  assert.deepEqual(profileUnions(oneParent, 'subject'), []);
});

await test('distinct unions with the same person keep their own dates and do not borrow a marriage', () => {
  const data = parseGedcom(fixture);
  data.families[2].parents = ['subject', 'first'];
  const rows = profileUnions(data, 'subject').filter(
    (row) => row.person.id === 'first',
  );
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].familyId, rows[1].familyId);
  assert.deepEqual(
    rows.map((row) => row.married),
    [true, false],
  );
});

await test('union notes retain only exact family marriage and divorce citation placements', () => {
  const withSources = fixture
    .replace(
      '1 MARR Y',
      `1 MARR Y
2 SOUR @S1@
3 NOTE The cousin named the bride but not the year.`,
    )
    .replace(
      '0 TRLR',
      `0 @S1@ SOUR
1 TITL Cousin's recollection
0 TRLR`,
    );
  const data = parseGedcom(withSources);
  const rows = profileUnions(data, 'subject');
  assert.ok(
    rows[1].research.some((entry) =>
      entry.notes.includes('The cousin named the bride but not the year.'),
    ),
  );
  assert.ok(
    !rows[0].research.some((entry) =>
      entry.notes.some((note) => note.includes('named the bride')),
    ),
  );
  assert.ok(
    !rows[2].research.some((entry) =>
      entry.notes.some((note) => note.includes('named the bride')),
    ),
  );
  const source = data.sources.find((source) =>
    source.uses?.some((use) =>
      use.notes.includes('The cousin named the bride but not the year.'),
    ),
  )!;
  const use = source.uses![0];
  const unrelated = structuredClone(use);
  unrelated.notes = [
    'Unrelated identity qualification must not become a marriage detail.',
  ];
  unrelated.placements[0].path = [{ tag: 'SOUR', index: 0 }];
  source.uses!.push(unrelated);
  assert.ok(
    !profileUnions(data, 'subject').some((row) =>
      row.research.some((entry) => entry.notes.includes(unrelated.notes[0])),
    ),
  );
});

await test('source assessments move verbatim with their locator while substantive direct cautions stay visible', () => {
  const withSources = fixture
    .replace(
      '1 MARR Y',
      `1 MARR Y
2 SOUR @S1@
3 PAGE Recorded conversation, 2011
3 NOTE The speaker recalled the bride only by her first name.`,
    )
    .replace(
      '0 TRLR',
      `0 @S1@ SOUR
1 TITL Cousin's recollection, as retold
1 NOTE Unrelated source-record research must not become a union note.
0 TRLR`,
    );
  const data = parseGedcom(withSources);
  const before = JSON.stringify(data);
  const union = profileUnions(data, 'subject')[1];
  assert.deepEqual(union.details, [
    'A recollection from a cousin is the only account of this marriage.',
  ]);
  assert.equal(union.research.length, 1);
  assert.equal(
    union.research[0].sourceLabel,
    "Cousin's recollection, as retold",
  );
  assert.equal(union.research[0].locator, 'Recorded conversation, 2011');
  assert.deepEqual(union.research[0].notes, [
    'The speaker recalled the bride only by her first name.',
  ]);
  const source = data.sources.find(
    (source) => source.id === union.research[0].sourceId,
  )!;
  assert.ok(source.uses!.some((use) => use.id === union.research[0].useId));
  assert.ok(
    !JSON.stringify(union).includes('Unrelated source-record research'),
  );
  assert.equal(JSON.stringify(data), before);
});

await test('marriage and divorce retain their recorded place and qualified date without becoming current-status claims', () => {
  const data = parseGedcom(
    fixture
      .replace(
        '2 DATE BEF 1983',
        '2 DATE BEF 1983\n2 PLAC Recorded marriage locality',
      )
      .replace(
        '2 DATE 22 SEP 1988',
        '2 DATE 22 SEP 1988\n2 PLAC Recorded divorce locality',
      ),
  );
  const union = profileUnions(data, 'subject')[0];
  assert.equal(
    union.summary,
    'Married before 1983 · Recorded marriage locality · Divorced 22 September 1988 · Recorded divorce locality',
  );
  assert.ok(
    union.details.includes(
      'A letter from a neighbour places the couple as married by this year.',
    ),
  );
  assert.ok(!/current|still married/.test(union.summary));
});

await test('a shared citation keeps its actual union filing path without borrowing a different family', () => {
  const data = parseGedcom(
    fixture.replace('1 MARR Y', '1 MARR Y\n2 NOTE @N1@').replace(
      '0 TRLR',
      `0 @N1@ NOTE Shared union research
1 SOUR @S1@
2 PAGE Cousin's account
2 NOTE The speaker did not know the church or the day.
0 @S1@ SOUR
1 TITL Cousin's recollection
0 TRLR`,
    ),
  );
  const rows = profileUnions(data, 'subject');
  assert.deepEqual(
    rows[1].research.flatMap((entry) => entry.notes),
    ['The speaker did not know the church or the day.'],
  );
  assert.deepEqual(rows[0].research, []);
  assert.deepEqual(rows[2].research, []);
  assert.ok(
    !rows[1].details.some((note) => note.includes('Shared union research')),
  );
});

await test('literal family event cautions are preserved even outside marriage and divorce', () => {
  const data = parseGedcom(
    fixture.replace(
      '1 DIV\n2 DATE',
      '1 EVEN\n2 TYPE Recorded family circumstance\n2 NOTE This circumstance is recorded, with the family relationship unqualified.\n1 DIV\n2 DATE',
    ),
  );
  const union = profileUnions(data, 'subject')[0];
  assert.ok(
    union.details.includes(
      'This circumstance is recorded, with the family relationship unqualified.',
    ),
  );
});
