import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

export const POLAR_PLOT_SOURCE_ID = 'polar-plot-overlay';
export const POLAR_PLOT_LAYER_ID = 'polar-plot-layer';
export const POLAR_RADIUS_SOURCE_ID = 'polar-radius-ring';
export const POLAR_RADIUS_LAYER_ID = 'polar-radius-ring-layer';

/**
 * Default ground radius for polar plot overlays.
 * 10 km ≈ air travel distance for ~2.8 m/s wind over 1 hour
 * (see WIND_SPEED_TO_DISTANCE.md).
 */
export const DEFAULT_POLAR_RADIUS_METERS = 10_000;

/** Default basemap for the polar map page. */
export const DEFAULT_MAPBOX_STYLE = 'mapbox://styles/mapbox/streets-v12';

/**
 * Built-in Mapbox styles for the temporary polar-map basemap picker.
 * @type {ReadonlyArray<{ id: string, label: string, url: string }>}
 */
export const MAPBOX_BASEMAP_STYLES = Object.freeze([
    { id: 'streets', label: 'Streets', url: 'mapbox://styles/mapbox/streets-v12' },
    { id: 'outdoors', label: 'Outdoors', url: 'mapbox://styles/mapbox/outdoors-v12' },
    { id: 'light', label: 'Light', url: 'mapbox://styles/mapbox/light-v11' },
    { id: 'dark', label: 'Dark', url: 'mapbox://styles/mapbox/dark-v11' },
    { id: 'satellite', label: 'Satellite', url: 'mapbox://styles/mapbox/satellite-v9' },
    { id: 'satellite-streets', label: 'Satellite Streets', url: 'mapbox://styles/mapbox/satellite-streets-v12' },
    { id: 'standard', label: 'Standard', url: 'mapbox://styles/mapbox/standard' }
]);

/**
 * Initialize Mapbox map (for polar plot overlay)
 * @param {string} containerId - Container element ID
 * @param {Array} center - [lng, lat] coordinates
 * @param {number} zoom - Initial zoom level
 * @param {string} accessToken - Mapbox access token
 * @param {string} [style] - Mapbox style URL (defaults to streets-v12)
 * @returns {mapboxgl.Map|null} Initialized map instance
 */
export function initializeMap(containerId, center, zoom = 14, accessToken, style = DEFAULT_MAPBOX_STYLE) {
    if (!accessToken) {
        console.error('Mapbox access token is required');
        return null;
    }

    const container = document.getElementById(containerId);
    if (!container) {
        console.error(`Map container ${containerId} not found`);
        return null;
    }

    mapboxgl.accessToken = accessToken;

    return new mapboxgl.Map({
        container: containerId,
        style: style || DEFAULT_MAPBOX_STYLE,
        center,
        zoom,
        pitch: 0,
        bearing: 0 // North up
    });
}

/**
 * Calculate bounding box from center point and radius (N-up square footprint).
 * @param {Array} center - [lng, lat] center coordinates
 * @param {number} radiusMeters - Radius in meters
 * @returns {Array} Corner coordinates [[lng, lat], ...] TL→TR→BR→BL
 */
export function calculateBoundsFromRadius(center, radiusMeters) {
    const [lng, lat] = center;

    const latDelta = radiusMeters / 111320;
    const lngDelta = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180));

    return [
        [lng - lngDelta, lat + latDelta],
        [lng + lngDelta, lat + latDelta],
        [lng + lngDelta, lat - latDelta],
        [lng - lngDelta, lat - latDelta]
    ];
}

/**
 * Build a GeoJSON circle approx for the ground-radius ring.
 * @param {Array} center - [lng, lat]
 * @param {number} radiusMeters
 * @param {number} [steps=64]
 */
function circlePolygon(center, radiusMeters, steps = 64) {
    const [lng, lat] = center;
    const latDelta = radiusMeters / 111320;
    const lngDelta = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180));
    const coords = [];

    for (let i = 0; i <= steps; i++) {
        const theta = (i / steps) * 2 * Math.PI;
        coords.push([
            lng + lngDelta * Math.sin(theta),
            lat + latDelta * Math.cos(theta)
        ]);
    }

    return {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [coords] }
    };
}

