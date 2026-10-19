import test from 'node:test';
import assert from 'node:assert/strict';
import { readBookPublication } from '../app/lib/publication.ts';
import { site } from '../app/lib/settings.ts';

void test('a book belongs only to its delivered genealogy and immutable PDF address', () => {
  const sha256 = 'a'.repeat(64);
  const book = {
    title: 'The family book',
    subtitle: 'A living history',
    editionDate: '2026-09-12',
    sha256,
    path: `publications/${sha256}/${site.pdfName}`,
    bytes: 120000,
    pages: 467,
  };
  const index = { schema: 1, gedcomSha256: 'b'.repeat(64), book };
  assert.deepEqual(readBookPublication(index, index.gedcomSha256), book);
  assert.equal(readBookPublication(index, 'c'.repeat(64)), null);
  for (const patch of [
    { path: '/private/file.pdf' },
    { path: 'publications/../secret.pdf' },
    { sha256: 'c'.repeat(64) },
    { pages: 0 },
    { pages: 1.5 },
    { bytes: -1 },
    { editionDate: '2026-99-99' },
    { editionDate: '2026-02-30' },
  ])
    assert.equal(
      readBookPublication(
        { ...index, book: { ...book, ...patch } },
        index.gedcomSha256,
      ),
      null,
    );
});
