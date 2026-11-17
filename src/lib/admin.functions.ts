import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ChargerOwner, SiteUpdate } from "./tesla-types";
import type { Json } from "@/integrations/supabase/types";

type Ctx = { supabase: unknown; userId: string };

async function assertAdmin(context: Ctx) {
  const sb = context.supabase as {
    rpc: (fn: "has_role", args: { _user_id: string; _role: "admin" | "user" }) => PromiseLike<{
      data: boolean | null;
      error: { message: string } | null;
    }>;
  };
  const { data, error } = await sb.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

async function logAction(context: Ctx, action: string, targetCount: number, details: Record<string, unknown>) {
  const sb = context.supabase as {
    from: (t: string) => { insert: (v: unknown) => PromiseLike<{ error: { message: string } | null }> };
  };
  await sb.from("admin_audit_log").insert({
    user_id: context.userId,
    action,
    target_count: targetCount,
    details: details as Json,
  });
}

/* ---------------- Owners ---------------- */

type OwnerRow = {
  id: string;
  name: string;
  logo_url: string | null;
  description: string | null;
  website: string | null;
  contact: string | null;
  notes: string | null;
};

export const listOwners = createServerFn({ method: "GET" }).handler(async (): Promise<ChargerOwner[]> => {
  const { getD1 } = await import("./d1.server");
  const rows = await getD1().prepare("SELECT id,name,logo_url,description,website,contact,notes FROM charger_owners ORDER BY name COLLATE NOCASE").all<OwnerRow>();
  return (rows.results ?? []).map((row) => ({
    id: row.id, name: row.name, logoUrl: row.logo_url, description: row.description,
    website: row.website, contact: row.contact, notes: row.notes,
  }));
});

const ownerInput = z.object({
  id: z.string().max(120).optional(),
  name: z.string().trim().min(1).max(120),
  logoUrl: z.string().max(500).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  website: z.string().max(300).nullable().optional(),
  contact: z.string().max(300).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const upsertOwner = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => ownerInput.parse(input))
  .handler(async ({ data }) => {
    const { getD1 } = await import("./d1.server");
    const { getCurrentD1User } = await import("./auth-d1.server");
    const user = await getCurrentD1User();
    if (!user?.is_admin) throw new Error("Alleen een beheerder kan eigenaren aanpassen.");
    const id = data.id ?? crypto.randomUUID();
    await getD1().prepare(`INSERT INTO charger_owners (id,name,logo_url,description,website,contact,notes,updated_at)
      VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,logo_url=excluded.logo_url,description=excluded.description,website=excluded.website,contact=excluded.contact,notes=excluded.notes,updated_at=CURRENT_TIMESTAMP`)
      .bind(id,data.name,data.logoUrl??null,data.description??null,data.website??null,data.contact??null,data.notes??null).run();
    return {id};
  });

export const deleteOwner = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({id:z.string().min(1).max(120)}).parse(input))
  .handler(async ({data}) => {
    const { getD1 } = await import("./d1.server");
    const { getCurrentD1User } = await import("./auth-d1.server");
    const user = await getCurrentD1User();
    if (!user?.is_admin) throw new Error("Alleen een beheerder kan eigenaren verwijderen.");
    await getD1().prepare("DELETE FROM charger_owners WHERE id=?").bind(data.id).run();
    return {ok:true};
  });

/* ---------------- Site updates ---------------- */

type UpdateRow = {
  id: string;
  title: string;
  body: string | null;
  image_url: string | null;
  importance: string;
  published_at: string;
  visible: boolean;
};

export const listSiteUpdates = createServerFn({ method: "GET" }).handler(async (): Promise<SiteUpdate[]> => {
  const { getD1 } = await import("./d1.server");
  const { results } = await getD1().prepare("SELECT id,title,body,image_url,importance,published_at,visible FROM site_updates WHERE visible=1 ORDER BY published_at DESC LIMIT 50").all<UpdateRow>();
  return (results ?? []).map((row) => ({
    id: row.id, title: row.title, body: row.body, imageUrl: row.image_url,
    importance: row.importance, publishedAt: row.published_at, visible: Boolean(row.visible),
  }));
});

const updateInput = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(4000).nullable().optional(),
  imageUrl: z.string().max(500).nullable().optional(),
  importance: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  publishedAt: z.string().optional(),
  visible: z.boolean().default(true),
});

