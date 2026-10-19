import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGedcom } from '../app/lib/gedcom.ts';
import {
  archiveCatalog,
  archiveGroups,
  resolveDocument,
  documentKind,
  connectedDocument,
  provenanceNote,
} from '../app/lib/archive.ts';
import type { VisualMedia } from '../app/lib/visuals.ts';
import { familyFocus } from '../app/lib/branches.ts';
import { readRoute, routeHref } from '../app/lib/navigation.ts';

const fixture = `0 HEAD
1 _ATLAS
2 _ROOT @R@
1 _ARCHIVE_CATALOG
2 OBJE @BOOK@
2 _REPRESENTATION @V1@
2 _REPRESENTATION @V2@
2 _REPRESENTATION @V3@
0 @R@ INDI
1 NAME Root /Family/
1 FAMC @F@
0 @A@ INDI
1 NAME First /Parent/
1 SOUR @S1@
2 PAGE page 7, left column
0 @B@ INDI
1 NAME Second /Parent/
1 SOUR @S2@
2 PAGE page 12
0 @F@ FAM
1 HUSB @A@
1 WIFE @B@
1 CHIL @R@
0 @S1@ SOUR
1 TITL First newspaper
1 OBJE
2 FILE images/first.jpg
0 @S2@ SOUR
1 TITL Second newspaper
1 OBJE
2 FILE images/second.jpg
0 @BOOK@ OBJE
1 FILE images/book.jpg
1 TITL Two publications beside one another. One face is unidentified.
1 _TYPE book-illustration
0 @V1@ _REPRESENTATION
1 FILE images/crop.jpg
1 _PARENT
2 FILE images/first.jpg
1 _ROLE crop
1 _METHOD Crop the left photograph.
0 @V2@ _REPRESENTATION
1 FILE images/book.jpg
1 _PARENT
2 FILE images/crop.jpg
1 _ROLE composite
1 _METHOD Combine the two dated publications.
0 @V3@ _REPRESENTATION
1 FILE images/book.jpg
1 _PARENT
2 FILE images/second.jpg
1 _ROLE composite
1 _METHOD Combine the two dated publications.
0 TRLR`;

void test('reviewed exact-file titles name untitled versions without changing source titles or ownership', () => {
  const data = parseGedcom(fixture);
  const visual: VisualMedia = {
    path: 'images/crop.jpg',
    assetId: '',
    title: 'An identified portrait detail',
    content: 'photograph',
    album: 'display',
    role: 'portrait',
    avatarEligible: false,
    avatarPosition: 'top',
    qualified: false,
    subjectIds: [],
    associatedIds: [],
    captionPeople: [],
    commemoratedIds: [],
    otherSubjects: [],
    publicNote: '',
    note: '',
  };
  data.visuals = [visual];
  const before = structuredClone(data);
  const source = resolveDocument(data, data.sources[0].id)!;
  const crop = source.archives.find((file) => file.path === visual.path)!;
  assert.equal(crop.title, visual.title);
  const explicitlyTitled = connectedDocument(data, {
    ...source,
    archives: [{ ...crop, title: 'This citation’s retained file title' }],
  });
  assert.equal(
    explicitlyTitled.archives[0].title,
    'This citation’s retained file title',
  );
  const unrelated = connectedDocument(data, {
    ...source,
    archives: [{ ...crop, path: 'images/crop-other.jpg', title: undefined }],
  });
  assert.equal(unrelated.archives[0].title, undefined);
  assert.equal(unrelated.archives[0].path, 'images/crop-other.jpg');
  assert.deepEqual(data, before);
});

void test('one archive item retains both sources, intermediate versions and the exact book caption', () => {
  const data = parseGedcom(fixture);
  const groups = archiveGroups(data);
  assert.equal(groups.length, 1);
  assert.equal(archiveCatalog(data).length, 4);
  const document = resolveDocument(data, data.assets[0].id)!;
  assert.deepEqual(
    new Set(document.archives.map((f) => f.path)),
    new Set([
      'images/first.jpg',
      'images/second.jpg',
      'images/crop.jpg',
      'images/book.jpg',
    ]),
  );
  assert.equal(document.representations?.length, 3);
  assert.deepEqual(
    new Set(document.sourceIds),
    new Set(data.sources.map((s) => s.id)),
  );
  assert.deepEqual(
    document.archives.find((f) => f.path === 'images/book.jpg')?.bookCaptions,
    ['Two publications beside one another. One face is unidentified.'],
  );
  assert.deepEqual(
    data.sources.map((s) => s.locator),
    ['page 7, left column', 'page 12'],
  );
  assert.ok(data.people.every((p) => p.assetIds.length === 0));
  assert.equal(data.sources.length, 2);
});

void test('source ownership brings related versions into either branch without changing personal ownership', () => {
  const data = parseGedcom(fixture),
    before = structuredClone(data);
  for (const anchor of ['A', 'B']) {
    const focus = familyFocus(data, anchor).data;
    assert.equal(focus.assets.length, 1);
    assert.equal(focus.representations?.length, 3);
    assert.equal(focus.sources.length, 2);
    assert.equal(archiveGroups(focus)[0].versions.length, 4);
    const owner = focus.people.find((p) => p.id === anchor)!;
    assert.deepEqual(owner.assetIds, []);
    assert.equal(owner.sourceIds.length, 1);
  }
  assert.deepEqual(data, before);
});

