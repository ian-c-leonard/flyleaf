import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function openMap(page: Page) {
  await expect(
    page.getByRole('heading', { name: 'Places in our family history' }),
  ).toBeVisible();
  const toggle = page.locator('.places-map-toggle');
  if ((await toggle.getAttribute('aria-expanded')) === 'false')
    await toggle.click();
  await expect(
    page.getByRole('button', { name: 'Show all places', exact: true }),
  ).toBeVisible();
}

test('the search name stays stable and event filters narrow the places', async ({
  page,
}) => {
  await page.goto('/#view=places');
  const search = page.getByRole('searchbox', {
    name: 'Search places, people or years',
    exact: true,
  });
  await search.fill('Mineral');
  await expect(search).toHaveValue('Mineral');
  await page
    .getByRole('combobox', { name: 'Show', exact: true })
    .selectOption('homes');
  await page.locator('.place-result').click();
  await expect(page.locator('.place-detail-heading h2')).toHaveText(
    'Mineral Point, Wisconsin',
  );
  await page
    .getByRole('button', { name: 'Clear place search', exact: true })
    .click();
  await expect(search).toHaveValue('');
  await page
    .getByRole('combobox', { name: 'Show', exact: true })
    .selectOption('family');
  await search.fill('Penzance');
  await page.locator('.place-result').click();
  await expect(page.locator('.place-detail-heading h2')).toHaveText(
    'Penzance, Cornwall, England',
  );
  await expect(page.locator('.place-events')).toContainText('Married');
  await page.reload();
  await expect(search).toHaveValue('Penzance');
  await expect(
    page.getByRole('combobox', { name: 'Show', exact: true }),
  ).toHaveValue('family');
});

test('overview groups separate map targets and provide exact place choices with keyboard dismissal', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/#view=places');
  await openMap(page);
  const markers = page.locator('.place-map-marker');
  expect(await markers.count()).toBeLessThan(
    await page.locator('.place-result').count(),
  );
  const overlaps = await markers.evaluateAll((nodes) => {
    const rects = nodes.map((node) => node.getBoundingClientRect());
    return rects.flatMap((a, i) =>
      rects
        .slice(i + 1)
        .filter(
          (b) =>
            a.left < b.right &&
            a.right > b.left &&
            a.top < b.bottom &&
            a.bottom > b.top,
        ),
    ).length;
  });
  expect(overlaps).toBe(0);
  const cluster = page.locator('.place-map-cluster').first();
  await cluster.focus();
  await cluster.press('Enter');
  const nearby = page.locator('.place-map-nearby');
  await expect(nearby).toBeVisible();
  await expect(
    nearby.getByRole('button', { name: 'Close nearby places' }),
  ).toBeFocused();
  const count = Number(
    (await nearby.locator('h3').innerText()).match(/^\d+/)?.[0],
  );
  await expect(nearby.locator('.place-map-nearby-list > button')).toHaveCount(
    count,
  );
  await page.keyboard.press('Escape');
  await expect(nearby).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Show all places', exact: true }),
  ).toBeFocused();
  await page
    .getByRole('button', { name: 'Show all places', exact: true })
    .click();
  await page.locator('.place-map-cluster').first().press('Space');
  const choice = nearby.locator('.place-map-nearby-list > button').first();
  const title = await choice.locator('strong').innerText();
  await choice.click();
  await expect(nearby).toHaveCount(0);
  await expect(page.locator('.place-detail-heading h2')).toHaveText(title);
  await expect(page.locator('.place-detail-heading h2')).toBeFocused();
  expect(errors).toEqual([]);
});

