import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cardProblem, proofProblem } from '../public/login/card.js';
import {
  cardCodeHash,
  cardCodeShape,
  normalizeCardCode,
} from '../shared/card-code.mjs';

void test('a card code is read the same however it is typed', async () => {
  for (const typed of ['K7M-4QX', 'k7m 4qx', ' K7m.4qx\n', 'k7m4qx'])
    assert.equal(normalizeCardCode(typed), 'K7M4QX', typed);
  assert.equal(normalizeCardCode(null), '');
  assert.equal(normalizeCardCode('x'.repeat(500)).length, 64);
  assert.equal(await cardCodeHash('k7m 4qx'), await cardCodeHash('K7M-4QX'));
  assert.notEqual(await cardCodeHash('K7M-4QX'), await cardCodeHash('K7M-4QW'));
  assert.match(await cardCodeHash('K7M-4QX'), /^[a-f0-9]{64}$/);
  assert.equal(cardCodeShape('K7M-4QX'), true);
  for (const wrong of ['', 'K7M-4', '------', 'x'.repeat(41)])
    assert.equal(cardCodeShape(wrong), false, wrong);
});

void test('every refused card step is explained in plain words', () => {
  const said = (status: number, body: Parameters<typeof cardProblem>[1]) =>
    cardProblem(status, body, 'Ada');
  assert.equal(said(404, { error: 'no-match' }), 'That code doesn’t match a card. Please check it and try again.');
  assert.equal(
    said(200, { used: true, hint: 't…@example.com' }),
    'This card has already been used. Sign in below with the email address you chose (t…@example.com).',
  );
  assert.equal(
    said(409, { error: 'used' }),
    'This card has already been used. Sign in below with the email address you chose.',
  );
  assert.equal(said(429, { error: 'too-many', wait: 'hour' }), 'Too many tries. Please wait an hour and try again, or contact Ada.');
  assert.equal(said(429, { error: 'too-many', wait: 'day' }), 'Too many tries today. Please try again tomorrow, or contact Ada.');
  assert.equal(said(400, { error: 'email' }), 'That email address doesn’t look right. Please check it and try again.');
  assert.equal(said(403, { error: 'other-email' }), 'You’re signed in with a different email address. Please try another address, or contact Ada.');
  assert.equal(said(429, { error: 'too-many-emails' }), 'This card has tried too many email addresses. Please contact Ada.');
  assert.equal(said(409, { error: 'busy' }), 'That didn’t go through. Please try again.');
  assert.equal(said(503, { error: 'unavailable' }), 'Cards are not ready yet. Please tell Ada.');
  for (const [status, body] of [[0, null], [500, null], [400, { error: 'request' }], [503, null]] as const)
    assert.equal(said(status, body), 'That didn’t work. Please check your connection and try again.');
});

void test('a refused six-digit code is explained in plain words', () => {
  const error = (code: string) => ({ errors: [{ code }] });
  assert.equal(proofProblem(error('form_code_incorrect')), 'That code isn’t right. Please check the email and try again.');
  assert.equal(proofProblem(error('verification_expired')), 'That code has expired. Choose “Send the code again”.');
  for (const problem of [error('verification_failed'), error('too_many_requests'), { status: 429 }])
    assert.equal(proofProblem(problem), 'Too many tries. Please wait a few minutes, then choose “Send the code again”.');
  for (const problem of [null, undefined, new Error('offline'), { errors: 'nonsense' }])
    assert.equal(proofProblem(problem), 'That didn’t work. Please check your connection and try again.');
});

void test('the sign-in page carries the card steps, hidden until the site turns cards on', () => {
  const page = readFileSync(new URL('../templates/login.html', import.meta.url), 'utf8');
  for (const hidden of ['<section id="card" class="card" aria-labelledby="card-title" hidden>', '<p id="card-or" class="card-or" hidden>', '<p id="card-help" hidden>'])
    assert.ok(page.includes(hidden), hidden);
  // Fields a phone and a password manager fill correctly.
  assert.match(page, /id="card-email"[^>]*type="email"[^>]*autocomplete="email"/);
  assert.match(page, /id="card-proof"[^>]*inputmode="numeric"[^>]*autocomplete="one-time-code"/);
  assert.match(page, /id="card-code"[^>]*autocomplete="off"[^>]*autocapitalize="characters"/);
});
