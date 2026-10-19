import { useEffect, useRef, useState } from 'react';
import {
  ArrowCounterClockwiseIcon,
  ArrowRightIcon,
  ArrowsOutIcon,
  XIcon,
} from '@phosphor-icons/react';
import type * as Leaflet from 'leaflet';
import type { GeoJsonObject } from 'geojson';
import { useDismissible } from '../lib/useDismissible';
import type { PlaceGroup } from '../lib/places';
import { sha256 } from '../lib/previews';
import { groupMapPoints } from '../lib/place-map';
import basemap from '../../geography/basemap.json';
import { addMapDetails } from '../lib/map-details';
import { sitePath } from '../lib/paths';

export default function PlacesMap({
  groups,
  selected,
  onSelect,
  reducedMotion,
}: {
  groups: PlaceGroup[];
  selected: PlaceGroup | null;
  onSelect: (id: string) => void;
  reducedMotion: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const details = useRef<Leaflet.TileLayer | null>(null);
  const library = useRef<typeof Leaflet | null>(null);
  const markers = useRef(
    new Map<string, { marker: Leaflet.Marker; places: PlaceGroup[] }>(),
  );
  const callback = useRef(onSelect);
  const visible = useRef(groups);
  const selection = useRef(selected);
  const reset = useRef<HTMLButtonElement>(null);
  const nearbyHeading = useRef<HTMLHeadingElement>(null);
  const nearbyClose = useRef<HTMLButtonElement>(null);
  const nearbyPanel = useRef<HTMLElement>(null);
  const [nearby, setNearby] = useState<PlaceGroup[] | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [detailUnavailable, setDetailUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const nearbyLayer = useDismissible({
    enabled: !!nearby,
    root: () => nearbyPanel.current,
    inside: () => [nearbyPanel.current],
    // Map markers can be regenerated while a group is open. The stable reset
    // control is the existing return target and remains usable across filtering.
    trigger: () => reset.current,
    fallback: () => reset.current,
    onDismiss: () => setNearby(null),
  });
  useEffect(() => {
    callback.current = onSelect;
    visible.current = groups;
    selection.current = selected;
  }, [onSelect, groups, selected]);
  useEffect(() => {
    if (!nearby) return;
    nearbyClose.current?.focus({ preventScroll: true });
    nearbyHeading.current?.scrollIntoView({
      block: 'nearest',
      behavior: 'instant',
    });
  }, [nearby]);
  function closeNearby() {
    nearbyLayer.dismiss();
  }
  function showAll() {
    if (!map.current || !library.current) return;
    const points = visible.current.flatMap((group) =>
      group.location
        ? [
            [
              group.location.latitude,
              group.location.longitude,
            ] as Leaflet.LatLngTuple,
          ]
        : [],
    );
    if (points.length)
      map.current.fitBounds(library.current.latLngBounds(points), {
        padding: [35, 35],
        maxZoom: 7,
        animate: false,
      });
    else map.current.setView([43, -35], 2, { animate: false });
  }
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const ownedMarkers = markers.current;
    let observer: ResizeObserver | undefined;
    setReady(false);
    setError(false);
    setDetailUnavailable(false);
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
          throw new Error('Map bytes do not match this edition.');
        return JSON.parse(new TextDecoder().decode(bytes)) as GeoJsonObject;
      }),
    ])
      .then(([module, geography]) => {
        if (cancelled || !container.current) return;
        const L = module.default;
        library.current = L;
        const instance = L.map(container.current, {
          zoomControl: false,
          scrollWheelZoom: false,
          minZoom: 2,
          maxZoom: 19,
          preferCanvas: true,
          zoomAnimation: !reducedMotion,
          fadeAnimation: false,
          markerZoomAnimation: !reducedMotion,
        });
        map.current = instance;
        instance.setView([43, -35], 2);
        details.current = addMapDetails(L, instance, setDetailUnavailable);
        L.geoJSON(geography, {
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
        L.control.zoom({ position: 'bottomright' }).addTo(instance);
        L.control
          .scale({ position: 'bottomleft', imperial: true, metric: true })
          .addTo(instance);
        instance.attributionControl.setPrefix(false);
        instance.attributionControl.addAttribution(
          '<a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a> · modern outlines',
        );
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
      ownedMarkers.clear();
      map.current?.remove();
      map.current = null;
      details.current = null;
    };
  }, [attempt, reducedMotion]);
  useEffect(() => {
    if (!ready || !library.current || !map.current) return;
    const L = library.current,
      instance = map.current;
    const ownedMarkers = markers.current;
    const clear = () => {
      for (const { marker } of ownedMarkers.values()) marker.remove();
      ownedMarkers.clear();
    };
    const draw = () => {
      clear();
      const points = groups.flatMap((group) => {
        if (!group.location) return [];
        const point = instance.latLngToContainerPoint([
          group.location.latitude,
          group.location.longitude,
        ]);
        return [{ x: point.x, y: point.y, item: group }];
      });
      for (const group of groupMapPoints(points)) {
        const places = group.items;
        const multiple = places.length > 1;
        const title = multiple
          ? `${places.length} places in this area`
          : places[0].title;
        const dot = document.createElement('span');
        dot.className = 'place-map-dot';
        if (multiple) {
          const count = document.createElement('strong');
          count.textContent = String(places.length);
          const label = document.createElement('small');
          label.textContent = 'places';
          dot.appendChild(count);
          dot.appendChild(label);
        } else dot.textContent = String(places[0].people.length);
        const size = multiple ? 46 : 32;
        const marker = L.marker(
          multiple
            ? instance.containerPointToLatLng([group.x, group.y])
            : [places[0].location!.latitude, places[0].location!.longitude],
          {
            icon: L.divIcon({
              className: `place-map-marker${multiple ? ' place-map-cluster' : ''}`,
              html: dot,
              iconSize: [size, size],
              iconAnchor: [size / 2, size / 2],
            }),
            keyboard: true,
            title,
            riseOnHover: true,
          },
        ).addTo(instance);
        const label = document.createElement('span');
        label.textContent = title;
        marker.bindTooltip(label, { direction: 'top', offset: [0, -size / 2] });
        const activate = () => {
          if (!multiple) {
            setNearby(null);
            callback.current(places[0].id);
            return;
          }
          setNearby([...places].sort((a, b) => a.title.localeCompare(b.title)));
          instance.fitBounds(
            L.latLngBounds(
              places.map(
                (place) =>
                  [
                    place.location!.latitude,
                    place.location!.longitude,
                  ] as Leaflet.LatLngTuple,
              ),
            ),
            {
              padding: [50, 50],
              maxZoom: Math.min(instance.getZoom() + 3, 10),
              animate: false,
            },
          );
        };
        marker.on('click', activate);
        const element = marker.getElement();
        element?.setAttribute(
          'aria-label',
          multiple
            ? `${title}. Explore these places.`
            : `${title}, ${places[0].people.length} people. Explore this place.`,
        );
        element?.setAttribute('role', 'button');
        element?.addEventListener('keydown', (event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            activate();
          }
        });
        const active = places.some(
          (place) => place.id === selection.current?.id,
        );
        element?.classList.toggle('is-selected', active);
        element?.setAttribute('aria-pressed', String(active));
        marker.setZIndexOffset(active ? 1000 : 0);
        ownedMarkers.set(
          places
            .map((place) => place.id)
            .sort()
            .join(':'),
          { marker, places },
        );
      }
    };
    setNearby(null);
    instance.on('zoomend resize', draw);
    showAll();
    draw();
    return () => {
      instance.off('zoomend resize', draw);
      clear();
    };
  }, [ready, groups]);
  useEffect(() => {
    if (!ready) return;
    setNearby(null);
    for (const { marker, places } of markers.current.values()) {
      const active = places.some((place) => place.id === selected?.id);
      marker.getElement()?.classList.toggle('is-selected', active);
      marker.getElement()?.setAttribute('aria-pressed', String(active));
      marker.setZIndexOffset(active ? 1000 : 0);
    }
    if (selected?.location) {
      const point = selected.location;
      map.current?.setView(
        [point.latitude, point.longitude],
        point.precision === 'locality'
          ? 7
          : point.precision === 'county'
            ? 6
            : 4,
        { animate: !reducedMotion },
      );
    }
  }, [ready, selected, groups, reducedMotion]);
  return (
    <div className="place-map-panel">
      <div
        className="place-map-canvas"
        ref={container}
        aria-label="Interactive map of family places"
      />
      {ready && (
        <button
          ref={reset}
          className="place-map-reset"
          onClick={() => {
            setNearby(null);
            showAll();
          }}
        >
          <ArrowsOutIcon size={17} /> Show all places
        </button>
      )}
      {detailUnavailable && (
        <output className="place-map-detail-status">
          Street detail didn’t load. Family places still show.{' '}
          <button onClick={() => details.current?.redraw()}>Try again</button>
        </output>
      )}
      {!ready && (
        <output className="place-map-loading">
          {error ? (
            <>
              <p>
                The map didn’t load. You can still explore every place below.
              </p>
              <button
                className="kin-text-link"
                onClick={() => setAttempt((n) => n + 1)}
              >
                <ArrowCounterClockwiseIcon size={17} /> Try again
              </button>
            </>
          ) : (
            <p>Opening the map…</p>
          )}
        </output>
      )}
      <p className="place-map-caption">
        Each number shows how many relatives are linked to a place. Tap a group
        to see its places. Each pin marks a town or area.
      </p>
      {nearby && (
        <section
          ref={nearbyPanel}
          className="place-map-nearby"
          aria-labelledby="place-map-nearby-heading"
        >
          <header>
            <div>
              <span className="kin-eyebrow">Explore this area</span>
              <h3 id="place-map-nearby-heading" ref={nearbyHeading}>
                {nearby.length} places to discover
              </h3>
            </div>
            <button
              ref={nearbyClose}
              aria-label="Close nearby places"
              onClick={closeNearby}
            >
              <XIcon size={19} />
            </button>
          </header>
          <div className="place-map-nearby-list">
            {nearby.map((place) => (
              <button
                key={place.id}
                onClick={() => {
                  setNearby(null);
                  callback.current(place.id);
                }}
              >
                <span>
                  <strong>{place.title}</strong>
                  <small>
                    {place.people.length}{' '}
                    {place.people.length === 1 ? 'relative' : 'relatives'}
                  </small>
                </span>
                <ArrowRightIcon size={18} />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
