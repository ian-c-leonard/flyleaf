import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useDismissible, useMediaQuery } from '../lib/useDismissible';
import {
  ArrowSquareOutIcon,
  DownloadSimpleIcon,
  XIcon,
} from '@phosphor-icons/react';
import type { AtlasData, Person, Source } from '../lib/gedcom';
import { visualFor } from '../lib/visuals';
import VisualContext from './VisualContext';
import type { CitationUse } from '../lib/citation-uses';
import {
  preferredCitationPdfPage,
  type CitationPresentation,
} from '../lib/citation-presentation';
import {
  documentKind,
  readerLocator,
  documentTitle,
  documentFileLocator,
  fileTitle,
  isAudioFile,
  provenanceNote,
  textFromHtml,
  type ArchiveDocument,
} from '../lib/archive';
import Modal from './Modal';
import AudioDocument from './AudioDocument';
import PdfDocument from './PdfDocument';
import ImageDocument from './ImageDocument';
import CitationUses from './CitationUses';
import collections from '@content/family-collections.json';

// Files the viewer reads as text: saved pages through the safe HTML reader.
const textFormats = [
  'epub',
  'html',
  'htm',
  'xhtml',
  'txt',
  'md',
  'csv',
  'json',
  'xml',
];
const TextDocument = lazy(() => import('./TextDocument'));

type BookBlock = { text?: string; image?: string; alt?: string };
type BookChapter = { title: string; blocks: BookBlock[] };

