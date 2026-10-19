// Write wrangler.jsonc, the Cloudflare Worker configuration, from the
// family's flyleaf.json.
//
//   node scripts/write-wrangler.mjs           write wrangler.jsonc
//   node scripts/write-wrangler.mjs --check   exit 1 if it is out of date
//
// Binding names, the compatibility date and logging are part of the code. The
// family supplies its names, account IDs, sign-in lists and address.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FamilyError, readSettings, sharingOn } from '../flyleaf-settings.mjs';
import { isMain } from './is-main.mjs';

const site = fileURLToPath(new URL('..', import.meta.url));
const target = path.join(site, 'wrangler.jsonc');

/** The Worker's settings, also given to tests and build scripts. Off the
 * deploy path (strict false), a family without sign-in or hosting yet gets
 * empty values instead of an error. */
export function workerVars(settings = readSettings(), { strict = true } = {}) {
  const need = (value, name) => {
    if (value === undefined || value === null || value === '') {
      if (strict) throw new FamilyError(`flyleaf.json is missing ${name}`);
      return Array.isArray(value) ? value : '';
    }
    return value;
  };
  const auth = settings.auth || {};
  const domain = need(settings.site?.domain, 'site.domain');
  const list = (values, name) => [].concat(need(values, name) || []).join(',');
  return {
    CLERK_PUBLISHABLE_KEY: need(
      auth.clerk_publishable_key,
      'auth.clerk_publishable_key',
    ),
    ALLOWED_EMAILS: list(auth.allowed_emails, 'auth.allowed_emails'),
    VIEWER_PEOPLE: Object.entries(auth.viewer_people || {})
      .map(([email, person]) => `${email}=${person}`)
      .join(','),
    ADMIN_EMAILS: list(auth.admin_emails, 'auth.admin_emails'),
    ALLOWED_HOSTS: domain,
    // Relatives may send things only when features.submissions is true.
    SUBMISSIONS_OPEN: sharingOn(settings) ? 'true' : 'false',
    CLERK_FRONTEND_API: need(
      auth.clerk_frontend_api,
      'auth.clerk_frontend_api',
    ),
    MAINTAINER_NAME: need(
      settings.maintainer?.first_name,
      'maintainer.first_name',
    ),
    BOOK_PDF_NAME: need(settings.book?.pdf_name, 'book.pdf_name'),
  };
}

/** Settings that work but should not stay on a live site. Deploy prints
 * them at the end, where a long log cannot hide them. */
export function deployWarnings(settings = readSettings()) {
  const warnings = [];
  if (String(settings.auth?.clerk_publishable_key || '').startsWith('pk_test_'))
    warnings.push(
      'auth.clerk_publishable_key is a Clerk development key (pk_test_). ' +
        'Clerk development instances are for testing, not for a live site. ' +
        'Switch to your production instance and its pk_live_ key.',
    );
  return warnings;
}

export function wranglerConfig(settings = readSettings()) {
  const need = (value, name) => {
    if (value === undefined || value === null || value === '')
      throw new FamilyError(`flyleaf.json is missing ${name}`);
    return value;
  };
  const cf = settings.cloudflare || {};
  const domain = need(settings.site?.domain, 'site.domain');
  return {
    $schema: 'node_modules/wrangler/config-schema.json',
    name: need(cf.worker_name, 'cloudflare.worker_name'),
    main: 'worker/index.ts',
    account_id: need(cf.account_id, 'cloudflare.account_id'),
    compatibility_date: '2026-09-12',
    compatibility_flags: ['nodejs_compat'],
    workers_dev: false,
    preview_urls: false,
    routes: [{ pattern: domain, custom_domain: true }],
    assets: {
      directory: './dist/hosting/assets',
      binding: 'ASSETS',
      run_worker_first: true,
      not_found_handling: 'none',
    },
    r2_buckets: [
      {
        binding: 'ARCHIVE',
        bucket_name: need(cf.archive_bucket, 'cloudflare.archive_bucket'),
      },
      {
        binding: 'SUBMISSIONS_FILES',
        bucket_name: need(
          cf.submissions_bucket,
          'cloudflare.submissions_bucket',
        ),
      },
    ],
    d1_databases: [
      {
        binding: 'SUBMISSIONS_DB',
        database_name: need(
          cf.submissions_db?.name,
          'cloudflare.submissions_db.name',
        ),
        database_id: need(
          cf.submissions_db?.id,
          'cloudflare.submissions_db.id',
        ),
        migrations_dir: 'migrations/submissions',
      },
    ],
    secrets: { required: ['CLERK_SECRET_KEY'] },
    vars: workerVars(settings),
    observability: {
      enabled: true,
      redact_query_string: true,
      logs: { enabled: true, head_sampling_rate: 1 },
      traces: { enabled: true, head_sampling_rate: 0.01 },
    },
  };
}

export function render(settings) {
  return (
    '// Generated from flyleaf.json by scripts/write-wrangler.mjs. Do not edit.\n' +
    JSON.stringify(wranglerConfig(settings), null, 2) +
    '\n'
  );
}

if (isMain(import.meta.url)) {
  const text = render();
  if (process.argv.includes('--check')) {
    const current = readFileSync(target, 'utf8');
    if (current !== text) {
      console.error(
        'wrangler.jsonc is out of date. Run node scripts/write-wrangler.mjs.',
      );
      process.exit(1);
    }
    console.log('wrangler.jsonc matches flyleaf.json');
  } else {
    writeFileSync(target, text);
    console.log('Wrote wrangler.jsonc from flyleaf.json');
  }
}
