import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGedcom } from '../app/lib/gedcom.ts';
import {
  familyFocus,
  ancestryPath,
  branchChoices,
  immediateFamily,
  mayBeLiving,
  viewpointChoices,
} from '../app/lib/branches.ts';
import { readRoute, routeHref } from '../app/lib/navigation.ts';
import {
  archiveCatalog,
  documentKind,
  sourceDocument,
} from '../app/lib/archive.ts';
const fixture = `0 HEAD
1 _ATLAS
2 _ROOT @R@
0 @R@ INDI
1 NAME Root /Family/
1 FAMC @F@
0 @A@ INDI
1 NAME First /Parent/
1 FAMC @G@
0 @B@ INDI
1 NAME Second /Parent/
1 OBJE @M@
0 @C@ INDI
1 NAME Third /Grandparent/
1 ASSO @D@
2 RELA Possible identity; unproved
0 @D@ INDI
1 NAME Fourth /Grandparent/
0 @F@ FAM
1 HUSB @A@
1 WIFE @B@
1 CHIL @R@
0 @G@ FAM
1 HUSB @C@
1 WIFE @D@
1 CHIL @A@
0 @M@ OBJE
1 FILE images/photo.jpg
1 SOUR @S@
0 @S@ SOUR
1 TITL Source only attached to a photograph
1 _ARCHIVE images/source.pdf
0 @K@ _CHAP
1 REFN chapter
1 _SECTION first
2 TITL First side
2 _PERSON @A@
2 NOTE Keep this whole story.
1 _SECTION second
2 TITL Second side
2 _PERSON @B@
1 _SECTION shared
2 TITL A shared story
2 _PERSON @A@
2 _PERSON @B@
2 OBJE @M@
0 TRLR`;
const data = parseGedcom(fixture);

const collateralFixture = fixture.replace(
  '0 TRLR',
  `0 @Z@ INDI
1 NAME Earlier /Ancestor/
0 @E@ INDI
1 NAME Grandparent's /Sibling/
1 ASSO @UNPROVEN@
2 RELA Possible identity; unproved
0 @EP@ INDI
1 NAME Sibling's /Partner/
0 @H@ INDI
1 NAME Their /Child/
0 @HP@ INDI
1 NAME Child's /Partner/
0 @OUTSIDE@ INDI
1 NAME Partner's /Parent/
0 @STEP@ INDI
1 NAME Partner's /Other-child/
0 @UNPROVEN@ INDI
1 NAME Possible /Connection/
0 @OLDER@ FAM
1 HUSB @Z@
1 CHIL @C@
1 CHIL @E@
0 @COUSINS@ FAM
1 HUSB @E@
1 WIFE @EP@
1 CHIL @H@
0 @COUPLE@ FAM
1 HUSB @H@
1 WIFE @HP@
0 @UNRELATED@ FAM
1 HUSB @OUTSIDE@
1 CHIL @HP@
0 @OTHERUNION@ FAM
1 HUSB @HP@
1 CHIL @STEP@
0 TRLR`,
);

void test('a quarter retains descendants and partners without importing a partner’s separate family', () => {
  const candidate = parseGedcom(collateralFixture);
  const original = structuredClone(candidate);
  const quarter = familyFocus(candidate, 'C');
  assert.deepEqual([...quarter.members].sort(), [
    'A',
    'B',
    'C',
    'D',
    'E',
    'EP',
    'H',
    'HP',
    'R',
    'Z',
  ]);
  const half = familyFocus(candidate, 'A');
  assert.deepEqual([...half.members].sort(), [
    'A',
    'B',
    'C',
    'D',
    'E',
    'EP',
    'H',
    'HP',
    'R',
    'Z',
  ]);
  assert.deepEqual([...familyFocus(candidate, 'D').members].sort(), [
    'A',
    'B',
    'C',
    'D',
    'R',
  ]);
  assert.deepEqual([...familyFocus(candidate, 'B').members].sort(), [
    'A',
    'B',
    'R',
  ]);
  for (const branch of [quarter, half])
    for (const excluded of ['OUTSIDE', 'STEP', 'UNPROVEN'])
      assert.ok(!branch.members.has(excluded), excluded);
  assert.deepEqual(candidate, original);
});

