# Breathe London community polar plots — process notes (2025)

Canonical process doc for generating, summarising, and deploying polar plots on the Breathe London `/sensor-info` page. Source scripts and batch PNGs live in **`arg02/bl-polar-plots`**; the production Squarespace widget is **`erg-ic/sensor-polar-plot`**.

> **Jan 2027 reminder — do this first when you reopen the repo**
>
> **Regenerate all plots and summaries for calendar year 2026 in January 2027.**
>
> - Annual window: Jan–Dec **2026**
> - Winter (meteorological DJF): **Dec 2025 – Feb 2026**
> - Spring: Mar–May 2026 · Summer: Jun–Aug 2026 · Autumn: Sep–Nov 2026
> - Refresh Bloomberg active list (`EndDate` null), allowlist, PNGs, readings JSON, seasonal manifest, then ship via `sensor-polar-plot` → GCS.
>
> Tracking issues: [erg-ic/sensor-polar-plot#1](https://github.com/erg-ic/sensor-polar-plot/issues/1) · [arg02/bl-polar-plots#1](https://github.com/arg02/bl-polar-plots/issues/1)

---

## 1. Aim

Show **wind–pollution polar plots** on each eligible community sensor’s node-info page so people can see whether high concentrations sit in calm air (local build-up) or arrive more clearly from a wind direction.

- **Production:** Squarespace embed on `https://www.breathelondon-communities.org/sensor-info?sitecode=…`
- **UI:** Leaflet map + transparent annual polar PNG overlay, pollutant switcher (NO₂ / PM₂.₅), site “reading” paragraphs, example local vs distant source diagrams under the map caveat, and **Explore more…** (seasonal plot picker when assets exist).
- **Audience sites:** Bloomberg Philanthropies community/cultural nodes that are still open (`EndDate` null), plus a small **allowlist** of non-Bloomberg sitecodes (same gate in the widget and in R batch scripts).

Local development / batch generation happens in this repo (`bl-polar-plots` Vite mock). Production assets and the embed bundle ship from `sensor-polar-plot`.

---

## 2. How plots were created

### Method

- R **`openair::polarPlot`** (custom drawn via lattice `levelplot` for transparent PNG + map-friendly rings/labels).
- Pollution: Breathe London Clarity API **hourly** (`INO2`, `IPM25`) for the site.
- Wind: AURN **MY1** (Marylebone Road) via `openair::importAURN` — shared meteorology for all sites (directional hints are approximate).
- API key: same Clarity key already used in existing R scripts / env (do not paste new secrets into docs).

### Time windows (2025 product)

| Product | Window |
| --- | --- |
| Annual | Full calendar **2025** (1 Jan – 31 Dec 2025) |
| Winter | Contiguous DJF: **1 Dec 2024 – 28 Feb 2025** |
| Spring | Mar–May 2025 |
| Summer | Jun–Aug 2025 |
| Autumn | Sep–Nov 2025 |

Minimum hours (approx.): annual ≥ 100 matched hours; seasonal ≥ 50.

### Palette & PNG naming

- Colour ramp: openair-style default with **purple top** (`COLS_PURPLE_TOP` / `COLS_DEFAULT_PURPLE_TOP` in the generate scripts). Soft pink rings (`#C4789A`), black wind-speed / N·E·S·W labels for map readability.
- Annual: `{sitecode-lower}-{no2\|pm25}-polar-2025.png`  
  e.g. `cldp0299-no2-polar-2025.png`
- Seasonal: `{sitecode-lower}-{no2\|pm25}-polar-2025-{winter\|spring\|summer\|autumn}.png`
- Written under `public/` in this repo; copied into `sensor-polar-plot/public/` for deploy.

### Key R scripts (`server/`)

| Script | Role |
| --- | --- |
| `generate-community-polar-2025.R` | Batch annual PNGs |
| `generate-community-polar-2025-seasons.R` | Batch seasonal PNGs + writes `public/polar-seasonal-sites.json` |
| `summarise-community-polar-2025.R` | Annual stats → `community-polar-2025-summaries.json` |
| `summarise-community-polar-2025-seasons.R` | Seasonal surface stats + `draft_season_text()` → merges season blurbs into readings JSON |
| `generate-cldp0299-polar-2025*.R` / `*-seasons.R` | Single-site / palette trials (historical) |
| `community-sensors-bloomberg-active.csv` (+ `.md`) | Site list used for Bloomberg batches |

**Allowlist** (keep in sync with `POLAR_PLOT_ALLOWLIST` in `sensor-polar-plot/src/main.js`):

```r
EXTRA_SITECODES <- c("CLDP0517", "CLDP0451", "CLDP0308")
```

Env knobs used in batches: `ONLY_SITE`, `ONLY_SEASON`, `FORCE`, `MAX_SENSORS`, `SKIP_COMPLETE`.

### Sites & known gaps (2025)

- **Included:** sitecodes from `community-sensors-bloomberg-active.csv` (Bloomberg, open) **plus** allowlist above.
- **CLDP0664** (International House): no usable 2025 Clarity hourly when last generated → **no annual or seasonal PNGs**.
- **CLDP0651** (British Library): annual OK (data from ~Apr 2025); **winter seasonal PNGs omitted** — no contiguous Dec–Feb coverage (site started late April 2025). Not in full seasonal manifest until winter exists.
- **CLDP0392**: annual OK; **spring seasonal incomplete** (insufficient hours / failed season) → not a full 8-file seasonal set.

Seasonal picker only lists sitecodes in `public/polar-seasonal-sites.json` (full 8-PNG set).

---

## 3. How text summaries were created

Readings file: `public/polar-readings-2025.json` (also under `docs/node-info/` when Pages mock is built; production copies to `sensor-polar-plot/public/`).

Shape per sitecode:

```json
{
  "CLDP0299": {
    "no2": {
      "paragraphs": ["…", "…"],
      "seasons": { "winter": "…", "spring": "…", "summer": "…", "autumn": "…" }
    },
    "pm25": { "paragraphs": ["…"], "seasons": { } }
  }
}
```

### Annual paragraphs

1. Run `summarise-community-polar-2025.R` → `server/community-polar-2025-summaries.json` (calm/windy means, sector contrast under stronger winds, pattern tags).
2. Run the Python template filler:

   **`server/generate-polar-readings-from-summaries.py`**

   (Recovered/reconstructed July 2026 — original was an uncommitted one-off; wording matches the shipped 2025 JSON.)

   - **para1:** calm/local — peak near centre → highest when air is still, nearby sources.
   - **para2:** if `sector_windy.contrast >= 1.7` → clear “highest when wind from {peak}”; else softer “directional pattern is weaker” comparing peak vs low sector.

3. Output / merge into `polar-readings-2025.json` **paragraphs** (script preserves existing `seasons` by default).

```bash
# After a full summarise-community-polar-2025.R run:
python3 server/generate-polar-readings-from-summaries.py \
  --summaries server/community-polar-2025-summaries.json \
  --out public/polar-readings-2025.json
```

Note: as of mid-2026 the checked-in `community-polar-2025-summaries.json` may only hold the **allowlist** re-run. Re-run the R summariser for the full site list before regenerating all annual paragraphs.

### Seasonal blurbs

- **Not** the annual paragraph templates.
- `summarise-community-polar-2025-seasons.R` builds an openair `polarPlot(..., plot = FALSE)` **z-grid**, classifies calm-local / directional / mixed, then `draft_season_text()` writes short season strings and merges them into `polar-readings-2025.json` under `seasons` only.
- Intermediate stats: `server/community-polar-2025-season-stats.json` (also copied to `public/` when useful).

**History / caveat:** Early seasonal copy that reused annual templates was misleading (e.g. calm-dominated annual text on a summer lobe). Current text is surface-stats-based and better aligned with the seasonal PNGs, but **we may still want better / human-reviewed template language for seasonal blurbs**.

---

## 4. Deployment pipeline

```text
bl-polar-plots (generate PNGs + JSON)
        │  copy public assets
        ▼
erg-ic/sensor-polar-plot (widget source)
        │  push main
        ▼
GitHub Actions (.github/workflows/build-and-deploy-to-cloud.yml)
        │  npm ci/build → upload dist/
        ▼
gs://static.erg.ic.ac.uk/sensor-polar-plot/
        │
        ▼
Squarespace Code block loads:
https://storage.googleapis.com/static.erg.ic.ac.uk/sensor-polar-plot/dist/assets/index.js
```

### Local mock (`bl-polar-plots`)

```bash
npm install && npm run dev
# e.g. http://localhost:3001/?sitecode=CLDP0299&species=both
```

Leaflet overlay + readings live under `components/polar-plot/` (`polar-map-view.js`, `polar-readings.js`, `polar-image-url.js`).

### Widget gate (runtime)

On mount, fetch sensor metadata; **render only if**:

- `EndDate` is null/empty, **and**
- `SponsorName === "Bloomberg Philanthropies"` **or** sitecode ∈ `{CLDP0517, CLDP0451, CLDP0308}`

Otherwise leave `#app-polar-plot` empty/hidden.

### Asset URLs (production)

Prefix: `https://storage.googleapis.com/static.erg.ic.ac.uk/sensor-polar-plot/dist/`

| Asset | Path |
| --- | --- |
| Annual PNG | `{code}-{no2\|pm25}-polar-2025.png` |
| Seasonal PNG | `{code}-{no2\|pm25}-polar-2025-{season}.png` |
| Readings | `polar-readings-2025.json` |
| Seasonal site list | `polar-seasonal-sites.json` |
| Bundle | `assets/index.js` (+ `assets/index.css`) |

`POLAR_ASSET_BASE` is set in `sensor-polar-plot/src/components/polar-plot/polar-image-url.js`.

---

## 5. Related files (quick index)

| Path | What |
| --- | --- |
| `server/generate-community-polar-2025.R` | Annual PNG batch |
| `server/generate-community-polar-2025-seasons.R` | Seasonal PNG batch + manifest |
| `server/summarise-community-polar-2025.R` | Annual metrics JSON |
| `server/summarise-community-polar-2025-seasons.R` | Seasonal stats + blurbs |
| `server/generate-polar-readings-from-summaries.py` | Annual paragraph templates |
| `server/community-sensors-bloomberg-active.csv` | Bloomberg open-site list |
| `public/polar-readings-2025.json` | Paragraphs + season blurbs |
| `public/polar-seasonal-sites.json` | Sites with full seasonal set |
| `public/community-polar-2025-season-stats.json` | Seasonal surface stats (optional copy) |
| `sensor-polar-plot/src/main.js` | Embed entry + eligibility gate |
| `sensor-polar-plot/src/widget-html.js` | Markup incl. Explore more (seasonals) / under-map examples |
| `sensor-polar-plot/src/components/polar-plot/*` | Map, readings, seasonals, image URLs |
| `.github/workflows/build-and-deploy-to-cloud.yml` | GCS deploy (prod repo) |

---

## 6. Suggested 2026 regeneration checklist (Jan 2027)

1. Refresh `community-sensors-bloomberg-active.csv` (Bloomberg + `EndDate` null); confirm allowlist still wanted.
2. Update `YEAR` / season date constants in generate + summarise R scripts (winter = Dec 2025–Feb 2026).
3. Run annual PNG batch → seasonal PNG batch → update `polar-seasonal-sites.json`.
4. Run annual summarise R → `generate-polar-readings-from-summaries.py`.
5. Run seasonal summarise R (`draft_season_text`) → merge seasons into readings JSON.
6. Copy PNGs + JSON into `sensor-polar-plot/public/`, bump filenames/year in `polar-image-url.js` / readings URL if year suffix changes.
7. Spot-check a few sites locally; push `sensor-polar-plot` `main` and confirm GCS + Squarespace.
8. Note remaining gaps (new installs mid-year, missing seasons).
9. Optionally improve seasonal blurb wording with a review pass.

---

## 7. Caveats for future-you

- MY1 wind is **not** local to each node; calm-centred patterns can look similar across London.
- Summaries are **draft interpretive text**, not formal source attribution.
- Don’t commit API keys into new files; reuse the existing R/env pattern.
- Keep `EXTRA_SITECODES` and `POLAR_PLOT_ALLOWLIST` in sync across repos.

---

## 8. Roadmap (not started)

- **Linked interpretation video** — add a short linked video (or embed) that explains how to read polar plots (calm/local vs wind-direction patterns, rings/colour). Do **not** implement until assets and copy are ready; track here so it isn’t forgotten when polishing the node-info UX.
