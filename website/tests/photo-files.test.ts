import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGedcom } from '../app/lib/gedcom.ts';
import { imageSequence, photoFiles } from '../app/lib/photo-files.ts';

const hash = 'a'.repeat(64);
const fixture = `0 HEAD
1 _ATLAS
2 _ROOT @A@
1 _ARCHIVE_CATALOG
2 OBJE @CROP@
2 OBJE @FRAME@
2 _REPRESENTATION @C@
2 _REPRESENTATION @D@
0 @A@ INDI
1 NAME Alice /Family/
1 REFN alice
1 SOUR @S@
0 @S@ SOUR
1 TITL Supplied photograph
1 OBJE
2 FILE images/original.heic
3 _KIND photograph
0 @CROP@ OBJE
1 FILE images/portrait.png
2 _SHA256 ${hash}
1 TITL Alice portrait detail
1 _CONTENT photograph
1 _ALBUM display
1 _VISUAL_ROLE portrait
1 _SUBJECT @A@
0 @FRAME@ OBJE
1 FILE images/frame.jpg
2 _SHA256 ${hash}
1 TITL Alice and family
1 _CONTENT photograph
1 _ALBUM display
1 _VISUAL_ROLE group
1 _SUBJECT @A@
0 @C@ _REPRESENTATION
1 FILE images/portrait.png
1 _PARENT
2 FILE images/frame.jpg
1 _ROLE crop
0 @D@ _REPRESENTATION
1 FILE images/frame.jpg
1 _PARENT
2 FILE images/original.heic
1 _ROLE derived
1 _RECIPE {"completeFrame":true}
0 TRLR
`;

void test('a declared portrait crop opens its full display frame and downloads the held HEIC', () => {
  const data = parseGedcom(fixture);
  const before = structuredClone(data);
  const portrait = data.assets.find((a) => a.path === 'images/portrait.png')!;
  const full = data.assets.find((a) => a.path === 'images/frame.jpg')!;
  const result = photoFiles(data, portrait);
  assert.equal(result.displayedLabel, 'Download this close-up');
  assert.equal(result.complete?.id, full.id);
  assert.equal(result.original?.path, 'images/original.heic');
  assert.equal(photoFiles(data, full).original?.path, 'images/original.heic');
  assert.equal(photoFiles(data, full).complete, undefined);
  assert.deepEqual(data, before);
});

void test('ambiguous, composite, cyclic or undocumented parents cannot claim an original or complete photograph', () => {
  const variants = [
    fixture
      .replace(
        '2 _REPRESENTATION @D@',
        '2 _REPRESENTATION @D@\n2 _REPRESENTATION @X@',
      )
      .replace(
        '0 TRLR',
        '0 @X@ _REPRESENTATION\n1 FILE images/portrait.png\n1 _PARENT\n2 FILE images/another.jpg\n1 _ROLE crop\n0 TRLR',
      ),
    fixture.replace('1 _ROLE crop', '1 _ROLE composite'),
    fixture.replace(
      '2 FILE images/original.heic',
      '2 FILE images/portrait.png',
    ),
    fixture.replace('1 _RECIPE {"completeFrame":true}', '1 _RECIPE {}'),
    fixture.replace('1 _RECIPE {"completeFrame":true}', '1 _RECIPE malformed'),
    fixture.replace('1 _ROLE derived', '1 _ROLE extracted-image'),
    fixture.replace('3 _KIND photograph', '3 _KIND document'),
  ];
  for (const variant of variants) {
    const data = parseGedcom(variant);
    const asset = data.assets.find((a) => a.path === 'images/portrait.png')!;
    const result = photoFiles(data, asset);
    assert.equal(result.original, undefined);
    assert.equal(result.complete, undefined);
    assert.equal(result.displayedLabel.includes('original'), false);
  }
});

void test('photographic parentage does not relabel artwork or invent an unrecorded source file', () => {
  for (const variant of [
    fixture.replace('1 _CONTENT photograph', '1 _CONTENT artwork'),
    fixture.replace(
      '1 TITL Alice and family\n1 _CONTENT photograph',
      '1 TITL Alice and family\n1 _CONTENT artwork',
    ),
    fixture.replace(
      '2 FILE images/original.heic\n3 _KIND photograph',
      '2 FILE images/unrelated.heic\n3 _KIND photograph',
    ),
  ]) {
    const data = parseGedcom(variant);
    const asset = data.assets.find((a) => a.path === 'images/portrait.png')!;
    assert.equal(photoFiles(data, asset).original, undefined);
    assert.equal(photoFiles(data, asset).complete, undefined);
  }
});

void test('a declared original JPEG is downloaded unchanged, without a redundant complete-frame action', () => {
  const data = parseGedcom(
    fixture
      .replaceAll('images/original.heic', 'images/frame.jpg')
      .replace('2 _REPRESENTATION @D@\n', '')
      .replace(/0 @D@ _REPRESENTATION[\s\S]*?0 TRLR/, '0 TRLR'),
  );
  const asset = data.assets.find((a) => a.path === 'images/frame.jpg')!;
  assert.equal(photoFiles(data, asset).original?.path, asset.path);
  assert.equal(photoFiles(data, asset).complete, undefined);
});

void test('the image sequence preserves the supplied gallery order without adding source neighbours', () => {
  const data = parseGedcom(fixture);
  const crop = data.assets.find((a) => a.path === 'images/portrait.png')!;
  const frame = data.assets.find((a) => a.path === 'images/frame.jpg')!;
  data.assets.push({
    id: 'download-only',
    path: 'images/original.heic',
    title: 'Original',
    credit: '',
    rights: '',
  });
  assert.deepEqual(
    imageSequence(data, crop.id, [
      frame.id,
      crop.id,
      frame.id,
      'download-only',
      'missing',
    ]),
    [frame.id, crop.id],
  );
  assert.deepEqual(imageSequence(data, crop.id, []), [crop.id]);
  assert.deepEqual(imageSequence(data, crop.id, [frame.id]), [crop.id]);
  assert.deepEqual(imageSequence(data, 'download-only', ['download-only']), []);
});
