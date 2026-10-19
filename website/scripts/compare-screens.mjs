// Screenshot the main pages of a built site, or compare two sets.
//
//   node scripts/compare-screens.mjs --capture work/screens/before
//   node scripts/compare-screens.mjs --capture work/screens/after
//   node scripts/compare-screens.mjs --compare work/screens/before work/screens/after
//
// Capture runs against a preview server (default http://127.0.0.1:4173; set
// FAMILY_BASE_URL). Random choices are fixed and motion is reduced, so two
// builds of the same site give the same pictures. Requests to other hosts
// (map tiles, fonts from a CDN) are blocked, because they load at different
// speeds from run to run.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentFile, readSettings, siteHosting } from '../flyleaf-settings.mjs';
import { isMain } from './is-main.mjs';

const site = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(path.join(site, 'package.json'));
const base = process.env.FAMILY_BASE_URL || 'http://127.0.0.1:4173';

/** The pages this site has. A static site has no sign-in page, so an entry
 * for login/ is left out, as is any entry marked "hosting": "worker". */
export function screensFor(entries, hosting) {
  return entries.filter(
    (entry) =>
      (entry.hosting || hosting) === hosting &&
      !(hosting === 'static' && /^login(\/|$)/.test(entry.hash ?? '')),
  );
}

// The family's page list (screens.json in its site content), else the
// general pages every family has.
const pages = isMain(import.meta.url)
  ? screensFor(
      JSON.parse(readFileSync(contentFile('screens.json'), 'utf8')),
      siteHosting(readSettings()),
    )
  : [];
const viewports = {
  desktop: { width: 1440, height: 1000 },
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true },
};
const sha = (file) =>
  createHash('sha256').update(readFileSync(file)).digest('hex');

const [mode, a, b] = process.argv.slice(2);
if (!isMain(import.meta.url)) {
  // Imported for screensFor: capture and compare nothing.
} else if (mode === '--capture' && a) {
  const { chromium } = require('playwright-core');
  const out = path.resolve(site, a);
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const [name, { width, height, ...device }] of Object.entries(viewports)) {
      const context = await browser.newContext({
        viewport: { width, height },
        reducedMotion: 'reduce',
        ...device,
      });
      await context.addInitScript(() => {
        Math.random = () => 0;
      });
      const local = new URL(base).host;
      await context.route('**/*', (route) =>
        new URL(route.request().url()).host === local
          ? route.continue()
          : route.abort(),
      );
      const page = await context.newPage();
      for (const { id, hash, click, wait } of pages) {
        await page.goto(base + '/' + hash, { waitUntil: 'networkidle' });
        if (click) await page.locator(click).first().click();
        if (wait) await page.locator(wait).first().waitFor();
        // Wait for fonts and for the images on screen; lazy images further
        // down never load, so they are left out. Give up after five seconds.
        await page.evaluate(() =>
          Promise.race([
            new Promise((done) => setTimeout(done, 5000)),
            (async () => {
              await document.fonts.ready;
              const onScreen = [...document.images].filter((img) => {
                const box = img.getBoundingClientRect();
                return !img.complete && box.bottom > 0 && box.top < innerHeight;
              });
              await Promise.all(
                onScreen.map((img) => new Promise((done) => {
                  img.addEventListener('load', done, { once: true });
                  img.addEventListener('error', done, { once: true });
                })),
              );
            })(),
          ]),
        );
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(out, `${id}-${name}.png`) });
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`Captured ${pages.length * 2} pages in ${a}`);
} else if (mode === '--compare' && a && b) {
  // Same bytes pass at once. Otherwise count pixels that changed visibly (any
  // colour channel by more than 40 of 255) and save a picture marking them in
  // red, so a real change can be told from anti-aliasing at a text edge.
  const sharp = require('sharp');
  const names = readdirSync(path.resolve(site, a)).filter((f) => f.endsWith('.png'));
  let failed = 0;
  for (const name of names) {
    const [left, right] = [a, b].map((dir) => path.resolve(site, dir, name));
    if (sha(left) === sha(right)) continue;
    const [x, y] = await Promise.all(
      [left, right].map((file) =>
        sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      ),
    );
    if (x.info.width !== y.info.width || x.info.height !== y.info.height) {
      failed++;
      console.log('different size', name);
      continue;
    }
    const mark = Buffer.from(x.data);
    let changed = 0;
    for (let i = 0; i < x.data.length; i += 4) {
      const delta = Math.max(
        Math.abs(x.data[i] - y.data[i]),
        Math.abs(x.data[i + 1] - y.data[i + 1]),
        Math.abs(x.data[i + 2] - y.data[i + 2]),
      );
      if (delta > 40) {
        changed++;
        mark.set([255, 0, 0, 255], i);
      }
    }
    if (!changed) continue;
    failed++;
    const out = path.resolve(site, b, name.replace(/\.png$/, '.diff.png'));
    await sharp(mark, { raw: x.info }).png().toFile(out);
    console.log(`different ${name}: ${changed} pixels (see ${path.relative(site, out)})`);
  }
  console.log(
    failed
      ? `${failed} of ${names.length} screenshots differ visibly`
      : `All ${names.length} screenshots match`,
  );
  process.exit(failed ? 1 : 0);
} else {
  console.error('Usage: compare-screens.mjs --capture <dir> | --compare <a> <b>');
  process.exit(2);
}
