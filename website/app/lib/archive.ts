import type {
  ArchiveFile,
  Asset,
  AtlasData,
  Source,
  Representation,
} from './gedcom.ts';
import { connectedFiles } from './representations.ts';
import type { CitationUse } from './citation-uses.ts';
import { visualFor, visualPeople } from './visuals.ts';

export const archiveFilters = {
  all: 'All',
  photographs: 'Photographs',
  images: 'Images',
  pdfs: 'PDFs',
  books: 'Books',
  audio: 'Audio',
  text: 'Text & indexes',
} as const;
export type ArchiveFilter = keyof typeof archiveFilters;
export type ArchiveBrowseState = {
  archiveQuery: string;
  archiveKind: ArchiveFilter;
  archivePage: number;
};

/** A viewer context is either a citation or a held family attachment. An
 * attachment without a citation must never become an invented Source. */
export interface ArchiveDocument {
  id: string;
  context: 'source' | 'attachment' | 'book-illustration';
  label: string;
  url: string;
  locator: string;
  note: string;
  archives: ArchiveFile[];
  sourceIds: string[];
  representations?: Representation[];
  /** What every file in a group of versions is known to come from: one
   * record that holds each original, or one original file. */
  origin?: 'one-record' | 'one-original';
  citationFilePaths?: string[];
  researchOnly?: boolean;
  uses?: CitationUse[];
  selectedUse?: CitationUse;
  unavailableUse?: boolean;
}
export const sourceDocument = (source: Source): ArchiveDocument => ({
  ...source,
  context: 'source',
  sourceIds: [source.id],
  citationFilePaths: source.archives.map((f) => f.path),
});
function versionDocument(relation: Representation): ArchiveDocument {
  return {
    id: relation.id,
    context: 'attachment',
    label: 'Related archive files',
    url: '',
    locator: '',
    note: '',
    sourceIds: [],
    archives: [relation.child, relation.parent].map((path) => ({
      path,
      kind: '',
      nature: '',
      locator: '',
      status: '',
    })),
  };
}
function sourceFileIndex(data: AtlasData): Map<string, ArchiveFile[]> {
  const index = new Map(data.sources.map((s) => [s.id, [...s.archives]]));
  for (const asset of data.assets)
    for (const id of asset.sourceIds || []) {
      const files = index.get(id);
      if (files && !files.some((f) => f.path === asset.path))
        files.push({
          path: asset.path,
          title: asset.title,
          note: asset.credit,
          kind: asset.kind || '',
          nature: '',
          locator: '',
          status: '',
        });
    }
  return index;
}
export function connectedDocument(
  data: AtlasData,
  document: ArchiveDocument,
  selectedPath?: string,
): ArchiveDocument {
  // Reviewed file captions also name intermediate versions which have no
  // native FILE title. Keep source-specific titles and the original paths.
  const describedFiles = document.archives.map((file) => {
    const title = file.title || visualFor(data, file.path)?.title;
    return title ? { ...file, title } : { ...file };
  });
  const relations = data.representations || [];
  const paths = connectedFiles(
    relations,
    document.archives.map((f) => f.path),
  );
  const related = relations.filter(
    (r) => paths.has(r.parent) && paths.has(r.child),
  );
  if (!related.length) return { ...document, archives: describedFiles };
  const citationFiles = sourceFileIndex(data);
  const files = new Map(describedFiles.map((f) => [f.path, f]));
  for (const source of data.sources)
    for (const file of citationFiles.get(source.id) || []) {
      if (!paths.has(file.path)) continue;
      const existing = files.get(file.path);
      if (!existing) files.set(file.path, { ...file });
      else {
        for (const key of [
          'title',
          'note',
          'kind',
          'nature',
          'locator',
          'status',
        ] as const)
          if (!existing[key] && file[key]) existing[key] = file[key];
        if (!existing.page && file.page) existing.page = file.page;
      }
    }
  for (const path of paths) {
    const captions = [
      ...new Set(
        data.assets
          .filter((a) => a.path === path && a.kind === 'book-illustration')
          .map((a) => a.title),
      ),
    ];
    const file = files.get(path) || {
      path,
      kind: captions.length ? 'book-illustration' : '',
      nature: '',
      locator: '',
      status: '',
    };
    if (captions.length) file.bookCaptions = captions;
    const roles = related.filter((r) => r.child === path).map((r) => r.role);
    const role = [
      'composite',
      'crop',
      'page-render',
      'derived',
      'extracted-image',
    ].find((r) => roles.includes(r));
    if (role) file.representationRole = role;
    if (!file.title) file.title = visualFor(data, path)?.title;
    files.set(path, file);
  }
  const selected =
    selectedPath && paths.has(selectedPath)
      ? selectedPath
      : document.archives[0]?.path;
  const citationPaths = connectedFiles(relations, selected ? [selected] : []);
  // The originals are the files not made from another file here. Only when
  // one record holds every original do all the files come from that record.
  const originals = [...paths].filter(
    (path) => !related.some((r) => r.child === path),
  );
  const records = data.sources.filter((s) =>
    citationFiles.get(s.id)?.some((f) => paths.has(f.path)),
  );
  const origin =
    records.length === 1 &&
    originals.every((path) =>
      citationFiles.get(records[0].id)!.some((f) => f.path === path),
    )
      ? 'one-record'
      : originals.length === 1
        ? 'one-original'
        : undefined;
  return {
    ...document,
    archives: [...files.values()],
    representations: related,
    origin,
    sourceIds: data.sources
      .filter((s) =>
        citationFiles.get(s.id)?.some((f) => citationPaths.has(f.path)),
      )
      .map((s) => s.id),
  };
}
/** The line in the document viewer that says where its files come from.
 * It says they come from one record only when that record holds every
 * original file. */
