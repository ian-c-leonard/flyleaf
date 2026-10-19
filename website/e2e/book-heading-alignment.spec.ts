import { expect, test, type Page } from '@playwright/test';
import { marriageNote } from './sample-book';

async function settle(page: Page) {
  await page.locator('.native-book-content').waitFor();
  await page.evaluate(async () => {
    document.querySelector('.native-book-content')?.getBoundingClientRect();
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}
async function readDown(page: Page, browserName: string, amount: number) {
  if (
    browserName === 'webkit' &&
    (await page.evaluate(() => matchMedia('(pointer: coarse)').matches))
  )
    await page.keyboard.press('PageDown');
  else await page.mouse.wheel(0, amount);
}
async function clearance(page: Page, anchor: string) {
  await settle(page);
  const metrics = await page
    .locator('.native-book-content #' + anchor)
    .evaluate((node) => {
      const entry = node.getBoundingClientRect();
      const toolbar = document
        .querySelector('.native-book-toolbar')!
        .getBoundingClientRect();
      return {
        top: entry.top,
        bottom: entry.bottom,
        toolbarBottom: toolbar.bottom,
        height: innerHeight,
        gap: entry.top - toolbar.bottom,
      };
    });
  await test.info().attach(anchor + '-geometry', {
    body: JSON.stringify(metrics),
    contentType: 'application/json',
  });
  expect(metrics.gap).toBeGreaterThanOrEqual(24);
  expect(metrics.bottom).toBeLessThan(metrics.height);
  return metrics;
}

for (const person of [
  'tamsin-penhallow',
  'robert-john-penhallow',
  'arne-solberg',
]) {
  test('automatic profile register landing: ' + person, async ({ page }) => {
    await page.goto('/#view=people&person=' + person);
    const link = page
      .locator('dialog.kin-life-modal')
      .getByRole('button', { name: /’s entry in the book$/ });
    await expect(link).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches))
      await link.tap();
    else await link.click();
    await expect(page).toHaveURL(new RegExp('bookAnchor=reg-' + person + '$'));
    await clearance(page, 'reg-' + person);
    if (person === 'tamsin-penhallow')
      await test.info().attach('automatic-landing', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    // The assertion never scrolls the destination into view.
  });
}
for (const anchor of ['reg-robert-john-penhallow', 'reg-arne-solberg']) {
  test(
    'cold direct heading and settled user resize: ' + anchor,
    async ({ page, browserName }) => {
      await page.goto('/#view=book&bookAnchor=' + anchor);
      await clearance(page, anchor);
      await readDown(page, browserName, 650);
      await page.waitForTimeout(120);
      await page.evaluate(() => {
        const original = window.scrollTo.bind(window);
        Object.defineProperty(window, '__afterReadingAlignments', {
          value: [],
        });
        Object.defineProperty(window, 'scrollTo', {
          configurable: true,
          value: (first?: ScrollToOptions | number, y?: number) => {
            (Reflect.get(window, '__afterReadingAlignments') as unknown[]).push(
              first,
            );
            if (typeof first === 'number') original(first, y || 0);
            else original(first);
          },
        });
      });
      const size = page.viewportSize()!;
      await page.setViewportSize({
        width: size.width,
        height: size.height - 20,
      });
      await page.waitForTimeout(120);
      // Existing passage-offset restoration may adjust scrollY through scrollBy;
      // the application must not issue a deferred heading scrollTo after reading.
      expect(
        await page.evaluate(
          () =>
            (Reflect.get(window, '__afterReadingAlignments') as unknown[])
              .length,
        ),
      ).toBe(0);
      await page.setViewportSize(size);
    },
  );
}

test('Back preserves a positive saved reading position', async ({
  page,
  browserName,
}) => {
  await page.goto('/#view=book&bookAnchor=reg-robert-john-penhallow');
  await clearance(page, 'reg-robert-john-penhallow');
  await readDown(page, browserName, 550);
  await page.waitForTimeout(120);
  const before = await page.evaluate(() => scrollY);
  // A navigation header is an actual application route; click does not scroll the reader.
  await page.getByRole('button', { name: 'Family home', exact: true }).click();
  await expect(page.locator('.native-book-content')).toHaveCount(0);
  await page.goBack();
  await settle(page);
  expect(await page.evaluate(() => scrollY)).toBe(before);
});

async function holdFonts(page: Page) {
  let released = false;
  const held: Array<() => Promise<void>> = [];
  await page.route('**/*.woff2', async (route) => {
    if (released) await route.continue();
    else
      await new Promise<void>((resolve) =>
        held.push(async () => {
          await route.continue();
          resolve();
        }),
      );
  });
  return async () => {
    released = true;
    await Promise.all(held.map((release) => release()));
    await page.unroute('**/*.woff2');
  };
}

test('a chapter opened while the reader scrolls still lands on it', async ({
  page,
}) => {
  const release = await holdFonts(page);
  await page.goto('/#view=book&bookAnchor=reg-robert-john-penhallow', {
    waitUntil: 'domcontentloaded',
  });
  const target = page.locator(
    '.native-book-content #reg-robert-john-penhallow',
  );
  await target.waitFor();
  // A touch or a small scroll while the book's fonts load once cancelled the
  // jump, and left the reader at the top of the book.
  await page.evaluate(() => window.dispatchEvent(new Event('touchmove')));
  await page.evaluate(() => window.dispatchEvent(new Event('wheel')));
  await release();
  await settle(page);
  const top = await target.evaluate((node) => node.getBoundingClientRect().top);
  expect(top).toBeGreaterThan(0);
  expect(top).toBeLessThan(await page.evaluate(() => innerHeight));
});

test('a resize keeps a pending heading in place', async ({ page }) => {
  // A phone's address bar resizes the window as the page moves; that is not
  // the reader scrolling away.
  const release = await holdFonts(page);
  await page.goto('/#view=book&bookAnchor=reg-robert-john-penhallow', {
    waitUntil: 'domcontentloaded',
  });
  await page
    .locator('.native-book-content #reg-robert-john-penhallow')
    .waitFor();
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.width, height: size.height - 60 });
  await release();
  await clearance(page, 'reg-robert-john-penhallow');
});