export const upsertSiteUpdate = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => updateInput.parse(input))
  .handler(async ({ data }) => {
    const user = await requireD1Admin();
    const id = data.id ?? crypto.randomUUID();
    await getD1().prepare(`INSERT INTO site_updates (id,title,body,image_url,importance,published_at,visible,updated_at)
      VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,image_url=excluded.image_url,importance=excluded.importance,published_at=excluded.published_at,visible=excluded.visible,updated_at=CURRENT_TIMESTAMP`)
      .bind(id,data.title,data.body??null,data.imageUrl??null,data.importance,data.publishedAt??new Date().toISOString(),data.visible?1:0).run();
    await d1Audit(user.id,"site_update_save",1,{id,title:data.title});
    return {id};
  });

export const deleteSiteUpdate = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().min(1).max(120) }).parse(input))
  .handler(async ({ data }) => {
    const user = await requireD1Admin();
    await getD1().prepare("DELETE FROM site_updates WHERE id=?").bind(data.id).run();
    await d1Audit(user.id,"site_update_delete",1,{id:data.id});
    return {ok:true};
  });

/* ---------------- Bulk edit ---------------- */

const bulkInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(5000),
  changes: z.object({
    trailerFriendly: z.boolean().optional(),
    isAvailable: z.boolean().optional(),
    parkingFee: z.boolean().optional(),
    inParkingGarage: z.boolean().optional(),
    lowSpeed: z.boolean().optional(),
    published: z.boolean().optional(),
    ownerId: z.string().uuid().nullable().optional(),
    status: z.enum(["operational", "construction", "works", "works_closed", "temp_closed", "long_closed", "voting", "plan", "permit", "expanding", "permanent_closed", "unknown"]).optional(),
    country: z.string().max(100).optional(),
    province: z.string().max(100).optional(),
    maxSpeedKw: z.number().int().min(0).max(1000).optional(),
    versions: z.array(z.string().max(10)).optional(),
    notes: z.string().max(1000).optional(),
    reopenAt: z.string().nullable().optional(),
    expectedOpenMonth: z.string().max(60).optional(),
    plannedUpgradeLabel: z.string().max(120).optional(),
    pricePerKwh: z.number().min(0).max(10).nullable().optional(),
    pricePerKwhPeak: z.number().min(0).max(10).nullable().optional(),
    peakHours: z.string().max(120).nullable().optional(),
    priceBlocks: z.array(z.object({
      days: z.string().max(40).optional(),
      from: z.string().max(5).optional(),
      to: z.string().max(5).optional(),
      pricePerKwh: z.number().min(0).max(10),
    })).max(12).nullable().optional(),
    parkingFeeAmount: z.number().min(0).max(1000).nullable().optional(),
    parkingFreeMinutes: z.number().int().min(0).max(1440).nullable().optional(),
    parkingPerMinutes: z.number().int().min(1).max(1440).nullable().optional(),
    parkingPerEuro: z.number().min(0).max(1000).nullable().optional(),
  }),
});

