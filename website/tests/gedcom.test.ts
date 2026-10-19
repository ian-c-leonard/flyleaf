import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const fixture = `0 HEAD
1 CHAR UTF-8
1 _ATLAS
2 NAME The Rivera family
2 _ROOT @I2@
0 @I1@ INDI
1 NAME Elena /Rivera/
1 REFN elena
1 SEX F
1 BIRT
2 DATE ABT 1880
2 PLAC Cádiz, Spain
3 MAP
4 LATI N36.53
4 LONG W6.29
1 FAMS @F1@
1 _NARRATIVE Elena taught at the village school.
2 CONT Her daughter kept the photograph.
1 OBJE @O1@
0 @I2@ INDI
1 NAME Rosa /Rivera/
1 REFN rosa
1 FAMC @F1@
1 NOTE Internal research: TODO do not publish this as biography.
0 @F1@ FAM
1 WIFE @I1@
1 CHIL @I2@
1 MARR
2 DATE BET 1900 AND 1902
2 PLAC Cádiz
0 @O1@ OBJE
1 FILE images/school.jpg
2 FORM jpg
1 TITL At the school
1 _CREDIT Family collection
0 @C1@ _CHAP
1 TITL A school by the sea
1 _ORDER 1
1 _SECTION school
2 TITL Elena's classroom
2 DATE 1900
2 NOTE Elena taught here.
3 CONT Rosa kept this picture.
2 _PERSON @I1@
2 OBJE @O1@
2 PLAC Cádiz, Spain
3 MAP
4 LATI N36.53
4 LONG W6.29
0 TRLR
`;

async function parser() {
  assert.ok(
    existsSync(new URL('../app/lib/gedcom.ts', import.meta.url)),
    'Generic GEDCOM parser has not been implemented',
  );
  return import('../app/lib/gedcom.ts');
}

void test('recorded alternate names and nicknames remain searchable without changing the primary name', async () => {
  const { parseGedcom } = await parser();
  const data = parseGedcom(
    `0 HEAD\n0 @I1@ INDI\n1 NAME Joan /Treloar/\n2 NICK Granny Jo\n1 NAME Joan /Penhallow/\n1 NICK Nana\n0 TRLR\n`,
  );
  assert.equal(data.people[0].name, 'Joan Treloar');
  assert.deepEqual(data.people[0].nameVariants, [
    'Joan Treloar',
    'Granny Jo',
    'Joan Penhallow',
    'Nana',
  ]);
});

void test('a name written with no space before the surname reads as separate words', async () => {
  const { parseGedcom } = await parser();
  // PAF wrote "Mary/Windsor/"; the slashes mark the surname and part the words.
  const data = parseGedcom(
    `0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Elizabeth Alexandra Mary/Windsor/\n0 TRLR\n`,
  );
  assert.equal(data.people[0].name, 'Elizabeth Alexandra Mary Windsor');
  assert.equal(data.people[0].surname, 'Windsor');
});

void test('lifespans distinguish uncertain event years from the span of a life', async () => {
  const { parseGedcom, lifespan } = await parser();
  const cases = [
    ['BET 21 APR 1878 AND 22 APR 1878', '3 NOV 1951', '1878–1951'],
    ['BET 1863 AND 1867', '1949', 'Born 1863–1867; died 1949'],
    ['1842', 'BET 1905 AND 1906', 'Born 1842; died 1905–1906'],
    [
      'BET 1863 AND 1867',
      'BET 1948 AND 1949',
      'Born 1863–1867; died 1948–1949',
    ],
    ['FROM 1799 TO 1801', '1860', 'Born 1799–1801; died 1860'],
    ['ABT 1800', 'BEF 1870', 'about 1800–before 1870'],
  ];
  for (const [birth, death, expected] of cases) {
    const data = parseGedcom(
      `0 HEAD\n0 @I1@ INDI\n1 NAME Reader /Family/\n1 BIRT\n2 DATE ${birth}\n1 DEAT\n2 DATE ${death}\n0 TRLR\n`,
    );
    const person = data.people[0];
    assert.equal(lifespan(person), expected);
    assert.equal(
      person.events.find((event) => event.type === 'BIRT')?.date,
      birth,
      'Display must not narrow the recorded birth date',
    );
    assert.equal(
      person.events.find((event) => event.type === 'DEAT')?.date,
      death,
      'Display must not narrow the recorded death date',
    );
  }
});

