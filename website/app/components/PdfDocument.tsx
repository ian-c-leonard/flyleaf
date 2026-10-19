import { useEffect, useRef, useState } from 'react';
import {
  CaretLeftIcon,
  CaretRightIcon,
  MinusIcon,
  PlusIcon,
} from '@phosphor-icons/react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useDismissible } from '../lib/useDismissible';
import { sitePath } from '../lib/paths';

export default function PdfDocument({
  url,
  initialPage = 1,
  title,
  pageNumber,
  onPageChange,
  showContents = false,
  citedPage,
}: {
  url: string;
  initialPage?: number;
  title: string;
  pageNumber?: number;
  onPageChange?: (page: number) => void;
  showContents?: boolean;
  citedPage?: number;
}) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null),
    [internalPage, setInternalPage] = useState(initialPage),
    [zoom, setZoom] = useState(1),
    [width, setWidth] = useState(600),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [renderedPage, setRenderedPage] = useState(0),
    [text, setText] = useState(''),
    [textUnavailable, setTextUnavailable] = useState(false);
  const [contents, setContents] = useState<
    { title: string; page: number; level: number }[]
  >([]);
  const [contentsOpen, setContentsOpen] = useState(false);
  const contentsPanel = useRef<HTMLDetailsElement>(null);
  const contentsTrigger = useRef<HTMLElement>(null);
  useDismissible({
    enabled: showContents && contentsOpen,
    root: () => contentsPanel.current,
    inside: () => [contentsPanel.current],
    trigger: () => contentsTrigger.current,
    onDismiss: () => {
      if (contentsPanel.current) contentsPanel.current.open = false;
      setContentsOpen(false);
    },
  });
  const requested = pageNumber ?? internalPage;
  const hasCitedPage =
    !!document &&
    Number.isSafeInteger(citedPage) &&
    citedPage! >= 1 &&
    citedPage! <= document.numPages;
  const page = Math.max(
    1,
    Math.min(document?.numPages || requested, requested),
  );
  const changePage = (next: number) => {
    const value = Math.max(1, Math.min(document?.numPages || 1, next));
    setInternalPage(value);
    onPageChange?.(value);
    if (value !== page) {
      container.current
        ?.querySelector('.pdf-pages')
        ?.scrollTo({ top: 0, left: 0 });
      if (showContents)
        container.current?.scrollIntoView({
          block: 'start',
          behavior: 'instant',
        });
    }
  };
  const canvas = useRef<HTMLCanvasElement>(null),
    container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = container.current!;
    const resize = new ResizeObserver(() => setWidth(element.clientWidth));
    resize.observe(element);
    return () => resize.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    let task:
      | ReturnType<
          (typeof import('pdfjs-dist/legacy/build/pdf.mjs'))['getDocument']
        >
      | undefined;
    import('pdfjs-dist/legacy/build/pdf.mjs')
      .then((pdf) => {
        if (cancelled) return;
        pdf.GlobalWorkerOptions.workerSrc = sitePath(
          'pdfjs/pdf.legacy.worker.min.mjs',
        );
        task = pdf.getDocument({
          url,
          disableAutoFetch: true,
          disableStream: true,
          rangeChunkSize: 65536,
          wasmUrl: sitePath('pdfjs/wasm/'),
          standardFontDataUrl: sitePath('pdfjs/standard_fonts/'),
        });
        return task.promise.then(async (document) => {
          if (!cancelled) {
            setDocument(document);
            if (showContents) {
              const entries: { title: string; page: number; level: number }[] =
                [];
              async function walk(
                items: NonNullable<
                  Awaited<ReturnType<PDFDocumentProxy['getOutline']>>
                >,
                level: number,
              ) {
                for (const item of items) {
                  const dest =
                    typeof item.dest === 'string'
                      ? await document.getDestination(item.dest)
                      : item.dest;
                  if (Array.isArray(dest) && dest.length) {
                    const index =
                      typeof dest[0] === 'number'
                        ? dest[0]
                        : await document.getPageIndex(dest[0]);
                    if (
                      Number.isInteger(index) &&
                      index >= 0 &&
                      index < document.numPages
                    )
                      entries.push({
                        title: item.title,
                        page: index + 1,
                        level,
                      });
                  }
                  await walk(item.items, level + 1);
                }
              }
              try {
                await walk((await document.getOutline()) || [], 1);
                if (!cancelled) setContents(entries);
              } catch {
                /* The PDF remains readable if it has no usable outline. */
              }
            }
          }
        });
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [url, showContents]);
  useEffect(() => {
    if (!document || !canvas.current) return;
    let cancelled = false,
      render:
        | ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']>
        | undefined;
    const element = canvas.current;
    async function draw() {
      setLoading(true);
      setRenderedPage(0);
      setError('');
      setText('');
      setTextUnavailable(false);
      const pdfPage = await document!.getPage(page);
      if (cancelled) return;
      const natural = pdfPage.getViewport({ scale: 1 }),
        scale = Math.max(0.2, (width - 36) / natural.width) * zoom;
      const viewport = pdfPage.getViewport({ scale }),
        ratio = Math.min(devicePixelRatio, 2);
      element.width = Math.ceil(viewport.width * ratio);
      element.height = Math.ceil(viewport.height * ratio);
      element.style.width = `${viewport.width}px`;
      element.style.height = `${viewport.height}px`;
      const context = element.getContext('2d');
      if (!context)
        throw new Error('This browser cannot display document pages.');
      render = pdfPage.render({
        canvas: element,
        canvasContext: context,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      await render.promise;
      if (!cancelled) {
        setLoading(false);
        setRenderedPage(page);
        // Text extraction is optional and can fail after a successful render.
        // Keep that failure out of the page-render error handler below.
        try {
          const content = await pdfPage.getTextContent();
          if (cancelled) return;
          setText(
            content.items
              .map((item) => ('str' in item ? item.str : ''))
              .join(' '),
          );
        } catch (textError) {
          if (!cancelled) {
            setTextUnavailable(true);
            console.warn(
              'PDF page rendered; optional text extraction failed.',
              textError,
            );
          }
        }
      }
    }
    draw().catch((e) => {
      if (!cancelled && e.name !== 'RenderingCancelledException') {
        setError(e.message);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [document, page, zoom, width]);
  return (
    <div className="pdf-reader" ref={container}>
      {showContents && contents.length > 0 && (
        <details
          className="pdf-contents"
          ref={contentsPanel}
          open={contentsOpen}
          onToggle={(event) => setContentsOpen(event.currentTarget.open)}
        >
          <summary
            ref={contentsTrigger}
            onClick={(event) => {
              // Native toggle is deferred; register the transient in the same
              // activation so an immediately following Escape can dismiss it.
              event.preventDefault();
              setContentsOpen((open) => !open);
            }}
          >
            Contents · Choose a chapter or section
          </summary>
          <ol>
            {contents.map((entry, index) => (
              <li
                key={index}
                className={entry.level > 1 ? 'pdf-contents-section' : ''}
              >
                <button
                  onClick={(event) => {
                    setContentsOpen(false);
                    contentsTrigger.current?.focus({ preventScroll: true });
                    changePage(entry.page);
                    event.currentTarget
                      .closest('details')
                      ?.removeAttribute('open');
                  }}
                >
                  <span>{entry.title}</span>
                  <span>{entry.page}</span>
                </button>
              </li>
            ))}
          </ol>
        </details>
      )}
      <div className={`pdf-toolbar${hasCitedPage ? ' pdf-toolbar-cited' : ''}`}>
        <button
          disabled={!document || page <= 1}
          onClick={() => changePage(page - 1)}
          aria-label="Previous document page"
        >
          <CaretLeftIcon size={20} />
        </button>
        <label>
          Page
          <input
            aria-label="Document page number"
            key={page}
            type="number"
            min="1"
            max={document?.numPages || 1}
            defaultValue={page}
            onBlur={(e) =>
              changePage(
                Math.max(
                  1,
                  Math.min(
                    document?.numPages || 1,
                    Number(e.target.value) || 1,
                  ),
                ),
              )
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </label>
        <span>of {document?.numPages || '…'}</span>
        <button
          disabled={!document || page >= document.numPages}
          onClick={() => changePage(page + 1)}
          aria-label="Next document page"
        >
          <CaretRightIcon size={20} />
        </button>
        <div className="pdf-zoom">
          <button
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
            aria-label="Zoom PDF out"
          >
            <MinusIcon size={18} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
            aria-label="Zoom PDF in"
          >
            <PlusIcon size={18} />
          </button>
        </div>
        {hasCitedPage && (
          <button
            className="pdf-cited-page"
            disabled={page === citedPage}
            onClick={() => changePage(citedPage!)}
          >
            Go to cited PDF page {citedPage}
          </button>
        )}
      </div>
      <div className="pdf-pages">
        {loading && (
          <output className="pdf-loading">Loading page {page}…</output>
        )}
        {error && (
          <p className="document-error" role="alert">
            The page could not be displayed.{' '}
            <a href={url} target="_blank" rel="noreferrer">
              Open the original PDF
            </a>
            .
          </p>
        )}
        <canvas
          ref={canvas}
          aria-label={`${title}, page ${page}`}
          data-rendered-page={renderedPage || undefined}
        />
        {(text || textUnavailable) && (
          <details className="pdf-text">
            <summary>Page text</summary>
            <p>
              {text ||
                'Text is unavailable for this page. You can still read the PDF page above.'}
            </p>
          </details>
        )}
      </div>
    </div>
  );
}
