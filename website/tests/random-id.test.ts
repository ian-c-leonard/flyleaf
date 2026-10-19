import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomId } from '../app/lib/random-id.ts';

// The Worker's own pattern for submission and file ids.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

void test('a new id is a version-4 UUID, with or without crypto.randomUUID', () => {
  assert.match(randomId(), uuid);
  // Over plain HTTP, browsers leave out randomUUID but keep getRandomValues.
  const plainHttp = { getRandomValues: crypto.getRandomValues.bind(crypto) };
  const ids = new Set(Array.from({ length: 200 }, () => randomId(plainHttp)));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, uuid);
});

void test('the site calls no browser feature that needs HTTPS, except through a fallback', () => {
  // crypto.randomUUID and crypto.subtle exist only on HTTPS and localhost. A
  // family may serve a static site over plain HTTP, and the app must still run.
  const allowed: Record<string, RegExp> = {
    'lib/random-id.ts': /randomUUID/,
    'lib/previews.ts': /crypto\.subtle/,
  };
  const app = new URL('../app/', import.meta.url).pathname;
  const files = (readdirSync(app, { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f));
  for (const file of files) {
    const text = readFileSync(join(app, file), 'utf8');
    const uses = text.match(/crypto\.(?:randomUUID|subtle)/g) ?? [];
    for (const use of uses)
      assert.ok(allowed[file]?.test(use), `${file} uses ${use}; use randomId() or sha256() instead`);
  }
});
