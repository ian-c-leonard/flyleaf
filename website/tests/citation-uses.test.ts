import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGedcom, parseRecords, type GedNode } from '../app/lib/gedcom.ts';
import {
  collectCitationUses,
  citationUsesInScope,
} from '../app/lib/citation-uses.ts';
import { resolveDocument, selectCitationUse } from '../app/lib/archive.ts';
import { homeRoute, readRoute, routeHref } from '../app/lib/navigation.ts';
import {
  citationDocuments,
  type BookCitation,
} from '../app/lib/native-book.ts';
import { citationDisplayLabel } from '../app/lib/citation-labels.ts';

// One legacy "[Source]" note and one typed citation, each cited once.
const bookFixture = () =>
  parseGedcom(`0 HEAD
0 @I1@ INDI
1 REFN ada-example
1 NAME Ada /Example/
1 DEAT
2 NOTE [Source] Example County death register
3 PAGE entry 12
3 OBJE
4 FILE images/registers/death-register.jpg
0 @I2@ INDI
1 REFN ben-example
1 NAME Ben /Example/
1 BIRT
2 SOUR @S1@
3 _KEY ben-birth
3 PAGE folio 3
0 @S1@ SOUR
1 TITL Example birth register
1 OBJE
2 FILE images/registers/birth-register.jpg
0 TRLR`);

void test('a synthesized Book key still selects a unique exact legacy note, owner and locator', () => {
  const data = bookFixture();
  const source = data.sources.find(
    (s) =>
      s.archives.length &&
      s.legacyNotes?.length &&
      s.uses?.length === 1 &&
      s.uses[0].owner.people.length,
  )!;
  assert.ok(source);
  const use = source.uses![0];
  assert.equal(use.key, '');
  const citation: BookCitation = {
    person: use.owner.people[0],
    key: 'synthesized-native-key',
    sourcePointer: null,
    legacyNotes: [use.legacyNote],
    label: source.label,
    url: source.url,
    locators: [use.locator],
    files: [],
  };
  assert.equal(citationDocuments(data, citation)[0].selectedUse?.id, use.id);
  assert.equal(
    citationDocuments(data, { ...citation, person: 'wrong-owner' })[0]
      .selectedUse,
    undefined,
  );
  assert.deepEqual(
    citationDocuments(data, {
      ...citation,
      legacyNotes: [use.legacyNote + ' changed'],
    }),
    [],
  );
  assert.deepEqual(
    citationDocuments(data, { ...citation, locators: ['a different PAGE'] }),
    [],
  );
  source.uses!.push({ ...use, id: use.id + '-ambiguous' });
  assert.equal(citationDocuments(data, citation)[0].selectedUse, undefined);
});

void test('typed Book citations still require their key and never choose an ambiguous use', () => {
  const data = bookFixture();
  const source = data.sources.find(
    (s) =>
      s.archives.length &&
      s.pointer &&
      s.uses?.length === 1 &&
      s.uses[0].key &&
      s.uses[0].owner.people.length,
  )!;
  assert.ok(source);
  const use = source.uses![0];
  const citation: BookCitation = {
    person: use.owner.people[0],
    key: use.key,
    sourcePointer: source.pointer!,
    legacyNotes: [],
    label: source.label,
    url: source.url,
    locators: [use.locator],
    files: [],
  };
  assert.equal(citationDocuments(data, citation)[0].selectedUse?.id, use.id);
  assert.equal(
    citationDocuments(data, { ...citation, key: 'wrong-key' })[0].selectedUse,
    undefined,
  );
  source.uses!.push({ ...use, id: use.id + '-ambiguous' });
  assert.equal(citationDocuments(data, citation)[0].selectedUse, undefined);
});

