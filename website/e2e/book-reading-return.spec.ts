import { expect, test, type Page } from '@playwright/test';
import type { WebBook } from '../app/lib/native-book';
import { marriageNote } from './sample-book';

async function edition(page: Page) {
  const descriptor = await (await page.request.get('/data/book.json')).json() as { webBook: WebBook };
  const { anchor } = await marriageNote(page);
  return { web: descriptor.webBook, note: { anchor } };
}

async function bookmarkedNote(page: Page) {
  const current = await edition(page);
  await page.goto('/#view=book&bookAnchor=nar-john-penhallow&bookNote=' + current.web.sha256 + ':' + current.note.anchor);
  await expect(page.locator('dialog.book-note-modal')).toBeVisible();
  return current;
}

test('pointer return visibly identifies the exact note through queued position restoration', async ({ page }) => {
  const { note } = await bookmarkedNote(page);
  await page.getByRole('button', { name: 'Return to reading', exact: true }).click();
  const marker = page.locator(`[role=doc-noteref][href="#${note.anchor}"]`).first();
  await expect(marker).toBeFocused();
  await expect(marker).toHaveAttribute('data-book-return-target', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
  const visible = await marker.evaluate((el) => {
    const s = getComputedStyle(el), b = el.getBoundingClientRect();
    return s.outlineStyle === 'solid' && parseFloat(s.outlineWidth) >= 2 && b.top > 0 && b.bottom < innerHeight;
  });
  expect(visible).toBe(true);
  await marker.evaluate((el) => el.dispatchEvent(new WheelEvent('wheel', { bubbles: true })));
  await expect(marker).not.toHaveAttribute('data-book-return-target');
  await expect(page.locator('dialog.book-note-modal,.book-preview')).toHaveCount(0);
});

test('manual Book note survives original Back and original Escape without a stale reopen', async ({ page }) => {
  const { note, web } = await edition(page);
  await page.goto('/#view=book&bookAnchor=nar-john-penhallow');
  const marker = page.locator(`[role=doc-noteref][href="#${note.anchor}"]`).first();
  await marker.click();
  const preview = page.locator('dialog.book-preview');
  await expect(preview).toContainText('Wesleyan Methodist Chapel');
  await preview.getByRole('button', { name: 'See the record', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close document', exact: true })).toBeVisible();
  await page.goBack();
  const modal = page.locator('dialog.book-note-modal');
  await expect(modal).toBeVisible();
  expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('bookNote')).toBe(web.sha256 + ':' + note.anchor);
  await expect(modal).toContainText('Wesleyan Methodist Chapel');
  await modal.getByRole('button', { name: 'See the record', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close document', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('Wesleyan Methodist Chapel');
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('bookNote')).toBeNull();
  await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
  await expect(page.locator('dialog.book-note-modal,.book-preview')).toHaveCount(0);
});

test('back in the book, a reader who reads on is not pulled back', async ({
  page,
}) => {
  await page.goto('/#view=book&bookAnchor=nar-john-penhallow');
  await page.locator('.native-book-content').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(200, 400);
  await page.mouse.wheel(0, 900);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => Math.round(scrollY));
  await page.getByRole('button', { name: 'Family home', exact: true }).click();
  await expect(page.locator('.native-book-content')).toHaveCount(0);
  await page.goBack();
  await page.locator('.native-book-content').waitFor();
  await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBe(saved);
  // Reading on: nothing may return the page to the saved place, such as the
  // home page's photographs turning while the book is open.
  await page.mouse.wheel(0, 700);
  await expect
    .poll(() => page.evaluate(() => Math.round(scrollY)))
    .toBeGreaterThan(saved + 100);
  const reading = await page.evaluate(() => Math.round(scrollY));
  await page.waitForTimeout(6000);
  expect(await page.evaluate(() => Math.round(scrollY))).toBe(reading);
});
