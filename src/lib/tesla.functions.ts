import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ChargerConfig, ChargerLifecycleStatus, ClosureInfo, ConstructionInfo, OpeningHours, PlannedUpgrade, PriceBlock, ParkingFeeBlock, StallState, Supercharger, VotingInfo, WorksInfo } from "./tesla-types";
import type { Json } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import tariffDataset from "@/data/supercharger-tariffs.json";
import { getMaxSpeedFromConfigs, getTotalStallsFromConfigs, getVersionsFromConfigs, normalizeChargerConfigs, normalizeOpeningHours, parseChargerConfigsFromLegacy } from "./tesla-utils";
import { createAustriaTrafficForecast } from "./traffic-forecast";

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
  "id,name,lat,lng,total_stalls,stall_types,occupied_stalls,country,province,city,max_speed_kw,versions,opening_time,closing_time,opening_hours,trailer_friendly,is_available,charger_configs,parking_fee,parking_fee_amount,parking_free_minutes,parking_per_minutes,parking_per_euro,parking_blocks,price_currency,price_per_kwh,price_per_kwh_peak,peak_hours,in_parking_garage,status,construction,works,closure,owner_id,owner_name,low_speed,published,notes,reopen_at,planned_upgrade,stall_states,permanently_closed_at,data_source,voting,hidden,photos,price_blocks";
const SELECT_COLS_WITHOUT_CURRENCY = SELECT_COLS.replace("price_currency,", "");
const SELECT_COLS_WITHOUT_PARKING_BLOCKS = SELECT_COLS.replace("parking_blocks,", "");
const SELECT_COLS_WITHOUT_BOTH = SELECT_COLS_WITHOUT_PARKING_BLOCKS.replace("price_currency,", "");

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
  parking_fee_amount?: number | null;
  parking_free_minutes?: number | null;
  parking_per_minutes?: number | null;
  parking_per_euro?: number | null;
  parking_blocks?: ParkingFeeBlock[] | null;
  price_per_kwh?: number | null;
  price_currency?: string | null;
  price_per_kwh_peak?: number | null;
  peak_hours?: string | null;
  price_blocks?: PriceBlock[] | null;
  in_parking_garage: boolean | null;
  status: string | null;
  construction: ConstructionInfo | null;
  works: WorksInfo | null;
  closure: ClosureInfo | null;
  owner_id: string | null;
  owner_name: string | null;
  low_speed: boolean | null;
  published: boolean | null;
  notes: string | null;
  reopen_at: string | null;
  planned_upgrade: PlannedUpgrade | null;
  stall_states?: StallState[] | null;
  permanently_closed_at?: string | null;
  data_source?: string | null;
  voting?: VotingInfo | null;
  hidden?: boolean | null;
  photos?: string[] | null;
};

const LIFECYCLE: ChargerLifecycleStatus[] = ['operational', 'construction', 'works', 'works_closed', 'temp_closed', 'long_closed', 'voting', 'plan', 'permit', 'expanding', 'permanent_closed', 'unknown'];

type OwnerRow = { name: string; logo_url: string | null; description: string | null; website: string | null; contact: string | null; notes: string | null };

