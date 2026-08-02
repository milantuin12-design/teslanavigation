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
  | 'long_closed';

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
  isAvailable?: boolean;
  parkingFee?: boolean;
  inParkingGarage?: boolean;
  status?: ChargerLifecycleStatus;
  construction?: ConstructionInfo;
  works?: WorksInfo;
  closure?: ClosureInfo;
}


export interface ChargingStop {
  charger: Supercharger;
  batteryBefore: number;
  batteryAfter: number;
  distanceFromStart: number;
  chargeDurationMin: number;
  stopNumber?: number;
  /** Minutes from departure until arrival at this stop. */
  etaMinFromStart?: number;
}


export interface RouteResult {
  coordinates: [number, number][];
  totalDistanceKm: number;
  totalTimeMin: number;
}

export type ChargerStatus =
  | 'Beschikbaar'
  | 'Druk'
  | 'Vol'
  | 'Onbekend'
  | 'Niet beschikbaar'
  | 'Gesloten'
  | 'In aanbouw'
  | 'Werkzaamheden'
  | 'Dicht door werkzaamheden'
  | 'Tijdelijk gesloten'
  | 'Langdurig gesloten';

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
}

export const defaultChargerFilters: ChargerFilterState = {
  statuses: ['operational', 'construction', 'works', 'works_closed', 'temp_closed', 'long_closed'],
  minSpeedKw: 0,
  versions: [],
  trailerOnly: false,
  noGarage: false,
  noParkingFee: false,
  openNow: false,
  country: '',
  search: '',
};

export type WeatherMode = 'summer' | 'winter' | 'fog';
export type TimeMode = 'day' | 'night';
export type RouteType = 'fastest' | 'fewest' | 'scenic' | 'trailer' | 'manual';


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
