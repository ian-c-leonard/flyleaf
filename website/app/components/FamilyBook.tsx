import {
  ArrowRightIcon,
  ArrowSquareOutIcon,
  DownloadSimpleIcon,
} from '@phosphor-icons/react';
import { useEffect } from 'react';
import PdfDocument from './PdfDocument';
import type { BookPublication } from '../lib/publication';
import NativeBook from './NativeBook';
import ChapterHighlights from './ChapterHighlights';
import type { AtlasData } from '../lib/gedcom';
import type { ArchiveDocument } from '../lib/archive';
import {
  researchChapterOf,
  type ReadingSection,
  type WebBook,
} from '../lib/native-book';
import type { Geography } from '../lib/places';
import type { BookFocusTarget } from '../lib/book-annotations';
import { site } from '../lib/settings';
import { sitePath } from '../lib/paths';
import { calendarDate } from '../lib/date-display';

export default function FamilyBook({
  book,
  page,
  version,
  branch,
  onPage,
  web,
  anchor,
  navigation,
  savedScroll,
  returnFocus,
  data,
  onRead,
  onDocument,
  onAlbum,
  imageUrl,
  noteReference,
  showRequestedNote,
  onNoteText,
  onDismissNote,
  highlights,
  geography,
  onPerson,
  onTree,
  onPlace,
  onRefreshEdition,
  refreshError,
  relationLabel,
  onCorrection,
}: {
  book: BookPublication | null;
  page: number;
  version: string;
  branch: string;
  onPage: (page: number, version: string) => void;
  web: WebBook | null;
  anchor: string;
  navigation: number;
  savedScroll: number;
  returnFocus: BookFocusTarget | null;
  data: AtlasData;
  onRead: (anchor: string) => void;
  onDocument: (
    document: ArchiveDocument,
    file?: string,
    noteReference?: string,
  ) => void;
  onAlbum?: (id: string) => void;
  imageUrl: (path: string) => string;
  noteReference: string;
  showRequestedNote: boolean;
  onNoteText: (text: string) => void;
  onDismissNote: (reference: string) => void;
  highlights: ReadingSection[];
  geography: Geography | null;
  onPerson: (id: string, trigger: HTMLElement) => void;
  onTree?: (id: string, trigger: HTMLElement) => void;
  onPlace: (id: string, trigger: HTMLElement) => void;
  onRefreshEdition: () => void;
  refreshError: string;
  relationLabel?: (personId: string) => string;
  onCorrection?: (personId: string) => void;
}) {
  const pdfMode = page > 0 || !!version;
  // The family's "About the research" chapter, when its book has one.
  const researchChapter = researchChapterOf(web, site.researchTab);
  const methodology =
    !pdfMode &&
    !!researchChapter &&
    web?.sections.some(
      (section) =>
        section.anchor === anchor && section.chapter === researchChapter,
    ) === true;
  const changed = !!book && !!version && version !== book.sha256;
  const currentPage = book ? Math.max(1, Math.min(book.pages, page)) : page;
  useEffect(() => {
    if (pdfMode && book && !changed && (currentPage !== page || !version))
      onPage(currentPage, book.sha256);
  }, [book, changed, currentPage, page, version, onPage, pdfMode]);
  if (!book)
    return (
      <section className="kin-section">
        <div className="kin-page-heading">
          <span className="kin-eyebrow">The family book</span>
          <h1>The family book</h1>
          <p>
            The book isn’t available right now. You can still browse people and
            records.
          </p>
        </div>
      </section>
    );
  const url = sitePath('data/') + book.path;
  const edition = calendarDate(book.editionDate);
  return (
    <section className="kin-section family-book">
      <div className="kin-page-heading">
        <span className="kin-eyebrow">The family book</span>
        <h1>{pdfMode ? book.title : 'The family book'}</h1>
        <p>{site.bookDescription}</p>
      </div>
      <div className="family-book-edition">
        <p>
          Updated {edition}
          <span>
            {' '}
            · {book.pages} pages · {(book.bytes / 1_000_000).toFixed(1)} MB
          </span>
        </p>
        <div>
          <a
            className="kin-text-link"
            href={url + '?download'}
            download={site.pdfName}
          >
            <DownloadSimpleIcon size={18} />
            Download PDF
          </a>
          <a
            className="kin-text-link"
            href={url + '#page=' + (changed ? 1 : currentPage)}
            target="_blank"
            rel="noreferrer"
          >
            <ArrowSquareOutIcon size={18} />
            Open PDF
          </a>
        </div>
      </div>
      <p className="family-book-note">
        Read it below, or download the PDF to print.
        {branch
          ? ' The book covers every branch. Your branch choice stays for the rest of the site.'
          : ''}
      </p>
      {pdfMode && (
        <button
          className="kin-text-link book-switch"
          onClick={() => onRead('')}
        >
          <ArrowRightIcon size={17} /> Read as a web book
        </button>
      )}
      {web && researchChapter && (
        <nav className="book-section-tabs" aria-label="Book sections">
          <button
            aria-current={!pdfMode && !methodology ? 'page' : undefined}
            onClick={() => onRead('')}
          >
            Read the book
          </button>
          <button
            aria-current={methodology ? 'page' : undefined}
            onClick={() => onRead(researchChapter)}
          >
            About the research
          </button>
        </nav>
      )}
      {!pdfMode && web ? (
        <>
          {!anchor && !!highlights.length && (
            <section className="book-highlights-intro">
              <span className="kin-eyebrow">From the book</span>
              <h2>Chapter highlights</h2>
              <ChapterHighlights
                sections={highlights}
                onRead={onRead}
                imageUrl={imageUrl}
              />
            </section>
          )}
          <NativeBook
            web={web}
            book={book}
            anchor={anchor}
            navigation={navigation}
            savedScroll={savedScroll}
            returnFocus={returnFocus}
            data={data}
            onRead={onRead}
            onDocument={onDocument}
            onAlbum={onAlbum}
            noteReference={noteReference}
            showRequestedNote={showRequestedNote}
            onNoteText={onNoteText}
            onDismissNote={onDismissNote}
            methodology={methodology}
            researchChapter={researchChapter}
            geography={geography}
            imageUrl={imageUrl}
            onPerson={onPerson}
            onTree={onTree}
            onPlace={onPlace}
            onRefreshEdition={onRefreshEdition}
            refreshError={refreshError}
            relationLabel={relationLabel}
            onCorrection={onCorrection}
          />
        </>
      ) : !pdfMode ? (
        <div className="native-book-error" role="alert">
          The book didn’t open. Reload the page, or use the PDF above.
        </div>
      ) : changed ? (
        <div className="family-book-changed">
          <h2>This link is for an older edition.</h2>
          <p>Page numbers may have changed.</p>
          <button className="kin-button" onClick={() => onPage(1, book.sha256)}>
            Read the current edition <ArrowRightIcon size={18} />
          </button>
          <a
            className="kin-text-link"
            href={
              sitePath(`data/publications/${version}/${site.pdfName}`) +
              `#page=${page}`
            }
            target="_blank"
            rel="noreferrer"
          >
            Open the older edition <ArrowSquareOutIcon size={18} />
          </a>
        </div>
      ) : (
        <PdfDocument
          key={book.sha256}
          url={url}
          title={book.title}
          pageNumber={currentPage}
          onPageChange={(next) => onPage(next, book.sha256)}
          showContents
        />
      )}
    </section>
  );
}
