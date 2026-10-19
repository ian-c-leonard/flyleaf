import { expect, test } from '@playwright/test';
import { parseGedcom } from '../app/lib/gedcom';
import { showDocumentDetails, showDocumentPage } from './document-helpers';

// The sample's illustration source: five citation uses across its photographs.
const sourceId = 'source-1nyvnf1';

test('citation uses remain separate through selection, files, reload and Back', async ({
  page,
}, info) => {
  const data = parseGedcom(
    await (await page.request.get('/data/family.ged')).text(),
  );
  const source = data.sources.find((source) => source.id === sourceId)!;
  expect(source.uses!.length).toBeGreaterThan(1);
  const file = source.archives[0].path;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(
    '/#view=archive&archiveQuery=illustration&archiveKind=images&record=' +
      source.id +
      '&file=' +
      encodeURIComponent(file),
  );
  await page.getByRole('button', { name: 'Zoom document in' }).click();
  const zoom = await page
    .getByRole('status', { name: 'Image zoom' })
    .textContent();
  await showDocumentDetails(page);
  const control = page.getByRole('combobox', {
    name: 'Choose a reference',
    exact: true,
  });
  await expect(control).toHaveValue('');
  await expect(control.locator('option')).toHaveCount(source.uses!.length + 1);
  for (const use of source.uses!) {
    await control.selectOption(use.id);
    await expect(page.locator('.document-use-note')).toHaveAttribute(
      'data-citation-use',
      use.id,
    );
    expect(
      await page.locator('.citation-qualification').allTextContents(),
    ).toEqual(use.notes);
    expect(
      new URLSearchParams(page.url().split('#')[1]).get('citationUse'),
    ).toBe(use.id);
    await expect(
      page.getByRole('link', { name: 'Download this file' }),
    ).toHaveAttribute('href', '/data/' + file);
  }
  await showDocumentPage(page);
  await expect(page.getByRole('status', { name: 'Image zoom' })).toHaveText(
    zoom!,
  );
  await showDocumentDetails(page);
  const last = source.uses!.at(-1)!;
  const otherFile = source.archives[1].path;
  await page
    .locator('.document-information > .document-files button')
    .and(page.locator('[data-file="' + otherFile + '"]'))
    .click();
  await showDocumentDetails(page);
  await expect(control).toHaveValue(last.id);
  await page.reload();
  await showDocumentDetails(page);
  await expect(control).toHaveValue(last.id);
  await page.goBack();
  await showDocumentDetails(page);
  await expect(
    page.getByRole('link', { name: 'Download this file' }),
  ).toHaveAttribute('href', '/data/' + file);
  await expect(control).toHaveValue(last.id);
  await page.goBack();
  await showDocumentDetails(page);
  await expect(control).toHaveValue(source.uses!.at(-2)!.id);
  await page.screenshot({
    path: info.outputPath('separate-citation-use.png'),
  });
  // On a phone, Close in Details first returns to the page.
  await showDocumentPage(page);
  await page.getByRole('button', { name: 'Close document' }).click();
  await expect(page.locator('.document-reader')).toHaveCount(0);
  const route = new URLSearchParams(page.url().split('#')[1]);
  expect(route.has('citationUse')).toBe(false);
  expect(route.get('archiveQuery')).toBe('illustration');
  expect(route.get('archiveKind')).toBe('images');
  expect(errors).toEqual([]);
});

test('a stale use shows an explicit overview', async ({ page }) => {
  await page.goto(
    '/#view=archive&record=' + sourceId + '&citationUse=citation-stale-reference',
  );
  await showDocumentDetails(page);
  const control = page.getByRole('combobox', {
    name: 'Choose a reference',
    exact: true,
  });
  await expect(page.locator('.document-citation-uses output')).toContainText(
    'That reference is no longer here.',
  );
  await expect(control).toHaveValue('');
  await expect(page.locator('.citation-qualification')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show the overview' }).click();
  await expect(page.locator('.document-citation-uses output')).toHaveCount(0);
  expect(new URLSearchParams(page.url().split('#')[1]).has('citationUse')).toBe(
    false,
  );
});