export function provenanceNote(
  document: ArchiveDocument,
  relatedRecords: number,
): string {
  if (document.researchOnly) return 'These files are kept for research.';
  if (document.representations?.length) {
    if (document.origin === 'one-record')
      return 'These files all come from one record. Each keeps its own page number.';
    if (document.sourceIds.length)
      return 'Some of these files were made from others. Each keeps its own page number.';
    return document.origin === 'one-original'
      ? 'These are versions of one picture. No record is linked to them yet.'
      : 'Some of these files were made from others. No record is linked to them yet.';
  }
  if (document.context === 'source')
    return 'Read the reference and notes to see what this record tells us.';
  if (document.context === 'book-illustration')
    return 'This picture appears in the book. Its caption says where it came from.';
  return relatedRecords
    ? 'This file goes with the records above.'
    : 'No record is linked to this file yet.';
}
export function attachmentDocument(
  asset: Asset,
  sources: Source[],
): ArchiveDocument {
  const described = sources
    .flatMap((s) => s.archives)
    .find((f) => f.path === asset.path && (f.nature || f.kind));
  const file: ArchiveFile = described || {
    path: asset.path,
    kind: asset.kind === 'book-illustration' ? 'book-illustration' : '',
    nature: '',
    locator: '',
    status: '',
  };
  return {
    id: asset.id,
    context:
      asset.kind === 'book-illustration' ? 'book-illustration' : 'attachment',
    label: asset.title,
    url: '',
    locator: '',
    note: asset.credit,
    archives: [{ ...file, title: asset.title }],
    sourceIds: [
      ...new Set([
        ...(asset.sourceIds || []),
        ...sources
          .filter((s) => s.archives.some((f) => f.path === asset.path))
          .map((s) => s.id),
      ]),
    ],
  };
}
function baseDocument(
  data: AtlasData,
  id: string,
  filePath?: string,
): ArchiveDocument | null {
  const source = data.sources.find((s) => s.id === id);
  if (source) {
    const archives = sourceFileIndex(data).get(source.id)!;
    const file = archives.find((f) => f.path === filePath) || archives[0];
    const sourceIds = [
      source.id,
      ...data.sources
        .filter((s) => s.archives.some((f) => f.path === file?.path))
        .map((s) => s.id),
      ...data.assets
        .filter((a) => a.path === file?.path)
        .flatMap((a) => a.sourceIds || []),
    ];
    return connectedDocument(
      data,
      {
        ...sourceDocument(source),
        archives,
        citationFilePaths: archives.map((f) => f.path),
        sourceIds: [...new Set(sourceIds)],
      },
      filePath,
    );
  }
  const asset = data.assets.find((a) => a.id === id);
  if (asset)
    return connectedDocument(
      data,
      attachmentDocument(asset, data.sources),
      filePath,
    );
  const relation = data.representations?.find((r) => r.id === id);
  return relation
    ? connectedDocument(data, versionDocument(relation), filePath)
    : null;
}
export function selectCitationUse(
  document: ArchiveDocument,
  id = '',
): ArchiveDocument {
  const base = { ...document };
  delete base.selectedUse;
  delete base.unavailableUse;
  // A stale or other-source selector opens the overview with an explicit
  // explanation. It must never quietly choose another owner's qualification.
  if (!id) return base;
  const selectedUse = base.uses?.find(
    (use) => use.id === id && use.sourceId === base.id,
  );
  return { ...base, selectedUse, unavailableUse: !selectedUse };
}
export function resolveDocument(
  data: AtlasData,
  id: string,
  filePath?: string,
  citationUse = '',
): ArchiveDocument | null {
  const document = baseDocument(data, id, filePath);
  return document ? selectCitationUse(document, citationUse) : null;
}
export function fileTitle(file: ArchiveFile): string {
  return (
    file.title || file.path.split('/').pop()?.replace(/[-_]/g, ' ') || 'File'
  );
}
/** Prefer the held document's descriptive title, then its actual source.
 * A connected file can belong to a different citation from the one opened. */
