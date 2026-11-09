import type { Supercharger, TrafficForecast, TrafficForecastPeriodSlot, TrafficForecastSlot } from "./tesla-types";

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

const AUSTRIA_HOLIDAYS = [
  { label: "Kerstvakantie", from: "2026-12-24", to: "2027-01-06" },
  { label: "Semesterferien Wien & Niederösterreich", from: "2027-02-01", to: "2027-02-06", provinces: ["Wien", "Niederösterreich"] },
  { label: "Semesterferien Burgenland & Kärnten", from: "2027-02-08", to: "2027-02-13", provinces: ["Burgenland", "Kärnten"] },
  { label: "Semesterferien overige deelstaten", from: "2027-02-15", to: "2027-02-20", provinces: ["Oberösterreich", "Salzburg", "Steiermark", "Tirol", "Vorarlberg"] },
  { label: "Paasvakantie", from: "2027-03-20", to: "2027-03-29" },
  { label: "Pinkstervakantie", from: "2027-05-15", to: "2027-05-17" },
  { label: "Zomervakantie Burgenland, Niederösterreich & Wien", from: "2027-07-03", to: "2027-09-05", provinces: ["Burgenland", "Niederösterreich", "Wien"] },
  { label: "Zomervakantie overige deelstaten", from: "2027-07-10", to: "2027-09-12", provinces: ["Kärnten", "Oberösterreich", "Salzburg", "Steiermark", "Tirol", "Vorarlberg"] },
];

function zoneFor(charger: Pick<Supercharger, "name" | "city" | "province" | "lat" | "lng">): "transit" | "ski" | "urban" | "other" {
  const text = [charger.name, charger.city, charger.province].filter(Boolean).join(" ").toLowerCase();
  if (/tauern|spittal|villach|katschberg|st\. michael|eben im pongau|flachau|golling|werfen|karawanken|arnoldstein/.test(text) ||
      (charger.lat > 46.7 && charger.lat < 47.9 && charger.lng > 12.7 && charger.lng < 14.8)) return "transit";
  if (/brenner|innsbruck|inntal|wörgl|kufstein|imst|landeck|ötztal|tirol|fernpass|reutte|lermoos|heiterwang|arlberg|st anton/.test(text) ||
      (charger.lat > 46.7 && charger.lat < 47.8 && charger.lng > 10.0 && charger.lng < 12.7)) return "ski";
  if (/wien|vienna|graz|linz|salzburg|st\. pölten|eisenstadt|klagenfurt/.test(text) ||
      (charger.lat > 47.8 && charger.lat < 48.4 && charger.lng > 16.0 && charger.lng < 16.8)) return "urban";
  return "other";
}

function levelFor(zone: ReturnType<typeof zoneFor>, category: "weekday" | "weekend" | "holiday", period: number): number {
  const rows: Record<typeof zone, Record<typeof category, number[]>> = {
    urban: {
      weekday: [10, 72, 42, 78, 18],
      weekend: [10, 28, 52, 42, 18],
      holiday: [12, 45, 66, 72, 22],
    },
    transit: {
      weekday: [10, 38, 48, 42, 18],
      weekend: [12, 70, 82, 72, 22],
      holiday: [15, 82, 92, 88, 28],
    },
    ski: {
      weekday: [10, 35, 42, 40, 18],
      weekend: [12, 82, 70, 76, 24],
      holiday: [15, 92, 88, 82, 30],
    },
    other: {
      weekday: [8, 25, 30, 32, 15],
      weekend: [10, 38, 58, 48, 18],
      holiday: [12, 55, 72, 65, 22],
    },
  };
  return rows[zone][category][period];
}

function makeProfile(zone: ReturnType<typeof zoneFor>, category: "weekday" | "weekend" | "holiday"): TrafficForecastPeriodSlot[] {
  return TRAFFIC_PERIODS.map((period, index) => ({
    from: period.from,
    to: period.to,
    level: levelFor(zone, category, index),
  }));
}

