import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getD1 } from "./d1.server";
import { getCurrentD1User } from "./auth-d1.server";

async function requireUser() {
  const user = await getCurrentD1User();
  if (!user) throw new Error("Je bent niet ingelogd.");
  return user;
}

const accountSettingsSchema = z.object({
  display_name: z.string().trim().max(80).nullable(),
  gender: z.enum(["male", "female", "other", "unspecified"]),
  preferences: z.object({
    vehicle_model: z.string().max(120).nullable().optional(),
    vehicle_year: z.number().int().min(1990).max(2100).nullable().optional(),
    consumption_kwh100: z.number().min(1).max(100).nullable().optional(),
    notifications: z.object({
      favorite_status: z.boolean().default(true),
      price_changes: z.boolean().default(true),
      new_locations: z.boolean().default(false),
    }).default({ favorite_status: true, price_changes: true, new_locations: false }),
    map: z.object({
      show_development_chargers: z.boolean().default(false),
      remember_filters: z.boolean().default(true),
    }).default({ show_development_chargers: false, remember_filters: true }),
    greeting: z.string().trim().max(120).nullable().optional(),
    profile_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    profile_image_url: z.string().url().max(1000).nullable().optional(),
    language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional(),
    units: z.enum(["metric", "imperial"]).optional(),
    display_density: z.enum(["compact", "comfortable"]).optional(),
    font_scale: z.number().min(0.85).max(1.3).optional(),
    theme: z.enum(["light", "dark", "system"]).optional(),
    map_type: z.enum(["road", "satellite"]).optional(),
    map_zoom: z.number().int().min(3).max(18).optional(),
    remembered_countries: z.array(z.string().max(80)).max(100).optional(),
    map_filters: z.record(z.unknown()).optional(),
    status_colors: z.record(z.string().regex(/^#[0-9a-fA-F]{6}$/)).optional(),
    route_preferences: z.object({
      priority: z.enum(["cheapest", "fastest", "fewest_stops"]).optional(),
      default_charge_pause_min: z.number().int().min(0).max(180).optional(),
      max_detour_km: z.number().min(0).max(500).optional(),
      max_distance_between_stops_km: z.number().min(20).max(1000).optional(),
      min_charger_kw: z.number().min(0).max(1000).optional(),
    }).optional(),
    notifications: z.object({
      favorite_status: z.boolean().default(true),
      price_changes: z.boolean().default(true),
      new_locations: z.boolean().default(false),
      closed_locations: z.boolean().default(true),
      status_changes: z.boolean().default(true),
      email_enabled: z.boolean().default(false),
      push_enabled: z.boolean().default(false),
    }).default({ favorite_status: true, price_changes: true, new_locations: false, closed_locations: true, status_changes: true, email_enabled: false, push_enabled: false }),
  }).passthrough().default({}),
});

export const getMyAccountSettings = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const row = await getD1().prepare(
    "SELECT email, display_name, gender, preferences_json FROM users WHERE id = ?"
  ).bind(user.id).first<{ email: string; display_name: string | null; gender: string | null; preferences_json: string | null }>();
  if (!row) throw new Error("Account niet gevonden.");
  let preferences: unknown = {};
  try { preferences = row.preferences_json ? JSON.parse(row.preferences_json) : {}; } catch { preferences = {}; }
  const parsed = accountSettingsSchema.shape.preferences.safeParse(preferences);
  return {
    email: row.email,
    display_name: row.display_name ?? "",
    gender: ["male", "female", "other"].includes(row.gender ?? "") ? row.gender : "unspecified",
    preferences: parsed.success ? parsed.data : accountSettingsSchema.shape.preferences.parse({}),
  };
});

