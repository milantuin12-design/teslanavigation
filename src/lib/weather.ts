import type { RouteWeather } from './energy';
import { sampleRoutePoints } from './tesla-utils';

const cache = new Map<string, RouteWeather | null>();

function keyFor(points: [number, number][]): string {
  const hour = new Date().toISOString().slice(0, 13);
  return `${hour}|${points.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(';')}`;
}

/**
 * Actueel weer langs de route (Open-Meteo, geen sleutel nodig).
 * Faalt de API of duurt hij te lang, dan geeft dit `null` terug en blijft de
 * app gewoon werken met de lokale zomer/winter/mist-instelling.
 */
export async function fetchRouteWeather(coords: [number, number][]): Promise<RouteWeather | null> {
  if (coords.length < 2) return null;
  const points = sampleRoutePoints(coords, 6);
  const key = keyFor(points);
  if (cache.has(key)) return cache.get(key) ?? null;

  try {
    const lat = points.map((p) => p[1].toFixed(3)).join(',');
    const lng = points.map((p) => p[0].toFixed(3)).join(',');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
        `&current=temperature_2m,wind_speed_10m,precipitation,snowfall,visibility,weather_code&wind_speed_unit=ms`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);
    if (!res.ok) {
      cache.set(key, null);
      return null;
    }
    const json = await res.json();
    const entries = Array.isArray(json) ? json : [json];
    const currents = entries
      .map((e: { current?: Record<string, number> }) => e?.current)
      .filter((c): c is Record<string, number> => !!c);
    if (currents.length === 0) {
      cache.set(key, null);
      return null;
    }
    const avg = (pick: (c: Record<string, number>) => number) =>
      currents.reduce((sum, c) => sum + (Number(pick(c)) || 0), 0) / currents.length;

    const fogCodes = new Set([45, 48]);
    const fogFraction =
      currents.filter((c) => fogCodes.has(Number(c.weather_code)) || Number(c.visibility ?? 20000) < 1000).length /
      currents.length;

    const weather: RouteWeather = {
      tempC: Math.round(avg((c) => c.temperature_2m) * 10) / 10,
      windMs: Math.round(avg((c) => c.wind_speed_10m) * 10) / 10,
      precipitationMm: Math.round(avg((c) => c.precipitation) * 100) / 100,
      snowfallCm: Math.round(avg((c) => c.snowfall) * 100) / 100,
      fogFraction: Math.round(fogFraction * 100) / 100,
    };
    cache.set(key, weather);
    return weather;
  } catch {
    cache.set(key, null);
    return null;
  }
}
