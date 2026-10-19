import BrowsingImage from './BrowsingImage';
import FamilyImageViewer from './FamilyImageViewer';
import FlyleafCredit from './FlyleafCredit';
import SessionControls from './SessionControls';
import ShareSomething from './ShareSomething';
import { bookCardLine, homeInvitation, siteContents } from '../lib/home-copy';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowRightIcon,
  BookOpenTextIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckIcon,
  EyeIcon,
  ImageIcon,
  ListIcon,
  MagnifyingGlassIcon,
  PauseIcon,
  PencilSimpleLineIcon,
  PlayIcon,
  TreeIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useReducedMotion } from 'motion/react';
import FamilyTree from './FamilyTree';
import Places from './Places';
import geographyData from '@content/geography.json';
import { validateGeography } from '../lib/places';
import '../places.css';
import Archive from './Archive';
import FamilyBook from './FamilyBook';
import FamilyCollections from './FamilyCollections';
import recipeContents from '@content/family-recipes.json';
import { familyRecipeBook } from '../lib/family-recipes';
import homeRecordList from '@content/home-records.json';
import FamilyAlbum from './FamilyAlbum';
import PersonGallery from './PersonGallery';
import ProfileIntroduction from './ProfileIntroduction';
import Album, { AlbumLink } from './Album';
import { albumsInEdition } from '../lib/albums';
import ChapterHighlights from './ChapterHighlights';
import { FeaturedPhoto, PhotoStack, RecordShelf } from './HomeCarousels';
import {
  readWebBook,
  chapterHighlights,
  type ReadingSection,
  type WebBook,
} from '../lib/native-book';
import '../native-book.css';
import { readBookPublication, type BookPublication } from '../lib/publication';
import DocumentViewer from './DocumentViewer';
import Modal from './Modal';
import { useDismissible, useMediaQuery } from '../lib/useDismissible';
import { decodeGedcom, lifespan, parseGedcom } from '../lib/gedcom';
import { calendarDate, formatGedcomDate } from '../lib/date-display';
import { profileEventLabel, profileUnions } from '../lib/profile-family';
import { imageSequence } from '../lib/photo-files';
import type { Asset, AtlasData, Person, Source } from '../lib/gedcom';
import type { VisualMedia } from '../lib/visuals';
import { useCarousel } from '../lib/useCarousel';
import { changelog, currentRelease, releaseDate } from '../lib/changelog';
import { site } from '../lib/settings';
import {
  branchChoices,
  familyFocus,
  familyGroupPhotos,
  immediateFamily,
  viewpointChoices,
} from '../lib/branches';
import { createPeopleSearch, relationshipFinder } from '../lib/family-browsing';
import { homeRoute, readRoute, routeHref } from '../lib/navigation';
import type { Destination, Route } from '../lib/navigation';
import { safeRelativePath } from '../lib/local-assets';
import {
  captureBookFocus,
  readBookFocus,
  type BookFocusTarget,
} from '../lib/book-annotations';
import { readPreviewIndex, sha256, type PreviewIndex } from '../lib/previews';
import {
  archiveCatalog,
  localFileUrl,
  resolveDocument,
  sourceDocument,
  selectCitationUse,
  type ArchiveDocument,
} from '../lib/archive';
import { citationUsesInScope } from '../lib/citation-uses';
import {
  albumPictures,
  identifiedPortrait,
  peopleFirst,
  portraitDescription,
  visualFor,
  visualLabel,
} from '../lib/visuals';
import { sitePath } from '../lib/paths';
// Remembers an administrator's chosen view on this device.
const viewAsKey = `${site.id}.viewAs`;
// The family's recipe book, or null when it has none.
const recipeBook = familyRecipeBook(recipeContents);
const navigation: [Destination, string][] = [
  ['book', 'Book'],
  ['people', 'People'],
  ['tree', 'Family tree'],
  ['photos', 'Photographs'],
  ['treasures', 'Treasures'],
  ['places', 'Places'],
  ['archive', 'Archive'],
];
/** "songs", "songs and recipes", "songs, recipes and letters". */
const wordList = (words: string[]) =>
  words.length < 2
    ? words.join('')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
const capitalized = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);
// What each photograph's role adds to the album's description on Home.
const albumRoles: [string, (visual: VisualMedia) => boolean][] = [
  ['portraits', (v) => v.role === 'portrait' || v.role === 'group'],
  ['places', (v) => v.role === 'place'],
  ['keepsakes', (v) => v.role === 'object'],
  ['memorials', (v) => v.role === 'memorial'],
];

const bookEntryLabel = (person: Person) => {
  const given = person.given.split(' ')[0];
  return given
    ? `Read ${given}’s entry in the book`
    : 'Read their entry in the book';
};

