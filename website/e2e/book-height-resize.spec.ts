import { expect, test } from '@playwright/test';

// iPhone Safari changes the window height continuously while its toolbars
// slide during a swipe. The book must not pull the reader back each frame.
test('a height-only resize during a swipe keeps the reader moving', async ({ page }) => {
  await page.goto('/#view=book&focus=tamsin-penhallow&bookAnchor=nar-tamsin-penhallow');
  await expect(page.locator('.native-book-content #nar-tamsin-penhallow')).toBeVisible();
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => scrollY);
  await page.evaluate(() => {
    window.scrollBy(0, 300);
    window.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(before + 250);
});
