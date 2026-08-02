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
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("charger_owners")
    .select("id,name,logo_url,description,website,contact,notes")
    .order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as OwnerRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    logoUrl: row.logo_url,
    description: row.description,
    website: row.website,
    contact: row.contact,
    notes: row.notes,
  }));
});

const ownerInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  logoUrl: z.string().max(500).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  website: z.string().max(300).nullable().optional(),
  contact: z.string().max(300).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const upsertOwner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ownerInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const payload = {
      name: data.name,
      logo_url: data.logoUrl || null,
      description: data.description || null,
      website: data.website || null,
      contact: data.contact || null,
      notes: data.notes || null,
    };
    if (data.id) {
      const { error } = await context.supabase.from("charger_owners").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      await logAction(context, "owner_update", 1, { id: data.id, name: data.name });
      return { id: data.id };
    }
    const { data: inserted, error } = await context.supabase
      .from("charger_owners")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await logAction(context, "owner_create", 1, { name: data.name });
    return { id: (inserted as { id: string }).id };
  });

export const deleteOwner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.from("charger_owners").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAction(context, "owner_delete", 1, { id: data.id });
    return { ok: true };
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
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("site_updates")
    .select("id,title,body,image_url,importance,published_at,visible")
    .order("published_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return ((data ?? []) as UpdateRow[]).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    imageUrl: row.image_url,
    importance: row.importance,
    publishedAt: row.published_at,
    visible: row.visible,
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
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const payload = {
      title: data.title,
      body: data.body || null,
      image_url: data.imageUrl || null,
      importance: data.importance,
      published_at: data.publishedAt || new Date().toISOString(),
      visible: data.visible,
    };
    if (data.id) {
      const { error } = await context.supabase.from("site_updates").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: inserted, error } = await context.supabase
      .from("site_updates")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: (inserted as { id: string }).id };
  });

export const deleteSiteUpdate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.from("site_updates").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
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
    status: z.enum(["operational", "construction", "works", "works_closed", "temp_closed", "long_closed"]).optional(),
    country: z.string().max(100).optional(),
    province: z.string().max(100).optional(),
    maxSpeedKw: z.number().int().min(0).max(1000).optional(),
    versions: z.array(z.string().max(10)).optional(),
    notes: z.string().max(1000).optional(),
    reopenAt: z.string().nullable().optional(),
    expectedOpenMonth: z.string().max(60).optional(),
    plannedUpgradeLabel: z.string().max(120).optional(),
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

    if (Object.keys(payload).length === 0 && !c.expectedOpenMonth && !c.plannedUpgradeLabel) {
      return { updated: 0 };
    }

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

export const listReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("charger_reports")
      .select("id,charger_id,charger_name,user_id,contact_email,category,message,status,admin_note,photos,lat,lng,created_at")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Record<string, unknown>[];
  });

export const updateReportStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["new", "seen", "in_progress", "resolved"]),
        adminNote: z.string().max(2000).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("charger_reports")
      .update({ status: data.status, admin_note: data.adminNote ?? null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
