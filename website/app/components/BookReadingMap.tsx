import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightIcon,
  MapPinIcon,
  PlayIcon,
  XIcon,
} from '@phosphor-icons/react';
import type * as Leaflet from 'leaflet';
import type { GeoJsonObject } from 'geojson';
import {
  readerNotes,
  type BookAnnotations,
  type BookMention,
  type BookPassage,
} from '../lib/book-annotations';
import type { Geography, GeographicLocation } from '../lib/places';
import Modal from './Modal';
import { sha256 } from '../lib/previews';
import basemap from '../../geography/basemap.json';
import { addMapDetails } from '../lib/map-details';
import '../book-reading-map.css';
import { sitePath } from '../lib/paths';

type Request = { mention: BookMention; passage: BookPassage };
type Location = { location: GeographicLocation; mentions: BookMention[] };

export default function BookReadingMap({
  annotations,
  geography,
  passage,
  request,
  wide,
  trigger,
  onClose,
  onFollow,
  onPlace,
  onPassage,
}: {
  annotations: BookAnnotations;
  geography: Geography;
  passage: BookPassage | null;
  request: Request | null;
  wide: boolean;
  trigger: HTMLElement | null;
  onClose: () => void;
  onFollow: () => void;
  onPlace: (id: string) => void;
  onPassage: (id: string) => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const details = useRef<Leaflet.TileLayer | null>(null);
  const library = useRef<typeof Leaflet | null>(null);
  const markers = useRef<Leaflet.LayerGroup | null>(null);
  const programmatic = useRef(false);
  const camera = useRef<{ center: Leaflet.LatLngTuple; zoom: number } | null>(
    null,
  );
  const fitted = useRef<{
    passage: string | undefined;
    request: Request | null;
  } | null>(null);
  const [following, setFollowing] = useState(true);
  const [held, setHeld] = useState<BookPassage | null>(null);
  const [selected, setSelected] = useState('');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [detailUnavailable, setDetailUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const display = following ? passage : held;
  const latest = useRef(display);
  latest.current = display;
  const pause = () => {
    setHeld(latest.current);
    setFollowing(false);
  };
  const pauseRef = useRef(pause);
  pauseRef.current = pause;
  useEffect(() => {
    if (!wide) heading.current?.focus({ preventScroll: true });
  }, [wide]);
  useEffect(() => {
    if (!request) return;
    setHeld(request.passage);
    setSelected(request.mention.location || '');
    setFollowing(false);
  }, [request]);
  const locations = useMemo(() => {
    const byId = new Map(annotations.mentions.map((m) => [m.id, m]));
    const result = new Map<string, Location>();
    for (const id of display?.mentions || []) {
      const mention = byId.get(id);
      const location = geography.locations.find(
        (p) => p.id === mention?.location,
      );
      if (!mention || !location) continue;
      const group = result.get(location.id) || { location, mentions: [] };
      group.mentions.push(mention);
      result.set(location.id, group);
    }
    return [...result.values()];
  }, [annotations, display, geography]);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let observer: ResizeObserver | undefined;
    const canvas = container.current;
    const keydown = (event: KeyboardEvent) => {
      if (
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)
      )
        pauseRef.current();
    };
    canvas?.addEventListener('keydown', keydown);
    setError(false);
    setDetailUnavailable(false);
    setReady(false);
    Promise.all([
      import('leaflet'),
      fetch(sitePath(`geography/${basemap.map.sha256}.json`), {
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) throw new Error('Map unavailable');
        const bytes = await response.arrayBuffer();
        if (
          bytes.byteLength !== basemap.map.bytes ||
          (await sha256(bytes)) !== basemap.map.sha256
        )
          throw new Error('The saved map does not match this edition');
        return JSON.parse(new TextDecoder().decode(bytes)) as GeoJsonObject;
      }),
    ])
      .then(([module, features]) => {
        if (cancelled || !container.current) return;
        const L = module.default;
        library.current = L;
        const instance = L.map(container.current, {
          zoomControl: false,
          scrollWheelZoom: false,
          minZoom: 2,
          maxZoom: 19,
          zoomAnimation: false,
          fadeAnimation: false,
          markerZoomAnimation: false,
        });
        map.current = instance;
        instance.setView(
          camera.current?.center || [43, -35],
          camera.current?.zoom || 2,
        );
        details.current = addMapDetails(L, instance, setDetailUnavailable);
        L.geoJSON(features, {
          interactive: false,
          pane: 'saved-outlines',
          style: (feature) =>
            feature?.properties.layer === 'lake'
              ? {
                  color: '#abc1c1',
                  weight: 0.5,
                  fillColor: '#d4e1df',
                  fillOpacity: 1,
                }
              : feature?.properties.layer === 'boundary'
                ? { color: '#aaa28f', weight: 0.7, opacity: 0.8, fill: false }
                : {
                    color: '#928c7f',
                    weight: 0.8,
                    fillColor: '#efecdf',
                    fillOpacity: 1,
                  },
        }).addTo(instance);
        markers.current = L.layerGroup().addTo(instance);
        L.control.zoom({ position: 'bottomright' }).addTo(instance);
        L.control.scale({ position: 'topleft' }).addTo(instance);
        instance.attributionControl.setPrefix(false);
        instance.attributionControl.addAttribution(
          '<a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a> · modern outlines',
        );
        instance.on('dragstart', () => pauseRef.current());
        instance.on('zoomstart', () => {
          if (!programmatic.current) pauseRef.current();
        });
        observer = new ResizeObserver(() =>
          instance.invalidateSize({ pan: false }),
        );
        observer.observe(container.current);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
      controller.abort();
      observer?.disconnect();
      canvas?.removeEventListener('keydown', keydown);
      if (map.current) {
        const center = map.current.getCenter();
        camera.current = {
          center: [center.lat, center.lng],
          zoom: map.current.getZoom(),
        };
        map.current.remove();
      }
      map.current = null;
      details.current = null;
      markers.current = null;
    };
  }, [attempt, wide]);
  useEffect(() => {
    if (!ready || !map.current || !library.current || !markers.current) return;
    const instance = map.current,
      L = library.current;
    markers.current.clearLayers();
    locations.forEach(({ location }, index) => {
      const label = document.createElement('span');
      label.textContent = String(index + 1);
      const marker = L.marker([location.latitude, location.longitude], {
        title: location.name,
        alt: location.name,
        keyboard: true,
        icon: L.divIcon({
          className: 'book-map-marker',
          html: label,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        }),
      }).addTo(markers.current!);
      marker.on('click', () => {
        pauseRef.current();
        setSelected(location.id);
      });
    });
    // Resizing and marker selection never overwrite a manually explored view.
    // New followed passages and explicit requests are the only automatic moves.
    if (
      locations.length &&
      !(
        fitted.current?.passage === display?.id &&
        fitted.current?.request === request
      )
    ) {
      programmatic.current = true;
      const chosen = request
        ? locations.filter((p) => p.location.id === request.mention.location)
        : locations;
      const points = (chosen.length ? chosen : locations).map(
        (p) =>
          [p.location.latitude, p.location.longitude] as Leaflet.LatLngTuple,
      );
      instance.fitBounds(L.latLngBounds(points), {
        padding: [32, 32],
        maxZoom: 7,
        animate: false,
      });
      fitted.current = { passage: display?.id, request };
      programmatic.current = false;
    }
  }, [ready, locations, request, display?.id, following]);
  const groups =
    selected && locations.some((p) => p.location.id === selected)
      ? locations.filter((p) => p.location.id === selected)
      : locations;
  const contextNotes = readerNotes(
    display?.qualifications.map((q) => q.text) || [],
  );
  const contents = (
    <aside
      id="book-reading-map"
      ref={panel}
      className={'book-reading-map' + (wide ? ' is-wide' : '')}
      aria-labelledby="book-reading-map-title"
    >
      <div className="book-map-heading">
        <h3 id="book-reading-map-title" ref={heading} tabIndex={-1}>
          <MapPinIcon size={18} /> Places in the book
        </h3>
        <button
          aria-label="Close reading map"
          data-dismiss-modal={!wide || undefined}
          onClick={onClose}
        >
          <XIcon size={19} />
        </button>
      </div>
      <div className="book-map-follow">
        <output>{following ? 'Following your reading' : 'Map paused'}</output>
        {!following && (
          <button
            onClick={() => {
              fitted.current = null;
              setFollowing(true);
              setSelected('');
              onFollow();
            }}
          >
            <PlayIcon size={15} /> Follow the story
          </button>
        )}
      </div>
      <div
        className="book-map-canvas"
        ref={container}
        aria-label="Map of places mentioned in the book"
      />
      {detailUnavailable && (
        <output>
          Street detail didn’t load. Family places still show.{' '}
          <button onClick={() => details.current?.redraw()}>Try again</button>
        </output>
      )}
      {error && (
        <p role="alert">
          The map didn’t load.{' '}
          <button onClick={() => setAttempt(attempt + 1)}>Try again</button>
        </p>
      )}
      <p className="book-map-explanation">
        Zoom in for street detail. Each pin marks a town or area.
      </p>
      {!locations.length ? (
        <p>No places on the map for this part of the book yet.</p>
      ) : (
        <>
          <p className="book-map-context-label">
            {following
              ? 'Places in your current reading'
              : 'Places in this passage'}
          </p>
          {selected && locations.length > 1 && (
            <button className="kin-text-link" onClick={() => setSelected('')}>
              Show all places in this passage
            </button>
          )}
          <ol className="book-map-locations">
            {groups.map(({ location, mentions }) => (
              <li key={location.id}>
                <h4>{location.name}</h4>
                {[
                  ...new Map(
                    mentions.map((m) => [m.kind + ':' + m.target, m]),
                  ).values(),
                ].map((mention) => (
                  <div key={mention.id}>
                    <p>{mention.label}</p>
                    {mention.kind === 'place' && (
                      <button
                        className="kin-text-link"
                        onClick={() => onPlace(mention.target)}
                      >
                        Explore this place <ArrowRightIcon size={15} />
                      </button>
                    )}
                  </div>
                ))}
                <details>
                  <summary>Map sources</summary>
                  {readerNotes(
                    mentions.flatMap((mention) => mention.qualifications),
                  ).map((text) => (
                    <p key={text}>{text}</p>
                  ))}
                  {location.sources.map((source, i) => (
                    <p key={source.url + i}>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {source.title}
                        {source.locator ? ` · ${source.locator}` : ''}
                      </a>
                    </p>
                  ))}
                </details>
              </li>
            ))}
          </ol>
          {contextNotes.length ? (
            <details>
              <summary>Context from the book</summary>
              {contextNotes.map((text) => (
                <p key={text}>{text}</p>
              ))}
            </details>
          ) : null}
          {display && (
            <button
              className="kin-text-link"
              onClick={() => onPassage(display.id)}
            >
              Return to this passage <ArrowRightIcon size={15} />
            </button>
          )}
        </>
      )}
      {geography.attributions && (
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
    </aside>
  );
  return wide ? (
    contents
  ) : (
    <Modal
      label="Places in the book"
      onClose={onClose}
      className="book-reading-map-modal"
      insideSelector=".book-reading-map"
      returnFocus={() => trigger}
    >
      {contents}
    </Modal>
  );
}