for (const gesture of ['Tab', 'Escape', 'wheel']) {
  test(
    'pending heading respects intentional ' + gesture,
    async ({ page, browserName }) => {
      let released = false;
      const held: Array<() => Promise<void>> = [];
      await page.route('**/*.woff2', async (route) => {
        if (released) await route.continue();
        else
          await new Promise<void>((resolve) =>
            held.push(async () => {
              await route.continue();
              resolve();
            }),
          );
      });
      await page.addInitScript(() => {
        const original = window.scrollTo.bind(window);
        const calls: Array<{ top: number; at: number }> = [];
        Object.defineProperty(window, '__headingScrollCalls', { value: calls });
        Object.defineProperty(window, 'scrollTo', {
          configurable: true,
          value: (first?: ScrollToOptions | number, y?: number) => {
            calls.push({
              top: typeof first === 'object' ? first.top || 0 : y || 0,
              at: performance.now(),
            });
            if (typeof first === 'number') original(first, y || 0);
            else original(first);
          },
        });
      });
      await page.goto('/#view=book&bookAnchor=reg-robert-john-penhallow', {
        waitUntil: 'domcontentloaded',
      });
      await page
        .locator('.native-book-content #reg-robert-john-penhallow')
        .waitFor();
      await expect
        .poll(() => page.evaluate(() => document.fonts.status))
        .toBe('loading');
      if (gesture === 'wheel') {
        if (
          browserName === 'webkit' &&
          (await page.evaluate(() => matchMedia('(pointer: coarse)').matches))
        ) {
          // Mobile WebKit has no Playwright wheel protocol. This is a labelled
          // event-policy probe; the Chrome projects use an actual wheel action.
          await test.info().attach('wheel-policy-probe', {
            body: 'Synthetic wheel event; not native mobile scrolling proof.',
            contentType: 'text/plain',
          });
          await page
            .locator('.native-book-content')
            .dispatchEvent('wheel', { deltaY: 450 });
        } else await page.mouse.wheel(0, 450);
      } else await page.keyboard.press(gesture);
      await page.waitForTimeout(80);
      const count = await page.evaluate(
        () => (Reflect.get(window, '__headingScrollCalls') as unknown[]).length,
      );
      released = true;
      await Promise.all(held.map((release) => release()));
      await settle(page);
      expect(
        await page.evaluate(
          () =>
            (Reflect.get(window, '__headingScrollCalls') as unknown[]).length,
        ),
      ).toBe(count);
      await page.unroute('**/*.woff2');
      // A later deliberate request is allowed, even though the earlier intent was cancelled.
      await page.evaluate(() => {
        location.hash = 'view=book&bookAnchor=reg-arne-solberg';
      });
      await clearance(page, 'reg-arne-solberg');
    },
  );
}

test('actual bookmarked note supersedes deferred heading through source-effect replay', async ({
  page,
}) => {
  const note = await marriageNote(page);
  let released = false;
  const held: Array<() => Promise<void>> = [];
  await page.route('**/*.woff2', async (route) => {
    if (released) await route.continue();
    else
      await new Promise<void>((resolve) =>
        held.push(async () => {
          await route.continue();
          resolve();
        }),
      );
  });
  await page.addInitScript(() => {
    const original = window.scrollTo.bind(window);
    Object.defineProperty(window, '__noteAlignmentCalls', { value: [] });
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: (first?: ScrollToOptions | number, y?: number) => {
        (Reflect.get(window, '__noteAlignmentCalls') as unknown[]).push(first);
        if (typeof first === 'number') original(first, y || 0);
        else original(first);
      },
    });
  });
  await page.goto(
    '/#view=book&bookAnchor=reg-robert-john-penhallow&bookNote=' +
      note.sha256 +
      ':' +
      note.anchor,
    { waitUntil: 'domcontentloaded' },
  );
  const modal = page.locator('dialog.book-note-modal');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('Wesleyan Methodist Chapel');
  await expect
    .poll(() => page.evaluate(() => document.fonts.status))
    .toBe('loading');
  // onNoteText updates the real parent while the note's immediate alignment has
  // superseded the heading; any source-install replay must retain that decision.
  await page.waitForTimeout(120);
  const count = await page.evaluate(
    () => (Reflect.get(window, '__noteAlignmentCalls') as unknown[]).length,
  );
  released = true;
  await Promise.all(held.map((release) => release()));
  await settle(page);
  expect(
    await page.evaluate(
      () => (Reflect.get(window, '__noteAlignmentCalls') as unknown[]).length,
    ),
  ).toBe(count);
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('Wesleyan Methodist Chapel');
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  const marker = page
    .locator('[role=doc-noteref][href="#' + note.anchor + '"]')
    .first();
  await expect(marker).toBeFocused();
  await expect(marker).toHaveAttribute('data-book-return-target', 'true');
});