function rowToCharger(row: Row, owners?: Map<string, OwnerRow>): Supercharger {
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
    // max_speed_kw is an effective site limit and may deliberately be lower
    // than the hardware rating in charger_configs.
    maxSpeedKw: row.max_speed_kw ?? getMaxSpeedFromConfigs(chargerConfigs) ?? undefined,
    versions: getVersionsFromConfigs(chargerConfigs).length > 0 ? getVersionsFromConfigs(chargerConfigs) : row.versions ?? [],
    chargerConfigs,
    openingHours: normalizeOpeningHours(row.opening_hours, row.opening_time, row.closing_time),
    openingTime: row.opening_time,
    closingTime: row.closing_time,
    trailerFriendly: !!row.trailer_friendly,
    isAvailable: row.is_available !== false,
    parkingFee: !!row.parking_fee,
    parkingFeeAmount: row.parking_fee_amount ?? null,
    parkingFreeMinutes: row.parking_free_minutes ?? null,
    parkingPerMinutes: row.parking_per_minutes ?? null,
    parkingPerEuro: row.parking_per_euro ?? null,
    parkingBlocks: Array.isArray(row.parking_blocks) ? row.parking_blocks : null,
    priceCurrency: row.price_currency ?? 'EUR',
    pricePerKwh: row.price_per_kwh ?? null,
    pricePerKwhPeak: row.price_per_kwh_peak ?? null,
    peakHours: row.peak_hours ?? null,
    priceBlocks: Array.isArray(row.price_blocks) ? (row.price_blocks as PriceBlock[]) : null,
    inParkingGarage: !!row.in_parking_garage,
    status,
    construction: row.construction ?? {},
    works: row.works ?? {},
    closure: row.closure ?? {},
    ownerId: row.owner_id,
    ownerName: row.owner_name ?? owner?.name ?? null,
    ownerLogoUrl: row.owner_name ? null : owner?.logo_url ?? null,
    ownerDescription: owner?.description ?? null,
    ownerWebsite: owner?.website ?? null,
    ownerContact: owner?.contact ?? null,
    ownerNotes: owner?.notes ?? null,
    lowSpeed: !!row.low_speed,
    published: row.published !== false,
    notes: row.notes,
    reopenAt: row.reopen_at,
    plannedUpgrade: row.planned_upgrade ?? {},
    stallStates: Array.isArray(row.stall_states) ? row.stall_states : [],
    permanentlyClosedAt: row.permanently_closed_at ?? null,
    dataSource: row.data_source === 'automatic' ? 'automatic' : 'manual',
    voting: row.voting ?? {},
    hidden: !!row.hidden,
    photos: row.photos ?? [],
  };
}


type TariffOverride = {
  country: string;
  countryAliases?: string[];
  match: string[];
  pricePerKwh?: number;
  currency?: string;
  priceBlocks?: { from: string; to: string; pricePerKwh: number }[];
};

function normalizeTariffMatch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function applyTariffOverride(row: Row): Row {
  // An explicitly saved admin tariff takes precedence over the bundled import.
  // The bundled file is only a fallback for stations without a cloud tariff.
  // Only saved time blocks count as a complete tariff.
  // Legacy price_per_kwh values are hidden in admin and must be upgraded
  // from the published time-block dataset whenever a matching station exists.
  const hasSavedTariff =
    Array.isArray(row.price_blocks) && row.price_blocks.length > 0;
  if (hasSavedTariff || row.status !== "operational") return row;
  const tariffs = (tariffDataset as unknown as { tariffs: TariffOverride[] }).tariffs;
  const country = normalizeTariffMatch(row.country ?? "");
  const name = normalizeTariffMatch([row.name, row.city, row.province].filter(Boolean).join(" "));
  const match = tariffs.find((tariff) => {
    const countries = [tariff.country, ...(tariff.countryAliases ?? [])];
    if (!countries.some((value) => normalizeTariffMatch(value) === country)) return false;
    return tariff.match.some((term) => {
      const normalizedTerm = normalizeTariffMatch(term);
      return name === normalizedTerm || name.includes(normalizedTerm);
    });
  });
  if (!match) return row;
  return {
    ...row,
    price_currency: match.currency ?? 'EUR',
    price_per_kwh: match.pricePerKwh ?? null,
    price_per_kwh_peak: null,
    peak_hours: null,
    price_blocks: match.priceBlocks?.length ? match.priceBlocks : null,
  };
}

/**
 * Local-first: de meegeleverde dataset (src/data/superchargers.json) is de basis.
 * Lukt het ophalen van de cloud-overlay niet, dan blijft de app gewoon werken met
 * de lokale data — een mislukte update verwijdert dus nooit Superchargers.
 */