export default function Atlas() {
  const [data, setData] = useState<AtlasData | null>(null);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const refreshEdition = useCallback(() => {
    setError('');
    setLibraryRevision((v) => v + 1);
  }, []);
  const [route, setRoute] = useState<Route>(homeRoute);
  // Who is reading: the signed-in person (from VIEWER_PEOPLE), or a view
  // chosen by an administrator. The Worker's /api/session says who is an
  // administrator; the dev server lets its user switch views. Everyone else,
  // including every visitor to a static site, starts without that menu.
  const [session, setSession] = useState<{
    person: string;
    admin: boolean;
    viewers: string[];
  }>({ person: '', admin: !!import.meta.env?.DEV, viewers: [] });
  const [viewAs, setViewAs] = useState(() => {
    try {
      return localStorage.getItem(viewAsKey) || '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    if (site.hosting !== 'worker') return;
    fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(
        (r) =>
          (r.ok ? r.json() : null) as Promise<{
            person?: unknown;
            admin?: unknown;
            viewers?: unknown;
          } | null>,
      )
      .then((value) => {
        if (value && typeof value === 'object')
          setSession({
            person: typeof value.person === 'string' ? value.person : '',
            admin: value.admin === true,
            viewers: Array.isArray(value.viewers)
              ? value.viewers.filter((id) => typeof id === 'string')
              : [],
          });
      })
      .catch(() => {});
  }, []);
  const [bookNavigation, setBookNavigation] = useState(0);
  const [error, setError] = useState('');
  const [branchOpen, setBranchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [previews, setPreviews] = useState<PreviewIndex>({});
  const [book, setBook] = useState<BookPublication | null>(null);
  const [bookNoteText, setBookNoteText] = useState('');
  const [imageScope, setImageScope] = useState<string[]>([]);
  const [webBook, setWebBook] = useState<WebBook | null>(null);
  const [bookReturnFocus, setBookReturnFocus] =
    useState<BookFocusTarget | null>(null);
  const publication = useRef<WebBook | null>(null);
  const [readMore, setReadMore] = useState(false);
  const reduce = useReducedMotion();
  const current = useRef(route);
  const model = useRef(data);
  const revision = useRef(0);
  const pendingScroll = useRef<number | null>(null);
  const profileContent = useRef<HTMLElement>(null);
  const pendingProfile = useRef<{
    top: number;
    heading: boolean;
    personLink?: string;
  } | null>(null);
  const recentTrigger = useRef<HTMLElement | null>(null);
  const personTrigger = useRef<HTMLElement | null>(null);
  const imageTrigger = useRef<HTMLElement | null>(null);
  const recordTrigger = useRef<HTMLElement | null>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const viewAsMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    // Close the view-as menu on an outside press or Escape.
    const close = (event: Event) => {
      const menu = viewAsMenu.current;
      if (!menu?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return;
        menu.open = false;
        menu.querySelector('summary')?.focus();
      } else if (!menu.contains(event.target as Node)) menu.open = false;
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);
  const menuPanel = useRef<HTMLElement>(null);
  const branchTrigger = useRef<HTMLButtonElement>(null);
  const smallNavigation = useMediaQuery('(max-width: 760px)');
  useDismissible({
    enabled: menuOpen && smallNavigation,
    root: () => menuPanel.current,
    inside: () => [menuPanel.current],
    trigger: () => menuTrigger.current,
    onDismiss: () => setMenuOpen(false),
  });
  const focusFallback = () =>
    document.querySelector<HTMLElement>(
      '.kin-life-modal[open] .kin-life-heading h2',
    ) ||
    document.querySelector<HTMLElement>(
      '.native-book-content [data-reader-return-focus]',
    ) ||
    document.getElementById('main-content');
  useLayoutEffect(() => {
    current.current = route;
    model.current = data;
  }, [route, data]);
  function navigate(patch: Partial<Route>, replace = false) {
    const previous = { ...current.current, scroll: window.scrollY };
    if (patch.person && patch.person !== previous.person)
      personTrigger.current = recentTrigger.current;
    if (patch.image && patch.image !== previous.image)
      imageTrigger.current = recentTrigger.current;
    if (patch.record && patch.record !== previous.record)
      recordTrigger.current = recentTrigger.current;
    const bookFocus =
      previous.view === 'book' && patch.view && patch.view !== 'book'
        ? captureBookFocus(
            recentTrigger.current,
            publication.current?.sha256 || '',
          )
        : null;
    const profile = profileContent.current;
    const profileTrigger = recentTrigger.current;
    history.replaceState(
      {
        ...previous,
        bookFocus,
        ...(previous.person && {
          profileScroll: profile?.closest('dialog')?.scrollTop || 0,
          profileFocus:
            profileTrigger && profile?.contains(profileTrigger)
              ? profileTrigger.dataset.profilePerson
              : undefined,
        }),
      },
      '',
      routeHref(previous),
    );
    const next = { ...previous, ...patch };
    if (next.view !== 'share') next.correction = '';
    if (next.person !== previous.person)
      pendingProfile.current = next.person ? { top: 0, heading: true } : null;
    if (
      !next.record ||
      (next.record !== previous.record && !('citationUse' in patch))
    )
      next.citationUse = '';
    const pageChanged =
      next.view !== previous.view ||
      next.album !== previous.album ||
      next.passage !== previous.passage ||
      next.bookAnchor !== previous.bookAnchor ||
      !!patch.bookAnchor ||
      (!!next.bookPage || !!next.bookVersion) !==
        (!!previous.bookPage || !!previous.bookVersion) ||
      next.branch !== previous.branch;
    if (pageChanged) {
      next.scroll = 0;
      pendingScroll.current = 0;
      setReadMore(false);
    }
    history[replace ? 'replaceState' : 'pushState'](next, '', routeHref(next));
    current.current = next;
    setRoute(next);
    if (next.view === 'book' && patch.bookAnchor)
      setBookNavigation((value) => value + 1);
    setBookReturnFocus(null);
    setMenuOpen(false);
  }
  const load = useCallback((text: string) => {
    const parsed = parseGedcom(text, site.names);
    const next = readRoute(location.hash, parsed, publication.current);
    setData(parsed);
    model.current = parsed;
    setRoute(next);
    current.current = next;
    setError('');
    setQuery('');
    setReadMore(false);
    document.title = parsed.title;
    history.replaceState(next, '', routeHref(next));
    pendingScroll.current = 0;
  }, []);
  useEffect(() => {
    const token = ++revision.current;
    const controller = new AbortController();
    Promise.all([
      fetch(sitePath('data/family.ged'), { signal: controller.signal }).then(
        (r) => {
          if (!r.ok) throw new Error('The family archive could not be opened.');
          return r.arrayBuffer();
        },
      ),
      fetch(sitePath('data/previews.json'), { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(sitePath('data/book.json'), { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(async ([buffer, previewData, bookData]) => {
        const gedcomHash = await sha256(buffer);
        const index = previewData
          ? readPreviewIndex(previewData, gedcomHash)
          : {};
        if (token === revision.current && !controller.signal.aborted) {
          const pdf = readBookPublication(bookData, gedcomHash);
          const web = readWebBook(bookData, gedcomHash, pdf);
          if (libraryRevision > 0 && (!pdf || !web))
            throw new Error(
              'The current edition could not be loaded. Please try again.',
            );
          setPreviews(index);
          setBook(pdf);
          setWebBook(web);
          publication.current = web;
          load(decodeGedcom(buffer));
        }
      })
      .catch((e) => {
        if (token === revision.current && !controller.signal.aborted)
          setError(e.message);
      });
    const restore = (event: PopStateEvent | HashChangeEvent) => {
      if (!model.current) return;
      const next = {
        ...readRoute(location.hash, model.current, publication.current),
        scroll: Number(history.state?.scroll) || 0,
      };
      // One native fragment navigation can emit popstate then hashchange.
      // Reapplying an equivalent hash event would reset the Book's just-aligned
      // chapter to scroll zero. A new popstate still restores its own position.
      if (
        event.type === 'hashchange' &&
        Object.entries(next).every(
          ([key, value]) => current.current[key as keyof Route] === value,
        )
      )
        return;
      if (next.person !== current.current.person) {
        const saved = history.state?.profileScroll;
        pendingProfile.current = next.person
          ? {
              top: Number.isFinite(saved) && saved >= 0 ? saved : 0,
              heading: false,
              personLink: history.state?.profileFocus,
            }
          : null;
      }
      pendingScroll.current = next.scroll;
      current.current = next;
      setRoute(next);
      // A fresh fragment requests its heading; Back restores the saved position,
      // including zero. Do not turn a return from a panel into another jump.
      if (
        next.view === 'book' &&
        next.bookAnchor &&
        !Number.isFinite(history.state?.scroll)
      )
        setBookNavigation((value) => value + 1);
      setBookReturnFocus(
        next.view === 'book'
          ? readBookFocus(
              history.state?.bookFocus,
              publication.current?.sha256 || '',
            )
          : null,
      );
      setReadMore(false);
    };
    window.addEventListener('popstate', restore);
    window.addEventListener('hashchange', restore);
    return () => {
      controller.abort();
      window.removeEventListener('popstate', restore);
      window.removeEventListener('hashchange', restore);
    };
  }, [load, libraryRevision]);
  useLayoutEffect(() => {
    if (pendingScroll.current !== null && data) {
      window.scrollTo({ top: pendingScroll.current, behavior: 'instant' });
      pendingScroll.current = null;
    }
  }, [data, route]);
  useLayoutEffect(() => {
    const content = profileContent.current;
    const dialog = content?.closest('dialog');
    if (!data || !route.person || !content || !dialog) return;
    const position = pendingProfile.current || { top: 0, heading: true };
    pendingProfile.current = null;
    const focus = position.heading
      ? content.querySelector<HTMLElement>('.kin-life-heading h2')
      : typeof position.personLink === 'string'
        ? content.querySelector<HTMLElement>(
            `[data-profile-person="${CSS.escape(position.personLink)}"]`,
          )
        : null;
    focus?.focus({ preventScroll: true });
    dialog.scrollTop = position.top;
    const remember = () => {
      if (history.state?.person === route.person)
        history.replaceState(
          { ...history.state, profileScroll: dialog.scrollTop },
          '',
        );
    };
    remember();
    dialog.addEventListener('scroll', remember, { passive: true });
    return () => dialog.removeEventListener('scroll', remember);
  }, [data, route.person]);
  const resolveFile = useCallback((path: string) => {
    const safe = safeRelativePath(path);
    return safe ? localFileUrl(sitePath('data/'), safe) : '';
  }, []);
  const assetUrl = useCallback(
    (asset: Asset) => resolveFile(asset.path),
    [resolveFile],
  );
  const previewUrl = useCallback(
    (path: string, size: '640' | '1600' = '640') => {
      const entry = previews[path];
      return entry ? resolveFile(entry.variants[size].path) : '';
    },
    [previews, resolveFile],
  );
  const browsingUrl = (asset: Asset, size: '640' | '1600' = '1600') =>
    previewUrl(asset.path, size) || assetUrl(asset);
  // A picture's width over its height, when the previews record it.
  const photoShape = (asset: Asset) => {
    const size = previews[asset.path]?.displayedSize;
    return size ? size[0] / size[1] : undefined;
  };
  const focus = useMemo(
    () => (data ? familyFocus(data, route.branch) : null),
    [data, route.branch],
  );
  const focused = focus?.data;
  const known = (id: string) => !!id && !!data?.people.some((p) => p.id === id);
  const chosenView = session.admin && known(viewAs) ? viewAs : '';
  const viewerId =
    chosenView ||
    (known(session.person) ? session.person : '') ||
    data?.rootId ||
    '';
  // Labels speak to the reader ('Your grandmother') when we know who is
  // reading; otherwise they describe the root person's family ('Tamsin's
  // grandmother', for a family whose root is Tamsin).
  const personalView = !!(chosenView || known(session.person));
  // One finder per reader: search and sorting share each relationship.
  const relationshipToViewer = useMemo(
    () => (data ? relationshipFinder(data, viewerId) : null),
    [data, viewerId],
  );
  const matchesPerson = useMemo(
    () =>
      data && relationshipToViewer
        ? createPeopleSearch(data, viewerId, relationshipToViewer)
        : () => false,
    [data, viewerId, relationshipToViewer],
  );
  const relationships = useMemo(
    () =>
      new Map(
        (relationshipToViewer &&
          data?.people.map((p) => [p.id, relationshipToViewer(p.id)])) ||
          [],
      ),
    [data, relationshipToViewer],
  );
  const peopleResults = useMemo(
    () =>
      (focused?.people || [])
        .filter((p) => matchesPerson(p, query))
        .sort(
          (a, b) =>
            (relationships.get(a.id)?.path.length || Infinity) -
              (relationships.get(b.id)?.path.length || Infinity) ||
            a.surname.localeCompare(b.surname) ||
            a.given.localeCompare(b.given),
        ),
    [focused, matchesPerson, query, relationships],
  );
  const outsideResults = useMemo(
    () =>
      route.branch && query.trim()
        ? (data?.people || []).filter(
            (p) => !focus?.members.has(p.id) && matchesPerson(p, query),
          ).length
        : 0,
    [data, route.branch, query, focus, matchesPerson],
  );
  const albums = useMemo(() => (data ? albumsInEdition(data) : []), [data]);
  // The site leaves out a feature the family has nothing for: its menu item,
  // its section on Home and the text that points to it.
  const has = useMemo(
    () => ({
      photos: !!data?.visuals?.some((v) =>
        data.assets.some((a) => a.id === v.assetId),
      ),
      treasures:
        albums.length > 0 ||
        !!data?.people.some((p) => p.id === recipeBook?.labels.person),
      places: !!data?.places.length,
      archive: !!data && archiveCatalog(data).length > 0,
      news: changelog.length > 0,
    }),
    [data, albums],
  );
  // The recipe book leads the archive; albums lead by their recordings.
  const treasureSources = useMemo(
    () =>
      new Set(
        data?.sources
          .filter((s) => s.pointer === recipeBook?.source)
          .map((s) => s.id),
      ),
    [data],
  );
  const menu = navigation.filter(
    ([id]) => !(id in has) || has[id as keyof typeof has],
  );
  const selectedAlbum = albums.find((a) => a.id === route.album);
  const choices = useMemo(() => (data ? branchChoices(data) : []), [data]);
  const geography = useMemo(() => {
    if (!data) return null;
    try {
      return validateGeography(geographyData, data);
    } catch {
      return null;
    }
  }, [data]);
  const highlights = chapterHighlights(
    webBook,
    route.branch && focused
      ? new Set(focused.people.map((p) => p.id))
      : undefined,
  );
  const pictures = focused ? albumPictures(focused) : [];
  // The whole family's Home opens on a photograph of the root person's own
  // family; a
  // chosen branch opens on a picture from its chapters.
  // The home photograph rotates through the family's group photographs, or
  // through the branch's book highlights when a branch is chosen.
  const heroItems: { asset: Asset; section?: ReadingSection }[] = (() => {
    if (!data) return [];
    if (!focus?.anchor) {
      const photos = familyGroupPhotos(data);
      if (photos.length) return photos.map((asset) => ({ asset }));
    }
    const fromBook = peopleFirst(data, highlights).flatMap((section) => {
      const asset = data.assets.find((a) => a.path === section.image);
      return asset ? [{ asset, section }] : [];
    });
    if (fromBook.length) return fromBook;
    return pictures[0] ? [{ asset: pictures[0] }] : [];
  })();
  const onHome = route.view === 'home';
  const heroCarousel = useCarousel(heroItems.length, 5000, onHome);
  const albumCarousel = useCarousel(pictures.length, 5000, onHome);
  // A few striking documents, chosen by hand, invite family into the archive.
  const recordPool = data
    ? homeRecordList.flatMap((record) => {
        const asset = data.assets.find((a) => a.path === record.path);
        return asset ? [{ asset, title: record.title }] : [];
      })
    : [];
  const recordsCarousel = useCarousel(recordPool.length, 5000, onHome);
  const person = data?.people.find((p) => p.id === route.person);
  const image = data?.assets.find((a) => a.id === route.image);
  const record = data
    ? resolveDocument(data, route.record, route.file, route.citationUse)
    : null;
  const source = record
    ? {
        ...record,
        archives: [...record.archives].sort(
          (a, b) =>
            Number(b.path === route.file) - Number(a.path === route.file),
        ),
      }
    : null;
  function readBook(anchor = '', note = '') {
    navigate({
      view: 'book',
      bookAnchor: anchor,
      bookPage: '',
      bookVersion: '',
      bookNote: note && webBook ? webBook.sha256 + ':' + note : '',
      citationUse: '',
      chapter: '',
      passage: '',
      person: '',
      image: '',
      record: '',
      file: '',
      scroll: 0,
    });
  }
  function openSource(source: Source, filePath?: string, citationUse = '') {
    openDocument(
      selectCitationUse(sourceDocument(source), citationUse),
      filePath,
    );
  }
  function openDocument(
    document: ArchiveDocument,
    filePath?: string,
    noteReference = '',
  ) {
    const requested = filePath || document.archives[0]?.path;
    const resolved = data
      ? resolveDocument(
          data,
          document.id,
          requested,
          document.selectedUse?.id,
        ) || document
      : document;
    // A manually opened Book preview has no bookmark yet. Preserve its exact
    // current-edition note in the previous entry before pushing the original.
    if (
      current.current.view === 'book' &&
      !current.current.record &&
      publication.current &&
      noteReference.startsWith(publication.current.sha256 + ':') &&
      /^[a-f0-9]{64}:(?:loc-|book-note-)[0-9]+$/.test(noteReference)
    )
      navigate({ bookNote: noteReference }, true);
    navigate({
      record: resolved.id,
      bookNote: noteReference,
      citationUse: resolved.selectedUse?.id || '',
      file:
        resolved.archives.find((f) => f.path === requested)?.path ||
        resolved.archives[0]?.path ||
        '',
      image: '',
    });
  }
  function chooseBranch(id: string) {
    navigate({
      branch: id,
      focus: id,
      person: '',
      record: '',
      image: '',
      view: ['places', 'archive', 'people', 'tree', 'photos'].includes(
        route.view,
      )
        ? route.view
        : 'home',
      archivePage: 1,
      passage: '',
      chapter: '',
    });
    setBranchOpen(false);
  }
  function go(view: Destination) {
    if (view === 'book' || view === 'stories' || view === 'story') {
      readBook();
      return;
    }
    navigate({
      view,
      album: '',
      person: '',
      image: '',
      record: '',
      correction: '',
      focus: route.branch || data!.rootId,
    });
    setQuery('');
  }
  function suggestCorrection(id: string) {
    navigate({
      view: 'share',
      correction: id,
      person: '',
      image: '',
      record: '',
      album: '',
    });
  }
  function openAlbum(id: string) {
    navigate({
      view: 'album',
      album: id,
      person: '',
      image: '',
      record: '',
      file: '',
      chapter: '',
      passage: '',
      bookAnchor: '',
      bookPage: '',
      bookVersion: '',
      bookNote: '',
    });
  }
  function personLink(p: Person, detail = true) {
    const portrait = identifiedPortrait(data!, p.id);
    return (
      <button
        className="kin-person"
        data-profile-person={p.id}
        key={p.id}
        onClick={() => navigate({ person: p.id })}
      >
        <span className="kin-avatar">
          {portrait && assetUrl(portrait) ? (
            <BrowsingImage
              original={assetUrl(portrait)}
              src={browsingUrl(portrait, '640')}
              style={{
                objectPosition:
                  visualFor(data!, portrait.path)?.avatarPosition || 'top',
              }}
              alt=""
              loading="lazy"
            />
          ) : (
            <span>
              {p.given[0]}
              {p.surname[0]}
            </span>
          )}
        </span>
        <span>
          <strong>{p.name}</strong>
          {detail &&
            relationships.get(p.id) &&
            relationText(relationships.get(p.id)!) && (
              <small>{relationText(relationships.get(p.id)!)}</small>
            )}
          {portrait &&
            visualFor(data!, portrait.path)?.content === 'artwork' && (
              <small>Portrait artwork</small>
            )}
          {detail && lifespan(p) && <small>{lifespan(p)}</small>}
        </span>
        <ArrowRightIcon size={18} />
      </button>
    );
  }
  function openImage(id: string, orderedAssetIds: readonly string[] = []) {
    if (!data) return;
    setImageScope(imageSequence(data, id, orderedAssetIds));
    navigate({ image: id });
  }
  function photo(
    asset: Asset,
    className = '',
    orderedAssetIds: readonly string[] = [],
  ) {
    const visual = visualFor(data!, asset.path);
    const title = visual?.title || asset.title;
    return (
      <figure className={`kin-figure ${className}`} key={asset.id}>
        <button
          onClick={() => openImage(asset.id, orderedAssetIds)}
          data-image-id={asset.id}
          aria-label={`View image: ${title}`}
        >
          {assetUrl(asset) ? (
            <BrowsingImage
              original={assetUrl(asset)}
              src={browsingUrl(asset)}
              alt={title}
              loading="lazy"
            />
          ) : (
            <span className="kin-missing">
              This image is currently unavailable.
            </span>
          )}
          <span className="kin-enlarge">
            <ImageIcon size={17} /> View image
          </span>
        </button>
        <figcaption>
          {visual && (
            <small className="kin-visual-label">{visualLabel(visual)}</small>
          )}
          {title}
          {/* Credits belong in the full-size viewer, not under the picture. */}
          {visual?.publicNote && <small>{visual.publicNote}</small>}
        </figcaption>
      </figure>
    );
  }
  if (!data || !focused)
    return (
      <main className="kin-opening">
        <TreeIcon size={32} />
        <h1>
          {error
            ? 'The family archive could not be opened'
            : 'Opening the family archive…'}
        </h1>
        {error && <p role="alert">{error}</p>}
        {error && (
          <button className="kin-button" onClick={() => location.reload()}>
            Try again
          </button>
        )}
      </main>
    );
  const branchLabel = focus?.anchor
    ? `${focus.anchor.given.split(' ')[0]} ${focus.anchor.surname}’s branch`
    : 'All the family';
  const rootPerson = data.people.find((p) => p.id === data.rootId)!;
  const relationText = (relation: { label: string; kind: string }) =>
    relation.kind === 'self'
      ? personalView
        ? 'You'
        : ''
      : personalView
        ? `Your ${relation.label.toLowerCase()}`
        : `${rootPerson.given.split(' ')[0]}’s ${relation.label.toLowerCase()}`;
  const shortName = (id: string) => {
    const p = data.people.find((candidate) => candidate.id === id);
    return p ? `${p.given.split(' ')[0]} ${p.surname}`.trim() : '';
  };
  const myselfLabel = known(session.person)
    ? `Myself (${shortName(session.person)})`
    : `${rootPerson.given.split(' ')[0]}’s family`;
  const viewingLabel = chosenView ? shortName(chosenView) : myselfLabel;
  const chooseView = (value: string) => {
    setViewAs(value);
    try {
      if (value) localStorage.setItem(viewAsKey, value);
      else localStorage.removeItem(viewAsKey);
    } catch {
      /* A remembered view is a convenience only. */
    }
    if (viewAsMenu.current) viewAsMenu.current.open = false;
  };
  const relationship = person ? relationships.get(person.id) : null;
  const homePeople = focus?.anchor
    ? [
        focus.anchor,
        ...focused.people.filter(
          (p) =>
            p.id !== focus.anchor?.id && !!identifiedPortrait(focused, p.id),
        ),
      ].slice(0, 4)
    : immediateFamily(data, viewerId);
  // The relatives an administrator can preview the site as, nearest first.
  const viewOptions = session.admin
    ? viewpointChoices(data, session.viewers)
    : [];
  const homeAlbums = albums.filter((a) =>
    focused?.people.some((p) => p.id === a.person),
  );
  const homeRecipes = !!focused?.people.some(
    (p) => p.id === recipeBook?.labels.person,
  );
  const homeLetters =
    homeRecipes && !!recipeBook?.volumes.some((v) => v.kind === 'letter');
  const treasureWords = (music: string, letters: string) => [
    ...(homeAlbums.length ? [music] : []),
    ...(homeRecipes ? ['recipes'] : []),
    ...(homeLetters ? [letters] : []),
  ];
  const albumIntro =
    site.albumIntro ||
    `${capitalized(
      wordList(
        albumRoles
          .filter(([, matches]) =>
            (focused?.visuals || []).some(
              (v) => matches(v) && pictures.some((a) => a.id === v.assetId),
            ),
          )
          .map(([word]) => word),
      ),
    )}.`;
  const treasureGrid = () => (
    <div className="kin-treasure-grid">
      {homeAlbums.map((album) => (
        <AlbumLink
          key={album.id}
          album={album}
          resolveFile={resolveFile}
          onOpen={openAlbum}
        />
      ))}
      {homeRecipes && recipeBook && (
        <button
          className="kin-music-link"
          onClick={() => navigate({ person: recipeBook.labels.person })}
        >
          <BrowsingImage
            original={resolveFile(recipeBook.coverImage)}
            src={
              previewUrl(recipeBook.coverImage, '640') ||
              resolveFile(recipeBook.coverImage)
            }
            alt=""
            loading="lazy"
          />
          <span>
            <small>{recipeBook.labels.byline}</small>
            <strong>{recipeBook.labels.title}</strong>
            <span>
              {recipeBook.labels.open}{' '}
              <ArrowRightIcon size={17} aria-hidden="true" />
            </span>
          </span>
        </button>
      )}
    </div>
  );
  const carouselControls = (
    carousel: ReturnType<typeof useCarousel>,
    count: number,
    noun: string,
    nouns: string,
  ) =>
    count > 1 ? (
      <div className="kin-carousel-controls">
        <button aria-label={`Previous ${noun}`} onClick={carousel.prev}>
          <CaretLeftIcon size={19} aria-hidden="true" />
        </button>
        <span>
          {carousel.index + 1} of {count}
        </span>
        <button aria-label={`Next ${noun}`} onClick={carousel.next}>
          <CaretRightIcon size={19} aria-hidden="true" />
        </button>
        {carousel.moving && (
          <button
            className="kin-carousel-pause"
            aria-label={`${carousel.stopped ? 'Play' : 'Pause'} ${nouns}`}
            title={carousel.stopped ? 'Play' : 'Pause'}
            onClick={carousel.toggle}
          >
            {carousel.stopped ? (
              <PlayIcon size={17} aria-hidden="true" />
            ) : (
              <PauseIcon size={17} aria-hidden="true" />
            )}
          </button>
        )}
      </div>
    ) : null;
  return (
    <div
      className="family-site"
      onClickCapture={(event) => {
        if (event.target instanceof Element) {
          const control = event.target.closest<HTMLElement>(
            'button, a, summary, [role="button"]',
          );
          if (control) recentTrigger.current = control;
        }
      }}
    >
      <a
        className="kin-skip"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="kin-header">
        <button
          className="kin-brand"
          onClick={() => go('home')}
          aria-label="Family home"
        >
          <span className="kin-monogram">
            <TreeIcon size={28} />
          </span>
          <span>
            {data.title}
            <small>{data.subtitle || site.tagline}</small>
          </span>
        </button>
        <nav className="kin-desktop-nav" aria-label="Main navigation">
          {menu.map(([id, label]) => (
            <button
              key={id}
              aria-current={
                route.view === id ||
                (id === 'stories' && route.view === 'story')
                  ? 'page'
                  : undefined
              }
              onClick={() => go(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <button
          className="kin-search-toggle"
          aria-label="Search people"
          onClick={() => go('people')}
        >
          <MagnifyingGlassIcon size={21} />
        </button>
        {session.admin && (
          <details className="kin-viewas" ref={viewAsMenu}>
            <summary
              aria-label={`Viewing the site as ${viewingLabel}. Choose who to see it as.`}
            >
              <EyeIcon size={19} aria-hidden="true" />
              <span className="kin-viewas-current">{viewingLabel}</span>
              <CaretDownIcon size={15} aria-hidden="true" />
            </summary>
            <div className="kin-viewas-menu">
              <p>See the site as</p>
              {[
                ['', myselfLabel],
                ...viewOptions.map((p) => [p.id, p.name]),
              ].map(([id, label]) => (
                <button
                  key={id || 'myself'}
                  aria-pressed={chosenView === id}
                  onClick={() => chooseView(id)}
                >
                  <span>{label}</span>
                  {chosenView === id && (
                    <CheckIcon size={17} aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
          </details>
        )}
        <button
          className="kin-mobile-menu"
          ref={menuTrigger}
          aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <XIcon /> : <ListIcon />}
        </button>
        <SessionControls />
      </header>
      {menuOpen && (
        <nav
          ref={menuPanel}
          className="kin-mobile-nav"
          aria-label="Mobile navigation"
        >
          {[
            ['home', 'Family home'],
            ...menu,
            ...(site.sharing ? [['share', 'Share something']] : []),
          ].map(([id, label]) => (
            <button key={id} onClick={() => go(id as Destination)}>
              {label}
              <ArrowRightIcon size={19} />
            </button>
          ))}
          {session.admin && (
            <label className="kin-mobile-viewas">
              <span>See the site as</span>
              <select
                value={chosenView}
                onChange={(event) => chooseView(event.target.value)}
              >
                <option value="">{myselfLabel}</option>
                {viewOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </nav>
      )}
      <div className="kin-focusbar">
        <div>
          <span className="kin-focus-label">Family branch</span>
          <button
            ref={branchTrigger}
            onClick={() => setBranchOpen(true)}
            aria-haspopup="dialog"
          >
            <TreeIcon size={16} />
            <strong>{branchLabel}</strong>
            <CaretDownIcon size={16} />
          </button>
        </div>
        {route.branch && (
          <button className="kin-reset" onClick={() => chooseBranch('')}>
            Show the whole family <XIcon size={15} />
          </button>
        )}
      </div>
      <main id="main-content" tabIndex={-1}>
        <ShareSomething
          data={data}
          visible={route.view === 'share'}
          imported={false}
          correctionFor={route.correction}
        />
        {route.view === 'home' && (
          <>
            <section className="kin-home-hero">
              <div className="kin-welcome">
                <span className="kin-eyebrow">{data.title}</span>
                <h1>
                  {focus?.anchor ? (
                    <>
                      {focus.anchor.given.split(' ')[0]}’s
                      <br />
                      family branch
                    </>
                  ) : (
                    <>
                      Our family
                      <br />
                      history
                    </>
                  )}
                </h1>
                <p>{homeInvitation(has)}</p>
                <div className="kin-hero-actions">
                  <button
                    className="kin-button"
                    onClick={() =>
                      highlights[0]
                        ? readBook(highlights[0].anchor)
                        : go('people')
                    }
                  >
                    {highlights.length ? 'Read a chapter' : 'Browse people'}
                    <ArrowRightIcon size={18} />
                  </button>
                  <button
                    className="kin-text-link"
                    onClick={() => setBranchOpen(true)}
                  >
                    Find your branch <TreeIcon size={18} />
                  </button>
                </div>
              </div>
              <div className="kin-featured-photo" {...heroCarousel.bind}>
                {heroItems.length > 0 ? (
                  <FeaturedPhoto
                    slides={heroItems.map(({ asset, section }, i) => ({
                      key: `${i}-${asset.id}`,
                      src: browsingUrl(asset),
                      original: assetUrl(asset),
                      shape: photoShape(asset),
                      title: asset.title,
                      label: section?.title || asset.title,
                      eyebrow: section
                        ? 'From the family book'
                        : 'From the family album',
                      open: () =>
                        section
                          ? readBook(section.anchor)
                          : openImage(asset.id),
                      view: () => openImage(asset.id),
                    }))}
                    index={heroCarousel.index}
                    controls={carouselControls(
                      heroCarousel,
                      heroItems.length,
                      'photograph',
                      'photographs',
                    )}
                  />
                ) : (
                  <div className="kin-hero-empty">
                    <TreeIcon size={100} weight="thin" />
                    <p>
                      {has.photos
                        ? 'No featured photograph for this branch yet.'
                        : 'No photographs yet.'}
                    </p>
                  </div>
                )}
              </div>
            </section>
            <section className="kin-people-band">
              <div className="kin-section-heading">
                <div>
                  <span className="kin-eyebrow">People and relationships</span>
                  <h2>Find a relative</h2>
                </div>
                <button className="kin-text-link" onClick={() => go('people')}>
                  Browse people <ArrowRightIcon size={18} />
                </button>
              </div>
              <div
                className={
                  'kin-home-people' + (focus?.anchor ? '' : ' kin-home-family')
                }
              >
                {homePeople.map((p) => personLink(p))}
              </div>
            </section>
            {(homeAlbums.length > 0 || homeRecipes) && (
              <section className="kin-section kin-treasures">
                <div className="kin-section-heading">
                  <div>
                    <span className="kin-eyebrow">Family treasures</span>
                    <h2>
                      {capitalized(wordList(treasureWords('songs', 'letters')))}
                    </h2>
                  </div>
                </div>
                {treasureGrid()}
              </section>
            )}
            <section className="kin-section kin-story-section">
              <div className="kin-section-heading">
                <div>
                  <span className="kin-eyebrow">From the book</span>
                  <h2>Chapter highlights</h2>
                </div>
                <button className="kin-text-link" onClick={() => readBook()}>
                  The complete book <ArrowRightIcon size={18} />
                </button>
              </div>
              <ChapterHighlights
                sections={highlights.slice(0, 3)}
                onRead={readBook}
                imageUrl={(path) =>
                  previewUrl(path, '1600') || resolveFile(path)
                }
              />
              {!highlights.length && (
                <p className="kin-empty">
                  Open the book to read about this branch.
                </p>
              )}
            </section>
            {pictures.length > 0 && (
              <section className="kin-section kin-album-teaser">
                <div>
                  <span className="kin-eyebrow">Photographs</span>
                  <h2>The family album</h2>
                  <p>
                    {albumIntro} Open an image to see the whole photograph, its
                    caption and the record it came from.
                  </p>
                  <button
                    className="kin-text-link"
                    onClick={() => go('photos')}
                  >
                    Open the family album <ArrowRightIcon size={18} />
                  </button>
                  {carouselControls(
                    albumCarousel,
                    pictures.length,
                    'photographs',
                    'photographs',
                  )}
                </div>
                <PhotoStack
                  photos={pictures.map((a) => ({
                    key: a.id,
                    src: browsingUrl(a, '640'),
                    original: assetUrl(a),
                    shape: photoShape(a),
                    title: a.title,
                    open: () => openImage(a.id),
                  }))}
                  index={albumCarousel.index}
                  bind={albumCarousel.bind}
                />
              </section>
            )}
            {has.archive && (
              <section className="kin-section kin-records-teaser">
                <div className="kin-section-heading">
                  <div>
                    <span className="kin-eyebrow">The archive</span>
                    <h2>Family records</h2>
                  </div>
                  <button
                    className="kin-text-link"
                    onClick={() => go('archive')}
                  >
                    Explore the archive <ArrowRightIcon size={18} />
                  </button>
                </div>
                <p className="kin-records-intro">
                  {site.archiveIntro ||
                    'Documents and records behind the book.'}
                </p>
                {recordPool.length > 0 && (
                  <RecordShelf
                    records={recordPool.map(({ asset, title }) => ({
                      key: asset.id,
                      src: browsingUrl(asset, '640'),
                      original: assetUrl(asset),
                      shape: photoShape(asset),
                      title,
                      open: () => openImage(asset.id),
                    }))}
                    index={recordsCarousel.index}
                    bind={recordsCarousel.bind}
                  />
                )}
                {carouselControls(
                  recordsCarousel,
                  recordPool.length,
                  'records',
                  'records',
                )}
              </section>
            )}
            {book && (
              <section className="kin-book-invite">
                <span className="kin-eyebrow">Read online or download</span>
                <h2>The family book</h2>
                <p>{bookCardLine(has)} Read online or download the PDF.</p>
                <button className="kin-button" onClick={() => go('book')}>
                  Read the book <BookOpenTextIcon size={19} />
                </button>
                <small>
                  Updated {calendarDate(book.editionDate)}
                  {' · '}
                  {book.pages} pages
                </small>
              </section>
            )}
          </>
        )}
        {route.view === 'album' && selectedAlbum && (
          <Album
            key={selectedAlbum.id}
            album={selectedAlbum}
            resolveFile={resolveFile}
            onSource={openSource}
            onPerson={(id) => navigate({ person: id })}
          />
        )}
        {route.view === 'book' && (
          <FamilyBook
            book={book}
            page={Number(route.bookPage) || 0}
            version={route.bookVersion}
            branch={route.branch}
            web={webBook}
            onRefreshEdition={refreshEdition}
            refreshError={error}
            relationLabel={(id) => {
              const r = relationships.get(id);
              return r ? relationText(r) : '';
            }}
            onCorrection={site.sharing ? suggestCorrection : undefined}
            anchor={route.bookAnchor}
            navigation={bookNavigation}
            savedScroll={route.scroll}
            returnFocus={bookReturnFocus}
            data={data}
            onRead={readBook}
            onDocument={openDocument}
            onAlbum={openAlbum}
            noteReference={route.bookNote}
            showRequestedNote={
              !route.record && !route.person && !route.image && !!route.bookNote
            }
            onNoteText={setBookNoteText}
            onDismissNote={(reference) => {
              if (
                !current.current.record &&
                current.current.bookNote === reference
              )
                navigate({ bookNote: '' }, true);
            }}
            highlights={highlights}
            geography={geography}
            onPerson={(id, trigger) => {
              recentTrigger.current = trigger;
              navigate({ person: id, record: '', image: '' });
            }}
            onTree={(id, trigger) => {
              recentTrigger.current = trigger;
              navigate({
                view: 'tree',
                focus: id,
                branch: id,
                person: '',
                record: '',
                image: '',
              });
            }}
            onPlace={(id, trigger) => {
              recentTrigger.current = trigger;
              navigate({
                view: 'places',
                place: id,
                person: '',
                record: '',
                image: '',
              });
            }}
            imageUrl={(path) => previewUrl(path, '1600') || resolveFile(path)}
            onPage={(page, version) =>
              navigate({ bookPage: String(page), bookVersion: version }, true)
            }
          />
        )}
        {route.view === 'people' && (
          <section className="kin-section">
            <div className="kin-page-heading">
              <span className="kin-eyebrow">{branchLabel}</span>
              <h1>Find a family member</h1>
              <p>
                {query.trim()
                  ? `${peopleResults.length} ${peopleResults.length === 1 ? 'match' : 'matches'} among ${focused.people.length} people`
                  : `${focused.people.length} people`}{' '}
                in this branch. Open a profile to see dates, relatives,
                photographs and records.
              </p>
            </div>
            <label className="kin-search">
              <MagnifyingGlassIcon size={21} />
              <input
                aria-label="Search people"
                autoComplete="off"
                placeholder="A first name, a surname, a place…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {peopleResults.length > 0 ? (
              <div className="kin-people-grid">
                {peopleResults.map((p) => personLink(p))}
              </div>
            ) : (
              <output className="kin-empty" style={{ display: 'block' }}>
                No one matches “{query}” in this branch. Try a first name or
                another spelling.
              </output>
            )}
            {outsideResults > 0 && (
              <output className="kin-outside" style={{ display: 'block' }}>
                {outsideResults} more{' '}
                {outsideResults === 1 ? 'match' : 'matches'} in all the family.{' '}
                <button
                  className="kin-text-link"
                  onClick={() => chooseBranch('')}
                >
                  Show all family matches
                </button>
              </output>
            )}
          </section>
        )}
        {route.view === 'treasures' && (
          <section className="kin-section kin-treasures">
            <div className="kin-page-heading">
              <span className="kin-eyebrow">{branchLabel}</span>
              <h1>Family treasures</h1>
              {(homeAlbums.length > 0 || homeRecipes) && (
                <p>{`Family ${wordList(treasureWords('music', 'keepsakes'))}.`}</p>
              )}
            </div>
            {homeAlbums.length > 0 || homeRecipes ? (
              treasureGrid()
            ) : (
              <output className="kin-empty" style={{ display: 'block' }}>
                There are no treasures in this branch yet.{' '}
                <button
                  className="kin-text-link"
                  onClick={() => chooseBranch('')}
                >
                  Show all the family
                </button>
              </output>
            )}
          </section>
        )}
        {route.view === 'news' && (
          <section className="kin-section kin-news">
            <div className="kin-page-heading">
              <span className="kin-eyebrow">
                {currentRelease
                  ? `Version ${currentRelease.version}`
                  : 'Site history'}
              </span>
              <h1>What’s new</h1>
              <p>How the family website has grown, newest first.</p>
            </div>
            <ol className="kin-releases">
              {changelog.map((release) => (
                <li key={release.version}>
                  <h2>
                    Version {release.version}
                    <time dateTime={release.date}>
                      {releaseDate(release.date)}
                    </time>
                  </h2>
                  <ul>
                    {release.changes.map((change) => (
                      <li key={change}>{change}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </section>
        )}
        {route.view === 'photos' && (
          <FamilyAlbum
            data={data}
            memberIds={focus?.anchor ? focus.members : undefined}
            branchLabel={branchLabel}
            referenceId={viewerId}
            section={route.photoSection}
            onSectionChange={(photoSection) => navigate({ photoSection })}
            renderPicture={(entry, orderedAssetIds) =>
              photo(entry.asset, '', orderedAssetIds)
            }
            onPerson={(id) => navigate({ person: id })}
            onOriginals={(asset) => {
              const document = resolveDocument(data, asset.id);
              if (document) openDocument(document, asset.path);
            }}
            onArchive={
              has.archive
                ? () =>
                    navigate({
                      view: 'archive',
                      archiveKind: 'photographs',
                      archiveQuery: '',
                      archivePage: 1,
                    })
                : undefined
            }
          />
        )}
        {route.view === 'archive' && (
          <>
            {book && (
              <button
                className="kin-text-link kin-archive-book-link"
                onClick={() => go('book')}
              >
                <BookOpenTextIcon size={19} /> Read the family book{' '}
                <ArrowRightIcon size={18} />
              </button>
            )}
            <Archive
              data={focused}
              browse={route}
              onBrowse={navigate}
              resolveFile={resolveFile}
              resolvePreview={previewUrl}
              onWholeFamily={
                focus?.anchor
                  ? () =>
                      navigate({
                        branch: '',
                        focus: data.rootId,
                        archivePage: 1,
                      })
                  : undefined
              }
              onDocument={openDocument}
              treasures={treasureSources}
            />
          </>
        )}
        {route.view === 'tree' && (
          <div className="kin-tree-wrap">
            <FamilyTree
              data={data}
              initialFocus={route.focus || route.branch || viewerId}
              onPerson={(id) => navigate({ person: id })}
              onFocus={(id) => navigate({ focus: id }, true)}
              assetUrl={assetUrl}
              previewUrl={(asset) => previewUrl(asset.path, '640')}
              onBack={() => go('home')}
            />
          </div>
        )}
        {route.view === 'places' &&
          (geography ? (
            <Places
              data={focused}
              allData={data}
              geography={geography}
              branchLabel={branchLabel}
              route={route}
              webBook={webBook}
              onNavigate={navigate}
              onPerson={(id) => navigate({ person: id })}
              onRead={readBook}
              onImage={openImage}
              imageUrl={browsingUrl}
              personLink={personLink}
              reducedMotion={!!reduce}
            />
          ) : (
            <section className="kin-section">
              <h1>Places</h1>
              <p className="kin-empty">
                Places didn’t load. Reload the page to try again.
              </p>
              <button className="kin-button" onClick={() => location.reload()}>
                Reload places
              </button>
            </section>
          ))}
      </main>
      {route.view === 'home' && site.sharing && (
        <section className="kin-share-cta">
          <div>
            <h2>Share a photograph or memory</h2>
            <p>
              Send a photograph, document, memory or correction for us to review
              and add to the family history.
            </p>
          </div>
          <button className="kin-button" onClick={() => go('share')}>
            Share something <ArrowRightIcon size={18} />
          </button>
        </section>
      )}
      <footer className="kin-footer">
        <span>
          {data.title}
          <small>{siteContents(has)}</small>
        </span>
        <div>
          {has.photos && (
            <button onClick={() => go('photos')}>Photographs</button>
          )}
          {has.archive && (
            <button onClick={() => go('archive')}>The archive</button>
          )}
          {site.sharing && (
            <button onClick={() => go('share')}>Share something</button>
          )}
          {has.news && <button onClick={() => go('news')}>What’s new</button>}
        </div>
        <p>
          <span>
            Researched and compiled by {site.maintainer.name}
            {currentRelease && (
              <>
                {' ·'}{' '}
                <button
                  className="kin-footer-version"
                  onClick={() => go('news')}
                >
                  Version {currentRelease.version} ·{' '}
                  {releaseDate(currentRelease.date)}
                </button>
              </>
            )}
          </span>
          <span className="kin-footer-end">
            <a href={`mailto:${site.maintainer.email}`}>
              Contact {site.maintainer.firstName}
            </a>
            {site.credit && <FlyleafCredit />}
          </span>
        </p>
      </footer>
      {branchOpen && (
        <Modal
          label="Choose a family branch"
          returnFocus={() => branchTrigger.current}
          fallbackFocus={focusFallback}
          onClose={() => setBranchOpen(false)}
          className="kin-modal"
        >
          <section className="kin-branch-picker">
            <div className="kin-modal-top">
              <span className="kin-eyebrow">Choose a branch</span>
              <button
                aria-label="Close branch selector"
                data-dismiss-modal
                onClick={() => setBranchOpen(false)}
              >
                <XIcon />
              </button>
            </div>
            <h2>Which part of the family?</h2>
            <p>
              Choose a whole side, a grandparent’s branch, or explore everyone.
              Your choice follows you through the site.
            </p>
            <button className="kin-all-branch" onClick={() => chooseBranch('')}>
              <TreeIcon size={24} />
              <span>
                <strong>All the family</strong>
                <small>Browse every branch</small>
              </span>
              {!route.branch ? (
                <CheckIcon size={21} />
              ) : (
                <ArrowRightIcon size={21} />
              )}
            </button>
            <div className="kin-branch-columns">
              {choices.map(({ person, grandparents }) => (
                <div key={person.id}>
                  <button
                    className="kin-parent-branch"
                    onClick={() => chooseBranch(person.id)}
                  >
                    <span>
                      <small>A parent’s side</small>
                      <strong>{person.name}</strong>
                    </span>
                    <ArrowRightIcon size={20} />
                  </button>
                  {grandparents.map((p) => (
                    <button
                      className="kin-grandparent-branch"
                      key={p.id}
                      onClick={() => chooseBranch(p.id)}
                    >
                      <span>
                        <strong>{p.name}</strong>
                        <small>{lifespan(p)}</small>
                      </span>
                      {route.branch === p.id ? (
                        <CheckIcon size={18} />
                      ) : (
                        <ArrowRightIcon size={18} />
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <p className="kin-branch-note">
              You can also choose a branch from any person’s profile. The book
              always includes everyone.
            </p>
          </section>
        </Modal>
      )}
      {route.person && person && (
        <Modal
          label={person.name}
          returnFocus={() => personTrigger.current}
          fallbackFocus={focusFallback}
          onClose={() => navigate({ person: '' }, true)}
          className="kin-modal kin-life-modal"
        >
          <section className="kin-life" ref={profileContent}>
            <div className="kin-modal-top">
              <span className="kin-eyebrow">Family profile</span>
              <button
                aria-label="Close person"
                data-dismiss-modal
                onClick={() => navigate({ person: '' }, true)}
              >
                <XIcon />
              </button>
            </div>
            <div className="kin-life-heading">
              {(() => {
                const a = identifiedPortrait(data, person.id);
                return a ? (
                  <button
                    className="kin-life-portrait"
                    onClick={() => openImage(a.id)}
                  >
                    <BrowsingImage
                      original={assetUrl(a)}
                      src={browsingUrl(a)}
                      alt={portraitDescription(data, a)}
                    />
                  </button>
                ) : null;
              })()}
              <div>
                <h2 tabIndex={-1}>{person.name}</h2>
                {lifespan(person) && <p>{lifespan(person)}</p>}
                {relationship && relationship.kind !== 'self' && (
                  <p className="kin-relationship-path">
                    <strong>{relationText(relationship)}</strong>
                    <br />
                    {relationship.path.map((p, i) => (
                      <span key={`${p.id}-${i}`}>
                        {i > 0 && ' → '}
                        {p.id === person.id ? (
                          p.given.split(' ')[0]
                        ) : (
                          <button
                            className="kin-text-link"
                            onClick={() => navigate({ person: p.id })}
                          >
                            {p.given.split(' ')[0]}
                          </button>
                        )}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </div>
            {focus?.anchor && !focus.members.has(person.id) && (
              <p className="kin-outside">
                You’ve followed a connection beyond {branchLabel}. Your selected
                branch is still saved.
              </p>
            )}
            <button
              className="kin-text-link"
              onClick={() => chooseBranch(person.id)}
            >
              Explore this person’s branch <TreeIcon size={18} />
            </button>
            {person.relationshipNotes.includes('adopted') && (
              <p className="kin-outside">This family includes an adoption.</p>
            )}
            {webBook?.profileIntroductions?.find(
              (intro) => intro.person === person.id,
            ) ? (
              <ProfileIntroduction
                key={person.id + ':' + webBook.sha256}
                introduction={webBook.profileIntroductions.find(
                  (intro) => intro.person === person.id,
                )!}
                data={data}
                sections={webBook.sections}
                onReadBook={readBook}
                onAlbum={openAlbum}
                citationPresentation={webBook.citationPresentation}
                onDocument={(document, note) => {
                  setBookNoteText(note.text);
                  openDocument(
                    document,
                    undefined,
                    webBook.sha256 + ':' + note.anchor,
                  );
                }}
              />
            ) : (
              person.narrative.map((p, i) => (
                <p className="kin-life-intro" key={i}>
                  {p}
                </p>
              ))
            )}
            {webBook && (
              <div className="kin-life-stories">
                {['reg-' + person.id, 'reg-collateral-' + person.id]
                  .filter((a) => webBook.anchors.includes(a))
                  .slice(0, 1)
                  .map((a) => (
                    <button key={a} onClick={() => readBook(a)}>
                      <BookOpenTextIcon size={20} />
                      <span>{bookEntryLabel(person)}</span>
                      <ArrowRightIcon size={19} />
                    </button>
                  ))}
                {webBook.sections
                  .filter(
                    (section) =>
                      section.people.includes(person.id) &&
                      section.chapter.startsWith('ch-') &&
                      // The write-up above already links its own sections.
                      !webBook.profileIntroductions
                        ?.find((intro) => intro.person === person.id)
                        ?.blocks.some((b) => b.section === section.anchor),
                  )
                  .map((section) => (
                    <button
                      key={section.anchor}
                      onClick={() => readBook(section.anchor)}
                    >
                      <BookOpenTextIcon size={20} />
                      <span>{section.title}</span>
                      <ArrowRightIcon size={19} />
                    </button>
                  ))}
              </div>
            )}
            <FamilyCollections
              data={data}
              personId={person.id}
              onSource={openSource}
            />
            {albums
              .filter((a) => a.person === person.id)
              .map((album) => (
                <section className="kin-music-profile" key={album.id}>
                  <h3>Music</h3>
                  <AlbumLink
                    album={album}
                    resolveFile={resolveFile}
                    onOpen={openAlbum}
                  />
                </section>
              ))}
            <PersonGallery
              data={data}
              personId={person.id}
              renderPicture={({ asset }, orderedAssetIds) =>
                photo(asset, '', orderedAssetIds)
              }
            />
            {person.associations?.length ? (
              <div className="kin-record-associations">
                <h3>Other connections</h3>
                {person.associations.map((a) => (
                  <div key={a.id}>
                    <p>{a.label}</p>
                    {data.people.find((p) => p.id === a.id) &&
                      personLink(data.people.find((p) => p.id === a.id)!)}
                  </div>
                ))}
              </div>
            ) : null}
            {(['parents', 'partners', 'children', 'siblings'] as const).some(
              (key) => person[key].length > 0,
            ) && <h3>Family connections</h3>}
            {(['parents', 'partners', 'children', 'siblings'] as const).map(
              (key) =>
                key === 'partners'
                  ? ['Spouses', 'Partners'].map((heading) => {
                      const unions = profileUnions(data, person.id).filter(
                        (union) => union.married === (heading === 'Spouses'),
                      );
                      return (
                        unions.length > 0 && (
                          <div className="kin-relationship-group" key={heading}>
                            <h4>{heading}</h4>
                            {unions.map((union) => (
                              <div key={union.familyId + ':' + union.person.id}>
                                {personLink(union.person, false)}
                                <p>
                                  {[union.role, union.summary]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </p>
                                {(union.research.length > 0 ||
                                  union.details.length > 0) && (
                                  <details className="kin-union-research">
                                    <summary>Sources</summary>
                                    {union.details.map((detail) => (
                                      <p key={detail}>{detail}</p>
                                    ))}
                                    {union.research.map((evidence) => (
                                      <div key={evidence.useId}>
                                        <p>
                                          <strong>
                                            {evidence.sourceLabel}
                                          </strong>
                                        </p>
                                        {evidence.locator && (
                                          <p>{evidence.locator}</p>
                                        )}
                                        {evidence.notes.map((note, index) => (
                                          <p key={index}>{note}</p>
                                        ))}
                                        <button
                                          className="kin-text-link"
                                          onClick={() => {
                                            const source = data.sources.find(
                                              (entry) =>
                                                entry.id === evidence.sourceId,
                                            );
                                            if (source)
                                              openSource(
                                                source,
                                                undefined,
                                                evidence.useId,
                                              );
                                          }}
                                        >
                                          View source{' '}
                                          <ArrowRightIcon size={18} />
                                        </button>
                                      </div>
                                    ))}
                                  </details>
                                )}
                              </div>
                            ))}
                          </div>
                        )
                      );
                    })
                  : person[key].length > 0 && (
                      <div className="kin-relationship-group" key={key}>
                        <h4>{key[0].toUpperCase() + key.slice(1)}</h4>
                        {person[key]
                          .map((id) => data.people.find((p) => p.id === id))
                          .filter((p): p is Person => !!p)
                          .map((p) => personLink(p, false))}
                      </div>
                    ),
            )}
            <button
              className="kin-detail-toggle"
              aria-expanded={readMore}
              onClick={() => setReadMore(!readMore)}
            >
              {readMore ? 'Less detail' : 'Dates, events and sources'}
              <CaretDownIcon size={19} />
            </button>
            {readMore && (
              <>
                <div className="kin-life-timeline">
                  {[...person.events]
                    .sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity))
                    .map((e) => (
                      <div key={e.id}>
                        <time>
                          {e.date ? formatGedcomDate(e.date) : 'Undated'}
                        </time>
                        <span>
                          <strong>{profileEventLabel(e, data.people)}</strong>
                          {e.place && <p>{e.place.name}</p>}
                          {e.detail && <p>{e.detail}</p>}
                        </span>
                      </div>
                    ))}
                </div>
                <details className="kin-life-sources">
                  <summary>
                    {person.sourceIds.length}{' '}
                    {person.sourceIds.length === 1
                      ? 'source reference'
                      : 'source references'}
                  </summary>
                  {person.sourceIds
                    .map((id) => data.sources.find((s) => s.id === id))
                    .filter((s): s is Source => !!s)
                    .map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          const ownUses = (s.uses || []).filter((use) =>
                            use.placements.some((p) =>
                              p.people.includes(person.id),
                            ),
                          );
                          openSource(
                            s,
                            undefined,
                            ownUses.length === 1 ? ownUses[0].id : '',
                          );
                        }}
                      >
                        {s.label}
                        <ArrowRightIcon size={17} />
                      </button>
                    ))}
                </details>
              </>
            )}
            {site.sharing && (
              <p className="kin-life-correction">
                See something wrong?{' '}
                <button
                  className="kin-text-link"
                  onClick={() => suggestCorrection(person.id)}
                >
                  Suggest a correction <PencilSimpleLineIcon size={17} />
                </button>
              </p>
            )}
          </section>
        </Modal>
      )}
      {image && (
        <FamilyImageViewer
          data={data}
          image={image}
          orderedAssetIds={imageScope}
          resolveFile={resolveFile}
          onSelect={(id) => navigate({ image: id }, true)}
          onPerson={(id) => navigate({ person: id, image: '' })}
          onSource={openSource}
          returnFocus={() => imageTrigger.current}
          fallbackFocus={focusFallback}
          onClose={() => navigate({ image: '' }, true)}
        />
      )}
      {source && (
        <DocumentViewer
          key={`${source.id}:${route.file}`}
          source={source}
          returnFocus={() => recordTrigger.current}
          fallbackFocus={focusFallback}
          visualData={data}
          onPerson={(id) => navigate({ person: id, record: '', image: '' })}
          bookNote={route.bookNote ? bookNoteText : ''}
          citationPresentation={webBook?.citationPresentation}
          citationChoices={
            route.branch || person
              ? citationUsesInScope(
                  source.uses || [],
                  focus!.members,
                  new Set(
                    focused!.chapters.flatMap((chapter) =>
                      chapter.sections.map(
                        (section) => `${chapter.id}/${section.id}`,
                      ),
                    ),
                  ),
                  person?.id,
                )
              : source.uses || []
          }
          citationPeople={data!.people}
          citationScopeLabel={person?.name || branchLabel}
          onCitationUse={(citationUse) => navigate({ citationUse })}
          relatedSources={data!.sources.filter(
            (s) => source.sourceIds.includes(s.id) && s.id !== source.id,
          )}
          onSource={openSource}
          resolveFile={resolveFile}
          onFile={(file) => navigate({ file })}
          onClose={() =>
            navigate({ record: '', file: '', citationUse: '' }, true)
          }
        />
      )}
    </div>
  );
}
