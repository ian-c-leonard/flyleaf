import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGedcom } from '../app/lib/gedcom.ts';
import {
  archiveCatalog,
  documentDescription,
  documentKind,
  readerLocator,
  resolveDocument,
  structuredReaderText,
} from '../app/lib/archive.ts';
import { familyFocus } from '../app/lib/branches.ts';

void test('file reading guidance stays complete and belongs to its selected source context', () => {
  const first =
    'Full-width crop; the enlarged strip below shows the fine type.';
  const second = 'This held image also carries the next item on the page.';
  const data = parseGedcom(`0 HEAD
1 _ARCHIVE_CATALOG
2 SOUR @FIRST@
2 SOUR @SECOND@
0 @I@ INDI
1 NAME Example /Reader/
0 @FIRST@ SOUR
1 TITL Newspaper column
1 OBJE
2 FILE images/column.png
3 _KIND newspaper-page
3 _NATURE ${first}
3 NOTE The captain is not named.
0 @SECOND@ SOUR
1 TITL Adjoining notice
1 OBJE
2 FILE images/column.png
3 _KIND newspaper-page
3 _NATURE ${second}
0 TRLR`);
  const descriptions = data.sources.map((source) =>
    documentDescription(resolveDocument(data, source.id)!.archives[0]),
  );
  assert.deepEqual(descriptions, [first, second]);
  assert.equal(
    resolveDocument(data, data.sources[0].id)!.archives[0].note,
    'The captain is not named.',
  );
});

void test('legacy file classification identifiers keep their existing readable kind label', () => {
  const data = parseGedcom(`0 HEAD
1 _ARCHIVE_CATALOG
2 SOUR @SOURCE@
0 @I@ INDI
1 NAME Example /Reader/
0 @SOURCE@ SOUR
1 TITL Record index
1 OBJE
2 FILE images/index.json
3 _KIND record-index
3 _NATURE partial-provider-index
0 TRLR`);
  const file = resolveDocument(data, data.sources[0].id)!.archives[0];
  assert.equal(documentDescription(file), '');
  assert.equal(documentKind(file), 'Part of an index');
  assert.equal(documentDescription({ ...file, nature: '' }), '');
});

void test('a primary source keeps its index attachment class and original capture text', () => {
  const data = parseGedcom(`0 HEAD
0 @I@ INDI
1 NAME Example /Reader/
1 BIRT
2 SOUR @S@
0 @S@ SOUR
1 TITL Original birth register
1 _TIER primary
1 OBJE
2 FILE images/index.json
3 _KIND record-index
3 _NATURE derivative-index
3 NOTE The register gives another month; the index date is not used.
0 TRLR`);
  const source = data.sources[0];
  const document = resolveDocument(data, source.id)!;
  assert.equal(documentKind(document.archives[0]), 'Index entry');
  assert.match(document.archives[0].note || '', /not used/);
  const body =
    '19 March\n<script>do not execute</script>\nSuggested records: another person';
  const capture = JSON.stringify({
    body,
    buttons: ['Save'],
    url: 'https://example.org/index',
  });
  assert.equal(structuredReaderText(capture, document.archives[0].kind), body);
  assert.equal(structuredReaderText(capture, 'record-extraction'), capture);
  for (const unknown of [
    'not JSON',
    '{"body":null}',
    '{"unrecognized":"keep all"}',
  ])
    assert.equal(structuredReaderText(unknown, 'record-index'), unknown);
  assert.equal(
    documentKind({ ...document.archives[0], nature: 'partial-provider-index' }),
    'Part of an index',
  );
});

void test('mixed research readings retain their full original and their own label', () => {
  const data = parseGedcom(`0 HEAD
1 _ARCHIVE_CATALOG
2 SOUR @S@
0 @I@ INDI
1 NAME Example /Reader/
0 @S@ SOUR
1 TITL Account book
1 _TIER primary
1 OBJE
2 FILE images/reading.json
3 _KIND research-note
3 _NATURE mixed-source-reading-and-dated-provenance
3 NOTE A retained reading with interpretation and older working notes.
0 TRLR`);
  const file = resolveDocument(data, data.sources[0].id)!.archives[0];
  const original = JSON.stringify(
    {
      body: '<script>retained source text</script>',
      interpretation: 'Parentage is unproved.',
      old_status: 'Not yet read',
    },
    null,
    2,
  );
  assert.equal(documentKind(file), 'Research note');
  assert.equal(structuredReaderText(original, file.kind), original);
  assert.match(file.note || '', /older working notes/);
});

