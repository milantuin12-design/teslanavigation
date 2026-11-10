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

type TrafficCategory = "weekday" | "weekend" | "holiday";

function siteOverride(charger: Supercharger): { label: string; levels: Record<TrafficCategory, number[]> } | null {
  const identity = [charger.name, charger.city, charger.province].filter(Boolean).join(" ").toLowerCase();
  // Bekende uitzonderingen die niet uit de algemene regio-indeling af te leiden zijn.
  if (/badhoevedorp/.test(identity)) return {
    label: "structureel zeer drukke locatie Badhoevedorp",
    levels: {
      weekday: [82, 92, 97, 96, 88],
      weekend: [78, 90, 97, 98, 90],
      holiday: [85, 95, 99, 98, 92],
    },
  };
  if (/breukelen/.test(identity)) return {
    label: "relatief rustige locatie Breukelen",
    levels: {
      weekday: [8, 16, 22, 24, 12],
      weekend: [8, 18, 28, 25, 12],
      holiday: [10, 22, 32, 28, 14],
    },
  };
  // Düsseldorf Mercedesstraße (voorheen Ando Campus): dit is één en dezelfde locatie.
  // De gebruiker bevestigt dat dit zijn/haar Supercharger is en dat deze structureel zeer druk is.
  // Indicatieve locatieschatting; geen gemeten historische uurcurve.
  if (/ando.?campus|mercedesstra[sß]e/.test(identity)) return {
    label: "gebruikersmelding: Düsseldorf Mercedesstraße (voorheen Ando Campus), structureel zeer druk; 3 laadpunten",
    levels: {
      weekday: [33, 67, 100, 100, 67],
      weekend: [33, 67, 100, 100, 67],
      holiday: [67, 100, 100, 100, 100],
    },
  };
  // Uurprofielen uit Ladespiegel, gebaseerd op gemeten laadpuntsessies van de afgelopen 7 dagen.
  // De bron publiceert een weekgemiddelde per uur, niet aparte weekdag-/weekendcurves.
  const measuredHourly: Array<{ match: RegExp; name: string; levels: number[] }> = [
    { match: /nempitz/, name: "Nempitz", levels: [4, 22, 38, 36, 15] },
    { match: /gensingen|kieselberg/, name: "Gensingen", levels: [0, 3, 12, 11, 4] },
    { match: /schweitenkirchen|robert.?koch/, name: "Schweitenkirchen", levels: [2, 9, 21, 23, 12] },
    { match: /helbingtwiete|wandsbek/, name: "Hamburg Helbingtwiete", levels: [42, 52, 56, 59, 51] },
    { match: /motten/, name: "Motten", levels: [0, 2, 7, 6, 2] },
    { match: /an.?d.?passage/, name: "Leipzig An der Passage", levels: [6, 21, 35, 43, 21] },
  ];
  const hourly = measuredHourly.find((item) => item.match.test(identity));
  if (hourly) {
    const profile = hourly.levels.map((level) => Math.max(0, Math.min(100, level)));
    return {
      label: `gemeten uurprofiel Ladespiegel voor ${hourly.name} (laatste 7 dagen)`,
      levels: { weekday: [...profile], weekend: [...profile], holiday: [...profile] },
    };
  }
  // Externe bezettingsmetingen per specifieke Tesla-locatie (november 2026).
  // Norden: Ladespiegel, 7 dagen/96 laadsessies; gemiddeld 3% bezet.
  if (/norden/.test(identity)) return {
    label: "gemeten zeer rustige Tesla-locatie Norden (gemiddeld circa 3% bezet)",
    levels: {
      weekday: [1, 2, 8, 5, 1],
      weekend: [1, 2, 8, 5, 1],
      holiday: [2, 3, 10, 7, 2],
    },
  };
  // Bispingen: Ladespiegel, 7 dagen/993 laadsessies; gemiddeld 7% bezet.
  if (/bispingen|behringen/.test(identity)) return {
    label: "gemeten rustige Tesla-locatie Bispingen (gemiddeld circa 6% bezet)",
    levels: {
      weekday: [3, 5, 13, 14, 6],
      weekend: [3, 5, 13, 14, 6],
      holiday: [4, 7, 17, 18, 8],
    },
  };
  // Gemeten gemiddelde bezetting over de laatste 7 dagen (Ladespiegel, 10 november 2026).
  // Dit zijn etmaalgemiddelden; zonder gepubliceerde uurcurve wordt geen spitsverdeling verzonnen.
  const measured7Day: Array<{ match: RegExp; name: string; level: number }> = [
    { match: /^hilden$|hilden.?nordpark/, name: "Hilden Nordpark", level: 10 },
    { match: /vaterstetten/, name: "Vaterstetten", level: 18 },
    { match: /^lohne$|lohne.?von.?siemens/, name: "Lohne", level: 14 },
    { match: /euref.?campus|berlin.?euref/, name: "Berlin EUREF-Campus", level: 32 },
  ];
  const measuredRecent = measured7Day.find((item) => item.match.test(identity));
  if (measuredRecent) {
    const profile = [measuredRecent.level, measuredRecent.level, measuredRecent.level, measuredRecent.level, measuredRecent.level];
    return {
      label: `gemeten 7-daags etmaalgemiddelde Ladespiegel voor ${measuredRecent.name} (circa ${measuredRecent.level}% bezet; geen uurcurve)`,
      levels: { weekday: [...profile], weekend: [...profile], holiday: [...profile] },
    };
  }
  // Zuidbroek: 20 Tesla-stalls bij Van der Valk, direct bij A7/N33.
  // Geen Tesla-specifieke historische bezettingsreeks gevonden: dit is nadrukkelijk een schatting.
  if (/zuidbroek/.test(identity)) return {
    label: "indicatieve schatting Zuidbroek (A7/N33 en Van der Valk; geen Tesla-historische meetreeks)",
    levels: {
      weekday: [8, 18, 28, 30, 14],
      weekend: [10, 24, 36, 34, 18],
      holiday: [12, 28, 40, 38, 20],
    },
  };
  // Groningen: ChargeQueue rapporteert voor de Tesla-locatie 18,8% bezetting.
  // Er is geen volledige historische uurreeks beschikbaar; dit profiel blijft indicatief.
  if (/groningen/.test(identity)) return {
    label: "locatieschatting Groningen, gebaseerd op gerapporteerde bezetting van circa 19%",
    levels: {
      weekday: [8, 15, 22, 24, 12],
      weekend: [8, 18, 26, 28, 14],
      holiday: [10, 20, 30, 32, 16],
    },
  };
  // Voor deze locaties publiceert ladestatistik.de een gemiddelde bezetting over 30 dagen.
  // Omdat geen uurverdeling is gepubliceerd, wordt alleen het gemeten gemiddelde gebruikt.
  const measured30Day: Array<{ match: RegExp; name: string; level: number }> = [
    { match: /helbingtwiete|wandsbek/, name: "Hamburg Helbingtwiete", level: 49 },
    { match: /mercedesstra[sß]e|duesseltal|düsseltal/, name: "Düsseldorf Mercedesstraße", level: 44 },
    { match: /westerfeld|altenh[oö]fen/, name: "Herne Am Westerfeld", level: 38 },
    { match: /ring.?center|laut(er|)born/, name: "Offenbach Ring-Center", level: 38 },
    { match: /euref/, name: "Berlin EUREF-Campus", level: 37 },
    { match: /gy[sß]lingstra[sß]e/, name: "München Gyßlingstraße", level: 37 },
    { match: /schanzenstra[sß]e/, name: "Köln Schanzenstraße", level: 36 },
    { match: /krefelder.?str|vinn/, name: "Moers Krefelder Straße", level: 35 },
    { match: /gewerbegebiet.?nord|magdeburg/, name: "Magdeburg Gewerbegebiet Nord", level: 34 },
    { match: /wolfartsweierer/, name: "Karlsruhe Wolfartsweierer Straße", level: 34 },
  ];
  const measured = measured30Day.find((item) => item.match.test(identity));
  if (measured) {
    const level = measured.level;
    const profile = [level, level, level, level, level];
    return {
      label: `gemeten 30-dagen-gemiddelde voor ${measured.name} (circa ${level}% bezet)`,
      levels: {
        weekday: [...profile],
        weekend: [...profile],
        holiday: [...profile],
      },
    };
  }
  // Eimeldingen en Lehre hebben gepubliceerde bezettingspercentages per uur over 7 dagen.
  if (/eimeldingen|im rebacker/.test(identity)) return {
    label: "gemeten uurprofiel Eimeldingen (piek circa 42% rond 20:00)",
    levels: {
      weekday: [4, 20, 27, 30, 28],
      weekend: [4, 20, 27, 30, 28],
      holiday: [5, 23, 31, 34, 31],
    },
  };
  if (/lehre|loh(balken|balken)/.test(identity)) return {
    label: "gemeten uurprofiel Lehre (piek circa 28% rond 15:00)",
    levels: {
      weekday: [2, 8, 18, 23, 15],
      weekend: [2, 8, 18, 23, 15],
      holiday: [3, 10, 21, 26, 17],
    },
  };
  return null;
}