void test('different owners with the same name remain distinguishable even when names or dates match', () => {
  const data = parseGedcom(`0 HEAD
0 @W1@ INDI
1 REFN william-penhallow-elder
1 NAME William /Penhallow/
1 BIRT
2 DATE 1840
2 SOUR @S1@
3 PAGE p. 1
0 @W2@ INDI
1 REFN william-penhallow-younger
1 NAME William /Penhallow/
1 SEX M
1 FAMC @F1@
1 BIRT
2 DATE 1840
2 SOUR @S1@
3 PAGE p. 1
0 @J@ INDI
1 REFN john-penhallow
1 NAME John /Penhallow/
0 @F1@ FAM
1 HUSB @J@
1 CHIL @W2@
0 @S1@ SOUR
1 TITL Example register
0 TRLR`);
  const uses = data.sources.flatMap((source) => source.uses || []);
  const williams = uses.filter(
    (use) => use.owner.label === 'William Penhallow',
  );
  assert.equal(williams.length, 2);
  for (const people of [
    data.people,
    [],
    data.people.map((person) => ({ ...person, events: [] })),
  ]) {
    assert.equal(
      new Set(williams.map((use) => citationDisplayLabel(use, uses, people)))
        .size,
      2,
    );
    for (const use of williams)
      assert.ok(
        !citationDisplayLabel(use, uses, people).includes(use.owner.pointer),
        'labels never show an internal record pointer',
      );
  }
});
const fixture = `0 HEAD
0 @I1@ INDI
1 REFN person-one
1 NAME Person /One/
1 BIRT
2 DATE 1900
2 SOUR @S1@
3 _KEY first-use
3 PAGE 7
3 NOTE First line
4 CONT Second line
4 CONC ; continued
1 DEAT
2 SOUR @S1@
3 _KEY second-use
3 PAGE 7
3 NOTE Different qualification
1 NOTE @N1@
1 NOTE @N1@
1 OBJE @M1@
0 @I2@ INDI
1 REFN person-two
1 NAME Person /Two/
1 NOTE @N1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 SOUR @S1@
3 PAGE 8
3 NOTE Shared family qualification
0 @N1@ NOTE Shared narrative
1 SOUR @S1@
2 PAGE 9
2 NOTE @N3@
2 QUAY 2
1 NOTE @N2@
0 @N2@ NOTE A second shared note
1 NOTE @N1@
0 @N3@ NOTE Literal <script>text</script>
1 CONT Qualification stays a separate paragraph
0 @M1@ OBJE
1 FILE images/example.jpg
2 TITL Example image
1 SOUR @S2@
2 PAGE 10
2 NOTE Media qualification
0 @S1@ SOUR
1 TITL Example source
1 NOTE Definition-level description
0 @S2@ SOUR
1 TITL Media source
0 TRLR
`;

void test('uses preserve literal notes and distinguish shared family, shared note and media ownership', () => {
  const data = parseGedcom(fixture);
  const uses = data.sources.flatMap((s) => s.uses || []);
  assert.deepEqual(uses.find((use) => use.key === 'first-use')!.notes, [
    'First line\nSecond line; continued',
  ]);
  const family = uses.find((use) => use.owner.kind === 'FAM')!;
  assert.deepEqual(family.owner.people.sort(), ['person-one', 'person-two']);
  assert.equal(family.placements.length, 1);
  assert.equal(family.locator, '8');
  const shared = uses.find((use) => use.owner.kind === 'NOTE')!;
  assert.equal(uses.filter((use) => use.owner.kind === 'NOTE').length, 1);
  assert.equal(shared.owner.pointer, '@N1@');
  assert.deepEqual(shared.owner.people.sort(), ['person-one', 'person-two']);
  assert.equal(shared.placements.length, 3);
  assert(
    shared.placements.every((p) => p.record === '@N1@' && p.via.length === 1),
  );
  assert.deepEqual(shared.notes, [
    'Literal <script>text</script>\nQualification stays a separate paragraph',
  ]);
  assert.deepEqual(shared.placements[0].noteReferences, [
    { index: 0, pointer: '@N3@' },
  ]);
  assert.equal(shared.quay, '2');
  const media = uses.find((use) => use.owner.kind === 'OBJE')!;
  assert.deepEqual(media.owner.people, ['person-one']);
  assert(
    !data.people
      .find((p) => p.id === 'person-one')!
      .sourceIds.includes(media.sourceId),
  );
  assert.equal(
    data.people.find((p) => p.id === 'person-one')!.assetIds.length,
    1,
  );
  assert.equal(
    data.sources.find((s) => s.id === family.sourceId)!.note,
    'Definition-level description',
  );
});

void test('qualified-use IDs survive discovery order and unrelated insertions; changed notes get new IDs', () => {
  const useIds = (text: string) =>
    parseGedcom(text)
      .sources.flatMap((s) => s.uses || [])
      .map((use) => use.id)
      .sort();
  const roots = fixture.split(/(?=^0 )/m).filter(Boolean);
  const reordered = [
    roots[0],
    ...roots.slice(1, -1).reverse(),
    roots.at(-1),
  ].join('');
  assert.deepEqual(useIds(fixture), useIds(reordered));
  assert.deepEqual(
    useIds(fixture),
    useIds(fixture.replace('1 BIRT', '1 OCCU Unrelated\n1 BIRT')),
  );
  const before = parseGedcom(fixture),
    after = parseGedcom(
      fixture.replace('Different qualification', 'Corrected qualification'),
    );
  assert.deepEqual(
    before.sources.map((s) => s.id),
    after.sources.map((s) => s.id),
  );
  const oldUses = before.sources.flatMap((s) => s.uses || []),
    newUses = after.sources.flatMap((s) => s.uses || []);
  assert.equal(
    oldUses.filter((use) => !newUses.some((next) => next.id === use.id)).length,
    1,
  );
});

