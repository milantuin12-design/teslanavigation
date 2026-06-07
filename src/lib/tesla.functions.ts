import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Supercharger } from "./tesla-types";

export const listSuperchargers = createServerFn({ method: "GET" }).handler(
  async (): Promise<Supercharger[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pageSize = 1000;
    const rows: Array<{
      name: string;
      lat: number;
      lng: number;
      total_stalls: number | null;
      stall_types: string | null;
      occupied_stalls: number | null;
      country: string | null;
    }> = [];

    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabaseAdmin
        .from("superchargers")
        .select("name,lat,lng,total_stalls,stall_types,occupied_stalls,country")
        .order("name")
        .range(from, from + pageSize - 1);

      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
      if (!data || data.length < pageSize) break;
    }

    return rows.map((row) => ({
      name: row.name as string,
      lat: row.lat as number,
      lng: row.lng as number,
      totalStalls: row.total_stalls ?? undefined,
      occupiedStalls: row.occupied_stalls ?? undefined,
      stallTypes: row.stall_types ?? undefined,
      country: row.country ?? undefined,
    }));
  }
);

interface ConnectorAggregation {
  type: string;
  maxChargeRateKw: number;
  count: number;
  availableCount?: number;
  outOfServiceCount?: number;
}

interface EVChargeOptions {
  connectorCount: number;
  connectorAggregation: ConnectorAggregation[];
}

export const refreshAvailability = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({}).optional().parse(input ?? {}))
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const lovableApiKey = process.env.LOVABLE_API_KEY;
    const googleConnKey = process.env.GOOGLE_MAPS_API_KEY;
    const useGateway = !!(lovableApiKey && googleConnKey);

    const { data: chargers, error } = await supabaseAdmin
      .from("superchargers")
      .select("id,name,lat,lng,total_stalls,occupied_stalls,stall_types")
      .order("name")
      .limit(1000);

    if (error) throw new Error(error.message);

    let updated = 0;
    let failed = 0;
    let noGoogleData = 0;

    if (useGateway && chargers) {
      const batchSize = 3;
      const delayMs = 350;

      for (let i = 0; i < chargers.length; i += batchSize) {
        const batch = chargers.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(async (charger, idx) => {
            await new Promise((r) => setTimeout(r, idx * 100));
            return lookupEVAvailability(charger, lovableApiKey!, googleConnKey!);
          })
        );

        for (let j = 0; j < results.length; j++) {
          const r = results[j];
          if (r.status === "fulfilled" && r.value.success) {
            updated++;
          } else if (r.status === "fulfilled" && r.value.reason === "no_google_data") {
            noGoogleData++;
          } else {
            failed++;
          }
        }

        if (i + batchSize < chargers.length) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    } else if (chargers) {
      for (const charger of chargers) {
        const { error: upErr } = await supabaseAdmin
          .from("superchargers")
          .update({ last_updated: new Date().toISOString() })
          .eq("id", charger.id);
        if (upErr) failed++;
        else updated++;
      }
    }

    return {
      updated,
      failed,
      noGoogleData,
      total: chargers?.length ?? 0,
      timestamp: new Date().toISOString(),
      googleMaps: useGateway,
    };
  });

const GATEWAY_BASE = "https://connector-gateway.lovable.dev/google_maps";

