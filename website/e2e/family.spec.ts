import { test, expect } from '@playwright/test';
import { parseGedcom } from '../app/lib/gedcom';
import { showDocumentDetails } from './document-helpers';

test('an empty branch search can search the whole family without losing its query', async ({
  page,
}) => {
  await page.goto('/#view=archive&branch=ruth-kessler');
  const search = page.getByRole('textbox', {
    name: 'Search the family archive',
  });
  await search.fill('1866-penhallow-trembath-marriage-plate.jpg');
  await expect(page.locator('.archive-record')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Search the whole family', exact: true })
    .click();
  await expect(search).toHaveValue(
    '1866-penhallow-trembath-marriage-plate.jpg',
  );
  await expect(page.locator('.archive-record')).toHaveCount(1);
  await expect(page).not.toHaveURL(/branch=/);
});

test('browsing uses smaller full-frame images and opening a photograph selects its original', async ({
  page,
}) => {
  // A photograph in the album, found from the family's own records.
  const data = parseGedcom(
    await (await page.request.get('/data/family.ged')).text(),
  );
  const visual = data.visuals!.find(
    (v) => v.content === 'photograph' && v.album === 'display',
  )!;
  expect(visual).toBeTruthy();
  await page.goto('/#view=photos');
  const card = page.locator(`button[data-image-id="${visual.assetId}"]`);
  const preview = card.locator('img');
  await preview.scrollIntoViewIfNeeded();
  await expect(preview).toHaveAttribute(
    'src',
    /\/data\/previews\/.+\/1600\.webp$/,
  );
  await preview.evaluate((img: HTMLImageElement) => img.decode());
  expect(
    await preview.evaluate((img: HTMLImageElement) =>
      Math.max(img.naturalWidth, img.naturalHeight),
    ),
  ).toBeLessThanOrEqual(1600);
  await card.click();
  const photograph = page.locator('.kin-image-modal');
  await expect(photograph).toBeVisible();
  await expect(photograph.locator('.kin-image-view > img')).toHaveAttribute(
    'src',
    '/data/' + visual.path,
  );
  await expect(
    photograph.getByRole('link', { name: /^Download / }).first(),
  ).toHaveAttribute('href', /\/data\/images\/.+\.(png|jpg|jpeg|heic)$/i);
});

test('missing previews and a stale index fall back to held originals', async ({
  page,
}) => {
  await page.route('**/data/previews/**/*.webp', (route) =>
    route.fulfill({ status: 404, body: '' }),
  );
  await page.goto('/');
  const image = page.locator('.kin-featured-photo img');
  await expect(image).toHaveAttribute('src', /\/data\/images\//);
  await image.evaluate((img: HTMLImageElement) => img.decode());
  await page.unroute('**/data/previews/**/*.webp');
  await page.route('**/data/previews.json', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      json: { ...data, gedcomSha256: 'a different edition' },
    });
  });
  await page.reload();
  await expect(image).toHaveAttribute('src', /\/data\/images\//);
  await image.evaluate((img: HTMLImageElement) => img.decode());
});

