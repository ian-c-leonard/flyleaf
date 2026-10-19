import test from 'node:test';
import assert from 'node:assert/strict';
import { trustedSignIn } from '../public/login/runtime.js';

const key = (mode: string, service: string) =>
  `pk_${mode}_` + btoa(service + '$').replace(/=+$/, '');
const config = (publishableKey: string, frontendApi: string) => ({
  publishableKey,
  frontendApi,
  clerkVersion: '6.31.1',
  uiVersion: '1.32.3',
});

void test('a live key must name clerk.<this site> as its sign-in service', () => {
  const live = key('live', 'clerk.example.family');
  assert.equal(live.includes('='), false);
  assert.ok(trustedSignIn(config(live, 'https://clerk.example.family'), 'example.family'));
  assert.equal(trustedSignIn(config(live, 'https://clerk.example.family'), 'other.family'), false);
  assert.equal(trustedSignIn(config(live, 'https://clerk.other.family'), 'example.family'), false);
});

void test('a test key may use a Clerk development host while a family sets up', () => {
  const dev = key('test', 'happy-otter-12.clerk.accounts.dev');
  const api = 'https://happy-otter-12.clerk.accounts.dev';
  assert.ok(trustedSignIn(config(dev, api), 'localhost:8787'));
  assert.equal(trustedSignIn(config(dev, 'https://evil.example'), 'localhost:8787'), false);
  const elsewhere = key('test', 'evil.example');
  assert.equal(trustedSignIn(config(elsewhere, 'https://evil.example'), 'localhost:8787'), false);
});

void test('malformed keys and versions are refused', () => {
  const api = 'https://clerk.example.family';
  for (const bad of ['', 'sk_live_abc', 'pk_live_', 'pk_live_' + btoa('clerk.example.family'), 'pk_live_!!']) {
    assert.equal(trustedSignIn(config(bad, api), 'example.family'), false, bad);
  }
  const live = key('live', 'clerk.example.family');
  assert.equal(
    trustedSignIn({ ...config(live, api), clerkVersion: 'latest' }, 'example.family'),
    false,
  );
});
