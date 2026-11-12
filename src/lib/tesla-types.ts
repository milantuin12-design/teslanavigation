export interface ChargerConfig {
  count: number;
  version: 'V2' | 'V3' | 'V4' | string;
  speedKw: number;
}

export type OpeningDayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface OpeningDayHours {
  closed?: boolean;
  open: string;
  close: string;
}

export interface OpeningHours {
  mode: '24_7' | 'weekly';
  days: Record<OpeningDayKey, OpeningDayHours>;
}

export type ChargerLifecycleStatus =
  | 'operational'
  | 'construction'
  | 'works'
  | 'works_closed'
  | 'temp_closed'
  | 'long_closed'
  | 'voting'
  | 'plan'
  | 'permit'
  | 'expanding'
  | 'permanent_closed'
  | 'unknown';

export type StallCondition = 'available' | 'defect' | 'blocked' | 'maintenance' | 'other';

/** Status van één laadplek (alleen afwijkende plekken hoeven opgeslagen te worden). */
export interface StallState {
  stall: number;
  /** Optionele naam, bijv. "2B". */
  name?: string;
  version?: string;
  speedKw?: number;
  condition: StallCondition;
  note?: string;
  until?: string | null;
}

export interface VotingInfo {
  votes?: number;
  rank?: number;
  url?: string;
}

export const CONSTRUCTION_STEPS = [
  'permit',
  'groundwork',
  'cabling',
  'foundation',
  'paving',
  'transformer',
  'chargers_placed',
  'testing',
  'opening',
] as const;

export type ConstructionStep = (typeof CONSTRUCTION_STEPS)[number];

export const constructionStepLabels: Record<ConstructionStep, string> = {
  permit: 'Vergunning',
  groundwork: 'Grondwerk',
  cabling: 'Bekabeling',
  foundation: 'Fundering',
  paving: 'Bestrating',
  transformer: 'Transformator',
  chargers_placed: 'Superchargers geplaatst',
  testing: 'Testfase',
  opening: 'Opening',
};

export interface TrafficForecastSlot {
  day: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
  from: string;
  to: string;
  level: number;
}

export interface TrafficForecastPeriodSlot {
  from: string;
  to: string;
  level: number;
}

export interface TrafficHolidayPeriod {
  label: string;
  from: string;
  to: string;
  provinces?: string[];
}

export interface TrafficForecast {
  source: 'regional-estimate' | 'admin';
  confidence: 'low' | 'medium' | 'high';
  note?: string;
  /** Legacy day-by-day profile, kept for older saved forecasts. */
  slots?: TrafficForecastSlot[];
  /** Separate weekday profile (Monday-Friday). */
  weekdaySlots?: TrafficForecastPeriodSlot[];
  /** Separate weekend profile (Saturday-Sunday). */
  weekendSlots?: TrafficForecastPeriodSlot[];
  /** Separate profile used during configured school-holiday periods. */
  holidaySlots?: TrafficForecastPeriodSlot[];
  /** Austrian school-holiday periods; province-specific dates are supported. */
  holidayPeriods?: TrafficHolidayPeriod[];
}

export interface ConstructionInfo {
  plannedStalls?: number;
  version?: string;
  speedKw?: number;
  expectedOpen?: string;
  /** Vrij tekstveld: "Oktober 2026", "Q1 2027", "Verwacht voorjaar 2027" */
  expectedOpenMonth?: string;
  progress?: 'planned' | 'permit' | 'groundwork' | 'cabling' | 'installing' | 'testing';
  steps?: ConstructionStep[];
  configs?: ChargerConfig[];
  notes?: string;
  /** Admin weet nog niets over aantal laders/snelheid — toon dan géén laadsnelheid. */
  dataUnknown?: boolean;
  /** Opgeslagen in bestaand JSONB-veld construction zodat geen databasemigratie nodig is. */
  trafficForecast?: TrafficForecast;
  /** Number of parking/charging bays that can be used with a trailer. Stored in existing construction JSONB. */
  trailerFriendlyStalls?: number;
  /** Number of charger stalls blocked by one occupied trailer-friendly bay; defaults to 1. */
  trailerStallsPerSpace?: number;
  /** On-site amenities manually verified by the admin. */
  siteAmenities?: string[];
}


export interface WorksInfo {
  closedStalls?: number;
  reason?: string;
  expectedEnd?: string;
  notes?: string;
  /** Laadplekken die tijdens de werkzaamheden dicht zijn */
  closedConfigs?: ChargerConfig[];
  /** Laadplekken die open blijven */
  openConfigs?: ChargerConfig[];
}

export interface PlannedUpgrade {
  label?: string;
  fromConfigs?: ChargerConfig[];
  toConfigs?: ChargerConfig[];
  expected?: string;
}

export interface ClosureInfo {
  reason?: string;
  from?: string;
  until?: string;
  notes?: string;
}

export interface ChargerOwner {
  id: string;
  name: string;
  logoUrl?: string | null;
  description?: string | null;
  website?: string | null;
  contact?: string | null;
  notes?: string | null;
}

