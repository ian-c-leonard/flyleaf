// Check that the live site serves exactly the files in the local hosting
// package. Run after every deploy.
//
//   node scripts/verify-live.mjs              check every published file
//   node scripts/verify-live.mjs --full       also read every original in full
//   node scripts/verify-live.mjs --signed-out check that a visitor without a
//                                             session is sent to sign in
//
// Signed out, with no cookies: the home page must redirect to /login, and the
// family tree and an original must answer 401. Nothing else is read.
//
// Each static file is read and its SHA-256 compared. Each original in the
// file archive is checked by its size and by the MD5 of its bytes, which R2
// reports as its ETag; that costs one byte of download per file. An original
// whose ETag is not an MD5 is read in full, as --full reads every one.
//
// The live site needs a signed-in browser. LIVE_PROFILE points at a Chrome
// profile that is already signed in (default ~/.local/state/<site id>/live-profile).
// SITE_ORIGIN overrides the address in flyleaf.json.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestStream } from './archive-sync.mjs';
import { etagMd5 } from './upload-new-originals.mjs';
import { familyRoot, readSettings } from '../flyleaf-settings.mjs';
import { isMain } from './is-main.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const address = (relative) =>
  '/' + relative.split('/').map(encodeURIComponent).join('/');

/** Every file a deploy publishes: the static files, and the originals in the
 * file archive (dist/hosting/objects.json). */
export async function publishedFiles(site) {
  const assets = path.join(site, 'dist/hosting/assets');
  const plan = JSON.parse(
    await readFile(path.join(site, 'dist/hosting/objects.json'), 'utf8'),
  );
  const statics = (await readdir(assets, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path
        .relative(assets, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join('/'),
    )
    .sort();
  if (statics.length !== plan.staticFiles)
    throw new Error(
      `The hosting package holds ${statics.length} static files, but ` +
        `objects.json lists ${plan.staticFiles}. Run npm run prepare:hosting again.`,
    );
  return { assets, statics, originals: plan.files };
}

/** Compare the live site with the local package. `request(method, path,
 * headers)` resolves to { status, ok, header(name), body() }. Returns how
 * many files were checked and one line for each file that differs. */
export async function checkLive(
  site,
  request,
  { full = false, concurrency = 4 } = {},
) {
  const { assets, statics, originals } = await publishedFiles(site);
  const problems = [];
  const differs = (status, file, why) =>
    problems.push(`${status} DIFFERENT ${file}${why ? ` (${why})` : ''}`);
  const same = async (response, sha256) =>
    response.status === 200 && sha(await response.body()) === sha256;
  const readWhole = async (file, sha256) => {
    const response = await request('GET', address(file));
    if (!(await same(response, sha256))) differs(response.status, file);
  };
  const checks = [
    ...statics.map((file) => async () =>
      readWhole(file, sha(await readFile(path.join(assets, file))))),
    ...originals.map((file) => async () => {
      const relative = 'data/' + file.key.slice('archive/'.length);
      const local = await digestStream(
        createReadStream(path.join(site, file.path)),
      );
      if (local.sha256 !== file.sha256 || local.bytes !== file.bytes)
        return differs('local', relative, 'changed since it was packaged');
      if (full || file.bytes === 0) return readWhole(relative, file.sha256);
      // One byte brings back the file's size and ETag.
      const response = await request('GET', address(relative), {
        Range: 'bytes=0-0',
      });
      const size = /^bytes 0-0\/(\d+)$/.exec(
        response.header('content-range') ?? '',
      )?.[1];
      const md5 = etagMd5(response.header('etag'));
      if (response.status === 200) {
        if (!(await same(response, file.sha256)))
          differs(response.status, relative);
      } else if (response.status !== 206) differs(response.status, relative);
      else if (size === undefined || md5 === undefined)
        await readWhole(relative, file.sha256);
      else if (
        Number(size) !== file.bytes ||
        md5 !== Buffer.from(local.md5, 'base64').toString('hex')
      )
        differs(response.status, relative);
    }),
  ];
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < checks.length) await checks[next++]();
    }),
  );
  return {
    checked: checks.length,
    problems: problems.sort((a, b) => a.localeCompare(b)),
  };
}

/** What a visitor with no session must get: the home page sends them to the
 * sign-in page, and the family tree and one original are refused. */
