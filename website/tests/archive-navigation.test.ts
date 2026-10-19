import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseGedcom } from '../app/lib/gedcom.ts';
import { homeRoute, readRoute, routeHref } from '../app/lib/navigation.ts';
import { archiveFilters, type ArchiveFilter } from '../app/lib/archive.ts';
import { contentFile } from './helpers/family-files.mjs';

const data = parseGedcom(`0 HEAD
0 @I1@ INDI
1 REFN tamsin-penhallow
1 NAME Tamsin /Penhallow/
1 SOUR @S1@
0 @I2@ INDI
1 REFN robert-penhallow
1 NAME Robert /Penhallow/
0 @S1@ SOUR
1 TITL A family letter
1 OBJE
2 FILE images/letters/1944-letter.pdf
0 TRLR`);

void test('an archive document link retains the exact branch, query, filter and expanded page', () => {
  const source = data.sources.find((source) => source.archives.length > 0)!;
  for (const kind of Object.keys(archiveFilters) as ArchiveFilter[]) {
    const route = {
      ...homeRoute,
      view: 'archive' as const,
      branch: 'tamsin-penhallow',
      archiveQuery: 'Penhallow & Treloar / 1932',
      archiveKind: kind,
      archivePage: 3,
      record: source.id,
      file: source.archives[0].path,
    };
    const restored = readRoute(routeHref(route), data);
    for (const field of [
      'view',
      'branch',
      'archiveQuery',
      'archiveKind',
      'archivePage',
      'record',
      'file',
    ] as const)
      assert.equal(restored[field], route[field], field);
  }
});

void test('untrusted archive controls use bounded defaults without affecting other route state', () => {
  for (const page of ['0', '-1', '2.5', '1e3', '10000', 'Infinity']) {
    const route = readRoute(
      '#view=archive&branch=robert-penhallow&archiveKind=unknown&archivePage=' +
        page +
        '&archiveQuery=' +
        'a'.repeat(200),
      data,
    );
    assert.equal(route.archiveKind, 'all');
    assert.equal(route.archivePage, 1);
    assert.equal(route.archiveQuery, 'a'.repeat(120));
    assert.equal(route.branch, 'robert-penhallow');
    assert.equal(route.view, 'archive');
  }
  const ordinary = new URLSearchParams(
    routeHref({ ...homeRoute, view: 'archive' }).slice(1),
  );
  assert.equal(ordinary.has('archiveKind'), false);
  assert.equal(ordinary.has('archivePage'), false);
  assert.equal(ordinary.has('archiveQuery'), false);
});

void test('every hand-picked home record is a picture in the site archive', () => {
  const current = parseGedcom(
    readFileSync(new URL('../public/data/family.ged', import.meta.url), 'utf8'),
  );
  const picks = JSON.parse(
    readFileSync(contentFile('home-records.json'), 'utf8'),
  ) as { path: string; title: string }[];
  const paths = new Set(current.assets.map((asset) => asset.path));
  assert.deepEqual(
    picks.filter((pick) => !paths.has(pick.path)).map((pick) => pick.path),
    [],
  );
});
