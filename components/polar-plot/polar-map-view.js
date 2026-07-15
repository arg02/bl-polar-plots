/**
 * Polar plot map overlay view (?polarMap=1)
 *
 * Centres a transparent polar PNG on the sensor lat/lon.
 * Prefers Mapbox when VITE_MAPBOX_ACCESS_TOKEN works; falls back to Leaflet + OSM
 * if the token is missing or WebGL fails (common in some headless / restricted envs).
 */
import mapboxgl from 'mapbox-gl';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchSensorMetadata } from '../../services/api.js';
import {
    DEFAULT_MAPBOX_STYLE,
    MAPBOX_BASEMAP_STYLES,
    initializeMap
} from '../../utils/mapbox-overlay.js';

const assetBase = import.meta.env.BASE_URL || '/';

const POLAR_IMAGES = {
    no2: `${assetBase}cldp0299-no2-polar-2025.png`,
    pm25: `${assetBase}cldp0299-pm25-polar-2025.png`
};


/** Default plot opacity so streets remain visible under the PNG. */
const DEFAULT_OVERLAY_OPACITY = 0.5;

/** sessionStorage key for the temporary basemap style picker. */
const BASEMAP_STYLE_STORAGE_KEY = 'polar-map-basemap-style';

const ALLOWED_BASEMAP_STYLE_URLS = new Set(
    MAPBOX_BASEMAP_STYLES.map((entry) => entry.url)
);

function readStoredBasemapStyle() {
    try {
        const stored = sessionStorage.getItem(BASEMAP_STYLE_STORAGE_KEY);
        if (stored && ALLOWED_BASEMAP_STYLE_URLS.has(stored)) return stored;
    } catch {
        /* private mode / blocked storage */
    }
    return DEFAULT_MAPBOX_STYLE;
}

function storeBasemapStyle(styleUrl) {
    try {
        sessionStorage.setItem(BASEMAP_STYLE_STORAGE_KEY, styleUrl);
    } catch {
        /* ignore */
    }
}

/**
 * Resolve polar PNG URL for a sitecode + pollutant.
 * Falls back to CLDP0299 assets when site-specific files are absent.
 */
export function polarImageUrl(sitecode, pollutant) {
    const code = (sitecode || 'CLDP0299').toLowerCase();
    const key = pollutant === 'pm25' ? 'pm25' : 'no2';
    const preferred = `${assetBase}${code}-${key}-polar-2025.png`;
    if (code === 'cldp0299' || code === 'cldp0652') return preferred;
    return POLAR_IMAGES[key];
}

function webglAvailable() {
    try {
        const canvas = document.createElement('canvas');
        return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    } catch {
        return false;
    }
}



function bindOpacitySlider(slot, mapApi) {
    const input = slot.querySelector('#polar-map-opacity');
    const valueEl = slot.querySelector('#polar-map-opacity-value');
    if (!input || !mapApi?.setOpacity) return;

    const apply = (raw) => {
        const pct = Math.max(0, Math.min(100, Number(raw)));
        const opacity = pct / 100;
        input.setAttribute('aria-valuenow', String(pct));
        if (valueEl) valueEl.textContent = `${pct}%`;
        mapApi.setOpacity(opacity);
    };

    // Ensure initial paint matches slider (in case engine default differs)
    apply(input.value);
    input.addEventListener('input', () => apply(input.value));
}

/**
 * Temporary Mapbox basemap style selector.
 * HTML Markers (plot + sensor dot) are not style layers, so they survive setStyle.
 */
function bindBasemapStyleSelector(slot, mapApi) {
    const select = slot.querySelector('#polar-map-basemap-style');
    const note = slot.querySelector('#polar-map-basemap-note');
    const control = slot.querySelector('#polar-map-basemap-control');
    if (!select || !control) return;

    const isMapbox = mapApi?.engine === 'mapbox' && mapApi?.map;
    select.disabled = !isMapbox;
    if (note) note.hidden = isMapbox;

    if (!isMapbox) return;

    const initial = ALLOWED_BASEMAP_STYLE_URLS.has(select.value)
        ? select.value
        : readStoredBasemapStyle();
    select.value = initial;

    select.addEventListener('change', () => {
        const styleUrl = select.value;
        if (!ALLOWED_BASEMAP_STYLE_URLS.has(styleUrl)) return;

        storeBasemapStyle(styleUrl);
        // Markers are DOM overlays and persist across style swaps; only basemap tiles change.
        mapApi.map.setStyle(styleUrl);
    });
}

