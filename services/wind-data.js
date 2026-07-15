/**
 * NOAA Integrated Surface Database (ISD) wind data service
 * For London, we use London Heathrow station: 037720-99999
 */

// NOAA ISD API endpoints
// Documentation: https://www.ncei.noaa.gov/products/land-based-station/integrated-surface-database
// API Docs: https://www.ncei.noaa.gov/support/access-data-service-api-user-documentation
const NOAA_ISD_BASE = 'https://www.ncei.noaa.gov/data/global-hourly/access';
const NOAA_API_BASE = 'https://www.ncei.noaa.gov/access/services/data/v1';
const LONDON_HEATHROW_CODE = '037720-99999';

/**
 * Fetch wind data from NOAA ISD for a date range
 * Uses NOAA's Global Hourly API endpoint
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @param {string} stationCode - NOAA station code (default: London Heathrow)
 * @returns {Promise<Array>} Array of wind data points with date, ws, wd
 */
export async function fetchNOAAWindData(startDate, endDate, stationCode = LONDON_HEATHROW_CODE) {
    try {
        console.log('Fetching NOAA wind data:', {
            stationCode,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString()
        });
        
        // Remove hyphen from station code for API call
        // London Heathrow: 037720-99999 -> 03772099999
        const apiStationCode = stationCode.replace(/-/g, '');
        
        // Format dates for API (YYYY-MM-DD)
        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];
        
        // Build NCEI API URL
        // Documentation: https://www.ncei.noaa.gov/support/access-data-service-api-user-documentation
        const url = `${NOAA_API_BASE}?dataset=global-hourly&stations=${apiStationCode}&startDate=${startDateStr}&endDate=${endDateStr}&dataTypes=WND&format=json`;
        
        console.log('NOAA API URL:', url);
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`NOAA API error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!Array.isArray(data)) {
            throw new Error('Unexpected NOAA API response format');
        }
        
        const windData = [];
        
        // Parse NOAA ISD JSON format
        // Each record has: DATE, WND (wind)
        // WND format: "dddd,sss,9,n" where:
        //   - dddd = wind direction in degrees (0-360)
        //   - sss = wind speed in 0.1 m/s units
        //   - 9 = quality code
        //   - n = source flag
        data.forEach(record => {
            if (!record.DATE || !record.WND) return;
            
            const recordDate = new Date(record.DATE);
            
            // Only include records within our date range
            if (recordDate >= startDate && recordDate <= endDate) {
                // Filter for hourly data only (00:00, 01:00, etc.)
                // Skip sub-hourly observations (00:20, 00:50, etc.)
                const minutes = recordDate.getUTCMinutes();
                if (minutes !== 0) {
                    return; // Skip non-hourly records
                }
                
                // Parse WND field
                // Format: "250,1,N,0036,1" = direction,angle_code,angle_quality,speed,speed_quality
                const windParts = record.WND.split(',');
                if (windParts.length >= 4) {
                    const direction = parseInt(windParts[0]); // degrees
                    const speedTenths = parseInt(windParts[3]); // speed in 0.1 m/s units
                    
                    if (!isNaN(direction) && !isNaN(speedTenths)) {
                        const ws = speedTenths / 10; // Convert to m/s
                        const wd = direction; // Already in degrees (0-360)
                        
                        // Only add if valid wind data
                        if (ws >= 0 && wd >= 0 && wd <= 360) {
                            windData.push({
                                date: recordDate.toISOString(),
                                ws: ws,
                                wd: wd
                            });
                        }
                    }
                }
            }
        });
        
        // Sort by date
        windData.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        console.log(`Fetched ${windData.length} hourly wind data points from ${data.length} total records`);
        
        // Check timestamp convention
        if (windData.length > 0) {
            const firstRecord = windData[0];
            const firstHour = new Date(firstRecord.date).getUTCHours();
            console.log(`First record hour: ${firstHour}:00`);
            
            if (firstHour === 0) {
                console.log('✓ Timestamp convention: HOUR BEGINNING (00:00 = 00:00-01:00 period)');
            }
        }
        
        if (windData.length === 0) {
            console.warn('No hourly wind data found. Check date range and station code.');
        }
        
        return windData;
    } catch (error) {
        console.error('Error fetching NOAA wind data:', error);
        throw error;
    }
}

/**
 * Combine pollution data with wind data by timestamp
 * 
 * TIMESTAMP CONVENTIONS:
 * - Breathe London API: Hour-beginning timestamps
 *   Example: "2026-01-20T15:00:00.000Z" with DurationNS=3600000000 (1 hour)
 *   represents pollution data for the hour 15:00-16:00
 * 
 * - NOAA ISD: Typically uses hour-ending timestamps (needs verification)
 *   Example: "2026-01-20T15:00:00Z" may represent wind data for 14:00-15:00
 *   OR hour-beginning (14:00-15:00) - MUST BE VERIFIED
 * 
 * - openair R package: Expects hour-beginning timestamps
 *   The date field should represent the start of the hour period
 * 
 * This function matches records by hour, handling potential offset differences.
 * 
 * @param {Array} pollutionData - Pollution data array from BL API (hour-beginning)
 * @param {Array} windData - Wind data array from NOAA (timestamp convention TBD)
 * @returns {Array} Combined data ready for openair format
 */
export function combinePollutionAndWind(pollutionData, windData) {
    const combined = [];
    const windMap = new Map();
    
    // TODO: VERIFY NOAA TIMESTAMP CONVENTION
    // If NOAA uses hour-ending, we may need to shift wind data by -1 hour
    // For now, assuming both use hour-beginning (needs verification)
    
    // Create lookup map for wind data by hour
    windData.forEach(point => {
        const date = new Date(point.date);
        // Create hour key (round to hour beginning)
        const hourKey = new Date(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            date.getUTCDate(),
            date.getUTCHours()
        ).toISOString();
        windMap.set(hourKey, point);
    });
    
    // Combine data - match pollution data with wind data
    pollutionData.forEach(point => {
        // BL API returns DateTime field (hour-beginning)
        // Format: "2026-01-20T15:00:00.000Z"
        const pollutionDate = new Date(point.DateTime || point.Timestamp || point.date || point.Date);
        if (isNaN(pollutionDate.getTime())) {
            console.warn('Invalid date in pollution data:', point);
            return;
        }
        
        // Create hour key (round to hour beginning)
        const hourKey = new Date(
            pollutionDate.getUTCFullYear(),
            pollutionDate.getUTCMonth(),
            pollutionDate.getUTCDate(),
            pollutionDate.getUTCHours()
        ).toISOString();
        
        const windPoint = windMap.get(hourKey);
        
        if (windPoint) {
            // Extract pollutant values
            // BL API returns ScaledValue field
            const no2 = point.ScaledValue || point.no2 || point.NO2 || point.INO2 || null;
            const pm25 = point.ScaledValue || point.pm25 || point.PM25 || point.IPM25 || null;
            
            combined.push({
                date: pollutionDate.toISOString(), // Keep original timestamp
                ws: windPoint.ws, // wind speed in m/s
                wd: windPoint.wd, // wind direction in degrees (0-360)
                no2: no2,
                pm25: pm25
            });
        }
    });
    
    console.log(`Combined ${combined.length} data points from ${pollutionData.length} pollution records and ${windData.length} wind records`);
    
    if (combined.length === 0) {
        console.warn('WARNING: No matching wind/pollution data found. Check timestamp alignment!');
        
        // Debug: Show sample timestamps from both datasets
        if (pollutionData.length > 0) {
            const samplePollution = pollutionData.slice(0, 5);
            console.log('Sample pollution timestamps:', samplePollution.map(d => {
                const date = new Date(d.DateTime || d.Timestamp || d.date || d.Date);
                return {
                    original: d.DateTime || d.Timestamp || d.date || d.Date,
                    parsed: date.toISOString(),
                    hour: date.getUTCHours()
                };
            }));
        }
        
        if (windData.length > 0) {
            const sampleWind = windData.slice(0, 5);
            console.log('Sample wind timestamps:', sampleWind.map(d => {
                const date = new Date(d.date);
                return {
                    original: d.date,
                    parsed: date.toISOString(),
                    hour: date.getUTCHours()
                };
            }));
        }
    }
    
    return combined;
}

/**
 * Format data for openair R package
 * @param {Array} data - Combined pollution and wind data
 * @param {string} pollutant - Pollutant to include ('no2' or 'pm25')
 * @returns {Object} Data formatted for openair
 */
export function formatForOpenAir(data, pollutant = 'no2') {
    return {
        date: data.map(d => d.date),
        ws: data.map(d => d.ws),
        wd: data.map(d => d.wd),
        [pollutant.toLowerCase()]: data.map(d => d[pollutant.toLowerCase()] || null)
    };
}