export function createAustriaTrafficForecast(charger: Supercharger): TrafficForecast {
  const zone = zoneFor(charger);
  const corridor = zone === "transit" ? "A10 Tauern / A11 Karawanken" : zone === "ski" ? "A12 Inntal / A13 Brenner / Tirol" : zone === "urban" ? "stedelijke regio" : "regionaal Oostenrijk";
  return {
    source: "regional-estimate",
    confidence: "low",
    note: `Indicatieve regionale inschatting voor ${corridor}. Geen live bezettingsdata; de vakantieprofielen zijn gebaseerd op de officiële Oostenrijkse schoolvakanties 2026/2027.`,
    weekdaySlots: makeProfile(zone, "weekday"),
    weekendSlots: makeProfile(zone, "weekend"),
    holidaySlots: makeProfile(zone, "holiday"),
    holidayPeriods: AUSTRIA_HOLIDAYS,
  };
}

export function createEmptyTrafficForecast(): TrafficForecast {
  const defaults = TRAFFIC_PERIODS.map((period) => ({ from: period.from, to: period.to, level: 25 }));
  return {
    source: "admin",
    confidence: "medium",
    note: "",
    weekdaySlots: defaults.map((slot) => ({ ...slot })),
    weekendSlots: defaults.map((slot) => ({ ...slot })),
    holidaySlots: defaults.map((slot) => ({ ...slot })),
    holidayPeriods: [],
    slots: TRAFFIC_DAYS.flatMap((day) => TRAFFIC_PERIODS.map((period) => ({
      day: day.key, from: period.from, to: period.to, level: 25,
    }))),
  };
}

function findProfileSlot(slots: TrafficForecastPeriodSlot[] | undefined, minutes: number) {
  return slots?.find((item) => {
    const [fh, fm] = item.from.split(":").map(Number);
    const [th, tm] = item.to.split(":").map(Number);
    const from = fh * 60 + fm;
    const to = item.to === "24:00" ? 1440 : th * 60 + tm;
    return minutes >= from && minutes < to;
  });
}

function isHolidayDate(forecast: TrafficForecast, at: Date, province?: string) {
  const date = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  return (forecast.holidayPeriods ?? []).find((period) =>
    date >= period.from && date <= period.to &&
    (!period.provinces?.length || !province || period.provinces.some((item) => item.toLowerCase() === province.toLowerCase()))
  );
}

export function getTrafficForecastAt(forecast: TrafficForecast | undefined, at: Date, province?: string) {
  if (!forecast) return null;
  const minutes = at.getHours() * 60 + at.getMinutes();
  const holiday = isHolidayDate(forecast, at, province);
  const weekend = at.getDay() === 0 || at.getDay() === 6;
  const profile = holiday
    ? (forecast.holidaySlots ?? forecast.weekendSlots)
    : weekend
      ? forecast.weekendSlots
      : forecast.weekdaySlots;
  let slot = findProfileSlot(profile, minutes);

  // Backward compatibility with older day-specific forecasts.
  if (!slot && forecast.slots?.length) {
    const dayKey = (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const)[at.getDay()];
    const legacy = forecast.slots.find((item: TrafficForecastSlot) => {
      if (item.day !== dayKey) return false;
      const [fh, fm] = item.from.split(":").map(Number);
      const [th, tm] = item.to.split(":").map(Number);
      const from = fh * 60 + fm;
      const to = item.to === "24:00" ? 1440 : th * 60 + tm;
      return minutes >= from && minutes < to;
    });
    if (legacy) slot = legacy;
  }
  if (!slot) return null;
  const level = Math.max(0, Math.min(100, slot.level));
  return {
    level,
    from: slot.from,
    to: slot.to,
    confidence: forecast.confidence,
    source: forecast.source,
    holiday: holiday?.label ?? null,
    category: holiday ? "holiday" : weekend ? "weekend" : "weekday",
  };
}

export function trafficLevelLabel(level: number): string {
  return level >= 70 ? "Verwacht druk" : level <= 30 ? "Verwacht rustig" : "Gemiddelde drukte";
}