export function documentTitle(
  document: ArchiveDocument,
  file: ArchiveFile,
  sources: Source[] = [],
): string {
  const filename = file.path.split('/').pop() || '';
  const normalize = (value: string) =>
    value.trim().replace(/[-_]+/g, ' ').toLocaleLowerCase();
  const filenames = [filename, file.path].map(normalize);
  const descriptive = (value = '') =>
    value.trim() && !filenames.includes(normalize(value)) ? value.trim() : '';
  const title = descriptive(file.title);
  if (title) return title;
  if (
    document.context === 'source' &&
    document.citationFilePaths?.includes(file.path)
  ) {
    const label = descriptive(document.label);
    if (label) return label;
  }
  const owner = sources.find((source) =>
    source.archives.some((owned) => owned.path === file.path),
  );
  const ownerTitle = descriptive(owner?.label);
  if (ownerTitle) return ownerTitle;
  // An attachment caption belongs to its explicitly titled FILE. Connected
  // files must not inherit the caption of the attachment originally opened.
  return documentKind(file);
}

/** Keep untitled files from one source distinguishable without treating an
 * original filename or an array position as a historical page number. */
export function documentFileLocator(
  document: ArchiveDocument,
  file: ArchiveFile,
): string {
  if (file.locator) return file.locator;
  if (file.page) return `Page ${file.page}`;
  const paths =
    document.citationFilePaths || document.archives.map((f) => f.path);
  const position = paths.indexOf(file.path);
  return paths.length > 1 && position >= 0
    ? `File ${position + 1} of ${paths.length}`
    : '';
}

