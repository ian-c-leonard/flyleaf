// Native-browser negative controls for the shared manager. The fixture imports
// the actual Vite-served module. Real family-profile/image regression remains
// separate: this file does not claim fixture data is a family-site acceptance.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const require = createRequire(path.join(root, 'website/package.json'));
const playwright = require(
  process.env.FAMILY_PLAYWRIGHT_MODULE || 'playwright',
);
const target = process.env.FAMILY_SITE_URL;
assert(target && ['localhost', '127.0.0.1'].includes(new URL(target).hostname));
const engine = process.env.FAMILY_BROWSER || 'chromium';
const out = process.env.FAMILY_DISMISSAL_RESULTS;
assert(out);
await mkdir(out, { recursive: true });
const browser = await playwright[engine].launch({
  headless: false,
  slowMo: 70,
  ...(engine === 'webkit' && process.env.FAMILY_WEBKIT_EXECUTABLE
    ? { executablePath: process.env.FAMILY_WEBKIT_EXECUTABLE }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const countercontrol = process.env.FAMILY_DISMISSAL_COUNTERCONTROL;
if (countercontrol) {
  const body = await readFile(countercontrol, 'utf8');
  await context.route('**/app/lib/dismissal.ts*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body }),
  );
}
const page = await context.newPage();
const report = {
  fixture: true,
  browserOnlyCountercontrol: countercontrol || null,
  target,
  engine,
  version: browser.version(),
  rows: [],
  errors: [],
  physicalDevice: false,
};
page.on('pageerror', (e) => report.errors.push(e.message));
try {
  await page.goto(target, { waitUntil: 'networkidle' });
  await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    body{margin:0;background:#f7f5ef;color:#18271f;font-family:sans-serif}button{height:48px;min-width:140px}#outside{position:fixed;left:12px;top:12px}#open{position:fixed;left:12px;top:100px}dialog{width:240px;height:220px;border:0;padding:0;background:#f7f5ef}dialog::backdrop{background:rgb(24 39 31 / .6)}#inside{height:100%;padding:12px;box-sizing:border-box}#panel{position:fixed;left:60px;top:240px;width:240px;height:220px;background:#e5e5d7;padding:12px;box-sizing:border-box}
    </style></head><body><button id="outside">Other action</button><button id="open">Open surface</button><dialog id="modal"><section id="inside"><p>Native modal fixture</p><button id="close">Close surface</button></section></dialog><section id="panel" hidden>Nonmodal fixture</section></body></html>`);
  await page.evaluate(async () => {
    const { dismissalManager } = await import('/app/lib/dismissal.ts');
    const manager = dismissalManager(document);
    const opener = document.querySelector('#open');
    const outside = document.querySelector('#outside');
    const dialog = document.querySelector('#modal');
    const panel = document.querySelector('#panel');
    window.fixture = {
      clicks: 0,
      reasons: [],
      unregister: null,
      mode: 'modal',
      id: null,
    };
    outside.addEventListener('click', () => window.fixture.clicks++);
    const close = (reason) => {
      window.fixture.reasons.push(reason);
      if (window.fixture.mode === 'modal') {
        dialog.close();
        dialog.remove();
      } else panel.hidden = true;
      window.fixture.unregister?.();
    };
    opener.addEventListener('click', () => {
      if (window.fixture.mode === 'modal') dialog.showModal();
      else panel.hidden = false;
      window.fixture.id = Symbol('fixture');
      window.fixture.unregister = manager.register({
        id: window.fixture.id,
        root: () => (window.fixture.mode === 'modal' ? dialog : panel),
        inside: () => [
          window.fixture.mode === 'modal'
            ? document.querySelector('#inside')
            : panel,
        ],
        trigger: () => opener,
        modal: window.fixture.mode === 'modal',
        onDismiss: close,
      });
    });
    dialog.addEventListener('cancel', (event) =>
      manager.cancel(window.fixture.id, event),
    );
    document
      .querySelector('#close')
      .addEventListener('click', () => close('close'));
  });
  await page.touchscreen.tap(50, 30);
  const nativeTapFocus = await page.evaluate(() => document.activeElement.id);
  report.nativeTapFocus = nativeTapFocus;
  await page.evaluate(() => {
    window.fixture.clicks = 0;
  });
  // A touch on the modal backdrop cannot activate its newly exposed button or
  // undo opener restoration via a compatibility mousedown.
  await page.locator('#open').tap();
  await page.touchscreen.tap(50, 30);
  await page.waitForFunction(
    () =>
      !document.querySelector('#modal')?.open &&
      document.activeElement.id === 'open',
  );
  assert.equal(await page.evaluate(() => window.fixture.clicks), 0);
  report.rows.push({
    name: 'modal touch consumes compatibility activation and keeps opener focus',
    status: 'pass',
  });
  // A new pointer sequence at the very same coordinates is independent, even
  // within the old suppression time window.
  await page.touchscreen.tap(50, 30);
  assert.equal(await page.evaluate(() => window.fixture.clicks), 1);
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    nativeTapFocus,
  );
  report.rows.push({
    name: 'fresh same-coordinate touch retains native focus and activation',
    status: 'pass',
  });
  // A nonmodal outside gesture should perform its ordinary focus/click action.
  await page.evaluate(() => {
    window.fixture.mode = 'nonmodal';
  });
  await page.locator('#open').tap();
  await page.touchscreen.tap(50, 30);
  assert.equal(
    await page.evaluate(() => document.querySelector('#panel').hidden),
    true,
  );
  assert.equal(await page.evaluate(() => window.fixture.clicks), 2);
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    nativeTapFocus,
  );
  report.rows.push({
    name: 'nonmodal outside retains native focus and activation',
    status: 'pass',
  });
  // detail=0 keyboard activation is not mistaken for the previous pointer.
  await page.locator('#outside').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.fixture.clicks), 3);
  report.rows.push({
    name: 'keyboard activation remains available',
    status: 'pass',
  });
  report.reasons = await page.evaluate(() => window.fixture.reasons);
  assert.deepEqual(report.reasons, ['outside', 'outside']);
  assert.deepEqual(report.errors, []);
  await page.screenshot({ path: path.join(out, 'negative-controls.png') });
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error.stack;
  await page
    .screenshot({ path: path.join(out, 'failure.png') })
    .catch(() => {});
} finally {
  await context.close();
  await browser.close();
  report.contextClosed = true;
  await writeFile(
    path.join(out, 'checks.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
}
console.log(JSON.stringify({ engine, passed: report.passed, out }));
if (!report.passed) process.exitCode = 1;
