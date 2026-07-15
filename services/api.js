const API_BASE_URL = 'https://api.breathelondon-communities.org/api';
const API_KEY = import.meta.env.VITE_API_KEY || 'e2635276-e87a-11eb-9a03-0242ac130003';

/**
 * Normalise ListSensors payload to a flat sensor array.
 * API usually returns [[sensor, ...]] but may return a flat array.
 */
function unwrapSensorsList(allSensors) {
    if (Array.isArray(allSensors) && allSensors.length > 0 && Array.isArray(allSensors[0])) {
        return allSensors[0];
    }
    return Array.isArray(allSensors) ? allSensors : [];
}

/**
 * Fetch one sensor via /Sensor/{sitecode} (preferred — small, same shape as ListSensors rows).
 */
async function fetchSensorByCode(sitecode) {
    const code = String(sitecode || '').trim();
    const response = await fetch(`${API_BASE_URL}/Sensor/${encodeURIComponent(code)}?key=${API_KEY}`);
    if (!response.ok) {
        throw new Error(`Sensor endpoint HTTP ${response.status}`);
    }
    const sensor = await response.json();
    if (!sensor || typeof sensor !== 'object' || Array.isArray(sensor)) {
        throw new Error(`Unexpected Sensor response for ${code}`);
    }
    if (!sensor.SiteCode) {
        throw new Error(`Sensor ${code} not found`);
    }
    return sensor;
}

/**
 * Fetch sensor metadata. Prefers /Sensor/{sitecode}; falls back to ListSensors.
 * @param {string} sitecode - Sensor site code (e.g., 'CLDP0652')
 * @returns {Promise<Object>} Sensor metadata
 */
export async function fetchSensorMetadata(sitecode) {
    const code = String(sitecode || '').trim();
    if (!code) {
        throw new Error('sitecode is required');
    }

    try {
        return await fetchSensorByCode(code);
    } catch (primaryError) {
        console.warn(`Sensor/${code} failed, falling back to ListSensors:`, primaryError);
    }

    try {
        const response = await fetch(`${API_BASE_URL}/ListSensors?key=${API_KEY}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const sensors = unwrapSensorsList(await response.json());
        const needle = code.toUpperCase();
        const sensor = sensors.find((s) => s && String(s.SiteCode).toUpperCase() === needle);

        if (!sensor) {
            throw new Error(`Sensor ${code} not found`);
        }

        return sensor;
    } catch (error) {
        console.error('Error fetching sensor metadata:', error);
        throw error;
    }
}

/**
 * Fetch hourly pollution data for a sensor
 * @param {string} sitecode - Sensor site code
 * @param {string} species - Pollutant species ('INO2', 'IPM25', 'both')
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<Array>} Array of hourly data points
 */
export async function fetchHourlyData(sitecode, species, startDate, endDate) {
    try {
        const startStr = startDate.toUTCString();
        const endStr = endDate.toUTCString();
        const encodedStart = encodeURIComponent(startStr);
        const encodedEnd = encodeURIComponent(endStr);
        
        const speciesList = species === 'both' ? ['INO2', 'IPM25'] : [species];
        const promises = speciesList.map(s => {
            const url = `${API_BASE_URL}/getClarityData/${sitecode}/${s}/${encodedStart}/${encodedEnd}/Hourly?key=${API_KEY}`;
            return fetch(url).then(res => res.json());
        });
        
        const results = await Promise.all(promises);
        
        // Combine results if fetching both species
        if (species === 'both') {
            return combineSpeciesData(results[0], results[1]);
        }
        
        return results[0];
    } catch (error) {
        console.error('Error fetching hourly data:', error);
        throw error;
    }
}

/**
 * Combine NO2 and PM2.5 data by timestamp
 * 
 * NOTE: BL API returns DateTime field (hour-beginning timestamps)
 * Format: "2026-01-20T15:00:00.000Z" represents hour 15:00-16:00
 */
function combineSpeciesData(no2Data, pm25Data) {
    const combined = {};
    
    // Process NO2 data
    if (Array.isArray(no2Data)) {
        no2Data.forEach(point => {
            // BL API uses DateTime field (not Timestamp)
            const timestamp = point.DateTime || point.Timestamp || point.date;
            if (!combined[timestamp]) {
                combined[timestamp] = { 
                    date: timestamp,
                    DateTime: timestamp // Preserve for consistency
                };
            }
            combined[timestamp].no2 = point.ScaledValue;
        });
    }
    
    // Process PM2.5 data
    if (Array.isArray(pm25Data)) {
        pm25Data.forEach(point => {
            const timestamp = point.DateTime || point.Timestamp || point.date;
            if (!combined[timestamp]) {
                combined[timestamp] = { 
                    date: timestamp,
                    DateTime: timestamp // Preserve for consistency
                };
            }
            combined[timestamp].pm25 = point.ScaledValue;
        });
    }
    
    return Object.values(combined).sort((a, b) => 
        new Date(a.date) - new Date(b.date)
    );
}
