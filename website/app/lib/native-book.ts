import type { AtlasData } from './gedcom.ts';
import {
  validCitationPresentation,
  type CitationPresentation,
} from './citation-presentation.ts';
import { readBookPublication, type BookPublication } from './publication.ts';
import { sha256 } from './previews.ts';
import { resolveDocument, type ArchiveDocument } from './archive.ts';
import type { BookAnnotations } from './book-annotations';
import {
  validProfileIntroductions,
  type ProfileIntroduction,
} from './profile-introductions.ts';
import { sitePath } from './paths.ts';

export type ReadingSection = {
  anchor: string;
  chapter: string;
  level: number;
  title: string;
  excerpt: string;
  opening?: string;
  image: string;
  people: string[];
};
export type WebBook = {
  schema: 1;
  path: string;
  sha256: string;
  bytes: number;
  pdfSha256: string;
  sections: ReadingSection[];
  anchors: string[];
  highlights: string[];
  legacyRoutes: Record<string, string>;
  profileIntroductions?: ProfileIntroduction[];
  citationPresentation?: CitationPresentation[];
};
export type BookCitation = {
  person: string;
  key: string;
  sourcePointer: string | null;
  legacyNotes: string[];
  label: string;
  url: string;
  locators: string[];
  files: string[];
};
export type ReadingAsset = {
  path: string;
  source: string;
  sha256: string;
  bytes: number;
  kind: 'chart' | 'figure';
  width: number;
  height: number;
};
export type WebBookBody = Pick<
  WebBook,
  | 'schema'
  | 'pdfSha256'
  | 'sections'
  | 'anchors'
  | 'highlights'
  | 'legacyRoutes'
  | 'profileIntroductions'
  | 'citationPresentation'
> & {
  html: string;
  citations: BookCitation[];
  assets: ReadingAsset[];
  annotations?: BookAnnotations;
};
const hash = /^[a-f0-9]{64}$/;
export const publicBookAnchor = (value: string) =>
  /^(?:reading-|ch-|nar-|reg-|family-|sources-|chart-)[a-z0-9-]+$/.test(
    value,
  ) ||
  ['ahnentafel', 'bibliography', 'index', 'register-references'].includes(
    value,
  );

export function readWebBook(
  value: unknown,
  gedcomSha256: string,
  book: BookPublication | null,
): WebBook | null {
  if (!book || !value || typeof value !== 'object') return null;
  const index = value as {
    schema?: number;
    gedcomSha256?: string;
    webBook?: WebBook;
  };
  const web = index.webBook;
  if (
    index.schema !== 1 ||
    index.gedcomSha256 !== gedcomSha256 ||
    !web ||
    web.schema !== 1 ||
    !hash.test(web.sha256) ||
    web.path !== `native-book/${web.sha256}.json` ||
    web.pdfSha256 !== book.sha256 ||
    !Number.isSafeInteger(web.bytes) ||
    web.bytes <= 0 ||
    !Array.isArray(web.sections) ||
    !web.sections.length ||
    !Array.isArray(web.anchors) ||
    web.anchors.some((a) => !publicBookAnchor(a)) ||
    new Set(web.anchors).size !== web.anchors.length ||
    !Array.isArray(web.highlights) ||
    !validCitationPresentation(web.citationPresentation ?? []) ||
    !web.legacyRoutes ||
    typeof web.legacyRoutes !== 'object'
  )
    return null;
  const ids = new Set<string>();
  for (const section of web.sections) {
    if (
      !section ||
      !publicBookAnchor(section.anchor) ||
      ids.has(section.anchor) ||
      !publicBookAnchor(section.chapter) ||
      ![2, 3].includes(section.level) ||
      typeof section.title !== 'string' ||
      !section.title.trim() ||
      typeof section.excerpt !== 'string' ||
      (section.opening !== undefined && typeof section.opening !== 'string') ||
      typeof section.image !== 'string' ||
      (section.image &&
        !/^images\/(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^\\]+$/.test(section.image)) ||
      !Array.isArray(section.people) ||
      section.people.some((p) => typeof p !== 'string')
    )
      return null;
    ids.add(section.anchor);
  }
  if (
    web.highlights.some((id) => !ids.has(id)) ||
    new Set(web.highlights).size !== web.highlights.length ||
    Object.values(web.legacyRoutes).some((id) => !ids.has(id)) ||
    !validProfileIntroductions(
      web.profileIntroductions === undefined ? [] : web.profileIntroductions,
      web.anchors,
    )
  )
    return null;
  return web;
}

export async function readWebBookBody(
  bytes: ArrayBuffer,
  web: WebBook,
): Promise<WebBookBody> {
  if (bytes.byteLength !== web.bytes || (await sha256(bytes)) !== web.sha256)
    throw new Error(
      'The book could not be verified. Please reload to get the current edition.',
    );
  const body = JSON.parse(new TextDecoder().decode(bytes)) as WebBookBody;
  if (
    body.schema !== 1 ||
    body.pdfSha256 !== web.pdfSha256 ||
    typeof body.html !== 'string' ||
    !body.html ||
    JSON.stringify(body.sections) !== JSON.stringify(web.sections) ||
    JSON.stringify(body.anchors) !== JSON.stringify(web.anchors) ||
    JSON.stringify(body.highlights) !== JSON.stringify(web.highlights) ||
    JSON.stringify(body.legacyRoutes) !== JSON.stringify(web.legacyRoutes) ||
    JSON.stringify(body.profileIntroductions ?? []) !==
      JSON.stringify(web.profileIntroductions ?? []) ||
    !validProfileIntroductions(
      body.profileIntroductions === undefined ? [] : body.profileIntroductions,
      web.anchors,
    ) ||
    JSON.stringify(body.citationPresentation ?? []) !==
      JSON.stringify(web.citationPresentation ?? []) ||
    !Array.isArray(body.citations) ||
    !validCitationPresentation(
      body.citationPresentation ?? [],
      body.citations,
    ) ||
    !Array.isArray(body.assets)
  )
    throw new Error('The book does not match its contents. Please reload.');
  return body;
}

