import { test, expect, type Page } from '@playwright/test';

// The book PDF's address, as the current build publishes it.
async function bookPdf(page: Page) {
  const descriptor = (await (await page.request.get('/data/book.json')).json()) as {
    book: { path: string; title: string };
  };
  return descriptor.book;
}
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('optional PDF text failure keeps the rendered page readable', async ({
  page,
}) => {
  const errors: string[] = [];
  let injected = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/assets/pdf-*.js', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    // Exercise the real reader after its canvas render succeeds. The pinned
    // PDF.js bundle has one public text-extraction method; fail loudly if its
    // shape changes rather than silently omitting the fault injection.
    const method = /getTextContent\([^)]*\)\{/g;
    expect([...body.matchAll(method)]).toHaveLength(1);
    injected++;
    await route.fulfill({
      response,
      body: body.replace(
        method,
        (match) =>
          match +
          'throw new Error("Controlled optional text extraction failure");',
      ),
    });
  });
  await page.goto('/#view=book&bookPage=1');
  await page.getByText('Page text', { exact: true }).click();
  await expect(
    page.getByText('Text is unavailable for this page.', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('.document-error')).toHaveCount(0);
  const ink = await page
    .locator('.pdf-pages canvas')
    .evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas
        .getContext('2d')!
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i + 3] && pixels[i] + pixels[i + 1] + pixels[i + 2] < 700)
          count++;
      return count;
    });
  expect(ink).toBeGreaterThan(1000);
  expect(injected).toBe(1);
  expect(errors).toEqual([]);
});

test('a failed PDF load still reports the failure and offers the original', async ({
  page,
}) => {
  const pdf = await bookPdf(page);
  const name = pdf.path.split('/').at(-1)!;
  await page.route('**/data/publications/*/' + name, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'text/plain',
      body: 'Temporary test failure',
    }),
  );
  await page.goto('/#view=book&bookPage=1');
  await expect(page.locator('.document-error')).toContainText(
    'The page could not be displayed.',
  );
  await expect(
    page.getByRole('link', { name: 'Open the original PDF' }),
  ).toHaveAttribute(
    'href',
    new RegExp('/data/publications/[a-f0-9]{64}/' + literal(name) + '$'),
  );
});

test('family book contents, page links, branch context and downloads survive a reload', async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const pdf = await bookPdf(page);
  const name = pdf.path.split('/').at(-1)!;
  await page.goto('/#view=book&bookPage=1&branch=joan-treloar');
  await expect(
    page.getByRole('heading', { name: pdf.title }),
  ).toBeVisible();
  await expect(
    page.getByText('Your branch choice stays', { exact: false }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('.pdf-pages canvas')
        .evaluate((canvas: HTMLCanvasElement) => canvas.width),
    )
    .toBeGreaterThan(0);
  await page
    .getByText('Contents · Choose a chapter or section', { exact: true })
    .click();
  const chapter = page
    .locator('.pdf-contents button')
    .filter({ hasText: /Chapter 3\./ });
  await expect(chapter).toHaveCount(1);
  await chapter.click();
  await expect(page).toHaveURL(/bookPage=\d+.*bookVersion=[a-f0-9]{64}/);
  const number = await page
    .getByRole('spinbutton', { name: 'Document page number' })
    .inputValue();
  await page.reload();
  await expect(
    page.getByRole('spinbutton', { name: 'Document page number' }),
  ).toHaveValue(number);
  await expect(page.locator('.pdf-loading')).toHaveCount(0, { timeout: 45000 });
  await expect(page.locator('.document-error')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const download = page.getByRole('link', { name: 'Download PDF' });
  await expect(download).toHaveAttribute(
    'href',
    new RegExp('publications/[a-f0-9]{64}/' + literal(name) + '\\?download$'),
  );
  expect(errors).toEqual([]);
});

test('an earlier edition link is explicit and never opens its page in the current PDF', async ({
  page,
}) => {
  const name = (await bookPdf(page)).path.split('/').at(-1)!;
  await page.goto('/#view=book&bookPage=42&bookVersion=' + 'a'.repeat(64));
  await expect(
    page.getByRole('heading', {
      name: 'This link is for an older edition.',
    }),
  ).toBeVisible();
  await expect(page.locator('.pdf-reader')).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Open the older edition' }),
  ).toHaveAttribute(
    'href',
    '/data/publications/' + 'a'.repeat(64) + '/' + name + '#page=42',
  );
  await page.getByRole('button', { name: 'Read the current edition' }).click();
  await expect(
    page.getByRole('spinbutton', { name: 'Document page number' }),
  ).toHaveValue('1');
  await expect(page).toHaveURL(/bookPage=1/);
});