function syncMapHeightToCopy(slot, mapApi) {
    const copy = slot.querySelector('.polar-plot-layout__copy');
    const mapEl = document.getElementById('polar-map');
    const controls = slot.querySelector('#polar-map-controls');
    const stack = slot.querySelector('.polar-map-stack');
    if (!copy || !mapEl) return;

    const apply = () => {
        const copyHeight = Math.round(copy.getBoundingClientRect().height);
        const controlsHeight = controls ? controls.offsetHeight : 0;
        // Map + controls (basemap + opacity) match the explanation column height
        const mapHeight = Math.max(0, copyHeight - controlsHeight);
        if (stack && copyHeight > 0) {
            stack.style.height = `${copyHeight}px`;
        }
        if (mapHeight > 0) {
            mapEl.style.height = `${mapHeight}px`;
            // Avoid locking min-height to a stale full-column value before controls measure
            mapEl.style.minHeight = '0';
        }
        if (mapApi?.engine === 'leaflet' && mapApi.map) {
            mapApi.map.invalidateSize();
        } else if (mapApi?.engine === 'mapbox' && mapApi.map) {
            mapApi.map.resize();
        }
    };

    apply();
    requestAnimationFrame(() => {
        apply();
        requestAnimationFrame(apply);
    });

    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(apply);
        ro.observe(copy);
        if (controls) ro.observe(controls);
        mapApi._heightObserver = ro;
    } else {
        window.addEventListener('resize', apply);
        mapApi._onWindowResize = apply;
    }
}

function prepareSlot(slot) {
    slot.classList.add('polar-plot-slot--map');
    slot.querySelector('#polar-plot-demo')?.setAttribute('hidden', '');
    const mapView = slot.querySelector('#polar-map-view');
    if (mapView) mapView.hidden = false;

    slot.querySelectorAll('.polar-plot-switcher__btn').forEach((btn) => {
        btn.setAttribute('aria-controls', 'polar-map');
    });
}

/**
 * Fixed screen-size plot icon centred on the sensor.
 * Zoom/pan only move the basemap; the PNG does not scale with zoom.
 */
function plotDisplaySize(mapEl) {
    const w = mapEl?.clientWidth || 480;
    const h = mapEl?.clientHeight || 360;
    // Slightly under the map box so the colour key & edges stay inside the panel
    return Math.max(220, Math.min(Math.round(h * 0.9), Math.round(w * 0.62)));
}

function makePlotImg(url, sizePx, opacity) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.draggable = false;
    img.className = 'polar-map-plot-img';
    img.style.width = `${sizePx}px`;
    img.style.height = 'auto';
    img.style.opacity = String(opacity);
    img.style.pointerEvents = 'none';
    img.style.userSelect = 'none';
    img.style.display = 'block';
    return img;
}

/**
 * Leaflet + OSM: marker-based plot (fixed pixels — map zoom does not scale the PNG).
 */
function initLeafletPolarMap({ sitecode, center, lat, lng }) {
    const mapEl = document.getElementById('polar-map');
    if (!mapEl) return { setPollutant: () => {}, setOpacity: () => {}, map: null, engine: 'leaflet' };

    mapEl.innerHTML = '';

    let overlayOpacity = DEFAULT_OVERLAY_OPACITY;
    let currentPollutant = 'no2';
    let sizePx = plotDisplaySize(mapEl);

    const map = L.map(mapEl, {
        center: [lat, lng],
        zoom: 15,
        zoomControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19
    }).addTo(map);

    const buildIcon = (url) => {
        const heightPx = Math.round(sizePx * (840 / 800));
        return L.divIcon({
            className: 'polar-map-plot-marker',
            html: makePlotImg(url, sizePx, overlayOpacity).outerHTML,
            iconSize: [sizePx, heightPx],
            iconAnchor: [sizePx / 2, heightPx / 2]
        });
    };

    let plotMarker = L.marker([lat, lng], {
        icon: buildIcon(polarImageUrl(sitecode, currentPollutant)),
        interactive: false,
        keyboard: false,
        zIndexOffset: 400
    }).addTo(map);

    const dot = L.divIcon({
        className: 'polar-map-sensor-dot-wrap',
        html: '<div class="polar-map-sensor-dot" title="' + sitecode + '"></div>',
        iconSize: [10, 10],
        iconAnchor: [5, 5]
    });
    L.marker([lat, lng], { icon: dot, interactive: false, zIndexOffset: 600 }).addTo(map);

    const refreshPlotIcon = () => {
        plotMarker.setIcon(buildIcon(polarImageUrl(sitecode, currentPollutant)));
    };

    map.on('resize', () => {
        const next = plotDisplaySize(mapEl);
        if (next !== sizePx) {
            sizePx = next;
            refreshPlotIcon();
        }
    });

    requestAnimationFrame(() => {
        map.invalidateSize();
        sizePx = plotDisplaySize(mapEl);
        refreshPlotIcon();
    });

    return {
        map,
        engine: 'leaflet',
        setPollutant(pollutant) {
            currentPollutant = pollutant === 'pm25' ? 'pm25' : 'no2';
            refreshPlotIcon();
        },
        setOpacity(opacity) {
            overlayOpacity = Math.max(0, Math.min(1, Number(opacity)));
            const img = mapEl.querySelector('.polar-map-plot-img');
            if (img) img.style.opacity = String(overlayOpacity);
            else refreshPlotIcon();
        }
    };
}

/**
 * Mapbox GL: marker-based plot (fixed pixels — map zoom does not scale the PNG).
 */
