import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceGroupRanges } from '../app/lib/book-source-groups.ts';

void test('only adjacent actual note / compiler-comma / note siblings group', () => {
  assert.deepEqual(
    sourceGroupRanges([
      'other',
      'note',
      'comma',
      'space',
      'note',
      'other',
      'note',
    ]),
    [[1, 4]],
  );
  assert.deepEqual(
    sourceGroupRanges([
      'note',
      'space',
      'comma',
      'note',
      'comma',
      'space',
      'note',
    ]),
    [[0, 6]],
  );
});
void test('ordinary punctuation, words, repeated commas and a parent boundary never group', () => {
  for (const kinds of [
    ['note', 'other', 'note'],
    ['note', 'comma', 'other', 'note'],
    ['note', 'space', 'note'],
    ['note', 'comma', 'comma', 'note'],
    ['note', 'comma'],
    ['note'],
  ] satisfies ('note' | 'comma' | 'space' | 'other')[][])
    assert.deepEqual(sourceGroupRanges(kinds), []);
});
