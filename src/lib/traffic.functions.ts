import { createServerFn } from "@tanstack/react-start";
import { decodeTrafficPolyline, trafficInput } from "./traffic.server";

export type TrafficSegment = {
  /** Index in de polyline waar het trage stuk begint. */
  startIndex: number;
  /** Index in de polyline waar het trage stuk eindigt. */
  endIndex: number;
  severity: "slow" | "jam";
};

export type TrafficRoute = {
  coordinates: [number, number][];
  totalDistanceKm: number;
  totalTimeMin: number;
  /** Vertraging in minuten door verkeer t.o.v. vrije doorstroming. */
  delayMin: number;
  /** Stukken van de route met file of traag verkeer. */
  slowSegments: TrafficSegment[];
};

function trafficApiKey(): string | undefined {
  return (
    process.env["GOOGLE_MAPS_API_KEY"] ||
    (import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY"] as string | undefined) ||
    undefined
  );
}

/**
 * Live routes met files en wegwerkzaamheden. Geeft null terug als er geen
 * verkeersbron beschikbaar is, zodat de client op de offline berekening terugvalt.
 */
export const fetchTrafficRoutes = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => trafficInput.parse(raw))
  .handler(async ({ data }): Promise<TrafficRoute[] | null> => {
    const key = trafficApiKey();
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
            "routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.travelAdvisory.speedReadingIntervals",
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
          travelAdvisory?: {
            speedReadingIntervals?: {
              startPolylinePointIndex?: number;
              endPolylinePointIndex?: number;
              speed?: "NORMAL" | "SLOW" | "TRAFFIC_JAM";
            }[];
          };
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
          const coordinates = decodeTrafficPolyline(encoded);
          const slowSegments: TrafficSegment[] = (r.travelAdvisory?.speedReadingIntervals ?? [])
            .filter((i) => i.speed === "SLOW" || i.speed === "TRAFFIC_JAM")
            .map((i) => ({
              startIndex: Math.max(0, i.startPolylinePointIndex ?? 0),
              endIndex: Math.min(coordinates.length - 1, i.endPolylinePointIndex ?? coordinates.length - 1),
              severity: (i.speed === "TRAFFIC_JAM" ? "jam" : "slow") as "slow" | "jam",
            }))
            .filter((s) => s.endIndex > s.startIndex);
          return {
            coordinates,
            totalDistanceKm: Math.round(((r.distanceMeters ?? 0) / 1000) * 10) / 10,
            totalTimeMin: Math.round(secs / 60),
            delayMin: Math.max(0, Math.round((secs - staticSecs) / 60)),
            slowSegments,
          } satisfies TrafficRoute;
        })
        .filter((r): r is TrafficRoute => r !== null);
    } catch {
      return null;
    }
  });