async function lookupEVAvailability(
  charger: { id: string; name: string; lat: number; lng: number; stall_types: string | null },
  lovableApiKey: string,
  googleConnKey: string
): Promise<{ success: boolean; reason?: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const gwHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${lovableApiKey}`,
    "X-Connection-Api-Key": googleConnKey,
    "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.evChargeOptions",
  } as const;

  const searchQuery = `Tesla Supercharger ${charger.name}`;
  const textSearchRes = await fetch(`${GATEWAY_BASE}/places/v1/places:searchText`, {
    method: "POST",
    headers: gwHeaders,
    body: JSON.stringify({
      textQuery: searchQuery,
      maxResultCount: 3,
      locationBias: {
        circle: {
          center: { latitude: charger.lat, longitude: charger.lng },
          radius: 10000.0,
        },
      },
    }),
  });

  type Place = {
    id: string;
    displayName?: { text: string };
    evChargeOptions?: EVChargeOptions;
    location?: { latitude: number; longitude: number };
  };
  let bestPlace: Place | null = null;

  if (textSearchRes.ok) {
    const textSearchData = await textSearchRes.json();
    const places: Place[] = textSearchData.places || [];
    for (const place of places) {
      const name = (place.displayName?.text || "").toLowerCase();
      const isTesla = name.includes("tesla") || name.includes("supercharger");
      const isMatch = name.includes(charger.name.toLowerCase().split(",")[0].split(" ")[0].toLowerCase());
      if (place.location) {
        const dist = Math.sqrt(
          Math.pow(place.location.latitude - charger.lat, 2) +
            Math.pow(place.location.longitude - charger.lng, 2)
        );
        if (dist < 0.1 && (isTesla || isMatch)) {
          bestPlace = place;
          break;
        }
      }
    }
  }

  if (!bestPlace) {
    const nearRes = await fetch(`${GATEWAY_BASE}/places/v1/places:searchNearby`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableApiKey}`,
        "X-Connection-Api-Key": googleConnKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.evChargeOptions",
      },
      body: JSON.stringify({
        includedTypes: ["ev_charger"],
        maxResultCount: 5,
        locationRestriction: {
          circle: {
            center: { latitude: charger.lat, longitude: charger.lng },
            radius: 1000.0,
          },
        },
      }),
    });

    if (nearRes.ok) {
      const nearData = await nearRes.json();
      const places: Place[] = nearData.places || [];
      for (const place of places) {
        const name = (place.displayName?.text || "").toLowerCase();
        if (name.includes("tesla") || name.includes("supercharger")) {
          bestPlace = place;
          break;
        }
      }
      if (!bestPlace && places.length > 0) bestPlace = places[0];
    }
  }

  let occupiedStalls: number | null = null;
  let totalStalls: number | null = null;
  let stallTypes: string | null = charger.stall_types;

  if (bestPlace?.evChargeOptions) {
    const evOpts = bestPlace.evChargeOptions;
    totalStalls = evOpts.connectorCount;
    let availableCount = 0;
    let outOfServiceCount = 0;
    const speedParts: string[] = [];

    for (const agg of evOpts.connectorAggregation || []) {
      const speed = agg.maxChargeRateKw ? `${agg.count}x${Math.round(agg.maxChargeRateKw)}kW` : `${agg.count}x`;
      speedParts.push(speed);
      if (agg.availableCount !== undefined) availableCount += agg.availableCount;
      if (agg.outOfServiceCount !== undefined) outOfServiceCount += agg.outOfServiceCount;
    }

    if (speedParts.length > 0) stallTypes = speedParts.join(", ");

    if (
      availableCount > 0 ||
      outOfServiceCount > 0 ||
      evOpts.connectorAggregation?.some((a) => a.availableCount !== undefined)
    ) {
      occupiedStalls = totalStalls - availableCount - outOfServiceCount;
      if (occupiedStalls < 0) occupiedStalls = 0;
    } else {
      occupiedStalls = null;
    }
  }

  const updateBody: {
    last_updated: string;
    occupied_stalls?: number;
  } = { last_updated: new Date().toISOString() };
  if (occupiedStalls !== null) updateBody.occupied_stalls = occupiedStalls;

  const { error: upErr } = await supabaseAdmin
    .from("superchargers")
    .update(updateBody)
    .eq("id", charger.id);

  if (upErr) return { success: false, reason: "db_update_failed" };
  return { success: occupiedStalls !== null, reason: occupiedStalls === null ? "no_google_data" : undefined };
}
