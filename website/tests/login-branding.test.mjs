import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readSettings } from '../flyleaf-settings.mjs';
import { installLoginPage, renderLoginPage } from '../scripts/write-login-page.mjs';
import { fontLicense, SOURCE_SANS_COPYRIGHT } from '../scripts/third-party-notices.mjs';

const files = [
  ['eb-garamond-latin-400-normal.woff2', '@fontsource/eb-garamond/files/eb-garamond-latin-400-normal.woff2'],
  ['source-sans-3-latin-wght-normal.woff2', '@fontsource-variable/source-sans-3/files/source-sans-3-latin-wght-normal.woff2'],
  ['eb-garamond-OFL.txt', '@fontsource/eb-garamond/LICENSE'],
  ['source-sans-3-OFL.txt', '@fontsource-variable/source-sans-3/LICENSE'],
];
const digest = (value) => createHash('sha256').update(value).digest('hex');
// A licence ships as its package holds it, but for Source Sans 3's copyright line.
const expected = async (original) => {
  const held = await readFile(new URL('../node_modules/' + original, import.meta.url));
  if (!original.endsWith('/LICENSE')) return held;
  return Buffer.from(fontLicense(path.dirname(original), held.toString()));
};
const settings = readSettings();
const builtPage = new URL('../public/login/index.html', import.meta.url);

void test('login fonts and licenses retain installed package bytes and real WOFF2 headers', async () => {
  for (const [name, original] of files) {
    const bundled = await readFile(new URL('../public/login/fonts/' + name, import.meta.url));
    assert.equal(digest(bundled), digest(await expected(original)), name);
    if (name.endsWith('.woff2')) assert.equal(bundled.subarray(0, 4).toString(), 'wOF2', name);
    else assert.match(bundled.toString(), /SIL OPEN FONT LICENSE Version 1\.1/);
  }
});

void test('login and favicon use the installed Phosphor tree, with no icon text substitute', async () => {
  const html = renderLoginPage(settings);
  const favicon = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8');
  const defs = await readFile(
    new URL('../node_modules/@phosphor-icons/react/dist/defs/Tree.es.js', import.meta.url),
    'utf8',
  );
  const path = (weight) => defs.match(new RegExp('"' + weight + '",[\\s\\S]*?d: "([^"]+)"'))[1];
  assert.equal(html.split('<path d="' + path('light') + '"').length - 1, 2, 'masthead and invitation use the same light tree');
  assert.ok(favicon.includes('<path d="' + path('regular') + '"'), 'tab icon uses the regular tree, legible at 16px');
  assert.match(html, /rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"/);
  // The page is written from flyleaf.json, so its masthead names the family.
  assert.ok(html.includes(settings.family.name + '<small>'), 'masthead names the family');
  assert.doesNotMatch(html, /aria-hidden="true">M<\/span/);
});

void test("the built sign-in page is this family's current one, and a static site has none", async () => {
  if ((settings.site?.hosting || 'worker') === 'worker')
    assert.equal(await readFile(builtPage, 'utf8'), renderLoginPage(settings));
  else
    assert.ok(!existsSync(builtPage), 'a static site ships no sign-in page: rebuild it');
});

void test('a static build removes the sign-in page and its monogram; a Worker build writes them', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'flyleaf-login-'));
  try {
    const page = path.join(root, 'public/login/index.html');
    const monogram = path.join(root, 'public/login/monogram.png');
    await mkdir(path.dirname(page), { recursive: true });
    const worker = { ...settings, site: { ...settings.site, hosting: 'worker' } };
    assert.equal(installLoginPage(worker, root), true);
    assert.equal(await readFile(page, 'utf8'), renderLoginPage(worker));
    assert.ok(existsSync(monogram));
    // Left over from an earlier Worker build, then the family turns static.
    await writeFile(page, 'stale');
    const local = { ...settings, site: { ...settings.site, hosting: 'static' } };
    assert.equal(installLoginPage(local, root), false);
    assert.ok(!existsSync(page) && !existsSync(monogram));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('every build publishes the site fonts’ licences outside the sign-in folder', async () => {
  for (const [name, original] of files.filter(([name]) => name.endsWith('.txt'))) {
    const held = await expected(original);
    const published = await readFile(new URL('../public/licenses/' + name, import.meta.url));
    assert.equal(digest(published), digest(held), name);
    // A static build drops login/, so a site built since the licences were
    // copied must carry its own copy.
    const built = new URL('../dist/client/licenses/' + name, import.meta.url);
    const page = new URL('../dist/client/index.html', import.meta.url);
    const copied = new URL('../public/licenses/' + name, import.meta.url);
    if (existsSync(page) && statSync(page).mtimeMs >= statSync(copied).mtimeMs)
      assert.equal(digest(await readFile(built)), digest(held), 'dist/client/licenses/' + name);
  }
  // The font is Adobe's; the package's licence says Google.
  const sans = await readFile(new URL('../public/licenses/source-sans-3-OFL.txt', import.meta.url), 'utf8');
  assert.ok(sans.startsWith(SOURCE_SANS_COPYRIGHT));
});
