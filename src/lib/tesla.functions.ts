import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Supercharger } from "./tesla-types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function normalizeStallData(totalStalls?: number | null, stallTypes?: string | null) {
  const rawParts = (stallTypes ?? "")
    .split(/[,+]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const uniqueParts = rawParts.filter((part, index) => rawParts.indexOf(part) === index);
  const parsedTotal = uniqueParts.reduce((sum, part) => {
    const match = part.match(/^(\d+)\s*x/i);
    return sum + (match ? Number(match[1]) : 0);
  }, 0);

  return {
    totalStalls: parsedTotal > 0 ? parsedTotal : totalStalls ?? undefined,
    stallTypes: uniqueParts.length > 0 ? uniqueParts.join(", ") : stallTypes ?? undefined,
  };
}

const SELECT_COLS =
  "id,name,lat,lng,total_stalls,stall_types,occupied_stalls,country,max_speed_kw,versions,opening_time,closing_time,trailer_friendly";

type Row = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  total_stalls: number | null;
  stall_types: string | null;
  occupied_stalls: number | null;
  country: string | null;
  max_speed_kw: number | null;
  versions: string[] | null;
  opening_time: string | null;
  closing_time: string | null;
  trailer_friendly: boolean | null;
};

function rowToCharger(row: Row): Supercharger {
  const normalized = normalizeStallData(row.total_stalls, row.stall_types);
  return {
    id: row.id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    totalStalls: normalized.totalStalls,
    occupiedStalls: row.occupied_stalls ?? undefined,
    stallTypes: normalized.stallTypes,
    country: row.country ?? undefined,
    maxSpeedKw: row.max_speed_kw ?? undefined,
    versions: row.versions ?? [],
    openingTime: row.opening_time,
    closingTime: row.closing_time,
    trailerFriendly: !!row.trailer_friendly,
  };
}

export const listSuperchargers = createServerFn({ method: "GET" }).handler(
  async (): Promise<Supercharger[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pageSize = 1000;
    const rows: Row[] = [];

    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabaseAdmin
        .from("superchargers")
        .select(SELECT_COLS)
        .order("name")
        .range(from, from + pageSize - 1);

      if (error) throw new Error(error.message);
      rows.push(...((data as unknown as Row[]) ?? []));
      if (!data || data.length < pageSize) break;
    }

    return rows.map(rowToCharger);
  }
);

const chargerInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  country: z.string().max(100),
  totalStalls: z.number().int().min(0).max(500).optional(),
  stallTypes: z.string().max(500).optional(),
  maxSpeedKw: z.number().int().min(0).max(1000).optional(),
  versions: z.array(z.string()).default([]),
  openingTime: z.string().nullable().optional(),
  closingTime: z.string().nullable().optional(),
  trailerFriendly: z.boolean().default(false),
});

async function assertAdmin(context: { supabase: ReturnType<typeof createClientLike>; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}
// helper type
type SupabaseAny = { rpc: (fn: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }> };
function createClientLike(): SupabaseAny { return {} as SupabaseAny; }

export const upsertSupercharger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => chargerInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as unknown as { supabase: SupabaseAny; userId: string });
    const payload = {
      name: data.name,
      lat: data.lat,
      lng: data.lng,
      country: data.country,
      total_stalls: data.totalStalls ?? null,
      stall_types: data.stallTypes ?? null,
      max_speed_kw: data.maxSpeedKw ?? null,
      versions: data.versions,
      opening_time: data.openingTime || null,
      closing_time: data.closingTime || null,
      trailer_friendly: data.trailerFriendly,
    };
    if (data.id) {
      const { error } = await context.supabase.from("superchargers").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    } else {
      const { data: inserted, error } = await context.supabase
        .from("superchargers")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { id: (inserted as { id: string }).id };
    }
  });

export const deleteSupercharger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as unknown as { supabase: SupabaseAny; userId: string });
    const { error } = await context.supabase.from("superchargers").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const refreshAvailability = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({}).optional().parse(input ?? {}))
  .handler(async () => {
    return {
      updated: 0,
      failed: 0,
      noGoogleData: 0,
      total: 0,
      timestamp: new Date().toISOString(),
      googleMaps: false,
    };
  });
