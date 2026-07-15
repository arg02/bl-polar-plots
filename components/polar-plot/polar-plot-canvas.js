/**
 * Client-side polar plot generation using HTML5 Canvas
 * Implements the openair polarPlot algorithm in JavaScript
 * 
 * Algorithm:
 * 1. Bin data by wind direction (10° intervals = 36 bins) and wind speed
 * 2. Calculate mean pollutant concentration per bin
 * 3. Render as polar plot with color-coded heatmap
 */

/**
 * Generate polar plot using Canvas API
 * @param {Array} data - Combined pollution and wind data
 * @param {string} pollutant - Pollutant name ('no2' or 'pm25')
 * @param {Object} options - Plot options
 * @returns {Object} Canvas element and metadata
 */
export function generatePolarPlotCanvas(data, pollutant, options = {}) {
    const {
        width = 600,
        height = 600,
        radius = 5000, // meters (default radius for distance circles)
        center = [0, 0] // lat, lng (will be set from sensor location)
    } = options;

    // Create canvas element
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Filter valid data points
    const validData = data.filter(d => {
        const value = pollutant === 'no2' ? d.no2 : d.pm25;
        return value !== null && 
               value !== undefined && 
               !isNaN(value) &&
               d.ws !== null && 
               d.wd !== null &&
               d.ws >= 0 && 
               d.wd >= 0 && 
               d.wd <= 360;
    });

    if (validData.length === 0) {
        // Draw empty plot message
        ctx.fillStyle = '#666';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('No data available', width / 2, height / 2);
        return { canvas, metadata: { radius, center, dataPoints: 0 } };
    }

    // Extract pollutant values
    const values = validData.map(d => pollutant === 'no2' ? d.no2 : d.pm25);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const valueRange = maxValue - minValue;

    // Bin data by wind direction (10° intervals) and wind speed
    const directionBins = 36; // 360° / 10° = 36 bins
    const speedBins = 30; // Wind speed bins
    
    // Create 2D bin array: [direction][speed] = { sum, count, values }
    const bins = Array(directionBins).fill(null).map(() => 
        Array(speedBins).fill(null).map(() => ({ sum: 0, count: 0, values: [] }))
    );

    // Find max wind speed for normalization
    const maxWindSpeed = Math.max(...validData.map(d => d.ws));

    // Bin the data
    validData.forEach(d => {
        const value = pollutant === 'no2' ? d.no2 : d.pm25;
        
        // Wind direction bin (0-360° → 0-35 bins)
        const directionBin = Math.floor(d.wd / 10) % directionBins;
        
        // Wind speed bin (normalized to 0-29)
        const speedBin = Math.min(
            Math.floor((d.ws / maxWindSpeed) * speedBins),
            speedBins - 1
        );
        
        bins[directionBin][speedBin].sum += value;
        bins[directionBin][speedBin].count += 1;
        bins[directionBin][speedBin].values.push(value);
    });

    // Calculate mean concentration per bin
    const binMeans = bins.map(dirBins => 
        dirBins.map(bin => bin.count > 0 ? bin.sum / bin.count : null)
    );

    // Find overall min/max for color scaling
    const allMeans = binMeans.flat().filter(v => v !== null);
    const meanMin = allMeans.length > 0 ? Math.min(...allMeans) : minValue;
    const meanMax = allMeans.length > 0 ? Math.max(...allMeans) : maxValue;
    const meanRange = meanMax - meanMin;

    // Set up canvas
    const centerX = width / 2;
    const centerY = height / 2;
    const plotRadius = Math.min(width, height) / 2 - 50; // Leave margin for labels

    // Clear canvas
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Draw distance circles (concentric circles representing distance from center)
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1;
    const numCircles = 5;
    for (let i = 1; i <= numCircles; i++) {
        const circleRadius = (plotRadius / numCircles) * i;
        ctx.beginPath();
        ctx.arc(centerX, centerY, circleRadius, 0, Math.PI * 2);
        ctx.stroke();
    }

    // Draw wind direction lines (N, E, S, W)
    ctx.strokeStyle = '#999999';
    ctx.lineWidth = 1;
    const directions = [
        { label: 'N', angle: -90 },
        { label: 'E', angle: 0 },
        { label: 'S', angle: 90 },
        { label: 'W', angle: 180 }
    ];
    directions.forEach(dir => {
        const angleRad = (dir.angle * Math.PI) / 180;
        const x1 = centerX + Math.cos(angleRad) * plotRadius;
        const y1 = centerY + Math.sin(angleRad) * plotRadius;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        
        // Label
        ctx.fillStyle = '#333333';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        const labelX = centerX + Math.cos(angleRad) * (plotRadius + 20);
        const labelY = centerY + Math.sin(angleRad) * (plotRadius + 20);
        ctx.fillText(dir.label, labelX, labelY);
    });

    // Draw polar plot heatmap
    // Each bin is a sector (direction) × ring (speed)
    const angleStep = (2 * Math.PI) / directionBins; // 10° in radians
    
    for (let dirBin = 0; dirBin < directionBins; dirBin++) {
        const angleStart = (dirBin * angleStep) - Math.PI / 2; // Start from North (-90°)
        const angleEnd = angleStart + angleStep;
        
        for (let speedBin = 0; speedBin < speedBins; speedBin++) {
            const meanValue = binMeans[dirBin][speedBin];
            
            if (meanValue === null) continue;
            
            // Calculate inner and outer radii for this speed bin
            const innerRadius = (plotRadius / speedBins) * speedBin;
            const outerRadius = (plotRadius / speedBins) * (speedBin + 1);
            
            // Color based on concentration
            const normalizedValue = meanRange > 0 
                ? (meanValue - meanMin) / meanRange 
                : 0.5;
            const color = getColorForValue(normalizedValue);
            
            // Draw sector
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, outerRadius, angleStart, angleEnd);
            ctx.arc(centerX, centerY, innerRadius, angleEnd, angleStart, true);
            ctx.closePath();
            ctx.fill();
        }
    }

    // Draw center point
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 3, 0, Math.PI * 2);
    ctx.fill();

    // Draw title
    ctx.fillStyle = '#333333';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`${pollutant.toUpperCase()} Polar Plot`, centerX, 30);

    // Draw legend (color scale)
    drawColorLegend(ctx, width - 150, 50, 20, 200, meanMin, meanMax, pollutant);

    return {
        canvas,
        metadata: {
            radius,
            center,
            dataPoints: validData.length,
            minValue: meanMin,
            maxValue: meanMax,
            bins: {
                direction: directionBins,
                speed: speedBins
            }
        }
    };
}

