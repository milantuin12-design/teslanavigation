import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PlateLookupResult, VehicleModel } from "./vehicle-types";

type Row = {
  id: string;
  brand: string;
  model: string;
  trim: string | null;
  battery_kwh: number | null;
  usable_kwh: number | null;
  range_km: number | null;
  consumption_kwh100: number | null;
  year_from: number | null;
  year_to: number | null;
  max_charge_kw: number | null;
  connectors: string[] | null;
  image_url: string | null;
  notes: string | null;
  published: boolean | null;
};

const COLS =
  "id,brand,model,trim,battery_kwh,usable_kwh,range_km,consumption_kwh100,year_from,year_to,max_charge_kw,connectors,image_url,notes,published";

function toVehicle(row: Row): VehicleModel {
  return {
    id: row.id,
    brand: row.brand,
    model: row.model,
    trim: row.trim,
    batteryKWh: row.battery_kwh === null ? null : Number(row.battery_kwh),
    usableKWh: row.usable_kwh === null ? null : Number(row.usable_kwh),
    rangeKm: row.range_km,
    consumptionKWh100: row.consumption_kwh100 === null ? null : Number(row.consumption_kwh100),
    yearFrom: row.year_from,
    yearTo: row.year_to,
    maxChargeKw: row.max_charge_kw,
    connectors: Array.isArray(row.connectors) && row.connectors.length > 0 ? row.connectors : ["Type 2", "CCS"],
    imageUrl: row.image_url,
    notes: row.notes,
    published: row.published !== false,
  };
}

export const listVehicleModels = createServerFn({ method: "GET" }).handler(async (): Promise<VehicleModel[]> => {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("vehicle_models")
      .select(COLS)
      .order("brand")
      .order("model")
      .order("trim");
    if (error) throw new Error(error.message);
    return ((data as unknown as Row[]) ?? []).map(toVehicle);
  } catch {
    // Externe/cloud-storing mag de app nooit onbruikbaar maken.
    return [];
  }
});

const vehicleInput = z.object({
  id: z.string().uuid().optional(),
  brand: z.string().min(1).max(80),
  model: z.string().min(1).max(80),
  trim: z.string().max(80).nullable().optional(),
  batteryKWh: z.number().min(0).max(500).nullable().optional(),
  usableKWh: z.number().min(0).max(500).nullable().optional(),
  rangeKm: z.number().int().min(0).max(2000).nullable().optional(),
  consumptionKWh100: z.number().min(0).max(120).nullable().optional(),
  yearFrom: z.number().int().min(1990).max(2100).nullable().optional(),
  yearTo: z.number().int().min(1990).max(2100).nullable().optional(),
  maxChargeKw: z.number().int().min(0).max(1000).nullable().optional(),
  connectors: z.array(z.string().max(30)).default(["Type 2", "CCS"]),
  imageUrl: z.string().max(1000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  published: z.boolean().default(true),
});

async function assertAdmin(context: { supabase: unknown; userId: string }) {
  const sb = context.supabase as {
    rpc: (fn: "has_role", args: { _user_id: string; _role: "admin" | "user" }) => PromiseLike<{ data: boolean | null; error: { message: string } | null }>;
  };
  const { data, error } = await sb.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export const upsertVehicleModel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => vehicleInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const payload = {
      brand: data.brand,
      model: data.model,
      trim: data.trim || null,
      battery_kwh: data.batteryKWh ?? null,
      usable_kwh: data.usableKWh ?? null,
      range_km: data.rangeKm ?? null,
      consumption_kwh100: data.consumptionKWh100 ?? null,
      year_from: data.yearFrom ?? null,
      year_to: data.yearTo ?? null,
      max_charge_kw: data.maxChargeKw ?? null,
      connectors: data.connectors,
      image_url: data.imageUrl || null,
      notes: data.notes || null,
      published: data.published,
    };
    if (data.id) {
      const { error } = await context.supabase.from("vehicle_models").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: inserted, error } = await context.supabase.from("vehicle_models").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { id: (inserted as { id: string }).id };
  });

export const deleteVehicleModel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.from("vehicle_models").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Kentekencheck via de open RDW-dataset. Faalt dit, dan blijft handmatig kiezen mogelijk. */
export const lookupLicensePlate = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ plate: z.string().min(4).max(12) }).parse(input))
  .handler(async ({ data }): Promise<PlateLookupResult> => {
    const plate = data.plate.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const base: PlateLookupResult = { found: false, plate };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`https://opendata.rdw.nl/resource/m9d7-ebf2.json?kenteken=${plate}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return { ...base, message: "Kentekenregister niet bereikbaar. Kies je auto handmatig." };
      const rows = (await res.json()) as { merk?: string; handelsbenaming?: string; datum_eerste_toelating?: string }[];
      if (!Array.isArray(rows) || rows.length === 0) {
        return { ...base, message: "Kenteken niet gevonden. Kies je auto handmatig." };
      }
      const row = rows[0];
      const brand = (row.merk || "").trim();
      const tradeName = (row.handelsbenaming || "").trim();
      const year = row.datum_eerste_toelating ? Number(String(row.datum_eerste_toelating).slice(0, 4)) : undefined;

      let matchedVehicleId: string | null = null;
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: vehicles } = await supabaseAdmin.from("vehicle_models").select(COLS);
        const list = ((vehicles as unknown as Row[]) ?? []).map(toVehicle);
        const haystack = `${brand} ${tradeName}`.toUpperCase();
        let bestScore = 0;
        for (const v of list) {
          const words = `${v.brand} ${v.model} ${v.trim ?? ""}`.toUpperCase().split(/\s+/).filter(Boolean);
          const score = words.reduce((sum, w) => sum + (haystack.includes(w) ? w.length : 0), 0);
          if (score > bestScore) {
            bestScore = score;
            matchedVehicleId = v.id;
          }
        }
        if (bestScore < 5) matchedVehicleId = null;
      } catch {
        matchedVehicleId = null;
      }

      return {
        found: true,
        plate,
        brand,
        tradeName,
        year,
        matchedVehicleId,
        message: matchedVehicleId ? undefined : "Voertuig gevonden, maar geen model in de lijst. Kies handmatig.",
      };
    } catch {
      return { ...base, message: "Kentekencheck mislukt. Kies je auto handmatig." };
    }
  });
