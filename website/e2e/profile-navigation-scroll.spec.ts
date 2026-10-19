import { expect, test, type Page } from '@playwright/test';

async function profile(page: Page, person: string) {
  await page.goto('/#view=people&person=' + person);
  await expect(page.locator('dialog.kin-life-modal')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return page.locator('dialog.kin-life-modal');
}
async function headingVisible(page: Page, name: string) {
  const heading = page.locator('dialog.kin-life-modal .kin-life-heading h2');
  await expect(heading).toHaveText(name);
  await expect.poll(() => heading.evaluate((node) => {
    const r = node.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight;
  })).toBe(true);
  await expect(heading).toBeFocused();
}
for (const width of [320, 390, 1440]) {
  test(`bottom sibling navigation starts the destination at its heading (${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 700 : 900 });
    const dialog = await profile(page, 'jory-penhallow');
    await dialog.getByRole('button', { name: / Nora Penhallow$/ }).click();
    await headingVisible(page, 'Nora Penhallow');
    await page.screenshot({ path: test.info().outputPath('nora-' + width + '.png') });
    await dialog.getByRole('button', { name: / Jory Penhallow$/ }).click();
    await headingVisible(page, 'Jory Penhallow');
  });
}
test('Back restores the original profile reading position after a sibling was read', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const dialog = await profile(page, 'jory-penhallow');
  const sibling = dialog.getByRole('button', { name: / Nora Penhallow$/ });
  await sibling.scrollIntoViewIfNeeded();
  const reading = await dialog.evaluate((el) => el.scrollTop);
  expect(reading).toBeGreaterThan(0);
  await sibling.click();
  await headingVisible(page, 'Nora Penhallow');
  await page.keyboard.press('PageDown');
  await page.goBack();
  await expect(dialog.locator('h2')).toHaveText('Jory Penhallow');
  await expect.poll(() => sibling.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight;
  })).toBe(true);
  // The sample's profiles are short: the original position, not a fixed depth.
  expect(Math.abs((await dialog.evaluate((el) => el.scrollTop)) - reading)).toBeLessThanOrEqual(2);
});
for (const [start, target, name] of [
  ['nora-penhallow', 'david-penhallow', 'David Robert Penhallow'],
  ['david-penhallow', 'karin-solberg', 'Karin Ruth (Solberg) Penhallow'],
  ['david-penhallow', 'nora-penhallow', 'Nora Penhallow'],
] as const) {
  test(`family connection ${start} to ${target} starts at the heading`, async ({ page }) => {
    const dialog = await profile(page, start);
    await dialog.getByRole('button', { name: new RegExp(' ' + name.replace(/[()]/g, '\\$&') + '$') }).last().click();
    await headingVisible(page, name);
  });
}

test('Forward restores the visited sibling reading offset without a second jump', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const dialog = await profile(page, 'jory-penhallow');
  await dialog.getByRole('button', { name: / Nora Penhallow$/ }).click();
  await headingVisible(page, 'Nora Penhallow');
  await page.keyboard.press('PageDown');
  await expect.poll(() => dialog.evaluate(el => el.scrollTop)).toBeGreaterThan(300);
  await dialog.evaluate(el => new Promise(resolve => {
    let previous = el.scrollTop, stable = 0;
    const sample = () => { const top = el.scrollTop; stable = top === previous ? stable + 1 : 0; previous = top; if (stable >= 6) resolve(top); else requestAnimationFrame(sample); };
    requestAnimationFrame(sample);
  }));
  const position = await dialog.evaluate(el => el.scrollTop);
  await page.goBack();
  await expect(dialog.locator('h2')).toHaveText('Jory Penhallow');
  await page.goForward();
  await expect(dialog.locator('h2')).toHaveText('Nora Penhallow');
  await expect.poll(async () => Math.abs(await dialog.evaluate(el => el.scrollTop) - position)).toBeLessThanOrEqual(2);
});
