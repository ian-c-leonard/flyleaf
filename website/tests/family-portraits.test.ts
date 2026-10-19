import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { parseGedcom } from '../app/lib/gedcom.ts';
import { contentFile } from './helpers/family-files.mjs';

const data = parseGedcom(
  readFileSync(new URL('../public/data/family.ged', import.meta.url), 'utf8'),
);

void test('every avatar portrait in the edition reaches the site', (t) => {
  // A record missing from the edition header list is dropped without warning.
  if (!existsSync(contentFile('edition.ged')))
    return t.skip('this family has no site overlay (edition.ged)');
  const edition = readFileSync(contentFile('edition.ged'), 'utf8');
  const paths = new Set(data.assets.map((asset) => asset.path));
  const missing = edition
    .split(/\n(?=0 )/)
    .filter(
      (record) =>
        /^0 @[^@]+@ OBJE/.test(record) && /\n1 _AVATAR Y\b/.test(record),
    )
    .map((record) => record.match(/\n1 FILE (\S+)/)![1])
    .filter((path) => !paths.has(path));
  assert.deepEqual(missing, []);
});