void test('later source and file qualifications survive repeated and shared notes', async () => {
  const { parseGedcom } = await parser();
  const text = `0 HEAD
0 @I1@ INDI
1 NAME Reader /Family/
1 SOUR @S1@
2 PAGE p. 7
1 OBJE @O1@
0 @S1@ SOUR
1 TITL School yearbook
1 NOTE The class roster names the relative.
2 CONT The photograph has no individual key.
1 NOTE @N1@
1 NOTE Preserve the complete printed caption.
1 OBJE
2 FILE images/class.jpg
3 NOTE File assessment one.
3 NOTE @N1@
1 _ARCHIVE images/cover.jpg
2 NOTE This is the cover.
2 NOTE The volume date does not date its photographs.
0 @O1@ OBJE
1 FILE images/portrait.jpg
1 NOTE Family contributor identification.
1 NOTE @N1@
0 @N1@ NOTE Presence in the group is unconfirmed.
1 CONT No facial identification is claimed.
0 TRLR
`;
  const data = parseGedcom(text);
  const source = data.sources[0];
  assert.equal(source.locator, 'p. 7');
  assert.equal(
    source.note,
    'The class roster names the relative.\nThe photograph has no individual key.\n\nPresence in the group is unconfirmed.\nNo facial identification is claimed.\n\nPreserve the complete printed caption.',
  );
  assert.equal(
    source.archives.find((f) => f.path === 'images/class.jpg')?.note,
    'File assessment one.\n\nPresence in the group is unconfirmed.\nNo facial identification is claimed.',
  );
  assert.equal(
    source.archives.find((f) => f.path === 'images/cover.jpg')?.note,
    'This is the cover.\n\nThe volume date does not date its photographs.',
  );
  assert.equal(
    data.assets[0].credit,
    'Family contributor identification.\n\nPresence in the group is unconfirmed.\nNo facial identification is claimed.',
  );
  const withoutLaterNotes = parseGedcom(text.replaceAll('1 NOTE @N1@\n', ''));
  assert.equal(source.id, withoutLaterNotes.sources[0].id);
  assert.deepEqual(
    data.people[0].sourceIds,
    withoutLaterNotes.people[0].sourceIds,
  );
});

void test('an unrelated GEDCOM controls identity, narrative, image and mapped story', async () => {
  const { parseGedcom } = await parser();
  const data = parseGedcom(fixture);
  assert.equal(data.title, 'The Rivera family');
  assert.equal(data.rootId, 'rosa');
  assert.equal(data.people.length, 2);
  assert.deepEqual(data.people.find((p) => p.id === 'rosa')?.parents, [
    'elena',
  ]);
  assert.equal(data.chapters[0].title, 'A school by the sea');
  assert.equal(data.chapters[0].sections[0].paragraphs.length, 2);
  assert.equal(data.chapters[0].sections[0].place?.longitude, -6.29);
  assert.deepEqual(data.chapters[0].sections[0].people, ['elena']);
  assert.equal(data.assets[0].path, 'images/school.jpg');
  assert.equal(data.people.find((p) => p.id === 'elena')?.narrative.length, 2);
  assert.deepEqual(data.people.find((p) => p.id === 'rosa')?.narrative, []);
});

void test('raw event expressions and family marriages survive without making up precision', async () => {
  const { parseGedcom } = await parser();
  const data = parseGedcom(fixture);
  const elena = data.people.find((p) => p.id === 'elena')!;
  assert.equal(elena.events.find((e) => e.type === 'BIRT')?.date, 'ABT 1880');
  assert.equal(
    elena.events.find((e) => e.type === 'MARR')?.date,
    'BET 1900 AND 1902',
  );
  assert.equal(
    elena.events.find((e) => e.type === 'BIRT')?.place?.latitude,
    36.53,
  );
  assert.equal('living' in elena, false);
});

void test('plain GEDCOM gets chronological exploration and does not need editorial metadata', async () => {
  const { parseGedcom } = await parser();
  const data = parseGedcom(
    '0 HEAD\n0 @P@ INDI\n1 NAME Ezra /Tregear/\n1 BIRT\n2 DATE 1831\n2 PLAC York\n0 TRLR',
  );
  assert.equal(data.people[0].name, 'Ezra Tregear');
  assert.equal(data.chapters.length, 1);
  assert.ok(data.chapters[0].sections.some((s) => s.year === 1831));
  assert.equal(data.places[0].name, 'York');
  assert.equal(data.places[0].latitude, null);
});

