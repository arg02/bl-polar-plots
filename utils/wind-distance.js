/**
 * Utility functions for converting wind speed to physical distance
 * for accurate georeferencing of polar plots on maps
 */

/**
 * Convert wind speed (m/s) to distance (km) for a given time period
 * @param {number} windSpeedMps - Wind speed in meters per second
 * @param {number} timeHours - Time period in hours (default: 1 hour for hourly data)
 * @returns {number} Distance in kilometers
 */
export function windSpeedToDistance(windSpeedMps, timeHours = 1) {
    // Distance = speed × time
    // Convert: m/s × hours × 3600 seconds/hour / 1000 m/km
    return (windSpeedMps * timeHours * 3600) / 1000;
}

/**
 * Convert distance (km) to wind speed (m/s) for a given time period
 * @param {number} distanceKm - Distance in kilometers
 * @param {number} timeHours - Time period in hours (default: 1 hour)
 * @returns {number} Wind speed in meters per second
 */
export function distanceToWindSpeed(distanceKm, timeHours = 1) {
    // Speed = distance / time
    // Convert: km × 1000 m/km / (hours × 3600 seconds/hour)
    return (distanceKm * 1000) / (timeHours * 3600);
}

/**
 * Calculate appropriate map radius based on wind speed data
 * @param {Array} windSpeedData - Array of wind speed values (m/s)
 * @param {Object} options - Configuration options
 * @param {string} options.method - 'max' | 'percentile' | 'fixed'
 * @param {number} options.percentile - Percentile to use (default: 95)
 * @param {number} options.fixedRadiusKm - Fixed radius in km (if method is 'fixed')
 * @param {number} options.timeHours - Time period in hours (default: 1)
 * @param {number} options.roundToKm - Round result to nearest km (default: true)
 * @returns {number} Radius in kilometers
 */
export function calculateMapRadius(windSpeedData, options = {}) {
    const {
        method = 'percentile',
        percentile = 95,
        fixedRadiusKm = 10,
        timeHours = 1,
        roundToKm = true
    } = options;

    let maxWindSpeed;

    switch (method) {
        case 'max':
            maxWindSpeed = Math.max(...windSpeedData.filter(ws => ws != null && !isNaN(ws)));
            break;
        
        case 'percentile':
            const sorted = windSpeedData.filter(ws => ws != null && !isNaN(ws)).sort((a, b) => a - b);
            const index = Math.ceil((percentile / 100) * sorted.length) - 1;
            maxWindSpeed = sorted[index] || sorted[sorted.length - 1];
            break;
        
        case 'fixed':
            // Use fixed radius, convert back to wind speed for reference
            return fixedRadiusKm;
        
        default:
            throw new Error(`Unknown method: ${method}`);
    }

    const radiusKm = windSpeedToDistance(maxWindSpeed, timeHours);
    
    return roundToKm ? Math.ceil(radiusKm) : radiusKm;
}

/**
 * Get standard radius options for common use cases
 * @returns {Array} Array of {radiusKm, windSpeedMps, description}
 */
export function getStandardRadiusOptions() {
    return [
        { radiusKm: 5, windSpeedMps: 1.4, description: 'Local sources (1.4 m/s)' },
        { radiusKm: 10, windSpeedMps: 2.8, description: 'Neighborhood scale (2.8 m/s)' },
        { radiusKm: 15, windSpeedMps: 4.2, description: 'City district scale (4.2 m/s)' },
        { radiusKm: 20, windSpeedMps: 5.6, description: 'City-wide scale (5.6 m/s)' },
        { radiusKm: 30, windSpeedMps: 8.3, description: 'Regional scale (8.3 m/s)' },
        { radiusKm: 50, windSpeedMps: 13.9, description: 'Large regional scale (13.9 m/s)' }
    ];
}

/**
 * Calculate radius in meters (for Mapbox overlay functions)
 * @param {number} radiusKm - Radius in kilometers
 * @returns {number} Radius in meters
 */
export function kmToMeters(radiusKm) {
    return radiusKm * 1000;
}

/**
 * Calculate radius in kilometers from meters
 * @param {number} radiusMeters - Radius in meters
 * @returns {number} Radius in kilometers
 */
export function metersToKm(radiusMeters) {
    return radiusMeters / 1000;
}