export const bulkUpdateSuperchargers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => bulkInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const c = data.changes;
    const payload: Record<string, unknown> = {};
    if (c.trailerFriendly !== undefined) payload["trailer_friendly"] = c.trailerFriendly;
    if (c.isAvailable !== undefined) payload["is_available"] = c.isAvailable;
    if (c.parkingFee !== undefined) payload["parking_fee"] = c.parkingFee;
    if (c.inParkingGarage !== undefined) payload["in_parking_garage"] = c.inParkingGarage;
    if (c.lowSpeed !== undefined) payload["low_speed"] = c.lowSpeed;
    if (c.published !== undefined) payload["published"] = c.published;
    if (c.ownerId !== undefined) payload["owner_id"] = c.ownerId;
    if (c.status !== undefined) payload["status"] = c.status;
    if (c.country) payload["country"] = c.country;
    if (c.province) payload["province"] = c.province;
    if (c.maxSpeedKw !== undefined) payload["max_speed_kw"] = c.maxSpeedKw;
    if (c.versions && c.versions.length > 0) payload["versions"] = c.versions;
    if (c.notes !== undefined) payload["notes"] = c.notes;
    if (c.reopenAt !== undefined) payload["reopen_at"] = c.reopenAt || null;
    if (c.pricePerKwh !== undefined) payload["price_per_kwh"] = c.pricePerKwh;
    if (c.pricePerKwhPeak !== undefined) payload["price_per_kwh_peak"] = c.pricePerKwhPeak;
    if (c.peakHours !== undefined) payload["peak_hours"] = c.peakHours;
    if (c.priceBlocks !== undefined) payload["price_blocks"] = c.priceBlocks;
    if (c.parkingFeeAmount !== undefined) payload["parking_fee_amount"] = c.parkingFeeAmount;
    if (c.parkingFreeMinutes !== undefined) payload["parking_free_minutes"] = c.parkingFreeMinutes;
    if (c.parkingPerMinutes !== undefined) payload["parking_per_minutes"] = c.parkingPerMinutes;
    if (c.parkingPerEuro !== undefined) payload["parking_per_euro"] = c.parkingPerEuro;

    if (Object.keys(payload).length === 0 && !c.expectedOpenMonth && !c.plannedUpgradeLabel) {
      return { updated: 0 };
    }
    if (Object.keys(payload).length > 0) payload["data_source"] = "manual";

    const sb = context.supabase as unknown as {
      from: (t: string) => {
        update: (v: unknown) => { in: (col: string, vals: string[]) => PromiseLike<{ error: { message: string } | null }> };
        select: (cols: string) => { in: (col: string, vals: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }> };
      };
    };

    const chunk = 300;
    for (let i = 0; i < data.ids.length; i += chunk) {
      const slice = data.ids.slice(i, i + chunk);
      if (Object.keys(payload).length > 0) {
        const { error } = await sb.from("superchargers").update(payload).in("id", slice);
        if (error) throw new Error(error.message);
      }
      if (c.expectedOpenMonth || c.plannedUpgradeLabel) {
        const { data: rows, error } = await sb
          .from("superchargers")
          .select("id,construction,planned_upgrade")
          .in("id", slice);
        if (error) throw new Error(error.message);
        for (const row of (rows ?? []) as { id: string; construction: Record<string, unknown> | null; planned_upgrade: Record<string, unknown> | null }[]) {
          const patch: Record<string, unknown> = {};
          if (c.expectedOpenMonth) patch["construction"] = { ...(row.construction ?? {}), expectedOpenMonth: c.expectedOpenMonth };
          if (c.plannedUpgradeLabel) patch["planned_upgrade"] = { ...(row.planned_upgrade ?? {}), label: c.plannedUpgradeLabel };
          const { error: upErr } = await sb.from("superchargers").update(patch).in("id", [row.id]);
          if (upErr) throw new Error(upErr.message);
        }
      }
    }

    await logAction(context, "bulk_update", data.ids.length, c as Record<string, unknown>);
    return { updated: data.ids.length };
  });

export const publishDrafts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ ids: z.array(z.string().uuid()).optional() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb = context.supabase as unknown as {
      from: (t: string) => {
        update: (v: unknown) => {
          in: (col: string, vals: string[]) => PromiseLike<{ error: { message: string } | null }>;
          eq: (col: string, val: unknown) => PromiseLike<{ error: { message: string } | null }>;
        };
      };
    };
    const q = sb.from("superchargers").update({ published: true });
    const { error } = data.ids && data.ids.length > 0 ? await q.in("id", data.ids) : await q.eq("published", false);
    if (error) throw new Error(error.message);
    await logAction(context, "publish_drafts", data.ids?.length ?? 0, {});
    return { ok: true };
  });

