import { groupAdjacentBookNotes } from '../lib/book-source-groups';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookOpenTextIcon,
  DownloadSimpleIcon,
  ListBulletsIcon,
  MapPinIcon,
  XIcon,
} from '@phosphor-icons/react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { AtlasData } from '../lib/gedcom';
import type { ArchiveDocument } from '../lib/archive';
import type { BookPublication } from '../lib/publication';
import {
  citationDocuments,
  publicBookAnchor,
  fetchWebBookBody,
  type WebBook,
  type WebBookBody,
} from '../lib/native-book';
import Modal from './Modal';
import { useDismissible, useMediaQuery } from '../lib/useDismissible';
import {
  previewNoteHTML,
  type BookMention,
  type BookPassage,
  type BookFocusTarget,
} from '../lib/book-annotations';
import { useBookPreviews } from '../lib/useBookPreviews';
import type { Geography } from '../lib/places';
import { BookEntityPreview, BookPreviewFrame } from './BookPreview';
import SourceCitationPresentation from './SourceCitationPresentation';
import { presentationsForNote } from '../lib/citation-presentation';
import { albumsInEdition } from '../lib/albums';
import BookReadingMap from './BookReadingMap';
import BookChapterOpenings from './BookChapterOpenings';
import { BookMapHistory } from '../lib/book-map-history';
import { dismissalManager } from '../lib/dismissal';
import { site } from '../lib/settings';
import { sitePath } from '../lib/paths';

