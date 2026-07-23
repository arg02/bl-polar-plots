import { polarImageUrl } from './components/polar-plot/polar-image-url.js';
import { loadPolarReadings, applyPolarReading } from './components/polar-plot/polar-readings.js';
import { initPolarSeasonalPlots } from './components/polar-plot/polar-seasonal-plots.js';

const API_KEY = 'e2635276-e87a-11eb-9a03-0242ac130003';
const API_BASE_URL = 'https://api.breathelondon-communities.org/api';

/**
 * Parse query params. Also recovers from a common typo where a second `?` is used
 * instead of `&` (e.g. `?sitecode=CLDP0299?species=both`), which would otherwise make
 * sitecode=`CLDP0299?species=both` and leave the second param unset.
 */
function parseUrlParams(search) {
    const params = new URLSearchParams(search);
    let repaired = false;

    for (const [key, value] of [...params.entries()]) {
        // Value accidentally contains "?otherKey=..." from a second `?` in the URL
        const q = value.indexOf('?');
        if (q === -1) continue;

        const realValue = value.slice(0, q);
        const extras = new URLSearchParams(value.slice(q + 1));
        params.set(key, realValue);
        for (const [extraKey, extraValue] of extras.entries()) {
            if (!params.has(extraKey)) params.set(extraKey, extraValue);
        }
        repaired = true;
    }

    return { params, repaired };
}

const { params: urlParams, repaired: urlParamsRepaired } = parseUrlParams(window.location.search);
let sitecode = urlParams.get('sitecode') || 'CLDP0299';
let species = urlParams.get('species') || 'both';
/**
 * Polar UI studio: /?sitecode=CLDP0299&polarUI=studio
 * When studio is on, the map overlay is skipped (static plot redesign only).
 */
const polarStudioEnabled = urlParams.get('polarUI') === 'studio';
/** Map overlay is the default polar presentation (unless studio is on). */
const polarMapEnabled = !polarStudioEnabled;

if (polarStudioEnabled) {
    document.getElementById('polar-plot-slot')?.classList.add('polar-plot-slot--studio');
}

if (!urlParams.has('sitecode') || urlParamsRepaired) {
    if (!urlParams.has('sitecode')) urlParams.set('sitecode', sitecode);
    window.history.replaceState({}, '', `${window.location.pathname}?${urlParams.toString()}${window.location.hash}`);
    if (urlParamsRepaired) {
        console.info(
            '[node-info] Fixed query string (use & between params, not a second ?).',
            `Canonical: ${window.location.pathname}?${urlParams.toString()}`
        );
    }
}

function loadScript(src, { type = 'text/javascript', module = false } = {}) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        if (module) script.type = 'module';
        else script.type = type;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

