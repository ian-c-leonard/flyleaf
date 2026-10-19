import type { Page } from '@playwright/test';

/** The sample book's 1866 marriage note in its first chapter, which cites a
 * held record. Read from the published web book, without opening a page. */
export async function marriageNote(page: Page) {
  const descriptor = (await (await page.request.get('/data/book.json')).json()) as {
    webBook: { path: string; sha256: string };
  };
  const { html } = (await (
    await page.request.get('/data/' + descriptor.webBook.path)
  ).json()) as { html: string };
  const sentence = html.indexOf('John and Elizabeth married');
  const anchor = /href="#(loc-\d+)" role="doc-noteref"/.exec(html.slice(sentence))?.[1];
  if (sentence < 0 || !anchor) throw new Error('The sample marriage note is missing');
  return { sha256: descriptor.webBook.sha256, anchor };
}