export const updateMyAccountSettings = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => accountSettingsSchema.parse(input))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const displayName = data.display_name?.trim() || null;
    await getD1().prepare(
      "UPDATE users SET display_name = ?, gender = ?, preferences_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(displayName, data.gender, JSON.stringify(data.preferences), user.id).run();
    return { ok: true, display_name: displayName };
  });

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export const listMySavedRoutes = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const { results } = await getD1().prepare("SELECT id,name,start_address,end_address,model_name,route_type,total_distance_km,total_time_min,created_at,payload FROM saved_routes WHERE user_id = ? ORDER BY created_at DESC")
    .bind(user.id).all<Record<string, unknown>>();
  return results.map((row) => ({ ...row, payload: parseJson(row.payload, {}) }));
});

export const getMySavedRoute = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ id: z.string().min(1).max(120) }).parse(input))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const row = await getD1().prepare("SELECT * FROM saved_routes WHERE id = ? AND user_id = ?")
      .bind(data.id, user.id).first<Record<string, unknown>>();
    if (!row) return null;
    return { ...row, payload: parseJson(row.payload, {}) };
  });

export const saveMyRoute = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({
    id: z.string().optional(),
    name: z.string().trim().min(1).max(120),
    start_address: z.string().max(500).nullable().optional(),
    start_lat: z.number().min(-90).max(90),
    start_lng: z.number().min(-180).max(180),
    end_address: z.string().max(500).nullable().optional(),
    end_lat: z.number().min(-90).max(90),
    end_lng: z.number().min(-180).max(180),
    model_name: z.string().max(120),
    battery_percent: z.number().int().min(0).max(100),
    trailer_mode: z.boolean().default(false),
    trailer_reduction: z.number().int().min(0).max(100).default(0),
    weather_mode: z.string().max(30).default("summer"),
    time_mode: z.string().max(30).default("day"),
    route_type: z.string().max(30).default("fastest"),
    charger_ids: z.array(z.string()).default([]),
    total_distance_km: z.number().nullable().optional(),
    total_time_min: z.number().int().nullable().optional(),
    payload: z.record(z.unknown()).default({}),
  }).parse(input))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const id = data.id || crypto.randomUUID();
    const existing = await getD1().prepare("SELECT id FROM saved_routes WHERE id = ? AND user_id = ?").bind(id,user.id).first();
    if (data.id && !existing) throw new Error("Deze opgeslagen route bestaat niet (meer).");
    await getD1().prepare(`INSERT INTO saved_routes
      (id,user_id,name,start_address,start_lat,start_lng,end_address,end_lat,end_lng,model_name,battery_percent,trailer_mode,trailer_reduction,weather_mode,time_mode,route_type,charger_ids,total_distance_km,total_time_min,payload,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,start_address=excluded.start_address,start_lat=excluded.start_lat,start_lng=excluded.start_lng,end_address=excluded.end_address,end_lat=excluded.end_lat,end_lng=excluded.end_lng,model_name=excluded.model_name,battery_percent=excluded.battery_percent,trailer_mode=excluded.trailer_mode,trailer_reduction=excluded.trailer_reduction,weather_mode=excluded.weather_mode,time_mode=excluded.time_mode,route_type=excluded.route_type,charger_ids=excluded.charger_ids,total_distance_km=excluded.total_distance_km,total_time_min=excluded.total_time_min,payload=excluded.payload,updated_at=CURRENT_TIMESTAMP`)
      .bind(id,user.id,data.name,data.start_address??null,data.start_lat,data.start_lng,data.end_address??null,data.end_lat,data.end_lng,data.model_name,data.battery_percent,data.trailer_mode?1:0,data.trailer_reduction,data.weather_mode,data.time_mode,data.route_type,JSON.stringify(data.charger_ids),data.total_distance_km??null,data.total_time_min??null,JSON.stringify(data.payload)).run();
    return { id };
  });

export const shareMyRoute = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().min(1).max(120) }).parse(input))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const row = await getD1().prepare("SELECT share_token FROM saved_routes WHERE id = ? AND user_id = ?").bind(data.id,user.id).first<{share_token:string|null}>();
    if (!row) throw new Error("Route niet gevonden.");
    const token = row.share_token || crypto.randomUUID().replace(/-/g,"");
    await getD1().prepare("UPDATE saved_routes SET share_token = ?, shared = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?").bind(token,data.id,user.id).run();
    return { token };
  });