void test('a derived file stays selected when changing citation context or reloading', () => {
  const data = parseGedcom(fixture);
  for (const source of data.sources) {
    const initial = readRoute(
      `#view=archive&record=${source.id}&file=images/book.jpg`,
      data,
    );
    const restored = readRoute(routeHref(initial), data);
    assert.equal(restored.file, 'images/book.jpg');
    assert.equal(restored.record, source.id);
    assert.equal(
      resolveDocument(data, restored.record, restored.file)?.locator,
      source.locator,
    );
  }
  const crop = archiveCatalog(data).find(
    (e) => e.file.path === 'images/crop.jpg',
  )!;
  assert.ok(
    resolveDocument(data, crop.document.id)?.archives.some(
      (f) => f.path === 'images/first.jpg',
    ),
  );
});

void test('similar file names and source labels do not group independent photographs', () => {
  const data = parseGedcom(fixture);
  data.assets.push({
    id: 'new-photo',
    path: 'images/book-new.jpg',
    title: data.assets[0].title,
    credit: '',
    rights: '',
  });
  assert.equal(archiveGroups(data).length, 2);
  assert.equal(resolveDocument(data, 'new-photo')?.representations, undefined);
  assert.ok(
    !familyFocus(data, 'A').data.assets.some((a) => a.id === 'new-photo'),
  );
});

void test('every offered citation can keep the selected file, including sources with unrelated attachments', () => {
  const data = parseGedcom(fixture);
  data.sources[0].archives.push({
    path: 'images/another-clip.jpg',
    kind: '',
    nature: '',
    locator: '',
    status: '',
  });
  const separate = resolveDocument(
    data,
    data.sources[0].id,
    'images/another-clip.jpg',
  )!;
  assert.deepEqual(separate.sourceIds, [data.sources[0].id]);
  for (const item of [...data.sources, ...data.assets]) {
    const document = resolveDocument(data, item.id)!;
    for (const file of document.archives) {
      const selected = resolveDocument(data, item.id, file.path)!;
      for (const sourceId of selected.sourceIds) {
        const next = readRoute(
          `#view=archive&record=${sourceId}&file=${file.path}`,
          data,
        );
        assert.equal(next.file, file.path);
        assert.equal(next.record, sourceId);
      }
    }
  }
});

void test('neutral version routes retain exact file qualifiers and a qualified active context wins', () => {
  const data = parseGedcom(fixture);
  Object.assign(data.sources[0].archives[0], {
    kind: 'newspaper-page',
    nature: 'partial-capture',
    locator: 'Column 1 only',
    page: 3,
  });
  const original = resolveDocument(data, 'V1')!.archives.find(
    (f) => f.path === 'images/first.jpg',
  )!;
  assert.equal(original.kind, 'newspaper-page');
  assert.equal(original.nature, 'partial-capture');
  assert.equal(original.locator, 'Column 1 only');
  assert.equal(original.page, 3);
  assert.equal(documentKind(original), 'Partial capture');
  data.sources.push({
    ...data.sources[0],
    id: 'alternate-citation',
    archives: [
      {
        ...data.sources[0].archives[0],
        locator: 'Explicit alternate file locator',
      },
    ],
  });
  assert.equal(
    resolveDocument(data, 'alternate-citation')!.archives[0].locator,
    'Explicit alternate file locator',
  );
});

void test('files are said to come from one record only when that record holds every original', () => {
  const origin = (text: string) => {
    const data = parseGedcom(text);
    const document = resolveDocument(data, data.assets[0].id)!;
    const oneRecord = /one record/.test(provenanceNote(document, 0));
    assert.equal(oneRecord, document.origin === 'one-record');
    return document.origin;
  };
  const loose =
    '0 @LOOSE@ OBJE\n1 FILE images/loose.jpg\n1 TITL A loose photograph\n';
  // A composite of two newspapers comes from two records.
  assert.equal(origin(fixture), undefined);
  // Made only from a crop of the first newspaper: one record.
  const fromFirst = fixture
    .replace('2 _REPRESENTATION @V3@\n', '')
    .replace(/0 @V3@ _REPRESENTATION\n(?:[1-9].*\n)*/, '');
  assert.equal(origin(fromFirst), 'one-record');
  // One part from the record and one loose photograph: not one record.
  const withLoose = fixture
    .replace(
      '2 FILE images/second.jpg\n1 _ROLE composite',
      '2 FILE images/loose.jpg\n1 _ROLE composite',
    )
    .replace('0 TRLR', loose + '0 TRLR');
  assert.equal(origin(withLoose), undefined);
  // Versions of one photograph that no record holds.
  const unsourced = fromFirst
    .replace('1 OBJE\n2 FILE images/first.jpg\n', '')
    .replace('images/first.jpg', 'images/loose.jpg')
    .replace('0 TRLR', loose + '0 TRLR');
  assert.equal(origin(unsourced), 'one-original');
});