void test('a saved search stays distinct from an index entry and retains the complete query', () => {
  const data = parseGedcom(`0 HEAD
1 _ARCHIVE_CATALOG
2 SOUR @S@
0 @I@ INDI
1 NAME Example /Reader/
0 @S@ SOUR
1 TITL Retained will-book query
1 _STATUS research-only
1 _PERSON @I@
1 OBJE
2 FILE images/search.json
3 _KIND search-capture
3 _NATURE provider-search-results
3 NOTE County:1907 was the saved query; no will was found.
0 TRLR`);
  const file = resolveDocument(data, data.sources[0].id)!.archives[0];
  const original = JSON.stringify({
    body: 'No matching entries',
    query: 'Wills County:1907',
  });
  assert.equal(documentKind(file), 'Search result');
  assert.equal(structuredReaderText(original, file.kind), original);
  assert.equal(data.sources[0].researchOnly, true);
  assert.deepEqual(data.people[0].sourceIds, []);
  assert.match(file.note || '', /no will was found/);
});

void test('provider index readers handle old text captures without hiding conflicting or unknown fields', () => {
  const text =
    'Name: Thomas Treloar\nDeath: 17 November 1904\nSuggested records: a different person';
  for (const fields of [
    { text },
    { body: text },
    { body: text, text },
    { displayed_record_and_source_text: text },
    { body: text, displayed_record_and_source_text: text },
    { body: text, text, displayed_record_and_source_text: text },
  ]) {
    const capture = JSON.stringify({
      url: 'https://example.org/index',
      captureMethod: 'saved visible text',
      ...fields,
    });
    assert.equal(structuredReaderText(capture, 'record-index'), text);
    assert.equal(structuredReaderText(capture, 'record-extraction'), capture);
    assert.equal(structuredReaderText(capture, 'research-note'), capture);
  }
  for (const fields of [
    { body: 'A conflicting record', text },
    { body: { transcription: 'Keep this record' }, text },
    { body: text, text: ['A separate record'] },
    { body: null, text },
    { text, displayed_record_and_source_text: 'A conflicting record' },
    { body: 'A conflicting record', displayed_record_and_source_text: text },
    { text, displayed_record_and_source_text: null },
    { displayed_record_and_source_text: { transcription: text } },
    { displayed_record_and_source_text: [text] },
    { displayed_record_and_source_text: 1953 },
    { displayed_record_and_source_text: ' \n' },
    { text: 1904 },
    { text: ' \n' },
    { unrecognized: text },
    [text],
    null,
  ]) {
    const capture = JSON.stringify(fields);
    assert.equal(structuredReaderText(capture, 'record-index'), capture);
  }
});

void test('an authored obituary web capture retains its explicit saved-page label', () => {
  const data = parseGedcom(`0 HEAD
0 @I@ INDI
1 NAME Example /Reader/
1 SOUR @S@
0 @S@ SOUR
1 TITL Obituary
1 OBJE
2 FILE images/obituary.pdf
3 _KIND web-page
3 _NATURE authored-obituary-web-capture
3 NOTE The paper's home town is not proof of where she died.
0 TRLR`);
  const file = resolveDocument(data, data.sources[0].id)!.archives[0];
  assert.equal(documentKind(file), 'Saved web page');
  assert.match(file.note || '', /not proof of where she died/);
  assert.equal(
    documentKind({
      ...file,
      kind: 'research-note',
      nature: 'authored-assessment',
    }),
    'Research note',
  );
});