void test('a person keeps the book’s id when another program’s REFN comes first', async () => {
  const { parseGedcom, personIds } = await parser();
  const text = [
    '0 HEAD',
    '1 _ATLAS',
    '2 _ROOT @I2@',
    '0 @I1@ INDI',
    '1 NAME Elena /Rivera/',
    '1 REFN 777',
    '1 REFN elena-rivera',
    '2 TYPE jsonid',
    '1 FAMS @F1@',
    '0 @I2@ INDI',
    '1 NAME Rosa /Rivera/',
    '1 REFN 778',
    '1 FAMC @F1@',
    '0 @I3@ INDI',
    '1 NAME Ines /Rivera/',
    '0 @F1@ FAM',
    '1 WIFE @I1@',
    '1 CHIL @I2@',
    '0 TRLR',
  ].join('\n');
  const data = parseGedcom(text);
  // The book's id wins; without one, the first REFN; without any, the pointer.
  assert.deepEqual(
    data.people.map((p) => p.id),
    ['elena-rivera', '778', 'I3'],
  );
  assert.equal(data.rootId, '778');
  assert.deepEqual(data.people.find((p) => p.id === '778')?.parents, [
    'elena-rivera',
  ]);
  assert.deepEqual([...personIds(text)], ['elena-rivera', '778', 'I3']);
});

void test('empty, malformed and duplicate identities are rejected rather than silently replaced', async () => {
  const { parseGedcom } = await parser();
  assert.throws(() => parseGedcom('hello'), /GEDCOM|line/i);
  assert.throws(() => parseGedcom('0 HEAD\n0 TRLR'), /people|individual/i);
  assert.throws(
    () =>
      parseGedcom(
        '0 HEAD\n0 @I@ INDI\n1 NAME A /B/\n0 @I@ INDI\n1 NAME C /D/\n0 TRLR',
      ),
    /duplicate/i,
  );
});

void test('continuation preserves line breaks and concatenation while treating markup as text', async () => {
  const { parseGedcom } = await parser();
  const data = parseGedcom(
    '0 HEAD\n0 @I@ INDI\n1 NAME A /B/\n1 _NARRATIVE <script>not executable</script>\n2 CONC  continued\n2 CONT Next paragraph\n0 TRLR',
  );
  assert.deepEqual(data.people[0].narrative, [
    '<script>not executable</script> continued',
    'Next paragraph',
  ]);
});

void test('citations retain separate locators and archived records, including narrative-level citations', async () => {
  const { parseGedcom } = await parser();
  const data = parseGedcom(
    `0 HEAD\n0 @I@ INDI\n1 NAME A /B/\n1 _NARRATIVE A reviewed account.\n2 SOUR @S@\n3 PAGE Page 2\n1 BIRT\n2 DATE 1800\n2 SOUR @S@\n3 PAGE Page 9\n0 @S@ SOUR\n1 TITL Family register\n1 _ARCHIVE images/register.pdf\n0 TRLR`,
  );
  assert.equal(data.people[0].sourceIds.length, 2);
  assert.deepEqual(data.sources.map((s) => s.locator).sort(), [
    'Page 2',
    'Page 9',
  ]);
  assert.equal(data.sources[0].archivePath, 'images/register.pdf');
});

void test('life spans preserve uncertainty in deaths and date ranges', async () => {
  const { parseGedcom, lifespan } = await parser();
  const data = parseGedcom(
    `0 HEAD\n0 @I@ INDI\n1 NAME A /B/\n1 BIRT\n2 DATE ABT 1800\n1 DEAT\n2 DATE BEF 1870\n0 @J@ INDI\n1 NAME C /D/\n1 BIRT\n2 DATE BET 1801 AND 1805\n0 TRLR`,
  );
  assert.equal(lifespan(data.people[0]), 'about 1800–before 1870');
  assert.equal(lifespan(data.people[1]), 'Born 1801–1805');
});

void test('family evidence and media are associated with spouses, and captions retain context', async () => {
  const { parseGedcom } = await parser();
  const data = parseGedcom(
    `0 HEAD\n0 @I@ INDI\n1 NAME A /B/\n1 OBJE @M@\n0 @J@ INDI\n1 NAME C /D/\n0 @F@ FAM\n1 HUSB @I@\n1 WIFE @J@\n1 MARR\n2 SOUR @S@\n2 OBJE @M@\n3 _CAPTION At their wedding\n0 @S@ SOUR\n1 TITL Marriage certificate\n0 @M@ OBJE\n1 FILE wedding.jpg\n1 TITL Photograph\n0 TRLR`,
  );
  assert.equal(data.people[1].sourceIds.length, 1);
  assert.equal(data.people[1].assetIds.length, 1);
  assert.equal(
    data.assets.find((a) => a.id === data.people[1].assetIds[0])?.title,
    'At their wedding',
  );
  assert.equal(data.assets.length, 2);
});

