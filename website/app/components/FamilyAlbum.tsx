import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowRightIcon,
  CaretDownIcon,
  FilesIcon,
  MagnifyingGlassIcon,
  XIcon,
} from '@phosphor-icons/react';
import type { Asset, AtlasData } from '../lib/gedcom';
import {
  albumMatches,
  albumCollection,
  albumFilters,
  albumPeriods,
  albumSections,
  familyAlbum,
  type AlbumFilter,
  type AlbumPeriod,
  type AlbumView,
  type FamilyAlbumEntry,
} from '../lib/family-album';
import '../family-album.css';

export interface FamilyAlbumProps {
  data: AtlasData;
  memberIds?: ReadonlySet<string>;
  branchLabel: string;
  referenceId?: string;
  section: AlbumFilter;
  onSectionChange: (section: AlbumFilter) => void;
  renderPicture: (view: AlbumView, orderedAssetIds: string[]) => ReactNode;
  onPerson: (id: string) => void;
  onOriginals: (asset: Asset) => void;
  /** Opens the archive; absent when the family's archive is empty. */
  onArchive?: () => void;
}
const descriptions: Record<AlbumFilter, string> = {
  all: 'Photographs, portraits, artwork and places from across the family album.',
  occasions: 'Weddings, graduations, holidays and other family gatherings.',
  family: 'Portraits and groups of family members.',
  captioned: 'Group photographs with relatives named in their captions.',
  artwork:
    'Painted portraits, cartoons and other artwork connected with the family.',
  places: 'Homes, gardens, objects and memorials connected with the family.',
  context: 'More photographs connected with the family.',
};
function AlbumCard({
  entry,
  orderedAssetIds,
  data,
  renderPicture,
  onPerson,
  onOriginals,
}: Pick<
  FamilyAlbumProps,
  'data' | 'renderPicture' | 'onPerson' | 'onOriginals'
> & { entry: FamilyAlbumEntry; orderedAssetIds: string[] }) {
  const [viewsOpen, setViewsOpen] = useState(false);
  const visual = entry.visual;
  // Family portraits and occasion photographs name the people pictured.
  const pictured =
    entry.section === 'family' ||
    (entry.section === 'occasions' && visual.subjectIds.length > 0);
  const connectionIds = pictured
    ? visual.subjectIds
    : entry.section === 'captioned'
      ? visual.captionPeople
      : entry.peopleIds;
  const people = data.people.filter((person) =>
    connectionIds.includes(person.id),
  );
  return (
    <article className={`family-album-card family-album-${visual.role}`}>
      {renderPicture(entry, orderedAssetIds)}
      {people.length > 0 && (
        <div className="family-album-connections">
          <span>
            {pictured
              ? 'Pictured'
              : entry.section === 'captioned'
                ? 'Named in the caption'
                : visual.role === 'memorial'
                  ? 'Remembered or related'
                  : 'Related people'}
          </span>
          <div>
            {people.map((person) => (
              <button key={person.id} onClick={() => onPerson(person.id)}>
                {person.name}
                <ArrowRightIcon size={14} />
              </button>
            ))}
          </div>
        </div>
      )}
      {entry.captionYears.length > 0 && (
        <p className="family-album-caption-year">
          {entry.captionYears.join(', ')}
        </p>
      )}
      <button
        className="family-album-originals"
        onClick={() => onOriginals(entry.asset)}
      >
        <FilesIcon size={17} />
        Where this came from
        <ArrowRightIcon size={15} />
      </button>
      {entry.views.length > 1 && (
        <details
          className="family-album-views"
          onToggle={(event) => setViewsOpen(event.currentTarget.open)}
        >
          <summary>Other versions ({entry.views.length - 1})</summary>
          {viewsOpen && (
            <div>
              {entry.views
                .filter((view) => view.asset.id !== entry.asset.id)
                .map((view) => (
                  <div key={view.asset.id}>
                    <p className="family-album-view-kind">
                      {view.combined
                        ? 'Combined layout'
                        : view.visual.role === 'portrait' &&
                            entry.visual.role === 'group'
                          ? 'Portrait detail'
                          : view.visual.album === 'alternate'
                            ? 'Alternate view'
                            : 'Detail view'}
                    </p>
                    {renderPicture(
                      view,
                      entry.views.map((item) => item.asset.id),
                    )}
                    <button
                      className="family-album-originals"
                      onClick={() => onOriginals(view.asset)}
                    >
                      See the original
                      <ArrowRightIcon size={15} />
                    </button>
                  </div>
                ))}
            </div>
          )}
        </details>
      )}
    </article>
  );
}

export default function FamilyAlbum(props: FamilyAlbumProps) {
  // A new family selection clears its local person, period and search controls.
  // The collection choice remains explicit in the route for reload and Back.
  const selectionKey = props.memberIds
    ? [...props.memberIds].sort().join('|')
    : 'all';
  return <SelectedFamilyAlbum key={selectionKey} {...props} />;
}