export interface SiteUpdate {
  id: string;
  title: string;
  body?: string | null;
  imageUrl?: string | null;
  importance: 'low' | 'normal' | 'high' | 'critical' | string;
  publishedAt: string;
  visible: boolean;
}


/** Een kWh-tarief dat geldt in een bepaald tijdsblok (bijv. ma-vr 07:00-19:00). */
export interface PriceBlock {
  /** kWh-tijdstarief of tarief op basis van het actuele laadvermogen. */
  type?: "kwh" | "power";
  /** Bijv. "ma-vr", "weekend", "dagelijks". */
  days?: string;
  /** "HH:MM" */
  from?: string;
  /** "HH:MM" */
  to?: string;
  pricePerKwh?: number;
  /** Vermogensgrenzen in kW; maxKw is exclusief. */
  minKw?: number;
  maxKw?: number | null;
  /** Bedrag per minuut binnen dit vermogensblok. */
  pricePerMinute?: number;
}

/** One parking tariff step; durationMinutes=0 is a one-time fixed fee. */
export interface ParkingFeeBlock {
  label?: string;
  afterMinutes: number;
  durationMinutes: number;
  amount: number;
  currency: string;
  repeat?: boolean;
}

export interface ChargerBusySlot {
  /** Weekday key: mon, tue, wed, thu, fri, sat, sun. */
  day: OpeningDayKey;
  /** Local hour, 0..23. */
  hour: number;
  /** Typical busyness: 0 = very quiet, 100 = usually very busy. */
  level: number;
}

export interface Supercharger {
  id?: string;
  name: string;
  lat: number;
  lng: number;
  totalStalls?: number;
  occupiedStalls?: number;
  stallTypes?: string;
  country?: string;
  province?: string;
  city?: string;
  maxSpeedKw?: number;
  versions?: string[];
  chargerConfigs?: ChargerConfig[];
  openingHours?: OpeningHours | null;
  openingTime?: string | null; // "HH:MM"
  closingTime?: string | null;
  trailerFriendly?: boolean;
  /** Number of spaces that can physically accommodate a trailer. */
  trailerFriendlyStalls?: number;
  /** Ondersteunde laadstekkers (alleen 'Type 2' en 'CCS' worden gebruikt). */
  connectors?: string[];
  isAvailable?: boolean;
  parkingFee?: boolean;
  /** Ordered parking fee steps; each step may use its own currency. */
  parkingBlocks?: ParkingFeeBlock[] | null;
  /** Vast parkeerbedrag in euro (optioneel). */
  parkingFeeAmount?: number | null;
  /** Gratis parkeerminuten voordat kosten ingaan (bijv. 90). */
  parkingFreeMinutes?: number | null;
  /** Tijdsblok in minuten voor parkeerkosten (bijv. 10 of 15). */
  parkingPerMinutes?: number | null;
  /** Kosten in euro per tijdsblok. */
  parkingPerEuro?: number | null;
  /** Valuta voor de weergegeven laadprijzen (ISO 4217), standaard EUR. */
  priceCurrency?: string;
  /** Laadtarief per kWh in de opgegeven valuta. */
  pricePerKwh?: number | null;
  /** Piek-tarief per kWh in euro (optioneel). */
  pricePerKwhPeak?: number | null;
  /** Tijdsblokken voor piektarief, vrije tekst. */
  peakHours?: string | null;
  /** Gestructureerde tarieven per tijdsblok; hebben voorrang op pricePerKwh. */
  priceBlocks?: PriceBlock[] | null;
  inParkingGarage?: boolean;
  status?: ChargerLifecycleStatus;
  construction?: ConstructionInfo;
  /** Expected crowd level, separately for weekdays, weekends and general holiday periods. */
  trafficForecast?: TrafficForecast;
  /** Global admin-controlled winter-sports warning mode. */
  winterSportsMode?: boolean;
  /** Global admin switch; winter-sports mode also activates holiday crowd profiles. */
  holidayPeriodMode?: boolean;
  siteAmenities?: string[];
  works?: WorksInfo;
  closure?: ClosureInfo;
  ownerId?: string | null;
  ownerName?: string | null;
  ownerLogoUrl?: string | null;
  ownerDescription?: string | null;
  ownerWebsite?: string | null;
  ownerContact?: string | null;
  ownerNotes?: string | null;
  lowSpeed?: boolean;
  published?: boolean;
  notes?: string | null;
  reopenAt?: string | null;
  plannedUpgrade?: PlannedUpgrade;
  stallStates?: StallState[];
  permanentlyClosedAt?: string | null;
  dataSource?: 'manual' | 'automatic';
  voting?: VotingInfo;
  hidden?: boolean;
  photos?: string[];
}



