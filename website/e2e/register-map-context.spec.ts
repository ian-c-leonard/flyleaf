import { expect, test } from '@playwright/test';

// The sample book names no mapped places in its text yet, so every part of
// it has an empty reading map.
for (const anchor of ['reg-arne-solberg', 'sources-john-penhallow']) {
  test(`unmapped public context stays empty: ${anchor}`, async ({ page }) => {
    await page.goto('/#view=book&bookAnchor=' + anchor);
    await expect(page.locator('.native-book-content #' + anchor)).toBeVisible();
    const toggle = page.getByRole('button', { name: 'Map', exact: true });
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await expect(page.locator('#book-reading-map')).toContainText('No places on the map for this part of the book yet.');
    await expect(page.locator('.book-map-locations')).toHaveCount(0);
  });
}

test('map Back closes phone panel and keeps its register position', async ({ page }) => {
  test.skip(test.info().project.name !== 'phone', 'Phone map uses a history-backed panel.');
  await page.goto('/#view=book&bookAnchor=reg-arne-solberg');
  const heading = page.locator('#reg-arne-solberg');
  await expect(heading).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => heading.evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom < innerHeight; })).toBe(true);
  const before = await heading.boundingBox();
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  const map = page.getByRole('complementary', { name: 'Places in the book' });
  await expect(map).toBeVisible();
  await page.goBack();
  await expect(map).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Map', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => Math.abs((await heading.boundingBox())!.y - before!.y)).toBeLessThan(3);
});