void test('malformed coordinates and pointerless people cannot become false locations or identities', async () => {
  const { parseGedcom } = await parser();
  assert.throws(
    () => parseGedcom('0 HEAD\n0 INDI\n1 NAME A /B/\n0 TRLR'),
    /identity|pointer/i,
  );
  const data = parseGedcom(
    '0 HEAD\n0 @I@ INDI\n1 NAME A /B/\n1 BIRT\n2 PLAC Unknown\n3 MAP\n4 LATI N\n4 LONG W\n0 TRLR',
  );
  assert.equal(data.places[0].latitude, null);
  assert.equal(data.places[0].longitude, null);
});

void test('parentage stays associated with the correct family', async () => {
  const { parseGedcom } = await parser();
  const data = parseGedcom(
    '0 HEAD\n0 @C@ INDI\n1 NAME Child\n1 FAMC @F1@\n2 PEDI birth\n1 FAMC @F2@\n2 PEDI adopted\n0 @B@ INDI\n1 NAME Birth parent\n0 @A@ INDI\n1 NAME Adoptive parent\n0 @F1@ FAM\n1 HUSB @B@\n1 CHIL @C@\n0 @F2@ FAM\n1 HUSB @A@\n1 CHIL @C@\n0 TRLR',
  );
  assert.deepEqual(data.people[0].parentLinks, [
    { id: 'B', family: '@F1@', kind: 'birth' },
    { id: 'A', family: '@F2@', kind: 'adopted' },
  ]);
});

void test('empty authored chapters cannot suppress the factual timeline or enter chapter navigation', async () => {
  const { parseGedcom } = await parser();
  const plain =
    '0 HEAD\n0 @I@ INDI\n1 NAME A /B/\n1 BIRT\n2 DATE 1850\n0 @C@ _CHAP\n1 TITL Empty chapter\n0 TRLR';
  const fallback = parseGedcom(plain);
  assert.ok(fallback.chapters[0].sections.length > 0);
  assert.notEqual(fallback.chapters[0].title, 'Empty chapter');
  const mixed = parseGedcom(
    plain.replace(
      '0 TRLR',
      '0 @D@ _CHAP\n1 TITL Reviewed story\n1 _SECTION first\n2 TITL A beginning\n2 NOTE A reviewed paragraph.\n2 _PERSON @I@\n0 TRLR',
    ),
  );
  assert.deepEqual(
    mixed.chapters.map((c) => c.title),
    ['Reviewed story'],
  );
});

void test('event value and direct literal qualifications retain order, paragraphs and continuations', async () => {
  const { parseGedcom } = await parser();
  const data = parseGedcom(`0 HEAD
0 @I1@ INDI
1 NAME Reader /Family/
1 OCCU Mine captain
2 DATE 1900
2 NOTE Listed as mine captain in a company pay book.
3 CONT The pay book covers one season only.
3 CONC  No longer tenure is claimed.
2 NOTE A union pamphlet names a different mine.
0 TRLR
`);
  assert.equal(
    data.people[0].events[0].detail,
    'Mine captain\n\nListed as mine captain in a company pay book.\nThe pay book covers one season only. No longer tenure is claimed.\n\nA union pamphlet names a different mine.',
  );
  assert.equal(data.people[0].events[0].date, '1900');
  assert.equal(data.people[0].events[0].label, 'Occupation');
});

void test('events without literal qualifications keep their original details and dates', async () => {
  const { parseGedcom } = await parser();
  const data = parseGedcom(`0 HEAD
0 @I1@ INDI
1 NAME Reader /Family/
1 OCCU  County teacher  
2 DATE ABT 1900
1 DEAT Y
2 DATE BEF 1980
1 BIRT
2 DATE BET 1901 AND 1905
0 TRLR
`);
  const events = data.people[0].events;
  assert.equal(
    events.find((e) => e.type === 'OCCU')?.detail,
    ' County teacher  ',
  );
  assert.equal(events.find((e) => e.type === 'DEAT')?.detail, '');
  assert.equal(events.find((e) => e.type === 'BIRT')?.detail, '');
  assert.equal(
    events.find((e) => e.type === 'BIRT')?.date,
    'BET 1901 AND 1905',
  );
  assert.equal('living' in data.people[0], false);
});

