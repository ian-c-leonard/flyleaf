import assert from 'node:assert/strict';
import test from 'node:test';

import { plainTitle, titleTarget, titleTargets } from '../app/lib/book-titles.ts';

const albums = [{ id: 'harbour-songs', title: 'Harbour Songs' }];
const collections = [{ id: 'grans-recipes', title: 'Gran’s Recipes' }];

void test('a title in the book opens its album or collection', () => {
  const targets = titleTargets(albums, collections);
  assert.deepEqual(titleTarget(targets, 'Harbour Songs'), {
    kind: 'album',
    id: 'harbour-songs',
  });
  assert.deepEqual(titleTarget(targets, "Gran's  Recipes"), {
    kind: 'collection',
    id: 'grans-recipes',
  });
});

void test('only the whole title counts', () => {
  const targets = titleTargets(albums, collections);
  assert.equal(titleTarget(targets, 'Harbour Songs, second pressing'), undefined);
  assert.equal(titleTarget(targets, 'Songs'), undefined);
  assert.equal(titleTarget(targets, ''), undefined);
});

void test('a title shared by two things opens neither', () => {
  const targets = titleTargets(albums, [
    { id: 'harbour-songs-book', title: 'harbour songs' },
  ]);
  assert.equal(titleTarget(targets, 'Harbour Songs'), undefined);
});

void test('apostrophes, case and spacing do not matter', () => {
  assert.equal(plainTitle('  Gran’s   RECIPES '), "gran's recipes");
});