export function isImageFile(path: string): boolean {
  return /\.(jpe?g|png|webp|gif|tiff?)$/i.test(path);
}
export function archiveCatalog(data: AtlasData) {
  const sourceOwners = new Map<string, Set<string>>(),
    assetOwners = new Map<string, Set<string>>();
  const associate = (
    map: Map<string, Set<string>>,
    ids: string[],
    names: string[],
  ) => {
    for (const id of ids)
      map.set(id, new Set([...(map.get(id) || []), ...names]));
  };
  for (const person of data.people) {
    associate(sourceOwners, person.sourceIds, [person.name]);
    associate(assetOwners, person.assetIds, [person.name]);
  }
  for (const source of data.sources)
    associate(
      sourceOwners,
      [source.id],
      data.people
        .filter((p) => source.associatedPeople?.includes(p.id))
        .map((p) => p.name),
    );
  for (const section of data.chapters.flatMap((c) => c.sections)) {
    const names = [
      section.title,
      ...data.people
        .filter((p) => section.people.includes(p.id))
        .map((p) => p.name),
    ];
    associate(sourceOwners, section.sourceIds, names);
    associate(assetOwners, section.assetIds, names);
  }
  for (const asset of data.assets)
    associate(sourceOwners, asset.sourceIds || [], [
      ...(assetOwners.get(asset.id) || []),
    ]);

  const entries = new Map<
    string,
    {
      file: ArchiveFile;
      document: ArchiveDocument;
      sourceIds: string[];
      assetIds: string[];
      labels: string[];
      names: string[];
    }
  >();
  for (const source of data.sources)
    for (const file of source.archives) {
      const entry = entries.get(file.path);
      if (entry) {
        entry.sourceIds.push(source.id);
        entry.labels.push(source.label);
        entry.names.push(...(sourceOwners.get(source.id) || []));
        if (
          !entry.file.nature &&
          !entry.file.kind &&
          (file.nature || file.kind)
        ) {
          entry.file = file;
          entry.document = sourceDocument(source);
        }
      } else
        entries.set(file.path, {
          file,
          document: sourceDocument(source),
          sourceIds: [source.id],
          assetIds: [],
          labels: [source.label],
          names: [...(sourceOwners.get(source.id) || [])],
        });
    }
  for (const asset of data.assets) {
    const entry = entries.get(asset.path);
    if (entry) {
      entry.assetIds.push(asset.id);
      entry.labels.push(asset.title);
      entry.names.push(...(assetOwners.get(asset.id) || []));
      if (asset.kind === 'book-illustration') {
        entry.document = attachmentDocument(asset, data.sources);
        entry.file = entry.document.archives[0];
      }
    } else {
      const document = attachmentDocument(asset, data.sources);
      entries.set(asset.path, {
        file: document.archives[0],
        document,
        sourceIds: asset.sourceIds || [],
        assetIds: [asset.id],
        labels: [asset.title],
        names: [...(assetOwners.get(asset.id) || [])],
      });
    }
  }
  for (const relation of data.representations || [])
    for (const path of [relation.parent, relation.child])
      if (!entries.has(path)) {
        const document = versionDocument(relation);
        entries.set(path, {
          file: document.archives.find((f) => f.path === path)!,
          document,
          sourceIds: [],
          assetIds: [],
          labels: [],
          names: [],
        });
      }
  return [...entries.values()]
    .map((entry) => {
      const visual = visualFor(data, entry.file.path);
      const relatedNames = visual
        ? data.people
            .filter((p) => visualPeople(visual).includes(p.id))
            .map((p) => p.name)
        : [];
      return {
        ...entry,
        visual,
        sourceIds: [...new Set(entry.sourceIds)],
        assetIds: [...new Set(entry.assetIds)],
        searchText: [
          fileTitle(entry.file),
          entry.file.path,
          ...entry.labels,
          ...entry.names,
          visual?.title || '',
          visual?.publicNote || '',
          ...(visual?.otherSubjects || []),
          ...relatedNames,
        ]
          .join(' ')
          .toLocaleLowerCase(),
      };
    })
    .sort(
      (a, b) =>
        a.document.label.localeCompare(b.document.label) ||
        fileTitle(a.file).localeCompare(fileTitle(b.file), undefined, {
          numeric: true,
        }),
    );
}