export async function fetchWebBookBody(
  web: WebBook,
  signal: AbortSignal,
): Promise<WebBookBody | null> {
  const response = await fetch(sitePath('data/') + web.path, { signal });
  if (response.ok) return readWebBookBody(await response.arrayBuffer(), web);
  // An open tab may still hold the contents of an edition retired by a
  // deployment. Refresh the whole collection only when valid, different metadata
  // exists; repeating a missing current path must remain a bounded error.
  if (response.status === 404 || response.status === 410) {
    const current = await fetch(sitePath('data/book.json'), {
      signal,
      cache: 'no-store',
    });
    if (current.ok) {
      const index: unknown = await current.json().catch(() => null);
      if (index && typeof index === 'object' && 'gedcomSha256' in index) {
        const fingerprint = index.gedcomSha256;
        if (typeof fingerprint === 'string' && hash.test(fingerprint)) {
          const pdf = readBookPublication(index, fingerprint);
          const replacement = readWebBook(index, fingerprint, pdf);
          if (replacement && replacement.sha256 !== web.sha256) return null;
        }
      }
    }
  }
  throw new Error('The book could not be opened. Please try again.');
}

/** The chapter of the web book whose title the family names for the "About
 * the research" tab (book.research_tab), or '' when it has none. */
export function researchChapterOf(web: WebBook | null, title: string) {
  if (!web || !title.trim()) return '';
  const words = (text: string) => text.split(/\s+/).filter(Boolean).join(' ');
  return (
    web.sections.find(
      (section) => section.level === 2 && words(section.title) === words(title),
    )?.chapter || ''
  );
}

export function chapterHighlights(
  web: WebBook | null,
  people?: Set<string>,
): ReadingSection[] {
  if (!web) return [];
  const selected = web.highlights.flatMap((id) => {
    const section = web.sections.find((s) => s.anchor === id);
    return section && (!people || section.people.some((p) => people.has(p)))
      ? [section]
      : [];
  });
  if (selected.length || !people) return selected;
  // A smaller branch can have a manuscript passage outside the home-page
  // selection. Offer that real passage without inventing a separate story.
  return web.sections
    .filter(
      (s) =>
        s.level === 3 &&
        s.chapter.startsWith('ch-') &&
        s.people.some((p) => people.has(p)),
    )
    .slice(0, 3);
}
export type BookDocument = ArchiveDocument & { bookMatch: 'citation' | 'file' };
export function citationDocuments(
  data: AtlasData,
  citation: BookCitation,
  preferredFile?: string,
): BookDocument[] {
  // Keep this note visible in the book: a shared document context does not
  // replace wording or assessments attached to an individual citation use.
  const result: BookDocument[] = [];
  for (const source of data.sources) {
    const identity = citation.sourcePointer
      ? source.pointer === citation.sourcePointer
      : source.legacyNotes?.some((note) => citation.legacyNotes.includes(note));
    if (!identity || !citation.locators.includes(source.locator)) continue;
    const document = resolveDocument(data, source.id);
    if (document && document.archives.length) {
      const uses =
        document.uses?.filter(
          (use) =>
            use.owner.people.includes(citation.person) &&
            citation.locators.includes(use.locator) &&
            (citation.sourcePointer
              ? use.sourcePointer === citation.sourcePointer &&
                use.key === citation.key
              : citation.legacyNotes.includes(use.legacyNote)),
        ) || [];
      result.push({
        ...document,
        ...(uses.length === 1 ? { selectedUse: uses[0] } : {}),
        bookMatch: 'citation',
      });
    }
  }
  if (!result.length) {
    // Some preserved notes cite a specific held file now catalogued in a wider
    // record bundle. A file link is not a new claim that these citation contexts
    // are identical. Keep the printed note, and name this control accordingly.
    for (const path of citation.files) {
      const owner =
        data.sources.find((s) => s.archives.some((a) => a.path === path)) ||
        data.assets.find((a) => a.path === path);
      const document = owner ? resolveDocument(data, owner.id, path) : null;
      if (document && !result.some((d) => d.id === document.id))
        result.push({
          ...document,
          bookMatch: 'file',
          archives: [...document.archives].sort(
            (a, b) => Number(b.path === path) - Number(a.path === path),
          ),
        });
    }
  }
  // Only an exact, reviewed citation endpoint may lead the source reader.
  // Keep the complete archive bundle available in its original context.
  return preferredFile && citation.files.includes(preferredFile)
    ? result.map((document) => ({
        ...document,
        archives: [...document.archives].sort(
          (a, b) =>
            Number(b.path === preferredFile) - Number(a.path === preferredFile),
        ),
      }))
    : result;
}
