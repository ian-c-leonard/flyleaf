import assert from 'node:assert/strict';
import test from 'node:test';
import { groupMapPoints } from '../app/lib/place-map.ts';

void test('map groups preserve every place once, including coincident and chained points', () => {
  const points = [
    { x: 0, y: 0, item: 'first' },
    { x: 0, y: 0, item: 'same-point-different-place' },
    { x: 50, y: 0, item: 'middle' },
    { x: 100, y: 0, item: 'last' },
    { x: 250, y: 250, item: 'separate' },
  ];
  const before = structuredClone(points);
  const groups = groupMapPoints(points);
  assert.deepEqual(points, before);
  assert.deepEqual(
    groups.map((group) => group.items),
    [['first', 'same-point-different-place', 'middle', 'last'], ['separate']],
  );
  assert.deepEqual(
    groups.flatMap((group) => group.items).sort(),
    points.map((point) => point.item).sort(),
  );
  assert.deepEqual(groupMapPoints([]), []);
});

void test('zooming separates distinct places while coincident references stay accessible as a group', () => {
  const locations = [
    { x: 0, y: 0, item: 'village' },
    { x: 10, y: 0, item: 'parish' },
    { x: 0, y: 0, item: 'county' },
  ];
  assert.equal(groupMapPoints(locations).length, 1);
  const zoomed = locations.map((point) => ({
    ...point,
    x: point.x * 8,
    y: point.y * 8,
  }));
  assert.deepEqual(
    groupMapPoints(zoomed).map((group) => group.items),
    [['village', 'county'], ['parish']],
  );
});

void test('centered groups do not cover another displayed marker', () => {
  const points = Array.from({ length: 16 }, (_, index) => ({
    x: Math.cos((index * Math.PI) / 8) * 100,
    y: Math.sin((index * Math.PI) / 8) * 100,
    item: String(index),
  }));
  points.push({ x: 0, y: 0, item: 'inside-the-ring' });
  const result = groupMapPoints(points);
  assert.equal(result.length, 1);
  assert.equal(result[0].items.length, 17);
});