/* ---------------- Reports ---------------- */

export type ReportRow = {
  id: string;
  charger_id: string | null;
  charger_name: string | null;
  user_id: string | null;
  contact_email: string | null;
  category: string;
  message: string;
  status: string;
  admin_note: string | null;
  photos: string[] | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
};

export const listReports = createServerFn({ method: "GET" }).handler(async (): Promise<ReportRow[]> => {
  await requireD1Admin();
  const rows = await getD1().prepare("SELECT id,charger_id,charger_name,user_id,contact_email,category,message,status,admin_note,photos,lat,lng,created_at FROM charger_reports ORDER BY created_at DESC LIMIT 300").all<Record<string,unknown>>();
  return (rows.results??[]).map(row=>({...row,photos:typeof row.photos==="string"?(()=>{try{return JSON.parse(row.photos as string);}catch{return [];}})():row.photos}) as ReportRow);
});

export const updateReportStatus = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({
    id:z.string().min(1).max(120), status:z.enum(["new","seen","in_progress","resolved"]),
    adminNote:z.string().max(2000).nullable().optional(),
  }).parse(input))
  .handler(async ({data}) => {
    const user=await requireD1Admin();
    const result=await getD1().prepare("UPDATE charger_reports SET status=?,admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(data.status,data.adminNote??null,data.id).run();
    if(!result.meta?.changes) throw new Error("Melding niet gevonden.");
    await d1Audit(user.id,"report_status_update",1,{id:data.id,status:data.status});
    return {ok:true};
  });

/* ---------------- Cloudflare D1 admin API ---------------- */

import { getD1 } from "./d1.server";
import { getCurrentD1User } from "./auth-d1.server";

async function requireD1Admin() {
  const user = await getCurrentD1User();
  if (!user) throw new Error("Je bent niet ingelogd. Log opnieuw in.");
  if (!user.is_admin) throw new Error("Je account heeft geen beheerdersrechten.");
  return user;
}
const d1JsonColumns = new Set(["versions","opening_hours","charger_configs","parking_blocks","construction","planned_upgrade","stall_states","traffic_forecast","works","closure","photos","price_blocks","voting"]);
function d1DecodeCharger(row: Record<string, unknown>) {
  const result = { ...row };
  for (const key of d1JsonColumns) {
    const value = result[key];
    if (typeof value === "string") { try { result[key] = JSON.parse(value); } catch { /* preserve malformed legacy value for admin repair */ } }
  }
  for (const key of ["trailer_friendly","is_available","parking_fee","in_parking_garage","low_speed","published","hidden"]) {
    if (result[key] !== undefined) result[key] = Number(result[key]) === 1;
  }
  return result;
}
async function d1Audit(userId: string, action: string, targetCount: number, details: Record<string, unknown>) {
  const db = getD1();
  await db.prepare("INSERT INTO admin_audit_log (id,user_id,action,target_count,details) VALUES (?,?,?,?,?)")
    .bind(crypto.randomUUID(), userId, action, targetCount, JSON.stringify(details)).run();
}
const adminRawColumns = new Set([
  "id","name","lat","lng","country","province","city","total_stalls","stall_types","max_speed_kw","versions",
  "opening_time","closing_time","opening_hours","trailer_friendly","is_available","charger_configs","parking_fee",
  "parking_fee_amount","parking_free_minutes","parking_per_minutes","parking_per_euro","parking_blocks","price_currency",
  "price_per_kwh","price_per_kwh_peak","peak_hours","in_parking_garage","status","construction","traffic_forecast",
  "works","closure","owner_id","owner_name","low_speed","published","notes","reopen_at","planned_upgrade","stall_states",
  "data_source","hidden","photos","permanently_closed_at","price_blocks","occupied_stalls","last_updated","updated_at","voting"
]);
function d1Value(key: string, value: unknown) {
  if (d1JsonColumns.has(key) && value !== null && value !== undefined) return typeof value === "string" ? value : JSON.stringify(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

export const adminListSuperchargers = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ from: z.number().int().min(0).max(100000).default(0) }).parse(input ?? {}))
  .handler(async ({ data }) => {
    await requireD1Admin();
    const { ensureBundledD1Seed } = await import("./d1-seed.server");
    await ensureBundledD1Seed();
    const db = getD1();
    const rows = await db.prepare("SELECT * FROM superchargers ORDER BY name COLLATE NOCASE LIMIT 1000 OFFSET ?")
      .bind(data.from).all<Record<string, unknown>>();
    return (rows.results ?? []).map(d1DecodeCharger);
  });

