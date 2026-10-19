import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readPreviewIndex, sha256, sha256Bytes } from '../app/lib/previews.ts';

const sourceHash = 'b'.repeat(64);
const path = 'images/full-map.jpg';
function manifest() {
  return {
    schema: 1,
    gedcomSha256: 'family-revision',
    files: {
      [path]: {
        sourceSha256: sourceHash,
        sourceSize: [4000, 2000],
        displayedSize: [4000, 2000],
        frames: 1,
        variants: {
          '640': {
            path: `previews/${'a'.repeat(16)}-${sourceHash}/640.webp`,
            size: [640, 320],
          },
          '1600': {
            path: `previews/${'a'.repeat(16)}-${sourceHash}/1600.webp`,
            size: [1600, 800],
          },
        },
      },
    },
  };
}

void test('only derivatives tied to the loaded family revision are accepted', async () => {
  const fixture = manifest();
  assert.equal(
    Object.keys(readPreviewIndex(fixture, 'family-revision')).length,
    1,
  );
  assert.deepEqual(readPreviewIndex(fixture, 'different-family'), {});
  assert.equal(
    await sha256(new TextEncoder().encode('abc').buffer),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

void test('invalid preview paths, wrong source identity and cropped dimensions are rejected', () => {
  for (const altered of [
    'https://external.example/map.webp',
    '../secret.webp',
    `previews/${'a'.repeat(16)}-${'c'.repeat(64)}/640.webp`,
  ]) {
    const fixture = manifest();
    fixture.files[path].variants['640'].path = altered;
    assert.deepEqual(readPreviewIndex(fixture, 'family-revision'), {});
  }
  for (const size of [
    [640, 640],
    [641, 320],
    [0, 0],
    [400, 200],
  ]) {
    const fixture = manifest();
    fixture.files[path].variants['640'].size = size;
    assert.deepEqual(readPreviewIndex(fixture, 'family-revision'), {});
  }
});

void test('malformed optional indexes are ignored while valid entries survive', () => {
  for (const value of [
    null,
    [],
    'bad',
    { ...manifest(), files: [] },
    { ...manifest(), files: { '../image.jpg': manifest().files[path] } },
  ])
    assert.deepEqual(readPreviewIndex(value, 'family-revision'), {});
  const fixture = manifest();
  assert.equal(
    Object.keys(
      readPreviewIndex(
        { ...fixture, files: { ...fixture.files, 'images/bad.jpg': {} } },
        'family-revision',
      ),
    ).length,
    1,
  );
});

void test('files hash the same without Web Crypto, as over plain HTTP', async () => {
  for (const size of [0, 1, 55, 56, 63, 64, 65, 1000, 100_003]) {
    const bytes = new Uint8Array(size).map((_, i) => (i * 31 + size) & 255);
    const expected = createHash('sha256').update(bytes).digest('hex');
    assert.equal(Buffer.from(sha256Bytes(bytes)).toString('hex'), expected);
  }
  const subtle = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
  Object.defineProperty(globalThis, 'crypto', {
    value: {},
    configurable: true,
  });
  try {
    assert.equal(
      await sha256(new TextEncoder().encode('abc').buffer),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  } finally {
    Object.defineProperty(globalThis, 'crypto', subtle);
  }
});
