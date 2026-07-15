import { fetchSensorMetadata } from '../../services/api.js';
import { fetchHourlyData } from '../../services/api.js';
import { fetchNOAAWindData, combinePollutionAndWind, formatForOpenAir } from '../../services/wind-data.js';
import { generatePolarPlotCanvas } from './polar-plot-canvas.js';

// R/openair service URL
// Start the R service with: cd server && Rscript -e "plumber::pr('r-service.R') %>% plumber::pr_run(port=8000)"
const R_SERVICE_URL = import.meta.env.VITE_R_SERVICE_URL || 'http://localhost:8000';

/**
 * Generate polar plot using R/openair server
 * @param {string} sitecode - Sensor site code
 * @param {string} pollutant - Pollutant ('NO2' or 'PM25')
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<Object>} Plot image and metadata
 */
export async function generateRPolarPlot(sitecode, pollutant, startDate, endDate) {
    try {
        // Fetch data
        const [pollutionData, windData] = await Promise.all([
            fetchHourlyData(sitecode, pollutant === 'NO2' ? 'INO2' : 'IPM25', startDate, endDate),
            fetchNOAAWindData(startDate, endDate)
        ]);
        
        // Combine data
        const combinedData = combinePollutionAndWind(pollutionData, windData);
        const formattedData = formatForOpenAir(combinedData, pollutant);
        
        // Send to R service
        const response = await fetch(`${R_SERVICE_URL}/polar-plot`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                data: formattedData,
                pollutant: pollutant.toLowerCase(),
                sitecode
            })
        });
        
        if (!response.ok) {
            throw new Error(`R service error: ${response.status}`);
        }
        
        const result = await response.json();
        return result;
    } catch (error) {
        console.error('Error generating R polar plot:', error);
        throw error;
    }
}

/**
 * Generate polar plot using client-side JavaScript
 * @param {string} sitecode - Sensor site code
 * @param {string} pollutant - Pollutant ('NO2' or 'PM25')
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<Object>} Plot canvas/image and metadata
 */
export async function generateJSPolarPlot(sitecode, pollutant, startDate, endDate) {
    try {
        // Fetch sensor metadata for location
        const sensorMetadata = await fetchSensorMetadata(sitecode);
        
        // Fetch data
        const [pollutionData, windData] = await Promise.all([
            fetchHourlyData(sitecode, pollutant === 'NO2' ? 'INO2' : 'IPM25', startDate, endDate),
            fetchNOAAWindData(startDate, endDate)
        ]);
        
        console.log(`Fetched ${pollutionData.length} pollution records and ${windData.length} wind records`);
        
        // Combine data
        const combinedData = combinePollutionAndWind(pollutionData, windData);
        
        console.log(`Combined ${combinedData.length} data points for polar plot`);
        
        if (combinedData.length === 0) {
            // Provide more detailed error message
            let errorMsg = 'No matching pollution and wind data found.\n\n';
            errorMsg += `Pollution records: ${pollutionData.length}\n`;
            errorMsg += `Wind records: ${windData.length}\n\n`;
            errorMsg += 'Possible causes:\n';
            errorMsg += '1. Date range has no data available\n';
            errorMsg += '2. Timestamp mismatch between datasets\n';
            errorMsg += '3. Data not yet available for selected dates\n\n';
            errorMsg += 'Try:\n';
            errorMsg += '- Use a date range with known data (e.g., last 30 days)\n';
            errorMsg += '- Check browser console for detailed timestamp information';
            
            throw new Error(errorMsg);
        }
        
        // Generate plot using client-side implementation
        const plot = await generatePolarPlotJS(combinedData, pollutant, sensorMetadata);
        
        return plot;
    } catch (error) {
        console.error('Error generating JS polar plot:', error);
        throw error;
    }
}

/**
 * Client-side polar plot generation using Canvas API
 * Implements openair-style polar plot algorithm
 */
async function generatePolarPlotJS(data, pollutant, sensorLocation = null) {
    if (!data || data.length === 0) {
        throw new Error('No data provided for polar plot');
    }
    
    // Get sensor location for metadata
    const center = sensorLocation 
        ? [sensorLocation.Latitude, sensorLocation.Longitude]
        : [0, 0];
    
    // Default radius (5km) - can be adjusted based on data
    const radius = 5000; // meters
    
    // Generate plot
    const result = generatePolarPlotCanvas(data, pollutant.toLowerCase(), {
        width: 600,
        height: 600,
        radius: radius,
        center: center
    });
    
    return {
        canvas: result.canvas,
        imageUrl: result.canvas.toDataURL('image/png'), // Convert to data URL for display
        metadata: {
            ...result.metadata,
            pollutant: pollutant,
            method: 'javascript'
        }
    };
}

/**
 * Main function to generate polar plot(s) based on method
 */
export async function generatePolarPlot(sitecode, pollutant, method, startDate, endDate) {
    const results = {};
    
    if (method === 'r' || method === 'both') {
        try {
            results.r = await generateRPolarPlot(sitecode, pollutant, startDate, endDate);
        } catch (error) {
            console.error('R plot generation failed:', error);
            results.r = { error: error.message };
        }
    }
    
    if (method === 'js' || method === 'both') {
        try {
            results.js = await generateJSPolarPlot(sitecode, pollutant, startDate, endDate);
        } catch (error) {
            console.error('JS plot generation failed:', error);
            results.js = { error: error.message };
        }
    }
    
    return results;
}
