import { useMemo } from 'react';
import {
  ArrowRightIcon,
  FileTextIcon,
  MagnifyingGlassIcon,
  MusicNotesIcon,
} from '@phosphor-icons/react';
import type { AtlasData } from '../lib/gedcom';
import BrowsingImage from './BrowsingImage';
import { site } from '../lib/settings';
import { visualFor, visualLabel } from '../lib/visuals';
import { immediateFamily } from '../lib/branches';
import {
  archiveCatalog,
  archiveFilters,
  archiveGroups,
  connectedDocument,
  documentKind,
  documentTitle,
  documentFileLocator,
  familyFirst,
  isImageFile,
  isAudioFile,
  type ArchiveDocument,
  type ArchiveBrowseState,
  type ArchiveFilter,
} from '../lib/archive';
export default function Archive({
  data,
  resolveFile,
  resolvePreview,
  onWholeFamily,
  onDocument,
  browse,
  onBrowse,
  treasures,
}: {
  data: AtlasData;
  resolveFile: (path: string) => string;
  resolvePreview: (path: string) => string;
  onWholeFamily?: () => void;
  onDocument: (document: ArchiveDocument) => void;
  browse: ArchiveBrowseState;
  onBrowse: (patch: Partial<ArchiveBrowseState>, replace?: boolean) => void;
  /** The recipe book's sources, shown first. */
  treasures?: ReadonlySet<string>;
}) {
  const {
    archiveQuery: query,
    archiveKind: filter,
    archivePage: page,
  } = browse;
  const limit = page * 24;
  const files = useMemo(() => archiveCatalog(data), [data]);
  const groups = useMemo(() => archiveGroups(data, filter), [data, filter]);
  const terms = query.toLocaleLowerCase().trim().split(/\s+/);
  const matchesType = (file: (typeof files)[number]['file']) => {
    const kind = documentKind(file);
    const matches =
      filter === 'all' ||
      (filter === 'photographs'
        ? visualFor(data, file.path)?.content === 'photograph'
        : filter === 'books'
          ? kind === 'Book' || /\.epub$/i.test(file.path)
          : filter === 'images'
            ? isImageFile(file.path)
            : filter === 'pdfs'
              ? /\.pdf$/i.test(file.path)
              : filter === 'audio'
                ? isAudioFile(file.path)
                : /\.(txt|md|csv|json|xml|html?)$/i.test(file.path) ||
                  [
                    'Transcription',
                    'Research note',
                    'Index or profile',
                  ].includes(kind));
    return matches;
  };
  const family = useMemo(() => immediateFamily(data), [data]);
  const matched = groups.flatMap((group) => {
    const versions = group.versions.filter((entry) => matchesType(entry.file));
    if (
      !versions.length ||
      !terms.every((term) => group.searchText.includes(term))
    )
      return [];
    const entry =
      versions.find((entry) =>
        terms.every((term) => entry.searchText.includes(term)),
      ) || versions[0];
    const preferred =
      !query.trim() && versions.some((v) => v.file.path === group.file.path)
        ? group
        : entry;
    const document = connectedDocument(data, preferred.document);
    return [
      {
        ...preferred,
        document,
        file:
          document.archives.find((f) => f.path === preferred.file.path) ||
          preferred.file,
        versionCount: group.versions.length,
      },
    ];
  });
  const filtered =
    filter === 'all' && !query.trim()
      ? familyFirst(matched, family, treasures, site.archiveFirst)
      : matched;
  return (
    <section className="archive-page">
      <div className="archive-intro">
        <div>
          <h1>The family archive</h1>
          <p>Records, books, photographs and transcriptions.</p>
        </div>
      </div>
      <label className="search-box">
        <MagnifyingGlassIcon size={21} />
        <input
          maxLength={120}
          aria-label="Search the family archive"
          placeholder="Search by person, place or document"
          value={query}
          onChange={(e) => {
            onBrowse({ archiveQuery: e.target.value, archivePage: 1 }, true);
          }}
        />
      </label>
      <div className="archive-filters" aria-label="Document types">
        {(Object.entries(archiveFilters) as [ArchiveFilter, string][]).map(
          ([type, label]) => (
            <button
              key={type}
              aria-pressed={filter === type}
              onClick={() => {
                onBrowse({ archiveKind: type, archivePage: 1 });
              }}
            >
              {label}
            </button>
          ),
        )}
        <span>{filtered.length} items</span>
      </div>
      <div className="archive-grid">
        {filtered.slice(0, limit).map(({ document, file, versionCount }) => {
          const isImage = /\.(jpe?g|png|webp|gif)$/i.test(file.path),
            url = resolvePreview(file.path) || resolveFile(file.path);
          const visual = visualFor(data, file.path);
          const title =
            visual?.title || documentTitle(document, file, data.sources);
          const labels = [
            ...new Set([
              ...(visual ? [visualLabel(visual)] : []),
              ...(!visual ||
              !['Photograph', 'Image file'].includes(documentKind(file))
                ? [documentKind(file)]
                : []),
              ...(visual?.album === 'alternate' ? ['Another version'] : []),
            ]),
          ];
          const locator = documentFileLocator(document, file);
          return (
            <button
              className="archive-record"
              key={file.path}
              onClick={() =>
                onDocument({
                  ...document,
                  archives: [
                    file,
                    ...document.archives.filter((f) => f.path !== file.path),
                  ],
                })
              }
            >
              <div className="archive-thumbnail">
                {isImage && url ? (
                  <BrowsingImage
                    src={url}
                    original={resolveFile(file.path)}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <>
                    {isAudioFile(file.path) ? (
                      <MusicNotesIcon size={38} />
                    ) : (
                      <FileTextIcon size={38} />
                    )}
                    <span>{documentKind(file)}</span>
                  </>
                )}
              </div>
              <div className="archive-record-copy">
                <small>
                  {document.researchOnly && 'Research notes · '}
                  {labels.join(' · ')}
                  {versionCount > 1 && ` · ${versionCount} versions`}
                </small>
                <span className="archive-record-title">{title}</span>
                {visual?.publicNote && <p>{visual.publicNote}</p>}
                {locator && !title.includes(locator) && (
                  <p className="archive-file-locator">{locator}</p>
                )}
                {document.context === 'source' && document.label !== title && (
                  <p className="archive-source-title">{document.label}</p>
                )}
                <span>
                  View document
                  <ArrowRightIcon size={16} />
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {filtered.length > limit && (
        <button
          className="archive-more"
          onClick={() => onBrowse({ archivePage: page + 1 })}
        >
          Show more documents
        </button>
      )}
      {!filtered.length && (
        <div className="empty-note">
          <p>
            {files.length
              ? 'No matching documents. Try a surname or a different spelling.'
              : 'No documents yet.'}
          </p>
          {onWholeFamily && (
            <button className="archive-more" onClick={onWholeFamily}>
              Search the whole family
            </button>
          )}
        </div>
      )}
    </section>
  );
}
