import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  DismissParent,
  useDismissible,
  useMediaQuery,
} from '../lib/useDismissible';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookOpenTextIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  XIcon,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import type { Asset, AtlasData, Person } from '../lib/gedcom';
import {
  fetchWebBookBody,
  type WebBook,
  type WebBookBody,
} from '../lib/native-book';
import { readerQualification } from '../lib/book-annotations';
import {
  listedPlaces,
  placePortraits,
  placeStories,
  type PlaceStory,
} from '../lib/place-stories';
import { portraitDescription, visualLabel } from '../lib/visuals';
import { formatGedcomDate } from '../lib/date-display';
import {
  buildPlaceIndex,
  eventMatches,
  placeFilters,
  placePeriod,
  requestedPlaceSelection,
} from '../lib/places';
import type { Geography, PlaceFilter, PlaceReading } from '../lib/places';
import { homeRoute, type Route } from '../lib/navigation';
import BrowsingImage from './BrowsingImage';
import readingConnections from '@content/place-readings.json';
import { sitePath } from '../lib/paths';
const PlacesMap = lazy(() => import('./PlacesMap'));

export default function Places({
  data,
  allData,
  geography,
  branchLabel,
  route,
  webBook,
  onNavigate,
  onPerson,
  onRead,
  onImage,
  imageUrl,
  personLink,
  reducedMotion,
}: {
  data: AtlasData;
  allData: AtlasData;
  geography: Geography;
  branchLabel: string;
  route: Route;
  webBook: WebBook | null;
  onNavigate: (patch: Partial<Route>, replace?: boolean) => void;
  onPerson: (id: string) => void;
  onRead: (anchor: string) => void;
  onImage: (id: string, orderedAssetIds: string[]) => void;
  imageUrl: (asset: Asset) => string;
  personLink: (person: Person) => ReactNode;
  reducedMotion: boolean;
}) {
  const [bookState, setBookState] = useState<{
    version: string;
    body: WebBookBody | null;
    failed: boolean;
  }>({ version: '', body: null, failed: false });
  const [bookAttempt, setBookAttempt] = useState(0);
  useEffect(() => {
    if (!webBook) return;
    const controller = new AbortController();
    setBookState({ version: webBook.sha256, body: null, failed: false });
    void fetchWebBookBody(webBook, controller.signal)
      .then((body) => {
        if (!controller.signal.aborted)
          setBookState({ version: webBook.sha256, body, failed: !body });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setBookState({ version: webBook.sha256, body: null, failed: true });
      });
    return () => controller.abort();
  }, [webBook, bookAttempt]);
  const bookBody =
    bookState.version === webBook?.sha256 ? bookState.body : null;
  const bookFailed = bookState.version === webBook?.sha256 && bookState.failed;
  const baseGroups = useMemo(
    () =>
      buildPlaceIndex(
        data,
        geography,
        readingConnections as PlaceReading[],
        webBook,
      ),
    [data, geography, webBook],
  );
  const storiesByGroup = useMemo(
    () =>
      new Map(
        baseGroups.map((group) => [
          group.id,
          placeStories(data, group, bookBody),
        ]),
      ),
    [data, baseGroups, bookBody],
  );
  const groups = useMemo(
    () =>
      baseGroups.map((group) => ({
        ...group,
        people: [
          ...new Map(
            [
              ...group.people,
              ...(storiesByGroup.get(group.id)?.people || []),
            ].map((person) => [person.id, person]),
          ).values(),
        ],
      })),
    [baseGroups, storiesByGroup],
  );
  const filtered = useMemo(
    () =>
      listedPlaces(
        data,
        groups,
        storiesByGroup,
        route.placeQuery,
        route.placeKind,
      ),
    [data, groups, storiesByGroup, route.placeQuery, route.placeKind],
  );
  const allGroups = useMemo(
    () =>
      allData === data
        ? groups
        : buildPlaceIndex(
            allData,
            geography,
            readingConnections as PlaceReading[],
            webBook,
          ).map((group) => ({
            ...group,
            people: [
              ...new Map(
                [
                  ...group.people,
                  ...placeStories(allData, group, bookBody).people,
                ].map((person) => [person.id, person]),
              ).values(),
            ],
          })),
    [allData, data, groups, geography, webBook, bookBody],
  );
  const { selected, outsideBranch } = requestedPlaceSelection(
    groups,
    allGroups,
    route.place,
    geography,
  );
  const mapGroups = useMemo(
    () =>
      outsideBranch && selected
        ? [
            ...filtered.filter(
              (group) =>
                group.id !== selected.id &&
                (!selected.location ||
                  group.location?.id !== selected.location.id),
            ),
            selected,
          ]
        : filtered,
    [filtered, outsideBranch, selected],
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const indexHeading = useRef<HTMLHeadingElement>(null);
  const previous = useRef(route.place);
  const [mapOpen, setMapOpen] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(min-width: 900px)').matches,
  );
  const mapPanel = useRef<HTMLDivElement>(null);
  const mapTrigger = useRef<HTMLButtonElement>(null);
  const smallMap = useMediaQuery('(max-width: 899px)');
  const mapLayer = useDismissible({
    enabled: smallMap && mapOpen,
    consumeOutside: true,
    root: () => mapPanel.current,
    inside: () => [mapPanel.current],
    trigger: () => mapTrigger.current,
    fallback: () => indexHeading.current,
    onDismiss: () => setMapOpen(false),
  });
  useEffect(() => {
    if (previous.current !== route.place) {
      const target = selected ? heading.current : indexHeading.current;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
    previous.current = route.place;
  }, [route.place, selected]);
  const events =
    selected?.events.filter((entry) =>
      eventMatches(entry.event, route.placeKind),
    ) || [];
  const selectedData = outsideBranch ? allData : data;
  const stories = useMemo(
    () => (selected ? placeStories(selectedData, selected, bookBody) : null),
    [selectedData, selected, bookBody],
  );
  const photographs = useMemo(
    () => placePortraits(selectedData, selected?.people || []),
    [selectedData, selected],
  );
  const storyQualifications = [
    ...new Set(stories?.direct.flatMap((story) => story.qualifications) || []),
  ];
  const readStory = (story: PlaceStory) => (
    <button
      key={story.section.anchor}
      onClick={() => onRead(story.section.anchor)}
    >
      <BookOpenTextIcon size={21} />
      <span>
        <strong>{story.section.title}</strong>
        <small>
          {webBook?.sections.find(
            (section) => section.anchor === story.section.chapter,
          )?.title || 'From the book'}
        </small>
        {story.names.length > 0 && (
          <small>Mentions: {story.names.join(' · ')}</small>
        )}
        {story.people.length > 0 && (
          <small>
            People in this section:{' '}
            {story.people.map((person) => person.name).join(', ')}
          </small>
        )}
      </span>
      <ArrowRightIcon size={19} />
    </button>
  );
  const showPortrait = ({ asset, visual }: (typeof photographs)[number]) => (
    <button
      key={asset.id}
      onClick={() =>
        onImage(
          asset.id,
          photographs.map((view) => view.asset.id),
        )
      }
    >
      <BrowsingImage
        src={imageUrl(asset)}
        original={sitePath('data/') + asset.path}
        alt={portraitDescription(selectedData, asset)}
        loading="lazy"
      />
      <span>{visual?.title}</span>
      <span className="place-section-note">{visualLabel(visual)}</span>
    </button>
  );
  const located = groups.filter((group) => group.location).length;
  const hasMappedResults = mapGroups.some((group) => group.location);
  const canShowFamilyPlaces = allGroups.some((group) => group.location);
  const clearPlaceFilters = {
    place: homeRoute.place,
    placeQuery: homeRoute.placeQuery,
    placeKind: homeRoute.placeKind,
  };
  const select = (id: string) => onNavigate({ place: id });
  return (
    <section className="kin-section places-page">
      <header className="kin-page-heading places-heading">
        <span className="kin-eyebrow">{branchLabel}</span>
        <h1>Places in our family history</h1>
        <p>
          The towns and neighborhoods where the family lived. Choose a place to
          meet its people.
        </p>
        <div className="places-overview">
          <span>
            <strong>{groups.length}</strong> places and areas
          </span>
          <span>
            <strong>
              {
                new Set(
                  groups.flatMap((group) =>
                    group.people.map((person) => person.id),
                  ),
                ).size
              }
            </strong>{' '}
            family members
          </span>
          <span>
            <strong>{located}</strong> on the map
          </span>
        </div>
      </header>
      <div className="places-tools">
        <label className="places-search">
          <MagnifyingGlassIcon size={20} aria-hidden="true" />
          <span className="sr-only">Search places, people or years</span>
          <input
            type="search"
            aria-label="Search places, people or years"
            placeholder="A place, a person, a year…"
            value={route.placeQuery}
            maxLength={120}
            onChange={(event) =>
              onNavigate({ placeQuery: event.target.value }, true)
            }
          />
          {route.placeQuery && (
            <button
              onClick={() => onNavigate({ placeQuery: '' }, true)}
              aria-label="Clear place search"
            >
              <XIcon size={18} />
            </button>
          )}
        </label>
        <label className="places-filter">
          <span>Show</span>
          <select
            aria-label="Show"
            value={route.placeKind}
            onChange={(event) =>
              onNavigate({ placeKind: event.target.value as PlaceFilter })
            }
          >
            {Object.entries(placeFilters).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="kin-text-link places-map-toggle"
          ref={mapTrigger}
          aria-expanded={mapOpen}
          aria-controls="places-map"
          onClick={() => setMapOpen((open) => !open)}
        >
          <MapPinIcon size={18} /> {mapOpen ? 'Hide map' : 'Explore the map'}
        </button>
      </div>
      {mapOpen && (
        <DismissParent value={mapLayer.id}>
          <div id="places-map" ref={mapPanel}>
            {hasMappedResults ? (
              <>
                {selected && !selected.location && (
                  <output className="places-map-notice">
                    <strong>{selected.title}</strong> isn’t on the map yet. Its
                    family connections are below.
                  </output>
                )}
                <Suspense
                  fallback={<p className="kin-empty">Opening the map…</p>}
                >
                  <PlacesMap
                    groups={mapGroups}
                    selected={selected}
                    onSelect={select}
                    reducedMotion={reducedMotion}
                  />
                </Suspense>
              </>
            ) : (
              <div className="places-map-empty">
                <h2>
                  <output>
                    {!mapGroups.length
                      ? groups.length
                        ? 'No places match these filters.'
                        : 'No places for this branch yet.'
                      : selected && !selected.location
                        ? `${selected.title} isn’t on the map yet.`
                        : 'These places aren’t on the map yet.'}
                  </output>
                </h2>
                <p>
                  {mapGroups.length
                    ? 'Their family connections are below.'
                    : located > 0
                      ? 'Clear the search and filter to see more places.'
                      : 'Explore the places connected with other family members.'}
                </p>
                {located > 0 ? (
                  <button
                    className="kin-text-link"
                    onClick={() => onNavigate(clearPlaceFilters)}
                  >
                    Clear search and filters <ArrowRightIcon size={18} />
                  </button>
                ) : canShowFamilyPlaces ? (
                  <button
                    className="kin-text-link"
                    onClick={() =>
                      onNavigate({
                        ...clearPlaceFilters,
                        branch: homeRoute.branch,
                      })
                    }
                  >
                    Show all family places <ArrowRightIcon size={18} />
                  </button>
                ) : null}
              </div>
            )}
            {hasMappedResults && geography.attributions && (
              <div
                className="places-geographic-attributions"
                aria-label="Geographic data attribution"
              >
                {geography.attributions.map((item) => (
                  <a
                    key={item.url}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {item.text}
                  </a>
                ))}
              </div>
            )}
          </div>
        </DismissParent>
      )}
      <div className={`places-layout ${selected ? 'has-place' : ''}`}>
        <aside className="places-index" aria-label="Places">
          <div className="places-index-heading">
            <h2 ref={indexHeading} tabIndex={-1}>
              Explore a place
            </h2>
            <output>
              {filtered.length} {filtered.length === 1 ? 'result' : 'results'}
            </output>
          </div>
          {!filtered.length && (
            <div className="places-no-results">
              <p>No places match this search in {branchLabel}.</p>
              <button
                className="kin-text-link"
                onClick={() => onNavigate({ placeQuery: '', placeKind: 'all' })}
              >
                Show every place <ArrowRightIcon size={17} />
              </button>
            </div>
          )}
          <div className="places-results">
            {filtered.map((group) => (
              <button
                key={group.id}
                className={`place-result ${selected?.id === group.id ? 'is-selected' : ''}`}
                aria-pressed={selected?.id === group.id}
                onClick={() => select(group.id)}
              >
                <span className="place-result-mark">
                  <MapPinIcon size={20} aria-hidden="true" />
                </span>
                <span>
                  <strong>{group.title}</strong>
                  <small>
                    {[
                      `${group.people.length} ${group.people.length === 1 ? 'person' : 'people'}`,
                      placePeriod(group),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </span>
                <ArrowRightIcon size={18} aria-hidden="true" />
              </button>
            ))}
          </div>
        </aside>
        <div className="place-detail">
          {selected ? (
            <>
              <button
                className="kin-text-link place-back"
                onClick={() => onNavigate({ place: '' })}
              >
                <ArrowLeftIcon size={17} /> All places
              </button>
              <header className="place-detail-heading">
                <span className="kin-eyebrow">{placePeriod(selected)}</span>
                <h2 ref={heading} tabIndex={-1}>
                  {selected.title}
                </h2>
                {outsideBranch && (
                  <p className="place-section-note">
                    This place is outside {branchLabel}. The list still shows
                    your branch.
                  </p>
                )}
                <p>
                  {selected.people.length}{' '}
                  {selected.people.length === 1
                    ? 'relative is'
                    : 'relatives are'}{' '}
                  linked to this place.
                </p>
              </header>
              {webBook && !bookBody && !bookFailed && (
                <p className="place-section-note">
                  Finding this place in the book…
                </p>
              )}
              {bookFailed && (
                <div className="place-section-note">
                  <p>
                    The book links didn’t load. The family records below still
                    work.
                  </p>
                  <button
                    className="kin-text-link"
                    onClick={() => setBookAttempt((attempt) => attempt + 1)}
                  >
                    Try again <ArrowRightIcon size={17} />
                  </button>
                </div>
              )}
              {stories && stories.direct.length > 0 && (
                <section
                  className="place-reading"
                  aria-label="This place in the book"
                >
                  <h3>This place in the book</h3>
                  <p className="place-section-note">
                    {stories.direct.length === 1
                      ? '1 book section mentions this place. Open it to read it.'
                      : `${stories.direct.length} book sections mention this place. Open one to read it.`}
                  </p>
                  {stories.direct.slice(0, 5).map(readStory)}
                  {stories.direct.length > 5 && (
                    <details className="place-geography">
                      <summary>
                        More book sections ({stories.direct.length - 5})
                      </summary>
                      <div className="place-reading">
                        {stories.direct.slice(5).map(readStory)}
                      </div>
                    </details>
                  )}
                  {storyQualifications.length > 0 && (
                    <details className="place-geography">
                      <summary>Notes</summary>
                      {storyQualifications.map((text) => (
                        <p key={text}>{readerQualification(text)}</p>
                      ))}
                    </details>
                  )}
                </section>
              )}
              <details className="place-geography">
                <summary>About the map</summary>
                {selected.location && <p>The pin marks the town or area.</p>}
                <ul>
                  {selected.places.map(({ place, geographic }) => (
                    <li key={place.id}>
                      <strong>{place.name}</strong>
                      {geographic?.note && <p>{geographic.note}</p>}
                    </li>
                  ))}
                </ul>
                {selected.location && (
                  <div className="place-map-sources">
                    <span>Map sources</span>
                    {selected.location.sources.map((source, i) => (
                      <a
                        key={source.url + i}
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {source.title}
                        {source.locator ? ` · ${source.locator}` : ''}{' '}
                        <ArrowRightIcon size={14} />
                      </a>
                    ))}
                  </div>
                )}
              </details>
              {selected.events.length > 0 && (
                <section
                  className="place-events"
                  aria-label="Family records for this place"
                >
                  <h3>From the family records</h3>
                  <p className="place-section-note">
                    Choose a name to read that person’s life.
                  </p>
                  {!events.length && (
                    <p className="kin-empty">
                      No events here match the filter.{' '}
                      <button
                        className="kin-text-link"
                        onClick={() => onNavigate({ placeKind: 'all' })}
                      >
                        Show all events
                      </button>
                    </p>
                  )}
                  <ol>
                    {events.map((entry) => (
                      <li
                        key={JSON.stringify([
                          entry.id,
                          entry.place.id,
                          entry.event.date,
                          entry.event.label,
                          entry.event.detail,
                        ])}
                      >
                        <div className="place-event-date">
                          {entry.event.date
                            ? formatGedcomDate(entry.event.date)
                            : ''}
                        </div>
                        <div className="place-event-body">
                          <strong>{entry.event.label}</strong>
                          {entry.event.value &&
                            entry.event.value.toLowerCase() !==
                              entry.event.label.toLowerCase() && (
                              <p>{entry.event.value}</p>
                            )}
                          <div className="place-event-people">
                            {entry.people.map((person) => (
                              <button
                                key={person.id}
                                onClick={() => onPerson(person.id)}
                              >
                                {person.name}
                                <ArrowRightIcon size={15} />
                              </button>
                            ))}
                          </div>
                          <p className="place-event-name">{entry.place.name}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              {photographs.length > 0 && (
                <section className="place-photographs">
                  <h3>People from this place</h3>
                  <div>{photographs.slice(0, 6).map(showPortrait)}</div>
                  {photographs.length > 6 && (
                    <details className="place-geography">
                      <summary>
                        More portraits ({photographs.length - 6})
                      </summary>
                      <div className="place-photographs">
                        <div>{photographs.slice(6).map(showPortrait)}</div>
                      </div>
                    </details>
                  )}
                </section>
              )}
              {stories && stories.related.length > 0 && (
                <details
                  className="place-geography"
                  aria-label="More about these relatives"
                >
                  <summary>
                    More about these relatives ({stories.related.length})
                  </summary>
                  <p className="place-section-note">
                    These parts of the book are about the same people. They may
                    not mention this place.
                  </p>
                  <div className="place-reading">
                    {stories.related.map((section) => (
                      <button
                        key={section.anchor}
                        onClick={() => onRead(section.anchor)}
                      >
                        <BookOpenTextIcon size={21} />
                        <span>
                          <strong>{section.title}</strong>
                        </span>
                        <ArrowRightIcon size={19} />
                      </button>
                    ))}
                  </div>
                </details>
              )}
              <section className="place-people">
                {stories && stories.people.length > 0 && (
                  <>
                    <h3>Named in the book</h3>
                    <div>
                      {stories.people.map((person) => personLink(person))}
                    </div>
                  </>
                )}
                {selected.events.length > 0 && (
                  <>
                    <h3>In the family records</h3>
                    <div>
                      {[
                        ...new Map(
                          selected.events
                            .flatMap((entry) => entry.people)
                            .map((person) => [person.id, person]),
                        ).values(),
                      ].map((person) => personLink(person))}
                    </div>
                  </>
                )}
              </section>
            </>
          ) : (
            <div className="places-invitation">
              <MapPinIcon size={34} />
              <h2>
                {route.place
                  ? 'Choose a place in this branch'
                  : 'Choose a place'}
              </h2>
              <p>
                {route.place
                  ? 'This place has no family records in this branch. The list shows the places in your branch.'
                  : 'A town can link several generations. Choose one to see its family records, photographs and book chapters.'}
              </p>
              <p className="place-section-note">
                Some records name only a county or country. Others name a street
                or cemetery. We use the name each record gives.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
