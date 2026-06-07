import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Supercharger } from "./tesla-types";

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

    return rows.map((row) => {
      const normalized = normalizeStallData(row.total_stalls, row.stall_types);
      return {
        name: row.name as string,
        lat: row.lat as number,
        lng: row.lng as number,
        totalStalls: normalized.totalStalls,
        occupiedStalls: row.occupied_stalls ?? undefined,
        stallTypes: normalized.stallTypes,
        country: row.country ?? undefined,
      };
    });
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
    return {
      updated: 0,
      failed: 0,
      noGoogleData: 0,
      total: 0,
      timestamp: new Date().toISOString(),
      googleMaps: false,
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
  if (bestPlace?.evChargeOptions) {
    const evOpts = bestPlace.evChargeOptions;
    const connectorCount = evOpts.connectorCount;
    let availableCount = 0;
    let outOfServiceCount = 0;

    for (const agg of evOpts.connectorAggregation || []) {
      if (agg.availableCount !== undefined) availableCount += agg.availableCount;
      if (agg.outOfServiceCount !== undefined) outOfServiceCount += agg.outOfServiceCount;
    }

    if (
      availableCount > 0 ||
      outOfServiceCount > 0 ||
      evOpts.connectorAggregation?.some((a) => a.availableCount !== undefined)
    ) {
      occupiedStalls = connectorCount - availableCount - outOfServiceCount;
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
