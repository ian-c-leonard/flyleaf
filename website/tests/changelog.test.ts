import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { changelog, releaseDate } from '../app/lib/changelog.ts';

void test('the site history lists releases newest first, each with changes', () => {
  // A family with no site history yet has an empty list.
  const numbers = changelog.map((r) => r.version.split('.').map(Number));
  for (let i = 1; i < numbers.length; i++) {
    const [a, b] = [numbers[i - 1], numbers[i]];
    assert.ok(a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]), 'newest first');
    assert.ok(changelog[i - 1].date >= changelog[i].date, 'dates descend');
  }
  for (const release of changelog) {
    assert.match(release.version, /^\d+\.\d+$/);
    assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(release.changes.length > 0);
    for (const change of release.changes) assert.match(change, /^\S.*[.?!]$/);
  }
});

void test('release dates read day, month, year, as in the book, in any time zone', () => {
  assert.equal(releaseDate('2026-10-16'), '16 October 2026');
  assert.equal(releaseDate('2026-01-01'), '1 January 2026');
  // The browser's language setting does not change them.
  const saved = Object.getOwnPropertyDescriptor(
    Date.prototype,
    'toLocaleDateString',
  )!;
  Object.defineProperty(Date.prototype, 'toLocaleDateString', {
    ...saved,
    value: () => 'Okt. 16, 2026',
  });
  try {
    assert.equal(releaseDate('2026-10-16'), '16 October 2026');
  } finally {
    Object.defineProperty(Date.prototype, 'toLocaleDateString', saved);
  }
});

void test('a family with no releases yet has no current release', () => {
  // The changelog is read when the module loads, so load it in a family whose
  // site content folder is empty and which therefore uses the empty default.
  const family = mkdtempSync(path.join(tmpdir(), 'flyleaf-changelog-'));
  const settings = readFileSync(
    new URL('../../sample/flyleaf.json', import.meta.url),
    'utf8',
  );
  writeFileSync(path.join(family, 'flyleaf.json'), settings);
  const changelogModule = new URL('../app/lib/changelog.ts', import.meta.url)
    .href;
  try {
    const output = execFileSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--import',
        new URL('./helpers/settings.mjs', import.meta.url).href,
        '--input-type=module',
        '-e',
        `const { changelog, currentRelease } = await import(${JSON.stringify(changelogModule)});
console.log(JSON.stringify({ releases: changelog.length, current: currentRelease ?? null }));`,
      ],
      { env: { ...process.env, FLYLEAF_FAMILY: family }, encoding: 'utf8' },
    );
    assert.deepEqual(JSON.parse(output), { releases: 0, current: null });
  } finally {
    rmSync(family, { recursive: true, force: true });
  }
});