/**
 * Get color for normalized value (0-1)
 * Uses a color scale similar to openair (blue → green → yellow → red)
 */
function getColorForValue(normalized) {
    // Clamp to 0-1
    normalized = Math.max(0, Math.min(1, normalized));
    
    // Color scale: blue (low) → cyan → green → yellow → orange → red (high)
    if (normalized < 0.2) {
        // Blue to cyan
        const t = normalized / 0.2;
        return `rgb(${Math.floor(0 + t * 0)}, ${Math.floor(0 + t * 255)}, ${Math.floor(255 - t * 0)})`;
    } else if (normalized < 0.4) {
        // Cyan to green
        const t = (normalized - 0.2) / 0.2;
        return `rgb(${Math.floor(0)}, ${Math.floor(255)}, ${Math.floor(255 - t * 255)})`;
    } else if (normalized < 0.6) {
        // Green to yellow
        const t = (normalized - 0.4) / 0.2;
        return `rgb(${Math.floor(0 + t * 255)}, ${Math.floor(255)}, ${Math.floor(0)})`;
    } else if (normalized < 0.8) {
        // Yellow to orange
        const t = (normalized - 0.6) / 0.2;
        return `rgb(${Math.floor(255)}, ${Math.floor(255 - t * 128)}, ${Math.floor(0)})`;
    } else {
        // Orange to red
        const t = (normalized - 0.8) / 0.2;
        return `rgb(${Math.floor(255)}, ${Math.floor(127 - t * 127)}, ${Math.floor(0)})`;
    }
}

/**
 * Draw color legend
 */
function drawColorLegend(ctx, x, y, width, height, minVal, maxVal, pollutant) {
    const steps = 50;
    const stepHeight = height / steps;
    
    // Draw gradient
    for (let i = 0; i < steps; i++) {
        const normalized = i / (steps - 1);
        const color = getColorForValue(normalized);
        ctx.fillStyle = color;
        ctx.fillRect(x, y + i * stepHeight, width, stepHeight);
    }
    
    // Draw border
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, width, height);
    
    // Draw labels
    ctx.fillStyle = '#333333';
    ctx.font = '10px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(maxVal.toFixed(1), x + width + 5, y + 5);
    ctx.fillText(minVal.toFixed(1), x + width + 5, y + height - 5);
    
    // Unit label
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(pollutant === 'no2' ? 'NO₂ (µg/m³)' : 'PM₂.₅ (µg/m³)', x + width / 2, y + height + 15);
}