void test('public event qualifications do not resolve shared notes, expose private notes, or absorb citation locators', async () => {
  const { parseGedcom } = await parser();
  const data = parseGedcom(`0 HEAD
0 @I1@ INDI
1 NAME Reader /Family/
1 NOTE Private person-level research.
1 BIRT
2 DATE 27 JUL 1911
2 NOTE Birth date comes from a family letter; no register entry is held.
2 NOTE @MISSING@
2 NOTE @PRIVATE@
3 CONT A continuation does not make a shared note literal.
2 NOTE
2 SOUR @S1@
3 PAGE p. 4; a later copy gives another month.
3 NOTE Private citation-level working note.
0 @PRIVATE@ NOTE Private shared-note research.
0 @S1@ SOUR
1 TITL Held transcription
0 TRLR
`);
  const person = data.people[0];
  assert.equal(
    person.events[0].detail,
    'Birth date comes from a family letter; no register entry is held.',
  );
  assert.equal(person.events[0].date, '27 JUL 1911');
  assert.deepEqual(person.narrative, []);
  assert.equal('living' in person, false);
  assert.equal('confidence' in person, false);
  assert.equal(
    data.sources[0].locator,
    'p. 4; a later copy gives another month.',
  );
  assert.ok(!person.events[0].detail.includes('@'));
  assert.ok(!person.events[0].detail.includes('Private'));
});

void test('public event notes reach individual and family-event profiles', async () => {
  const { parseGedcom } = await parser();
  const data = parseGedcom(`0 HEAD
0 @I1@ INDI
1 NAME Thomas /Treloar/
1 EDUC Mining school
2 NOTE Graduate of the mining school, class of 1888.
0 @I2@ INDI
1 NAME Mary /Rowe/
1 OCCU Dressmaker
2 NOTE She ran a dressmaking room above the bakery.
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1890
2 NOTE Both lived at Mineral Point.
0 TRLR
`);
  const expected = [
    ['I1', 'EDUC', 'Graduate of the mining school, class of 1888.'],
    ['I2', 'OCCU', 'She ran a dressmaking room above the bakery.'],
    ['@F1@', 'MARR', 'Both lived at Mineral Point.'],
  ];
  for (const [id, type, note] of expected) {
    const individual = data.people.find((person) => person.id === id);
    if (individual) {
      assert.ok(
        individual.events.some(
          (event) => event.type === type && event.detail.includes(note),
        ),
        `${id} ${type} qualification missing from the person's events`,
      );
    } else {
      const family = data.families.find((entry) => entry.id === id);
      assert.ok(family, id);
      const event = family.events.find(
        (entry) => entry.type === type && entry.detail.includes(note),
      );
      assert.ok(
        event,
        `${id} ${type} qualification missing from the family event`,
      );
      assert.equal(family.parents.length, 2);
      for (const parentId of family.parents) {
        const parent = data.people.find((person) => person.id === parentId)!;
        assert.equal(
          parent.events.find((entry) => entry.id === event.id)?.detail,
          event.detail,
        );
      }
    }
  }
});