export const listSuperchargers = createServerFn({ method: "GET" }).handler(
  async (): Promise<Supercharger[]> => {
    const { localChargerDataset } = await import("./local-chargers.server");
    const localRows = localChargerDataset.chargers as unknown as Row[];
    const owners = new Map<string, OwnerRow>();
    for (const o of localChargerDataset.owners ?? []) owners.set(o.id, o);

    // Haal de actuele clouddata volledig op. Een korte timeout kan in Preview
    // onterecht oude ingebouwde data tonen terwijl de database wel bereikbaar is.
    const cloud = async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const pageSize = 1000;
      const rows: Row[] = [];
      for (let from = 0; ; from += pageSize) {
        let result = await supabaseAdmin.from("superchargers").select(SELECT_COLS).order("name").range(from, from + pageSize - 1);
        let parkingBlocksMissing = false;
        if (result.error && /parking_blocks|column .* does not exist|schema cache/i.test(result.error.message)) {
          parkingBlocksMissing = true;
          result = await supabaseAdmin.from("superchargers").select(SELECT_COLS_WITHOUT_PARKING_BLOCKS).order("name").range(from, from + pageSize - 1);
        }
        if (result.error && /price_currency|column .* does not exist|schema cache/i.test(result.error.message)) {
          console.warn("[TeslaNavigation] Optionele parkeer-/valutakolom ontbreekt; compatibele dataset wordt geladen.", result.error.message);
          result = await supabaseAdmin.from("superchargers").select(parkingBlocksMissing ? SELECT_COLS_WITHOUT_BOTH : SELECT_COLS_WITHOUT_CURRENCY).order("name").range(from, from + pageSize - 1);
        }
        if (result.error) throw new Error(result.error.message);
        const pageRows = ((result.data as unknown as Row[]) ?? []).map((row) => ({
          ...row,
          price_currency: row.price_currency ?? "EUR",
        }));
        rows.push(...pageRows);
        if (!result.data || result.data.length < pageSize) break;
      }
      if (rows.length === 0 || rows.length < localRows.length * 0.5) {
        throw new Error("cloud dataset incomplete");
      }
      const { data: ownerRows } = await supabaseAdmin
        .from("charger_owners")
        .select("id,name,logo_url,description,website,contact,notes");
      return { rows, ownerRows: (ownerRows ?? []) as (OwnerRow & { id: string })[] };
    };

    try {
      const result = await cloud();
      for (const o of result.ownerRows) owners.set(o.id, o);
      // De cloud blijft leidend voor actuele admin-gegevens.
      // Voor tarieven is de GitHub-dataset leidend zodra daarin een tarief staat:
      // zo worden oude cloudtarieven vervangen door de nieuwste Find Us-tarieven.
      const localById = new Map(localRows.map((row) => [row.id, row]));
      return result.rows.map((row) => {
        const local = localById.get(row.id);
        const merged: Row = !local ? row : (() => {
          const cloudHasTariff =
            (Array.isArray(row.price_blocks) && row.price_blocks.length > 0) ||
            typeof row.price_per_kwh === "number";
          const localHasTariff =
            (Array.isArray(local.price_blocks) && local.price_blocks.length > 0) ||
            typeof local.price_per_kwh === "number";
          const useLocalTariff = !cloudHasTariff && localHasTariff;
          return {
            ...row,
            // Cloud admin-data may contain an empty photos array while the bundled
            // dataset still has the original location photos. Never erase those photos.
            photos: Array.isArray(row.photos) && row.photos.length > 0
              ? row.photos
              : (Array.isArray(local.photos) ? local.photos : []),
            price_per_kwh: useLocalTariff ? local.price_per_kwh ?? null : row.price_per_kwh ?? null,
            price_per_kwh_peak: useLocalTariff ? local.price_per_kwh_peak ?? null : row.price_per_kwh_peak ?? null,
            peak_hours: useLocalTariff ? local.peak_hours ?? null : row.peak_hours ?? null,
            price_blocks: useLocalTariff
              ? (Array.isArray(local.price_blocks) ? (local.price_blocks as PriceBlock[]) : null)
              : (Array.isArray(row.price_blocks) && row.price_blocks.length > 0
                  ? row.price_blocks
                  : Array.isArray(local.price_blocks)
                    ? (local.price_blocks as PriceBlock[])
                    : null),
          };
        })();
        return rowToCharger(applyTariffOverride(merged), owners);
      });
    } catch (error) {
      // De kaart blijft bruikbaar als Supabase tijdelijk onbereikbaar is.
      // De lokale dataset bevat de volledige meegeleverde Superchargerbasis.
      console.error("[TeslaNavigation] Supabase-data ophalen mislukt; toon lokale Superchargerdataset:", error);
      if (!localRows.length) {
        throw new Error("Supabase is niet bereikbaar en de lokale Superchargerdataset is leeg.");
      }
      return localRows.map((row) => rowToCharger(applyTariffOverride(row), owners));
    }
  }
);