void test('shared source notes retain files and distinct reference locators without becoming personal photos', () => {
  const data = parseGedcom(`0 HEAD
0 @I@ INDI
1 NAME First /Reader/
1 NOTE @SOURCE@
2 PAGE Reference page 12
1 NOTE @SOURCE@
2 PAGE Reference page 18
1 NOTE @WRAPPER@
0 @J@ INDI
1 NAME Second /Reader/
1 NOTE @SOURCE@
0 @SOURCE@ NOTE [Source] A compiled profile — https://example.org/profile
1 PAGE Shared default locator
1 OBJE @MEDIA@
0 @MEDIA@ OBJE
1 FILE images/profile.pdf
0 @WRAPPER@ NOTE An ordinary shared note
1 NOTE @CYCLE@
1 OBJE
2 FILE images/portrait.jpg
0 @CYCLE@ NOTE Another ordinary shared note
1 NOTE @WRAPPER@
1 NOTE @SOURCE@
2 PAGE Reference page 21
0 TRLR`);
  assert.deepEqual(
    data.sources.map((s) => s.locator),
    [
      'Reference page 12',
      'Reference page 18',
      'Reference page 21',
      'Shared default locator',
    ],
  );
  assert.equal(new Set(data.sources.map((s) => s.id)).size, 4);
  for (const source of data.sources) {
    assert.equal(source.label, 'A compiled profile');
    assert.equal(source.url, 'https://example.org/profile');
    assert.deepEqual(
      source.archives.map((f) => f.path),
      ['images/profile.pdf'],
    );
  }
  assert.deepEqual(
    data.assets.map((a) => a.path),
    ['images/portrait.jpg'],
  );
  assert.deepEqual(
    data.people[0].sourceIds,
    data.sources.slice(0, 3).map((s) => s.id),
  );
  assert.deepEqual(data.people[1].sourceIds, [data.sources[3].id]);
  const profile = archiveCatalog(data).find(
    (e) => e.file.path === 'images/profile.pdf',
  )!;
  assert.equal(profile.document.context, 'source');
  assert.equal(profile.sourceIds.length, 4);
});

void test('legacy source-note files keep citation identity and never enter personal albums', () => {
  const original = `0 HEAD
0 @I@ INDI
1 NAME First /Reader/
1 NOTE [Source] Compiled profile — archived images/profile.pdf
2 PAGE Literal legacy locator
1 EVEN
2 NOTE [Source] An image of the register
3 PAGE Printed page 8
1 NOTE @N@
0 @N@ NOTE A family photograph
1 OBJE
2 FILE images/portrait.jpg
0 TRLR`;
  const withFiles = original
    .replace(
      '2 PAGE Literal legacy locator',
      '2 PAGE Literal legacy locator\n2 OBJE\n3 FILE images/profile.pdf',
    )
    .replace(
      '3 PAGE Printed page 8',
      '3 PAGE Printed page 8\n3 OBJE\n4 FILE images/register.jpg',
    );
  const before = parseGedcom(original),
    after = parseGedcom(withFiles);
  assert.deepEqual(after.people, before.people);
  assert.deepEqual(after.assets, before.assets);
  assert.deepEqual(
    after.sources.map(
      ({ archives: _archives, archivePath: _archivePath, ...s }) => s,
    ),
    before.sources.map(
      ({ archives: _archives, archivePath: _archivePath, ...s }) => s,
    ),
  );
  assert.deepEqual(
    after.sources.map((s) => s.archives.map((f) => f.path)),
    [['images/profile.pdf'], ['images/register.jpg']],
  );
  assert.deepEqual(
    archiveCatalog(after)
      .map((e) => e.file.path)
      .sort(),
    ['images/portrait.jpg', 'images/profile.pdf', 'images/register.jpg'],
  );
});

void test('book illustrations retain exact captions and shared-file citations without becoming personal photographs', () => {
  const data = parseGedcom(`0 HEAD
1 _ATLAS
2 _ROOT @I1@
1 _ARCHIVE_CATALOG
2 OBJE @M@
0 @I1@ INDI
1 NAME Example /Ancestor/
1 SOUR @S@
2 PAGE Printed page 12
0 @S@ SOUR
1 TITL Existing source
1 OBJE
2 FILE images/group.jpg
0 @M@ OBJE
1 FILE images/group.jpg
1 TITL Caption names two sitters; the third is unassigned.
1 _TYPE book-illustration
1 _CREDIT Illustration and caption from the family book.
0 TRLR`);
  assert.deepEqual(data.people[0].assetIds, []);
  assert.equal(data.assets.length, 1);
  assert.equal(data.sources.length, 1);
  const catalog = archiveCatalog(data);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].document.context, 'book-illustration');
  const opened = resolveDocument(data, catalog[0].document.id);
  assert.equal(
    opened?.archives[0].title,
    'Caption names two sitters; the third is unassigned.',
  );
  assert.deepEqual(opened?.sourceIds, [data.sources[0].id]);
  assert.equal(data.sources[0].locator, 'Printed page 12');
});
import { readRoute, routeHref } from '../app/lib/navigation.ts';

