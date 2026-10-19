import { test, expect, type Page } from '@playwright/test';

async function webBookHtml(page: Page) {
  const descriptor = (await (await page.request.get('/data/book.json')).json()) as {
    webBook: { path: string };
  };
  const book = (await (
    await page.request.get('/data/' + descriptor.webBook.path)
  ).json()) as { html: string };
  return book.html;
}
const count = (html: string, pattern: RegExp) =>
  (html.match(pattern) || []).length;

test('the complete web book is the default and its contents lead into chapters', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const html = await webBookHtml(page);
  await page.goto('/#view=book');
  await expect(page.locator('.native-book-content')).toBeVisible();
  await expect(page.locator('.pdf-pages')).toHaveCount(0);
  await expect(
    page.locator('.native-book-content [role="doc-noteref"]'),
  ).toHaveCount(count(html, /role="doc-noteref"/g));
  await expect(page.locator('.native-book-content figure')).toHaveCount(
    count(html, /<figure[\s>]/g),
  );
  await expect(page.locator('.native-book-content [id^="ch-"]')).toHaveCount(3);
  await expect(page.locator('#reg-tamsin-penhallow')).toHaveCount(1);
  if (info.project.name === 'phone')
    await page.getByRole('button', { name: 'Contents', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Book contents', exact: true })
    .getByRole('link', { name: /^Chapter 2\./ })
    .click();
  await expect(page).toHaveURL(/view=book.*bookAnchor=ch-solberg/);
  await expect(page.locator('#ch-solberg')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.locator('#ch-solberg')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a chapter note opens its original with the exact printed note and survives reload', async ({
  page,
}) => {
  await page.goto(
    '/#view=book&bookAnchor=nar-john-penhallow&branch=robert-john-penhallow',
  );
  const marker = page
    .locator('.native-book-content div', {
      hasText: 'John and Elizabeth married',
    })
    .last()
    .locator('[role="doc-noteref"]')
    .first();
  await expect(marker).toBeVisible();
  await marker.click();
  const note = page.getByRole('dialog', { name: 'Source note', exact: true });
  await expect(note).toBeVisible();
  const printText = await note.locator('.book-note-copy').evaluate((node) => {
    const copy = node.cloneNode(true) as HTMLElement;
    copy
      .querySelectorAll(
        'button, .book-source-unavailable, [role="doc-backlink"]',
      )
      .forEach((n) => n.remove());
    return copy.textContent?.trim() || '';
  });
  expect(printText.length).toBeGreaterThan(40);
  await note
    .getByRole('button', { name: 'See the record', exact: true })
    .first()
    .click();
  await expect(page.locator('.document-modal')).toBeVisible();
  await expect(page.locator('.document-book-note p')).toHaveText(printText);
  await expect(page).toHaveURL(/bookNote=[a-f0-9]{64}%3Aloc-/);
  await page.reload();
  await expect(page.locator('.document-book-note p')).toHaveText(printText);
  await expect(page).toHaveURL(/branch=robert-john-penhallow/);
  await page
    .getByRole('button', { name: 'Close document', exact: true })
    .click();
  await expect(page.locator('#nar-john-penhallow')).toBeVisible();
});

test('contents links keep their place in the whole book through Back', async ({
  page,
}, info) => {
  await page.goto(
    '/#view=book&bookAnchor=nar-william-henry-penhallow&branch=joan-treloar',
  );
  await expect(page.locator('#nar-william-henry-penhallow')).toBeVisible();
  if (info.project.name === 'phone')
    await page.getByRole('button', { name: 'Contents', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Book contents', exact: true })
    .getByRole('link', { name: 'Introduction', exact: true })
    .click();
  await expect(page.locator('#reading-introduction')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#nar-william-henry-penhallow')).toBeVisible();
  await expect(page).toHaveURL(/branch=joan-treloar/);
});

test('scroll and repeated note opening retain live headings, notes and next-section navigation', async ({
  page,
}, info) => {
  await page.goto('/#view=book&bookAnchor=nar-john-penhallow');
  const section = page.locator('#nar-john-penhallow');
  await expect(section).toBeVisible();
  const heading = await section.elementHandle();
  const marker = page
    .locator('.native-book-content div', {
      hasText: 'John and Elizabeth married',
    })
    .last()
    .locator('[role="doc-noteref"]')
    .first();
  const markerHandle = await marker.elementHandle();
  const notes = page.locator('.native-book-content [role="doc-noteref"]');
  await expect.poll(() => notes.count()).toBeGreaterThan(100);
  const total = await notes.count();
  for (let i = 0; i < 3; i++) {
    await marker.focus();
    await page.keyboard.press('Enter');
    const preview = page.locator('dialog.book-preview');
    await expect(
      preview
        .getByRole('button', { name: 'See the record', exact: true })
        .first(),
    ).toBeVisible();
    await preview
      .getByRole('button', { name: 'Read full note', exact: true })
      .click();
    const note = page.locator('dialog.book-note-modal');
    await expect(
      note
        .getByRole('button', { name: 'See the record', exact: true })
        .first(),
    ).toBeVisible();
    await note
      .getByRole('button', { name: 'Return to reading', exact: true })
      .click();
    await expect(marker).toBeFocused();
    await expect(notes).toHaveCount(total);
    expect(await heading!.evaluate((n) => n.isConnected)).toBe(true);
    expect(await markerHandle!.evaluate((n) => n.isConnected)).toBe(true);
  }
  if (info.project.name === 'phone')
    await page.getByRole('button', { name: 'Contents', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Book contents', exact: true })
    .getByRole('link', { name: 'Introduction', exact: true })
    .click();
  const toolbar = page.locator('.native-book-toolbar');
  await expect(toolbar.locator(':scope > span')).toHaveText('Introduction');
  const chapter = 'Chapter 1. Penhallow and Treloar — From St Just to the Lead Region';
  await toolbar
    .getByRole('button', { name: 'Next section: ' + chapter, exact: true })
    .click();
  await expect(page.locator('#ch-penhallow')).toBeVisible();
  await expect(toolbar.locator(':scope > span')).toHaveText(chapter);
  await toolbar
    .getByRole('button', {
      name: 'Previous section: Introduction',
      exact: true,
    })
    .click();
  await expect(toolbar.locator(':scope > span')).toHaveText('Introduction');
  expect(await heading!.evaluate((n) => n.isConnected)).toBe(true);
  await expect(notes).toHaveCount(total);
});

test('a chart can be enlarged and closed on a phone without losing the chapter', async ({
  page,
}) => {
  await page.goto('/#view=book&bookAnchor=chart-penhallow-2');
  await page.locator('#chart-penhallow-2 a[data-book-image]').click();
  const chart = page.getByRole('dialog', { name: 'Family chart', exact: true });
  await expect(chart).toBeVisible();
  await expect(chart.locator('img')).toHaveJSProperty('complete', true);
  await chart
    .getByRole('button', { name: 'Close chart', exact: false })
    .click();
  await expect(chart).toHaveCount(0);
  await expect(page.locator('#chart-penhallow-2')).toBeVisible();
});

test('damaged book bytes show a recoverable error before any manuscript HTML is displayed', async ({
  page,
}) => {
  await page.route('**/data/native-book/*.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ html: '<p>Invented text</p>' }),
    }),
  );
  await page.goto('/#view=book');
  await expect(page.getByRole('alert')).toContainText('could not be verified');
  await expect(page.locator('.native-book-content')).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Download PDF', exact: true }),
  ).toBeVisible();
});