void test('identical qualifications keep every placement, while catalogue discovery does not become a citation use', () => {
  const text = fixture
    .replace('second-use', 'first-use')
    .replace(
      'Different qualification',
      'First line\n4 CONT Second line\n4 CONC ; continued',
    );
  const use = parseGedcom(text)
    .sources.flatMap((s) => s.uses || [])
    .find((use) => use.key === 'first-use')!;
  assert.equal(use.placements.length, 2);
  assert.deepEqual(
    use.placements.map((p) => p.label),
    ['Birth · 1900', 'Death'],
  );
  const catalogue = parseGedcom(`0 HEAD
1 _ARCHIVE_CATALOG
2 SOUR @S1@
3 NOTE Discovery qualification
0 @I1@ INDI
1 NAME Example /Person/
0 @S1@ SOUR
1 TITL Discovered source
0 TRLR
`);
  assert.equal(catalogue.sources.length, 1);
  assert.equal(catalogue.sources[0].uses, undefined);
});

void test('an identity collision rejects the model instead of merging different qualifications', () => {
  const records = parseRecords(fixture);
  const admitted = new Map<GedNode, string>();
  function visit(node: GedNode) {
    if (node.tag === 'SOUR' && !node.pointer)
      admitted.set(node, 'example-source');
    node.children.forEach(visit);
  }
  records.forEach(visit);
  assert.throws(
    () =>
      collectCitationUses(
        records,
        parseGedcom(fixture),
        admitted,
        () => 'collision',
      ),
    /identity collision/,
  );
});

void test('note and media references filed under an event stay visibly distinct from its direct citation', () => {
  const text = fixture.replace(
    '2 DATE 1900',
    `2 DATE 1900
2 NOTE Background discussion
3 SOUR @S1@
4 _KEY note-under-birth
4 PAGE 7
4 NOTE A general reference, not support for this event's date
2 OBJE @M1@`,
  );
  const uses = parseGedcom(text).sources.flatMap((source) => source.uses || []);
  assert.equal(
    uses.find((use) => use.key === 'first-use')!.placements[0].label,
    'Birth · 1900',
  );
  assert.equal(
    uses.find((use) => use.key === 'note-under-birth')!.placements[0].label,
    'Note on Birth · 1900',
  );
  assert(
    uses
      .find((use) => use.owner.kind === 'OBJE')!
      .placements.some(
        (p) => p.label === 'Picture or document for Birth · 1900',
      ),
  );
});

void test('citation selection retains its source/PAGE and original file across URLs, and rejects stale or other-source uses', () => {
  const data = parseGedcom(
      fixture
        .replace(
          '1 TITL Example source',
          '1 TITL Example source\n1 OBJE\n2 FILE images/source.jpg\n1 OBJE\n2 FILE images/source-back.jpg',
        )
        .replace(
          '1 TITL Media source',
          '1 TITL Media source\n1 OBJE\n2 FILE images/media-source.jpg',
        ),
    ),
    source = data.sources.find(
      (s) => s.pointer === '@S1@' && s.locator === '7',
    )!,
    other = data.sources.find((s) => s.pointer === '@S2@')!;
  assert.equal(source.uses!.length, 2);
  const file = source.archives[0].path;
  for (const use of source.uses!) {
    const route = readRoute(
      routeHref({
        ...homeRoute,
        view: 'archive',
        branch: 'person-one',
        record: source.id,
        file,
        citationUse: use.id,
        archiveQuery: 'Person 1900',
        archiveKind: 'images',
        archivePage: 3,
      }),
      data,
    );
    assert.equal(route.citationUse, use.id);
    assert.equal(route.archiveQuery, 'Person 1900');
    assert.equal(route.archivePage, 3);
    assert.equal(route.branch, 'person-one');
    const document = resolveDocument(
      data,
      route.record,
      route.file,
      route.citationUse,
    )!;
    assert.equal(document.selectedUse?.id, use.id);
    assert.equal(document.locator, source.locator);
    assert.deepEqual(document.selectedUse?.notes, use.notes);
    for (const version of document.archives)
      assert.equal(
        resolveDocument(data, source.id, version.path, use.id)!.selectedUse?.id,
        use.id,
      );
    assert.equal(
      resolveDocument(data, other.id, undefined, use.id)!.unavailableUse,
      true,
    );
    assert.equal(selectCitationUse(document).selectedUse, undefined);
  }
  const stale = readRoute(
    '#view=archive&record=' +
      source.id +
      '&citationUse=citation-no-longer-current',
    data,
  );
  const overview = resolveDocument(
    data,
    stale.record,
    stale.file,
    stale.citationUse,
  )!;
  assert.equal(overview.id, source.id);
  assert.equal(overview.selectedUse, undefined);
  assert.equal(overview.unavailableUse, true);
  assert.equal(resolveDocument(data, source.id)!.selectedUse, undefined);
});