const fixture = `0 HEAD
1 FILE metadata-only.ged
0 @I@ INDI
1 NAME First /Reader/
1 SOUR @S@
2 PAGE page 12
1 SOUR @S@
2 PAGE page 18
1 OBJE @M@
0 @J@ INDI
1 NAME Second /Reader/
1 SOUR @T@
0 @S@ SOUR
1 TITL A register
1 _TIER 1
1 OBJE @R@
1 _ARCHIVE images/front.jpg
2 _KIND government-record
2 _NATURE derivative-crop
2 _LOCATOR A cropped detail
0 @T@ SOUR
1 TITL Another citation of the same file
1 OBJE
2 FILE images/front.jpg
1 OBJE
2 FILE images/other.pdf
0 @R@ OBJE
1 FILE images/front.jpg
2 TITL Front of the register
1 FILE images/back.jpg
2 TITL Reverse of the register
0 @M@ OBJE
1 FILE images/portrait.jpg
2 TITL An unidentified family photograph
1 FILE images/letter.txt
2 TITL A family letter
0 TRLR`;

void test('native source attachments retain multiple files and separate citation locators', () => {
  const data = parseGedcom(fixture),
    sources = data.sources.filter((s) => s.label === 'A register');
  assert.deepEqual(
    sources.map((s) => s.locator),
    ['page 12', 'page 18'],
  );
  assert.notEqual(sources[0].id, sources[1].id);
  for (const s of sources) {
    assert.deepEqual(
      s.archives.map((f) => f.path),
      ['images/front.jpg', 'images/back.jpg'],
    );
    assert.equal(s.archives[0].title, 'Front of the register');
    assert.equal(s.archives[0].locator, 'A cropped detail');
    assert.equal(documentKind(s.archives[0]), 'Cropped or edited detail');
    assert.equal(
      documentKind(s.archives[1]),
      'Image file',
      'a primary source tier does not classify an unexamined attachment',
    );
  }
  assert.deepEqual(
    data.assets.map((a) => a.path),
    ['images/portrait.jpg', 'images/letter.txt'],
  );
  assert.deepEqual(
    data.people[0].assetIds,
    data.assets.map((a) => a.id),
  );
});

void test('a file appears once with all explicit citation links and searchable owners', () => {
  const data = parseGedcom(fixture),
    catalog = archiveCatalog(data);
  assert.equal(catalog.length, 5);
  const front = catalog.find((e) => e.file.path === 'images/front.jpg')!;
  assert.equal(front.sourceIds.length, 3);
  assert.match(front.searchText, /first reader/);
  assert.match(front.searchText, /second reader/);
  assert.match(front.searchText, /another citation/);
  assert.equal(
    catalog.some((e) => e.file.path === 'metadata-only.ged'),
    false,
  );
});

void test('an attachment without a source stays an attachment on reload and never invents a citation', () => {
  const data = parseGedcom(fixture),
    catalog = archiveCatalog(data);
  const entry = catalog.find((e) => e.file.path === 'images/portrait.jpg')!;
  assert.equal(entry.document.context, 'attachment');
  assert.deepEqual(entry.sourceIds, []);
  assert.equal(data.sources.length, 3);
  assert.match(entry.searchText, /first reader/);
  const route = readRoute('#view=archive&record=' + entry.document.id, data);
  assert.equal(route.record, entry.document.id);
  assert.equal(route.file, entry.file.path);
  assert.deepEqual(readRoute(routeHref(route), data), route);
  assert.equal(resolveDocument(data, route.record)?.context, 'attachment');
  assert.equal(resolveDocument(data, 'absent'), null);
  const malicious = readRoute(
    '#view=archive&record=' + route.record + '&file=../private',
    data,
  );
  assert.equal(malicious.file, entry.file.path);
});

void test('branch archives contain only files linked to that selection; shared files keep local citation context', () => {
  const data = parseGedcom(fixture);
  const first = archiveCatalog(familyFocus(data, 'I').data),
    second = archiveCatalog(familyFocus(data, 'J').data);
  assert.equal(first.length, 4);
  assert.equal(second.length, 2);
  assert.equal(
    second.some((e) => e.file.path === 'images/portrait.jpg'),
    false,
  );
  assert.equal(
    first.find((e) => e.file.path === 'images/front.jpg')!.sourceIds.length,
    2,
  );
  assert.equal(
    second.find((e) => e.file.path === 'images/front.jpg')!.sourceIds.length,
    1,
  );
});

