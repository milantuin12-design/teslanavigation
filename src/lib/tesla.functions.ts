import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ChargerConfig, ChargerLifecycleStatus, ClosureInfo, ConstructionInfo, OpeningHours, PlannedUpgrade, Supercharger, WorksInfo } from "./tesla-types";
import type { Json } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getMaxSpeedFromConfigs, getTotalStallsFromConfigs, getVersionsFromConfigs, normalizeChargerConfigs, normalizeOpeningHours, parseChargerConfigsFromLegacy } from "./tesla-utils";

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
  "id,name,lat,lng,total_stalls,stall_types,occupied_stalls,country,province,city,max_speed_kw,versions,opening_time,closing_time,opening_hours,trailer_friendly,is_available,charger_configs,parking_fee,in_parking_garage,status,construction,works,closure,owner_id,low_speed,published,notes,reopen_at,planned_upgrade";

type Row = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  total_stalls: number | null;
  stall_types: string | null;
  occupied_stalls: number | null;
  country: string | null;
  province: string | null;
  city: string | null;
  max_speed_kw: number | null;
  versions: string[] | null;
  opening_time: string | null;
  closing_time: string | null;
  opening_hours: OpeningHours | null;
  trailer_friendly: boolean | null;
  is_available: boolean | null;
  charger_configs: ChargerConfig[] | null;
  parking_fee: boolean | null;
  in_parking_garage: boolean | null;
  status: string | null;
  construction: ConstructionInfo | null;
  works: WorksInfo | null;
  closure: ClosureInfo | null;
  owner_id: string | null;
  low_speed: boolean | null;
  published: boolean | null;
  notes: string | null;
  reopen_at: string | null;
  planned_upgrade: PlannedUpgrade | null;
};

const LIFECYCLE: ChargerLifecycleStatus[] = ['operational', 'construction', 'works', 'works_closed', 'temp_closed', 'long_closed'];

function rowToCharger(row: Row, owners?: Map<string, { name: string; logo_url: string | null }>): Supercharger {
  const normalized = normalizeStallData(row.total_stalls, row.stall_types);
  const chargerConfigs = normalizeChargerConfigs(row.charger_configs).length > 0
    ? normalizeChargerConfigs(row.charger_configs)
    : parseChargerConfigsFromLegacy(row.stall_types, row.total_stalls, row.max_speed_kw, row.versions);
  let status = (LIFECYCLE as string[]).includes(row.status ?? '') ? (row.status as ChargerLifecycleStatus) : 'operational';
  // Tijdelijk gesloten laders gaan automatisch weer open zodra de einddatum voorbij is.
  if (status === 'temp_closed' && row.reopen_at && new Date(row.reopen_at).getTime() <= Date.now()) {
    status = 'operational';
  }
  const owner = row.owner_id ? owners?.get(row.owner_id) : undefined;
  return {
    id: row.id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    totalStalls: getTotalStallsFromConfigs(chargerConfigs) ?? normalized.totalStalls,
    occupiedStalls: row.occupied_stalls ?? undefined,
    stallTypes: normalized.stallTypes,
    country: row.country ?? undefined,
    province: row.province ?? undefined,
    city: row.city ?? undefined,
    maxSpeedKw: getMaxSpeedFromConfigs(chargerConfigs) ?? row.max_speed_kw ?? undefined,
    versions: getVersionsFromConfigs(chargerConfigs).length > 0 ? getVersionsFromConfigs(chargerConfigs) : row.versions ?? [],
    chargerConfigs,
    openingHours: normalizeOpeningHours(row.opening_hours, row.opening_time, row.closing_time),
    openingTime: row.opening_time,
    closingTime: row.closing_time,
    trailerFriendly: !!row.trailer_friendly,
    isAvailable: row.is_available !== false,
    parkingFee: !!row.parking_fee,
    inParkingGarage: !!row.in_parking_garage,
    status,
    construction: row.construction ?? {},
    works: row.works ?? {},
    closure: row.closure ?? {},
    ownerId: row.owner_id,
    ownerName: owner?.name ?? null,
    ownerLogoUrl: owner?.logo_url ?? null,
    lowSpeed: !!row.low_speed,
    published: row.published !== false,
    notes: row.notes,
    reopenAt: row.reopen_at,
    plannedUpgrade: row.planned_upgrade ?? {},
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

    const { data: ownerRows } = await supabaseAdmin.from("charger_owners").select("id,name,logo_url");
    const owners = new Map<string, { name: string; logo_url: string | null }>();
    for (const o of (ownerRows ?? []) as { id: string; name: string; logo_url: string | null }[]) {
      owners.set(o.id, { name: o.name, logo_url: o.logo_url });
    }
    return rows.map((row) => rowToCharger(row, owners));
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
  chargerConfigs: z.array(z.object({
    count: z.number().int().min(1).max(500),
    version: z.string().min(1).max(10),
    speedKw: z.number().int().min(1).max(1000),
  })).default([]),
  openingTime: z.string().nullable().optional(),
  closingTime: z.string().nullable().optional(),
  openingHours: z.object({
    mode: z.enum(["24_7", "weekly"]),
    days: z.record(z.object({
      closed: z.boolean().optional(),
      open: z.string(),
      close: z.string(),
    })),
  }).optional(),
  trailerFriendly: z.boolean().default(false),
  isAvailable: z.boolean().default(true),
  parkingFee: z.boolean().default(false),
  inParkingGarage: z.boolean().default(false),
  province: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  status: z.enum(["operational", "construction", "works", "works_closed", "temp_closed", "long_closed"]).default("operational"),
  construction: z.object({
    plannedStalls: z.number().int().min(0).max(500).optional(),
    version: z.string().max(10).optional(),
    speedKw: z.number().int().min(0).max(1000).optional(),
    expectedOpen: z.string().max(40).optional(),
    expectedOpenMonth: z.string().max(60).optional(),
    progress: z.enum(["planned", "permit", "groundwork", "cabling", "installing", "testing"]).optional(),
    steps: z.array(z.string().max(40)).optional(),
    configs: z.array(z.object({ count: z.number().int().min(1).max(500), version: z.string().min(1).max(10), speedKw: z.number().int().min(1).max(1000) })).optional(),
    notes: z.string().max(500).optional(),
  }).default({}),
  works: z.object({
    closedStalls: z.number().int().min(0).max(500).optional(),
    reason: z.string().max(300).optional(),
    expectedEnd: z.string().max(40).optional(),
    notes: z.string().max(500).optional(),
    closedConfigs: z.array(z.object({ count: z.number().int().min(1).max(500), version: z.string().min(1).max(10), speedKw: z.number().int().min(1).max(1000) })).optional(),
    openConfigs: z.array(z.object({ count: z.number().int().min(1).max(500), version: z.string().min(1).max(10), speedKw: z.number().int().min(1).max(1000) })).optional(),
  }).default({}),
  closure: z.object({
    reason: z.string().max(300).optional(),
    from: z.string().max(40).optional(),
    until: z.string().max(40).optional(),
    notes: z.string().max(500).optional(),
  }).default({}),
});


