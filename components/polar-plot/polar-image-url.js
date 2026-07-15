/**
 * Resolve polar PNG URL for a sitecode + pollutant (e.g. cldp0299-no2-polar-2025.png).
 */
const assetBase = import.meta.env.BASE_URL || '/';

export function polarImageUrl(sitecode, pollutant) {
    const code = (sitecode || 'CLDP0299').toLowerCase();
    const key = pollutant === 'pm25' ? 'pm25' : 'no2';
    return `${assetBase}${code}-${key}-polar-2025.png`;
}
