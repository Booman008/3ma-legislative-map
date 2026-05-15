const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CSV_DIR = path.join(ROOT, "CSV Imports");
const DATA_DIR = path.join(ROOT, "data");

const SOURCES = {
  countyMetrics: {
    url: process.env.MMCP_COUNTY_METRICS_URL || "https://data.mmcp.ms.gov/resource/7msu-vp6z.json",
    datasetId: "7msu-vp6z",
    sourcePage: "https://data.mmcp.ms.gov/stories/s/v3y2-vbq4"
  },
  licenses: {
    url: process.env.MMCP_LICENSES_URL || "https://www.mmcp.ms.gov/search_business"
  }
};

const OUTPUTS = {
  countyMetricsCsv: path.join(CSV_DIR, "mmcp_county_metrics_latest.csv"),
  licensesCsv: path.join(CSV_DIR, "mmcp_business_licenses_latest.csv"),
  dataSources: path.join(DATA_DIR, "data_sources.json")
};

const FALLBACKS = {
  countyMetrics: [
    OUTPUTS.countyMetricsCsv,
    path.join(CSV_DIR, "5.13.26 County Summary Dataset.csv")
  ],
  licenses: [
    OUTPUTS.licensesCsv,
    path.join(CSV_DIR, "Business Search  MedCann (72).csv")
  ]
};

const FETCH_TIMEOUT_MS = 30000;
const FETCH_RETRIES = 2;

const COUNTY_FIELDS = [
  "county",
  "num_caregivers",
  "num_workers",
  "num_practitioners",
  "dens_practitioners",
  "num_patients",
  "dens_patients",
  "num_disp_biz",
  "num_biz_related",
  "num_total"
];

const LICENSE_FIELDS = [
  "License No.",
  "Business Name",
  "Business Type",
  "County",
  "Expiration",
  "License Issue Date",
  "Owner Name",
  "Physical Address",
  "Mailing Address",
  "Phone Number",
  "Email Address",
  "Record ID"
];