export const adminRawUpsertCharger = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.record(z.unknown()).parse(input))
  .handler(async ({ data }) => {
    const user = await requireD1Admin();
    const row = Object.fromEntries(Object.entries(data).filter(([key, value]) => adminRawColumns.has(key) && value !== undefined));
    if (!row.name || !row.country || typeof row.lat !== "number" || typeof row.lng !== "number") throw new Error("Naam, land, breedtegraad en lengtegraad zijn verplicht.");
    if (!row.id) row.id = crypto.randomUUID();
    row.data_source = "manual";
    const entries = Object.entries(row);
    const columns = entries.map(([key]) => key);
    const values = entries.map(([key, value]) => d1Value(key, value));
    const updates = columns.filter(key => key !== "id" && key !== "data_source" && key !== "updated_at").map(key => `${key}=excluded.${key}`).concat(["data_source='manual'","updated_at=CURRENT_TIMESTAMP"]).join(",");
    const db = getD1();
    await db.prepare(`INSERT INTO superchargers (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${updates || "id=excluded.id"}`)
      .bind(...values).run();
    await d1Audit(user.id, "supercharger_upsert", 1, { id: row.id, name: row.name });
    return { id: row.id };
  });

export const adminDeleteCharger = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().min(1).max(120) }).parse(input))
  .handler(async ({ data }) => {
    const user = await requireD1Admin();
    const db = getD1();
    const result = await db.prepare("DELETE FROM superchargers WHERE id = ?").bind(data.id).run();
    if (!result.meta?.changes) throw new Error("Supercharger niet gevonden.");
    await d1Audit(user.id, "supercharger_delete", 1, { id: data.id });
    return { ok: true };
  });

export const adminBulkRawUpdate = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ ids: z.array(z.string().min(1).max(120)).min(1).max(5000), changes: z.record(z.unknown()) }).parse(input))
  .handler(async ({ data }) => {
    const user = await requireD1Admin();
    const changes = Object.fromEntries(Object.entries(data.changes).filter(([key,value]) => adminRawColumns.has(key) && key !== "id" && value !== undefined));
    const keys = Object.keys(changes);
    if (!keys.length) return { updated: 0 };
    const db = getD1();
    const statements = [];
    for (let i=0;i<data.ids.length;i+=100) {
      const ids=data.ids.slice(i,i+100);
      const set=keys.map(key=>`${key}=?`).join(",");
      const binds=[...keys.map(key=>d1Value(key,changes[key])),...ids];
      statements.push(db.prepare(`UPDATE superchargers SET ${set}, data_source='manual', updated_at=CURRENT_TIMESTAMP WHERE id IN (${ids.map(()=>"?").join(",")})`).bind(...binds));
    }
    await db.batch(statements);
    await d1Audit(user.id,"supercharger_bulk_update",data.ids.length,{fields:keys});
    return {updated:data.ids.length};
  });

