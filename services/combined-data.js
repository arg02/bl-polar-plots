/**
 * Service to fetch combined MY1 and CLDP0016 data
 * MY1 data (NO2, ws, wd) comes from openair via R service
 * CLDP0016 NO2 data comes from Breathe London API
 */

import { fetchHourlyData } from './api.js';

const R_SERVICE_URL = import.meta.env.VITE_R_SERVICE_URL
    || (import.meta.env.DEV ? '/r-api' : 'http://localhost:8000');

/**
 * Fetch combined MY1 and CLDP0016 data
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<Object>} Combined data with date, ws, wd, my1_no2, cldp0016_no2
 */
export async function fetchCombinedMY1CLDP0016(startDate, endDate) {
    try {
        // Fetch CLDP0016 NO2 data from BL API
        const cldp0016Data = await fetchHourlyData('CLDP0016', 'INO2', startDate, endDate);
        
        console.log(`Fetched ${cldp0016Data.length} CLDP0016 records from BL API`);
        
        // Format dates for R service
        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];
        
        // Prepare CLDP0016 data for R service
        // R service expects list with DateTime and ScaledValue vectors
        const cldp0016Formatted = {
            DateTime: cldp0016Data.map(point => point.DateTime || point.Timestamp || point.date),
            ScaledValue: cldp0016Data.map(point => point.ScaledValue)
        };
        
        // Call R service to combine with MY1 data
        const response = await fetch(`${R_SERVICE_URL}/combine-my1-cldp0016`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                cldp0016_data: cldp0016Formatted,
                startDate: startDateStr,
                endDate: endDateStr
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(`R service error: ${response.status} - ${errorData.error || response.statusText}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error || 'Failed to combine data');
        }
        
        // Convert R service response to array of objects
        const combined = [];
        const data = result.data;
        const length = data.date.length;
        
        for (let i = 0; i < length; i++) {
            combined.push({
                date: data.date[i],
                ws: data.ws[i],
                wd: data.wd[i],
                my1_no2: data.my1_no2[i],
                cldp0016_no2: data.cldp0016_no2[i]
            });
        }
        
        console.log(`Combined data: ${combined.length} records`);
        console.log(`  Records with MY1 NO2: ${result.metadata.recordsWithMY1}`);
        console.log(`  Records with CLDP0016 NO2: ${result.metadata.recordsWithCLDP0016}`);
        console.log(`  Records with both: ${result.metadata.recordsWithBoth}`);
        
        return {
            data: combined,
            metadata: result.metadata
        };
    } catch (error) {
        console.error('Error fetching combined MY1/CLDP0016 data:', error);
        throw error;
    }
}