async function fetchJson(url) {
  const response = await fetchWithRetries(url, {
    headers: requestHeaders("application/json")
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchText(url) {
  const response = await fetchWithRetries(url, {
    headers: requestHeaders("text/html")
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function requestHeaders(accept) {
  return {
    Accept: accept,
    "User-Agent": "Mozilla/5.0 (compatible; 3MA Legislative Map data refresh; +https://github.com/Booman008/3ma-legislative-map)",
    "Cache-Control": "no-cache"
  };
}

async function fetchWithRetries(url, options) {
  let lastError = null;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      if (response.ok || (response.status < 500 && response.status !== 429)) return response;
      lastError = new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < FETCH_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  throw lastError;
}

async function fetchCountyMetrics() {
  const params = new URLSearchParams({
    $select: COUNTY_FIELDS.join(","),
    $order: "county",
    $limit: "5000"
  });
  const rows = await fetchJson(`${SOURCES.countyMetrics.url}?${params.toString()}`);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Socrata county metrics returned no rows.");
  }

  return rows
    .filter(row => String(row.county || "").trim().toLowerCase() !== "out of state")
    .map(row => Object.fromEntries(COUNTY_FIELDS.map(field => [field, row[field] ?? ""])));
}

async function fetchLicenses() {
  const html = await fetchText(SOURCES.licenses.url);
  const payload = extractBusinessSearchPayload(html);
  const records = payload.records;
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("Business Search payload did not include license records.");
  }

  return {
    reportedTotal: Number(payload.totalRecords) || records.length,
    rows: records.map(record => ({
      "License No.": record.licenseNumber || "",
      "Business Name": record.businessName || "",
      "Business Type": record.businessType || "",
      County: normalizeCounty(record.county),
      Expiration: formatDate(record.licenseExpirationDate),
      "License Issue Date": formatDate(record.licenseIssueDate),
      "Owner Name": record.ownerName || "",
      "Physical Address": record.physicalAddress || "",
      "Mailing Address": record.mailingAddress || "",
      "Phone Number": formatPhone(record.phoneNumber),
      "Email Address": record.emailAddress || "",
      "Record ID": record.recordId || ""
    }))
  };
}

function extractBusinessSearchPayload(html) {
  const match = html.match(/"search_business"\s*:\s*\{\s*"jsonData"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!match) {
    throw new Error("Unable to find search_business.jsonData in Business Search HTML.");
  }

  const jsonText = JSON.parse(`"${match[1]}"`);
  const payload = JSON.parse(jsonText);
  if (!payload.success) {
    throw new Error(`Business Search payload reported failure: ${payload.errorMessage || "unknown error"}`);
  }
  return payload;
}

function normalizeCounty(value) {
  const withoutCode = String(value || "")
    .replace(/^\s*\d+\s*-\s*/, "")
    .trim();

  if (!withoutCode) return "";
  if (withoutCode.toLowerCase() === "desoto") return "DeSoto";

  return withoutCode
    .toLowerCase()
    .split(/\s+/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${month}-${day}-${date.getUTCFullYear()}`;
}

function formatPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 10) return String(value || "");
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function toCsv(rows, fields) {
  return [
    fields.map(escapeCsv).join(","),
    ...rows.map(row => fields.map(field => escapeCsv(row[field] ?? "")).join(","))
  ].join("\n") + "\n";
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift() || [];
  return rows
    .filter(values => values.some(value => value.trim()))
    .map(values => Object.fromEntries(headers.map((header, index) => [header.trim(), (values[index] || "").trim()])));
}

function readFallbackCsv(sourceName, fields) {
  const candidates = FALLBACKS[sourceName];
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`No fallback CSV is available for ${sourceName}.`);
  }

  const rows = parseCsv(fs.readFileSync(found, "utf8").replace(/^\uFEFF/, ""));
  return {
    path: found,
    rows: rows.map(row => Object.fromEntries(fields.map(field => [field, row[field] ?? ""])))
  };
}

function copyFallbackIfNeeded(sourcePath, outputPath) {
  if (path.resolve(sourcePath) === path.resolve(outputPath)) return;
  fs.copyFileSync(sourcePath, outputPath);
}

function readJson(filename) {
  if (!fs.existsSync(filename)) return null;
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function warnOnLargeDeltas(countyRows, licenseRows) {
  const currentLicenses = readJson(path.join(DATA_DIR, "licenses.json"));
  const currentMetrics = readJson(path.join(DATA_DIR, "county_metrics.json"));

  if (currentLicenses?.total) {
    const delta = Math.abs(licenseRows.length - currentLicenses.total) / currentLicenses.total;
    if (delta > 0.1) {
      console.warn(`Warning: license count changed by ${(delta * 100).toFixed(1)}% (${currentLicenses.total} -> ${licenseRows.length}).`);
    }
  }

  if (currentMetrics?.countyMetrics) {
    for (const row of countyRows) {
      const current = currentMetrics.countyMetrics[row.county];
      if (!current || !current.activeCardholders) continue;
      const next = Number(row.num_patients || 0);
      const delta = Math.abs(next - current.activeCardholders) / current.activeCardholders;
      if (delta > 0.2) {
        console.warn(`Warning: ${row.county} patient count changed by ${(delta * 100).toFixed(1)}% (${current.activeCardholders} -> ${next}).`);
      }
    }
  }
}

function writeDataSources(metadata) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const existing = readJson(OUTPUTS.dataSources) || {};
  const payload = {
    ...existing,
    generatedAt: existing.generatedAt || metadata.generatedAt,
    sources: {
      ...(existing.sources || {}),
      countyMetrics: {
        ...withoutFallbackState(existing.sources?.countyMetrics),
        url: SOURCES.countyMetrics.url,
        sourcePage: SOURCES.countyMetrics.sourcePage,
        datasetId: SOURCES.countyMetrics.datasetId,
        rowCount: metadata.countyMetrics.rowCount,
        fetchedAt: metadata.countyMetrics.fetchedAt || existing.sources?.countyMetrics?.fetchedAt,
        status: metadata.countyMetrics.status,
        ...(metadata.countyMetrics.error ? { error: metadata.countyMetrics.error } : {}),
        ...(metadata.countyMetrics.fallbackInput ? { fallbackInput: metadata.countyMetrics.fallbackInput } : {})
      },
      licenses: {
        ...withoutFallbackState(existing.sources?.licenses),
        url: SOURCES.licenses.url,
        rowCount: metadata.licenses.rowCount,
        reportedTotal: metadata.licenses.reportedTotal,
        fetchedAt: metadata.licenses.fetchedAt || existing.sources?.licenses?.fetchedAt,
        status: metadata.licenses.status,
        ...(metadata.licenses.error ? { error: metadata.licenses.error } : {}),
        ...(metadata.licenses.fallbackInput ? { fallbackInput: metadata.licenses.fallbackInput } : {})
      }
    }
  };
  fs.writeFileSync(OUTPUTS.dataSources, `${JSON.stringify(payload, null, 2)}\n`);
}

function withoutFallbackState(source) {
  if (!source) return {};
  const { error, fallbackInput, status, ...rest } = source;
  return rest;
}

async function main() {
  fs.mkdirSync(CSV_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const fetchedAt = new Date().toISOString();
  let countyRows;
  let countyMetadata;
  try {
    countyRows = await fetchCountyMetrics();
    countyMetadata = {
      rowCount: countyRows.length,
      fetchedAt,
      status: "fetched"
    };
    fs.writeFileSync(OUTPUTS.countyMetricsCsv, toCsv(countyRows, COUNTY_FIELDS));
  } catch (error) {
    const fallback = readFallbackCsv("countyMetrics", COUNTY_FIELDS);
    copyFallbackIfNeeded(fallback.path, OUTPUTS.countyMetricsCsv);
    countyRows = fallback.rows.filter(row => String(row.county || "").trim().toLowerCase() !== "out of state");
    countyMetadata = {
      rowCount: countyRows.length,
      status: "fallback",
      error: error.message,
      fallbackInput: path.relative(ROOT, fallback.path).split(path.sep).join("/")
    };
    console.warn(`Warning: ${error.message}`);
    console.warn(`Warning: using fallback county metrics CSV: ${countyMetadata.fallbackInput}`);
  }

  let licenseResult;
  let licenseMetadata;
  try {
    licenseResult = await fetchLicenses();
    licenseMetadata = {
      rowCount: licenseResult.rows.length,
      reportedTotal: licenseResult.reportedTotal,
      fetchedAt,
      status: "fetched"
    };
    fs.writeFileSync(OUTPUTS.licensesCsv, toCsv(licenseResult.rows, LICENSE_FIELDS));
  } catch (error) {
    const fallback = readFallbackCsv("licenses", LICENSE_FIELDS);
    copyFallbackIfNeeded(fallback.path, OUTPUTS.licensesCsv);
    licenseResult = {
      reportedTotal: fallback.rows.length,
      rows: fallback.rows
    };
    licenseMetadata = {
      rowCount: fallback.rows.length,
      reportedTotal: fallback.rows.length,
      status: "fallback",
      error: error.message,
      fallbackInput: path.relative(ROOT, fallback.path).split(path.sep).join("/")
    };
    console.warn(`Warning: ${error.message}`);
    console.warn(`Warning: using fallback license CSV: ${licenseMetadata.fallbackInput}`);
  }

  warnOnLargeDeltas(countyRows, licenseResult.rows);

  writeDataSources({
    generatedAt: fetchedAt,
    countyMetrics: countyMetadata,
    licenses: licenseMetadata
  });

  console.log("MMCP fetch complete.");
  console.log(`- County metric rows: ${countyRows.length}`);
  console.log(`- License rows: ${licenseResult.rows.length}`);
  console.log(`- Business Search reported total: ${licenseResult.reportedTotal}`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