async function initMapboxPolarMap({ sitecode, center, lat, lng, mapToken }) {
    const mapEl = document.getElementById('polar-map');
    const initialStyle = readStoredBasemapStyle();
    const map = initializeMap('polar-map', center, 15, mapToken, initialStyle);
    if (!map) throw new Error('Mapbox map failed to construct');

    const styleSelect = document.getElementById('polar-map-basemap-style');
    if (styleSelect) styleSelect.value = initialStyle;

    map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'top-right');

    let currentPollutant = 'no2';
    let overlayOpacity = DEFAULT_OVERLAY_OPACITY;

    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Mapbox style load timed out'));
        }, 8000);

        const onError = (e) => {
            clearTimeout(timeout);
            reject(e?.error || e || new Error('Mapbox error'));
        };

        map.once('error', onError);
        if (map.loaded()) {
            clearTimeout(timeout);
            map.off('error', onError);
            resolve();
        } else {
            map.once('load', () => {
                clearTimeout(timeout);
                map.off('error', onError);
                resolve();
            });
        }
    });

    map.resize();

    const sizePx = () => plotDisplaySize(mapEl || document.getElementById('polar-map'));

    const plotRoot = document.createElement('div');
    plotRoot.className = 'polar-map-plot-marker';
    let plotImg = makePlotImg(polarImageUrl(sitecode, currentPollutant), sizePx(), overlayOpacity);
    plotRoot.appendChild(plotImg);

    const plotMarker = new mapboxgl.Marker({ element: plotRoot, anchor: 'center' })
        .setLngLat(center)
        .addTo(map);

    const sensorDot = document.createElement('div');
    sensorDot.className = 'polar-map-sensor-dot';
    sensorDot.title = sitecode;
    new mapboxgl.Marker({ element: sensorDot, anchor: 'center' })
        .setLngLat(center)
        .addTo(map);

    const resizePlot = () => {
        const px = sizePx();
        if (plotImg) {
            plotImg.style.width = `${px}px`;
        }
    };

    map.on('resize', resizePlot);
    map.once('idle', () => {
        map.resize();
        resizePlot();
    });

    return {
        map,
        engine: 'mapbox',
        plotMarker,
        setPollutant(pollutant) {
            currentPollutant = pollutant === 'pm25' ? 'pm25' : 'no2';
            if (plotImg) plotImg.src = polarImageUrl(sitecode, currentPollutant);
        },
        setOpacity(opacity) {
            overlayOpacity = Math.max(0, Math.min(1, Number(opacity)));
            if (plotImg) plotImg.style.opacity = String(overlayOpacity);
        }
    };
}

/**
 * Activate polar-map layout and initialise map overlay.
 * @param {object} options
 * @param {string} options.sitecode
 * @param {HTMLElement} options.slot - #polar-plot-slot
 */
export async function initPolarMapView({ sitecode, slot }) {
    prepareSlot(slot);

    const statusEl = slot.querySelector('#polar-map-status');

    let sensor;
    try {
        sensor = await fetchSensorMetadata(sitecode);
    } catch (err) {
        console.error(err);
        if (statusEl) {
            statusEl.hidden = false;
            const detail = err?.message ? ` (${err.message})` : '';
            statusEl.textContent = `Could not load sensor location for ${sitecode}.${detail}`;
        }
        return { setPollutant: () => {}, setOpacity: () => {}, map: null, engine: null };
    }

    const lat = Number(sensor.Latitude ?? sensor.latitude);
    const lng = Number(sensor.Longitude ?? sensor.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        if (statusEl) {
            statusEl.hidden = false;
            statusEl.textContent = 'Sensor is missing valid latitude/longitude.';
        }
        return { setPollutant: () => {}, setOpacity: () => {}, map: null, engine: null };
    }

    const center = [lng, lat];
    const mapToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
    const preferMapbox = Boolean(mapToken) && webglAvailable();

    try {
        let result;
        if (preferMapbox) {
            try {
                result = await initMapboxPolarMap({ sitecode, center, lat, lng, mapToken });
            } catch (err) {
                console.warn('Mapbox polar overlay failed; falling back to Leaflet:', err);
                // Clear any half-initialised Mapbox DOM before Leaflet takes over
                const mapEl = document.getElementById('polar-map');
                if (mapEl) mapEl.innerHTML = '';
                result = initLeafletPolarMap({ sitecode, center, lat, lng });
            }
        } else {
            result = initLeafletPolarMap({ sitecode, center, lat, lng });
        }

        if (statusEl) statusEl.hidden = true;
        bindBasemapStyleSelector(slot, result);
        syncMapHeightToCopy(slot, result);
        bindOpacitySlider(slot, result);
        return result;
    } catch (err) {
        console.error('Polar map overlay failed:', err);
        if (statusEl) {
            statusEl.hidden = false;
            statusEl.textContent = 'Could not initialise the polar map overlay.';
        }
        return { setPollutant: () => {}, setOpacity: () => {}, map: null, engine: null };
    }
}
