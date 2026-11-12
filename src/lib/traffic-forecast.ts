import type { Supercharger, TrafficForecast, TrafficForecastPeriodSlot, TrafficForecastSlot } from "./tesla-types";

export const TRAFFIC_DAYS = [
  { key: "mon", label: "Ma" }, { key: "tue", label: "Di" }, { key: "wed", label: "Wo" },
  { key: "thu", label: "Do" }, { key: "fri", label: "Vr" }, { key: "sat", label: "Za" }, { key: "sun", label: "Zo" },
] as const;

const TRAFFIC_BASE_PERIODS = [
  { from: "00:00", to: "06:00" },
  { from: "06:00", to: "10:00" },
  { from: "10:00", to: "16:00" },
  { from: "16:00", to: "20:00" },
  { from: "20:00", to: "24:00" },
] as const;

// De bestaande locatieprofielen zijn ankerwaarden voor vijf dagdelen.
// We interpoleren ze naar 24 uurswaarden; dit zijn uurinschattingen, geen live metingen.
export const TRAFFIC_PERIODS = Array.from({ length: 24 }, (_, hour) => ({
  from: `${String(hour).padStart(2, "0")}:00`,
  to: `${String(hour + 1).padStart(2, "0")}:00`,
  label: `${String(hour).padStart(2, "0")}–${String(hour + 1).padStart(2, "0")}`,
}));

function interpolateHourly(anchors: number[], hour: number): number {
  const centers = [3, 8, 13, 18, 22];
  if (hour <= centers[0]) return anchors[0] ?? 0;
  if (hour >= centers[4]) return anchors[4] ?? 0;
  const right = centers.findIndex((center) => center >= hour);
  const left = right - 1;
  const ratio = (hour - centers[left]) / (centers[right] - centers[left]);
  return Math.round((anchors[left] ?? 0) + ((anchors[right] ?? 0) - (anchors[left] ?? 0)) * ratio);
}

function basePeriodIndex(hour: number): number {
  return hour < 6 ? 0 : hour < 10 ? 1 : hour < 16 ? 2 : hour < 20 ? 3 : 4;
}

function zoneFor(charger: Pick<Supercharger, "name" | "city" | "province" | "lat" | "lng" | "country">): "transit" | "ski" | "urban" | "retail" | "other" {
  const text = [charger.name, charger.city, charger.province].filter(Boolean).join(" ").toLowerCase();
  if (/autohof|rastst[aä]tte|aire de|area di servizio|service area|service station|autobahn|motorway|autoroute|autostrada|highway|tankstelle|tankstation/.test(text)) return "transit";
  if (/ski|alpen|alps|dolomit|brenner|tauern|arlberg|tirol|tyrol|salzburg|kitzb[uü]hel|zell am see|s[oö]lden|ischgl|st anton|lermoos|innsbruck|chamonix|val thorens|courchevel|les arcs|tignes|verbier|davos|zermatt|laax|st moritz|livigno|cortina|bormio|geilo|trysil|are|åre|kiruna|rovaniemi/.test(text)) return "ski";
  if (/ikea|shopping|mall|centre commercial|einkaufszentrum|outlet|retail park|carrefour|auchan|leclerc|kaufland|globus/.test(text)) return "retail";
  if (/wien|vienna|graz|linz|salzburg|m[uü]nchen|munich|berlin|hamburg|frankfurt|d[uü]sseldorf|duesseldorf|k[oö]ln|cologne|dortmund|essen|leipzig|dresden|stuttgart|hannover|bremen|bonn|m[uü]nster|aachen|paris|lyon|marseille|lille|bordeaux|toulouse|nice|brussels|bruxelles|amsterdam|almere|rotterdam|utrecht|eindhoven|groningen|zwolle|arnhem|nijmegen|breda|tilburg|s.?hertogenbosch|den.?bosch|apeldoorn|enschede|maastricht|leeuwarden|dordrecht|amersfoort|haarlem|leiden|delft|venlo|roermond|antwerp|antwerpen|gent|ghent|brugge|bruge|liege|luik|charleroi|namur|mechelen|hasselt|zurich|z[uü]rich|geneva|gen[eè]ve|basel|bern|lausanne|lucerne|luzern|milan|milano|rome|roma|barcelona|madrid|valencia|seville|malaga|zaragoza|bilbao|alicante|murcia|palma|lisbon|lisboa|porto|braga|coimbra|prague|praha|brno|ostrava|warsaw|warschau|krakow|krak[oó]w|wroclaw|gdansk|poznan|lodz|istanbul|ankara|izmir|bursa|antalya|athens|thessaloniki|budapest|bucharest|sofia|belgrade|zagreb|ljubljana|bratislava|copenhagen|k[oø]benhavn|aarhus|odense|aalborg|esbjerg|kolding|vejle|randers|horsens|roskilde|helsing[oø]r|stockholm|g[oö]teborg|gothenburg|malm[oö]|uppsala|oslo|bergen|trondheim|stavanger|helsinki|tampere|turku|oulu|tallinn|riga|vilnius|reykjavik|dublin|cork|galway|london|birmingham|manchester|liverpool|leeds|bristol|glasgow|edinburgh|cardiff|newcastle|rome|roma/.test(text)) return "urban";
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
    // Regionale locaties buiten grote steden, snelwegknooppunten en toeristische hotspots:
    // bewust een lagere basisvraag; een onbekende locatie wordt niet automatisch druk.
    other: {
      weekday: [2, 8, 14, 12, 5],
      weekend: [2, 10, 17, 14, 5],
      holiday: [3, 14, 22, 18, 7],
    },
  };
  return rows[zone][category][period];
}

