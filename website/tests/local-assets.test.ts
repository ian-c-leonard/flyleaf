import test from 'node:test';
import assert from 'node:assert/strict';
import { safeRelativePath, localAssetPaths } from '../app/lib/local-assets.ts';
import { localFileUrl } from '../app/lib/archive.ts';
void test('local folders preserve exact paths and support Windows GEDCOM separators', () => {
  assert.deepEqual(localAssetPaths('family/images/portrait.jpg'), [
    'family/images/portrait.jpg',
    'images/portrait.jpg',
  ]);
  assert.equal(safeRelativePath('images\\portrait.jpg'), 'images/portrait.jpg');
  assert.equal(
    safeRelativePath('./images/portrait.jpg'),
    'images/portrait.jpg',
  );
  assert.equal(
    localFileUrl('/data/', 'images/A & B.jpg'),
    '/data/images/A%20%26%20B.jpg',
  );
});
void test('imported media paths cannot request remote URLs or escape the selected folder', () => {
  for (const path of [
    '../secret',
    'images/../../secret',
    'https://remote/image.jpg',
    '//remote/file',
    'C:\\photo.jpg',
    '/etc/file',
    'javascript:alert(1)',
    'images/\0file',
  ])
    assert.equal(safeRelativePath(path), null, path);
  assert.equal(localFileUrl('', 'images/portrait.jpg'), '');
});
