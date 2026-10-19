import { expect, type Page } from '@playwright/test';

export async function showDocumentDetails(page: Page) {
  await expect(page.locator('.document-reader')).toBeVisible();
  const control = page.getByRole('button', {
    name: 'Details & files',
    exact: true,
  });
  if (await control.isVisible()) await control.click();
}

export async function showDocumentPage(page: Page) {
  await expect(page.locator('.document-reader')).toBeVisible();
  const control = page.getByRole('button', { name: 'Document', exact: true });
  if (await control.isVisible()) await control.click();
}
