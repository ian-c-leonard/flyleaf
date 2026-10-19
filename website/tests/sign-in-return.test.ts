import test from 'node:test';
import assert from 'node:assert/strict';
import { destination } from '../public/login/runtime.js';

const origin = 'https://example.family';
const after = (returnTo: string, hash = '') =>
  destination('?returnTo=' + encodeURIComponent(returnTo), origin, hash);

void test('sign-in returns to a page on this site', () => {
  assert.equal(after('/#view=book'), '/#view=book');
  assert.equal(after('/data/manifest.json?x=1'), '/data/manifest.json?x=1');
  assert.equal(destination('', origin, ''), '/');
});

void test('sign-in never sends a reader to another site', () => {
  for (const attempt of [
    '/.//evil.example/',
    '/..//evil.example/',
    '/%2e//evil.example/',
    '/./%2F/evil.example',
    '//evil.example/',
    '///evil.example/',
    'https://evil.example/',
    '/\\evil.example',
    'javascript:alert(1)',
  ]) {
    const path = after(attempt);
    assert.ok(
      path.startsWith('/') && !path.startsWith('//'),
      `${attempt} -> ${path}`,
    );
    assert.equal(new URL(path, origin).origin, origin, attempt);
  }
});

void test('sign-in never returns to the sign-in page or the API', () => {
  assert.equal(after('/login?returnTo=/'), '/');
  assert.equal(after('/api/session'), '/');
});