export function archiveGroups(data: AtlasData, filter: ArchiveFilter = 'all') {
  const entries = archiveCatalog(data),
    visited = new Set<string>();
  // One page can contain unrelated photographs. Its complete connected graph
  // is source context, not a declaration that all those pictures are versions.
  if (filter === 'photographs')
    return entries
      .filter((e) => e.visual?.content === 'photograph')
      .map((entry) => ({ ...entry, versions: [entry] }));
  return entries.flatMap((entry) => {
    if (visited.has(entry.file.path)) return [];
    const paths = connectedFiles(data.representations || [], [entry.file.path]);
    for (const path of paths) visited.add(path);
    const versions = entries.filter((e) => paths.has(e.file.path));
    const preferred =
      versions.find((e) => e.document.context === 'book-illustration') || entry;
    return [
      {
        ...preferred,
        versions,
        searchText: versions.map((e) => e.searchText).join(' '),
      },
    ];
  });
}

// A locator that names another archive file links versions together; it is not
// a place in the record, so readers do not see it.
export function readerLocator(locator: string | undefined): string {
  return !locator || locator.trim().startsWith('images/') ? '' : locator;
}

export function documentDescription(file: ArchiveFile): string {
  const description = file.nature.trim();
  // Legacy classification identifiers already have a readable kind label.
  // Descriptive text also carries extent and reading guidance; keep it intact.
  return /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(description) ? '' : description;
}

/** Compressed sound files a browser plays, and full-quality originals. */
export const listeningAudio = /\.(mp3|m4a|aac|ogg|oga|opus)$/i;
export const originalAudio = /\.(wav|flac|aiff?)$/i;
export const isAudioFile = (path: string) =>
  listeningAudio.test(path) || originalAudio.test(path);

export function documentKind(file: ArchiveFile): string {
  const nature = file.nature;
  if (listeningAudio.test(file.path)) return 'Recording';
  if (originalAudio.test(file.path)) return 'Original audio';
  if (file.kind === 'search-capture') return 'Search result';
  // Completeness and derivation qualify the individual file, even when its
  // source is a newspaper, book or primary record.
  if (file.kind === 'record-index')
    return nature.includes('partial') ? 'Part of an index' : 'Index entry';
  if (file.kind === 'record-extraction') return 'Index entry';
  if (file.kind === 'catalogue-record') return 'Library record';
  if (file.kind === 'finding-aid') return 'Collection guide';
  if (nature.includes('partial')) return 'Partial capture';
  if (nature.includes('derivative')) return 'Cropped or edited detail';
  if (nature.includes('index')) return 'Index or profile';
  if (nature.includes('finding-aid')) return 'Collection guide';
  if (nature.includes('transcription') || file.kind === 'transcription')
    return 'Transcription';
  if (file.representationRole === 'composite') return 'Clippings';
  if (file.representationRole === 'crop') return 'Cropped detail';
  if (
    file.representationRole === 'page-render' ||
    nature === 'complete-page-render'
  )
    return 'Full page';
  if (file.representationRole === 'derived') return 'Edited copy';
  if (file.representationRole === 'extracted-image')
    return 'Picture from a page';
  if (file.kind === 'book-illustration') return 'Book illustration';
  if (file.kind === 'newspaper-page') return 'Newspaper page';
  if (file.kind === 'yearbook-page') return 'Yearbook page';
  if (file.kind === 'photograph') return 'Photograph';
  if (file.kind === 'web-page') return 'Saved web page';
  if (nature.includes('authored') || file.kind === 'research-note')
    return 'Research note';
  if (nature === 'complete-published-page') return 'Published page';
  if (nature.includes('complete-published-book') || file.kind === 'book')
    return 'Book';
  if (nature.includes('government')) return 'Government record';
  if (isImageFile(file.path)) return 'Image file';
  if (/\.pdf$/i.test(file.path)) return 'PDF document';
  if (/\.epub$/i.test(file.path)) return 'Electronic book';
  // A static site publishes saved pages as text: page.html.txt.
  if (/\.x?html?(\.txt)?$/i.test(file.path)) return 'Saved web page';
  if (/\.(txt|md|csv|json|xml)$/i.test(file.path)) return 'Text file';
  return 'File';
}

