import { createServerFn } from "@tanstack/react-start";
import { decodeTrafficPolyline, trafficInput } from "./traffic.server";

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
  .inputValidator((raw: unknown) => trafficInput.parse(raw))
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
            coordinates: decodeTrafficPolyline(encoded),
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
