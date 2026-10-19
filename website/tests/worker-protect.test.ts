import { test } from 'node:test';
import assert from 'node:assert/strict';
import { protect } from '../worker/archive.ts';

// Cloudflare compresses text/plain but skips the registered GEDCOM type.
// A family file can be several megabytes, so it leaves labelled as plain text.
void test('The family GEDCOM is served as compressible plain text', () => {
  const response = protect(
    new Response('0 HEAD\n', {
      headers: { 'Content-Type': 'text/vnd.familysearch.gedcom' },
    }),
  );
  assert.equal(
    response.headers.get('Content-Type'),
    'text/plain; charset=utf-8',
  );
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  const json = protect(
    new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
  );
  assert.equal(json.headers.get('Content-Type'), 'application/json');
});

void test('Every Worker answer keeps to HTTPS and turns off device features', () => {
  for (const type of ['text/html', 'application/json', 'image/jpeg']) {
    const response = protect(
      new Response('x', { headers: { 'Content-Type': type } }),
    );
    assert.equal(
      response.headers.get('Strict-Transport-Security'),
      'max-age=31536000',
      type,
    );
    const policy = response.headers.get('Permissions-Policy') ?? '';
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment'])
      assert.match(policy, new RegExp(`(^|, )${feature}=\\(\\)`), type);
  }
});