void test('shared note attachments are read without following cyclic note pointers forever', () => {
  const data = parseGedcom(
    `0 HEAD\n0 @I@ INDI\n1 NAME A /Person/\n1 SOUR @S@\n0 @S@ SOUR\n1 TITL Register\n1 NOTE @N@\n0 @N@ NOTE Attached reproduction\n1 NOTE @N@\n1 OBJE @M@\n0 @M@ OBJE\n1 FILE images/page.jpg\n0 TRLR`,
  );
  assert.equal(archiveCatalog(data)[0].file.path, 'images/page.jpg');
  assert.equal(
    data.assets.length,
    0,
    'a source document is not a personal portrait',
  );
});

void test('partial, index and derivative descriptions take precedence over document categories', () => {
  const file = {
    path: 'images/file.pdf',
    kind: 'book',
    nature: 'partial-capture',
    locator: '',
    status: '',
  };
  assert.equal(documentKind(file), 'Partial capture');
  assert.equal(
    documentKind({
      ...file,
      kind: 'newspaper-page',
      nature: 'derivative-crop',
    }),
    'Cropped or edited detail',
  );
  assert.equal(
    documentKind({ ...file, kind: 'photograph', nature: 'index-capture' }),
    'Index or profile',
  );
  assert.equal(documentKind({ ...file, kind: '', nature: '' }), 'PDF document');
});

void test('the actual scoped archive accounts for every packaged file without widening the family selection', () => {
  const root = new URL('../public/data/', import.meta.url);
  const data = parseGedcom(readFileSync(new URL('family.ged', root), 'utf8'));
  const manifest = JSON.parse(
    readFileSync(new URL('manifest.json', root), 'utf8'),
  );
  const catalog = archiveCatalog(data);
  assert.deepEqual(
    [
      ...catalog.map((e) => e.file.path),
      ...(manifest.book ? [manifest.book.path] : []),
    ].sort((a, b) => a.localeCompare(b)),
    [...manifest.assets].sort((a: string, b: string) => a.localeCompare(b)),
  );
  assert.deepEqual(manifest.missingAssets, []);
});

void test('other citations of a held file remain accessible without replacing the chosen PAGE', () => {
  const data = parseGedcom(fixture),
    source = data.sources[0];
  const front = resolveDocument(data, source.id, 'images/front.jpg')!;
  assert.equal(front.locator, 'page 12');
  assert.equal(front.id, source.id);
  assert.equal(front.sourceIds.length, 3);
  const back = resolveDocument(data, source.id, 'images/back.jpg')!;
  assert.equal(back.sourceIds.length, 2);
  const route = readRoute(
    '#view=archive&record=' + source.id + '&file=images/front.jpg',
    data,
  );
  const restored = readRoute(routeHref(route), data);
  assert.deepEqual(
    resolveDocument(data, restored.record, restored.file),
    front,
  );
});

void test('citation-owned media belongs to its exact PAGE citation rather than becoming an uncited portrait', () => {
  const data = parseGedcom(`0 HEAD
0 @I@ INDI
1 NAME First /Reader/
1 BIRT
2 SOUR @S@
3 PAGE page 7
3 OBJE
4 FILE images/p7-front.jpg
1 SOUR @S@
2 PAGE page 7
2 OBJE
3 FILE images/p7-back.jpg
1 SOUR @S@
2 PAGE page 9
2 OBJE @M@
0 @S@ SOUR
1 TITL Register
0 @M@ OBJE
1 FILE images/p9.jpg
0 TRLR`);
  assert.equal(data.assets.length, 0);
  assert.equal(data.sources.length, 2);
  assert.deepEqual(
    data.sources[0].archives.map((f) => f.path),
    ['images/p7-front.jpg', 'images/p7-back.jpg'],
  );
  assert.deepEqual(
    data.sources[1].archives.map((f) => f.path),
    ['images/p9.jpg'],
  );
  assert.equal(archiveCatalog(data).length, 3);
  assert.equal(
    archiveCatalog(data).every((e) => e.document.context === 'source'),
    true,
  );
});

void test('a locator that names another archive file is hidden from readers', () => {
  assert.equal(
    readerLocator('images/newspapers/1912-03-07-iowa-county-lantern-p1.jpg'),
    '',
  );
  assert.equal(readerLocator(undefined), '');
  assert.equal(
    readerLocator('Births, column 1; reel page 5, image 418230946'),
    'Births, column 1; reel page 5, image 418230946',
  );
});