/**
 * Add or replace polar plot image overlay + optional radius ring.
 * PNG is assumed North-up with the plot centre at the image centre.
 * @param {mapboxgl.Map} map
 * @param {Array} center - [lng, lat]
 * @param {string} imageUrl
 * @param {number} radiusMeters
 * @param {object} [options]
 * @param {number} [options.opacity=0.92]
 * @param {boolean} [options.showRadiusRing=true]
 */
export function addPolarPlotOverlay(map, center, imageUrl, radiusMeters, options = {}) {
    const { opacity = 0.92, showRadiusRing = true } = options;
    const bounds = calculateBoundsFromRadius(center, radiusMeters);

    if (map.getLayer(POLAR_PLOT_LAYER_ID)) map.removeLayer(POLAR_PLOT_LAYER_ID);
    if (map.getSource(POLAR_PLOT_SOURCE_ID)) map.removeSource(POLAR_PLOT_SOURCE_ID);
    if (map.getLayer(POLAR_RADIUS_LAYER_ID)) map.removeLayer(POLAR_RADIUS_LAYER_ID);
    if (map.getSource(POLAR_RADIUS_SOURCE_ID)) map.removeSource(POLAR_RADIUS_SOURCE_ID);

    map.addSource(POLAR_PLOT_SOURCE_ID, {
        type: 'image',
        url: imageUrl,
        coordinates: bounds
    });

    map.addLayer({
        id: POLAR_PLOT_LAYER_ID,
        type: 'raster',
        source: POLAR_PLOT_SOURCE_ID,
        paint: {
            // Transparent PNGs already carry alpha; keep opacity high
            'raster-opacity': opacity,
            'raster-resampling': 'linear'
        }
    });

    if (showRadiusRing) {
        map.addSource(POLAR_RADIUS_SOURCE_ID, {
            type: 'geojson',
            data: circlePolygon(center, radiusMeters)
        });

        map.addLayer({
            id: POLAR_RADIUS_LAYER_ID,
            type: 'line',
            source: POLAR_RADIUS_SOURCE_ID,
            paint: {
                'line-color': '#0b1f4a',
                'line-width': 1.5,
                'line-opacity': 0.45,
                'line-dasharray': [2, 2]
            }
        });
    }
}

/**
 * Swap the polar plot image without rebuilding sources (NO₂ / PM₂.₅ switch).
 * @param {mapboxgl.Map} map
 * @param {string} imageUrl
 */

/**
 * Set polar plot raster opacity (0–1) on a Mapbox map.
 * @param {mapboxgl.Map} map
 * @param {number} opacity
 */
export function setPolarPlotOpacity(map, opacity) {
    if (!map?.getLayer?.(POLAR_PLOT_LAYER_ID)) return;
    const value = Math.max(0, Math.min(1, Number(opacity)));
    map.setPaintProperty(POLAR_PLOT_LAYER_ID, 'raster-opacity', value);
}

export function updatePolarPlotOverlayImage(map, imageUrl) {
    const source = map.getSource(POLAR_PLOT_SOURCE_ID);
    if (source && typeof source.updateImage === 'function') {
        source.updateImage({ url: imageUrl });
        return;
    }
    console.warn('Polar plot image source not ready to update');
}

/**
 * Calculate appropriate zoom level for a given radius
 * @param {number} radiusMeters
 * @param {number} lat
 * @returns {number}
 */
export function calculateZoomForRadius(radiusMeters, lat) {
    const earthCircumference = 40075017;
    const pixelsForRadius = 150;
    const metersPerPixel = radiusMeters / pixelsForRadius;
    const zoom = Math.log2(earthCircumference / (metersPerPixel * 256));
    const latAdjustment = Math.log2(Math.cos((lat * Math.PI) / 180));
    const finalZoom = zoom - latAdjustment - 2;
    return Math.max(10, Math.min(18, finalZoom));
}
