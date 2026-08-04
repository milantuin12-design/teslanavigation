import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const pointSchema = z.object({ lat: z.number(), lng: z.number() });

const input = z.object({
  origin: pointSchema,
  destination: pointSchema,
  waypoints: z.array(pointSchema).max(20).default([]),
  avoidHighways: z.boolean().default(false),
  alternatives: z.boolean().default(true),
});

function decodePolyline(encoded: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push([lng / 1e5, lat / 1e5]);
  }
  return coords;
}

export type TrafficRoute = {
  coordinates: [number, number][];
  totalDistanceKm: number;
  totalTimeMin: number;
  /** Vertraging in minuten door verkeer t.o.v. vrije doorstroming. */
  delayMin: number;
};

/**
 * Live routes met files en wegwerkzaamheden. Geeft null terug als er geen
 * verkeersbron beschikbaar is, zodat de client op de offline berekening terugvalt.
 */
export const fetchTrafficRoutes = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => input.parse(raw))
  .handler(async ({ data }): Promise<TrafficRoute[] | null> => {
    const key = process.env["GOOGLE_MAPS_API_KEY"];
    if (!key) return null;

    const body = {
      origin: { location: { latLng: { latitude: data.origin.lat, longitude: data.origin.lng } } },
      destination: { location: { latLng: { latitude: data.destination.lat, longitude: data.destination.lng } } },
      intermediates: data.waypoints.map((w) => ({
        location: { latLng: { latitude: w.lat, longitude: w.lng } },
      })),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE_OPTIMAL",
      computeAlternativeRoutes: data.alternatives && data.waypoints.length === 0,
      routeModifiers: { avoidHighways: data.avoidHighways, avoidTolls: false, avoidFerries: false },
      languageCode: "nl-NL",
      units: "METRIC",
    };

    try {
      const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask":
            "routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        routes?: {
          duration?: string;
          staticDuration?: string;
          distanceMeters?: number;
          polyline?: { encodedPolyline?: string };
        }[];
      };
      const routes = json.routes ?? [];
      if (routes.length === 0) return null;

      return routes
        .map((r) => {
          const secs = Number((r.duration ?? "0s").replace("s", "")) || 0;
          const staticSecs = Number((r.staticDuration ?? r.duration ?? "0s").replace("s", "")) || secs;
          const encoded = r.polyline?.encodedPolyline;
          if (!encoded) return null;
          return {
            coordinates: decodePolyline(encoded),
            totalDistanceKm: Math.round(((r.distanceMeters ?? 0) / 1000) * 10) / 10,
            totalTimeMin: Math.round(secs / 60),
            delayMin: Math.max(0, Math.round((secs - staticSecs) / 60)),
          } satisfies TrafficRoute;
        })
        .filter((r): r is TrafficRoute => r !== null);
    } catch {
      return null;
    }
  });