test('a book illustration keeps its book context through archive search and reload', async ({
  page,
}) => {
  await page.goto('/#view=archive');
  await page
    .getByRole('textbox', { name: 'Search the family archive' })
    .fill('1866-penhallow-trembath-marriage-plate');
  const card = page.locator('.archive-record');
  await expect(card).toHaveCount(1);
  await expect(card.locator('img')).toHaveAttribute(
    'src',
    /\/data\/previews\/.+\/640\.webp$/,
  );
  await card.click();
  await expect(page.locator('.document-header')).toContainText(
    'From the family book',
  );
  await expect(page.locator('.document-image-scroll img')).toHaveAttribute(
    'src',
    /\/data\/images\/documents\/plates\/1866-penhallow-trembath-marriage-plate\.jpg$/,
  );
  await page.reload();
  await expect(page.locator('.document-header')).toContainText(
    'From the family book',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test('following a chapter beyond a branch survives image Back and reload', async ({
  page,
}, info) => {
  await page.goto(
    '/#view=book&branch=ruth-kessler&bookAnchor=reading-arne-and-ruth',
  );
  await expect(page.locator('#reading-arne-and-ruth')).toBeVisible();
  if (info.project.name === 'phone')
    await page.getByRole('button', { name: 'Contents', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Book contents', exact: true })
    .getByRole('link', { name: 'John and Elizabeth', exact: true })
    .click();
  const chapter = page.locator('#nar-john-penhallow');
  await expect(chapter).toBeVisible();
  await chapter
    .locator('xpath=following::figure[1]')
    .locator('a[data-book-image]')
    .click();
  await expect(page.locator('.document-reader')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.document-reader')).toHaveCount(0);
  await expect(chapter).toBeVisible();
  await page.reload();
  await expect(chapter).toBeVisible();
  await expect(page).toHaveURL(/branch=ruth-kessler/);
});

test('whole family → branch → chapter → original → life and register, with Back and direct links', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Our family history' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Find your branch' }).click();
  const selector = page.getByRole('dialog', { name: 'Choose a family branch' });
  await expect(selector).toBeVisible();
  await selector.getByRole('button', { name: /Robert John Penhallow/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Robert’s family branch' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Read a chapter' }).click();
  await expect(page).toHaveURL(/view=book.*bookAnchor=/);
  const anchor = new URLSearchParams(page.url().split('#')[1]).get(
    'bookAnchor',
  )!;
  const chapter = page.locator('#' + anchor);
  await expect(chapter).toBeVisible();
  await chapter
    .locator('xpath=following::figure[1]')
    .locator('a[data-book-image]')
    .click();
  await expect(page.locator('.document-reader')).toBeVisible();
  await expect(page.locator('.document-image-scroll img')).toBeVisible();
  const sourceUrl = page.url();
  await page.reload();
  await expect(page.locator('.document-reader')).toBeVisible();
  expect(page.url()).toContain('branch=robert-john-penhallow');
  await page.getByRole('button', { name: 'Close document' }).click();
  await page.getByRole('button', { name: /Show the whole family/ }).click();
  await page.getByRole('button', { name: 'Family home' }).click();
  await expect(
    page.getByRole('heading', { name: 'Our family history' }),
  ).toBeVisible();
  await page.goBack();
  await page.goBack();
  await expect(chapter).toBeVisible();
  expect(page.url()).toContain('branch=robert-john-penhallow');
  await page.goto(sourceUrl);
  await expect(page.locator('.document-reader')).toBeVisible();
  await page.getByRole('button', { name: 'Close document' }).click();
  if (info.project.name === 'phone')
    await page
      .getByRole('button', { name: 'Open navigation', exact: true })
      .click();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'People', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Search people', exact: true })
    .fill('Robert');
  await page
    .locator('.kin-person')
    .filter({ hasText: 'Robert John Penhallow' })
    .first()
    .click();
  const person = page.getByRole('dialog', { name: 'Robert John Penhallow' });
  await expect(person).toBeVisible();
  await person.getByRole('button', { name: /entry in the book/ }).click();
  await expect(page.locator('#reg-robert-john-penhallow')).toBeVisible();
  await expect(page).toHaveURL(/branch=robert-john-penhallow/);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test('a native source attachment is searchable, readable and stable through reload and Back', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/#view=archive');
  await page
    .getByRole('textbox', { name: 'Search the family archive' })
    .fill('1944-04-09-edith-penhallow-to-robert-plate.jpg');
  await expect(page.locator('.archive-record')).toHaveCount(1);
  await expect(page.locator('.archive-record')).toContainText('Image file');
  await page.locator('.archive-record').click();
  await expect(page.locator('.document-header')).toContainText('Image file');
  await expect(page.locator('.document-image-scroll img')).toHaveAttribute(
    'src',
    /edith-penhallow-to-robert-plate.jpg/,
  );
  await page
    .locator('.document-image-scroll img')
    .evaluate((image: HTMLImageElement) => image.decode());
  await page.reload();
  await expect(page.locator('.document-image-scroll img')).toHaveAttribute(
    'src',
    /edith-penhallow-to-robert-plate.jpg/,
  );
  await showDocumentDetails(page);
  await page.screenshot({ path: testInfo.outputPath('native-source.png') });
  await page.goBack();
  await expect(page.locator('.document-reader')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'The family archive' }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test('a shared document exposes its distinct citations after reload', async ({
  page,
}) => {
  await page.goto('/#view=archive');
  await page
    .getByRole('textbox', { name: 'Search the family archive' })
    .fill('1912-03-07-iowa-county-lantern-penhallow-obituary-plate.jpg');
  await page.locator('.archive-record').first().click();
  await showDocumentDetails(page);
  await page.locator('.document-related summary').click();
  const related = await page.locator('.document-related button').count();
  expect(related).toBeGreaterThan(1);
  await expect(
    page.locator('.document-related button small').first(),
  ).toBeVisible();
  const firstCitation = await page
    .locator('.document-locator')
    .first()
    .innerText();
  await page.locator('.document-related button').first().click();
  await expect(page.locator('.document-locator').first()).not.toHaveText(
    firstCitation,
  );
  const chosen = (await page
    .locator('.document-locator')
    .first()
    .textContent())!;
  // Each record lists the others that use the file.
  const others = await page.locator('.document-related button').count();
  expect(others).toBeGreaterThan(0);
  await page.reload();
  await showDocumentDetails(page);
  await expect(page.locator('.document-locator').first()).toHaveText(chosen);
  const summary = page.locator('.document-related summary');
  if (!(await page.locator('.document-related button').first().isVisible()))
    await summary.click();
  await expect(page.locator('.document-related button')).toHaveCount(others);
  await expect(
    page.locator('.document-related button small').first(),
  ).toBeVisible();
});

test('switching citations preserves a shared file that is not the first attachment', async ({
  page,
}) => {
  const data = parseGedcom(
    await (await page.request.get('/data/family.ged')).text(),
  );
  const file =
    'images/newspapers/plates/1912-03-07-iowa-county-lantern-penhallow-obituary-plate.jpg';
  const source = data.sources.find(
    (s) => s.archives.findIndex((a) => a.path === file) > 0,
  )!;
  await page.goto(
    '/#view=archive&record=' + source.id + '&file=' + encodeURIComponent(file),
  );
  await expect(page.locator('.document-image-scroll img')).toHaveAttribute(
    'src',
    '/data/' + file,
  );
  await showDocumentDetails(page);
  await page.locator('.document-related summary').click();
  await page.locator('.document-related button').first().click();
  await expect(page.locator('.document-image-scroll img')).toHaveAttribute(
    'src',
    '/data/' + file,
  );
  await page.reload();
  await expect(page.locator('.document-image-scroll img')).toHaveAttribute(
    'src',
    '/data/' + file,
  );
});
