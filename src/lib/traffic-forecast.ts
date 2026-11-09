import type { Supercharger, TrafficForecast, TrafficForecastSlot } from "./tesla-types";

export const TRAFFIC_DAYS = [
  { key: "mon", label: "Ma" }, { key: "tue", label: "Di" }, { key: "wed", label: "Wo" },
  { key: "thu", label: "Do" }, { key: "fri", label: "Vr" }, { key: "sat", label: "Za" }, { key: "sun", label: "Zo" },
] as const;

export const TRAFFIC_PERIODS = [
  { from: "00:00", to: "06:00", label: "00–06" },
  { from: "06:00", to: "10:00", label: "06–10" },
  { from: "10:00", to: "16:00", label: "10–16" },
  { from: "16:00", to: "20:00", label: "16–20" },
  { from: "20:00", to: "24:00", label: "20–24" },
] as const;

function zoneFor(charger: Pick<Supercharger, "name" | "city" | "province" | "lat" | "lng">): "transit" | "ski" | "urban" | "other" {
  const text = [charger.name, charger.city, charger.province].filter(Boolean).join(" ").toLowerCase();
  if (/tauern|spittal|villach|katschberg|st\. michael|eben im pongau|flachau|golling|werfen/.test(text) ||
      (charger.lat > 46.7 && charger.lat < 47.9 && charger.lng > 12.7 && charger.lng < 14.2)) return "transit";
  if (/brenner|innsbruck|inntal|wörgl|kufstein|imst|landeck|ötztal|tirol|fernpass|reutte/.test(text) ||
      (charger.lat > 46.7 && charger.lat < 47.8 && charger.lng > 10.0 && charger.lng < 12.7)) return "ski";
  if (/karawanken|klagenfurt|villach|arnoldstein|carinthia|kärnten/.test(text) ||
      (charger.lat > 46.3 && charger.lat < 47.0 && charger.lng > 13.2 && charger.lng < 14.8)) return "transit";
  if (/wien|vienna|graz|linz|salzburg|st\. pölten/.test(text) ||
      (charger.lat > 47.8 && charger.lat < 48.4 && charger.lng > 16.0 && charger.lng < 16.8)) return "urban";
  return "other";
}

function baseline(day: string, period: number, zone: ReturnType<typeof zoneFor>): number {
  const weekend = day === "sat" || day === "sun";
  const friday = day === "fri";
  const night = period === 0 || period === 4;
  if (night) return period === 0 ? 10 : 18;
  if (zone === "urban") {
    if (!weekend && (period === 1 || period === 3)) return period === 1 ? 72 : 78;
    if (weekend && period === 2) return 48;
    return period === 2 ? 42 : 28;
  }
  if (zone === "transit") {
    if (weekend && period === 2) return 78;
    if (weekend && period === 1) return 68;
    if (friday && period >= 1 && period <= 3) return 62;
    if (!weekend && period === 2) return 42;
    if (day === "sun" && period === 3) return 72;
    return 30;
  }
  if (zone === "ski") {
    if (day === "sat" && period === 1) return 82;
    if (day === "sat" && period === 2) return 68;
    if (day === "sun" && period === 3) return 76;
    if (friday && period === 3) return 62;
    if (!weekend && period === 1) return 42;
    return 28;
  }
  if (weekend && period === 2) return 58;
  if (friday && period === 3) return 48;
  return 25;
}

export function createAustriaTrafficForecast(charger: Supercharger): TrafficForecast {
  const zone = zoneFor(charger);
  const slots: TrafficForecastSlot[] = [];
  for (const day of TRAFFIC_DAYS) {
    TRAFFIC_PERIODS.forEach((period, index) => slots.push({
      day: day.key,
      from: period.from,
      to: period.to,
      level: baseline(day.key, index, zone),
    }));
  }
  const corridor = zone === "transit" ? "A10 Tauern / A11 Karawanken" : zone === "ski" ? "A12 Inntal / A13 Brenner / Tirol" : zone === "urban" ? "stedelijke spits" : "regionaal Oostenrijk";
  return {
    source: "regional-estimate",
    confidence: "low",
    note: `Automatische basisinschatting voor ${corridor}; geen live bezettingsdata. Seizoensinvloed wordt bij de voorspelling meegenomen.`,
    slots,
  };
}

export function createEmptyTrafficForecast(): TrafficForecast {
  return {
    source: "admin",
    confidence: "medium",
    note: "",
    slots: TRAFFIC_DAYS.flatMap((day) => TRAFFIC_PERIODS.map((period) => ({
      day: day.key, from: period.from, to: period.to, level: 25,
    }))),
  };
}

export function getTrafficForecastAt(forecast: TrafficForecast | undefined, at: Date) {
  if (!forecast?.slots?.length) return null;
  const dayKey = (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const)[at.getDay()];
  const minutes = at.getHours() * 60 + at.getMinutes();
  const slot = forecast.slots.find((item) => {
    if (item.day !== dayKey) return false;
    const [fh, fm] = item.from.split(":").map(Number);
    const [th, tm] = item.to.split(":").map(Number);
    const from = fh * 60 + fm;
    const to = item.to === "24:00" ? 1440 : th * 60 + tm;
    return minutes >= from && minutes < to;
  });
  if (!slot) return null;
  let level = Math.max(0, Math.min(100, slot.level));
  if (forecast.source === "regional-estimate") {
    const month = at.getMonth();
    const summer = month >= 5 && month <= 7;
    const winter = month === 11 || month <= 2;
    const weekend = dayKey === "sat" || dayKey === "sun";
    const transitOrSki = /A10|A11|A12|A13|Tirol|Tauern|Karawanken/i.test(forecast.note);
    if (transitOrSki && summer && weekend && minutes >= 360 && minutes < 1080) level += 18;
    if (transitOrSki && winter && dayKey === "sat" && minutes >= 360 && minutes < 840) level += 16;
    if (transitOrSki && winter && dayKey === "sun" && minutes >= 840 && minutes < 1200) level += 12;
  }
  return { level: Math.min(100, level), from: slot.from, to: slot.to, confidence: forecast.confidence, source: forecast.source };
}

export function trafficLevelLabel(level: number): string {
  return level >= 70 ? "Verwacht druk" : level <= 30 ? "Verwacht rustig" : "Gemiddelde drukte";
}