void test('person and branch choices follow citation ownership rather than a shared obituary file', () => {
  const data = parseGedcom(`0 HEAD
0 @H@ INDI
1 REFN thomas-treloar
1 NAME Thomas /Treloar/
1 DEAT
2 SOUR @OBIT@
3 PAGE p. 4
3 NOTE His wife's 1934 obituary reports his death in 1927.
0 @W@ INDI
1 REFN mary-treloar
1 NAME Mary /Treloar/
1 BIRT
2 SOUR @OBIT@
3 PAGE p. 4
3 NOTE Gives 14 June 1858 as her birth date.
1 DEAT
2 SOUR @OBIT@
3 PAGE p. 4
3 NOTE Says she died on Tuesday, 6 November 1934.
1 RESI
2 SOUR @OBIT@
3 PAGE p. 4
3 NOTE Kept a boarding house on Fore Street for many years.
0 @F@ FAM
1 HUSB @H@
1 WIFE @W@
0 @OBIT@ SOUR
1 TITL Obituary of Mary Treloar
1 OBJE
2 FILE images/newspapers/1934-obituary.jpg
0 TRLR`);
  const source = data.sources.find((s) => s.pointer === '@OBIT@')!;
  const husband = source.uses!.find((use) =>
    use.notes.some((note) => note.startsWith("His wife's 1934 obituary")),
  )!;
  const wife = source.uses!.find((use) =>
    use.notes.some((note) => note.startsWith('Gives 14 June 1858')),
  )!;
  const husbandChoices = citationUsesInScope(
    source.uses!,
    new Set(husband.owner.people),
    new Set(),
  );
  assert.deepEqual(
    husbandChoices.map((use) => use.id),
    [husband.id],
  );
  const wifeChoices = citationUsesInScope(
    source.uses!,
    new Set(wife.owner.people),
    new Set(),
  );
  assert.equal(wifeChoices.length, 3);
  assert(!wifeChoices.some((use) => use.id === husband.id));
  assert.equal(
    citationUsesInScope(source.uses!, new Set(['someone-else']), new Set())
      .length,
    0,
  );
});

void test('Book selects only an unambiguous person/key/source/PAGE use and leaves file-only joins distinct', () => {
  const text = fixture.replace(
    '1 TITL Example source',
    '1 TITL Example source\n1 OBJE\n2 FILE images/source.jpg',
  );
  const data = parseGedcom(text);
  const citation: BookCitation = {
    person: 'person-one',
    key: 'first-use',
    sourcePointer: '@S1@',
    legacyNotes: [],
    label: 'Printed note remains separate',
    url: '',
    locators: ['7'],
    files: ['images/source.jpg'],
  };
  const matched = citationDocuments(data, citation);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].bookMatch, 'citation');
  assert.equal(matched[0].selectedUse?.key, 'first-use');
  assert.deepEqual(matched[0].selectedUse?.notes, [
    'First line\nSecond line; continued',
  ]);
  assert.equal(
    citationDocuments(data, { ...citation, person: 'person-two' })[0]
      .selectedUse,
    undefined,
  );
  const ambiguous = parseGedcom(text.replace('second-use', 'first-use'));
  assert.equal(
    citationDocuments(ambiguous, citation)[0].selectedUse,
    undefined,
  );
  const fallback = citationDocuments(data, {
    ...citation,
    sourcePointer: '@NOT_MATCHED@',
  });
  assert(fallback.length > 0);
  assert(
    fallback.every(
      (document) => document.bookMatch === 'file' && !document.selectedUse,
    ),
  );
});
