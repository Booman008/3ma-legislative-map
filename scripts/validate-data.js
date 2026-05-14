const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

function readJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), "utf8"));
}

function fail(message) {
  throw new Error(message);
}

function normalizeCountyName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function validateLicenses(licensesPayload, countiesGeojson) {
  if (!licensesPayload || !Array.isArray(licensesPayload.licenses)) {
    fail("data/licenses.json must include a licenses array.");
  }
  if (licensesPayload.licenses.length === 0 || licensesPayload.total <= 0) {
    fail("License count must be greater than 0.");
  }
  if (licensesPayload.licenses.length !== licensesPayload.total) {
    fail(`License total mismatch: total=${licensesPayload.total}, rows=${licensesPayload.licenses.length}.`);
  }

  const invalid = licensesPayload.licenses.filter(license =>
    !license.id || !license.businessName || !license.type || !license.county
  );
  if (invalid.length) {
    fail(`Found ${invalid.length} license rows missing id, businessName, type, or county.`);
  }

  const countyTotal = Object.values(licensesPayload.countySummaries || {})
    .reduce((sum, summary) => sum + Number(summary.total || 0), 0);
  if (countyTotal !== licensesPayload.total) {
    fail(`County license summary total mismatch: ${countyTotal} vs ${licensesPayload.total}.`);
  }

  const dispensaryRows = licensesPayload.licenses.filter(license => license.type === "Dispensary").length;
  if (dispensaryRows !== licensesPayload.typeTotals?.Dispensary) {
    fail(`Dispensary count mismatch: ${dispensaryRows} vs ${licensesPayload.typeTotals?.Dispensary}.`);
  }

  const countyNames = new Set(countiesGeojson.features.map(feature => normalizeCountyName(feature.properties.NAME)));
  const unmatched = [...new Set(licensesPayload.licenses.map(license => license.county))]
    .filter(county => !countyNames.has(normalizeCountyName(county)));
  if (unmatched.length) {
    fail(`License records contain counties not found in counties.geojson: ${unmatched.join(", ")}.`);
  }
}

function validateCountyMetrics(countyMetricsPayload, countiesGeojson) {
  if (!countyMetricsPayload?.countyMetrics) {
    fail("data/county_metrics.json must include countyMetrics.");
  }

  const countyNames = countiesGeojson.features.map(feature => feature.properties.NAME);
  const expected = new Map(countyNames.map(name => [normalizeCountyName(name), name]));
  const actual = Object.keys(countyMetricsPayload.countyMetrics);

  if (countyNames.length !== 82) {
    fail(`Expected counties.geojson to contain 82 counties, found ${countyNames.length}.`);
  }
  if (actual.length !== 82 || countyMetricsPayload.counties !== 82) {
    fail(`Expected 82 county metric rows, found ${actual.length}.`);
  }

  const unmatched = actual.filter(name => !expected.has(normalizeCountyName(name)));
  if (unmatched.length) {
    fail(`County metrics contain names not found in counties.geojson: ${unmatched.join(", ")}.`);
  }

  const missing = countyNames.filter(name =>
    !actual.some(metricName => normalizeCountyName(metricName) === normalizeCountyName(name))
  );
  if (missing.length) {
    fail(`County metrics are missing counties from counties.geojson: ${missing.join(", ")}.`);
  }
}

function validateDataSources(dataSources) {
  if (!dataSources?.sources?.countyMetrics?.url) {
    fail("data/data_sources.json is missing countyMetrics source metadata.");
  }
  if (!dataSources?.sources?.licenses?.url) {
    fail("data/data_sources.json is missing licenses source metadata.");
  }
}

function main() {
  const licenses = readJson("licenses.json");
  const countyMetrics = readJson("county_metrics.json");
  const counties = readJson("counties.geojson");
  const dataSources = readJson("data_sources.json");

  validateLicenses(licenses, counties);
  validateCountyMetrics(countyMetrics, counties);
  validateDataSources(dataSources);

  console.log("Data validation complete.");
  console.log(`- Licenses: ${licenses.total}`);
  console.log(`- License counties: ${Object.keys(licenses.countySummaries).length}`);
  console.log(`- County metric rows: ${countyMetrics.counties}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
