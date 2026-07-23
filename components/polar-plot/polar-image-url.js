/**
 * Resolve polar PNG URL for a sitecode + pollutant (e.g. cldp0299-no2-polar-2025.png).
 */
const assetBase = import.meta.env.BASE_URL || '/';

export function polarImageUrl(sitecode, pollutant) {
    const code = (sitecode || 'CLDP0299').toLowerCase();
    const key = pollutant === 'pm25' ? 'pm25' : 'no2';
    return `${assetBase}${code}-${key}-polar-2025.png`;
}

/**
 * Seasonal polar PNG (e.g. cldp0299-no2-polar-2025-winter.png).
 * @param {string} sitecode
 * @param {string} pollutant - 'no2' | 'pm25'
 * @param {string} season - 'winter' | 'spring' | 'summer' | 'autumn'
 */
export function polarSeasonalImageUrl(sitecode, pollutant, season) {
    const code = (sitecode || 'CLDP0299').toLowerCase();
    const key = pollutant === 'pm25' ? 'pm25' : 'no2';
    const s = String(season || 'winter').toLowerCase();
    return `${assetBase}${code}-${key}-polar-2025-${s}.png`;
}