void test('a collateral cycle or a descendant link back to an ancestor does not widen the quarter', () => {
  const candidate = parseGedcom(
    collateralFixture.replace(
      '0 TRLR',
      `0 @LOOP@ FAM
1 HUSB @H@
1 CHIL @E@
1 CHIL @C@
0 TRLR`,
    ),
  );
  // C now also has H as a recorded parent. C's own descendants remain family;
  // the cycle must still exclude a partner's separate parent and other child.
  const focused = familyFocus(candidate, 'C');
  assert.ok(focused.members.has('H'));
  for (const included of ['A', 'R']) assert.ok(focused.members.has(included));
  for (const excluded of ['OUTSIDE', 'STEP', 'UNPROVEN'])
    assert.ok(!focused.members.has(excluded), excluded);
});

void test('half-siblings in another parental union bring their descendants without bringing the other parent’s family', () => {
  const candidate = parseGedcom(
    collateralFixture.replace(
      '1 CHIL @C@\n1 CHIL @E@',
      `1 CHIL @C@
0 @HALFPARENT@ INDI
1 NAME Other /Parent/
0 @HALF@ FAM
1 HUSB @Z@
1 WIFE @HALFPARENT@
1 CHIL @E@`,
    ),
  );
  assert.deepEqual(candidate.people.find((p) => p.id === 'C')!.siblings, []);
  assert.deepEqual([...familyFocus(candidate, 'C').members].sort(), [
    'A',
    'B',
    'C',
    'D',
    'E',
    'EP',
    'H',
    'HALFPARENT',
    'HP',
    'R',
    'Z',
  ]);
  assert.deepEqual([...familyFocus(candidate, 'D').members].sort(), [
    'A',
    'B',
    'C',
    'D',
    'R',
  ]);
});