// Women and their husbands for the married-name convention. Records appear
// in an order that differs from the order of the marriages.
const marriages = `0 HEAD
0 @EDITH@ INDI
1 NAME Edith /Rowe/
1 SEX F
1 DEAT
2 DATE 1950
0 @ARTHUR@ INDI
1 NAME Arthur /Pascoe/
1 SEX M
0 @HENRY@ INDI
1 NAME Henry /Nance/
1 SEX M
0 @GRACE@ INDI
1 NAME Grace /Hosking/
1 SEX F
1 DEAT
0 @ELLEN@ INDI
1 NAME Ellen /Tonkin/
2 _MARNM Pascoe
1 SEX F
0 @MARY@ INDI
1 NAME Mary //
2 _MARNM Treloar
1 SEX F
0 @JANE@ INDI
1 NAME Jane /Curnow/
1 NAME Jane /Nance/
2 TYPE married
1 SEX F
0 @SUSAN@ INDI
1 NAME Susan /Curnow/
1 NAME Susan /Nance/
2 TYPE married
1 NAME Susan /Pascoe/
2 TYPE married
1 SEX F
0 @LIVING@ INDI
1 NAME Ruth /Kessler/
1 SEX F
0 @ANN@ INDI
1 NAME Ann Penhallow /Rowe/
1 SEX F
1 DEAT
1 FAMC @ANNPARENTS@
0 @WILLIAM@ INDI
1 NAME William /Penhallow/
1 SEX M
0 @AMY@ INDI
1 NAME Amy Penhallow /Rowe/
1 SEX F
1 DEAT
1 FAMC @AMYPARENTS@
0 @GEORGE@ INDI
1 NAME George /Trevail/
1 SEX M
0 @JOHN@ INDI
1 NAME John /Rowe/
1 SEX M
0 @LATER@ FAM
1 HUSB @HENRY@
1 WIFE @EDITH@
1 MARR
2 DATE 12 MAR 1921
0 @EARLIER@ FAM
1 HUSB @ARTHUR@
1 WIFE @EDITH@
1 MARR
2 DATE 4 JUN 1910
0 @DATED@ FAM
1 HUSB @HENRY@
1 WIFE @GRACE@
1 MARR
2 DATE 1925
0 @UNDATED@ FAM
1 HUSB @ARTHUR@
1 WIFE @GRACE@
1 MARR Y
0 @LIVINGFAM@ FAM
1 HUSB @ARTHUR@
1 WIFE @LIVING@
1 MARR
2 DATE 1980
0 @ANNFAM@ FAM
1 HUSB @JOHN@
1 WIFE @ANN@
1 MARR
0 @ANNPARENTS@ FAM
1 HUSB @WILLIAM@
1 CHIL @ANN@
0 @AMYPARENTS@ FAM
1 HUSB @GEORGE@
1 CHIL @AMY@
0 @AMYFAM@ FAM
1 HUSB @JOHN@
1 WIFE @AMY@
1 MARR
0 TRLR
`;

void test('names stay as recorded unless the family chooses married surnames', async () => {
  const { parseGedcom } = await parser();
  for (const text of [marriages, fixture]) {
    for (const person of parseGedcom(text).people) {
      const recorded = person.nameVariants?.[0] ?? person.name;
      assert.equal(person.name, recorded, person.id);
    }
  }
});

void test('married surnames come from _MARNM or the latest marriage', async () => {
  const { parseGedcom } = await parser();
  const names = (text: string) =>
    Object.fromEntries(
      parseGedcom(text, { marriedSurnames: true }).people.map((p) => [
        p.id,
        p.name,
      ]),
    );
  const moveToEnd = (text: string, family: string) => {
    const record = text.match(
      new RegExp(`0 @${family}@ FAM\\n(?:[1-9].*\\n)*`),
    )![0];
    return text.replace(record, '').replace('0 TRLR', record + '0 TRLR');
  };
  const named = names(marriages);
  // Every marriage dated: her later marriage, whatever the record order.
  assert.equal(named.EDITH, 'Edith (Rowe) Nance');
  assert.equal(
    names(moveToEnd(marriages, 'LATER')).EDITH,
    'Edith (Rowe) Nance',
  );
  // A marriage without a date: her last marriage in the records.
  assert.equal(named.GRACE, 'Grace (Hosking) Pascoe');
  assert.equal(
    names(moveToEnd(marriages, 'DATED')).GRACE,
    'Grace (Hosking) Nance',
  );
  // A recorded married surname (_MARNM).
  assert.equal(named.ELLEN, 'Ellen (Tonkin) Pascoe');
  // Other NAME records, married or not, do not change the name she has.
  assert.equal(named.JANE, 'Jane Curnow');
  assert.equal(named.SUSAN, 'Susan Curnow');
  // An unknown maiden name leaves no empty brackets.
  assert.equal(named.MARY, 'Mary Treloar');
  // Living women keep their recorded name.
  assert.equal(named.LIVING, 'Ruth Kessler');
  // Recorded under her married surname: a last given name that matches her
  // father's surname is her maiden name; any other middle name stays.
  assert.equal(named.ANN, 'Ann (Penhallow) Rowe');
  assert.equal(named.AMY, 'Amy Penhallow Rowe');
  // Men are never renamed, and every recorded form stays searchable.
  assert.equal(named.ARTHUR, 'Arthur Pascoe');
  const edith = parseGedcom(marriages, { marriedSurnames: true }).people.find(
    (p) => p.id === 'EDITH',
  )!;
  assert.ok(edith.nameVariants?.includes('Edith Rowe'));
});
