import { test, expect, type Locator, type Page } from '@playwright/test';

// Home's photographs and records change by themselves every few seconds.
// Each set has a pause button that stays paused, and a reader who asks for
// reduced motion sees nothing move on its own.
const position = (controls: Locator) => controls.locator('span').textContent();
// Whether a set moves on within a few turns of the clock. A set can restart
// its timer once while Home finishes loading.
async function moves(page: Page, controls: Locator) {
  const before = await position(controls);
  for (let turn = 0; turn < 3; turn++) {
    await page.clock.runFor(5500);
    try {
      await expect
        .poll(() => position(controls), { timeout: 1000 })
        .not.toBe(before);
      return true;
    } catch {
      // Not yet.
    }
  }
  return false;
}

test('each moving set on Home has a pause button that keeps it still', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/');
  const sets = page.locator('.kin-carousel-controls');
  await expect(sets.first()).toBeVisible();
  const pauses = page.getByRole('button', { name: /^Pause / });
  expect(await pauses.count()).toBe(await sets.count());
  for (const controls of await sets.all()) {
    const pause = controls.getByRole('button', { name: /^Pause / });
    const nouns = (await pause.getAttribute('aria-label'))!.slice(6);
    // It moves while playing.
    expect(await moves(page, controls)).toBe(true);
    // Paused from the keyboard, it stays still.
    await pause.focus();
    await page.keyboard.press('Enter');
    const play = controls.getByRole('button', { name: `Play ${nouns}` });
    await expect(play).toBeFocused();
    // Moving focus away does not start it again.
    await play.evaluate((element) => (element as HTMLElement).blur());
    expect(await moves(page, controls)).toBe(false);
    const paused = await position(controls);
    // The arrows still work, and Play starts it again.
    await controls.getByRole('button', { name: /^Next / }).click();
    await expect.poll(() => position(controls)).not.toBe(paused);
    await play.click();
    await expect(
      controls.getByRole('button', { name: `Pause ${nouns}` }),
    ).toBeVisible();
  }
});

test('with reduced motion Home does not move and needs no pause button', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await page.goto('/');
  const controls = page.locator('.kin-carousel-controls');
  await expect(controls.first()).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^(Pause|Play) / }),
  ).toHaveCount(0);
  for (const set of await controls.all())
    expect(await moves(page, set)).toBe(false);
});

// Where the page ends and where the footer starts, below every carousel.
const layout = (page: Page) =>
  page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    footer: Math.round(
      document.querySelector('.kin-footer')!.getBoundingClientRect().top +
        scrollY,
    ),
  }));
// The page has finished laying out: two looks a moment apart agree.
async function settled(page: Page) {
  let last = '';
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await layout(page));
        const same = now === last;
        last = now;
        return same;
      },
      { intervals: [400] },
    )
    .toBe(true);
  return JSON.parse(last) as Awaited<ReturnType<typeof layout>>;
}
// Every photograph on show, and the ones waiting to come next, has loaded.
const arrived = (page: Page) =>
  expect
    .poll(() =>
      page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLImageElement>(
            '.kin-featured-photo img, .kin-album-stack img',
          ),
        ].every((image) => image.complete),
      ),
    )
    .toBe(true);

test('nothing below the carousels moves while they change by themselves', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/');
  const hero = page.locator('.kin-featured-photo .kin-carousel-controls');
  await expect(hero).toBeVisible();
  // A reader scrolled down past the featured photograph.
  await page.evaluate(() =>
    window.scrollTo({
      top: document.querySelector('.kin-album-teaser')!.getBoundingClientRect()
        .top,
      behavior: 'instant',
    }),
  );
  // At the first width, then again once the window is resized.
  for (const width of [0, 700]) {
    if (width)
      await page.setViewportSize({
        width,
        height: page.viewportSize()!.height,
      });
    await arrived(page);
    await page.clock.runFor(1000);
    const start = await settled(page);
    const seen = new Set([await position(hero)]);
    for (let turn = 0; turn < 4; turn++) {
      await page.clock.runFor(5500);
      seen.add(await position(hero));
      expect(await layout(page)).toEqual(start);
      // And once the new photographs have loaded and faded in.
      await arrived(page);
      await page.clock.runFor(1000);
      expect(await layout(page)).toEqual(start);
    }
    expect(seen.size).toBeGreaterThan(2);
  }
});

test('each photograph on Home sits in a frame of its own shape', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.kin-carousel-controls').first()).toBeVisible();
  const photographs = page.locator(
    '.kin-featured-photo img, .kin-album-stack button:not([inert]) img, .kin-records-grid button:not([inert]) img',
  );
  expect(await photographs.count()).toBeGreaterThan(2);
  for (const photograph of await photographs.all()) {
    await photograph.scrollIntoViewIfNeeded();
    await photograph.evaluate((image: HTMLImageElement) => image.decode());
    // The shape of the space the picture fills, inside any mat, and its own.
    const [frame, own] = await photograph.evaluate(
      (image: HTMLImageElement) => {
        const style = getComputedStyle(image);
        const width =
          image.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight);
        const height =
          image.clientHeight -
          parseFloat(style.paddingTop) -
          parseFloat(style.paddingBottom);
        return [width / height, image.naturalWidth / image.naturalHeight];
      },
    );
    expect(Math.abs(frame / own - 1)).toBeLessThan(0.03);
  }
});

test('a tap after a swipe opens the featured photograph', async ({
  page,
  context,
}, info) => {
  test.skip(!info.project.use.hasTouch, 'A swipe needs a touch screen.');
  await page.goto('/');
  const arrow = page.getByRole('button', { name: 'View featured photograph' });
  await expect(arrow).toBeVisible();
  const box = (await page.locator('.kin-carousel-track').boundingBox())!;
  const y = box.y + box.height / 2;
  const cdp = await context.newCDPSession(page);
  const at = (share: number) => [{ x: box.x + box.width * share, y }];
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: at(0.8),
  });
  for (let step = 1; step <= 8; step++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: at(0.8 - step * 0.07),
    });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  // A swipe sends no click, so the next tap must not be taken for its click.
  await arrow.tap();
  await expect(page.getByRole('dialog')).toBeVisible();
});
