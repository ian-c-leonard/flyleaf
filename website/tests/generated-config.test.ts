import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { readSettings } from '../flyleaf-settings.mjs';
import { render } from '../scripts/write-wrangler.mjs';
import { renderLoginPage } from '../scripts/write-login-page.mjs';

// scripts/prepare.mjs writes these from the family's settings on every build.
const here = (file: string) => new URL('../' + file, import.meta.url);
const settings = readSettings();
const worker = (settings.site?.hosting || 'worker') === 'worker';

void test('the sign-in page is made from flyleaf.json, with nothing left to fill in', () => {
  const page = renderLoginPage(settings);
  assert.doesNotMatch(page, /\{\{\w+\}\}/);
  assert.match(page, new RegExp(settings.family.name));
  const built = here('public/login/index.html');
  if (existsSync(built)) assert.equal(readFileSync(built, 'utf8'), page);
});

void test('a Worker family gets a wrangler.jsonc made from flyleaf.json', () => {
  // This family's own file, when it publishes with the Worker.
  const built = here('wrangler.jsonc');
  if (worker && existsSync(built))
    assert.equal(readFileSync(built, 'utf8'), render(settings));
  // And an invented Worker family, so the check runs for a static family too.
  const example = {
    ...settings,
    site: { ...settings.site, hosting: 'worker', domain: 'example.family' },
    maintainer: { ...settings.maintainer, first_name: 'Ada' },
    book: { ...settings.book, pdf_name: 'example-family.pdf' },
    auth: {
      clerk_publishable_key: 'pk_live_example',
      clerk_frontend_api: 'https://clerk.example.family',
      allowed_emails: ['ada@example.org'],
      admin_emails: ['ada@example.org'],
      viewer_people: {},
    },
    cloudflare: {
      worker_name: 'example-family',
      account_id: 'example-account',
      archive_bucket: 'example-archive',
      submissions_bucket: 'example-submissions',
      submissions_db: { name: 'example-db', id: 'example-db-id' },
    },
  };
  const config = render(example);
  assert.match(config, /Generated from flyleaf.json/);
  assert.match(config, /"example-archive"/);
  assert.match(config, /"pattern": "example.family"/);
});
