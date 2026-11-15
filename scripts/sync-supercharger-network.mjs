import fs from "node:fs";

const datasetPath = "src/data/superchargers.json";
const sourcePath = "src/data/supercharge-info-europe.json";
const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));

const statusMap = {
  OPEN: "operational",
  EXPANDING: "works",
  CONSTRUCTION: "construction",
  PERMIT: "permit",
  PLAN: "planned",
  VOTING: "voting",
  CLOSED_TEMP: "temp_closed",
  CLOSED_PERM: "long_closed",
};
const manualStatusOverrides = new Map([
  ["spier", "construction"],
  ["lermoos", "temp_closed"],
]);

const normalize = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();
const normalizeCountry = (value) => ["turkey", "turkiye"].includes(normalize(value))
  ? "turkey"
  : normalize(value);
const distanceMeters = (a, b) => {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
};
const sourceName = (site) => normalize(
  String(site.name ?? "")
    .replace(/^\[EV OTM\]\s*/i, "")
    .replace(/,\s*(?:Netherlands|Germany|France|Italy|Spain|Norway|Sweden|United Kingdom|UK|Turkey|Türkiye|Austria|Belgium|Denmark|Poland|Portugal|Romania|Hungary|Ireland|Finland|Iceland|Croatia|Czech Republic|Slovakia|Slovenia|Switzerland|Greece|Bulgaria|Serbia|Bosnia and Herzegovina|Estonia|Latvia|Lithuania|Luxembourg)(?=\s*[-(]|$)/i, "")
);
const nameSimilar = (source, existing) => {
  const a = sourceName(source).split(" ").filter(Boolean);
  const b = normalize(existing.name).split(" ").filter(Boolean);
  if (a.length < 2 || b.length < 2) return false;
  const overlap = b.filter((token) => a.includes(token)).length;
  return overlap >= Math.min(a.length, b.length) - 1 && overlap >= 2;
};
const chargerVersions = (site) => Object.entries(site.stalls ?? {})
  .filter(([key, count]) => ["v2", "v3", "v4", "urban"].includes(key.toLowerCase()) && Number(count) > 0)
  .map(([version, count]) => ({ version: version.toUpperCase(), count: Number(count) }));

const existingBySourceRef = new Map(
  dataset.chargers.filter((row) => row.source_ref).map((row) => [row.source_ref, row])
);
const used = new Set();
const matches = [];
const additions = [];
let statusUpdates = 0;
const existing = dataset.chargers;

for (const site of source.sites) {
  const sourceRef = `supercharge.info:${site.id}`;
  let match = existingBySourceRef.get(sourceRef) ?? null;
  let bestDistance = match ? 0 : Infinity;

  if (!match) {
    const point = { lat: site.gps.latitude, lng: site.gps.longitude };
    for (const row of existing) {
      if (used.has(row.id) || normalizeCountry(row.country) !== normalizeCountry(site.address?.country)) continue;
      const meters = distanceMeters(point, { lat: row.lat, lng: row.lng });
      if (meters <= 100 && meters < bestDistance) {
        match = row;
        bestDistance = meters;
      }
    }
  }

  if (!match) {
    const point = { lat: site.gps.latitude, lng: site.gps.longitude };
    for (const row of existing) {
      if (used.has(row.id) || normalizeCountry(row.country) !== normalizeCountry(site.address?.country)) continue;
      const meters = distanceMeters(point, { lat: row.lat, lng: row.lng });
      if (meters > 1000 || meters >= bestDistance || !nameSimilar(site, row)) continue;
      match = row;
      bestDistance = meters;
    }
  }

  if (match) {
    used.add(match.id);
    match.source_ref = sourceRef;
    match.source_updated_at = source.exportedAt;
    if (match.data_source !== "manual") {
      const previousStatus = match.status;
      let nextStatus = statusMap[site.status] ?? match.status;
      const override = manualStatusOverrides.get(normalize(match.name));
      if (override) nextStatus = override;
      // A public PLAN/PERMIT marker must not turn a currently operating site into a closed site.
      if (match.status === "operational" && ["planned", "permit"].includes(nextStatus)) {
        nextStatus = match.status;
      }
      match.status = nextStatus;
      if (match.status !== previousStatus) statusUpdates += 1;

      if (Number(site.stallCount) > 0 && !["planned", "permit", "voting"].includes(nextStatus)) {
        match.total_stalls = Number(site.stallCount);
      }
      if (Number(site.powerKilowatt) > 0) match.max_speed_kw = Number(site.powerKilowatt);
      const versions = chargerVersions(site);
      if (versions.length) {
        match.versions = versions.map((item) => item.version);
        match.charger_configs = versions.map((item) => ({
          count: item.count,
          speedKw: Number(site.powerKilowatt) || null,
          version: item.version,
        }));
        match.stall_types = versions.map((item) => `${item.count} ${item.version}`).join(" + ")
          + (Number(site.powerKilowatt) > 0 ? ` laders ${site.powerKilowatt}kW` : " laders");
      }
      if (!match.city && site.address?.city) match.city = site.address.city;
      if (!match.province && site.address?.state) match.province = site.address.state;
      if (!match.owner_name && site.facilityName) match.owner_name = site.facilityName;
      if (site.stalls && "trailerFriendly" in site.stalls) {
        match.trailer_friendly = Number(site.stalls.trailerFriendly) > 0;
      }
      match.is_available = ["operational", "works"].includes(match.status);
      if (match.status === "long_closed") {
        const days = Math.max(0, Number(site.statusDays) || 0);
        const closedAt = new Date(Date.parse(source.exportedAt) - days * 86400000);
        match.permanently_closed_at = closedAt.toISOString();
      } else if (match.status !== "long_closed") {
        match.permanently_closed_at = null;
      }
    }
    matches.push({ id: match.id, name: match.name, status: match.status, sourceStatus: site.status, meters: Math.round(bestDistance) });
    continue;
  }

  // Do not add old permanently closed sites that have no current baseline entry.
  if (site.status === "CLOSED_PERM") continue;

  const versions = chargerVersions(site);
  const status = statusMap[site.status] ?? "planned";
  const country = site.address?.country === "Turkey" ? "Türkiye" : site.address?.country;
  const id = `00000000-0000-4000-8000-${String(site.id).padStart(12, "0")}`;
  if (existing.some((row) => row.id === id)) continue;
  const stallTypes = versions.length
    ? versions.map((item) => `${item.count} ${item.version}`).join(" + ")
      + (Number(site.powerKilowatt) > 0 ? ` laders ${site.powerKilowatt}kW` : " laders")
    : null;

  additions.push({
    id,
    name: String(site.name ?? "").replace(/^\[EV OTM\]\s*/i, ""),
    lat: site.gps.latitude,
    lng: site.gps.longitude,
    total_stalls: Number(site.stallCount) > 0 ? Number(site.stallCount) : null,
    stall_types: stallTypes,
    country,
    province: site.address?.state ?? null,
    city: site.address?.city ?? null,
    max_speed_kw: Number(site.powerKilowatt) > 0 ? Number(site.powerKilowatt) : null,
    versions: versions.map((item) => item.version),
    status,
    construction: {},
    works: {},
    closure: {},
    planned_upgrade: {},
    opening_hours: null,
    is_available: ["operational", "works"].includes(status),
    charger_configs: versions.map((item) => ({
      count: item.count,
      speedKw: Number(site.powerKilowatt) || null,
      version: item.version,
    })),
    trailer_friendly: Number(site.stalls?.trailerFriendly) > 0,
    owner_id: null,
    owner_name: site.facilityName ?? null,
    low_speed: Number(site.powerKilowatt) > 0 && Number(site.powerKilowatt) < 150,
    published: true,
    notes: site.accessNotes ?? site.addressNotes ?? null,
    source_ref: sourceRef,
    source_updated_at: source.exportedAt,
    stall_states: {},
    voting: site.status === "VOTING" ? { source: "supercharge.info" } : {},
    photos: [],
    hidden: false,
    data_source: "automatic",
  });
}

dataset.chargers.push(...additions);
dataset.exportedAt = source.exportedAt;
dataset.source = "supercharge.info + TeslaNavigation curated data";
dataset.sourceCount = source.count;

fs.writeFileSync(datasetPath, JSON.stringify(dataset, null, 2) + "\n");
const counts = {};
for (const row of additions) counts[row.status] = (counts[row.status] ?? 0) + 1;
console.log(JSON.stringify({
  sourceSites: source.count,
  matchedExisting: matches.length,
  newSites: additions.length,
  skippedNewPermanentClosures: source.sites.filter((site) => site.status === "CLOSED_PERM").length,
  statusUpdates,
  additionsByStatus: counts,
  preservedOverrides: ["Spier", "Lermoos"],
}, null, 2));
