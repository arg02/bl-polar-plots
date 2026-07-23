# Breathe London Node Info Page

Local recreation of the Breathe London sensor node info page with polar plot visualization.

**Polar plot process (generation, summaries, deploy, Jan 2027 regen):** [`docs/POLAR-PLOTS-PROCESS.md`](docs/POLAR-PLOTS-PROCESS.md). Production widget: [`erg-ic/sensor-polar-plot`](https://github.com/erg-ic/sensor-polar-plot).

## Setup

1. Install main project dependencies:
```bash
npm install
```

2. Build the component dependencies (optional - for local development):
```bash
# Build sensor-intro-widget
cd components/sensor-intro-widget && npm install && npm run build && cd ../..

# Build sensor-graph-linechart  
cd components/sensor-graph-linechart && npm install && npm run build && cd ../..

# Build individual-node-map
cd components/individual-node-map && npm install && npm run build && cd ../..
```

**Note**: The components can also be loaded from their CDN URLs (as they are in production). See `components/load-components.js` to configure.

3. Set up environment variables (create `.env` file):
```bash
VITE_API_KEY=e2635276-e87a-11eb-9a03-0242ac130003
```

4. Start development server:
```bash
npm run dev
```

The page will be available at `http://localhost:3000`

## Usage

Access a sensor page with URL parameters (matching production site format):

**Required:**
- `?sitecode=CLDP0652` - Sensor ID (defaults to CLDP0652 if not provided)

**Optional:**
- `&species=both` - Pollutant species: `both`, `NO2`, or `PM25` (defaults to `both`)
- `&polarUI=studio` - Static “Wind Reading Room” restyle (skips the default map overlay)

**Examples:**
- `http://localhost:3001?sitecode=CLDP0299` - Polar plot on the map (default)
- `http://localhost:3001?sitecode=CLDP0299&species=both` - Same, with species set
- `http://localhost:3001?sitecode=CLDP0299&polarUI=studio` - Static studio restyle (no map)
- `http://localhost:3001` - Uses defaults (CLDP0299, both)

**Note:** The page will work without URL parameters using defaults, but for proper functionality matching the production site, include the `sitecode` parameter. Dev server port is **3001** (see `vite.config.js`).

The polar section defaults to a transparent polar PNG overlaid on a Leaflet map (CARTO/Esri basemaps; no Mapbox token).

## Deploying the node mockup (GitHub Pages)

Co-located comparison pages are already published from the repo’s **`docs/`** folder on branch **`reference-comparison`**:

- Live site: https://arg02.github.io/bl-polar-plots/
- GitHub → Settings → Pages → Deploy from a branch → `reference-comparison` / `/docs`
- No Actions workflow and no `gh-pages` branch; pushing to that branch updates Pages.
- `public/colocated-comparisons/` is a local/Vite copy of the same static HTML+PNG set; **Pages serves `docs/` only**, not the Vite app and not all of `public/`.

The Vite node mockup is **not** on Pages yet (source lives at repo root: `index.html`, `main.js`, etc.). Recommended: keep comparisons at the site root and publish the mockup under `/node-info/`.

1. `VITE_API_KEY` already has a client fallback matching production widgets (optional in `.env`).
2. Fix root-absolute asset URLs before a project-Pages build (or overlays/`what-can-i-do` break). Prefer `import.meta.env.BASE_URL` for paths like `/cldp0299-*.png` and `/sections/what-can-i-do.html` in `components/polar-plot/polar-map-view.js` and `main.js`.
3. Build into `docs/node-info` with the project base path:

```bash
npm install
npm run build -- --base /bl-polar-plots/node-info/ --outDir docs/node-info
```

4. Commit `docs/node-info/` (built assets only is enough to publish) and push `reference-comparison`. Do not overwrite `docs/index.html` (that is the comparisons hub).
5. After Pages refreshes:

- Default (map): `https://arg02.github.io/bl-polar-plots/node-info/?sitecode=CLDP0299&species=both`
- Studio UI: `...?sitecode=CLDP0299&polarUI=studio`

**Gotchas**

- This is a **project** site (`username.github.io/repo/`), so Vite `base` must be `/bl-polar-plots/node-info/` (trailing slash). Default `base: '/'` breaks JS/CSS.
- Dev-only Vite proxies (`/api/s3-proxy`, `/r-api`, local linechart) do **not** exist on Pages; widgets load from GCS CDN. R/openair helpers that call `localhost:8000` will not work remotely.
- Vite also copies all of `public/` into the build output (including `colocated-comparisons/`); that nested copy under `node-info/` is unused on Pages—safe to delete from `docs/node-info` before committing if you want a smaller tree.

## Components

### Existing Components (from GitHub)

- `sensor-intro-widget` - Vue 3 component for sensor metadata display
  - Repo: https://github.com/erg-ic/sensor-intro-widget
  - Reads `sitecode` from URL params
  
- `sensor-graph-linechart` - React component for hourly pollution graphs
  - Repo: https://github.com/erg-ic/sensor-graph-linechart
  - Initialized via `reactWidget.init()` with config
  
- `individual-node-map` - Vue 3 component for map visualization
  - Repo: https://github.com/erg-ic/individual-node-map
  - Reads `sitecode` from URL params

### New Components

- `sensor-polar-plot` - Polar plot with wind-pollution correlation
  - Dual implementation: R/openair server-side and JavaScript client-side
  - Overlays on Leaflet map with geospatial alignment

## Features

- ✅ Local recreation of Breathe London sensor node info page
- ✅ API integration for sensor metadata and pollution data
- ✅ Component loading framework for existing widgets
- 🚧 Polar plot visualization comparing pollution with wind speed/direction
- 🚧 Dual implementation: R/openair server-side and JavaScript client-side
- 🚧 Map overlay with geospatial alignment
- 🚧 NOAA wind data integration

## Project Structure

```
bl-polar-plots/
├── components/
│   ├── sensor-intro-widget/      # Vue component (cloned)
│   ├── sensor-graph-linechart/    # React component (cloned)
│   ├── individual-node-map/       # Vue component (cloned)
│   ├── polar-plot/                # New polar plot component
│   └── load-components.js         # Component loader
├── services/
│   ├── api.js                     # Breathe London API client
│   └── wind-data.js               # NOAA wind data service
├── utils/
│   └── leaflet-basemaps.js        # Free CARTO/Esri Leaflet tile layers
├── index.html                     # Main page
├── main.js                        # App entry point
└── styles.css                     # Styles
```

## Next Steps

1. Build the three component dependencies (see Setup above)
2. Implement NOAA wind data fetching
3. Set up R service for server-side polar plots
4. Implement client-side JavaScript polar plot
5. Refine Leaflet polar map overlay
