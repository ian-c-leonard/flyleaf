import { site } from './settings.ts';

export type BookPublication = {
  title: string;
  subtitle: string;
  editionDate: string;
  path: string;
  sha256: string;
  bytes: number;
  pages: number;
};

// A hosted book belongs to this exact delivered genealogy. Imported families
// never inherit it, and malformed metadata never becomes an arbitrary URL.
export function readBookPublication(
  value: unknown,
  gedcomSha256: string,
): BookPublication | null {
  if (!value || typeof value !== 'object') return null;
  const index = value as Record<string, unknown>;
  const book = index.book as BookPublication | undefined;
  if (
    index.schema !== 1 ||
    index.gedcomSha256 !== gedcomSha256 ||
    !book ||
    !/^[a-f0-9]{64}$/.test(book.sha256) ||
    book.path !== `publications/${book.sha256}/${site.pdfName}` ||
    typeof book.title !== 'string' ||
    !book.title.trim() ||
    typeof book.subtitle !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(book.editionDate) ||
    !Number.isSafeInteger(book.bytes) ||
    book.bytes <= 0 ||
    !Number.isSafeInteger(book.pages) ||
    book.pages <= 0
  )
    return null;
  const date = new Date(book.editionDate + 'T12:00:00Z');
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== book.editionDate
  )
    return null;
  return book;
}