void test('research associations enable branch discovery without becoming factual citations or personal photographs', () => {
  const text = fixture
    .replace(
      '2 _ROOT @R@',
      '2 _ROOT @R@\n1 _ARCHIVE_CATALOG\n2 SOUR @WEB_RESEARCH@',
    )
    .replace(
      '0 TRLR',
      `0 @WEB_RESEARCH@ SOUR
1 TITL A college catalogue
1 _STATUS research-only
1 _PERSON @C@
1 NOTE A possible identity, not yet adopted.
1 OBJE
2 FILE images/catalogue.pdf
3 TITL Complete college catalogue
3 NOTE A retrospective institutional publication.
3 _NATURE complete-published-book
0 TRLR`,
    );
  const candidate = parseGedcom(text);
  assert.deepEqual(candidate.people, data.people);
  assert.deepEqual(candidate.families, data.families);
  assert.deepEqual(candidate.assets, data.assets);
  const source = candidate.sources.find((s) => s.researchOnly)!;
  assert.deepEqual(source.associatedPeople, ['C']);
  assert.equal(source.archives[0].title, 'Complete college catalogue');
  assert.equal(
    source.archives[0].note,
    'A retrospective institutional publication.',
  );
  assert.ok(
    familyFocus(candidate, 'A').data.sources.some((s) => s.id === source.id),
  );
  assert.ok(
    familyFocus(candidate, 'C').data.sources.some((s) => s.id === source.id),
  );
  assert.ok(
    !familyFocus(candidate, 'B').data.sources.some((s) => s.id === source.id),
  );
  const entry = archiveCatalog(candidate).find(
    (r) => r.file.path === 'images/catalogue.pdf',
  )!;
  assert.match(entry.searchText, /third grandparent/);
  assert.equal(sourceDocument(source).researchOnly, true);
});
void test('whole, half and quarter selections retain their descendants and complete shared stories', () => {
  assert.equal(familyFocus(data, '').data.people.length, 5);
  assert.deepEqual(
    branchChoices(data).map((c) => c.grandparents.length),
    [2, 0],
  );
  const first = familyFocus(data, 'A');
  assert.deepEqual([...first.members].sort(), ['A', 'B', 'C', 'D', 'R']);
  assert.deepEqual(
    first.data.chapters[0].sections.map((s) => s.id),
    ['first', 'second', 'shared'],
  );
  assert.deepEqual(first.data.chapters[0].sections[2].people, ['A', 'B']);
  assert.deepEqual([...familyFocus(data, 'C').members].sort(), [
    'A',
    'B',
    'C',
    'D',
    'R',
  ]);
  assert.equal(data.people.length, 5);
  assert.deepEqual(
    ancestryPath(data, 'C').map((p) => p.id),
    ['R', 'A', 'C'],
  );
});
void test('a photograph brings its archive source into each relevant branch', () => {
  for (const anchor of ['A', 'B']) {
    const focused = familyFocus(data, anchor).data;
    assert.equal(focused.assets.length, 1);
    assert.equal(
      focused.sources[0].label,
      'Source only attached to a photograph',
    );
  }
});
void test('possible identity remains a labeled association and never adds parents', () => {
  const p = data.people.find((p) => p.id === 'C')!;
  assert.equal(p.associations?.[0].label, 'Possible identity; unproved');
  assert.deepEqual(p.parents, []);
  assert.equal(ancestryPath(data, 'D').length, 3);
});
void test('older story links open the book within their branch', () => {
  const route = readRoute(
    '#view=story&branch=B&chapter=chapter&passage=first',
    data,
  );
  assert.equal(route.view, 'book');
  assert.equal(route.branch, 'B');
  assert.deepEqual(readRoute(routeHref(route), data), route);
  assert.equal(readRoute('#view=people&branch=absent', data).branch, '');
});
void test('cycles and pedigree collapse terminate without duplicating branch members', () => {
  const cycle = parseGedcom(
    fixture
      .replace('0 @C@ INDI', '0 @C@ INDI\n1 FAMC @LOOP@')
      .replace('0 TRLR', '0 @LOOP@ FAM\n1 HUSB @A@\n1 CHIL @C@\n0 TRLR'),
  );
  assert.deepEqual(cycle.people.find((p) => p.id === 'C')!.parents, ['A']);
  assert.equal(familyFocus(cycle, 'A').members.size, 5);
  assert.equal(ancestryPath(cycle, 'missing').length, 0);
});
void test('a single reproduced page or crop is not mislabeled as a complete book', () => {
  const f = {
    path: 'images/source.pdf',
    kind: '',
    nature: 'complete-published-page',
    locator: '',
    status: '',
  };
  assert.equal(documentKind(f), 'Published page');
  assert.equal(
    documentKind({ ...f, kind: 'newspaper-page' }),
    'Newspaper page',
  );
  assert.equal(documentKind({ ...f, kind: 'yearbook-page' }), 'Yearbook page');
  assert.equal(
    documentKind({ ...f, kind: 'book', nature: 'complete-published-book' }),
    'Book',
  );
  assert.equal(
    documentKind({ ...f, nature: 'derivative-crop' }),
    'Cropped or edited detail',
  );
});

void test('only people who could be alive are offered as a site preview', () => {
  const data = parseGedcom(`0 HEAD
0 @T@ INDI
1 REFN tamsin
1 NAME Tamsin /Penhallow/
1 BIRT
2 DATE 1990
0 @W@ INDI
1 REFN william
1 NAME William /Penhallow/
1 BIRT
2 DATE 1899
0 @E@ INDI
1 REFN edith
1 NAME Edith /Rowe/
1 BIRT
2 DATE 1907
0 @H@ INDI
1 REFN harold
1 NAME Harold /Penhallow/
0 @J@ INDI
1 REFN jory
1 NAME Jory /Penhallow/
0 @S@ INDI
1 REFN susan
1 NAME Susan /Dahl/
0 @L@ INDI
1 REFN elizabeth
1 NAME Elizabeth /Trembath/
0 @C@ INDI
1 REFN john
1 NAME John /Penhallow/
1 BIRT
2 DATE 1870
0 @R@ INDI
1 REFN richard
1 NAME Richard /Penhallow/
1 BIRT
2 DATE 1867
0 @F1@ FAM
1 HUSB @W@
1 WIFE @E@
1 CHIL @H@
0 @F2@ FAM
1 HUSB @H@
1 CHIL @J@
0 @F3@ FAM
1 HUSB @J@
1 WIFE @S@
0 @F4@ FAM
1 WIFE @L@
1 CHIL @C@
0 TRLR`);
  const person = (id: string) => data.people.find((p) => p.id === id)!;
  const living = (id: string) => mayBeLiving(data, person(id), 2026);
  assert.equal(living('tamsin'), true);
  // Undated, but the child of parents born in 1899 and 1907: about 1937.
  assert.equal(living('harold'), true);
  // Undated great-great-grandmother of a man born in 1870.
  assert.equal(living('elizabeth'), false);
  assert.equal(living('richard'), false);
  // Undated, married to an undated grandson of the family.
  assert.equal(living('susan'), true);
  // The rule moves with the calendar: 100 years after a birth, no longer.
  assert.equal(mayBeLiving(data, person('tamsin'), 2091), false);
});

