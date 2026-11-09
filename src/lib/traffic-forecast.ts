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

function zoneFor(charger: Pick<Supercharger, "name" | "city" | "province" | "lat" | "lng">): "transit" | "ski" | "urban" | "retail" | "other" {
  const text = [charger.name, charger.city, charger.province].filter(Boolean).join(" ").toLowerCase();
  if (/autohof|rastst[aä]tte|aire de|area di servizio|service area|service station|autobahn|motorway|autoroute|autostrada|highway|tankstelle|tankstation/.test(text)) return "transit";
  if (/ski|alpen|alps|dolomit|brenner|tauern|arlberg|tirol|tyrol|salzburg|kitzb[uü]hel|zell am see|s[oö]lden|ischgl|st anton|lermoos|innsbruck|chamonix|val thorens|courchevel|les arcs|tignes|verbier|davos|zermatt|laax|st moritz|livigno|cortina|bormio|geilo|trysil|are|åre|kiruna|rovaniemi/.test(text)) return "ski";
  if (/ikea|shopping|mall|centre commercial|einkaufszentrum|outlet|retail park|carrefour|auchan|leclerc|kaufland|globus/.test(text)) return "retail";
  if (/wien|vienna|graz|linz|salzburg|m[uü]nchen|munich|berlin|hamburg|frankfurt|paris|lyon|marseille|brussels|bruxelles|amsterdam|rotterdam|utrecht|antwerp|antwerpen|gent|ghent|zurich|z[uü]rich|geneva|gen[eè]ve|milan|milano|rome|roma|barcelona|madrid|prague|praha|warsaw|warschau/.test(text)) return "urban";
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
    retail: {
      weekday: [8, 24, 35, 48, 12],
      weekend: [8, 30, 72, 65, 20],
      holiday: [10, 42, 82, 75, 22],
    },
    other: {
      weekday: [8, 25, 30, 32, 15],
      weekend: [10, 38, 58, 48, 18],
      holiday: [12, 55, 72, 65, 22],
    },
  };
  return rows[zone][category][period];
}

function makeProfile(charger: Supercharger, zone: ReturnType<typeof zoneFor>, category: "weekday" | "weekend" | "holiday"): TrafficForecastPeriodSlot[] {
  const identity = [charger.name, charger.city, charger.lat.toFixed(3), charger.lng.toFixed(3)].join("|").toLowerCase();
  let hash = 0;
  for (let i = 0; i < identity.length; i++) hash = (hash * 31 + identity.charCodeAt(i)) | 0;
  const siteOffset = (Math.abs(hash) % 9) - 4;
  return TRAFFIC_PERIODS.map((period, index) => ({
    from: period.from,
    to: period.to,
    level: Math.max(0, Math.min(100, levelFor(zone, category, index) + siteOffset)),
  }));
}

export function createRegionalTrafficForecast(charger: Supercharger): TrafficForecast {
  const zone = zoneFor(charger);
  const corridor = zone === "transit" ? "A10 Tauern / A11 Karawanken" : zone === "ski" ? "A12 Inntal / A13 Brenner / Tirol" : zone === "urban" ? "stedelijke regio" : zone === "retail" ? "winkelgebied" : "regionaal gebied";
  return {
    source: "regional-estimate",
    confidence: "low",
    note: `Indicatieve locatie-inschatting voor ${corridor}, met een kleine locatiespecifieke correctie. Geen live bezettingsdata. Het vakantieprofiel geldt voor algemene vakantieperiodes die de beheerder instelt.`,
    weekdaySlots: makeProfile(charger, zone, "weekday"),
    weekendSlots: makeProfile(charger, zone, "weekend"),
    holidaySlots: makeProfile(charger, zone, "holiday"),
    holidayPeriods: [],
  };
}

export const createAustriaTrafficForecast = createRegionalTrafficForecast;

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

function normalizeProvince(value: string) {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const aliases: Record<string, string> = {
    vienna: "wien", "lower austria": "niederosterreich", "lower austria ": "niederosterreich",
    "upper austria": "oberosterreich", carinthia: "karnten", styria: "steiermark", tyrol: "tirol",
  };
  return aliases[normalized] ?? normalized;
}

function isHolidayDate(forecast: TrafficForecast, at: Date, province?: string) {
  const date = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  return (forecast.holidayPeriods ?? []).find((period) =>
    date >= period.from && date <= period.to &&
    (!period.provinces?.length || !province || period.provinces.some((item) => normalizeProvince(item) === normalizeProvince(province)))
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

/** Schat het aantal vrije laadplekken op basis van het ingestelde druktepercentage. */
export function estimateFreeStalls(total: number | undefined, level: number): number | null {
  if (!total || total <= 0) return null;
  return Math.max(0, Math.min(total, Math.round(total * (1 - Math.max(0, Math.min(100, level)) / 100))));
}

/** Herkent Alpen-, wintersport- en noordelijke sneeuwgebieden voor de admin-waarschuwing. */
export function isSnowRegion(charger: Pick<Supercharger, "name" | "city" | "province" | "country" | "lat" | "lng">): boolean {
  const text = [charger.name, charger.city, charger.province].filter(Boolean).join(" ").toLowerCase();
  const country = (charger.country ?? "").toLowerCase();
  if (/switzerland|schweiz|suisse|norway|norge|sweden|sverige|finland|suomi/.test(country)) return true;
  if (/alps|alpen|dolomit|ski|berg|brenner|tauern|arlberg|tirol|tyrol|salzburg|kitzb[uü]hel|zell am see|sölden|soelden|ischgl|st anton|lermoos|innsbruck|chamonix|val thorens|courchevel|les arcs|tignes|verbier|davos|zermatt|laax|st moritz|livigno|cortina|bormio|geilo|try sil|trysil|are|åre|kiruna|rovaniemi/.test(text)) return true;
  return charger.lat >= 46.0 && charger.lat <= 47.8 && charger.lng >= 9.5 && charger.lng <= 14.8;
}