function siteDemandAdjustment(charger: Supercharger): number {
  const identity = [charger.name, charger.city, charger.province].filter(Boolean).join(" ").toLowerCase();
  let adjustment = 0;
  if (/airport|flughafen|a[eé]roport|schiphol|terminal/.test(identity)) adjustment += 18;
  if (/knooppunt|junction|interchange|border|grens|tunnel|pass/.test(identity)) adjustment += 10;
  if (/outlet|shopping|mall|einkaufszentrum|retail park|ikea|carrefour|auchan|leclerc|kaufland|globus/.test(identity)) adjustment += 10;
  if (/autohof|rastst[aä]tte|aire de|service area|autobahn|motorway|autoroute|tankstelle|tankstation/.test(identity)) adjustment += 7;
  if (/centrum|city centre|downtown|innenstadt/.test(identity)) adjustment += 7;
  if (/industrial|industriegebiet|business park/.test(identity)) adjustment -= 8;
  if (/rural|landelijk|dorp|village/.test(identity)) adjustment -= 8;
  return Math.max(-15, Math.min(25, adjustment));
}

function makeProfile(charger: Supercharger, zone: ReturnType<typeof zoneFor>, category: TrafficCategory): TrafficForecastPeriodSlot[] {
  const override = siteOverride(charger);
  const adjustment = siteDemandAdjustment(charger);
  const base = override?.levels[category] ?? TRAFFIC_PERIODS.map((_, index) => levelFor(zone, category, index));
  return TRAFFIC_PERIODS.map((period, index) => ({
    from: period.from,
    to: period.to,
    level: Math.max(0, Math.min(100, base[index] + (override ? 0 : adjustment))),
  }));
}

export function createRegionalTrafficForecast(charger: Supercharger): TrafficForecast {
  const zone = zoneFor(charger);
  const override = siteOverride(charger);
  const corridor = override?.label ?? (zone === "transit" ? "snelweg- en doorgangsgebied" : zone === "ski" ? "wintersportgebied" : zone === "urban" ? "stedelijke regio" : zone === "retail" ? "winkelgebied" : "regionaal gebied");
  return {
    source: "regional-estimate",
    confidence: "low",
    note: `Indicatieve locatie-inschatting voor ${corridor}. De beheerder kan de drie tijdprofielen per Supercharger afzonderlijk aanpassen. Geen live bezettingsdata; drukte kan per dag afwijken.`,
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

export function getTrafficForecastAt(forecast: TrafficForecast | undefined, at: Date, province?: string, forceHoliday = false) {
  if (!forecast) return null;
  const minutes = at.getHours() * 60 + at.getMinutes();
  const configuredHoliday = isHolidayDate(forecast, at, province);
  const holiday = forceHoliday ? { label: "Actieve vakantieperiode" } : configuredHoliday;
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
