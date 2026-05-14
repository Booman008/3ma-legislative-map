const DATA_URLS = {
  counties: "data/counties.geojson",
  house: "data/house.geojson",
  senate: "data/senate.geojson",
  legislators: "data/legislators.json",
  licenses: "data/licenses.json",
  countyMetrics: "data/county_metrics.json",
  dataSources: "data/data_sources.json"
};

const layerStyles = {
  counties: {
    color: "#071f40",
    weight: 1.15,
    fillColor: "#f4f5f7",
    fillOpacity: 0.34
  },
  house: {
    color: "#486070",
    weight: 1.1,
    fillColor: "#486070",
    fillOpacity: 0.13
  },
  senate: {
    color: "#486070",
    weight: 1.2,
    fillColor: "#486070",
    fillOpacity: 0.13
  },
  selected: {
    color: "#ebab22",
    weight: 3,
    fillOpacity: 0.42
  }
};

const PARTY_STYLES = {
  republican: {
    color: "#c21f32",
    fillColor: "#c21f32",
    fillOpacity: 0.18
  },
  democrat: {
    color: "#0d2d5c",
    fillColor: "#0d2d5c",
    fillOpacity: 0.18
  },
  independent: {
    color: "#071f40",
    fillColor: "#ffffff",
    fillOpacity: 0.82
  }
};

const PRIORITY_BILLS = [
  "SB 2095 (2022)",
  "HB 1158 (2023)",
  "HB 895 (2026)",
  "HB 1152 (2026)"
];

const BOUNDARY_LAYERS = ["counties", "house", "senate"];
const DISTRICT_BOUNDARY_LAYERS = ["house", "senate"];
const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_MIN_INTERVAL_MS = 1100;
const MISSISSIPPI_VIEWBOX = {
  west: -91.655,
  north: 35.008,
  east: -88.097,
  south: 30.173
};

const MISSISSIPPI_CITIES = [
  { name: "Jackson", lat: 32.2988, lng: -90.1848, rank: 1 },
  { name: "Gulfport", lat: 30.3674, lng: -89.0928, rank: 1 },
  { name: "Biloxi", lat: 30.3960, lng: -88.8853, rank: 2 },
  { name: "Hattiesburg", lat: 31.3271, lng: -89.2903, rank: 1 },
  { name: "Southaven", lat: 34.9889, lng: -90.0126, rank: 1 },
  { name: "Tupelo", lat: 34.2576, lng: -88.7034, rank: 1 },
  { name: "Meridian", lat: 32.3643, lng: -88.7037, rank: 1 },
  { name: "Greenville", lat: 33.4101, lng: -91.0618, rank: 2 },
  { name: "Vicksburg", lat: 32.3526, lng: -90.8779, rank: 2 },
  { name: "Oxford", lat: 34.3665, lng: -89.5192, rank: 2 },
  { name: "Starkville", lat: 33.4504, lng: -88.8184, rank: 2 },
  { name: "Columbus", lat: 33.4957, lng: -88.4273, rank: 2 },
  { name: "Natchez", lat: 31.5604, lng: -91.4032, rank: 2 },
  { name: "Laurel", lat: 31.6941, lng: -89.1306, rank: 2 },
  { name: "Greenwood", lat: 33.5162, lng: -90.1795, rank: 2 },
  { name: "Clarksdale", lat: 34.2001, lng: -90.5709, rank: 2 },
  { name: "McComb", lat: 31.2446, lng: -90.4532, rank: 3 },
  { name: "Pascagoula", lat: 30.3658, lng: -88.5561, rank: 3 },
  { name: "Hernando", lat: 34.8239, lng: -89.9937, rank: 3 },
  { name: "Corinth", lat: 34.9343, lng: -88.5223, rank: 3 }
];

const state = {
  data: {},
  layers: {},
  countyFeatureByName: {},
  selectedLayer: null,
  selectedCounty: null,
  officialChamber: "house",
  searchMarker: null,
  geocodeCache: new Map(),
  lastGeocodeAt: 0
};

const map = L.map("map", {
  zoomControl: false,
  preferCanvas: true
}).setView([32.75, -89.75], 7);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

L.control.zoom({ position: "bottomright" }).addTo(map);

map.createPane("cityLabels");
map.getPane("cityLabels").style.zIndex = 420;
map.getPane("cityLabels").style.pointerEvents = "none";

