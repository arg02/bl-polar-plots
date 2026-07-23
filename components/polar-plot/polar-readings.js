/**
 * Site-specific plain-English readings for 2025 polar plots
 * (community / cultural Bloomberg nodes).
 */

const READINGS_URL = `${import.meta.env.BASE_URL || '/'}polar-readings-2025.json`;

let readingsCache = null;

export async function loadPolarReadings() {
    if (readingsCache) return readingsCache;
    try {
        const res = await fetch(READINGS_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        readingsCache = await res.json();
    } catch (err) {
        console.warn('Polar readings not available:', err);
        readingsCache = {};
    }
    return readingsCache;
}

/**
 * Short season + pollutant summary for a site, if prepared.
 * @returns {string | null}
 */
export function getSeasonalReading(siteCode, pollutant = 'no2', season = 'winter') {
    const code = (siteCode || '').toUpperCase();
    const key = pollutant === 'pm25' ? 'pm25' : 'no2';
    const text = readingsCache?.[code]?.[key]?.seasons?.[season];
    return typeof text === 'string' && text.trim() ? text.trim() : null;
}

/**
 * Fill the site reading beside the plot for the current sitecode + pollutant.
 * Hides the block when this sitecode has no prepared reading.
 */
export function applyPolarReading(siteCode, pollutant = 'no2') {
    const root = document.getElementById('polar-reading');
    const body = document.getElementById('polar-reading-body');
    if (!root || !body) return;

    const code = (siteCode || '').toUpperCase();
    const key = pollutant === 'pm25' ? 'pm25' : 'no2';
    const entry = readingsCache?.[code]?.[key];
    const paragraphs = entry?.paragraphs;

    if (!paragraphs?.length) {
        root.hidden = true;
        body.replaceChildren();
        return;
    }

    body.replaceChildren(
        ...paragraphs.map((text) => {
            const p = document.createElement('p');
            p.textContent = text;
            return p;
        })
    );
    root.hidden = false;
}