void test('an administrator may see the site as anyone who may be living, or any relative with a sign-in', () => {
  const data = parseGedcom(`0 HEAD
1 _ATLAS
2 _ROOT @A@
0 @A@ INDI
1 REFN ann
1 NAME Ann /Penhallow/
1 BIRT
2 DATE 1960
1 FAMC @F1@
0 @B@ INDI
1 REFN bert
1 NAME Bert /Penhallow/
1 BIRT
2 DATE 1930
1 FAMS @F1@
0 @G@ INDI
1 REFN gwen
1 NAME Gwen /Penhallow/
1 BIRT
2 DATE 1920
1 FAMS @F1@
0 @K@ INDI
1 REFN kit
1 NAME Kit /Rowe/
1 BIRT
2 DATE 1995
0 @F1@ FAM
1 HUSB @B@
1 WIFE @G@
1 CHIL @A@
0 TRLR`);
  const ids = (viewers?: string[]) =>
    viewpointChoices(data, viewers, 2026).map((p) => p.id);
  // Nearest first. No relationship limit: Kit is unrelated but may be living.
  assert.deepEqual(ids(), ['ann', 'bert', 'kit']);
  // Gwen, born more than 100 years ago, has a sign-in: she is offered too.
  assert.deepEqual(ids(['gwen']), ['ann', 'bert', 'gwen', 'kit']);
});

void test('immediate family ends for every small or looping family shape', () => {
  const family = (records: string) =>
    parseGedcom(`0 HEAD\n1 _ATLAS\n2 _ROOT @A@\n${records}0 TRLR`);
  const ids = (data: ReturnType<typeof parseGedcom>, id?: string) =>
    immediateFamily(data, id).map((p) => p.id);
  const person = (id: string) => `0 @${id}@ INDI\n1 NAME ${id} /Penhallow/\n`;
  const couple = (id: string, a: string, b: string) =>
    `0 @${id}@ FAM\n1 HUSB @${a}@\n1 WIFE @${b}@\n`;
  // Two partners with no parents or children: each sees the other.
  const two = family(person('A') + person('B') + couple('F1', 'A', 'B'));
  assert.deepEqual(ids(two), ['A', 'B']);
  assert.deepEqual(ids(two, 'B'), ['B', 'A']);
  // One person alone.
  assert.deepEqual(ids(family(person('A'))), ['A']);
  // Partners in a ring, none with parents or children.
  const ring = family(
    person('A') +
      person('B') +
      person('C') +
      couple('F1', 'A', 'B') +
      couple('F2', 'B', 'C') +
      couple('F3', 'C', 'A'),
  );
  for (const id of ['A', 'B', 'C']) {
    const found = ids(ring, id);
    assert.equal(found[0], id);
    assert.equal(found.length, 2);
  }
  // A person recorded as their own partner.
  assert.deepEqual(ids(family(person('A') + couple('F1', 'A', 'A'))), ['A']);
  // Someone who married in still sees their partner's family.
  const marriedIn = family(
    person('A') +
      person('B') +
      person('P') +
      couple('F1', 'A', 'B') +
      `0 @F2@ FAM\n1 HUSB @P@\n1 CHIL @B@\n`,
  );
  assert.deepEqual(ids(marriedIn), ['A', 'B', 'P']);
});
