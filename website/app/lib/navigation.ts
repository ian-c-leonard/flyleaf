import type { AtlasData } from './gedcom.ts';
import { familyFocus } from './branches.ts';
import {
  archiveFilters,
  resolveDocument,
  type ArchiveBrowseState,
  type ArchiveFilter,
} from './archive.ts';
import { publicBookAnchor, type WebBook } from './native-book.ts';
import { placeFilters, type PlaceFilter } from './places.ts';
import { albumsInEdition } from './albums.ts';
import { albumFilters, type AlbumFilter } from './family-album.ts';
export const destinations = [
  'home',
  'stories',
  'story',
  'people',
  'tree',
  'places',
  'photos',
  'album',
  'treasures',
  'archive',
  'book',
  'share',
  'news',
] as const;
export type Destination = (typeof destinations)[number];
export type Route = ArchiveBrowseState & {
  view: Destination;
  branch: string;
  chapter: string;
  passage: string;
  person: string;
  focus: string;
  /** On the share page: the person a suggested correction is about. */
  correction: string;
  record: string;
  file: string;
  image: string;
  album: string;
  photoSection: AlbumFilter;
  bookPage: string;
  bookVersion: string;
  bookAnchor: string;
  bookNote: string;
  citationUse: string;
  place: string;
  placeQuery: string;
  placeKind: PlaceFilter;
  scroll: number;
};
export const homeRoute: Route = {
  view: 'home',
  branch: '',
  chapter: '',
  passage: '',
  person: '',
  focus: '',
  correction: '',
  record: '',
  file: '',
  image: '',
  album: '',
  photoSection: 'all',
  bookPage: '',
  bookVersion: '',
  bookAnchor: '',
  bookNote: '',
  citationUse: '',
  place: '',
  placeQuery: '',
  placeKind: 'all',
  archiveQuery: '',
  archiveKind: 'all',
  archivePage: 1,
  scroll: 0,
};
export function routeHref(route: Route) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(route))
    if (
      key !== 'scroll' &&
      value &&
      !(key === 'view' && value === 'home') &&
      !(key === 'placeKind' && value === 'all') &&
      !(key === 'photoSection' && value === 'all') &&
      !(key === 'archiveKind' && value === 'all') &&
      !(key === 'archivePage' && value === 1)
    )
      params.set(key, String(value));
  return params.size ? '#' + params.toString() : '#';
}
export function readRoute(
  hash: string,
  data: AtlasData,
  webBook?: WebBook | null,
): Route {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const route = { ...homeRoute };
  const photoSection = params.get('photoSection') || '';
  if (Object.hasOwn(albumFilters, photoSection))
    route.photoSection = photoSection as AlbumFilter;
  route.archiveQuery = (params.get('archiveQuery') || '').slice(0, 120);
  const archiveKind = params.get('archiveKind') || '';
  if (Object.hasOwn(archiveFilters, archiveKind))
    route.archiveKind = archiveKind as ArchiveFilter;
  const archivePage = params.get('archivePage') || '';
  if (/^[1-9]\d{0,3}$/.test(archivePage))
    route.archivePage = Number(archivePage);
  const place = params.get('place') || '';
  if (data.places.some((candidate) => candidate.id === place))
    route.place = place;
  route.placeQuery = (params.get('placeQuery') || '').slice(0, 120);
  const placeKind = params.get('placeKind') || '';
  if (Object.hasOwn(placeFilters, placeKind))
    route.placeKind = placeKind as PlaceFilter;
  const view = params.get('view');
  if (destinations.includes(view as Destination))
    route.view = view as Destination;
  if (route.view === 'album') {
    route.album =
      albumsInEdition(data).find((a) => a.id === params.get('album'))?.id || '';
    if (!route.album) route.view = 'home';
  }
  const bookPage = params.get('bookPage') || '';
  if (/^[1-9]\d{0,5}$/.test(bookPage)) route.bookPage = bookPage;
  const bookVersion = params.get('bookVersion') || '';
  if (/^[a-f0-9]{64}$/.test(bookVersion)) route.bookVersion = bookVersion;
  const bookAnchor = params.get('bookAnchor') || '';
  if (publicBookAnchor(bookAnchor)) route.bookAnchor = bookAnchor;
  const bookNote = params.get('bookNote') || '';
  if (/^[a-f0-9]{64}:(?:loc-|book-note-)[0-9]+$/.test(bookNote))
    route.bookNote = bookNote;
  for (const key of ['branch', 'person', 'focus', 'correction'] as const) {
    const id = params.get(key) || '';
    if (data.people.some((p) => p.id === id)) route[key] = id;
  }
  route.chapter = params.get('chapter') || '';
  route.passage = params.get('passage') || '';
  const chapters = familyFocus(data, route.branch).data.chapters;
  // A deliberate story link can cross a branch boundary (for example through
  // a spouse). Keep that exact pair on reload and Back. Incomplete/stale links
  // fall back within the chosen branch instead of silently selecting elsewhere.
  const explicitChapter = data.chapters.find(
    (c) =>
      c.id === route.chapter && c.sections.some((s) => s.id === route.passage),
  );
  const chapter =
    explicitChapter ||
    chapters.find((c) => c.id === route.chapter) ||
    chapters.find((c) => c.sections.some((s) => s.id === route.passage)) ||
    chapters[0];
  route.chapter = chapter?.id || '';
  route.passage =
    chapter?.sections.find((s) => s.id === route.passage)?.id ||
    chapter?.sections[0]?.id ||
    '';
  if (route.view === 'story' && !chapter) route.view = 'stories';
  if (route.view === 'story' || route.view === 'stories') {
    route.bookAnchor =
      route.view === 'story'
        ? webBook?.legacyRoutes[
            (params.get('chapter') || '') + '/' + (params.get('passage') || '')
          ] || ''
        : '';
    route.view = 'book';
  }
  if (route.view === 'book') {
    const replacement = webBook?.legacyRoutes['bookAnchor/' + route.bookAnchor];
    if (replacement && webBook?.anchors.includes(replacement))
      route.bookAnchor = replacement;
    route.chapter = '';
    route.passage = '';
  }
  const source = resolveDocument(
    data,
    params.get('record') || '',
    params.get('file') || undefined,
  );
  if (source) {
    route.record = source.id;
    route.citationUse = (params.get('citationUse') || '').slice(0, 160);
    route.file =
      source.archives.find((a) => a.path === params.get('file'))?.path ||
      source.archives[0]?.path ||
      '';
  }
  if (data.assets.some((a) => a.id === params.get('image')))
    route.image = params.get('image')!;
  if (route.view !== 'share') route.correction = '';
  return route;
}