type TrafficCategory = "weekday" | "weekend" | "holiday";

function siteOverride(charger: Supercharger): { label: string; levels: Record<TrafficCategory, number[]>; confidence?: "low" | "medium" | "high" } | null {
  const identity = [charger.name, charger.city, charger.province].filter(Boolean).join(" ").toLowerCase();
  // Bekende uitzonderingen die niet uit de algemene regio-indeling af te leiden zijn.
  // Trabzon (Pazarkapı): enige Tesla Supercharger in de regio.
  // Geen Tesla-historische meetreeks gevonden: bewust een lage regionale
  // vraaginschatting, mede doordat er meerdere andere publieke laadnetwerken zijn.
  if (/trabzon|pazarkap[iı]/.test(identity)) return {
    label: "lage regionale vraaginschatting Trabzon: enige Tesla-locatie in de regio; geen historische Tesla-bezettingsmeting",
    confidence: "low",
    levels: {
      weekday: [1, 2, 4, 3, 1],
      weekend: [1, 2, 5, 4, 1],
      holiday: [2, 3, 7, 5, 2],
    },
  };
  // Eemnes (Van der Valk, A1/A27-knooppunt): hogere passagevraag dan een
  // doorsnee regionale locatie. Dit is een locatieschatting, geen gemeten Tesla-bezettingsreeks.
  if (/eemnes|witte.?bergen/.test(identity)) return {
    label: "locatieschatting Eemnes: A1/A27-knooppunt en Van der Valk, structureel meer doorgaand verkeer",
    confidence: "low",
    levels: {
      weekday: [8, 32, 43, 48, 22],
      weekend: [10, 42, 58, 54, 26],
      holiday: [14, 52, 68, 64, 32],
    },
  };
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
  // Gemeten Tesla-profielen uit Ladespiegel (7-daagse uurbezetting).
  // De 24 uurwaarden zijn samengevat in de vijf tijdsblokken die de planner gebruikt.
  const ladespiegelMeasured: Array<{ match: RegExp; name: string; levels: number[] }> = [
    { match: /erkrather.?str|duesseldorf.?erkrather/, name: "Düsseldorf Erkrather Straße", levels: [8, 20, 33, 30, 21] },
    { match: /ellwangen/, name: "Ellwangen (Jagst)", levels: [3, 8, 22, 22, 9] },
    { match: /malsfeld/, name: "Malsfeld", levels: [3, 10, 30, 26, 16] },
    { match: /oberheidstr/, name: "Mülheim an der Ruhr", levels: [1, 14, 23, 30, 26] },
    { match: /kappel.?grafenhausen/, name: "Kappel-Grafenhausen", levels: [4, 9, 26, 22, 18] },
    { match: /reststrauch/, name: "Mönchengladbach Reststrauch", levels: [12, 28, 36, 36, 20] },
    { match: /main.?taunus.?zentrum|sulzbach.?taunus/, name: "Sulzbach (Taunus)", levels: [6, 24, 37, 54, 18] },
    { match: /prackenfelser/, name: "Altdorf", levels: [2, 14, 26, 29, 12] },
    { match: /hattersheim|heddingheimer/, name: "Hattersheim am Main", levels: [12, 29, 30, 39, 20] },
    { match: /beelitz|dr.?herrmann/, name: "Beelitz", levels: [4, 14, 33, 24, 13] },
  ];
  const ladespiegel = ladespiegelMeasured.find((item) => item.match.test(identity));
  if (ladespiegel) {
    const profile = [...ladespiegel.levels];
    return {
      label: `gemeten uurprofiel Ladespiegel voor ${ladespiegel.name} (gemiddelde per tijdsblok uit 7 dagen)`,
      confidence: "medium",
      levels: { weekday: [...profile], weekend: [...profile], holiday: [...profile] },
    };
  }

  // Uurprofielen uit Ladespiegel, gebaseerd op gemeten laadpuntsessies van de afgelopen 7 dagen.
  // De bron publiceert een weekgemiddelde per uur, niet aparte weekdag-/weekendcurves.
  const measuredHourly: Array<{ match: RegExp; name: string; levels: number[] }> = [
    { match: /nempitz/, name: "Nempitz", levels: [4, 22, 38, 36, 14] },
    { match: /gensingen|kieselberg/, name: "Gensingen", levels: [0, 3, 12, 11, 4] },
    { match: /schweitenkirchen|robert.?koch/, name: "Schweitenkirchen", levels: [2, 9, 21, 23, 12] },
    { match: /helbingtwiete|wandsbek/, name: "Hamburg Helbingtwiete", levels: [44, 52, 56, 61, 51] },
    { match: /motten/, name: "Motten", levels: [0, 2, 5, 7, 2] },
    { match: /an.?d.?passage/, name: "Leipzig An der Passage", levels: [6, 21, 35, 43, 21] },
  ];
  const hourly = measuredHourly.find((item) => item.match.test(identity));
  if (hourly) {
    const profile = hourly.levels.map((level) => Math.max(0, Math.min(100, level)));
    return {
      label: `gemeten uurprofiel Ladespiegel voor ${hourly.name} (laatste 7 dagen)`,
      confidence: "medium",
      levels: { weekday: [...profile], weekend: [...profile], holiday: [...profile] },
    };
  }
  // Externe bezettingsmetingen per specifieke Tesla-locatie (november 2026).
  // Norden: Ladespiegel, 7 dagen/96 laadsessies; gemiddeld 3% bezet.
  if (/norden/.test(identity)) return {
    label: "gemeten zeer rustige Tesla-locatie Norden (gemiddeld circa 3% bezet)",
    confidence: "medium",
    levels: {
      weekday: [1, 2, 8, 5, 1],
      weekend: [1, 2, 8, 5, 1],
      holiday: [2, 3, 10, 7, 2],
    },
  };
  // Bispingen: Ladespiegel, 7 dagen/993 laadsessies; gemiddeld 7% bezet.
  if (/bispingen|behringen/.test(identity)) return {
    label: "gemeten rustige Tesla-locatie Bispingen (gemiddeld circa 6% bezet)",
    confidence: "medium",
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
      confidence: "medium",
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
    const profile = [level, level, level, level, level];    return {
      label: `gemeten 30-dagen-gemiddelde voor ${measured.name} (circa ${level}% bezet)`,
      confidence: "medium",
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
    confidence: "medium",
    levels: {
      weekday: [4, 20, 27, 30, 28],
      weekend: [4, 20, 27, 30, 28],
      holiday: [4, 20, 27, 30, 28],
    },
  };
  if (/lehre|loh(balken|balken)/.test(identity)) return {
    label: "gemeten uurprofiel Lehre (7-daags Ladespiegel-profiel, samengevat per tijdsblok)",
    confidence: "medium",
    levels: {
      weekday: [1, 8, 19, 18, 12],
      weekend: [1, 8, 19, 18, 12],
      holiday: [1, 8, 19, 18, 12],
    },
  };
  return null;
}

function siteDemandAdjustment(charger: Supercharger, zone: ReturnType<typeof zoneFor>, category: TrafficCategory): number {
  const identity = [charger.name, charger.city, charger.province].filter(Boolean).join(" ").toLowerCase();
  let adjustment = 0;
  if (/airport|flughafen|a[eé]roport|schiphol|terminal/.test(identity)) adjustment += 18;
  if (/knooppunt|junction|interchange|border|grens|tunnel|pass/.test(identity)) adjustment += 10;
  if (/outlet|shopping|mall|einkaufszentrum|retail park|ikea|carrefour|auchan|leclerc|kaufland|globus/.test(identity)) adjustment += 10;
  if (/autohof|rastst[aä]tte|aire de|service area|autobahn|motorway|autoroute|tankstelle|tankstation/.test(identity)) adjustment += 7;
  if (/centrum|city centre|downtown|innenstadt/.test(identity)) adjustment += 7;
  if (/industrial|industriegebiet|business park/.test(identity)) adjustment -= 8;
  if (/rural|landelijk|dorp|village/.test(identity)) adjustment -= 8;

  // Capaciteit is geen bewijs van vraag: 8 stalls maakt een locatie niet
  // automatisch drukker dan een locatie met 40. De stall-count wordt daarom
  // niet als druktecorrectie gebruikt, maar alleen voor de vrije-stalls-berekening.

  const country = (charger.country ?? "").toLowerCase().trim();
  if (/norway|norge|sweden|sverige|finland|suomi|iceland|island/.test(country) && zone === "ski") adjustment += 8;
  if (/austria|österreich|switzerland|schweiz|suisse|italy|italia|france|españa|spain/.test(country) && zone === "ski") adjustment += 6;
  if (/netherlands|nederland|belgium|belgië|belgique|germany|deutschland/.test(country) && zone === "urban" && category === "weekday") adjustment += 4;

  if (/beach|strand|plage|playa|costa|marina|camping|resort|seaside|feri(en)?|holiday park/.test(identity)) {
    adjustment += category === "weekday" ? 4 : category === "weekend" ? 14 : 20;
  }
  if (/ferry|fähre|port|harbour|haven|terminal/.test(identity)) adjustment += category === "weekday" ? 5 : 9;

  return Math.max(-22, Math.min(35, adjustment));
}

function makeProfile(charger: Supercharger, zone: ReturnType<typeof zoneFor>, category: TrafficCategory): TrafficForecastPeriodSlot[] {
  const override = siteOverride(charger);
  const base = override?.levels[category] ?? TRAFFIC_BASE_PERIODS.map((_, index) => levelFor(zone, category, index));
  const adjustments = override ? TRAFFIC_BASE_PERIODS.map(() => 0) : (() => {
    const adjustment = siteDemandAdjustment(charger, zone, category);
    // De capaciteit en ligging beïnvloeden niet elk dagdeel even sterk.
    const weights = category === "weekday"
      ? [0.55, 1.0, 0.9, 1.0, 0.6]
      : category === "weekend"
        ? [0.65, 0.9, 1.0, 0.95, 0.7]
        : [0.7, 1.0, 1.0, 1.0, 0.75];
    return weights.map((weight) => Math.round(adjustment * weight));
  })();
  // Gemeten weekprofielen bevatten niet noodzakelijk een schoolvakantie.
  // Voeg alleen aan die meetprofielen een bescheiden, locatie-afhankelijke
  // vakantiecorrectie toe; wintersportmodus activeert dit niet.
  const measuredHolidayBoost = category === "holiday" && override?.confidence === "medium"
    ? zone === "ski" || zone === "transit" ? 12 : zone === "retail" ? 8 : 4
    : 0;
  // Capaciteit maakt een wezenlijk verschil: dezelfde lokale vraag leidt bij 4 stalls
  // tot een veel hogere bezettingsgraad dan bij 32 stalls. De generieke profielen zijn
  // genormaliseerd op een locatie met circa 16 bruikbare stalls.
  // Gemeten profielen (confidence medium/high) blijven ongewijzigd: die percentages
  // zijn al echte bezettingspercentages van deze specifieke locatie.
  const configuredTotal = charger.chargerConfigs?.reduce((sum, config) => sum + Math.max(0, Number(config.count) || 0), 0) || 0;
  const total = configuredTotal || Math.max(0, Number(charger.totalStalls) || 0);
  const worksOpen = charger.status === "works"
    ? charger.works?.openConfigs?.reduce((sum, config) => sum + Math.max(0, Number(config.count) || 0), 0)
    : undefined;
  const worksClosed = charger.status === "works"
    ? (charger.works?.closedConfigs?.reduce((sum, config) => sum + Math.max(0, Number(config.count) || 0), 0) ?? charger.works?.closedStalls ?? 0)
    : 0;
  const unavailableStalls = new Set(
    (charger.stallStates ?? [])
      .filter((stall) => stall.condition !== "available")
      .map((stall) => stall.stall)
  ).size;
  const capacityBeforeIssues = worksOpen !== undefined && worksOpen > 0
    ? Math.min(total || worksOpen, worksOpen)
    : Math.max(0, total - worksClosed);
  const usableCapacity = Math.max(0, capacityBeforeIssues - unavailableStalls);
  const capacityMultiplier = total > 0 && usableCapacity > 0
    ? 16 / usableCapacity
    : 1;
  const applyCapacity = override?.confidence !== "medium" && override?.confidence !== "high";
  return TRAFFIC_PERIODS.map((period, hour) => {
    const rawLevel = interpolateHourly(base, hour) + interpolateHourly(adjustments, hour) + measuredHolidayBoost;
    const capacityAdjusted = applyCapacity ? rawLevel * capacityMultiplier : rawLevel;
    return {
      from: period.from,
      to: period.to,
      level: Math.max(0, Math.min(100, Math.round(capacityAdjusted))),
    };
  });
}

type NetworkLocation = Pick<Supercharger, "id" | "lat" | "lng">;

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (value: number) => value * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Schat relatieve lokale concurrentie/vraag op basis van nabijgelegen Tesla-locaties.
 * Dit wordt voor iedere Supercharger berekend; het aantal stalls zelf bepaalt de vraag niet.
 */
function regionalNetworkFactor(charger: Supercharger, network: NetworkLocation[], zone: ReturnType<typeof zoneFor>): number {
  const nearby = network.filter((site) =>
    site.id !== charger.id &&
    Number.isFinite(site.lat) && Number.isFinite(site.lng) &&
    distanceKm(charger, site) <= 60
  ).length;
  const densityFactor = nearby === 0 ? -0.24
    : nearby <= 2 ? -0.14
    : nearby <= 5 ? -0.05
    : nearby <= 10 ? 0.04
    : nearby <= 20 ? 0.10
    : 0.16;
  // Een afgelegen snelweg-, ski- of toeristische locatie kan ondanks weinig
  // Tesla-buren toch veel passanten trekken; demp de isolatiecorrectie daar.
  const zoneProtection = zone === "transit" || zone === "ski" || zone === "retail" ? 0.10 : 0;
  return Math.max(-0.18, Math.min(0.16, densityFactor + zoneProtection));
}

export function createRegionalTrafficForecast(charger: Supercharger, network: NetworkLocation[] = []): TrafficForecast {
  const zone = zoneFor(charger);
  const override = siteOverride(charger);
  const networkFactor = regionalNetworkFactor(charger, network, zone);
  // Expliciete en gemeten locatieprofielen zijn al locatiespecifiek:
  // laat die ongemoeid door de algemene netwerkdichtheidscorrectie.
  const applyNetworkFactor = (slots: TrafficForecastPeriodSlot[]) => override ? slots : slots.map((slot) => ({
    ...slot,
    level: Math.max(0, Math.min(100, Math.round(slot.level * (1 + networkFactor)))),
  }));
  return {
    source: "regional-estimate",
    confidence: override?.confidence ?? "low",
    // Korte, neutrale tekst; geen samengestelde gebruikersmelding of interne uitleg.
    note: "Locatiespecifieke drukteverwachting; geen live bezettingsmeting.",
    weekdaySlots: applyNetworkFactor(makeProfile(charger, zone, "weekday")),
    weekendSlots: applyNetworkFactor(makeProfile(charger, zone, "weekend")),
    holidaySlots: applyNetworkFactor(makeProfile(charger, zone, "holiday")),
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

export function getTrafficForecastAt(forecast: TrafficForecast | undefined, at: Date, province?: string, forceHoliday = false, forceWinterSports = false) {
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
  const level = Math.max(0, Math.min(100, slot.level + (forceWinterSports ? 12 : 0)));
  return {
    level,
    winterSports: forceWinterSports,
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
  // Conservatief afronden: 0 vrije plekken is mogelijk, ook als de berekende
  // restcapaciteit kleiner is dan één laadplek.
  return Math.max(0, Math.min(total, Math.floor(total * (1 - Math.max(0, Math.min(100, level)) / 100))));
}

/**
 * Indicatieve wachtrij bij vrijwel volledige bezetting. Dit is nadrukkelijk
 * een modelmatige schatting, geen live geteld aantal wachtende auto's.
 */
export function estimateQueueCars(total: number | undefined, level: number): number {
  if (!total || total <= 0) return 0;

  const normalizedLevel = Math.max(0, Math.min(100, level));
  const freeStalls = estimateFreeStalls(total, normalizedLevel);

  // Een wachtrij kan uitsluitend bestaan wanneer ALLE bruikbare laadplekken bezet zijn.
  // Dit voorkomt bijvoorbeeld de onmogelijke combinatie "1 beschikbaar" + "1 in wachtrij".
  if (freeStalls === null || freeStalls > 0 || normalizedLevel < 95) return 0;

  // Alleen bij volledige bezetting wordt een kleine, indicatieve wachtrij getoond.
  return Math.min(4, Math.max(1, Math.ceil((normalizedLevel - 90) / 5)));
}

/** Herkent Alpen-, wintersport- en noordelijke sneeuwgebieden voor de admin-waarschuwing. */
export function isSnowRegion(charger: Pick<Supercharger, "name" | "city" | "province" | "country" | "lat" | "lng">): boolean {
  const text = [charger.name, charger.city, charger.province].filter(Boolean).join(" ").toLowerCase();
  const country = (charger.country ?? "").toLowerCase();
  if (/switzerland|schweiz|suisse|norway|norge|sweden|sverige|finland|suomi/.test(country)) return true;
  if (/alps|alpen|dolomit|ski|berg|brenner|tauern|arlberg|tirol|tyrol|salzburg|kitzb[uü]hel|zell am see|sölden|soelden|ischgl|st anton|lermoos|innsbruck|chamonix|val thorens|courchevel|les arcs|tignes|verbier|davos|zermatt|laax|st moritz|livigno|cortina|bormio|geilo|try sil|trysil|are|åre|kiruna|rovaniemi/.test(text)) return true;
  return charger.lat >= 46.0 && charger.lat <= 47.8 && charger.lng >= 9.5 && charger.lng <= 14.8;
}