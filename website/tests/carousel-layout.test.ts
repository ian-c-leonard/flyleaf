import test from 'node:test';
import assert from 'node:assert/strict';
import {
  carouselSlots,
  fitPhoto,
  tallestPhoto,
} from '../app/lib/carousel-layout.ts';

void test('a photograph fits its box at its own shape', () => {
  // A wide group photograph fills the width; a tall portrait the height.
  assert.deepEqual(fitPhoto(1.5, 600, 440), { width: 600, height: 400 });
  assert.deepEqual(fitPhoto(0.75, 600, 440), { width: 330, height: 440 });
  assert.deepEqual(fitPhoto(1, 300, 300), { width: 300, height: 300 });
  // A shape not known yet fills the box, rather than guessing.
  assert.deepEqual(fitPhoto(undefined, 600, 440), { width: 600, height: 440 });
  assert.deepEqual(fitPhoto(NaN, 600, 440), { width: 600, height: 440 });
  assert.deepEqual(fitPhoto(0, 600, 440), { width: 600, height: 440 });
  assert.deepEqual(fitPhoto(1.5, -20, 440), { width: 0, height: 0 });
});

void test('a carousel keeps the height its tallest photograph needs', () => {
  // All wide: the narrowest of them sets the height, below the limit.
  assert.equal(tallestPhoto([1.5, 2, 4 / 3], 600, 440), 440);
  assert.equal(tallestPhoto([1.5, 2, 1.6], 600, 440), 400);
  // The width matters: the same set on a phone needs less.
  assert.equal(tallestPhoto([1.5, 2, 1.6], 300, 440), 200);
  // One portrait needs the whole height, and so does an unknown shape.
  assert.equal(tallestPhoto([2, 0.7], 600, 440), 440);
  assert.equal(tallestPhoto([2, undefined], 600, 440), 440);
  assert.equal(tallestPhoto([], 600, 440), 0);
});

void test('carousel slots show a window and hold the items either side', () => {
  const slots = (count: number, index: number, visible: number) =>
    Object.fromEntries(
      carouselSlots(count, index, visible).map(({ item, slot }) => [
        item,
        slot,
      ]),
    );
  // Three on show from item 2; item 1 has just gone and item 5 comes next.
  assert.deepEqual(slots(10, 2, 3), { 1: -1, 2: 0, 3: 1, 4: 2, 5: 3 });
  // The window wraps round the end of the list, items in list order.
  assert.deepEqual(slots(10, 8, 3), { 7: -1, 8: 0, 9: 1, 0: 2, 1: 3 });
  assert.deepEqual(
    carouselSlots(10, 8, 3).map(({ item }) => item),
    [0, 1, 7, 8, 9],
  );
  // One more item than fits: it waits to come next.
  assert.deepEqual(slots(4, 1, 3), { 1: 0, 2: 1, 3: 2, 0: 3 });
  // Too few to move: each item keeps its own slot.
  assert.deepEqual(slots(2, 1, 4), { 0: 0, 1: 1 });
  assert.deepEqual(slots(0, 0, 3), {});
  // Moving on by one moves every item down one slot.
  const before = slots(12, 5, 4);
  const after = slots(12, 6, 4);
  for (const item of Object.keys(after))
    if (item in before && before[item] > -1)
      assert.equal(after[item], before[item] - 1);
});