const els = {
  selectionTitle: document.getElementById("selection-title"),
  selectionSubtitle: document.getElementById("selection-subtitle"),
  metricGrid: document.getElementById("metric-grid"),
  cardholders: document.getElementById("metric-cardholders"),
  practitioners: document.getElementById("metric-practitioners"),
  dispensaries: document.getElementById("metric-dispensaries"),
  access: document.getElementById("metric-access"),
  districtList: document.getElementById("district-list"),
  officialList: document.getElementById("official-list"),
  businessList: document.getElementById("business-list"),
  searchInput: document.getElementById("search-input"),
  searchButton: document.getElementById("search-button"),
  searchResults: document.getElementById("search-results"),
  lastUpdated: document.getElementById("last-updated")
};

function getDistrictNumber(feature, layerName) {
  const p = feature.properties || {};
  if (layerName === "house") return String(p.Distnum || p.DISTRICT_4 || "").replace(/^0+/, "") || "Unknown";
  if (layerName === "senate") return String(p.LABEL || p.Distnum || p.DISTRICT_3 || "").replace(/^0+/, "") || "Unknown";
  return "";
}

function setSelectionSubtitle(text) {
  els.selectionSubtitle.textContent = text;
  els.selectionSubtitle.hidden = !text;
}

function focusDetailPanel() {
  if (els.searchInput) els.searchInput.blur();
  // Defer to next frame so layout/scroll containers are settled.
  requestAnimationFrame(() => {
    els.selectionTitle?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function countyMetric(county) {
  const p = county.properties;
  const licenseSummary = getCountyLicenseSummary(p.NAME);
  const publicMetrics = getCountyProgramMetrics(p.NAME);
  const cardholders = publicMetrics.activeCardholders;
  const practitioners = publicMetrics.practitioners;
  const dispensaries = licenseSummary.byType["Dispensary"] || 0;
  const cultivation = licenseSummary.byType["Cultivator Facility"] || 0;
  const processing = licenseSummary.byType["Processing Facility"] || 0;
  const transport = licenseSummary.byType["Transportation Entity"] || 0;
  const testing = licenseSummary.byType["Testing Facility"] || 0;
  const disposal = licenseSummary.byType["Disposal Entity"] || 0;
  const research = licenseSummary.byType["Research Facility"] || 0;

  return {
    cardholders,
    practitioners,
    dispensaries,
    cultivation,
    processing,
    transport,
    testing,
    disposal,
    research,
    totalLicenses: licenseSummary.total || 0,
    caregivers: publicMetrics.caregivers,
    workers: publicMetrics.workers,
    patientDensity: publicMetrics.patientDensity,
    practitionerDensity: publicMetrics.practitionerDensity,
    totalProgramRecords: publicMetrics.totalProgramRecords,
    dispensaryList: licenseSummary.dispensaries || [],
    byType: licenseSummary.byType || {}
  };
}

function getCountyLicenseSummary(countyName) {
  const empty = { total: 0, byType: {}, dispensaries: [] };
  if (!countyName || !state.data.licenses?.countySummaries) return empty;
  return state.data.licenses.countySummaries[countyName] || empty;
}

function getCountyProgramMetrics(countyName) {
  const empty = {
    caregivers: 0,
    workers: 0,
    practitioners: 0,
    practitionerDensity: 0,
    activeCardholders: 0,
    patientDensity: 0,
    dispensaryBusinesses: 0,
    relatedBusinesses: 0,
    totalProgramRecords: 0
  };
  if (!countyName || !state.data.countyMetrics?.countyMetrics) return empty;
  return state.data.countyMetrics.countyMetrics[countyName] || empty;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function imageSrc(path) {
  return path ? encodeURI(path).replaceAll("'", "%27") : "";
}

function initials(name) {
  const parts = String(name || "").replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map(part => part[0]).join("").toUpperCase() || "3M";
}

function featureCenter(feature) {
  return turf.centerOfMass(feature).geometry.coordinates;
}

function findContainingFeatures(point, layerName) {
  return (state.data[layerName]?.features || []).filter(feature => turf.booleanPointInPolygon(point, feature));
}

function summarizeDistricts(countyFeature) {
  const house = intersectingFeatures(countyFeature, "house").map(f => getDistrictNumber(f, "house"));
  const senate = intersectingFeatures(countyFeature, "senate").map(f => getDistrictNumber(f, "senate"));

  return {
    house: uniqueSorted(house),
    senate: uniqueSorted(senate)
  };
}

function intersectingFeatures(feature, layerName) {
  return (state.data[layerName]?.features || []).filter(candidate => turf.booleanIntersects(feature, candidate));
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => Number(a) - Number(b));
}

function setSelected(layer) {
  if (state.selectedLayer && state.selectedLayer !== layer) {
    const selectedType = state.selectedLayer.feature.properties.__layerName;
    state.selectedLayer.setStyle(styleForFeature(state.selectedLayer.feature, selectedType));
  }
  state.selectedLayer = layer;
  layer.setStyle(layerStyles.selected);
  layer.bringToFront();
}

function styleForFeature(feature, layerName) {
  if (layerName === "house" || layerName === "senate") {
    return districtPartyStyle(feature, layerName);
  }
  return layerStyles[layerName];
}

function districtPartyStyle(feature, layerName) {
  const number = getDistrictNumber(feature, layerName);
  const member = state.legislatorIndex?.[layerName]?.[String(Number(number))];
  const partyKey = String(member?.party || "").toLowerCase();
  return {
    ...layerStyles[layerName],
    ...(PARTY_STYLES[partyKey] || {})
  };
}

function renderSelection(feature, layerName) {
  const p = feature.properties || {};
  if (layerName === "counties") {
    state.selectedCounty = feature;
    const metric = countyMetric(feature);
    const districts = summarizeDistricts(feature);
    els.selectionTitle.textContent = p.NAMELSAD || p.NAME || "Selected county";
    setSelectionSubtitle("");
    showCountyMetrics(true);
    renderMetrics(metric);
    renderDistricts(districts);
    renderOfficials(districts, { filterByChamber: true });
    renderBusinesses(metric);
    return;
  }

  const number = getDistrictNumber(feature, layerName);
  const label = layerName === "house" ? "MS House District " : "MS Senate District ";
  els.selectionTitle.textContent = label + number;
  setSelectionSubtitle("Select Counties boundary mode to view county-level MMCP tallies.");
  showCountyMetrics(false);
  renderDistricts({ [layerName]: [number] });
  renderOfficials({ [layerName]: [number] });
  renderBusinesses(null, "Select a county to view active license counts.");
}

function showCountyMetrics(isVisible) {
  els.metricGrid.hidden = !isVisible;
}

function renderMetrics(metric) {
  els.cardholders.textContent = metric ? formatNumber(metric.cardholders) : "--";
  els.practitioners.textContent = metric ? formatNumber(metric.practitioners) : "--";
  els.dispensaries.textContent = metric ? formatNumber(metric.dispensaries) : "--";
  els.access.textContent = metric ? formatNumber(metric.totalLicenses) : "--";
}

function renderDistricts(districts) {
  const rows = [
    ["House", districts.house?.length ? "District " + districts.house.join(", ") : "Not calculated"],
    ["Senate", districts.senate?.length ? "District " + districts.senate.join(", ") : "Not calculated"]
  ];
  els.districtList.innerHTML = rows.map(([term, desc]) => `<div><dt>${term}</dt><dd>${desc}</dd></div>`).join("");
}

function renderOfficials(districts, options = {}) {
  const hasHouse = Boolean(districts.house?.length);
  const hasSenate = Boolean(districts.senate?.length);
  const chambers = ["house", "senate"].filter(chamber => chamber === "house" ? hasHouse : hasSenate);
  const activeChamber = chambers.includes(state.officialChamber) ? state.officialChamber : chambers[0];
  const officials = options.filterByChamber
    ? membersForDistricts(activeChamber, districts[activeChamber])
    : [
      ...membersForDistricts("house", districts.house),
      ...membersForDistricts("senate", districts.senate)
    ];

  if (!officials.length) {
    els.officialList.innerHTML = `<p class="empty-state">No House or Senate member matched this selection.</p>`;
    return;
  }

  const chamberControl = options.filterByChamber && chambers.length > 1
    ? `
      <label class="official-filter">
        <span>Chamber</span>
        <select id="official-chamber-select">
          <option value="house"${activeChamber === "house" ? " selected" : ""}>House</option>
          <option value="senate"${activeChamber === "senate" ? " selected" : ""}>Senate</option>
        </select>
      </label>
    `
    : "";

  els.officialList.innerHTML = chamberControl + officials.map(renderOfficialCard).join("");

  const select = document.getElementById("official-chamber-select");
  if (select) {
    select.addEventListener("change", event => {
      state.officialChamber = event.target.value;
      renderOfficials(districts, options);
    });
  }
}

function membersForDistricts(chamber, districts) {
  if (!districts || !districts.length) return [];
  return districts
    .map(number => state.legislatorIndex?.[chamber]?.[String(Number(number))])
    .filter(Boolean);
}

function renderOfficialCard(member) {
  const voteRows = PRIORITY_BILLS
    .map(bill => [bill, member.votes?.[bill]])
    .filter(([, value]) => value && value !== "N/A")
    .map(([bill, vote]) => `<span class="vote ${voteClassName(vote)}">${escapeHtml(bill)}: ${escapeHtml(vote)}</span>`)
    .join("");
  const portrait = member.headshot
    ? `<img class="official-photo" src="${escapeHtml(imageSrc(member.headshot))}" alt="${escapeHtml(member.name)} headshot" loading="lazy" />`
    : `<div class="official-photo official-photo-fallback" aria-hidden="true">${escapeHtml(initials(member.name))}</div>`;
  return `
    <article class="official">
      <div class="official-topline">
        ${portrait}
        <div>
          <strong>${escapeHtml(member.name)}</strong>
          <span>${member.chamber === "house" ? "MS House" : "MS Senate"} District ${escapeHtml(member.district)} · ${escapeHtml(member.party)}</span>
        </div>
      </div>
      <div class="score-row">
        <span>Score</span>
        <b>${escapeHtml(member.score)}/100</b>
      </div>
      <div class="vote-list">${voteRows}</div>
      ${member.email ? `<a class="contact-link" href="mailto:${escapeHtml(member.email)}">Contact</a>` : ""}
    </article>
  `;
}

function voteClassName(vote) {
  const normalized = String(vote || "").toLowerCase();
  if (normalized === "yea") return "support";
  return normalized.replace(/[^a-z0-9-]/g, "");
}

function renderBusinesses(metric, emptyMessage = "Select a county to view active license counts.") {
  if (!metric) {
    els.businessList.innerHTML = `<div><dt>Status</dt><dd>${escapeHtml(emptyMessage)}</dd></div>`;
    return;
  }

  const typeRows = [
    ["Total active licenses", metric.totalLicenses],
    ["Dispensary", metric.dispensaries],
    ["Cultivator Facility", metric.cultivation],
    ["Processing Facility", metric.processing],
    ["Transportation Entity", metric.transport],
    ["Testing Facility", metric.testing],
    ["Disposal Entity", metric.disposal],
    ["Research Facility", metric.research]
  ].map(([term, desc]) => `<div><dt>${term}</dt><dd>${desc}</dd></div>`).join("");

  const dispensaryRows = metric.dispensaryList.slice(0, 8).map(license => `
    <article class="license-card">
      <strong>${escapeHtml(license.businessName)}</strong>
      <span>${escapeHtml(license.id)} · Expires ${escapeHtml(license.expiration || "Not listed")}</span>
      <p>${escapeHtml(license.physicalAddress || "Address not listed")}</p>
    </article>
  `).join("");
  const moreCount = metric.dispensaryList.length > 8 ? `<p class="empty-state">Showing 8 of ${metric.dispensaryList.length} dispensaries for this selection.</p>` : "";

  els.businessList.innerHTML = `
    ${typeRows}
    ${metric.dispensaryList.length ? `<div class="license-list-wrap"><dt>Dispensaries</dt><dd><div class="license-list">${dispensaryRows}${moreCount}</div></dd></div>` : ""}
  `;
}

function buildLayer(layerName) {
  return L.geoJSON(state.data[layerName], {
    style: feature => styleForFeature(feature, layerName),
    onEachFeature: (feature, layer) => {
      feature.properties.__layerName = layerName;
      const label = layerName === "counties"
        ? feature.properties.NAMELSAD
        : (layerName === "house" ? "House " : "Senate ") + getDistrictNumber(feature, layerName);
      layer.bindTooltip(label, { sticky: true });
      layer.on("click", () => {
        clearSearchMarker();
        setSelected(layer);
        renderSelection(feature, layerName);
      });
    }
  });
}

function buildCityLayer() {
  const group = L.layerGroup();
  MISSISSIPPI_CITIES.forEach(city => {
    const marker = L.circleMarker([city.lat, city.lng], {
      pane: "cityLabels",
      radius: 2.8,
      color: "#ffffff",
      weight: 1.4,
      fillColor: "#071f40",
      fillOpacity: 0.9,
      interactive: false
    });
    const label = L.marker([city.lat, city.lng], {
      pane: "cityLabels",
      interactive: false,
      icon: L.divIcon({
        className: `city-label city-rank-${city.rank}`,
        html: `<span>${escapeHtml(city.name)}</span>`,
        iconSize: [120, 18],
        iconAnchor: [-6, 9]
      })
    });
    group.addLayer(marker);
    group.addLayer(label);
  });
  return group;
}

function toggleLayer(name, enabled) {
  const layer = state.layers[name];
  if (!layer) return;
  if (enabled) {
    layer.addTo(map);
  } else {
    map.removeLayer(layer);
  }
}

function clearSearchMarker() {
  if (!state.searchMarker) return;
  map.removeLayer(state.searchMarker);
  state.searchMarker = null;
}

function setBoundaryLayer(activeName, options = {}) {
  if (!BOUNDARY_LAYERS.includes(activeName)) return;
  if (options.clearAddressMarker !== false) clearSearchMarker();
  toggleLayer("counties", true);
  DISTRICT_BOUNDARY_LAYERS.forEach(name => toggleLayer(name, name === activeName));
  const input = document.querySelector(`input[data-boundary-layer="${activeName}"]`);
  if (input) input.checked = true;
}

function searchLocalFeatures(query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const results = [];
  (state.data.counties?.features || []).forEach(feature => {
    const name = String(feature.properties.NAMELSAD || feature.properties.NAME || "").toLowerCase();
    if (name.includes(normalized)) {
      results.push({
        type: "counties",
        label: feature.properties.NAMELSAD,
        meta: "County",
        feature
      });
    }
  });

  ["house", "senate"].forEach(type => {
    (state.data[type]?.features || []).forEach(feature => {
      const number = getDistrictNumber(feature, type);
      const label = type === "house" ? "MS House District " + number : "MS Senate District " + number;
      if (number === normalized.replace(/^0+/, "") || label.toLowerCase().includes(normalized)) {
        results.push({
          type,
          label,
          meta: type === "house" ? "State House district" : "State Senate district",
          feature
        });
      }
    });
  });

  (state.data.licenses?.licenses || []).forEach(license => {
    const haystack = `${license.businessName} ${license.id} ${license.type} ${license.county}`.toLowerCase();
    if (haystack.includes(normalized)) {
      const countyFeature = state.countyFeatureByName[license.county];
      if (countyFeature) {
        results.push({
          type: "counties",
          label: license.businessName,
          meta: `${license.type} · ${license.county} County`,
          feature: countyFeature
        });
      }
    }
  });

  (state.data.legislators || []).forEach(member => {
    const haystack = `${member.name} ${member.chamber} ${member.district} ${member.party} ${member.classification}`.toLowerCase();
    if (haystack.includes(normalized)) {
      const layerType = member.chamber;
      const districtFeature = (state.data[layerType]?.features || []).find(feature => getDistrictNumber(feature, layerType) === String(member.district));
      if (districtFeature) {
        results.push({
          type: layerType,
          label: member.name,
          meta: `${member.chamber === "house" ? "MS House" : "MS Senate"} District ${member.district} · ${member.party}`,
          feature: districtFeature
        });
      }
    }
  });

  return dedupeSearchResults(results);
}

function shouldGeocodeAddress(query, localResults) {
  const normalized = query.trim().toLowerCase();
  if (normalized.length < 5) return false;
  if (/\b(house|senate|district|county)\b/.test(normalized)) return false;
  if (/\d/.test(normalized)) return true;
  return localResults.length === 0 && normalized.length >= 8;
}

function mississippiAddressQuery(query) {
  return /\b(ms|mississippi)\b/i.test(query) ? query : `${query}, Mississippi, USA`;
}

async function geocodeAddress(query, localResults) {
  if (!shouldGeocodeAddress(query, localResults)) return [];

  const cacheKey = query.trim().toLowerCase();
  if (state.geocodeCache.has(cacheKey)) return state.geocodeCache.get(cacheKey);

  const elapsed = Date.now() - state.lastGeocodeAt;
  if (elapsed < NOMINATIM_MIN_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, NOMINATIM_MIN_INTERVAL_MS - elapsed));
  }

  const params = new URLSearchParams({
    q: mississippiAddressQuery(query),
    format: "jsonv2",
    addressdetails: "1",
    limit: "5",
    countrycodes: "us",
    bounded: "1",
    viewbox: `${MISSISSIPPI_VIEWBOX.west},${MISSISSIPPI_VIEWBOX.north},${MISSISSIPPI_VIEWBOX.east},${MISSISSIPPI_VIEWBOX.south}`
  });

  state.lastGeocodeAt = Date.now();
  const response = await fetch(`${NOMINATIM_ENDPOINT}?${params.toString()}`, {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error("Address search failed.");

  const rows = await response.json();
  const results = rows
    .map(row => {
      const lat = Number(row.lat);
      const lng = Number(row.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const countyFeature = countyFeatureForPoint(lat, lng);
      if (!countyFeature) return null;
      return {
        type: "address",
        label: row.display_name,
        meta: `Address · ${countyFeature.properties.NAME} County`,
        lat,
        lng,
        countyFeature
      };
    })
    .filter(Boolean)
    .slice(0, 3);

  state.geocodeCache.set(cacheKey, results);
  return results;
}

function countyFeatureForPoint(lat, lng) {
  const point = turf.point([lng, lat]);
  return (state.data.counties?.features || []).find(feature => turf.booleanPointInPolygon(point, feature));
}

function dedupeSearchResults(results) {
  const seen = new Set();
  return results.filter(result => {
    const key = `${result.type}:${result.label}:${result.meta || ""}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderSearchMessage(message) {
  els.searchResults.innerHTML = `<p class="search-message">${escapeHtml(message)}</p>`;
}

function renderSearchResults(results) {
  if (!results.length) {
    renderSearchMessage("No match found.");
    return;
  }

  els.searchResults.innerHTML = results.map((result, index) => `
    <button class="search-result" type="button" role="option" data-index="${index}">
      <span class="search-result-title">${escapeHtml(result.label)}</span>
      <span class="search-result-meta">${escapeHtml(result.meta || "")}</span>
    </button>
  `).join("");

  els.searchResults.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => selectSearchResult(results[Number(button.dataset.index)]));
  });
}

async function performSearch() {
  const query = els.searchInput.value.trim();
  if (!query) {
    els.searchResults.innerHTML = "";
    return;
  }

  renderSearchMessage("Searching...");
  els.searchButton.disabled = true;

  try {
    const localResults = searchLocalFeatures(query).slice(0, 5);
    let addressResults = [];
    let addressError = false;

    try {
      addressResults = await geocodeAddress(query, localResults);
    } catch (error) {
      addressError = true;
      console.warn(error);
    }

    const results = dedupeSearchResults([...localResults, ...addressResults]).slice(0, 8);
    if (results.length) {
      renderSearchResults(results);
      if (addressError) {
        els.searchResults.insertAdjacentHTML("beforeend", `<p class="search-message">Address search is temporarily unavailable.</p>`);
      }
    } else {
      renderSearchMessage(addressError ? "Address search is temporarily unavailable." : "No match found.");
    }
  } finally {
    els.searchButton.disabled = false;
  }
}

function selectSearchResult(result) {
  if (result.type === "address") {
    selectAddressResult(result);
    return;
  }

  clearSearchMarker();
  const bounds = L.geoJSON(result.feature).getBounds();
  map.fitBounds(bounds, { padding: [24, 24], maxZoom: 9 });
  if (BOUNDARY_LAYERS.includes(result.type)) setBoundaryLayer(result.type);
  state.layers[result.type].eachLayer(layer => {
    if (layer.feature === result.feature) setSelected(layer);
  });
  renderSelection(result.feature, result.type);
  els.searchResults.innerHTML = "";
  focusDetailPanel();
}

function selectAddressResult(result) {
  clearSearchMarker();
  state.searchMarker = L.marker([result.lat, result.lng]).addTo(map);
  map.setView([result.lat, result.lng], 14);
  setBoundaryLayer("counties", { clearAddressMarker: false });

  const countyFeature = result.countyFeature;
  const point = turf.point([result.lng, result.lat]);
  const houseFeature = findContainingFeatures(point, "house")[0];
  const senateFeature = findContainingFeatures(point, "senate")[0];
  const houseNum = houseFeature ? getDistrictNumber(houseFeature, "house") : null;
  const senateNum = senateFeature ? getDistrictNumber(senateFeature, "senate") : null;
  const districts = {
    house: houseNum ? [houseNum] : [],
    senate: senateNum ? [senateNum] : []
  };

  state.selectedCounty = countyFeature || null;

  const shortLabel = result.label.split(",").slice(0, 2).join(",").trim() || result.label;
  els.selectionTitle.textContent = shortLabel;
  setSelectionSubtitle(countyFeature ? `${countyFeature.properties.NAME} County` : "");

  if (countyFeature) {
    state.layers.counties.eachLayer(layer => {
      if (layer.feature === countyFeature) setSelected(layer);
    });
    const metric = countyMetric(countyFeature);
    showCountyMetrics(true);
    renderMetrics(metric);
    renderBusinesses(metric);
  } else {
    showCountyMetrics(false);
    renderBusinesses(null, "Select a county to view active license counts.");
  }

  renderDistricts(districts);
  renderOfficials(districts);
  els.searchResults.innerHTML = "";
  focusDetailPanel();
}

async function init() {
  const entries = await Promise.all(Object.entries(DATA_URLS).map(async ([key, url]) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to load " + url);
    return [key, await response.json()];
  }));

  state.data = Object.fromEntries(entries);
  state.legislatorIndex = buildLegislatorIndex(state.data.legislators || []);
  Object.keys(DATA_URLS).forEach(key => {
    if (key === "legislators" || key === "licenses" || key === "countyMetrics" || key === "dataSources") return;
    state.layers[key] = buildLayer(key);
  });
  state.countyFeatureByName = Object.fromEntries(state.data.counties.features.map(feature => [feature.properties.NAME, feature]));
  state.layers.cities = buildCityLayer();

  toggleLayer("counties", true);
  setBoundaryLayer("house", { clearAddressMarker: false });
  toggleLayer("cities", true);
  map.fitBounds(state.layers.counties.getBounds(), { padding: [18, 18] });

  document.querySelectorAll("input[data-boundary-layer]").forEach(input => {
    input.addEventListener("change", event => setBoundaryLayer(event.target.dataset.boundaryLayer));
  });

  els.searchButton.addEventListener("click", () => performSearch());
  els.searchInput.addEventListener("keydown", event => {
    if (event.key === "Enter") performSearch();
    if (event.key === "Escape") els.searchResults.innerHTML = "";
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") els.searchResults.innerHTML = "";
  });

  renderBusinesses(null);
  renderLastUpdated();
}

function renderLastUpdated() {
  if (!els.lastUpdated) return;
  const sourceTimestamps = [
    state.data.dataSources?.sources?.countyMetrics?.generatedAt,
    state.data.dataSources?.sources?.licenses?.generatedAt,
    state.data.dataSources?.sources?.countyMetrics?.fetchedAt,
    state.data.dataSources?.sources?.licenses?.fetchedAt,
    state.data.dataSources?.generatedAt
  ];
  const timestamps = [
    ...sourceTimestamps,
    state.data.countyMetrics?.generatedAt,
    state.data.licenses?.generatedAt
  ]
    .map(value => (value ? new Date(value) : null))
    .filter(date => date && !Number.isNaN(date.getTime()));

  if (!timestamps.length) {
    els.lastUpdated.hidden = true;
    return;
  }

  const latest = timestamps.reduce((a, b) => (a > b ? a : b));
  const formatted = latest.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
  els.lastUpdated.hidden = false;
  els.lastUpdated.innerHTML = `<strong>Last updated</strong>${formatted}`;
}

function buildLegislatorIndex(members) {
  return members.reduce((index, member) => {
    const chamber = member.chamber;
    if (!index[chamber]) index[chamber] = {};
    index[chamber][String(member.district)] = member;
    return index;
  }, {});
}

init().catch(error => {
  els.searchResults.textContent = "Map failed to load.";
  console.error(error);
});