export interface ChargingStop {
  charger: Supercharger;
  batteryBefore: number;
  batteryAfter: number;
  distanceFromStart: number;
  chargeDurationMin: number;
  stopNumber?: number;
  /** Verplicht laadmoment bij een tussenstop (lader van derden of Supercharger). */
  forced?: boolean;
  /** Minutes from departure until arrival at this stop. */
  etaMinFromStart?: number;
  /** Energie verbruikt op het traject naar deze stop (kWh). */
  energyUsedKWh?: number;
  /** Energie die hier bijgeladen wordt (kWh). */
  energyChargedKWh?: number;

}


export interface RouteResult {
  coordinates: [number, number][];
  totalDistanceKm: number;
  totalTimeMin: number;
  /** Live vertraging t.o.v. vrije doorstroming. */
  trafficDelayMin?: number;
  /** Stukken van de route met file of traag verkeer (polyline-indexen). */
  trafficSegments?: { startIndex: number; endIndex: number; severity: 'slow' | 'jam' }[];
}

export type ChargerStatus =
  | 'Beschikbaar'
  | 'In bedrijf'
  | 'Druk'
  | 'Vol'
  | 'Onbekend'
  | 'Niet beschikbaar'
  | 'Gesloten'
  | 'In aanbouw'
  | 'Werkzaamheden'
  | 'Dicht door werkzaamheden'
  | 'Tijdelijk gesloten'
  | 'Langdurig gesloten'
  | 'Voting'
  | 'Plan'
  | 'Vergunning aangevraagd'
  | 'Wordt uitgebreid'
  | 'Permanent gesloten';

export interface ChargerFilterState {
  statuses: ChargerLifecycleStatus[];
  minSpeedKw: number;
  versions: string[];
  trailerOnly: boolean;
  noGarage: boolean;
  noParkingFee: boolean;
  openNow: boolean;
  country: string;
  search: string;
  minStalls: number;
  maxStalls: number;
  exactStalls: number | null;
  ownerId: string;
  lowSpeedOnly: boolean;
}

export const defaultChargerFilters: ChargerFilterState = {
  statuses: ['operational', 'construction', 'works', 'works_closed', 'temp_closed', 'long_closed', 'voting', 'plan', 'permit', 'expanding', 'permanent_closed', 'unknown'],
  minSpeedKw: 0,
  versions: [],
  trailerOnly: false,
  noGarage: false,
  noParkingFee: false,
  openNow: false,
  country: '',
  search: '',
  minStalls: 0,
  maxStalls: 0,
  exactStalls: null,
  ownerId: '',
  lowSpeedOnly: false,
};

/** Een tussenstop op de route; optioneel met laadwens. */
export interface Waypoint {
  id: string;
  label: string;
  lat: number;
  lng: number;
  charge: boolean;
  chargeTo: number;
}

/** Verplichte locatie waar de route binnen X km langs moet komen. */
export interface CorridorPoint {
  id: string;
  label: string;
  lat: number;
  lng: number;
  radiusKm: number;
}


export type WeatherMode = 'summer' | 'winter' | 'fog';
export type TimeMode = 'day' | 'night';
export type RouteType = 'fastest' | 'fewest' | 'scenic' | 'trailer' | 'manual';

/** Eén van de (maximaal 5) berekende routevoorstellen. */
export interface RouteOption {
  key: string;
  label: string;
  route: RouteResult;
  stops: ChargingStop[];
  arrivalPercent: number;
  /** Extra verbruik door hoogteverschil, als factor op het bereik (1 = vlak). */
  rangeMultiplier: number;
  ascentM?: number;
  descentM?: number;
  trailerFriendlyStops?: number;
  /** Reistijd inclusief laadtijd. */
  totalWithChargingMin: number;
}




export const teslaMaxChargeKw: Record<string, number> = {
  'Model 3 RWD': 170,
  'Model 3 Long Range RWD': 250,
  'Model 3 Long Range AWD': 250,
  'Model 3 Performance': 250,
  'Model Y RWD': 170,
  'Model Y Long Range RWD': 250,
  'Model Y Long Range AWD': 250,
  'Model Y Performance': 250,
  'Model S': 250,
  'Model S Plaid': 250,
  'Model X': 250,
  'Model X Plaid': 250,
};

export const teslaModels: Record<string, number> = {
  'Model 3 RWD': 385,
  'Model 3 Long Range RWD': 580,
  'Model 3 Long Range AWD': 495,
  'Model 3 Performance': 410,
  'Model Y RWD': 340,
  'Model Y Long Range RWD': 490,
  'Model Y Long Range AWD': 440,
  'Model Y Performance': 410,
  'Model S': 540,
  'Model S Plaid': 485,
  'Model X': 480,
  'Model X Plaid': 430,
};

export const teslaBatteryKWh: Record<string, number> = {
  'Model 3 RWD': 60,
  'Model 3 Long Range RWD': 79,
  'Model 3 Long Range AWD': 79,
  'Model 3 Performance': 79,
  'Model Y RWD': 60,
  'Model Y Long Range RWD': 79,
  'Model Y Long Range AWD': 79,
  'Model Y Performance': 79,
  'Model S': 100,
  'Model S Plaid': 100,
  'Model X': 100,
  'Model X Plaid': 100,
};