function SelectedFamilyAlbum({
  data,
  memberIds,
  branchLabel,
  referenceId,
  section,
  onSectionChange,
  renderPicture,
  onPerson,
  onOriginals,
  onArchive,
}: FamilyAlbumProps) {
  const entries = useMemo(
    () => familyAlbum(data, memberIds, referenceId),
    [data, memberIds, referenceId],
  );
  const [query, setQuery] = useState('');
  const [personId, setPersonId] = useState('');
  const [period, setPeriod] = useState<AlbumPeriod>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const baselineCounts = Object.fromEntries(
    Object.keys(albumSections).map((key) => [
      key,
      entries.filter((entry) => entry.section === key).length,
    ]),
  );
  const availablePeople = useMemo(() => {
    const ids = new Set(entries.flatMap((entry) => entry.peopleIds));
    return data.people
      .filter((person) => ids.has(person.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, entries]);
  const filtered = useMemo(
    () =>
      entries.filter((entry) =>
        albumMatches(data, entry, { query, personId, period }),
      ),
    [data, entries, query, personId, period],
  );
  const counts = Object.fromEntries(
    Object.keys(albumSections).map((key) => [
      key,
      filtered.filter((entry) => entry.section === key).length,
    ]),
  );
  const shown = albumCollection(filtered, section);
  const clear = () => {
    setQuery('');
    setPersonId('');
    setPeriod('all');
  };
  const hasFilters = !!query || !!personId || period !== 'all';
  return (
    <section className="family-album kin-section">
      <header className="family-album-heading kin-page-heading">
        <span className="kin-eyebrow">{branchLabel}</span>
        <h1>Family album</h1>
        <p>Family portraits and photographs, with where each came from.</p>
      </header>
      <div className="family-album-controls">
        <label className="family-album-search">
          <MagnifyingGlassIcon size={19} />
          <span className="sr-only">Search the family album</span>
          <input
            type="text"
            aria-label="Search the family album"
            placeholder="A person, place or caption…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear album search"
            >
              <XIcon size={18} />
            </button>
          )}
        </label>
        <button
          className="family-album-filter-toggle"
          aria-expanded={filtersOpen}
          aria-controls="family-album-filters"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          Filters
          {(personId || period !== 'all') && (
            <span>{Number(!!personId) + Number(period !== 'all')} active</span>
          )}
          <CaretDownIcon size={17} />
        </button>
      </div>
      <div
        id="family-album-filters"
        className="family-album-filters"
        hidden={!filtersOpen}
      >
        <label className="family-album-select">
          <span>Person</span>
          <select
            aria-label="Filter by person"
            value={personId}
            onChange={(event) => setPersonId(event.target.value)}
          >
            <option value="">Everyone in this album</option>
            {availablePeople.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        {entries.some((entry) => entry.captionYears.length) && (
          <label className="family-album-select">
            <span>Year</span>
            <select
              aria-label="Year"
              value={period}
              onChange={(event) => setPeriod(event.target.value as AlbumPeriod)}
            >
              {Object.entries(albumPeriods).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <nav className="family-album-sections" aria-label="Album collections">
        {(Object.keys(albumFilters) as AlbumFilter[])
          .filter(
            (key) =>
              key === 'all' ||
              key === 'family' ||
              key === section ||
              baselineCounts[key] > 0,
          )
          .map((key) => (
            <button
              key={key}
              onClick={() => onSectionChange(key)}
              aria-pressed={section === key}
            >
              {albumFilters[key]}
              <span>{key === 'all' ? filtered.length : counts[key]}</span>
            </button>
          ))}
      </nav>
      <div className="family-album-results-heading">
        <div>
          <h2>{albumFilters[section]}</h2>
          <p>{descriptions[section]}</p>
        </div>
        {hasFilters && (
          <button className="family-album-reset" onClick={clear}>
            Clear filters
            <XIcon size={15} />
          </button>
        )}
      </div>
      {period !== 'all' && (
        <p className="family-album-period-note">
          Years come from captions. Some show when a picture was published. When
          it was taken may be unknown.
        </p>
      )}
      <output className="family-album-count">
        {shown.length} {shown.length === 1 ? 'image' : 'images'}
        {hasFilters ? ' matching your filters' : ''}
      </output>
      {shown.length > 0 ? (
        <div className="family-album-grid">
          {shown.map((entry) => (
            <AlbumCard
              key={entry.id}
              entry={entry}
              orderedAssetIds={shown.map((item) => item.asset.id)}
              data={data}
              renderPicture={renderPicture}
              onPerson={onPerson}
              onOriginals={onOriginals}
            />
          ))}
        </div>
      ) : (
        <div className="family-album-empty">
          <p>
            {hasFilters
              ? 'No pictures in this collection match your filters.'
              : section === 'family'
                ? 'No family portraits for this branch yet.'
                : 'No pictures in this collection for this branch yet.'}
          </p>
          {section !== 'all' &&
            filtered.some((entry) => entry.section !== section) && (
              <p>
                Other collections have{' '}
                {filtered.filter((entry) => entry.section !== section).length}{' '}
                related images. Choose a collection above to see them.
              </p>
            )}
        </div>
      )}
      {onArchive && (
        <footer className="family-album-footer">
          <p>The archive has scans of the original records.</p>
          <button onClick={onArchive}>
            Browse the archive
            <ArrowRightIcon size={18} />
          </button>
        </footer>
      )}
    </section>
  );
}
