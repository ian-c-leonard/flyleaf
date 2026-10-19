import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { writeReviewedAsset } from '../scripts/write-reviewed-asset.mjs';

void test('reviewed assets install complete bytes, reuse identical files and refuse different files', (t) => {
  const directory = fs.mkdtempSync(join(tmpdir(), 'family-reviewed-asset-'));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const destination = join(directory, 'asset.json');
  const content = '{"complete":true}\n';
  writeReviewedAsset(destination, content);
  assert.equal(fs.readFileSync(destination, 'utf8'), content);
  const before = fs.statSync(destination);
  writeReviewedAsset(destination, content);
  const after = fs.statSync(destination);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.throws(
    () => writeReviewedAsset(destination, 'different'),
    /different bytes/,
  );
  assert.equal(fs.readFileSync(destination, 'utf8'), content);
  assert.deepEqual(fs.readdirSync(directory), ['asset.json']);
});

void test('an interrupted asset write never exposes partial bytes or damages an earlier asset', (t) => {
  const directory = fs.mkdtempSync(join(tmpdir(), 'family-reviewed-asset-'));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const prior = join(directory, 'prior.json');
  const destination = join(directory, 'new.json');
  fs.writeFileSync(prior, 'earlier reviewed bytes');
  const originalWrite = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (file: fs.PathOrFileDescriptor) => {
    originalWrite(file, 'partial');
    throw new Error('ENOSPC injected after a partial write');
  });
  syncBuiltinESMExports();
  try {
    // Reusing the exact old asset never attempts a write, even under ENOSPC.
    writeReviewedAsset(prior, 'earlier reviewed bytes');
    assert.throws(
      () => writeReviewedAsset(destination, 'new reviewed bytes'),
      /ENOSPC/,
    );
    assert.equal(fs.existsSync(destination), false);
    assert.equal(fs.readFileSync(prior, 'utf8'), 'earlier reviewed bytes');
    assert.deepEqual(fs.readdirSync(directory), ['prior.json']);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

void test('a complete but corrupted staging write is rejected before publication', (t) => {
  const directory = fs.mkdtempSync(join(tmpdir(), 'family-reviewed-asset-'));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const destination = join(directory, 'asset.json');
  const originalWrite = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (file: fs.PathOrFileDescriptor) =>
    originalWrite(file, 'wrong bytes'),
  );
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => writeReviewedAsset(destination, 'reviewed bytes'),
      /incomplete bytes/,
    );
    assert.equal(fs.existsSync(destination), false);
    assert.deepEqual(fs.readdirSync(directory), []);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});
