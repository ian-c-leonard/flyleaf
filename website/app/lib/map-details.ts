import type * as Leaflet from 'leaflet';

/** Public modern geography only; family markers and names stay in the app. */
export function addMapDetails(
  L: typeof Leaflet,
  map: Leaflet.Map,
  onUnavailable: (unavailable: boolean) => void,
) {
  const pane = map.createPane('saved-outlines');
  pane.style.zIndex = '190'; // below tiles and all family markers
  const failed = new Set<HTMLElement>();
  const layer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    // Send the site's origin, never its reader route or a family identifier.
    // The rest of the private site retains its no-referrer policy.
    referrerPolicy: 'origin',
    updateWhenIdle: true,
    keepBuffer: 1,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
  });
  layer.on('tileerror', (event: Leaflet.TileErrorEvent) => {
    failed.add(event.tile);
    onUnavailable(true);
  });
  const clearFailure = (event: Leaflet.TileEvent) => {
    failed.delete(event.tile);
    onUnavailable(failed.size > 0);
  };
  layer.on('tileunload', clearFailure);
  layer.on('tileload', clearFailure);
  layer.addTo(map);
  return layer;
}
