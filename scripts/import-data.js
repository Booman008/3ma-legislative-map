const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

const CSV_DIR = "CSV Imports";

const INPUTS = {
  tracksheet: `${CSV_DIR}/3MA Mississippi Legislature Tracksheet - Scorecard_Public (1).csv`,
  licenses: [
    `${CSV_DIR}/mmcp_business_licenses_latest.csv`,
    `${CSV_DIR}/Business Search  MedCann (72).csv`
  ],
  countySummary: [
    `${CSV_DIR}/mmcp_county_metrics_latest.csv`,
    `${CSV_DIR}/5.13.26 County Summary Dataset.csv`
  ],
  headshots: "Legislator Headshots"
};

const OUTPUTS = {
  legislators: path.join(DATA_DIR, "legislators.json"),
  licenses: path.join(DATA_DIR, "licenses.json"),
  countyMetrics: path.join(DATA_DIR, "county_metrics.json"),
  dataSources: path.join(DATA_DIR, "data_sources.json")
};

const VOTE_COLUMNS = [
  "SB 2095 (2022)",
  "HB 1158 (2023)",
  "SB 2857 (2024)",
  "HB 611 (2025)",
  "SB 2748 (2025)",
  "HB 895 (2026)",
  "HB 1152 (2026)",
  "HB 1034 (2026)",
  "HB 513 (2026)"
];

const HEADSHOT_ALIASES = {
  house: {
    "Henry Zuber III": "Hank Zuber",
    "Jeffery Harness": "Jeffrey Harness",
    "Manly Barton": "Many Barton",
    "Trey Lamar, III": "John Thomas Lamar",
    "Gregory Elliot": "Gregory Elliott"
  },
  senate: {
    "Kameisha Mumford": "Kamesha Mumford",
    "Jonny Dupree": "Johnny DuPree"
  }
};

function readCsv(filename) {
  const input = resolveInput(filename);
  const fullPath = path.join(ROOT, input);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing input file: ${input}`);
  }
  return parseCsv(fs.readFileSync(fullPath, "utf8").replace(/^\uFEFF/, ""));
}

function resolveInput(input) {
  if (!Array.isArray(input)) return input;
  const found = input.find(candidate => fs.existsSync(path.join(ROOT, candidate)));
  if (found) return found;
  return input[0];
}

function sourceInput(input) {
  return resolveInput(input).split(path.sep).join("/");
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

function toNumber(value) {
  if (value === undefined || value === null || value === "") return 0;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function toBoolean(value) {
  return ["yes", "true", "1", "y"].includes(String(value || "").trim().toLowerCase());
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function nameTokens(value) {
  return normalizeName(value)
    .split(" ")
    .filter(token => token && token.length > 1 && !["jr", "sr", "ii", "iii", "iv", "v", "doc"].includes(token));
}

function looseNameKey(value) {
  return nameTokens(value).join(" ");
}

function chamberKey(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.includes("senate")) return "senate";
  if (normalized.includes("house")) return "house";
  if (normalized === "hosue") return "house";
  return normalized;
}

function chamberHeadshotDir(chamber) {
  return chamber === "senate" ? "Senate" : "House of Representatives";
}

function relativePath(fullPath) {
  return path.relative(ROOT, fullPath).split(path.sep).join("/");
}

function buildHeadshotIndex() {
  const root = path.join(ROOT, INPUTS.headshots);
  const index = {
    house: { exact: new Map(), loose: new Map(), entries: [] },
    senate: { exact: new Map(), loose: new Map(), entries: [] }
  };
  if (!fs.existsSync(root)) return index;

  for (const chamber of ["house", "senate"]) {
    const dir = path.join(root, chamberHeadshotDir(chamber));
    if (!fs.existsSync(dir)) continue;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) continue;
      const baseName = path.basename(entry.name, ext).replace(/_\([^)]*\)$/g, "");
      const entryPath = relativePath(path.join(dir, entry.name));
      index[chamber].exact.set(normalizeName(baseName), entryPath);
      index[chamber].loose.set(looseNameKey(baseName), entryPath);
      index[chamber].entries.push({ name: baseName, path: entryPath, tokens: nameTokens(baseName) });
    }
  }

  return index;
}

function findHeadshot(headshotIndex, chamber, memberName) {
  const chamberIndex = headshotIndex[chamber];
  if (!chamberIndex) return null;

  const alias = HEADSHOT_ALIASES[chamber]?.[memberName];
  if (alias) {
    const aliasMatch = findHeadshot(headshotIndex, chamber, alias);
    if (aliasMatch) return aliasMatch;
  }

  const exact = chamberIndex.exact.get(normalizeName(memberName));
  if (exact) return exact;

  const loose = chamberIndex.loose.get(looseNameKey(memberName));
  if (loose) return loose;

  const tokens = nameTokens(memberName);
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  if (!first || !last) return null;

  const candidate = chamberIndex.entries.find(entry => {
    const entryFirst = entry.tokens[0];
    const entryLast = entry.tokens[entry.tokens.length - 1];
    return entryFirst === first && entryLast === last;
  });

  return candidate?.path || null;
}

function importLegislators() {
  const rows = readCsv(INPUTS.tracksheet);
  const headshots = buildHeadshotIndex();
  const unmatchedHeadshots = [];

  const legislators = rows.map(row => {
    const name = row["Legislator Name"];
    const chamber = chamberKey(row.Chamber);
    const votes = Object.fromEntries(VOTE_COLUMNS.map(column => [column, row[column] || "N/A"]));
    const headshot = findHeadshot(headshots, chamber, name);

    if (!headshot && name && chamber) {
      unmatchedHeadshots.push({ name, chamber, district: toNumber(row.District) });
    }

    return {
      name,
      chamber,
      district: toNumber(row.District),
      party: row.Party,
      score: toNumber(row.Score),
      grade: row.Grade,
      classification: row.Classification,
      historicalVoteScore: toNumber(row["Historical Vote Score"]),
      summary: row.Summary,
      contactLink: row["Contact Link"],
      slug: row.Slug || slugify(name),
      featured: toBoolean(row["Featured?"]),
      publish: toBoolean(row["Publish?"]),
      votes,
      ...(headshot ? { headshot } : {})
    };
  });

  writeJson(OUTPUTS.legislators, legislators);
  return { total: legislators.length, unmatchedHeadshots };
}

function importLicenses() {
  const rows = readCsv(INPUTS.licenses);
  const licenses = rows.map(row => {
    const type = row["Business Type"];
    return {
      id: row["License No."],
      businessName: row["Business Name"],
      type,
      typeSlug: slugify(type),
      county: row.County,
      expiration: row.Expiration,
      issueDate: row["License Issue Date"],
      ownerName: row["Owner Name"],
      physicalAddress: row["Physical Address"],
      mailingAddress: row["Mailing Address"],
      phone: row["Phone Number"],
      email: row["Email Address"],
      ...(row["Record ID"] ? { recordId: row["Record ID"] } : {}),
      isDispensary: type === "Dispensary"
    };
  });

  const typeTotals = {};
  const countySummaries = {};

  for (const license of licenses) {
    typeTotals[license.type] = (typeTotals[license.type] || 0) + 1;

    if (!countySummaries[license.county]) {
      countySummaries[license.county] = {
        county: license.county,
        total: 0,
        byType: {},
        dispensaries: []
      };
    }

    const summary = countySummaries[license.county];
    summary.total += 1;
    summary.byType[license.type] = (summary.byType[license.type] || 0) + 1;
    if (license.isDispensary) summary.dispensaries.push(license);
  }

  const payload = {
    source: sourceInput(INPUTS.licenses),
    generatedAt: new Date().toISOString(),
    total: licenses.length,
    typeTotals,
    licenses,
    countySummaries
  };

  writeJson(OUTPUTS.licenses, payload);
  return { total: licenses.length, counties: Object.keys(countySummaries).length, typeTotals };
}

function importCountyMetrics() {
  const rows = readCsv(INPUTS.countySummary);
  const countyMetrics = {};

  for (const row of rows) {
    const county = row.county;
    if (!county) continue;
    if (String(county).trim().toLowerCase() === "out of state") continue;
    countyMetrics[county] = {
      county,
      caregivers: toNumber(row.num_caregivers),
      workers: toNumber(row.num_workers),
      practitioners: toNumber(row.num_practitioners),
      practitionerDensity: toNumber(row.dens_practitioners),
      activeCardholders: toNumber(row.num_patients),
      patientDensity: toNumber(row.dens_patients),
      dispensaryBusinesses: toNumber(row.num_disp_biz),
      relatedBusinesses: toNumber(row.num_biz_related),
      totalProgramRecords: toNumber(row.num_total)
    };
  }

  const payload = {
    source: sourceInput(INPUTS.countySummary),
    generatedAt: new Date().toISOString(),
    counties: Object.keys(countyMetrics).length,
    countyMetrics
  };

  writeJson(OUTPUTS.countyMetrics, payload);
  return { counties: payload.counties };
}

function writeJson(filename, payload) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify(payload, null, 2)}\n`);
}