export const adminListOwners = createServerFn({ method: "GET" }).handler(async () => {
  await requireD1Admin();
  const rows = await getD1().prepare("SELECT id,name FROM charger_owners ORDER BY name COLLATE NOCASE").all();
  return rows.results ?? [];
});
export const adminCreateOwner = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({name:z.string().trim().min(1).max(120)}).parse(input))
  .handler(async ({data}) => {
    const user=await requireD1Admin(); const id=crypto.randomUUID();
    await getD1().prepare("INSERT INTO charger_owners (id,name) VALUES (?,?) ON CONFLICT(name) DO NOTHING").bind(id,data.name).run();
    const row=await getD1().prepare("SELECT id,name FROM charger_owners WHERE name=?").bind(data.name).first();
    if(!row) throw new Error("Eigenaar opslaan mislukt.");
    await d1Audit(user.id,"owner_create",1,{name:data.name});
    return row;
  });

export const adminListUsers = createServerFn({ method: "GET" }).handler(async () => {
  await requireD1Admin(); const db=getD1();
  const users=await db.prepare("SELECT id,email,display_name,blocked,last_active_at,route_count,created_at FROM users ORDER BY created_at DESC").all();
  const roles=await db.prepare("SELECT user_id,role FROM user_roles").all();
  return {users:users.results??[],roles:roles.results??[]};
});
export const adminSetUserBlocked = createServerFn({ method: "POST" })
  .inputValidator((input: unknown)=>z.object({id:z.string().min(1).max(120),blocked:z.boolean()}).parse(input))
  .handler(async ({data})=>{
    const user=await requireD1Admin();
    if(data.id===user.id&&data.blocked) throw new Error("Je kunt je eigen account niet blokkeren.");
    const result=await getD1().prepare("UPDATE users SET blocked=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(data.blocked?1:0,data.id).run();
    if(!result.meta?.changes) throw new Error("Gebruiker niet gevonden.");
    await d1Audit(user.id,"user_block",1,{id:data.id,blocked:data.blocked});
    return {ok:true};
  });

/* Public read-only catalogue used by the route planner; edits remain admin-only. */
export const listPublishedVehicleModels = createServerFn({method:"GET"}).handler(async()=>{
  const rows=await getD1().prepare("SELECT id,brand,model,trim,battery_kwh,usable_kwh,range_km,consumption_kwh100,winter_consumption_kwh100,year_from,year_to,max_charge_kw,connectors,image_url,notes,published FROM vehicle_models WHERE published=1 ORDER BY brand,model,year_from,trim").all<Record<string,unknown>>();
  return (rows.results??[]).map((row)=>({
    id:String(row.id),brand:String(row.brand??"Tesla"),model:String(row.model),trim:row.trim==null?null:String(row.trim),
    batteryKWh:row.battery_kwh==null?null:Number(row.battery_kwh),usableKWh:row.usable_kwh==null?null:Number(row.usable_kwh),
    rangeKm:row.range_km==null?null:Number(row.range_km),consumptionKWh100:row.consumption_kwh100==null?null:Number(row.consumption_kwh100),
    winterConsumptionKWh100:row.winter_consumption_kwh100==null?null:Number(row.winter_consumption_kwh100),
    yearFrom:row.year_from==null?null:Number(row.year_from),yearTo:row.year_to==null?null:Number(row.year_to),
    maxChargeKw:row.max_charge_kw==null?null:Number(row.max_charge_kw),
    connectors:Array.isArray(row.connectors)?row.connectors:(typeof row.connectors==="string"?JSON.parse(row.connectors):["Type 2","CCS"]),
    imageUrl:row.image_url==null?null:String(row.image_url),notes:row.notes==null?null:String(row.notes),published:true,
  }));
});
/* Admin-managed vehicle catalogue: year-specific variants drive the user's vehicle defaults. */
export const adminListVehicleModels = createServerFn({method:"GET"}).handler(async()=>{
  await requireD1Admin();
  const rows=await getD1().prepare("SELECT * FROM vehicle_models ORDER BY brand,model,year_from,trim").all();
  return rows.results??[];
});
export const adminSaveVehicleModel = createServerFn({method:"POST"})
  .inputValidator((input:unknown)=>z.object({
    id:z.string().optional(),brand:z.string().trim().min(1).max(80),model:z.string().trim().min(1).max(120),
    trim:z.string().max(120).nullable().optional(),battery_kwh:z.number().positive().max(300).nullable().optional(),
    usable_kwh:z.number().positive().max(300).nullable().optional(),range_km:z.number().int().positive().max(1500).nullable().optional(),
    consumption_kwh100:z.number().positive().max(100).nullable().optional(),winter_consumption_kwh100:z.number().positive().max(100).nullable().optional(),year_from:z.number().int().min(1990).max(2100),
    year_to:z.number().int().min(1990).max(2100),max_charge_kw:z.number().int().positive().max(1000).nullable().optional(),
    connectors:z.array(z.string().max(30)).max(10).default(["Type 2","CCS"]),image_url:z.string().url().max(1000).nullable().optional(),
    notes:z.string().max(2000).nullable().optional(),published:z.boolean().default(true)
  }).refine(v=>v.year_to>=v.year_from,{message:"Eindbouwjaar moet gelijk aan of later dan beginbouwjaar zijn."}).parse(input))
  .handler(async({data})=>{
    const user=await requireD1Admin(); const id=data.id??crypto.randomUUID();
    await getD1().prepare(`INSERT INTO vehicle_models (id,brand,model,trim,battery_kwh,usable_kwh,range_km,consumption_kwh100,winter_consumption_kwh100,year_from,year_to,max_charge_kw,connectors,image_url,notes,published,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET brand=excluded.brand,model=excluded.model,trim=excluded.trim,battery_kwh=excluded.battery_kwh,usable_kwh=excluded.usable_kwh,range_km=excluded.range_km,consumption_kwh100=excluded.consumption_kwh100,winter_consumption_kwh100=excluded.winter_consumption_kwh100,year_from=excluded.year_from,year_to=excluded.year_to,max_charge_kw=excluded.max_charge_kw,connectors=excluded.connectors,image_url=excluded.image_url,notes=excluded.notes,published=excluded.published,updated_at=CURRENT_TIMESTAMP`)
      .bind(id,data.brand,data.model,data.trim??null,data.battery_kwh??null,data.usable_kwh??null,data.range_km??null,data.consumption_kwh100??null,data.winter_consumption_kwh100??null,data.year_from,data.year_to,data.max_charge_kw??null,JSON.stringify(data.connectors),data.image_url??null,data.notes??null,data.published?1:0).run();
    await d1Audit(user.id,"vehicle_model_save",1,{id,brand:data.brand,model:data.model,years:[data.year_from,data.year_to]});
    return {id};
  });
export const adminDeleteVehicleModel = createServerFn({method:"POST"})
  .inputValidator((input:unknown)=>z.object({id:z.string().min(1).max(120)}).parse(input))
  .handler(async({data})=>{
    const user=await requireD1Admin();
    await getD1().prepare("DELETE FROM vehicle_models WHERE id=?").bind(data.id).run();
    await d1Audit(user.id,"vehicle_model_delete",1,{id:data.id});
    return {ok:true};
  });

export const adminListLanguages = createServerFn({method:"GET"}).handler(async()=>{
  await requireD1Admin();
  const rows=await getD1().prepare("SELECT code,name,native_name,enabled,is_default,rtl,sort_order FROM languages ORDER BY sort_order,name").all<Record<string,unknown>>();
  return (rows.results??[]).map(r=>({...r,enabled:Number(r.enabled)===1,is_default:Number(r.is_default)===1,rtl:Number(r.rtl)===1}));
});
export const adminListTranslations = createServerFn({method:"GET"})
  .inputValidator((input:unknown)=>z.object({code:z.string().min(2).max(5)}).parse(input))
  .handler(async({data})=>{
    await requireD1Admin();
    const rows=await getD1().prepare("SELECT id,lang_code,key,value FROM translations WHERE lang_code=? ORDER BY key").bind(data.code).all();
    return rows.results??[];
  });
export const adminToggleLanguage = createServerFn({method:"POST"})
  .inputValidator((input:unknown)=>z.object({code:z.string().min(2).max(5),enabled:z.boolean()}).parse(input))
  .handler(async({data})=>{
    const user=await requireD1Admin();
    const result=await getD1().prepare("UPDATE languages SET enabled=?,updated_at=CURRENT_TIMESTAMP WHERE code=?").bind(data.enabled?1:0,data.code).run();
    if(!result.meta?.changes) throw new Error("Taal niet gevonden.");
    await d1Audit(user.id,"language_toggle",1,{code:data.code,enabled:data.enabled});
    return {ok:true};
  });
export const adminSaveTranslation = createServerFn({method:"POST"})
  .inputValidator((input:unknown)=>z.object({id:z.string().optional(),lang_code:z.string().min(2).max(5),key:z.string().min(1).max(300),value:z.string().max(2000)}).parse(input))
  .handler(async({data})=>{
    const user=await requireD1Admin();
    const id=data.id??crypto.randomUUID();
    await getD1().prepare("INSERT INTO translations (id,lang_code,key,value,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP")
      .bind(id,data.lang_code,data.key,data.value).run();
    await d1Audit(user.id,"translation_save",1,{id,lang_code:data.lang_code,key:data.key});
    return {id};
  });

export const adminListChargerChanges = createServerFn({method:"GET"})
  .inputValidator((input:unknown)=>z.object({limit:z.number().int().min(1).max(300),from:z.string().optional(),to:z.string().optional()}).parse(input))
  .handler(async({data})=>{
    await requireD1Admin();
    const where:string[]=[];const values:unknown[]=[];
    if(data.from){where.push("created_at>=?");values.push(data.from);}
    if(data.to){where.push("created_at<=?");values.push(data.to);}
    const sql="SELECT id,charger_id,charger_name,action,changed_fields,created_at FROM charger_changes "+(where.length?"WHERE "+where.join(" AND "):"")+" ORDER BY created_at DESC LIMIT ?";
    const rows=await getD1().prepare(sql).bind(...values,data.limit*3).all<Record<string,unknown>>();
    return (rows.results??[]).map(r=>({...r,changed_fields:typeof r.changed_fields==="string"?(()=>{try{return JSON.parse(r.changed_fields as string);}catch{return {};}})():r.changed_fields}))
      .filter((r:any)=>r.action!=="update"||!!r.changed_fields?.status).slice(0,data.limit);
  });
export const adminUpdateChargerChange = createServerFn({method:"POST"})
  .inputValidator((input:unknown)=>z.object({id:z.string().min(1).max(120),charger_name:z.string().max(200),changed_fields:z.record(z.unknown())}).parse(input))
  .handler(async({data})=>{
    const user=await requireD1Admin();
    const result=await getD1().prepare("UPDATE charger_changes SET charger_name=?,changed_fields=? WHERE id=?").bind(data.charger_name,JSON.stringify(data.changed_fields),data.id).run();
    if(!result.meta?.changes) throw new Error("Wijziging niet gevonden.");
    await d1Audit(user.id,"charger_change_edit",1,{id:data.id});
    return {ok:true};
  });
export const adminDeleteChargerChange = createServerFn({method:"POST"})
  .inputValidator((input:unknown)=>z.object({id:z.string().min(1).max(120)}).parse(input))
  .handler(async({data})=>{
    const user=await requireD1Admin();
    await getD1().prepare("DELETE FROM charger_changes WHERE id=?").bind(data.id).run();
    await d1Audit(user.id,"charger_change_delete",1,{id:data.id});
    return {ok:true};
  });