function loadStylesheet(href, id) {
    if (id && document.getElementById(id)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    if (id) link.id = id;
    document.head.appendChild(link);
}

function mapSpecies(speciesParam) {
    const value = (speciesParam || 'both').toUpperCase();
    if (value === 'PM25' || value === 'IPM25') return 'IPM25';
    if (value === 'NO2' || value === 'INO2') return 'INO2';
    return 'both';
}

async function loadSensorIntroWidget() {
    await loadScript('https://storage.googleapis.com/static.erg.ic.ac.uk/sensor-intro-widget/dist/assets/index.js?ignoreCache=28', { module: true });
    loadStylesheet('https://storage.googleapis.com/static.erg.ic.ac.uk/sensor-intro-widget/dist/assets/index.css?ignoreCache=22', 'sensor-intro-css');
}

async function loadIndividualNodeMap() {
    await loadScript('https://storage.googleapis.com/static.erg.ic.ac.uk/individual-node-map/dist/assets/index.js?v=10', { module: true });
    loadStylesheet('https://storage.googleapis.com/static.erg.ic.ac.uk/individual-node-map/dist/assets/index.css?v=10', 'individual-node-map-css');
}

async function loadSensorGraph() {
    // CDN sensor-graph (Vue/#app-sensor-graph) auto-mounts from ?sitecode= — no props.
    // "Darker above WHO" is NOT a second bar colour: bars stay solid #a21b72 / #808080.
    // Chart.js annotation boxes fade y=0→WHO (Daily: NO2 25 / PM2.5 15; Annual: 10 / 5)
    // with graphFadeColor1; the solid tip only appears when a value exceeds that limit.
    // Local CSS cannot recolour canvas segments. guidelines:['who'] below is linechart-only.
    window.graphFadeColor1 = 'rgba(224, 224, 255, 0.5)';
    window.graphFadeColor2 = 'rgba(224, 224, 255, 0.25)';
    await loadScript('https://storage.googleapis.com/static.erg.ic.ac.uk/sensor-graph/dist/assets/index.js?ignoreCache=true&v=2', { module: true });
    loadStylesheet('https://storage.googleapis.com/static.erg.ic.ac.uk/sensor-graph/dist/assets/index.css?ignoreCache=true', 'sensor-graph-css');
}

async function loadSensorGraphLinechart(siteCode, speciesParam) {
    await loadScript('https://storage.googleapis.com/erg-static-files/sensor-graph-linechart/build/index.js?v=4');
    loadStylesheet('https://storage.googleapis.com/erg-static-files/sensor-graph-linechart/build/index.css?v=1', 'sensor-graph-linechart-css');

    const init = () => {
        if (!window.reactWidget) {
            setTimeout(init, 200);
            return;
        }

        const widgetSpecies = mapSpecies(speciesParam);
        window.reactWidget.init({
            environment: 'dev',
            authId: API_KEY,
            apiKey: API_KEY,
            chartHeight: '300',
            height: '500',
            siteCode,
            species: widgetSpecies,
            showDatePicker: true,
            guidelines: ['who']
        });
    };

    init();
}

function initLinechartToggle() {
    const container = document.getElementById('widget__container__container');
    const button = document.getElementById('widget__container__show');
    if (!container || !button) return;

    container.style.display = 'none';
    button.addEventListener('click', () => {
        container.style.display = 'block';
        button.style.display = 'none';
    });
}

async function initDataUseSurvey(siteCode) {
    const section = document.getElementById('data-use-survey-section');
    const link = document.getElementById('data-use-survey-link');
    if (!section) return;

    try {
        const response = await fetch(`${API_BASE_URL}/ListSensors?key=${API_KEY}`);
        if (response.ok) {
            const allSensors = await response.json();
            const sensors = Array.isArray(allSensors?.[0]) ? allSensors[0] : allSensors;
            const sensor = sensors.find((s) => s?.SiteCode === siteCode);
            if (sensor?.EndDate) {
                section.hidden = true;
                return;
            }
        }
    } catch (error) {
        console.warn('Could not check sensor status for data use survey:', error);
    }

    section.hidden = false;

    if (link) {
        const prodUrl = new URL('https://www.breathelondon-communities.org/sensor-info');
        prodUrl.searchParams.set('sitecode', siteCode);
        prodUrl.searchParams.set('species', species);
        link.href = prodUrl.toString();
    }
}

function initWhatCanIDo() {
    const root = document.getElementById('what-can-i-do-root');
    if (!root) return;

    const whatCanIDoUrl = `${import.meta.env.BASE_URL || '/'}sections/what-can-i-do.html`;
    fetch(whatCanIDoUrl)
        .then((res) => res.text())
        .then((html) => {
            root.innerHTML = html;

            const personas = root.querySelectorAll('.do__personas > li');
            const actionLists = root.querySelectorAll('.do__actions ul');

            function showPersona(persona) {
                personas.forEach((li) => li.classList.toggle('active', li.dataset.persona === persona));
                actionLists.forEach((ul) => {
                    ul.style.display = ul.classList.contains(persona) ? 'flex' : 'none';
                });
            }

            personas.forEach((li) => {
                li.addEventListener('click', () => showPersona(li.dataset.persona));
            });

            const active = root.querySelector('.do__personas > li.active');
            if (active) showPersona(active.dataset.persona);
        })
        .catch((err) => console.error('Failed to load What can I do section:', err));
}

/** Hide/show polar plot slot — call from console: showPolarPlotSlot() / hidePolarPlotSlot() */
window.showPolarPlotSlot = () => {
    const slot = document.getElementById('polar-plot-slot');
    if (slot) slot.hidden = false;
};
window.hidePolarPlotSlot = () => {
    const slot = document.getElementById('polar-plot-slot');
    if (slot) slot.hidden = true;
};

/** Point static polar <img> tags at sitecode-specific 2025 PNGs. */
function applyStaticPolarImages(siteCode) {
    const code = (siteCode || 'CLDP0299').toUpperCase();
    const panels = [
        { id: 'polar-panel-no2', pollutant: 'no2', label: 'nitrogen dioxide' },
        { id: 'polar-panel-pm25', pollutant: 'pm25', label: 'fine particulate matter (PM2.5)' }
    ];
    for (const { id, pollutant, label } of panels) {
        const img = document.querySelector(`#${id} img`);
        if (!img) continue;
        img.src = polarImageUrl(code, pollutant);
        img.alt = `Polar plot of ${label} for sensor ${code}, January to December 2025`;
    }
}

/** Active pollutant from the polar switcher (defaults to NO₂). */
function currentPolarPollutant() {
    return document.getElementById('polar-plot-slot')?.dataset?.pollutant || 'no2';
}

/** Refresh expandable site reading for sitecode + current pollutant. */
function refreshPolarReading(siteCode, pollutant = currentPolarPollutant()) {
    applyPolarReading(siteCode, pollutant);
}

/**
 * Pollutant NO₂ / PM₂.₅ switcher for the polar section.
 * @param {{ onPollutantChange?: (pollutant: string) => void, syncPanels?: boolean }} [options]
 */
function initPolarPlotSwitcher(options = {}) {
    const { onPollutantChange, syncPanels = true, siteCode } = options;
    const slot = document.getElementById('polar-plot-slot');
    if (!slot) return;

    const buttons = slot.querySelectorAll('.polar-plot-switcher__btn');
    const panels = slot.querySelectorAll('.polar-plot-demo__figure');
    if (!buttons.length) return;

    function selectPollutant(pollutant) {
        buttons.forEach((btn) => {
            const isActive = btn.dataset.pollutant === pollutant;
            btn.classList.toggle('is-active', isActive);
            btn.setAttribute('aria-selected', String(isActive));
            btn.tabIndex = isActive ? 0 : -1;
        });

        slot.dataset.pollutant = pollutant;
        slot.querySelector('.polar-plot-switcher')?.setAttribute('data-pollutant', pollutant);

        if (syncPanels) {
            panels.forEach((panel) => {
                const isActive = panel.dataset.pollutant === pollutant;
                panel.classList.toggle('is-active', isActive);
                panel.hidden = !isActive;
            });
        }

        if (siteCode) refreshPolarReading(siteCode, pollutant);
        onPollutantChange?.(pollutant);
    }

    // Seed initial pollutant for studio dial / CSS hooks
    const initial =
        [...buttons].find((b) => b.classList.contains('is-active'))?.dataset.pollutant || 'no2';
    slot.dataset.pollutant = initial;
    slot.querySelector('.polar-plot-switcher')?.setAttribute('data-pollutant', initial);

    buttons.forEach((btn) => {
        btn.addEventListener('click', () => selectPollutant(btn.dataset.pollutant));
    });

    slot.querySelector('.polar-plot-switcher')?.addEventListener('keydown', (e) => {
        const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (!keys.includes(e.key)) return;
        e.preventDefault();
        const list = [...buttons];
        const current = list.findIndex((b) => b.classList.contains('is-active'));
        let next = current;
        if (e.key === 'ArrowRight') next = (current + 1) % list.length;
        if (e.key === 'ArrowLeft') next = (current - 1 + list.length) % list.length;
        if (e.key === 'Home') next = 0;
        if (e.key === 'End') next = list.length - 1;
        list[next].focus();
        selectPollutant(list[next].dataset.pollutant);
    });
}

function initHeaderMenu() {
    const btn = document.getElementById('header-menu-btn');
    const nav = document.getElementById('header-nav');
    if (!btn || !nav) return;

    btn.addEventListener('click', () => {
        const isOpen = nav.classList.toggle('is-open');
        btn.setAttribute('aria-expanded', String(isOpen));
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    const mappedSpecies = mapSpecies(species);

    initLinechartToggle();
    initHeaderMenu();

    // Start polar-map overlay early — do not wait on production widgets.
    // Widgets also hit ListSensors (~1.2MB); sequencing them first used to starve
    // / abort the location fetch and surface "Could not load sensor location".
    const polarMapPromise = (async () => {
        await loadPolarReadings();
        let seasonalApi;
        if (!polarMapEnabled) {
            applyStaticPolarImages(sitecode);
            seasonalApi = await initPolarSeasonalPlots({ sitecode });
            initPolarPlotSwitcher({
                siteCode: sitecode,
                onPollutantChange: (p) => seasonalApi?.setPollutant?.(p),
            });
            refreshPolarReading(sitecode);
            return;
        }
        try {
            const { initPolarMapView } = await import('./components/polar-plot/polar-map-view.js');
            const slot = document.getElementById('polar-plot-slot');
            if (!slot) return;
            const { setPollutant } = await initPolarMapView({ sitecode, slot });
            seasonalApi = await initPolarSeasonalPlots({ sitecode });
            initPolarPlotSwitcher({
                syncPanels: false,
                siteCode: sitecode,
                onPollutantChange: (p) => {
                    setPollutant(p);
                    seasonalApi?.setPollutant?.(p);
                },
            });
            refreshPolarReading(sitecode);
        } catch (error) {
            console.error('Error initialising polar map overlay:', error);
            const slot = document.getElementById('polar-plot-slot');
            slot?.classList.remove('polar-plot-slot--map');
            document.getElementById('polar-plot-demo')?.removeAttribute('hidden');
            const mapView = document.getElementById('polar-map-view');
            if (mapView) mapView.hidden = true;
            applyStaticPolarImages(sitecode);
            seasonalApi = await initPolarSeasonalPlots({ sitecode });
            initPolarPlotSwitcher({
                siteCode: sitecode,
                onPollutantChange: (p) => seasonalApi?.setPollutant?.(p),
            });
            refreshPolarReading(sitecode);
        }
    })();

    try {
        await Promise.all([
            loadSensorIntroWidget(),
            loadIndividualNodeMap(),
            loadSensorGraph()
        ]);
        await loadSensorGraphLinechart(sitecode, mappedSpecies);
    } catch (error) {
        console.error('Error loading production widgets:', error);
    }

    await polarMapPromise;

    // Survey section omitted from demo page for now — restore with: await initDataUseSurvey(sitecode);
    initWhatCanIDo();
});