export const deleteMyRoute = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().min(1).max(120) }).parse(input))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await getD1().prepare("DELETE FROM saved_routes WHERE id = ? AND user_id = ?").bind(data.id,user.id).run();
    return { ok: true };
  });

export const listMyReports = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const { results } = await getD1().prepare("SELECT id,charger_name,category,message,status,admin_note,created_at FROM charger_reports WHERE user_id = ? ORDER BY created_at DESC")
    .bind(user.id).all();
  return results;
});

export const submitChargerReport = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({
    charger_id: z.string().nullable().optional(), charger_name: z.string().max(200).nullable().optional(),
    category: z.string().min(1).max(60), message: z.string().min(3).max(2000),
    contact_email: z.string().email().max(255).nullable().optional(),
  }).parse(input))
  .handler(async ({ data }) => {
    const user = await getCurrentD1User();
    const id = crypto.randomUUID();
    await getD1().prepare("INSERT INTO charger_reports (id,charger_id,charger_name,user_id,contact_email,category,message,status) VALUES (?,?,?,?,?,?,?,'new')")
      .bind(id,data.charger_id??null,data.charger_name??null,user?.id??null,data.contact_email??user?.email??null,data.category,data.message).run();
    return { id };
  });

export const listReportMessages = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ reportId: z.string().min(1).max(120) }).parse(input))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const db = getD1();
    const report = await db.prepare("SELECT user_id FROM charger_reports WHERE id = ?").bind(data.reportId).first<{user_id:string|null}>();
    if (!report || (report.user_id !== user.id && !user.is_admin)) throw new Error("Geen toegang tot deze melding.");
    const { results } = await db.prepare("SELECT id,report_id,sender_id,is_admin,body,created_at FROM report_messages WHERE report_id = ? ORDER BY created_at ASC")
      .bind(data.reportId).all();
    return results;
  });

export const sendReportMessage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ reportId: z.string().min(1).max(120), body: z.string().trim().min(1).max(4000) }).parse(input))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const db = getD1();
    const report = await db.prepare("SELECT user_id FROM charger_reports WHERE id = ?").bind(data.reportId).first<{user_id:string|null}>();
    if (!report || (report.user_id !== user.id && !user.is_admin)) throw new Error("Geen toegang tot deze melding.");
    const id = crypto.randomUUID();
    await db.prepare("INSERT INTO report_messages (id,report_id,sender_id,is_admin,body) VALUES (?,?,?,?,?)")
      .bind(id,data.reportId,user.id,user.is_admin?1:0,data.body).run();
    return { id };
  });

export const getRouteDestination = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ id: z.string().min(1).max(120) }).parse(input))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const row = await getD1().prepare("SELECT end_lat,end_lng,end_address FROM saved_routes WHERE id = ? AND user_id = ?").bind(data.id,user.id).first();
    return row ?? null;
  });


// Account-owned vehicles, charger favorites and personal notes (Cloudflare D1).
const vehicleProfileSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  model_name: z.string().trim().min(1).max(120),
  model_year: z.number().int().min(1990).max(2100).nullable().optional(),
  image_url: z.string().url().max(1000).nullable().optional(),
  battery_kwh: z.number().min(1).max(300).nullable().optional(),
  summer_consumption_kwh100: z.number().min(1).max(120).nullable().optional(),
  winter_consumption_kwh100: z.number().min(1).max(150).nullable().optional(),
  max_charge_kw: z.number().int().min(1).max(1000).nullable().optional(),
  arrival_percent: z.number().int().min(0).max(100).default(10),
  trailer_enabled: z.boolean().default(false),
  trailer_consumption_increase_percent: z.number().int().min(0).max(200).default(0),
  is_default: z.boolean().default(false),
});