export async function signedOutChecks(site) {
  const { originals } = await publishedFiles(site);
  const checks = [
    { path: '/', redirect: '/login' },
    { path: '/data/family.ged', status: 401 },
  ];
  if (originals.length)
    checks.push({
      path: address('data/' + originals[0].key.slice('archive/'.length)),
      status: 401,
    });
  return checks;
}

/** Run signedOutChecks against the live site. `request(url)` must not follow
 * redirects and must send no cookies; it resolves to { status,
 * header(name) }. Returns one line for each answer that is wrong. */
export async function checkSignedOut(origin, request, checks) {
  const problems = [];
  for (const check of checks) {
    let response;
    try {
      response = await request(origin + check.path);
    } catch (error) {
      problems.push(`${check.path}: no answer (${error.message})`);
      continue;
    }
    if (check.redirect) {
      const location = response.header('location') ?? '';
      let target = null;
      try {
        target = new URL(location, origin);
      } catch {}
      const redirected = response.status >= 300 && response.status < 400;
      if (
        !redirected ||
        target?.origin !== new URL(origin).origin ||
        target.pathname !== check.redirect
      )
        problems.push(
          `${check.path}: answered ${response.status} ${location}`.trim() +
            `, not a redirect to ${check.redirect}`,
        );
    } else if (response.status !== check.status)
      problems.push(
        `${check.path}: answered ${response.status}, not ${check.status}`,
      );
  }
  return problems;
}

if (isMain(import.meta.url) && process.argv.includes('--signed-out')) {
  const site = fileURLToPath(new URL('..', import.meta.url));
  const origin = process.env.SITE_ORIGIN || readSettings().site.origin;
  const request = async (url) => {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    await response.body?.cancel();
    return {
      status: response.status,
      header: (name) => response.headers.get(name),
    };
  };
  const problems = await checkSignedOut(
    origin,
    request,
    await signedOutChecks(site),
  );
  for (const line of problems) console.error(line);
  if (problems.length) {
    console.error('The live site is open to visitors who have not signed in.');
    process.exit(1);
  }
  console.log(`${origin} sends visitors who have not signed in to /login.`);
} else if (isMain(import.meta.url)) {
  const site = fileURLToPath(new URL('..', import.meta.url));
  const require = createRequire(path.join(site, 'package.json'));
  const { chromium } = require('playwright-core');
  const settings = readSettings();
  const origin = process.env.SITE_ORIGIN || settings.site.origin;
  const profile =
    process.env.LIVE_PROFILE ||
    path.join(homedir(), '.local/state', settings.site.id, 'live-profile');
  if (!existsSync(profile)) {
    console.error(`No signed-in browser profile at ${profile}. Set LIVE_PROFILE.`);
    process.exit(2);
  }
  const assets = path.join(site, 'dist/hosting/assets');
  const book = JSON.parse(readFileSync(path.join(assets, 'data/book.json'), 'utf8'));
  const pdf = JSON.stringify(book).match(/publications\/[a-f0-9]{64}\/[^"/]+\.pdf/)?.[0];
  // The book PDF lives in the file archive, under a path named by its own
  // hash. Check it against that hash and against the local book build.
  const localPdf = path.join(familyRoot(), 'build/book.pdf');

  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: true,
  });
  let result;
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(origin + '/');
    const request = async (method, pathname, headers = {}) => {
      const res = await page.request.fetch(origin + pathname, { method, headers });
      return {
        status: res.status(),
        ok: res.ok(),
        header: (name) => res.headers()[name],
        body: () => res.body(),
      };
    };
    result = await checkLive(site, request, {
      full: process.argv.includes('--full'),
    });
    if (pdf) {
      const res = await page.request.get(origin + '/data/' + pdf);
      const live = sha(await res.body());
      const named = pdf.split('/')[1];
      const local = existsSync(localPdf) ? sha(readFileSync(localPdf)) : '';
      if (!res.ok() || live !== named || local !== named)
        result.problems.push(
          [
            res.status(),
            'DIFFERENT',
            'data/' + pdf,
            live === named ? '' : '(live bytes differ from its name)',
            local === named ? '' : '(local build/book.pdf differs)',
          ]
            .filter(Boolean)
            .join(' '),
        );
    }
  } finally {
    await context.close();
  }
  for (const line of result.problems) console.log(line);
  console.log(
    result.problems.length
      ? `${result.problems.length} of ${result.checked} live files differ from the local package`
      : `All ${result.checked} published files match the local package`,
  );
  process.exit(result.problems.length ? 1 : 0);
}
