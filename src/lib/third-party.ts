import type { Supercharger } from "./tesla-types";

const cache = new Map<string, Supercharger>();

/**
 * Zoekt de echte naam/exploitant van een (niet-Tesla) laadpaal op die plek via OpenStreetMap.
 * Faalt dit, dan krijg je een nette fallback met het adres van de tussenstop — nooit een crash.
 */
export async function lookupThirdPartyCharger(lat: number, lng: number, label: string): Promise<Supercharger> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const fallback: Supercharger = {
    name: label ? label.split(",")[0] : "Laadpunt",
    city: label?.split(",")[1]?.trim(),
    lat,
    lng,
    maxSpeedKw: 50,
    status: "operational",
    ownerName: "Lader van derden",
  };
  try {
    const q = `[out:json][timeout:4];node(around:400,${lat},${lng})[amenity=charging_station];out 5;`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 4500);
    const res = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) return fallback;
    const data = await res.json();
    const nodes: { lat: number; lon: number; tags?: Record<string, string> }[] = data?.elements ?? [];
    if (nodes.length === 0) { cache.set(key, fallback); return fallback; }
    const n = nodes[0];
    const tags = n.tags ?? {};
    const kwMatch = Object.entries(tags).find(([k]) => /output$/.test(k))?.[1]?.match(/(\d+(?:\.\d+)?)\s*kW/i);
    const operator = tags.operator || tags.network || tags.brand;
    const charger: Supercharger = {
      name: tags.name || (operator ? `${operator} laadpunt` : fallback.name),
      city: tags["addr:city"] || fallback.city,
      lat: n.lat,
      lng: n.lon,
      maxSpeedKw: kwMatch ? Math.round(parseFloat(kwMatch[1])) : 50,
      totalStalls: tags.capacity ? parseInt(tags.capacity) || undefined : undefined,
      status: "operational",
      ownerName: operator ? `${operator} (lader van derden)` : "Lader van derden",
    };
    cache.set(key, charger);
    return charger;
  } catch {
    return fallback;
  }
}