async function assertAdmin(context: { supabase: unknown; userId: string }) {
  const sb = context.supabase as { rpc: (fn: "has_role", args: { _user_id: string; _role: "admin" | "user" }) => PromiseLike<{ data: boolean | null; error: { message: string } | null }> };
  const { data, error } = await sb.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}




export const upsertSupercharger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => chargerInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const configs = normalizeChargerConfigs(data.chargerConfigs);
    const stallTypes = configs.map((config) => `${config.count}x${config.version} ${config.speedKw}kW`).join(" - ");
    const payload = {
      name: data.name,
      lat: data.lat,
      lng: data.lng,
      country: data.country,
      total_stalls: getTotalStallsFromConfigs(configs) ?? data.totalStalls ?? null,
      stall_types: stallTypes || data.stallTypes || null,
      max_speed_kw: getMaxSpeedFromConfigs(configs) ?? data.maxSpeedKw ?? null,
      versions: getVersionsFromConfigs(configs).length > 0 ? getVersionsFromConfigs(configs) : data.versions,
      charger_configs: configs.map((config) => ({ ...config })) as Json,
      opening_hours: normalizeOpeningHours(data.openingHours, data.openingTime, data.closingTime) as unknown as Json,
      opening_time: data.openingTime || null,
      closing_time: data.closingTime || null,
      trailer_friendly: data.trailerFriendly,
      is_available: data.isAvailable,
      parking_fee: data.parkingFee,
      in_parking_garage: data.inParkingGarage,
      province: data.province || null,
      city: data.city || null,
      status: data.status,
      construction: data.construction as Json,
      works: data.works as Json,
      closure: data.closure as Json,
      owner_id: data.ownerId ?? null,
      low_speed: data.lowSpeed,
      published: data.published,
      notes: data.notes ?? null,
      reopen_at: data.reopenAt || null,
      planned_upgrade: data.plannedUpgrade as Json,

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
    await assertAdmin(context);
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