/** Importeert een eerder geëxporteerde back-up. Voegt toe en werkt bij, verwijdert nooit. */
export const importSuperchargers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ chargers: z.array(z.record(z.unknown())).min(1).max(20000) }).parse(input)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const allowed = new Set(SELECT_COLS.split(","));
    const rows = data.chargers
      .map((raw) => {
        const row: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(raw)) {
          if (allowed.has(key) && value !== undefined) row[key] = value;
        }
        return row;
      })
      .filter((row) => typeof row.name === "string" && typeof row.lat === "number" && typeof row.lng === "number");

    let imported = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await supabaseAdmin
        .from("superchargers")
        .upsert(batch as never, { onConflict: "id" });
      if (error) throw new Error(error.message);
      imported += batch.length;
    }
    return { imported };
  });


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
  parkingFeeAmount: z.number().min(0).max(1000).nullable().optional(),
  parkingFreeMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  parkingPerMinutes: z.number().int().min(1).max(1440).nullable().optional(),
  parkingPerEuro: z.number().min(0).max(1000).nullable().optional(),
  parkingBlocks: z.array(z.object({ label: z.string().max(80).optional(), afterMinutes: z.number().int().min(0).max(100000), durationMinutes: z.number().int().min(0).max(100000), amount: z.number().min(0).max(100000), currency: z.string().regex(/^[A-Z]{3}$/), repeat: z.boolean().optional() })).max(20).nullable().optional(),
  pricePerKwh: z.number().min(0).max(10).nullable().optional(),
  pricePerKwhPeak: z.number().min(0).max(10).nullable().optional(),
  peakHours: z.string().max(120).nullable().optional(),
  priceBlocks: z.array(z.object({
    days: z.string().max(40).optional(),
    from: z.string().max(5).optional(),
    to: z.string().max(5).optional(),
    pricePerKwh: z.number().min(0).max(10),
  })).max(12).nullable().optional(),
  inParkingGarage: z.boolean().default(false),
  province: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  status: z.enum(["operational", "construction", "works", "works_closed", "temp_closed", "long_closed", "voting", "plan", "permit", "expanding", "permanent_closed", "unknown"]).default("operational"),
  stallStates: z.array(z.object({ stall: z.number().int().min(1).max(500), condition: z.enum(["available", "defect", "blocked", "maintenance", "other"]), note: z.string().max(300).optional(), until: z.string().max(40).nullable().optional() })).max(500).optional(),
  dataSource: z.enum(["manual", "automatic"]).optional(),
  hidden: z.boolean().optional(),
  photos: z.array(z.string().url().max(1000)).max(20).optional(),
  voting: z.object({ votes: z.number().int().min(0).optional(), rank: z.number().int().min(0).optional(), url: z.string().max(500).optional() }).optional(),
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
  ownerId: z.string().uuid().nullable().optional(),
  lowSpeed: z.boolean().default(false),
  published: z.boolean().default(true),
  notes: z.string().max(1000).nullable().optional(),
  reopenAt: z.string().nullable().optional(),
  plannedUpgrade: z.object({
    label: z.string().max(120).optional(),
    fromConfigs: z.array(z.object({ count: z.number().int().min(1).max(500), version: z.string().min(1).max(10), speedKw: z.number().int().min(1).max(1000) })).optional(),
    toConfigs: z.array(z.object({ count: z.number().int().min(1).max(500), version: z.string().min(1).max(10), speedKw: z.number().int().min(1).max(1000) })).optional(),
    expected: z.string().max(60).optional(),
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
      parking_fee_amount: data.parkingFeeAmount ?? null,
      parking_free_minutes: data.parkingFreeMinutes ?? null,
      parking_per_minutes: data.parkingPerMinutes ?? null,
      parking_per_euro: data.parkingPerEuro ?? null,
      parking_blocks: data.parkingBlocks ?? null,
      price_per_kwh: data.pricePerKwh ?? null,
      price_per_kwh_peak: data.pricePerKwhPeak ?? null,
      peak_hours: data.peakHours ?? null,
      price_blocks: data.priceBlocks ?? null,
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
      ...(data.stallStates ? { stall_states: data.stallStates as unknown as Json } : {}),
      ...(data.dataSource ? { data_source: data.dataSource } : {}),
      ...(data.hidden !== undefined ? { hidden: data.hidden } : {}),
      ...(data.photos ? { photos: data.photos } : {}),
      ...(data.voting ? { voting: data.voting as Json } : {}),

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
