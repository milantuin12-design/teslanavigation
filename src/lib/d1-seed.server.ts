import { getD1, jsonColumn } from "./d1.server";

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

function valueFor(key: string, value: unknown): unknown {
  if (value === undefined) return null;
  if (JSON_FIELDS.has(key)) return jsonColumn(value);
  if (BOOL_FIELDS.has(key) && typeof value === "boolean") return value ? 1 : 0;
  return value;
}

/** Seeds the bundled European Supercharger baseline once; live D1 edits always win afterwards. */
export async function ensureBundledD1Seed() {
  const db = getD1();
  const count = await db.prepare("SELECT COUNT(*) AS count FROM superchargers").first<{count:number}>();
  if ((count?.count ?? 0) > 0) return { seeded: false, count: count?.count ?? 0 };

  const { localChargerDataset } = await import("./local-chargers.server");
  const owners = localChargerDataset.owners ?? [];
  const chargers = localChargerDataset.chargers as unknown as Record<string, unknown>[];
  const { FALLBACK_LANGUAGES } = await import("./i18n");
  for (const [index, language] of FALLBACK_LANGUAGES.entries()) {
    await db.prepare("INSERT INTO languages (code,name,native_name,enabled,is_default,rtl,sort_order) VALUES (?,?,?,?,?,?,?) ON CONFLICT(code) DO NOTHING")
      .bind(language.code, language.name, language.nativeName, 1, language.isDefault ? 1 : 0, language.rtl ? 1 : 0, language.sortOrder || index + 1).run();
  }
  for (const owner of owners) {
    const fields = ["id","name","logo_url","description","website","contact","notes"];
    const vals = fields.map((field) => (owner as unknown as Record<string, unknown>)[field] ?? null);
    await db.prepare(`INSERT INTO charger_owners (${fields.join(",")}) VALUES (${fields.map(()=>"?").join(",")}) ON CONFLICT(id) DO NOTHING`).bind(...vals).run();
  }

  const statements = chargers.map((charger) => {
    const row = Object.fromEntries(CHARGER_FIELDS.filter((field) => field in charger).map((field) => [field, valueFor(field, charger[field])]));
    if (!row.id || !row.name || typeof row.lat !== "number" || typeof row.lng !== "number") return null;
    const fields = Object.keys(row);
    return db.prepare(`INSERT INTO superchargers (${fields.join(",")}) VALUES (${fields.map(()=>"?").join(",")}) ON CONFLICT(id) DO NOTHING`)
      .bind(...fields.map((field) => row[field]));
  }).filter((statement): statement is NonNullable<typeof statement> => statement !== null);

  for (let i = 0; i < statements.length; i += 25) {
    await db.batch(statements.slice(i, i + 25));
  }
  return { seeded: true, count: statements.length };
}
