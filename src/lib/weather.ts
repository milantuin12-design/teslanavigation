import type { RouteWeather } from './energy';
import { sampleRoutePoints } from './tesla-utils';

const cache = new Map<string, RouteWeather | null>();

function keyFor(points: [number, number][], date?: string): string {
  const hour = new Date().toISOString().slice(0, 13);
  return `${hour}|${date ?? ''}|${points.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(';')}`;
}

/**
 * Actueel weer langs de route (Open-Meteo, geen sleutel nodig).
 * Faalt de API of duurt hij te lang, dan geeft dit `null` terug en blijft de
 * app gewoon werken met de lokale zomer/winter/mist-instelling.
 */
export async function fetchRouteWeather(coords: [number, number][], date?: string): Promise<RouteWeather | null> {
  if (coords.length < 2) return null;
  const points = sampleRoutePoints(coords, 6);
  const today = new Date().toISOString().slice(0, 10);
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date !== today) return fetchDayWeather(points, date);
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

/** Weersverwachting voor een reisdag (max ~16 dagen vooruit), gemiddeld over de route. */
async function fetchDayWeather(points: [number, number][], date: string): Promise<RouteWeather | null> {
  const key = keyFor(points, date);
  if (cache.has(key)) return cache.get(key) ?? null;
  try {
    const lat = points.map((p) => p[1].toFixed(3)).join(',');
    const lng = points.map((p) => p[0].toFixed(3)).join(',');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
        `&daily=temperature_2m_mean,wind_speed_10m_max,precipitation_sum,snowfall_sum,weather_code&wind_speed_unit=ms&start_date=${date}&end_date=${date}&timezone=auto`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);
    if (!res.ok) { cache.set(key, null); return null; }
    const json = await res.json();
    const entries = (Array.isArray(json) ? json : [json]) as { daily?: Record<string, number[]> }[];
    const days = entries.map((e) => e?.daily).filter((d): d is Record<string, number[]> => !!d && Array.isArray(d.temperature_2m_mean));
    if (days.length === 0) { cache.set(key, null); return null; }
    const avg = (k: string) => days.reduce((s, d) => s + (Number(d[k]?.[0]) || 0), 0) / days.length;
    const fog = days.filter((d) => [45, 48].includes(Number(d.weather_code?.[0]))).length / days.length;
    const weather: RouteWeather = {
      tempC: Math.round(avg('temperature_2m_mean') * 10) / 10,
      windMs: Math.round(avg('wind_speed_10m_max') * 0.6 * 10) / 10,
      precipitationMm: Math.round((avg('precipitation_sum') / 24) * 100) / 100,
      snowfallCm: Math.round((avg('snowfall_sum') / 24) * 100) / 100,
      fogFraction: Math.round(fog * 100) / 100,
    };
    cache.set(key, weather);
    return weather;
  } catch {
    cache.set(key, null);
    return null;
  }
}