export default function DocumentViewer({
  source,
  relatedSources = [],
  onSource,
  resolveFile,
  onClose,
  onFile,
  bookNote,
  citationChoices = [],
  citationPresentation = [],
  citationPeople = [],
  citationScopeLabel = 'this branch',
  onCitationUse,
  visualData,
  onPerson,
  returnFocus,
  fallbackFocus,
}: {
  source: ArchiveDocument;
  relatedSources?: Source[];
  onSource?: (source: Source, filePath?: string) => void;
  resolveFile: (path: string) => string;
  onClose: () => void;
  onFile?: (path: string) => void;
  bookNote?: string;
  citationChoices?: CitationUse[];
  citationPresentation?: CitationPresentation[];
  citationPeople?: Person[];
  citationScopeLabel?: string;
  onCitationUse?: (id: string) => void;
  visualData?: AtlasData;
  onPerson?: (id: string) => void;
  returnFocus?: () => HTMLElement | null;
  fallbackFocus?: () => HTMLElement | null;
}) {
  const [index, setIndex] = useState(0),
    [showInformation, setShowInformation] = useState(!source.archives.length),
    [text, setText] = useState(''),
    [textLoaded, setTextLoaded] = useState(false),
    [error, setError] = useState('');
  const [chapters, setChapters] = useState<BookChapter[]>([]),
    [chapter, setChapter] = useState(0);
  const information = useRef<HTMLElement>(null);
  const detailsTrigger = useRef<HTMLButtonElement>(null);
  const smallDetails = useMediaQuery('(max-width: 800px)');
  useDismissible({
    enabled: smallDetails && showInformation && source.archives.length > 0,
    root: () => information.current,
    inside: () => [information.current],
    trigger: () => detailsTrigger.current,
    onDismiss: () => setShowInformation(false),
  });
  const file = source.archives[index],
    url = file ? resolveFile(file.path) : '',
    extension = file?.path.split('.').pop()?.toLowerCase(),
    locator = readerLocator(file?.locator);
  const citedPdfPage = file
    ? preferredCitationPdfPage(source, file.path, citationPresentation)
    : undefined;
  const parents =
    source.representations?.filter((r) => r.child === file?.path) || [];
  const derivatives =
    source.representations?.filter((r) => r.parent === file?.path) || [];
  const hasVersions = !!source.representations?.length;
  const visual =
    file && visualData ? visualFor(visualData, file.path) : undefined;
  const visualAsset = visualData?.assets.find((a) => a.id === visual?.assetId);
  const collection = collections.find((entry) =>
    visualData?.sources.some(
      (candidate) =>
        source.sourceIds.includes(candidate.id) &&
        candidate.pointer === entry.source,
    ),
  );
  const heading =
    visual?.title ||
    (file
      ? file.bookCaptions?.length
        ? 'Illustration from the family book'
        : documentTitle(source, file, relatedSources)
      : source.label);
  const selectFile = (path: string) => {
    const next = source.archives.findIndex((f) => f.path === path);
    if (next < 0) return;
    setIndex(next);
    onFile?.(path);
  };
  const image =
      !!extension && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extension),
    pdf = extension === 'pdf';
  useEffect(() => {
    setText('');
    setTextLoaded(false);
    setError('');
    setChapters([]);
    setChapter(0);
    setShowInformation(!url);
    if (!url || image || pdf || !textFormats.includes(extension || '')) return;
    const controller = new AbortController();
    const imageUrls = new Map<string, string>();
    async function load() {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('This file could not be opened.');
      if (extension === 'epub') {
        const { unzipSync, strFromU8 } = await import('fflate');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (controller.signal.aborted) return;
        const files = unzipSync(bytes);
        const parser = new DOMParser();
        const container = parser.parseFromString(
          strFromU8(files['META-INF/container.xml']),
          'application/xml',
        );
        const packagePath = container
          .querySelector('rootfile')
          ?.getAttribute('full-path');
        if (!packagePath || !files[packagePath])
          throw new Error('This book could not be opened.');
        const book = parser.parseFromString(
            strFromU8(files[packagePath]),
            'application/xml',
          ),
          prefix = packagePath.slice(0, packagePath.lastIndexOf('/') + 1);
        const manifest = new Map(
          [...book.querySelectorAll('manifest > item')].map((item) => [
            item.getAttribute('id'),
            item.getAttribute('href'),
          ]),
        );
        const pages = [...book.querySelectorAll('spine > itemref')]
          .map((item) => {
            const relative = manifest.get(item.getAttribute('idref'));
            if (!relative) return null;
            const normalized = new URL(
                relative,
                'https://archive.invalid/' + prefix,
              ).pathname.slice(1),
              bytes = files[decodeURIComponent(normalized)];
            if (!bytes) return null;
            const html = strFromU8(bytes),
              document = globalThis.document.createElement('template');
            // XHTML allows empty title/script/style tags; HTML's fragment parser needs explicit end tags.
            document.innerHTML = html.replace(
              /<(title|style|script|textarea)(\b[^>]*)\/>/gi,
              '<$1$2></$1>',
            ); // Inert template content never loads embedded URLs.
            const title = (
              document.content.querySelector('h1,h2,h3')?.textContent ||
              document.content.querySelector('title')?.textContent ||
              document.content.querySelector('p')?.textContent ||
              'Book section'
            )
              .trim()
              .slice(0, 100);
            const blocks: BookBlock[] = [];
            for (const element of document.content.querySelectorAll(
              'h1,h2,h3,h4,h5,h6,p,li,img,image',
            )) {
              if (['IMG', 'image'].includes(element.tagName)) {
                const src =
                  element.getAttribute('src') ||
                  element.getAttribute('href') ||
                  element.getAttribute('xlink:href');
                if (!src) continue;
                const address = new URL(
                  src,
                  'https://archive.invalid/' + normalized,
                );
                if (address.origin !== 'https://archive.invalid') continue;
                const path = decodeURIComponent(address.pathname.slice(1)),
                  imageBytes = files[path];
                const type = path
                  .toLowerCase()
                  .match(/\.(jpe?g|png|webp|gif)$/)?.[1];
                if (!imageBytes || !type) continue;
                let image = imageUrls.get(path);
                if (!image) {
                  const payload = new Uint8Array(imageBytes.byteLength);
                  payload.set(imageBytes);
                  image = URL.createObjectURL(
                    new Blob([payload], {
                      type: 'image/' + (type === 'jpg' ? 'jpeg' : type),
                    }),
                  );
                  imageUrls.set(path, image);
                }
                blocks.push({
                  image,
                  alt: element.getAttribute('alt') || title,
                });
              } else if (
                !element.parentElement?.closest('p,li,h1,h2,h3,h4,h5,h6')
              ) {
                const text = textFromHtml(element.outerHTML);
                if (text) blocks.push({ text });
              }
            }
            if (!blocks.length) {
              const text = textFromHtml(html);
              if (text) blocks.push({ text });
            }
            return { title, blocks };
          })
          .filter(
            (page): page is BookChapter => !!page && page.blocks.length > 0,
          );
        if (!pages.length)
          throw new Error('This book has no readable sections.');
        setChapters(pages);
      } else {
        const content = await response.text();
        if (controller.signal.aborted) return;
        setText(content);
        setTextLoaded(true);
      }
    }
    load().catch((e) => {
      if (!controller.signal.aborted) setError(e.message);
    });
    return () => {
      controller.abort();
      imageUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [url, image, pdf, extension, file?.kind]);
  const available = !!url;
  return (
    <Modal
      label={heading}
      onClose={onClose}
      className="document-modal"
      returnFocus={returnFocus}
      fallbackFocus={fallbackFocus}
      insideSelector=".document-reader"
    >
      <section
        className="document-reader"
        data-context={source.context}
        data-versions={hasVersions}
        data-information={showInformation}
      >
        <header className="document-header">
          <div>
            <span>
              {collection
                ? collection.title
                : source.representations?.length
                  ? 'From the family archive'
                  : source.context === 'source'
                    ? source.researchOnly
                      ? 'Research notes'
                      : 'Record'
                    : source.context === 'book-illustration'
                      ? 'From the family book'
                      : 'Family file'}
              {file && ` · ${documentKind(file)}`}
            </span>
            <h2>{heading}</h2>
            {file && !heading.includes(documentFileLocator(source, file)) && (
              <p className="document-heading-locator">
                {documentFileLocator(source, file)}
              </p>
            )}
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close document"
            data-dismiss-modal
          >
            <XIcon size={23} />
          </button>
        </header>
        <div className="document-toolbar">
          <div className="document-mobile-controls" aria-label="Document view">
            <button
              aria-pressed={!showInformation}
              onClick={() => setShowInformation(false)}
            >
              Document
            </button>
            <button
              ref={detailsTrigger}
              aria-pressed={showInformation}
              onClick={() => setShowInformation(true)}
            >
              Details & files
            </button>
          </div>
          {available && (
            <a className="document-download" href={url} download>
              <DownloadSimpleIcon size={18} /> Download this file
            </a>
          )}
        </div>
        <div className="document-body">
          <aside ref={information} className="document-information">
            {visualData && visualAsset && (
              <VisualContext
                data={visualData}
                asset={visualAsset}
                onPerson={(id) => onPerson?.(id)}
                onSource={(selected, path) => onSource?.(selected, path)}
              />
            )}
            {bookNote && (
              <details className="document-book-note" open>
                <summary>Note from the family book</summary>
                <p>{bookNote}</p>
              </details>
            )}
            <p className="document-kind">
              {file ? documentKind(file) : 'Record'}
            </p>
            {source.researchOnly && !collection && (
              <p className="document-provenance">
                Kept for research. The book does not rely on it.
              </p>
            )}
            {hasVersions && source.context === 'source' && (
              <div className="document-citation-context">
                <h3>
                  {source.researchOnly ? 'About this record' : 'This reference'}
                </h3>
                <p>{source.label}</p>
                {!source.researchOnly &&
                  file &&
                  !source.citationFilePaths?.includes(file.path) && (
                    <p>
                      This reference is for another file in this set. Its page
                      number is below.
                    </p>
                  )}
              </div>
            )}
            {!hasVersions && source.context === 'source' && (
              <details className="document-citation-context document-assessment">
                <summary>
                  {source.researchOnly ? 'About this record' : 'Full reference'}
                </summary>
                <p>{source.label}</p>
              </details>
            )}
            {source.locator && (
              <p className="document-locator">
                <small>Where to find it</small>
                {source.locator}
              </p>
            )}
            {locator && <p className="document-locator">{locator}</p>}
            {onCitationUse && (
              <CitationUses
                source={source}
                choices={citationChoices}
                people={citationPeople}
                scopeLabel={citationScopeLabel}
                onSelect={onCitationUse}
              />
            )}
            {file && (
              <details className="document-assessment">
                <summary>Original filename</summary>
                <p className="document-file-title">
                  {file.path.split('/').pop()}
                </p>
              </details>
            )}
            {file?.bookCaptions?.map((caption) => (
              <div className="document-book-use" key={caption}>
                <h3>In the family book</h3>
                <p>{caption}</p>
              </div>
            ))}
            {(parents.length > 0 || derivatives.length > 0) && (
              <div className="document-versions">
                {parents.length > 0 && (
                  <>
                    <h3>Made from these files</h3>
                    <div className="document-files">
                      {[...new Set(parents.map((r) => r.parent))].map(
                        (path) => (
                          <button
                            key={path}
                            data-file={path}
                            onClick={() => selectFile(path)}
                          >
                            {fileTitle(
                              source.archives.find((f) => f.path === path)!,
                            )}
                          </button>
                        ),
                      )}
                    </div>
                    {[
                      ...new Set(parents.map((r) => r.method).filter(Boolean)),
                    ].map((method) => (
                      <details className="document-assessment" key={method}>
                        <summary>How this version was made</summary>
                        <p>{method}</p>
                      </details>
                    ))}
                  </>
                )}
                {derivatives.length > 0 && (
                  <>
                    <h3>Other versions of this file</h3>
                    <div className="document-files">
                      {[...new Set(derivatives.map((r) => r.child))].map(
                        (path) => (
                          <button
                            key={path}
                            data-file={path}
                            onClick={() => selectFile(path)}
                          >
                            {fileTitle(
                              source.archives.find((f) => f.path === path)!,
                            )}
                          </button>
                        ),
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
            {relatedSources.length > 0 && (
              <details className="document-related document-assessment">
                <summary>
                  {source.representations?.length
                    ? 'Records for these versions'
                    : source.context === 'source'
                      ? 'Other records that use this file'
                      : 'Related records'}{' '}
                  ({relatedSources.length})
                </summary>
                <div className="document-files">
                  {relatedSources.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => onSource?.(s, file?.path)}
                    >
                      {s.label}
                      <small>
                        {s.researchOnly
                          ? 'Research notes'
                          : s.locator || 'No page number'}
                      </small>
                    </button>
                  ))}
                </div>
              </details>
            )}
            {source.archives.length > 1 && (
              <div className="document-files">
                <h3>
                  {source.representations?.length
                    ? 'Versions and files'
                    : 'Files'}
                </h3>
                {source.archives.map((f, i) => (
                  <button
                    key={f.path}
                    data-file={f.path}
                    className={index === i ? 'active' : ''}
                    onClick={() => selectFile(f.path)}
                  >
                    <span>{documentKind(f)}</span>
                    <small>{fileTitle(f)}</small>
                  </button>
                ))}
              </div>
            )}
            {source.url && (
              <a
                className="document-publisher"
                href={source.url}
                target="_blank"
                rel="noreferrer"
              >
                Source website
                <ArrowSquareOutIcon size={15} />
              </a>
            )}
            <p className="document-provenance">
              {provenanceNote(source, relatedSources.length)}
            </p>
          </aside>
          <div className="document-display">
            {available ? (
              image ? (
                <ImageDocument
                  key={url}
                  url={url}
                  title={fileTitle(file)}
                  onError={() => setError('The image could not be loaded.')}
                />
              ) : pdf ? (
                <PdfDocument
                  key={`${url}:${citedPdfPage ? source.selectedUse?.id : ''}:${citedPdfPage || ''}`}
                  url={url}
                  initialPage={citedPdfPage || file.page || 1}
                  citedPage={citedPdfPage}
                  title={source.label}
                />
              ) : isAudioFile(`.${extension || ''}`) ? (
                <AudioDocument
                  key={url}
                  url={url}
                  title={heading}
                  onError={() =>
                    setError(
                      'The recording could not load. Try opening it again, or download the original file.',
                    )
                  }
                />
              ) : chapters.length ? (
                <div className="epub-reader">
                  <label>
                    Book section
                    <select
                      value={chapter}
                      onChange={(e) => setChapter(Number(e.target.value))}
                    >
                      {chapters.map((c, i) => (
                        <option key={i} value={i}>
                          {i + 1}. {c.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <article key={chapter}>
                    {chapters[chapter].blocks.map((block, i) =>
                      block.image ? (
                        <figure key={i}>
                          <img src={block.image} alt={block.alt || ''} />
                        </figure>
                      ) : (
                        <p key={i}>{block.text}</p>
                      ),
                    )}
                  </article>
                </div>
              ) : !textFormats.includes(extension || '') ? (
                <p className="document-unavailable">
                  Download this {extension ? extension.toUpperCase() + ' ' : ''}
                  file to open it.
                </p>
              ) : textLoaded ? (
                <Suspense
                  fallback={<p className="document-text">Opening the file…</p>}
                >
                  <TextDocument
                    key={url}
                    content={text}
                    extension={extension || ''}
                    kind={file.kind || ''}
                    file={file.path}
                  />
                </Suspense>
              ) : (
                <p className="document-text">
                  {!error ? 'Opening the file…' : ''}
                </p>
              )
            ) : (
              <p className="document-unavailable">
                There’s no copy of this record on the site yet.
              </p>
            )}
            {error && (
              <p className="document-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      </section>
    </Modal>
  );
}
