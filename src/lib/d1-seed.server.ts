import { getD1, jsonColumn } from "./d1.server";
import tariffDataset from "@/data/supercharger-tariffs.json";

const JSON_FIELDS = new Set(["construction","works","closure","versions","opening_hours","charger_configs","planned_upgrade","stall_states","voting","photos","price_blocks","parking_blocks","traffic_forecast"]);
const BOOL_FIELDS = new Set(["trailer_friendly","is_available","parking_fee","in_parking_garage","low_speed","published","hidden"]);
const CHARGER_FIELDS = [
  "id","name","lat","lng","total_stalls","stall_types","occupied_stalls","country","last_updated","status","province","city",
  "construction","works","closure","updated_at","max_speed_kw","versions","opening_time","closing_time","trailer_friendly",
  "opening_hours","is_available","charger_configs","parking_fee","in_parking_garage","owner_id","owner_name","low_speed",
  "published","notes","reopen_at","planned_upgrade","stall_states","permanently_closed_at","data_source","source_ref",
  "source_updated_at","voting","hidden","photos","price_currency","price_per_kwh","price_per_kwh_peak","peak_hours",
  "price_blocks","parking_fee_amount","parking_free_minutes","parking_per_minutes","parking_per_euro","parking_blocks","traffic_forecast"
];

function normalizeMatch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function getBundledPrice(row: Record<string, unknown>) {
  if (row.status !== "operational") return null;
  const tariffs = (tariffDataset as unknown as { tariffs: Array<{
    country: string; countryAliases?: string[]; match: string[];
    currency?: string; pricePerKwh?: number;
    priceBlocks?: Array<{from:string;to:string;pricePerKwh:number}>;
  }> }).tariffs ?? [];
  const country = normalizeMatch(String(row.country ?? ""));
  const name = normalizeMatch([row.name,row.city,row.province].filter(Boolean).join(" "));
  const tariff = tariffs.find((item) =>
    [item.country, ...(item.countryAliases ?? [])].some((value) => normalizeMatch(value) === country) &&
    item.match.some((term) => {
      const normalized = normalizeMatch(term);
      return name === normalized || name.includes(normalized);
    })
  );
  if (!tariff) return null;
  const blocks = tariff.priceBlocks?.length
    ? tariff.priceBlocks
    : typeof tariff.pricePerKwh === "number"
      ? [{ from: "00:00", to: "24:00", pricePerKwh: tariff.pricePerKwh }]
      : [];
  if (!blocks.length) return null;
  return { currency: tariff.currency ?? "EUR", blocks };
}

function valueFor(key: string, value: unknown): unknown {
  if (value === undefined) return null;
  if (JSON_FIELDS.has(key)) return jsonColumn(value);
  if (BOOL_FIELDS.has(key) && typeof value === "boolean") return value ? 1 : 0;
  return value;
}

/**
 * Refreshes the bundled baseline when its checked-in version changes.
 * Static site facts are synced only for automatic/bundled rows. Manual admin
 * edits, statuses, opening hours, photos, notes, closures and saved tariffs remain intact.
 */
export async function ensureBundledD1Seed() {
  const db = getD1();
  const { localChargerDataset } = await import("./local-chargers.server");
  const owners = Array.isArray(localChargerDataset.owners) ? localChargerDataset.owners : [];
  const chargers = Array.isArray(localChargerDataset.chargers) ? localChargerDataset.chargers as unknown as Record<string, unknown>[] : [];
  const { FALLBACK_LANGUAGES } = await import("./i18n");
  const datasetVersion = `restore-baseline-2026-11-18-v2:${String((localChargerDataset as unknown as { exportedAt?: string }).exportedAt ?? "unknown")}`;
  const tariffVersion = String((tariffDataset as unknown as { checkedAt?: string }).checkedAt ?? "unknown");

  for (const [index, language] of (Array.isArray(FALLBACK_LANGUAGES) ? FALLBACK_LANGUAGES : []).entries()) {
    await db.prepare("INSERT INTO languages (code,name,native_name,enabled,is_default,rtl,sort_order) VALUES (?,?,?,?,?,?,?) ON CONFLICT(code) DO NOTHING")
      .bind(language.code, language.name, language.nativeName, 1, language.isDefault ? 1 : 0, language.rtl ? 1 : 0, language.sortOrder || index + 1).run();
  }
  for (const owner of owners) {
    const fields = ["id","name","logo_url","description","website","contact","notes"];
    const vals = fields.map((field) => (owner as unknown as Record<string, unknown>)[field] ?? null);
    await db.prepare(`INSERT INTO charger_owners (${fields.join(",")}) VALUES (${fields.map(()=>"?").join(",")}) ON CONFLICT DO NOTHING`).bind(...vals).run();
  }

  const meta = async (key: string) => db.prepare("SELECT value FROM app_meta WHERE key = ?").bind(key).first<{value:string}>();
  const setMeta = async (key: string, value: string) => db.prepare(
    "INSERT INTO app_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')"
  ).bind(key,value).run();

  const datasetState = await meta("bundled_dataset_version");
  let inserted = 0;

  // The bundled dataset is a source for missing public locations, NOT a source
  // of truth for records already present in D1. Existing rows may contain admin
  // edits even when an old deployment left data_source='automatic'. Therefore
  // never update an existing Supercharger from this seed, regardless of source.
  // This prevents a changed exportedAt/dataset version from reverting settings.
  if (datasetState?.value !== datasetVersion) {
    const statements = chargers.flatMap((charger) => {
      if (!charger.id || !charger.name || typeof charger.lat !== "number" || typeof charger.lng !== "number") return [];
      const row = Object.fromEntries(CHARGER_FIELDS.filter((field) => field in charger).map((field) => [field, valueFor(field, charger[field])]));
      const bundledPrice = getBundledPrice(charger);
      row.data_source = row.data_source ?? "automatic";
      if (bundledPrice && (!Array.isArray(charger.price_blocks) || charger.price_blocks.length === 0)) {
        row.price_currency = bundledPrice.currency;
        row.price_blocks = JSON.stringify(bundledPrice.blocks);
        row.price_per_kwh = null;
        row.price_per_kwh_peak = null;
        row.peak_hours = null;
      }
      const fields = Object.keys(row);
      return [db.prepare(`INSERT INTO superchargers (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")}) ON CONFLICT(id) DO NOTHING`)
        .bind(...fields.map((field) => row[field]))];
    });
    for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
    inserted = statements.length;
    await setMeta("bundled_dataset_version", datasetVersion);
  }

  // Never backfill tariffs into existing D1 records. An empty tariff can be an
  // intentional admin choice, and all existing rows are protected from seed writes.
  const tariffState = await meta("bundled_tariff_version");
  if (tariffState?.value !== tariffVersion) await setMeta("bundled_tariff_version", tariffVersion);

  const count = await db.prepare("SELECT COUNT(*) AS count FROM superchargers").first<{count:number}>();
  return { seeded: inserted > 0 && (count?.count ?? 0) === inserted, inserted, count: count?.count ?? 0 };
}
