# 3MA Mississippi Legislative Map MVP

This folder now contains a static MVP for the interactive map described in `mississippi_interactive_map_plan.html`.

## Run Locally

Start a simple static server from this directory:

```powershell
npx.cmd serve . -l 4173
```

Then open `http://localhost:4173`.

## Refresh Data

Regenerate the app JSON files after updating the tracksheet, MSDH license export, county summary CSV, or legislator headshots:

```powershell
npm run import:data
```

The importer writes `data/legislators.json`, `data/licenses.json`, and `data/county_metrics.json`.

## What Is Included

- Leaflet-based interactive Mississippi map.
- Local simplified GeoJSON layers for counties, 2025 court-approved MS House districts, and 2025 court-approved MS Senate districts.
- Layer toggles, county/district/business/legislator/address search, click details, permanent county base boundaries, and party-colored legislative districts.
- Boundary controls are single-select: Counties, MS House, or MS Senate. County outlines remain as the base geography under district layers.
- A side panel with House and Senate member details from the 3MA public scorecard tracksheet, legislator headshots, and county-level MMCP patient, practitioner, and license counts.
- Active-license county summaries and dispensary records from the MSDH business-search CSV.
- 3MA-branded UI styling based on `3MA_Brand_Style_Guide_AI_Agent.md`.

## Data Notes

- `data/house.geojson` and `data/senate.geojson` were generated from the MARIS court-approved May 7, 2025 ZIP files in this folder.
- `data/counties.geojson` was generated from U.S. Census 2025 cartographic boundary shapefiles.
- `data/legislators.json` was generated from `3MA Mississippi Legislature Tracksheet - Scorecard_Public (1).csv`.
- Legislator cards use photos from `Legislator Headshots/` when a matching file is available.
- `data/licenses.json` was generated from `Business Search  MedCann (72).csv`.
- `data/county_metrics.json` was generated from `5.13.26 County Summary Dataset.csv`. The Patients tally uses only the source CSV's `num_patients` field by county.
- Patient, practitioner, dispensary, and licensed business tallies display only for county selections. District views intentionally do not estimate county-level MMCP totals.
- U.S. House/congressional boundaries and member details are deferred to a later build.
- `scripts/import-data.js` is the repeatable importer for tracksheet, license, county summary, and headshot data.
- Address search uses OpenStreetMap Nominatim only after the user clicks Find or presses Enter. It is rate-limited and cached in memory for the current browser session.

## Branding Notes

- Official logo: `Media/New3MALogo_With_Lettering (3).png`.
- Brand colors follow the 3MA guide: navy `#071f40`, navy tint `#0d2d5c`, gold `#ebab22`, red `#c21f32`, white, light gray, and dark gray.
- Montserrat is used for headings, labels, buttons, statistics, and badges. Raleway is used for body copy and detail text.
- Party coloring is retained as a map-specific semantic convention: Republican districts use 3MA red, Democratic districts use navy tint.

## WordPress Hosting Path

For a first public test, deploy these static files to Netlify/Vercel or a WordPress-accessible static directory and embed the page in WordPress with an iframe. Keep private member/contact notes out of this public static build.
