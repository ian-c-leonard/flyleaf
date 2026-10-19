import { test, expect } from '@playwright/test';

// The sample names its "Methodology" chapter as the research tab
// (book.research_tab in flyleaf.json). That chapter reads on its own tab,
// apart from the rest of the book.
test('the research tab shows the chapter the family names, apart from the book', async ({
  page,
}) => {
  await page.goto('/#view=book');
  const tabs = page.getByRole('navigation', { name: 'Book sections' });
  const methodology = page.locator(
    '.native-book-content h2#reading-methodology',
  );
  await expect(page.locator('.native-book-content')).toBeVisible();
  await expect(methodology).toBeHidden();
  await tabs.getByRole('button', { name: 'About the research' }).click();
  await expect(page).toHaveURL(/bookAnchor=reading-methodology/);
  await expect(methodology).toBeVisible();
  await expect(
    page.locator('.native-book-content h2#ch-penhallow'),
  ).toBeHidden();
  await tabs.getByRole('button', { name: 'Read the book' }).click();
  await expect(methodology).toBeHidden();
  await expect(
    page.locator('.native-book-content h2#ch-penhallow'),
  ).toBeAttached();
});