function readJson(filename) {
  if (!fs.existsSync(filename)) return null;
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function updateDataSources(licenseResult, countyMetricResult) {
  const now = new Date().toISOString();
  const existing = readJson(OUTPUTS.dataSources) || {};
  const payload = {
    ...existing,
    generatedAt: now,
    sources: {
      ...(existing.sources || {}),
      licenses: {
        ...(existing.sources?.licenses || {}),
        input: sourceInput(INPUTS.licenses),
        generatedAt: now,
        rowCount: licenseResult.total
      },
      countyMetrics: {
        ...(existing.sources?.countyMetrics || {}),
        input: sourceInput(INPUTS.countySummary),
        generatedAt: now,
        rowCount: countyMetricResult.counties
      },
      legislators: {
        ...(existing.sources?.legislators || {}),
        input: sourceInput(INPUTS.tracksheet),
        generatedAt: now
      }
    },
    generatedFiles: {
      legislators: {
        path: "data/legislators.json",
        generatedAt: now
      },
      licenses: {
        path: "data/licenses.json",
        generatedAt: now,
        rowCount: licenseResult.total
      },
      countyMetrics: {
        path: "data/county_metrics.json",
        generatedAt: now,
        rowCount: countyMetricResult.counties
      }
    }
  };

  writeJson(OUTPUTS.dataSources, payload);
}

function main() {
  const legislatorResult = importLegislators();
  const licenseResult = importLicenses();
  const countyMetricResult = importCountyMetrics();
  updateDataSources(licenseResult, countyMetricResult);

  console.log("Import complete.");
  console.log(`- Legislators: ${legislatorResult.total}`);
  console.log(`- Unmatched headshots: ${legislatorResult.unmatchedHeadshots.length}`);
  if (legislatorResult.unmatchedHeadshots.length) {
    console.log(JSON.stringify(legislatorResult.unmatchedHeadshots.slice(0, 20), null, 2));
  }
  console.log(`- Licenses: ${licenseResult.total}`);
  console.log(`- License counties: ${licenseResult.counties}`);
  console.log(`- County metric rows: ${countyMetricResult.counties}`);
}

main();