export const listMyVehicles = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const { results } = await getD1().prepare(
    "SELECT id,name,model_name,model_year,image_url,battery_kwh,summer_consumption_kwh100,winter_consumption_kwh100,max_charge_kw,arrival_percent,trailer_enabled,trailer_consumption_increase_percent,is_default,created_at,updated_at FROM user_vehicles WHERE user_id = ? ORDER BY is_default DESC, created_at ASC"
  ).bind(user.id).all<Record<string, unknown>>();
  return results.map((row) => ({
    ...row,
    trailer_enabled: row.trailer_enabled === 1,
    is_default: row.is_default === 1,
  }));
});

export const saveMyVehicle = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => vehicleProfileSchema.parse(input))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const db = getD1();
    const id = data.id ?? crypto.randomUUID();
    if (data.id) {
      const exists = await db.prepare("SELECT id FROM user_vehicles WHERE id = ? AND user_id = ?").bind(id, user.id).first();
      if (!exists) throw new Error("Voertuig niet gevonden.");
    }
    if (data.is_default) {
      await db.prepare("UPDATE user_vehicles SET is_default = 0 WHERE user_id = ?").bind(user.id).run();
    }
    await db.prepare(`INSERT INTO user_vehicles
      (id,user_id,name,model_name,model_year,image_url,battery_kwh,summer_consumption_kwh100,winter_consumption_kwh100,max_charge_kw,arrival_percent,trailer_enabled,trailer_consumption_increase_percent,is_default,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,model_name=excluded.model_name,model_year=excluded.model_year,image_url=excluded.image_url,battery_kwh=excluded.battery_kwh,summer_consumption_kwh100=excluded.summer_consumption_kwh100,winter_consumption_kwh100=excluded.winter_consumption_kwh100,max_charge_kw=excluded.max_charge_kw,arrival_percent=excluded.arrival_percent,trailer_enabled=excluded.trailer_enabled,trailer_consumption_increase_percent=excluded.trailer_consumption_increase_percent,is_default=excluded.is_default,updated_at=CURRENT_TIMESTAMP
    `).bind(id,user.id,data.name,data.model_name,data.model_year??null,data.image_url??null,data.battery_kwh??null,data.summer_consumption_kwh100??null,data.winter_consumption_kwh100??null,data.max_charge_kw??null,data.arrival_percent,data.trailer_enabled?1:0,data.trailer_consumption_increase_percent,data.is_default?1:0).run();
    return { id };
  });

export const deleteMyVehicle = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await getD1().prepare("DELETE FROM user_vehicles WHERE id = ? AND user_id = ?").bind(data.id, user.id).run();
    return { ok: true };
  });

export const listMyChargerFavorites = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const { results } = await getD1().prepare("SELECT charger_id FROM user_charger_favorites WHERE user_id = ? ORDER BY created_at DESC").bind(user.id).all<{charger_id:string}>();
  return results.map((row) => row.charger_id);
});

export const setMyChargerFavorite = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ charger_id: z.string().min(1).max(120), favorite: z.boolean() }).parse(input))
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (data.favorite) {
      await getD1().prepare("INSERT OR IGNORE INTO user_charger_favorites (user_id,charger_id) VALUES (?,?)").bind(user.id,data.charger_id).run();
    } else {
      await getD1().prepare("DELETE FROM user_charger_favorites WHERE user_id = ? AND charger_id = ?").bind(user.id,data.charger_id).run();
    }
    return { ok: true };
  });

export const getMyChargerNote = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ charger_id: z.string().min(1).max(120) }).parse(input))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const row = await getD1().prepare("SELECT note FROM user_charger_notes WHERE user_id = ? AND charger_id = ?").bind(user.id,data.charger_id).first<{note:string}>();
    return row?.note ?? "";
  });

export const saveMyChargerNote = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ charger_id: z.string().min(1).max(120), note: z.string().max(4000) }).parse(input))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await getD1().prepare(`INSERT INTO user_charger_notes (user_id,charger_id,note,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(user_id,charger_id) DO UPDATE SET note=excluded.note,updated_at=CURRENT_TIMESTAMP`).bind(user.id,data.charger_id,data.note).run();
    return { ok: true };
  });
