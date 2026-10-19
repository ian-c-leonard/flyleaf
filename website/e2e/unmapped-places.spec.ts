import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

// Rowe's Diggings: a birthplace in the sample that no gazetteer has.
const diggings = '1mj0hja';
const diggingsTitle = "Rowe's Diggings, Wisconsin, USA";
const searchName = 'Search places, people or years';

async function activate(control: Locator) {
  await control.evaluate((element) =>
    element.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: 'instant',
    }),
  );
  let previous = '';
  let stableSince = 0;
  // WebKit can still be scrolling after scrollIntoViewIfNeeded resolves.
  // Wait for the real touch target, rather than tapping an old screen position.
  await expect
    .poll(
      async () => {
        const geometry = await control.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const viewport = window.visualViewport;
          const top = viewport?.offsetTop || 0;
          const left = viewport?.offsetLeft || 0;
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          return {
            box: [rect.left, rect.top, rect.width, rect.height, scrollY],
            fits:
              rect.width > 0 &&
              rect.height > 0 &&
              rect.top >= top &&
              rect.left >= left &&
              rect.bottom <= top + (viewport?.height || innerHeight) &&
              rect.right <= left + (viewport?.width || innerWidth),
            receivesTouch: element === hit || (!!hit && element.contains(hit)),
          };
        });
        const signature = JSON.stringify(geometry.box);
        if (signature !== previous) stableSince = Date.now();
        previous = signature;
        return (
          geometry.fits &&
          geometry.receivesTouch &&
          Date.now() - stableSince >= 500
        );
      },
      { timeout: 15000, intervals: [100] },
    )
    .toBe(true);
  if (test.info().project.use.hasTouch) await control.tap();
  else await control.click();
}

async function openMap(page: Page) {
  await expect(
    page.getByRole('heading', { name: 'Places in our family history' }),
  ).toBeVisible();
  const toggle = page.locator('.places-map-toggle');
  if ((await toggle.getAttribute('aria-expanded')) === 'false')
    await activate(toggle);
  await expect(page.locator('#places-map')).toBeVisible();
}

async function search(page: Page, query: string) {
  await page
    .getByRole('searchbox', { name: searchName, exact: true })
    .fill(query);
}

async function choosePlace(page: Page, title: string) {
  const choice = page.locator('.place-result').filter({
    has: page.getByText(title, { exact: true }),
  });
  if (
    (page.viewportSize()?.width || 0) < 900 &&
    (await page.locator('.places-map-toggle').getAttribute('aria-expanded')) ===
      'true'
  ) {
    const before = page.url();
    await activate(choice);
    await expect(page.locator('#places-map')).toHaveCount(0);
    expect(page.url()).toBe(before);
  }
  await activate(choice);
}

async function selectMinneapolis(page: Page) {
  await choosePlace(page, 'Minneapolis, Minnesota');
  await expect(page.locator('.place-detail-heading h2')).toHaveText(
    'Minneapolis, Minnesota',
  );
  await openMap(page);
  const marker = page.getByRole('button', {
    name: /^Minneapolis, Minnesota, \d+ people\. Explore this place\.$/,
  });
  await expect(marker).toBeVisible();
  await expect(marker).toHaveAttribute('aria-pressed', 'true');
  await expect(marker).toHaveClass(/is-selected/);
  return marker;
}

async function capture(page: Page, name: string) {
  await test.info().attach(name, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
}

test('an unmapped place keeps its map status and source limits without a map', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(
    `/#view=places&branch=robert-john-penhallow&place=${diggings}&placeQuery=Diggings&placeKind=family`,
  );
  await openMap(page);
  await expect(page.locator('.places-map-empty')).toContainText(
    diggingsTitle + ' isn’t on the map yet.',
  );
  await expect(page.locator('.place-map-canvas')).toHaveCount(0);
  await expect(page.locator('.place-detail-heading h2')).toHaveText(
    diggingsTitle,
  );
  await expect(page.locator('.place-events')).toContainText('Born');
  await capture(page, 'unmapped-diggings');
  const contextSummary = page.getByText('About the map', {
    exact: true,
  });
  const beforeOutside = page.url();
  await activate(contextSummary);
  if ((page.viewportSize()?.width || 0) < 900) {
    await expect(page.locator('#places-map')).toHaveCount(0);
    await expect(page.locator('.place-geography[open]')).toHaveCount(0);
    await expect(page.locator('.places-map-toggle')).toBeFocused();
    expect(page.url()).toBe(beforeOutside);
    await capture(page, 'first-outside-tap-closes-only-map');
    await activate(contextSummary);
  }
  await expect(page.locator('.place-geography[open]')).toContainText(
    'no point is proposed',
  );
  await capture(page, 'diggings-source-limits');
  await openMap(page);
  await activate(
    page
      .locator('.places-map-empty')
      .getByRole('button', { name: 'Clear search and filters' }),
  );
  await expect(page.locator('.place-map-canvas')).toBeVisible();
  await expect
    .poll(() => page.locator('.place-map-marker').count())
    .toBeGreaterThan(0);
  const route = new URLSearchParams(new URL(page.url()).hash.slice(1));
  expect(route.get('branch')).toBe('robert-john-penhallow');
  expect(route.has('place')).toBe(false);
  expect(route.has('placeQuery')).toBe(false);
  expect(route.has('placeKind')).toBe(false);
  expect(errors).toEqual([]);
});

