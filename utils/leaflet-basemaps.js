/**
 * Free OSM / CARTO / Esri tile layers for Leaflet (no Mapbox token).
 * Default matches individual-node-map’s CARTO light_all look.
 */

/** @typedef {{ id: string, label: string, url: string, attribution: string, options?: object }} BasemapDef */

const OSM_ATTR =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const CARTO_ATTR = `${OSM_ATTR} &copy; <a href="https://carto.com/attributions">CARTO</a>`;
const ESRI_ATTR =
    'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community';

/** @type {ReadonlyArray<BasemapDef>} */
export const LEAFLET_BASEMAPS = Object.freeze([
    {
        id: 'light',
        label: 'Light',
        url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        attribution: CARTO_ATTR,
        options: { subdomains: 'abcd', maxZoom: 20 }
    },
    {
        id: 'voyager',
        label: 'Streets',
        url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
        attribution: CARTO_ATTR,
        options: { subdomains: 'abcd', maxZoom: 20 }
    },
    {
        id: 'satellite',
        label: 'Satellite',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: ESRI_ATTR,
        options: { maxZoom: 19 }
    }
]);

export const DEFAULT_BASEMAP_ID = 'light';

const BY_ID = new Map(LEAFLET_BASEMAPS.map((entry) => [entry.id, entry]));

/**
 * @param {string} id
 * @returns {BasemapDef}
 */
export function getBasemap(id) {
    return BY_ID.get(id) || BY_ID.get(DEFAULT_BASEMAP_ID);
}

/**
 * Create a Leaflet tile layer for a basemap id.
 * @param {typeof import('leaflet')} L
 * @param {string} id
 */
export function createBasemapLayer(L, id) {
    const def = getBasemap(id);
    return L.tileLayer(def.url, {
        attribution: def.attribution,
        ...(def.options || {})
    });
}
