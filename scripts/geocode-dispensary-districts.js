const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const LICENSES_FILE = path.join(DATA_DIR, "licenses.json");
const CACHE_FILE = path.join(DATA_DIR, "dispensary_geocode_cache.json");
const COUNTIES_FILE = path.join(DATA_DIR, "counties.geojson");
const HOUSE_FILE = path.join(DATA_DIR, "house.geojson");
const SENATE_FILE = path.join(DATA_DIR, "senate.geojson");
const GEOCODER_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const CONCURRENCY = 6;

function readJson(filename, fallback = null) {
  if (!fs.existsSync(filename)) return fallback;
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function writeJson(filename, payload) {
  fs.writeFileSync(filename, `${JSON.stringify(payload, null, 2)}\n`);
}

function normalizeAddress(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function normalizeCounty(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function districtNumber(feature) {
  return String(Number(
    feature.properties?.Distnum
    || feature.properties?.DISTRICT_4
    || feature.properties?.DISTRICT_3
    || feature.properties?.LABEL
  ));
}

function pointOnSegment(point, start, end) {
  const [x, y] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const cross = (y - y1) * (x2 - x1) - (x - x1) * (y2 - y1);
  if (Math.abs(cross) > 1e-10) return false;
  return x >= Math.min(x1, x2) && x <= Math.max(x1, x2)
    && y >= Math.min(y1, y2) && y <= Math.max(y1, y2);
}

function pointInRing(point, ring) {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const a = ring[current];
    const b = ring[previous];
    if (pointOnSegment(point, a, b)) return true;
    const intersects = ((a[1] > point[1]) !== (b[1] > point[1]))
      && (point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, coordinates) {
  if (!pointInRing(point, coordinates[0])) return false;
  return !coordinates.slice(1).some(hole => pointInRing(point, hole));
}

function featureContainsPoint(feature, point) {
  const geometry = feature.geometry;
  if (geometry.type === "Polygon") return pointInPolygon(point, geometry.coordinates);
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some(polygon => pointInPolygon(point, polygon));
  }
  return false;
}

function containingDistrict(features, point) {
  const feature = features.find(candidate => featureContainsPoint(candidate, point));
  return feature ? districtNumber(feature) : null;
}

async function geocode(address) {
  const params = new URLSearchParams({
    address,
    benchmark: "Public_AR_Current",
    format: "json"
  });
  const response = await fetch(`${GEOCODER_URL}?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "3MA Legislative Map dispensary district assignment"
    }
  });
  if (!response.ok) throw new Error(`Geocoder returned ${response.status}.`);
  const payload = await response.json();
  const match = payload.result?.addressMatches?.[0];
  if (!match?.coordinates) {
    return { status: "unmatched" };
  }
  return {
    status: "matched",
    lat: Number(match.coordinates.y),
    lng: Number(match.coordinates.x),
    matchedAddress: match.matchedAddress || address
  };
}

async function mapWithConcurrency(items, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run));
  return results;
}

function buildSummaries(licenses) {
  const summaries = { house: {}, senate: {} };
  for (const license of licenses) {
    if (!license.isDispensary || license.geocodeStatus !== "matched") continue;
    for (const chamber of ["house", "senate"]) {
      const district = license[`${chamber}District`];
      if (!district) continue;
      if (!summaries[chamber][district]) summaries[chamber][district] = [];
      summaries[chamber][district].push(license.id);
    }
  }
  for (const chamber of ["house", "senate"]) {
    for (const district of Object.keys(summaries[chamber])) {
      summaries[chamber][district].sort();
    }
  }
  return summaries;
}

async function main() {
  const payload = readJson(LICENSES_FILE);
  const house = readJson(HOUSE_FILE);
  const senate = readJson(SENATE_FILE);
  const counties = readJson(COUNTIES_FILE);
  const existingCache = readJson(CACHE_FILE, { addresses: {} });
  const cache = { ...existingCache, addresses: { ...(existingCache.addresses || {}) } };
  for (const license of payload.licenses) {
    delete license.geocodeStatus;
    delete license.geocodeLabel;
    delete license.lat;
    delete license.lng;
    delete license.houseDistrict;
    delete license.senateDistrict;
  }
  const dispensaries = payload.licenses.filter(license => license.type === "Dispensary");

  await mapWithConcurrency(dispensaries, async (license, index) => {
    const address = normalizeAddress(license.physicalAddress);
    let result = cache.addresses[address];
    if (!result) {
      try {
        result = await geocode(address);
      } catch (error) {
        result = { status: "error", error: error.message };
      }
      cache.addresses[address] = result;
      console.log(`[${index + 1}/${dispensaries.length}] ${license.id}: ${result.status}`);
    }

    license.geocodeStatus = result.status;
    if (result.status !== "matched") return;
    const point = [result.lng, result.lat];
    const countyFeature = counties.features.find(feature => featureContainsPoint(feature, point));
    if (normalizeCounty(countyFeature?.properties?.NAME) !== normalizeCounty(license.county)) {
      license.geocodeStatus = "county-mismatch";
      return;
    }
    const houseDistrict = containingDistrict(house.features, point);
    const senateDistrict = containingDistrict(senate.features, point);
    if (!houseDistrict || !senateDistrict) {
      license.geocodeStatus = "outside-boundaries";
      return;
    }
    license.lat = result.lat;
    license.lng = result.lng;
    license.geocodeLabel = result.matchedAddress;
    license.houseDistrict = houseDistrict;
    license.senateDistrict = senateDistrict;
  });

  const matched = dispensaries.filter(license => license.geocodeStatus === "matched").length;
  const unmatched = dispensaries.length - matched;
  const generatedAt = new Date().toISOString();
  payload.dispensaryDistrictSummaries = buildSummaries(payload.licenses);
  payload.dispensaryGeocoding = {
    provider: "U.S. Census Geocoder",
    generatedAt,
    total: dispensaries.length,
    matched,
    unmatched
  };
  cache.generatedAt = generatedAt;
  cache.provider = "U.S. Census Geocoder";

  writeJson(CACHE_FILE, cache);
  writeJson(LICENSES_FILE, payload);
  console.log(`Dispensary geocoding complete: ${matched} matched, ${unmatched} unmatched.`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