export default function NativeBook({
  web,
  book,
  anchor,
  navigation,
  savedScroll,
  returnFocus,
  data,
  onRead,
  onDocument,
  onAlbum,
  noteReference,
  showRequestedNote = false,
  onNoteText,
  onDismissNote,
  methodology = false,
  researchChapter = '',
  geography,
  imageUrl,
  onPerson,
  onTree,
  onPlace,
  onRefreshEdition,
  refreshError,
  relationLabel,
  onCorrection,
}: {
  web: WebBook;
  book: BookPublication;
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
  noteReference: string;
  showRequestedNote?: boolean;
  onNoteText: (text: string) => void;
  onDismissNote: (reference: string) => void;
  methodology?: boolean;
  /** The chapter shown on the "About the research" tab, kept out of the
   * reading order; empty when the book has none. */
  researchChapter?: string;
  geography: Geography | null;
  imageUrl: (path: string) => string;
  onPerson: (id: string, trigger: HTMLElement) => void;
  onTree?: (id: string, trigger: HTMLElement) => void;
  onPlace: (id: string, trigger: HTMLElement) => void;
  onRefreshEdition: () => void;
  refreshError: string;
  relationLabel?: (personId: string) => string;
  onCorrection?: (personId: string) => void;
}) {
  const [body, setBody] = useState<WebBookBody | null>(null);
  // Keep this object stable while reading. Reassigning innerHTML on a scroll
  // state update detaches the headings, notes and keyboard-focus targets.
  const markup = useMemo(() => ({ __html: body?.html || '' }), [body]);
  const [error, setError] = useState('');
  const displayError = error || refreshError;
  const [retry, setRetry] = useState(0);
  const automaticRefresh = useRef(false);
  const [contentsOpen, setContentsOpen] = useState(false);
  // Only whether albums can open matters to the book's decorations. The
  // callback itself is new each time the page around the book renders.
  const hasAlbum = !!onAlbum;
  const [active, setActive] = useState(anchor);
  const [note, setNote] = useState<HTMLElement | null>(null);
  const noteMarkup = useMemo(
    () => ({ __html: note ? previewNoteHTML(note) : '' }),
    [note],
  );
  const [chart, setChart] = useState('');
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (body && content.current) return groupAdjacentBookNotes(content.current);
  }, [body]);
  const reader = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const noteOrigin = useRef<HTMLElement | null>(null);
  const openedNoteRequest = useRef('');
  const requestedNote = useRef<HTMLElement | null>(null);
  const chartOrigin = useRef<HTMLElement | null>(null);
  const contentsPanel = useRef<HTMLElement>(null);
  const contentsTrigger = useRef<HTMLButtonElement>(null);
  const mapTrigger = useRef<HTMLButtonElement>(null);
  const pointerInput = useRef<{ target: Element | null; type: string } | null>(
    null,
  );
  const wideMap = useMediaQuery('(min-width: 1200px)');
  const currentWideMap = useRef(wideMap);
  useLayoutEffect(() => {
    currentWideMap.current = wideMap;
  }, [wideMap]);
  const [mapPreference, setMapPreference] = useState<boolean | null>(null);
  // The reading map waits until asked for, so text comes first on every screen.
  const mapOpen = mapPreference ?? false;
  const mapHistory = useRef<BookMapHistory | null>(null);
  useLayoutEffect(() => {
    const boundary = new BookMapHistory(
      {
        history: window.history,
        url: () => window.location.href,
        modal: () => !currentWideMap.current,
        snapshot: () =>
          window.history.replaceState(
            { ...window.history.state, scroll: window.scrollY },
            '',
            window.location.href,
          ),
        listen: (callback) => {
          window.addEventListener('popstate', callback);
          return () => window.removeEventListener('popstate', callback);
        },
        defer: (callback) => requestAnimationFrame(callback),
      },
      () => {
        dismissalManager(document).dismissRoot(
          reader.current?.querySelector('.book-reading-map-modal') || null,
        );
        setMapPreference(false);
      },
      () => setMapPreference(true),
    );
    mapHistory.current = boundary;
    return () => {
      boundary.dispose();
      mapHistory.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    if (mapOpen && !wideMap) mapHistory.current?.open();
    else mapHistory.current?.close();
  }, [mapOpen, wideMap]);
  function closeMap(after?: () => void) {
    setMapPreference(false);
    if (mapHistory.current) mapHistory.current.close(after);
    else if (after) requestAnimationFrame(after);
  }
  const [mapPassage, setMapPassage] = useState<BookPassage | null>(null);
  const readingPosition = useRef<{
    passage: string;
    offset: number;
    anchor: string;
    navigation: number;
  } | null>(null);
  const [mapRequest, setMapRequest] = useState<{
    mention: BookMention;
    passage: BookPassage;
  } | null>(null);
  const previewController = useBookPreviews(
    content,
    body?.annotations,
    `${web.sha256}:${anchor}:${methodology}:${!!body}`,
  );
  const preview = previewController.preview;
  const restorePreviewFocus = previewController.restoreFocus;
  const closePreview = previewController.close;
  useEffect(() => {
    if (!body || !returnFocus || returnFocus.version !== web.sha256) return;
    const frame = requestAnimationFrame(() => {
      const target = reader.current?.querySelector<HTMLElement>(
        returnFocus.kind === 'mention'
          ? `[data-book-mention="${returnFocus.value}"]`
          : `[id="${returnFocus.value}"]`,
      );
      if (target?.getClientRects().length) {
        rememberTrigger(target);
        restorePreviewFocus(target);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [body, returnFocus, web.sha256, restorePreviewFocus]);
  const previewMarkup = useMemo(
    () => ({
      __html: preview?.kind === 'source' ? previewNoteHTML(preview.note) : '',
    }),
    [preview],
  );
  const smallContents = useMediaQuery('(max-width: 1000px)');
  useDismissible({
    enabled: contentsOpen && smallContents,
    root: () => contentsPanel.current,
    inside: () => [contentsPanel.current],
    trigger: () => contentsTrigger.current,
    fallback: () => toolbar.current,
    onDismiss: () => setContentsOpen(false),
  });
  const currentAnchor = useRef({
    anchor,
    savedScroll,
    navigation,
    edition: web.sha256,
  });
  const pendingHeadingAlignment = useRef<(() => void) | null>(null);
  const completedHeadingIntent = useRef('');
  const sections = useMemo(
    () =>
      web.sections.filter(
        (section) =>
          (!!researchChapter && section.chapter === researchChapter) ===
          methodology,
      ),
    [web, methodology, researchChapter],
  );
  currentAnchor.current = {
    anchor,
    savedScroll,
    navigation,
    edition: web.sha256,
  };
  const cancelHeadingAlignment = useCallback(() => {
    const request = currentAnchor.current;
    completedHeadingIntent.current = `${request.edition}:${request.navigation}:${request.anchor}`;
    pendingHeadingAlignment.current?.();
  }, []);
  // A saved reading position is restored once for each visit. The book's
  // effects can run again while the reader reads on, and must not pull them
  // back to where they returned.
  const restoredScroll = useRef('');
  const restoreSavedScroll = useCallback(() => {
    const location = currentAnchor.current;
    const key = `${location.edition}:${location.navigation}:${location.anchor}:${location.savedScroll}`;
    if (location.savedScroll <= 0 || restoredScroll.current === key) return;
    restoredScroll.current = key;
    cancelHeadingAlignment();
    window.scrollTo({ top: location.savedScroll, behavior: 'instant' });
  }, [cancelHeadingAlignment]);
  const scrollToTarget = useCallback((target: HTMLElement, heading = false) => {
    const scope = content.current;
    if (!scope?.contains(target) || !reader.current) return;
    // Direct chart bookmarks must reveal the preserved printable chart before
    // its position is measured inside the web chapter introduction.
    for (
      let parent = target.parentElement;
      parent && parent !== scope;
      parent = parent.parentElement
    ) {
      if (
        parent instanceof HTMLDetailsElement &&
        parent.classList.contains('book-print-charts')
      ) {
        parent.open = true;
      }
    }
    // Some generated register labels sit on a sentence's final punctuation.
    // Align the enclosing entry so its name and opening text remain visible.
    const block = target.closest<HTMLElement>(
      'p, h1, h2, h3, h4, h5, h6, li, figure, div, table',
    );
    const entry =
      block && block !== scope && scope.contains(block) ? block : target;
    const header =
      Number.parseFloat(
        getComputedStyle(reader.current).getPropertyValue(
          '--site-header-height',
        ),
      ) || 0;
    const offset =
      header + (toolbar.current?.getBoundingClientRect().height || 0) + 24;
    const top = window.scrollY + entry.getBoundingClientRect().top - offset;
    window.scrollTo({
      // Only a heading request rounds down to guarantee its full 24px clearance.
      // Immediate note alignment keeps its original fractional scroll position.
      top: Math.max(0, heading ? Math.floor(top) : top),
      behavior: 'instant',
    });
  }, []);
  const alignTarget = useCallback(
    (target: HTMLElement, heading = false) => {
      // A precise note/return alignment supersedes any deferred heading request.
      cancelHeadingAlignment();
      scrollToTarget(target, heading);
    },
    [cancelHeadingAlignment, scrollToTarget],
  );
  const queueHeadingAlignment = useCallback(
    (target: HTMLElement) => {
      const request = currentAnchor.current;
      const intent = `${request.edition}:${request.navigation}:${request.anchor}`;
      pendingHeadingAlignment.current?.();
      if (completedHeadingIntent.current === intent) return () => {};
      let cancelled = false;
      let listening = false;
      let frame = 0;
      const wanted = () => {
        const current = currentAnchor.current;
        return (
          intent ===
            `${current.edition}:${current.navigation}:${current.anchor}` &&
          current.savedScroll <= 0 &&
          !!content.current?.contains(target) &&
          target.isConnected
        );
      };
      const cancel = () => {
        cancelled = true;
        cancelAnimationFrame(frame);
        if (listening) {
          window.removeEventListener('wheel', interrupt);
          window.removeEventListener('touchmove', interrupt);
          window.removeEventListener('pointerdown', interrupt);
          window.removeEventListener('resize', realign);
          window.removeEventListener('keydown', onKey);
        }
        if (pendingHeadingAlignment.current === cancel)
          pendingHeadingAlignment.current = null;
      };
      const interrupt = () => {
        completedHeadingIntent.current = intent;
        cancel();
      };
      // A phone's address bar resizes the window as the page moves. That is
      // not the reader scrolling away, so keep the heading in place.
      const realign = () => {
        if (!cancelled && wanted()) scrollToTarget(target, true);
      };
      const onKey = (event: KeyboardEvent) => {
        if (
          [
            'ArrowUp',
            'ArrowDown',
            'PageUp',
            'PageDown',
            'Home',
            'End',
            ' ',
            'Tab',
            'Escape',
          ].includes(event.key)
        )
          interrupt();
      };
      const finish = () => {
        if (cancelled) return;
        const ok = wanted();
        completedHeadingIntent.current = intent;
        cancel();
        if (ok) scrollToTarget(target, true);
      };
      pendingHeadingAlignment.current = cancel;
      frame = requestAnimationFrame(() => {
        if (cancelled) return;
        if (!wanted()) {
          cancel();
          return;
        }
        // The reader asked for this place, so go there at once. A scroll while
        // the chapter was loading must not leave them at the top of the book.
        // Measuring also requests the book's own fonts, so fonts.ready below
        // waits for them rather than the preceding view's.
        scrollToTarget(target, true);
        if (document.fonts.status === 'loaded') {
          finish();
          return;
        }
        // The book's fonts can still move the heading. Align once more when
        // they load, unless the reader has started to scroll or type by then.
        listening = true;
        window.addEventListener('wheel', interrupt, { passive: true });
        window.addEventListener('touchmove', interrupt, { passive: true });
        window.addEventListener('pointerdown', interrupt, { passive: true });
        window.addEventListener('resize', realign, { passive: true });
        window.addEventListener('keydown', onKey);
        void document.fonts.ready.then(() => {
          if (!cancelled) frame = requestAnimationFrame(finish);
        });
      });
      return cancel;
    },
    [scrollToTarget],
  );
  // Keep anchors and the contents column below both persistent headers, even
  // when the reader's font size changes the toolbar height.
  useLayoutEffect(() => {
    const element = toolbar.current;
    if (!element) return;
    const measure = () => {
      reader.current?.style.setProperty(
        '--book-toolbar-height',
        `${element.getBoundingClientRect().height}px`,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setBody(null);
    fetchWebBookBody(web, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        if (value) setBody(value);
        else if (!automaticRefresh.current) {
          automaticRefresh.current = true;
          onRefreshEdition();
        } else {
          setError(
            'The current edition could not be loaded. Please try again.',
          );
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [web, retry, onRefreshEdition]);
  const sources = useMemo(
    () =>
      new Map(
        (body?.citations || []).map((c) => [
          c.person + '\0' + c.key,
          citationDocuments(
            data,
            c,
            body?.citationPresentation?.find(
              (entry) => entry.person === c.person && entry.key === c.key,
            )?.preferredFile,
          ),
        ]),
      ),
    [body, data],
  );
  useLayoutEffect(() => {
    if (!body || !content.current) return;
    // Keep one complete manuscript DOM. Hidden endnotes are still available
    // to the citation reader, including future notes in the methods section.
    // Only visibility changes; no text, figures, IDs or source uses are copied.
    let inMethods = false;
    for (const element of content.current.children) {
      if (!(element instanceof HTMLElement)) continue;
      if (element.tagName === 'H2')
        inMethods = !!researchChapter && element.id === researchChapter;
      element.hidden = inMethods !== methodology;
    }
  }, [body, methodology, researchChapter]);
  useEffect(() => {
    if (!body || !content.current) return;
    const scope = content.current;
    // The full printed note stays intact. These controls open its available
    // document context; absence is displayed honestly without a fabricated link.
    for (const marker of scope.querySelectorAll<HTMLElement>(
      '[data-book-person]',
    )) {
      const docs =
        sources.get(
          marker.dataset.bookPerson + '\0' + marker.dataset.bookKey,
        ) || [];
      const printedNote = marker.closest<HTMLElement>('[data-book-note]');
      if (!printedNote) continue;
      if (docs.length) {
        for (const doc of docs) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'book-source-link';
          button.dataset.bookDocument = doc.id;
          button.dataset.bookPerson = marker.dataset.bookPerson;
          button.dataset.bookKey = marker.dataset.bookKey;
          button.dataset.bookFile = doc.archives[0]?.path || '';
          button.dataset.bookNote = printedNote.id;
          button.textContent =
            doc.bookMatch === 'citation' ? 'See the record' : 'See the file';
          marker.appendChild(button);
        }
        if (hasAlbum) {
          const citation = body.citations.find(
            (c) =>
              c.person === marker.dataset.bookPerson &&
              c.key === marker.dataset.bookKey,
          );
          const album =
            citation &&
            albumsInEdition(data).find(
              (a) =>
                a.source === citation.sourcePointer &&
                a.person === citation.person,
            );
          if (
            album &&
            !printedNote.querySelector(`[data-book-album="${album.id}"]`)
          ) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'book-source-link';
            button.dataset.bookAlbum = album.id;
            button.textContent = 'Listen to the album';
            marker.appendChild(button);
          }
        }
      } else {
        const unavailable = document.createElement('span');
        unavailable.className = 'book-source-unavailable';
        unavailable.textContent = 'No copy of this record is on the site.';
        marker.appendChild(unavailable);
      }
    }
    const location = currentAnchor.current;
    const target = location.anchor
      ? document.getElementById(location.anchor)
      : null;
    let cancelQueued = () => {};
    const frame = requestAnimationFrame(() => {
      if (location.savedScroll > 0) restoreSavedScroll();
      else if (target) cancelQueued = queueHeadingAlignment(target);
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelQueued();
      scope
        .querySelectorAll('.book-source-link, .book-source-unavailable')
        .forEach((n) => n.remove());
    };
  }, [
    body,
    sources,
    queueHeadingAlignment,
    restoreSavedScroll,
    data,
    hasAlbum,
  ]);
  useEffect(() => {
    if (!body || !noteReference) {
      onNoteText('');
      return;
    }
    const [version, id] = noteReference.split(':');
    const target = version === web.sha256 ? document.getElementById(id) : null;
    if (
      !target ||
      !content.current?.contains(target) ||
      !target.hasAttribute('data-book-note')
    ) {
      onNoteText(
        'This note is from an older edition. Open the book to read the current notes.',
      );
      return;
    }
    const copy = target.cloneNode(true) as HTMLElement;
    copy
      .querySelectorAll(
        'button, .book-source-unavailable, [role="doc-backlink"]',
      )
      .forEach((n) => n.remove());
    onNoteText(copy.textContent?.trim() || '');
  }, [body, noteReference, web.sha256, onNoteText, sources]);
  useEffect(() => {
    // Back or forward within the book returns to the position saved there.
    if (!body || savedScroll <= 0) return;
    const frame = requestAnimationFrame(restoreSavedScroll);
    return () => cancelAnimationFrame(frame);
  }, [body, savedScroll, anchor, navigation, restoreSavedScroll]);
  useEffect(() => {
    if (!body || !anchor || savedScroll > 0) return;
    const target = document.getElementById(anchor);
    const cancelQueued = target ? queueHeadingAlignment(target) : () => {};
    setActive(anchor);
    setContentsOpen(false);
    return cancelQueued;
    // Distinct bookmarks can resolve to the same heading. Each deliberate
    // navigation must align it again even when the resolved anchor is unchanged.
  }, [
    anchor,
    navigation,
    body,
    savedScroll,
    methodology,
    queueHeadingAlignment,
  ]);
  useEffect(() => {
    // A deliberate note bookmark opens the actual current-edition note once.
    // Document context still resolves its text separately, without opening a
    // second dialog behind the saved source.
    const clearRequestedNote = () => {
      if (!requestedNote.current) return;
      requestedNote.current = null;
      setNote(null);
    };
    if (!body || !showRequestedNote || !noteReference) {
      // Source/person overlays temporarily suppress the bookmarked dialog.
      // Returning from them must be able to open the same request again.
      openedNoteRequest.current = '';
      clearRequestedNote();
      return;
    }
    const request = `${navigation}:${noteReference}`;
    if (openedNoteRequest.current === request) return;
    const parts = noteReference.split(':');
    if (parts.length !== 2 || parts[0] !== web.sha256) {
      clearRequestedNote();
      return;
    }
    const target = document.getElementById(parts[1]);
    if (
      !target ||
      !content.current?.contains(target) ||
      !target.hasAttribute('data-book-note')
    ) {
      clearRequestedNote();
      return;
    }
    const backlink = target
      .querySelector('[role="doc-backlink"]')
      ?.getAttribute('href');
    const origin = backlink?.startsWith('#')
      ? document.getElementById(backlink.slice(1))
      : null;
    const frame = requestAnimationFrame(() => {
      openedNoteRequest.current = request;
      requestedNote.current = target;
      closePreview();
      if (
        origin &&
        content.current?.contains(origin) &&
        origin.getClientRects().length
      ) {
        noteOrigin.current = origin;
        alignTarget(origin);
      } else noteOrigin.current = toolbar.current;
      setNote(target);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    body,
    showRequestedNote,
    noteReference,
    navigation,
    web.sha256,
    alignTarget,
    closePreview,
  ]);
  useEffect(() => {
    if (!body) return;
    const headings = sections
      .map((s) => document.getElementById(s.anchor))
      .filter((n): n is HTMLElement => !!n);
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const controls = toolbar.current;
        const bounds = controls?.getBoundingClientRect();
        // WebKit can shift sticky controls a few pixels above the layout
        // viewport. Keep the same declared inset used by alignTarget, so a
        // newly opened chapter does not retain the preceding section's title.
        const stickyBottom = controls
          ? (Number.parseFloat(getComputedStyle(controls).top) || 0) +
            (bounds?.height || 0)
          : 0;
        const readingTop = Math.max(bounds?.bottom || 0, stickyBottom) + 24;
        const above = headings.filter(
          (n) => n.getBoundingClientRect().top <= readingTop + 2,
        );
        setActive(above.at(-1)?.id || (methodology ? researchChapter : ''));
      });
    };
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      cancelAnimationFrame(frame);
    };
  }, [body, sections, methodology, researchChapter]);
  useEffect(() => {
    if (!body?.annotations || !content.current) return;
    const byId = new Map(body.annotations.passages.map((p) => [p.id, p]));
    const mentions = new Map(body.annotations.mentions.map((m) => [m.id, m]));
    // Passage metadata groups register entries by chapter. Use the actual
    // public headings as the narrower reading boundary, so a new entry cannot
    // inherit a previous person's place while its own first row is visible.
    let context = '';
    const boundaries: HTMLElement[] = [];
    const rows = [
      ...content.current.querySelectorAll<HTMLElement>(
        '[data-book-passage], h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]',
      ),
    ]
      .filter((element) => element.getClientRects().length)
      .flatMap((element) => {
        if (/^H[1-6]$/.test(element.tagName) && publicBookAnchor(element.id)) {
          context = element.id;
          boundaries.push(element);
        }
        const passage = byId.get(element.dataset.bookPassage || '');
        return passage ? [{ element, passage, context }] : [];
      });
    let frame = 0;
    let pendingRestore = false;
    const update = (restorePosition = false) => {
      pendingRestore ||= restorePosition;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const shouldRestore = pendingRestore;
        pendingRestore = false;
        const top = (toolbar.current?.getBoundingClientRect().bottom || 0) + 48;
        const held = readingPosition.current;
        if (
          shouldRestore &&
          held?.anchor === anchor &&
          held.navigation === navigation
        ) {
          const target = rows.find(
            (row) => row.passage.id === held.passage,
          )?.element;
          if (target) {
            window.scrollBy({
              top: target.getBoundingClientRect().top - top - held.offset,
              behavior: 'instant',
            });
          }
        }
        // Document order is authoritative; catalogue parts are stored by lane.
        // Binary search avoids measuring every paragraph on each scroll frame.
        let lo = 0,
          hi = rows.length;
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (rows[mid].element.getBoundingClientRect().top <= top)
            lo = mid + 1;
          else hi = mid;
        }
        const index = Math.max(0, lo - 1);
        const current = rows[index];
        if (current)
          readingPosition.current = {
            passage: current.passage.id,
            offset: current.element.getBoundingClientRect().top - top,
            anchor,
            navigation,
          };
        // Some public headings have no annotated passage of their own. They
        // still end the previous context, including an entirely unmapped one.
        const context =
          boundaries.findLast(
            (element) => element.getBoundingClientRect().top <= top,
          )?.id || '';
        let selected: BookPassage | null = null;
        // A book without annotated passages has no rows at all.
        for (let i = index; i >= 0 && rows[i]?.context === context; i--) {
          if (
            rows[i].passage.mentions.some((id) => mentions.get(id)?.location)
          ) {
            selected = rows[i].passage;
            break;
          }
        }
        // A newly opened section may show its first place-bearing paragraph
        // below the toolbar. Include that visible passage rather than waiting
        // for the reader to scroll it past the top of the screen.
        if (!selected) {
          for (
            let i = index + (rows[index]?.context === context ? 0 : 1);
            i < rows.length && rows[i].context === context;
            i++
          ) {
            const bounds = rows[i].element.getBoundingClientRect();
            if (bounds.top >= window.innerHeight - 24) break;
            if (
              bounds.bottom > top &&
              rows[i].passage.mentions.some((id) => mentions.get(id)?.location)
            ) {
              selected = rows[i].passage;
              break;
            }
          }
        }
        setMapPassage(selected);
      });
    };
    const onScroll = () => update();
    // Keep the reader's place only when the text reflows (a width change).
    // iPhone Safari changes the height continuously as its toolbars slide
    // during a swipe; restoring then undid the finger's movement each frame.
    let width = window.innerWidth;
    const onResize = () => {
      const reflow = window.innerWidth !== width;
      width = window.innerWidth;
      update(reflow);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    const observer = new ResizeObserver(() => update());
    observer.observe(content.current);
    update(true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, [body, methodology, anchor, navigation, mapOpen]);
  function rememberTrigger(trigger: HTMLElement) {
    content.current
      ?.querySelectorAll('[data-reader-return-focus]')
      .forEach((element) =>
        element.removeAttribute('data-reader-return-focus'),
      );
    trigger.dataset.readerReturnFocus = '';
  }
  function read(id: string) {
    previewController.close();
    setContentsOpen(false);
    setNote(null);
    if (mapOpen && !wideMap) closeMap(() => onRead(id));
    else onRead(id);
  }
  // Delegate ordinary anchor/button clicks, including their native keyboard
  // activation. The prose wrapper itself is not an interactive control.
  useEffect(() => {
    const element = reader.current;
    element?.addEventListener('click', follow);
    return () => element?.removeEventListener('click', follow);
  });
  function follow(event: MouseEvent) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const clicked = (event.target as Element).closest<HTMLElement>(
      'a, [data-book-document], [data-book-album]',
    );
    if (!clicked) return;
    const input = pointerInput.current;
    pointerInput.current = null;
    if (clicked.dataset.bookMention) {
      const touch =
        (event instanceof PointerEvent && event.pointerType === 'touch') ||
        (input?.target === clicked && input.type === 'touch');
      if (clicked.dataset.bookAddedLink === 'true' || touch) {
        event.preventDefault();
        rememberTrigger(clicked);
        previewController.activate(clicked);
        return;
      }
      previewController.close();
    }
    const returnTarget = content.current?.contains(clicked)
      ? clicked
      : preview?.trigger || noteOrigin.current;
    if (returnTarget) {
      rememberTrigger(returnTarget);
    }
    if (clicked.dataset.bookAlbum && onAlbum) {
      event.preventDefault();
      previewController.close();
      setNote(null);
      onAlbum(clicked.dataset.bookAlbum);
      return;
    }
    if (clicked.dataset.bookDocument) {
      event.preventDefault();
      const doc = (
        sources.get(
          clicked.dataset.bookPerson + '\0' + clicked.dataset.bookKey,
        ) || []
      ).find((d) => d.id === clicked.dataset.bookDocument);
      if (doc) {
        previewController.close();
        setNote(null);
        onDocument(
          doc,
          clicked.dataset.bookFile,
          web.sha256 + ':' + clicked.dataset.bookNote,
        );
      }
      return;
    }
    const path = clicked.dataset.bookImage;
    if (path) {
      event.preventDefault();
      if (body?.assets.some((a) => a.path === path && a.kind === 'chart')) {
        chartOrigin.current = clicked;
        setChart(path);
      } else {
        const asset = data.assets.find((a) => a.path === path);
        if (asset) {
          // The caller resolves this exact illustration attachment, including
          // its original/derivative connections, in the existing private viewer.
          onDocument(
            {
              id: asset.id,
              context: 'book-illustration',
              label: asset.title,
              url: '',
              locator: '',
              note: asset.credit,
              sourceIds: asset.sourceIds || [],
              archives: [
                {
                  path,
                  title: asset.title,
                  kind: asset.kind || '',
                  nature: '',
                  locator: '',
                  status: '',
                },
              ],
            },
            path,
          );
        }
      }
      return;
    }
    const href = clicked.getAttribute('href') || '';
    if (!href.startsWith('#')) return;
    event.preventDefault();
    const id = href.slice(1);
    const target = document.getElementById(id);
    if (!target || !content.current?.contains(target)) return;
    if (clicked.getAttribute('role') === 'doc-noteref') {
      noteOrigin.current = clicked;
      previewController.activate(clicked);
    } else if (clicked.getAttribute('role') === 'doc-backlink') {
      closeNote();
      target.scrollIntoView({ block: 'center', behavior: 'instant' });
      target.focus({ preventScroll: true });
    } else if (publicBookAnchor(id)) read(id);
    else alignTarget(target);
  }
  function sourcePresentation(element: HTMLElement | null) {
    if (!element || !body) return [];
    const citations = [
      ...element.querySelectorAll<HTMLElement>(
        '[data-book-person][data-book-key]',
      ),
    ].map((marker) => ({
      person: marker.dataset.bookPerson || '',
      key: marker.dataset.bookKey || '',
    }));
    return presentationsForNote(citations, body.citationPresentation);
  }
  function noteParts(html: string) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const actions = [
      ...template.content.querySelectorAll(
        '.book-source-link, .book-source-unavailable',
      ),
    ];
    const actionsHTML = actions.map((element) => element.outerHTML).join('');
    actions.forEach((element) => element.remove());
    return {
      canonical: { __html: template.innerHTML },
      actions: { __html: actionsHTML },
    };
  }
  const displayedNote = sourcePresentation(note);
  const notePartsMarkup = noteParts(noteMarkup.__html);
  const displayedPreview =
    preview?.kind === 'source' ? sourcePresentation(preview.note) : [];
  const previewPartsMarkup = noteParts(previewMarkup.__html);
  const current = sections.find((s) => s.anchor === active);
  const chapters = sections.filter((s) => s.level === 2);
  const index = chapters.findIndex(
    (s) => s.anchor === (current?.chapter || current?.anchor),
  );
  const closeNote = () => {
    // References outside an open native dialog are inert. Close it before
    // restoring focus; waiting for React's unmount would discard that focus.
    reader.current
      ?.querySelector<HTMLDialogElement>('dialog.book-note-modal')
      ?.close();
    setNote(null);
    requestedNote.current = null;
    const origin = noteOrigin.current;
    if (origin) {
      // A bookmark can align a passage instead of its final note marker.
      // Preserve scroll for visible markers; reveal an offscreen return target.
      if (content.current?.contains(origin) && origin.getClientRects().length) {
        const bounds = origin.getBoundingClientRect();
        const header = reader.current
          ? parseFloat(
              getComputedStyle(reader.current).getPropertyValue(
                '--site-header-height',
              ),
            ) || 0
          : 0;
        const top =
          header + (toolbar.current?.getBoundingClientRect().height || 0);
        if (bounds.top < top || bounds.bottom > window.innerHeight)
          origin.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
      restorePreviewFocus(origin);
    }
    // Deliberate dismissal removes only this current-edition bookmark. Opening
    // an original or suppressing a background dialog retains source context.
    if (note) onDismissNote(web.sha256 + ':' + note.id);
  };
  return (
    <div
      className={
        'native-book-reader' +
        (methodology ? ' is-methodology' : '') +
        (mapOpen && wideMap && geography && body?.annotations
          ? ' has-reading-map'
          : '')
      }
      ref={reader}
      onPointerDownCapture={(event) => {
        pointerInput.current = {
          target: (event.target as Element).closest('a, [data-book-document]'),
          type: event.pointerType,
        };
      }}
      onPointerCancelCapture={() => {
        pointerInput.current = null;
      }}
      onKeyDownCapture={() => {
        pointerInput.current = null;
      }}
    >
      <div className="native-book-toolbar" ref={toolbar} tabIndex={-1}>
        <button
          className="book-contents-toggle"
          ref={contentsTrigger}
          onClick={() => setContentsOpen(!contentsOpen)}
          aria-expanded={contentsOpen}
          aria-controls="native-book-contents"
        >
          {contentsOpen ? <XIcon size={19} /> : <ListBulletsIcon size={19} />}{' '}
          Contents
        </button>
        <span>{current?.title || 'The complete family book'}</span>
        {geography && body?.annotations && (
          <button
            ref={mapTrigger}
            id="book-map-toggle"
            aria-expanded={mapOpen}
            aria-controls="book-reading-map"
            onClick={() => {
              if (mapOpen) closeMap();
              else setMapPreference(true);
            }}
          >
            <MapPinIcon size={18} /> Map
          </button>
        )}
        {index > 0 && (
          <button
            className="book-step"
            aria-label={'Previous section: ' + chapters[index - 1].title}
            onClick={() => read(chapters[index - 1].anchor)}
          >
            <ArrowLeftIcon size={18} />
          </button>
        )}
        {index < chapters.length - 1 && (
          <button
            className="book-step"
            aria-label={
              'Next section: ' + chapters[Math.max(0, index + 1)].title
            }
            onClick={() => read(chapters[Math.max(0, index + 1)].anchor)}
          >
            <ArrowRightIcon size={18} />
          </button>
        )}
        <a
          href={sitePath('data/') + book.path + '?download'}
          download={site.pdfName}
        >
          <DownloadSimpleIcon size={18} /> <span>PDF</span>
        </a>
      </div>
      <div className="native-book-layout">
        <nav
          id="native-book-contents"
          ref={contentsPanel}
          className={'native-book-contents' + (contentsOpen ? ' is-open' : '')}
          aria-label="Book contents"
        >
          <p className="kin-eyebrow">Contents</p>
          {sections.map((section) => (
            <a
              key={section.anchor}
              href={'#view=book&bookAnchor=' + section.anchor}
              className={section.level === 3 ? 'book-subsection' : ''}
              aria-current={section.anchor === active ? 'location' : undefined}
              onClick={(event) => {
                event.preventDefault();
                read(section.anchor);
              }}
            >
              {section.title}
            </a>
          ))}
        </nav>
        <div className="native-book-main">
          {displayError ? (
            <div className="native-book-error" role="alert">
              <p>{displayError}</p>
              <button
                className="kin-button"
                onClick={() => {
                  setError('');
                  automaticRefresh.current = !!refreshError;
                  if (refreshError) onRefreshEdition();
                  else setRetry(retry + 1);
                }}
              >
                Try again
              </button>
            </div>
          ) : !body ? (
            <output className="kin-empty">
              <BookOpenTextIcon size={21} /> Opening the complete book…
            </output>
          ) : (
            <div
              className="native-book-content"
              ref={content}
              // This exact fragment is validated by the exporter and bound to
              // the delivered PDF/contents, then byte-verified before rendering.
              dangerouslySetInnerHTML={markup}
            />
          )}
          {body && (
            <BookChapterOpenings
              content={content}
              body={body}
              data={data}
              onPerson={onPerson}
              onRead={read}
              onTree={onTree}
            />
          )}
          {body && (
            <nav className="native-book-next" aria-label="Continue reading">
              {index > 0 && (
                <button onClick={() => read(chapters[index - 1].anchor)}>
                  <ArrowLeftIcon size={18} /> {chapters[index - 1].title}
                </button>
              )}
              {index < chapters.length - 1 && (
                <button
                  onClick={() => read(chapters[Math.max(0, index + 1)].anchor)}
                >
                  {chapters[Math.max(0, index + 1)].title}{' '}
                  <ArrowRightIcon size={18} />
                </button>
              )}
            </nav>
          )}
        </div>
        {geography && body?.annotations && mapOpen && (
          <BookReadingMap
            annotations={body.annotations}
            geography={geography}
            passage={mapPassage}
            request={mapRequest}
            wide={wideMap}
            trigger={mapTrigger.current}
            onClose={() => closeMap()}
            onFollow={() => setMapRequest(null)}
            onPlace={(id) => {
              const trigger = mapTrigger.current;
              if (trigger) {
                if (!wideMap) closeMap(() => onPlace(id, trigger));
                else onPlace(id, trigger);
              }
            }}
            onPassage={(id) => {
              const target = content.current?.querySelector<HTMLElement>(
                `[data-book-passage="${id}"]`,
              );
              const restorePassage = () => {
                if (target) alignTarget(target);
              };
              if (!wideMap) closeMap(restorePassage);
              else requestAnimationFrame(restorePassage);
            }}
          />
        )}
      </div>
      {preview && (
        <BookPreviewFrame
          key={
            preview.trigger.dataset.bookMention ||
            preview.trigger.getAttribute('href')
          }
          trigger={preview.trigger}
          label={
            preview.kind === 'source'
              ? 'Source note'
              : preview.mention.kind === 'person'
                ? data.people.find(
                    (person) => person.id === preview.mention.target,
                  )?.name || preview.mention.label
                : preview.mention.label
          }
          onClose={previewController.close}
          onPointerEnter={previewController.enter}
          onPointerLeave={previewController.leave}
          focusOnOpen={preview.focusOnOpen}
          onFollow={follow}
        >
          {preview.kind === 'entity' ? (
            <>
              {preview.trigger.dataset.bookAddedLink !== 'true' && (
                <button
                  className="book-preview-register"
                  onClick={() => {
                    const id =
                      preview.trigger.getAttribute('href')?.slice(1) || '';
                    previewController.close();
                    if (publicBookAnchor(id)) read(id);
                  }}
                >
                  Read their entry <ArrowRightIcon size={17} />
                </button>
              )}
              <BookEntityPreview
                mention={preview.mention}
                passage={preview.passage}
                data={data}
                geography={geography}
                relationLabel={relationLabel}
                onCorrection={onCorrection}
                imageUrl={(asset) => imageUrl(asset.path)}
                onPerson={(id) => {
                  rememberTrigger(preview.trigger);
                  previewController.close();
                  onPerson(id, preview.trigger);
                }}
                onPlace={(id) => {
                  rememberTrigger(preview.trigger);
                  previewController.close();
                  onPlace(id, preview.trigger);
                }}
                onMap={(mention) => {
                  setMapRequest({ mention, passage: preview.passage });
                  setMapPreference(true);
                  previewController.close();
                }}
              />
            </>
          ) : (
            <>
              <SourceCitationPresentation presentations={displayedPreview}>
                <div
                  className="book-note-copy"
                  dangerouslySetInnerHTML={
                    displayedPreview.length
                      ? previewPartsMarkup.canonical
                      : previewMarkup
                  }
                />
              </SourceCitationPresentation>
              {displayedPreview.length > 0 && (
                <div
                  className="book-note-actions"
                  dangerouslySetInnerHTML={previewPartsMarkup.actions}
                />
              )}
              <button
                className="book-preview-register"
                onClick={() => {
                  noteOrigin.current = preview.trigger;
                  setNote(preview.note);
                  previewController.close();
                }}
              >
                Read full note <ArrowRightIcon size={17} />
              </button>
            </>
          )}
        </BookPreviewFrame>
      )}
      {note && (
        <Modal
          label="Source note"
          returnFocus={() => noteOrigin.current}
          fallbackFocus={() => toolbar.current}
          className="book-note-modal"
          initialFocusSelector="h2"
          onClose={closeNote}
        >
          <div>
            <h2 className="book-note-heading" tabIndex={-1}>
              Source note
            </h2>
            <SourceCitationPresentation presentations={displayedNote}>
              <div
                className="book-note-copy"
                dangerouslySetInnerHTML={
                  displayedNote.length ? notePartsMarkup.canonical : noteMarkup
                }
              />
            </SourceCitationPresentation>
            {displayedNote.length > 0 && (
              <div
                className="book-note-actions"
                dangerouslySetInnerHTML={notePartsMarkup.actions}
              />
            )}
            <button
              className="kin-text-link"
              data-dismiss-modal
              onClick={closeNote}
            >
              <ArrowLeftIcon size={17} /> Return to reading
            </button>
          </div>
        </Modal>
      )}
      {chart && (
        <Modal
          label="Family chart"
          returnFocus={() => chartOrigin.current}
          fallbackFocus={() => toolbar.current}
          className="book-chart-modal"
          onClose={() => setChart('')}
        >
          <button
            className="kin-text-link"
            data-dismiss-modal
            onClick={() => setChart('')}
          >
            <XIcon size={19} /> Close chart
          </button>
          <p>
            Follow the lines from parents to a child. Enlarge the chart to read
            the names.
          </p>
          <div className="book-chart-scroll">
            <img
              src={sitePath('data/') + chart}
              alt="Family chart from the book"
            />
          </div>
          <a
            className="kin-text-link"
            href={sitePath('data/') + chart}
            target="_blank"
            rel="noreferrer"
          >
            Open full chart <ArrowRightIcon size={17} />
          </a>
        </Modal>
      )}
    </div>
  );
}
