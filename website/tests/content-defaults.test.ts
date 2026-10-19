import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { contentDefaults, contentFile } from '../flyleaf-settings.mjs';
import { familyRecipeBook } from '../app/lib/family-recipes.ts';
import { validateGeography } from '../app/lib/places.ts';
import type { AtlasData } from '../app/lib/gedcom.ts';

const app = new URL('../app/', import.meta.url);
const sourceFiles = (dir: URL): URL[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(new URL(entry.name + '/', dir))
      : /\.tsx?$/.test(entry.name)
        ? [new URL(entry.name, dir)]
        : [],
  );
const imported = new Set(
  sourceFiles(app).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/'@content\/([\w.-]+)'/g)].map(
      (m) => m[1],
    ),
  ),
);
const readDefault = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(contentDefaults, name), 'utf8'));

void test('every content file the app imports has an empty default and a type', () => {
  const declared = readFileSync(new URL('content.d.ts', app), 'utf8');
  assert.ok(imported.size >= 10);
  for (const name of imported) {
    assert.doesNotThrow(() => readDefault(name), name);
    assert.ok(declared.includes(`'@content/${name}'`), name);
  }
});

void test("a family's own file wins; a missing one falls back to the default", () => {
  const family = mkdtempSync(path.join(tmpdir(), 'flyleaf-content-'));
  const settings = { paths: { site_content: 'content' } };
  writeFileSync(path.join(family, 'flyleaf.json'), JSON.stringify(settings));
  const saved = process.env.FLYLEAF_FAMILY;
  process.env.FLYLEAF_FAMILY = family;
  try {
    assert.equal(
      contentFile('albums.json', settings),
      path.join(contentDefaults, 'albums.json'),
    );
    mkdirSync(path.join(family, 'content'));
    writeFileSync(path.join(family, 'content', 'albums.json'), '[]');
    assert.equal(
      contentFile('albums.json', settings),
      path.join(family, 'content', 'albums.json'),
    );
  } finally {
    if (saved === undefined) delete process.env.FLYLEAF_FAMILY;
    else process.env.FLYLEAF_FAMILY = saved;
  }
});

void test('the empty defaults pass the same checks as family content', () => {
  assert.equal(familyRecipeBook(readDefault('family-recipes.json')), null);
  const empty = {
    people: [],
    families: [],
    sources: [],
    places: [],
  } as unknown as AtlasData;
  assert.doesNotThrow(() =>
    validateGeography(readDefault('geography.json'), empty),
  );
});

void test('the default screenshots show only pages every site has', () => {
  // A static site has no sign-in page, so the defaults cannot include it.
  const screens = readDefault('screens.json') as { id: string; hash: string }[];
  assert.ok(screens.length > 0);
  for (const screen of screens)
    assert.match(screen.hash, /^(#view=[a-z]+)?$/, screen.id);
});
