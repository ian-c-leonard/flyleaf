import assert from 'node:assert/strict';
import test from 'node:test';
import { readBookFocus } from '../app/lib/book-annotations.ts';

void test('Book focus survives serialized history only in the matching edition', () => {
  const version = 'a'.repeat(64);
  for (const target of [
    { version, kind: 'mention', value: 'C1-002-A03' },
    { version, kind: 'id', value: 'book-map-toggle' },
  ]) {
    assert.deepEqual(
      readBookFocus(JSON.parse(JSON.stringify(target)), version),
      target,
    );
    assert.equal(readBookFocus(target, 'b'.repeat(64)), null);
  }
});

void test('untrusted history cannot supply selectors or unbound focus targets', () => {
  const version = 'a'.repeat(64);
  for (const target of [
    null,
    {},
    { version, kind: 'selector', value: 'body' },
    { version, kind: 'id', value: 'x"] button' },
    { version, kind: 'mention', value: '' },
    { version, kind: 'id', value: 'a'.repeat(161) },
    { version: 'wrong', kind: 'mention', value: 'C1-002-A03' },
  ])
    assert.equal(readBookFocus(target, version), null);
});
