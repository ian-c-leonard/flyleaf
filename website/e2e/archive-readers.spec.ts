import { expect, test } from '@playwright/test';
import { parseGedcom } from '../app/lib/gedcom';
import { showDocumentDetails, showDocumentPage } from './document-helpers';

test('archive search and type survive document reading, reload and Back', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/#view=archive&branch=robert-john-penhallow');
  const search = page.getByRole('textbox', {
    name: 'Search the family archive',
  });
  await search.fill('19');
  await page.getByRole('button', { name: 'Images', exact: true }).click();
  const cards = page.locator('.archive-record');
  await expect(cards).toHaveCount(3);
  const chosenTitle = await cards
    .nth(1)
    .locator('.archive-record-title')
    .textContent();
  await cards.nth(1).click();
  await expect(page.locator('.document-reader')).toBeVisible();
  await page.reload();
  await expect(page.locator('.document-reader')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.document-reader')).toHaveCount(0);
  await expect(search).toHaveValue('19');
  await expect(
    page.getByRole('button', { name: 'Images', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(1).locator('.archive-record-title')).toHaveText(
    chosenTitle!,
  );
  await cards.nth(1).click();
  await page
    .getByRole('button', { name: 'Close document', exact: true })
    .click();
  await page.reload();
  await expect(cards).toHaveCount(3);
  await expect(search).toHaveValue('19');
  await expect(page).toHaveURL(/branch=robert-john-penhallow/);
  await search.fill('1866-penhallow-trembath-marriage-plate.jpg');
  await expect(cards).toHaveCount(1);
  expect(new URLSearchParams(page.url().split('#')[1]).has('archivePage')).toBe(
    false,
  );
  await page.reload();
  await expect(search).toHaveValue(
    '1866-penhallow-trembath-marriage-plate.jpg',
  );
  await expect(cards).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('changing the family branch keeps archive search and type', async ({
  page,
}) => {
  await page.goto('/#view=archive&archiveQuery=19&archiveKind=images');
  await expect(page.locator('.archive-record')).toHaveCount(3);
  await page.locator('.kin-focusbar button[aria-haspopup="dialog"]').click();
  await page
    .getByRole('dialog', { name: 'Choose a family branch' })
    .getByRole('button', { name: /Ruth Anna \(Kessler\) Solberg/ })
    .click();
  await expect(
    page.getByRole('heading', { name: 'The family archive' }),
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Search the family archive' }),
  ).toHaveValue('19');
  await expect(
    page.getByRole('button', { name: 'Images', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.archive-record')).toHaveCount(1);
  const route = new URLSearchParams(page.url().split('#')[1]);
  expect(route.get('branch')).toBe('ruth-kessler');
  expect(route.has('archivePage')).toBe(false);
  await page.getByRole('button', { name: 'Show the whole family' }).click();
  await expect(
    page.getByRole('heading', { name: 'The family archive' }),
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Search the family archive' }),
  ).toHaveValue('19');
  await expect(
    page.getByRole('button', { name: 'Images', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page).not.toHaveURL(/branch=/);
});

test('a tall photograph fits its complete frame and can zoom, resize and return from phone Details', async ({
  page,
}, info) => {
  // A tall plate: the 1944 letter, 1100 by 1700 pixels.
  const file =
    'images/letters/plates/1944-04-09-edith-penhallow-to-robert-plate.jpg';
  await page.goto(
    '/#view=archive&record=source-1b6dnyr&file=' + encodeURIComponent(file),
  );
  const image = page.locator('.document-image-scroll img');
  await image.evaluate((element: HTMLImageElement) => element.decode());
  const wholeFrame = async () => {
    await expect
      .poll(() =>
        image.evaluate((element: HTMLImageElement) => {
          const viewport = element.closest('.document-image-scroll')!;
          const outer = viewport.getBoundingClientRect(),
            frame = element.getBoundingClientRect();
          const expectedScale = Math.min(
            (viewport.clientWidth - 32) / element.naturalWidth,
            (viewport.clientHeight - 32) / element.naturalHeight,
            1,
          );
          return (
            frame.width > 0 &&
            frame.height > 0 &&
            frame.left >= outer.left &&
            frame.top >= outer.top &&
            frame.right <= outer.right + 1 &&
            frame.bottom <= outer.bottom + 1 &&
            Math.abs(frame.width - element.naturalWidth * expectedScale) < 1 &&
            Math.abs(frame.height - element.naturalHeight * expectedScale) <
              1 &&
            Math.abs(
              frame.width / frame.height -
                element.naturalWidth / element.naturalHeight,
            ) < 0.001
          );
        }),
      )
      .toBe(true);
  };
  await wholeFrame();
  const fitted = (await image.boundingBox())!.height;
  await page.getByRole('button', { name: 'Fit width', exact: true }).click();
  await expect
    .poll(async () => (await image.boundingBox())!.height)
    .toBeGreaterThanOrEqual(fitted);
  await page
    .getByRole('button', { name: 'Zoom document in', exact: true })
    .click();
  await expect
    .poll(async () => (await image.boundingBox())!.height)
    .toBeGreaterThan(fitted);
  await page.getByRole('button', { name: 'Fit image', exact: true }).click();
  await wholeFrame();
  for (let attempt = 0; attempt < 3; attempt++) {
    await showDocumentDetails(page);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await showDocumentPage(page);
    await wholeFrame();
  }
  await page.screenshot({ path: info.outputPath('whole-portrait.png') });
  await expect(
    page.getByRole('link', { name: 'Download this file' }),
  ).toHaveAttribute('href', '/data/' + file);
  await page.setViewportSize({ width: 600, height: 700 });
  await wholeFrame();
});

test('the selected file heading and full-height Details preserve complete citation and note paragraphs', async ({
  page,
}, info) => {
  const file =
    'images/newspapers/1912-03-07-iowa-county-lantern-penhallow-obituary.pdf';
  const data = parseGedcom(
    await (await page.request.get('/data/family.ged')).text(),
  );
  const source = data.sources.find((source) => source.id === 'source-1snoqnn')!;
  await page.goto(
    '/#view=archive&record=' + source.id + '&file=' + encodeURIComponent(file),
  );
  await expect(page.locator('.document-header h2')).toHaveText(
    source.archives.find((entry) => entry.path === file)!.title!,
  );
  await expect(page.locator('.document-header')).toContainText(
    'Newspaper page',
  );
  await showDocumentDetails(page);
  const reference = page
    .locator('details.document-assessment')
    .filter({ has: page.getByText('Full reference', { exact: true }) });
  await reference.locator('summary').click();
  const paragraph = reference.locator('p');
  expect(await paragraph.textContent()).toBe(source.label);
  await expect(paragraph).toHaveCSS('white-space', 'pre-wrap');
  if (page.viewportSize()!.width <= 800) {
    expect(
      (await page.locator('.document-information').boundingBox())!.height,
    ).toBeGreaterThan(500);
    await expect(page.locator('.document-display')).toBeHidden();
  }
  await paragraph.scrollIntoViewIfNeeded();
  await expect(
    page.getByRole('button', { name: 'Close document' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Download this file' }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('document-details.png') });
  await showDocumentPage(page);
  await expect(page.locator('.document-display')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.document-reader')).toHaveCount(0);
});
