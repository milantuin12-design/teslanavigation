import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getD1 } from "./d1.server";
import { getCurrentD1User } from "./auth-d1.server";

async function requireUser() {
  const user = await getCurrentD1User();
  if (!user) throw new Error("Je bent niet ingelogd.");
  return user;
}
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