test('individual map markers activate exactly once with Enter and Space', async ({
  page,
}) => {
  await page.goto('/#view=places&placeQuery=Minneapolis');
  await openMap(page);
  const marker = page.locator('.place-map-marker');
  await expect(marker).toHaveCount(1);
  for (const key of ['Enter', 'Space']) {
    const before = await page.evaluate(() => history.length);
    await marker.focus();
    await marker.press(key);
    await expect(page.locator('.place-detail-heading h2')).toHaveText(
      'Minneapolis, Minnesota',
    );
    expect(await page.evaluate(() => history.length)).toBe(before + 1);
    if (key === 'Enter') {
      // A fresh route avoids counting an existing forward-history entry as a
      // new activation when the browser replaces it after Back.
      await page.goto('/#view=places&placeQuery=Minneapolis&placeKind=family');
      await openMap(page);
    }
  }
});

test('place selection, search and event filter survive a change of family branch and Back/reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/#view=places');
  const search = page.getByRole('searchbox', {
    name: 'Search places, people or years',
  });
  await search.fill('Madison');
  await page
    .getByRole('combobox', { name: 'Show', exact: true })
    .selectOption('family');
  await page
    .locator('.place-result')
    .filter({ hasText: 'Madison, Wisconsin' })
    .click();
  await expect(page.locator('.place-detail-heading h2')).toHaveText(
    'Madison, Wisconsin',
  );
  await expect(page.locator('.place-events')).toContainText('1929');
  await expect(page.locator('.place-events')).toContainText(
    'Madison, Dane County, Wisconsin, USA',
  );
  const originalPlace = new URL(page.url()).hash.match(/place=([^&]+)/)?.[1];
  await page.locator('.kin-focusbar button[aria-haspopup="dialog"]').click();
  await page
    .getByRole('dialog', { name: 'Choose a family branch' })
    .getByRole('button', { name: /Ruth Anna \(Kessler\) Solberg/ })
    .click();
  await expect(page.locator('.place-detail-heading h2')).toHaveText(
    'Madison, Wisconsin',
  );
  await expect(page.locator('.place-detail-heading p')).toContainText(
    '12 relatives',
  );
  await expect(page.locator('.place-people')).not.toContainText(
    'Mary Jane Penhallow',
  );
  for (const reload of [false, true]) {
    if (reload) await page.reload();
    await expect(search).toHaveValue('Madison');
    await expect(
      page.getByRole('combobox', { name: 'Show', exact: true }),
    ).toHaveValue('family');
    await expect(page.locator('.place-detail-heading h2')).toHaveText(
      'Madison, Wisconsin',
    );
    const params = new URLSearchParams(new URL(page.url()).hash.slice(1));
    expect(params.get('place')).toBe(originalPlace);
    expect(params.get('branch')).toBe('ruth-kessler');
  }
  await page.goBack();
  await expect(page.locator('.place-detail-heading p')).toContainText(
    '17 relatives',
  );
  await expect(search).toHaveValue('Madison');
  expect(errors).toEqual([]);
});

test('places and their records stay usable when the map fails', async ({
  page,
}, info) => {
  await page.route('**/geography/*.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"wrong":"map bytes"}',
    }),
  );
  await page.goto('/#view=places');
  await expect(
    page.getByRole('heading', { name: 'Places in our family history' }),
  ).toBeVisible();
  const open = page.getByRole('button', {
    name: 'Explore the map',
    exact: true,
  });
  if (await open.isVisible()) await open.click();
  await expect(
    page.getByText(
      'The map didn’t load. You can still explore every place below.',
    ),
  ).toBeVisible();
  // On a phone the map is a layer over the list; a touch outside it only
  // closes it, so close it first.
  if (info.project.name === 'phone') await page.keyboard.press('Escape');
  await page
    .getByRole('searchbox', { name: 'Search places, people or years' })
    .fill('Penzance');
  await page.locator('.place-result').click();
  await expect(page.locator('.place-detail-heading h2')).toHaveText(
    'Penzance, Cornwall, England',
  );
  await expect(page.locator('.place-events')).toContainText('Married');
  await page
    .locator('.place-geography summary', { hasText: 'About the map' })
    .click();
  await expect(
    page.locator('.place-geography', { hasText: 'About the map' }),
  ).toContainText('Penzance, Cornwall, England');
  await expect(
    page.getByRole('searchbox', { name: 'Search places, people or years' }),
  ).toHaveValue('Penzance');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
