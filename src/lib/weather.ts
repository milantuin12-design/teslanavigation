import type { RouteWeather } from './energy';
import { sampleRoutePoints } from './tesla-utils';

const cache = new Map<string, RouteWeather | null>();

function routeDistances(points: [number, number][]): number[] {
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    const [lon1, lat1] = points[i - 1]; const [lon2, lat2] = points[i];
    const rad = Math.PI / 180;
    const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lon2 - lon1) * rad / 2) ** 2;
    distances.push(distances[i - 1] + 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }
  return distances;
}
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
      temperatureSegments: currents.map((c, i) => ({ km: routeDistances(points)[i] ?? 0, tempC: Math.round(Number(c.temperature_2m) * 10) / 10 })).filter((p) => Number.isFinite(p.tempC)),
      weatherSegments: currents.map((c, i) => ({ km: routeDistances(points)[i] ?? 0, tempC: Number(c.temperature_2m) || 0, windMs: Number(c.wind_speed_10m) || 0, precipitationMm: Number(c.precipitation) || 0, snowfallCm: Number(c.snowfall) || 0 })),
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
/** Weersverwachting voor een reisdag; bij ontbrekende forecast volgt historisch gemiddelde. */
async function fetchDayWeather(points: [number, number][], date: string): Promise<RouteWeather | null> {
  const key = keyFor(points, date);
  if (cache.has(key)) return cache.get(key) ?? null;
  try {
    const lat = points.map((p) => p[1].toFixed(3)).join(',');
    const lng = points.map((p) => p[0].toFixed(3)).join(',');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    let res: Response;
    try {
      res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
          `&daily=temperature_2m_mean,wind_speed_10m_max,precipitation_sum,snowfall_sum,weather_code&wind_speed_unit=ms&start_date=${date}&end_date=${date}&timezone=auto`,
        { signal: controller.signal },
      );
    } finally {
      clearTimeout(timeout);
    }
    if (res.ok) {
      const json = await res.json();
      const entries = (Array.isArray(json) ? json : [json]) as { daily?: Record<string, number[]> }[];
      const days = entries.map((e) => e?.daily).filter((d): d is Record<string, number[]> => !!d && Array.isArray(d.temperature_2m_mean) && d.temperature_2m_mean.length > 0);
      if (days.length > 0) {
        const avg = (k: string) => days.reduce((s, d) => s + (Number(d[k]?.[0]) || 0), 0) / days.length;
        const fog = days.filter((d) => [45, 48].includes(Number(d.weather_code?.[0]))).length / days.length;
        const weather: RouteWeather = {
          tempC: Math.round(avg('temperature_2m_mean') * 10) / 10,
          temperatureSegments: days.map((d, i) => ({ km: routeDistances(points)[i] ?? 0, tempC: Math.round(Number(d.temperature_2m_mean?.[0]) * 10) / 10 })).filter((p) => Number.isFinite(p.tempC)),
          windMs: Math.round(avg('wind_speed_10m_max') * 0.6 * 10) / 10,
          precipitationMm: Math.round((avg('precipitation_sum') / 24) * 100) / 100,
          snowfallCm: Math.round((avg('snowfall_sum') / 24) * 100) / 100,
          fogFraction: Math.round(fog * 100) / 100,
        };
        cache.set(key, weather);
        return weather;
      }
    }
  } catch {
    // Forecast buiten het bereik of tijdelijk niet beschikbaar: gebruik klimaatgemiddelden.
  }

  const historical = await fetchHistoricalAverage(points, date);
  cache.set(key, historical);
  return historical;
}

/** Gemiddeld weer op dezelfde kalenderdag in de vijf voorgaande jaren. */
async function fetchHistoricalAverage(points: [number, number][], date: string): Promise<RouteWeather | null> {
  const [yearText, month, day] = date.split('-');
  const year = Number(yearText);
  const startYear = year - 5;
  const endYear = year - 1;
  const startDate = `${startYear}-${month}-${day}`;
  const endDate = `${endYear}-${month}-${day}`;
  try {
    const lat = points.map((p) => p[1].toFixed(3)).join(',');
    const lng = points.map((p) => p[0].toFixed(3)).join(',');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let res: Response;
    try {
      res = await fetch(
        `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}` +
          `&daily=temperature_2m_mean,wind_speed_10m_max,precipitation_sum,snowfall_sum&wind_speed_unit=ms&start_date=${startDate}&end_date=${endDate}&timezone=auto`,
        { signal: controller.signal },
      );
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) return null;
    const json = await res.json();
    const entries = (Array.isArray(json) ? json : [json]) as { daily?: { time?: string[]; temperature_2m_mean?: number[]; wind_speed_10m_max?: number[]; precipitation_sum?: number[]; snowfall_sum?: number[] } }[];
    const targetMonthDay = `${month}-${day}`;
    const samples = entries.map((entry) => {
      const daily = entry.daily;
      if (!daily?.time || !daily.temperature_2m_mean) return null;
      const indices = daily.time.map((value, index) => value.slice(5) === targetMonthDay ? index : -1).filter((index) => index >= 0);
      if (!indices.length) return null;
      const mean = (values?: number[]) => indices.reduce((sum, index) => sum + (Number(values?.[index]) || 0), 0) / indices.length;
      return {
        temp: mean(daily.temperature_2m_mean),
        wind: mean(daily.wind_speed_10m_max) * 0.6,
        rain: mean(daily.precipitation_sum) / 24,
        snow: mean(daily.snowfall_sum) / 24,
      };
    }).filter((value): value is { temp: number; wind: number; rain: number; snow: number } => value !== null);
    if (!samples.length) return null;
    const avg = (pick: (sample: typeof samples[number]) => number) => samples.reduce((sum, sample) => sum + pick(sample), 0) / samples.length;
    const weather: RouteWeather = {
      tempC: Math.round(avg((s) => s.temp) * 10) / 10,
      temperatureSegments: samples.map((s, i) => ({ km: routeDistances(points)[i] ?? 0, tempC: Math.round(s.temp * 10) / 10 })),
      weatherSegments: samples.map((s, i) => ({ km: routeDistances(points)[i] ?? 0, tempC: s.temp, windMs: s.wind, precipitationMm: s.rain, snowfallCm: s.snow })),
      windMs: Math.round(avg((s) => s.wind) * 10) / 10,
      precipitationMm: Math.round(avg((s) => s.rain) * 100) / 100,
      snowfallCm: Math.round(avg((s) => s.snow) * 100) / 100,
      // Historical archive does not provide reliable daily fog for this fallback.
      fogFraction: 0,
    };
    return weather;
  } catch {
    return null;
  }
}
