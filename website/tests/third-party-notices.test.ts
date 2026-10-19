import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  SOURCE_SANS_COPYRIGHT,
  fontLicense,
  thirdPartyNotices,
} from '../scripts/third-party-notices.mjs';

const site = path.resolve(import.meta.dirname, '..');

void test('a built site carries the licences of the code it ships, and they stay current', () => {
  const notices = thirdPartyNotices(site);
  assert.match(notices, /^Flyleaf\n\nMIT License/m);
  assert.match(notices, /^react 19\.\S+ \(MIT\)/m);
  // Leaflet's BSD licence asks for its conditions to travel with the code.
  assert.match(
    notices,
    /^leaflet \S+ \(BSD-2-Clause\)[\s\S]*Redistribution and use in source and binary forms/m,
  );
  assert.doesNotMatch(notices, /^@playwright\/test /m);
  assert.doesNotMatch(notices, /^oxlint /m);
  // prepare.mjs writes it on every build; the committed copy must match.
  assert.equal(
    readFileSync(path.join(site, 'public/licenses/third-party.txt'), 'utf8'),
    notices,
  );
});

void test('the Source Sans 3 licence names Adobe, whose font it is', () => {
  const packaged = readFileSync(
    path.join(site, 'node_modules/@fontsource-variable/source-sans-3/LICENSE'),
    'utf8',
  );
  assert.ok(
    fontLicense('@fontsource-variable/source-sans-3', packaged).startsWith(
      SOURCE_SANS_COPYRIGHT,
    ),
  );
  for (const copy of [
    'public/licenses/source-sans-3-OFL.txt',
    'public/login/fonts/source-sans-3-OFL.txt',
    '../pages/fonts/source-sans-3-OFL.txt',
  ])
    assert.ok(
      readFileSync(path.join(site, copy), 'utf8').startsWith(
        SOURCE_SANS_COPYRIGHT,
      ),
      copy,
    );
});