test('mapped places remount after an unmapped filter and after no matching results', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/#view=places&branch=robert-john-penhallow');
  await openMap(page);
  await expect(page.locator('.place-map-canvas')).toBeVisible();
  await expect
    .poll(() => page.locator('.place-map-marker').count())
    .toBeGreaterThan(0);
  await page
    .getByRole('combobox', { name: 'Show', exact: true })
    .selectOption('family');
  await search(page, 'Diggings');
  await expect(page.locator('.places-map-empty')).toContainText(
    'These places aren’t on the map yet.',
  );
  await expect(page.locator('.place-map-canvas')).toHaveCount(0);
  await choosePlace(page, diggingsTitle);
  await openMap(page);
  await expect(page.locator('.places-map-empty')).toContainText(
    diggingsTitle + ' isn’t on the map yet.',
  );
  await activate(
    page
      .locator('.places-map-empty')
      .getByRole('button', { name: 'Clear search and filters' }),
  );
  await expect(page.locator('.place-map-canvas')).toBeVisible();
  await expect
    .poll(() => page.locator('.place-map-marker').count())
    .toBeGreaterThan(0);
  await capture(page, 'remounted-branch-map');
  await search(page, 'this-search-has-no-place-20261004');
  await expect(page.locator('.places-map-empty')).toContainText(
    'No places match these filters.',
  );
  await expect(page.locator('.place-map-canvas')).toHaveCount(0);
  await activate(
    page
      .locator('.places-map-empty')
      .getByRole('button', { name: 'Clear search and filters' }),
  );
  await expect(page.locator('.place-map-canvas')).toBeVisible();
  // Minneapolis stands alone on the map; the Wisconsin towns share a group.
  await choosePlace(page, 'Minneapolis, Minnesota');
  await openMap(page);
  const marker = page.getByRole('button', {
    name: /^Minneapolis, Minnesota, \d+ people\. Explore this place\.$/,
  });
  await expect(marker).toHaveAttribute('aria-pressed', 'true');
  await marker.press('Enter');
  await expect(page.locator('.place-detail-heading h2')).toHaveText(
    'Minneapolis, Minnesota',
  );
  expect(
    new URLSearchParams(new URL(page.url()).hash.slice(1)).get('branch'),
  ).toBe('robert-john-penhallow');
  expect(errors).toEqual([]);
});

test('a selected unmapped place is disclosed while the full map shows other places', async ({
  page,
}) => {
  await page.goto(`/#view=places&place=${diggings}`);
  await openMap(page);
  await expect(page.locator('.places-map-notice')).toContainText(
    diggingsTitle + ' isn’t on the map yet.',
  );
  await expect(page.locator('.place-map-canvas')).toBeVisible();
  await expect
    .poll(() => page.locator('.place-map-marker').count())
    .toBeGreaterThan(0);
  await expect(page.locator('.place-map-marker.is-selected')).toHaveCount(0);
  await capture(page, 'mixed-map-diggings-disclosure');
  await search(page, 'Minneapolis');
  const marker = await selectMinneapolis(page);
  await marker.scrollIntoViewIfNeeded();
  await expect(page.locator('.places-map-notice')).toHaveCount(0);
  await expect(page.locator('.place-detail-heading h2')).toHaveText(
    'Minneapolis, Minnesota',
  );
  await capture(page, 'selected-real-minneapolis-marker');
});

test('narrow unmapped map status dismisses with Escape and returns focus to the map toggle', async ({
  page,
}) => {
  test.skip(
    (page.viewportSize()?.width || 0) >= 900,
    'The wide map is a nonmodal column.',
  );
  await page.goto(
    `/#view=places&branch=robert-john-penhallow&place=${diggings}&placeQuery=Diggings&placeKind=family`,
  );
  await openMap(page);
  await expect(page.locator('.places-map-empty')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#places-map')).toHaveCount(0);
  await expect(page.locator('.places-map-toggle')).toBeFocused();
  await capture(page, 'unmapped-map-escape-focus');
});
