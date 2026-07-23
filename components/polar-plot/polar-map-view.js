/**
 * Polar plot map overlay view (default polar presentation).
 *
 * Centres a transparent polar PNG on the sensor lat/lon using Leaflet
 * (same stack as the site’s other maps) with a switchable free basemap.
 */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchSensorMetadata } from '../../services/api.js';
import {
    DEFAULT_BASEMAP_ID,
    LEAFLET_BASEMAPS,
    createBasemapLayer,
    getBasemap
} from '../../utils/leaflet-basemaps.js';
export { polarImageUrl } from './polar-image-url.js';
import { polarImageUrl } from './polar-image-url.js';

/** Default plot opacity so streets remain visible under the PNG. */
const DEFAULT_OVERLAY_OPACITY = 0.7;

/** localStorage key for basemap choice (v3 = Leaflet ids, not Mapbox style URLs). */
const BASEMAP_STORAGE_KEY = 'polar-map-basemap-v3';

const ALLOWED_BASEMAP_IDS = new Set(LEAFLET_BASEMAPS.map((entry) => entry.id));

function readStoredBasemapId() {
    try {
        const stored = localStorage.getItem(BASEMAP_STORAGE_KEY);
        if (stored && ALLOWED_BASEMAP_IDS.has(stored)) return stored;
    } catch {
        /* private mode / blocked storage */
    }
    return DEFAULT_BASEMAP_ID;
}

function storeBasemapId(id) {
    try {
        localStorage.setItem(BASEMAP_STORAGE_KEY, id);
    } catch {
        /* ignore */
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
 * Basemap tile-layer selector (Leaflet).
 */
function bindBasemapStyleSelector(slot, mapApi) {
    const select = slot.querySelector('#polar-map-basemap-style');
    const note = slot.querySelector('#polar-map-basemap-note');
    const control = slot.querySelector('#polar-map-basemap-control');
    if (!select || !control) return;

    if (note) note.hidden = true;
    select.disabled = !(mapApi?.map && typeof mapApi.setBasemap === 'function');
    if (select.disabled) return;

    const initial = ALLOWED_BASEMAP_IDS.has(select.value)
        ? select.value
        : readStoredBasemapId();
    select.value = initial;

    select.addEventListener('change', () => {
        const id = select.value;
        if (!ALLOWED_BASEMAP_IDS.has(id)) return;
        storeBasemapId(id);
        mapApi.setBasemap(id);
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
        // Map + controls match the explanation column; caveat sits below the stack
        const mapHeight = Math.max(0, copyHeight - controlsHeight);
        if (stack && copyHeight > 0) {
            stack.style.height = `${copyHeight}px`;
        }
        if (mapHeight > 0) {
            mapEl.style.height = `${mapHeight}px`;
            // Avoid locking min-height to a stale full-column value before controls measure
            mapEl.style.minHeight = '0';
        }
        if (mapApi?.map) {
            mapApi.map.invalidateSize();
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
 * Leaflet: marker-based plot (fixed pixels — map zoom does not scale the PNG).
 */
function initLeafletPolarMap({ sitecode, lat, lng }) {
    const mapEl = document.getElementById('polar-map');
    if (!mapEl) return { setPollutant: () => {}, setOpacity: () => {}, setBasemap: () => {}, map: null, engine: 'leaflet' };

    mapEl.innerHTML = '';

    let overlayOpacity = DEFAULT_OVERLAY_OPACITY;
    let currentPollutant = 'no2';
    let sizePx = plotDisplaySize(mapEl);
    let basemapId = readStoredBasemapId();

    const map = L.map(mapEl, {
        center: [lat, lng],
        zoom: 16,
        zoomControl: true,
        scrollWheelZoom: false
    });
    // Keep scroll-wheel zoom off so page scroll isn’t captured by the map
    map.scrollWheelZoom.disable();

    let basemapLayer = createBasemapLayer(L, basemapId).addTo(map);

    const styleSelect = document.getElementById('polar-map-basemap-style');
    if (styleSelect) styleSelect.value = getBasemap(basemapId).id;

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
        setBasemap(id) {
            if (!ALLOWED_BASEMAP_IDS.has(id) || id === basemapId) return;
            basemapId = id;
            map.removeLayer(basemapLayer);
            basemapLayer = createBasemapLayer(L, id).addTo(map);
            // Keep plot marker above the new tile pane
            basemapLayer.bringToBack();
        },
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
        return { setPollutant: () => {}, setOpacity: () => {}, setBasemap: () => {}, map: null, engine: null };
    }

    const lat = Number(sensor.Latitude ?? sensor.latitude);
    const lng = Number(sensor.Longitude ?? sensor.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        if (statusEl) {
            statusEl.hidden = false;
            statusEl.textContent = 'Sensor is missing valid latitude/longitude.';
        }
        return { setPollutant: () => {}, setOpacity: () => {}, setBasemap: () => {}, map: null, engine: null };
    }

    try {
        const result = initLeafletPolarMap({ sitecode, lat, lng });

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
        return { setPollutant: () => {}, setOpacity: () => {}, setBasemap: () => {}, map: null, engine: null };
    }
}
