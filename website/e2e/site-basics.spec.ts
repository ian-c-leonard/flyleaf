import { expect, test, type Page } from '@playwright/test';
import { parseGedcom } from '../app/lib/gedcom';
import { identifiedPortrait } from '../app/lib/visuals';

// The sample family's demo is a static site: no sign-in, no sharing, no
// administrator. Its recipe book is its only treasure.

test('a visitor to a static site never sees the administrator’s view menu', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.kin-home-hero')).toBeVisible();
  await expect(page.locator('.kin-viewas')).toHaveCount(0);
  await expect(page.getByText('See the site as')).toHaveCount(0);
});

test('headings describe the treasures the family has', async ({ page }) => {
  await page.goto('/');
  const treasures = page.locator('.kin-treasures');
  await expect(treasures.locator('h2')).toHaveText('Recipes');
  await page.goto('/#view=treasures');
  await expect(page.locator('.kin-treasures .kin-page-heading p')).toHaveText(
    'Family recipes.',
  );
});

test('cards never put a heading inside a button', async ({ page }) => {
  // A screen reader flattens a heading inside a button, so cards use text.
  const headingsInButtons = page.locator('button :is(h1, h2, h3, h4, h5, h6)');
  await page.goto('/');
  await expect(page.locator('.kin-story-card').first()).toBeVisible();
  await expect(headingsInButtons).toHaveCount(0);
  await page.goto('/#view=archive');
  await expect(page.locator('.archive-record').first()).toBeVisible();
  await expect(headingsInButtons).toHaveCount(0);
});

test('the menu button says what it will do', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'The menu button is for narrow screens');
  await page.goto('/');
  const button = page.locator('.kin-mobile-menu');
  await expect(button).toHaveAttribute('aria-label', 'Open navigation');
  await button.click();
  await expect(button).toHaveAttribute('aria-label', 'Close navigation');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
});

test('the share page on a static site offers email, not another address', async ({
  page,
}) => {
  await page.goto('/#view=share');
  const note = page.locator('.kin-share > p');
  await expect(note).toContainText('does not take contributions');
  await expect(note.locator('a')).toHaveAttribute('href', /^mailto:/);
  await expect(page.locator('.kin-share a[href^="http"]')).toHaveCount(0);
});

test('dates read day, month, year, as in the book', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.kin-book-invite small')).toHaveText(
    /^Updated \d{1,2} [A-Z][a-z]+ \d{4} · \d+ pages$/,
  );
});

test('family tree portraits load the small previews', async ({ page }) => {
  // Someone with an approved portrait, found from the family's own records.
  const data = parseGedcom(
    await (await page.request.get('/data/family.ged')).text(),
  );
  const person = data.people.find((p) => identifiedPortrait(data, p.id))!;
  expect(person).toBeTruthy();
  await page.goto(`/#view=tree&focus=${person.id}`);
  const portraits = page.locator('.tree-monogram img');
  await expect(portraits.first()).toBeAttached();
  for (const src of await portraits.evaluateAll((images) =>
    images.map((image) => image.getAttribute('src') || ''),
  ))
    expect(src).toMatch(/\/data\/previews\/[^/]+\/640\.webp$/);
});

/** The contrast of an element's text with the first background behind it. */
async function contrast(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const rgb = (value: string) =>
        (value.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
      let node: Element | null = element;
      let background = [255, 255, 255];
      while (node) {
        const [r, g, b, a = 1] = rgb(getComputedStyle(node).backgroundColor);
        if (a > 0) {
          background = [r, g, b];
          break;
        }
        node = node.parentElement;
      }
      const luminance = ([r, g, b]: number[]) =>
        [r, g, b]
          .map((c) => c / 255)
          .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
          .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
      const [l1, l2] = [
        luminance(rgb(getComputedStyle(element).color)),
        luminance(background),
      ].sort((a, b) => b - a);
      return (l1 + 0.05) / (l2 + 0.05);
    });
}

test('small text has at least 4.5:1 contrast with its background', async ({
  page,
}) => {
  await page.goto('/#view=archive');
  await expect(page.locator('.archive-thumbnail > span').first()).toBeVisible();
  expect(
    await contrast(page, '.archive-thumbnail > span'),
  ).toBeGreaterThanOrEqual(4.5);
  await page.goto('/#view=book');
  await expect(page.locator('.book-source-unavailable').first()).toBeAttached();
  expect(
    await contrast(page, '.book-source-unavailable'),
  ).toBeGreaterThanOrEqual(4.5);
});

test('a part of the site that fails to draw shows a message, not a blank page', async ({
  page,
}) => {
  // Break sorting, which the people page uses as it draws.
  await page.addInitScript(() => {
    const sort = String.prototype.localeCompare;
    String.prototype.localeCompare = function (...args) {
      if (location.hash.includes('view=people'))
        throw new Error('A drawing failure for this test');
      return sort.apply(this, args as Parameters<typeof sort>);
    };
  });
  await page.goto('/#view=people');
  await expect(
    page.getByRole('heading', { name: 'Something went wrong' }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText(
    'This page could not be shown. Reload to try again.',
  );
});