/** Display captured index text without converting it into genealogical facts.
 * The complete saved file stays available separately; unrecognized structures
 * are shown in full rather than silently dropping their fields. */
export function structuredReaderText(content: string, kind: string): string {
  if (kind !== 'record-index') return content;
  try {
    const record: unknown = JSON.parse(content);
    if (record && typeof record === 'object' && !Array.isArray(record)) {
      const fields = ['body', 'text', 'displayed_record_and_source_text'].map(
        (key) => (record as Record<string, unknown>)[key],
      );
      if (
        fields.some((value) => value !== undefined && typeof value !== 'string')
      )
        return content;
      const captured = fields.filter(
        (value): value is string => typeof value === 'string' && !!value.trim(),
      );
      // Saved captures use several field names. Conflicting fields
      // remain visible in the complete JSON rather than choosing one silently.
      if (captured.length && captured.every((value) => value === captured[0]))
        return captured[0];
    }
  } catch {
    // A malformed capture remains readable as its exact saved text.
  }
  return content;
}
export function localFileUrl(base: string, path: string): string {
  if (
    !base ||
    /^(?:[a-z]+:|\/)/i.test(path) ||
    path.split(/[\\/]/).some((part) => part === '..')
  )
    return '';
  return base + path.split('/').map(encodeURIComponent).join('/');
}
export function textFromHtml(html: string): string {
  // Display saved web captures as inert text: no remote images, scripts or styles.
  const stripped = html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(?:p|div|h[1-6]|li|tr|section)>|<br\s*\/?>/gi, '\n\n')
    .replace(/<[^>]*>/g, '');
  const decoder = document.createElement('textarea');
  decoder.innerHTML = stripped;
  return decoder.value
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n(?:\s*\n)+/g, '\n\n')
    .trim();
}

/** The archive's opening order: the family's treasures first (recordings,
 * the recipe book's files, given as its source ids, and files whose path has
 * one of the family's chosen words, site.archive_first), then pictures of and
 * records about the nearest family, then everything else. Research notes and
 * saved searches stay out of this view; the Text filter and search still find
 * them. Entries keep their order within each tier. */
export function familyFirst<
  T extends {
    file: ArchiveFile;
    names: string[];
    sourceIds?: string[];
    visual?: ReturnType<typeof visualFor>;
  },
>(
  entries: readonly T[],
  family: readonly { id: string; name: string }[],
  treasures: ReadonlySet<string> = new Set(),
  firstWords: readonly string[] = [],
): T[] {
  const ids = new Set(family.map((p) => p.id));
  const first = (path: string) =>
    firstWords.some((word) => path.toLowerCase().includes(word.toLowerCase()));
  const names = new Set(family.map((p) => p.name));
  const tier = (entry: T) => {
    const kind = documentKind(entry.file);
    if (
      kind === 'Recording' ||
      kind === 'Original audio' ||
      entry.sourceIds?.some((id) => treasures.has(id)) ||
      first(entry.file.path)
    )
      return 0;
    const photograph = entry.visual?.content === 'photograph';
    if (photograph && visualPeople(entry.visual!).some((id) => ids.has(id)))
      return 1;
    if (entry.names.some((name) => names.has(name))) return 2;
    return photograph ? 3 : 4;
  };
  return entries
    .filter(
      (entry) =>
        !['Research note', 'Search result'].includes(documentKind(entry.file)),
    )
    .map((entry, index) => ({ entry, index, tier: tier(entry) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map(({ entry }) => entry);
}
