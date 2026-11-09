import { canUseConnectors, normalizeConnectors, rangeFromEnergy } from './energy';
import { getTrafficForecastAt } from './traffic-forecast';
import { Supercharger, ChargingStop, ChargerStatus, RouteResult, WeatherMode, TimeMode, teslaBatteryKWh, teslaMaxChargeKw, ChargerConfig, OpeningHours, OpeningDayKey, ChargerLifecycleStatus, ChargerFilterState, constructionStepLabels } from './tesla-types';

export function parseCoordinates(input: string): { lat: number; lng: number } | null {
  const trimmed = input.trim();
  const parts = trimmed.split(',');
  if (parts.length !== 2) return null;
  const lat = parseFloat(parts[0].trim());
  const lng = parseFloat(parts[1].trim());
  if (isNaN(lat) || isNaN(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function getAvailableRange(
  modelRangeKm: number,
  batteryPercent: number,
  trailerReductionPercent: number = 0,
  weatherMode: WeatherMode = 'summer',
  timeMode: TimeMode = 'day'
): number {
  let range = modelRangeKm * batteryPercent / 100;
  if (trailerReductionPercent > 0) range *= (1 - trailerReductionPercent / 100);
  if (weatherMode === 'winter') range *= 0.80;
  if (weatherMode === 'fog') range *= 0.90;
  if (timeMode === 'night') range *= 0.95;
  return range;
}

export function normalizeChargerConfigs(configs?: ChargerConfig[] | null): ChargerConfig[] {
  if (!Array.isArray(configs)) return [];
  return configs
    .map((config) => ({
      count: Number(config.count),
      version: String(config.version || '').toUpperCase(),
      speedKw: Number(config.speedKw),
    }))
    .filter((config) => config.count > 0 && config.speedKw > 0 && config.version.length > 0);
}

export function parseChargerConfigsFromLegacy(stallTypes?: string | null, totalStalls?: number | null, maxSpeedKw?: number | null, versions?: string[] | null): ChargerConfig[] {
  const raw = (stallTypes || '')
    .split(/[,+]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index)
    .join(', ');
  const configs: ChargerConfig[] = [];
  const detailedPattern = /(\d+)\s*x?\s*(?:laders?)?\s*(?:\(?\s*)?(V[234])?(?:\s*\)?\s*)?(?:laders?)?\s*(?:(\d{2,3})\s*k?w?)?/gi;
  let match: RegExpExecArray | null;
  while ((match = detailedPattern.exec(raw)) !== null) {
    const count = Number(match[1]);
    const version = (match[2] || '').toUpperCase();
    const speedFromText = match[3] ? Number(match[3]) : 0;
    if (!count) continue;
    const inferredVersion = version || (speedFromText >= 250 ? 'V3' : 'V2');
    const inferredSpeed = speedFromText || (inferredVersion === 'V4' ? 325 : inferredVersion === 'V3' ? 250 : 150);
    configs.push({ count, version: inferredVersion, speedKw: inferredSpeed });
  }

  if (configs.length > 0) return configs;
  const fallbackCount = totalStalls || 0;
  const fallbackSpeed = maxSpeedKw || parseMaxSpeed(raw || undefined, undefined, []);
  const fallbackVersion = versions?.[0] || (/v4/i.test(raw) ? 'V4' : /v3/i.test(raw) ? 'V3' : 'V2');
  return fallbackCount > 0 ? [{ count: fallbackCount, version: fallbackVersion, speedKw: fallbackSpeed }] : [];
}

export function getTotalStallsFromConfigs(configs?: ChargerConfig[] | null): number | undefined {
  const total = normalizeChargerConfigs(configs).reduce((sum, config) => sum + config.count, 0);
  return total > 0 ? total : undefined;
}

export function getMaxSpeedFromConfigs(configs?: ChargerConfig[] | null): number | undefined {
  const speeds = normalizeChargerConfigs(configs).map((config) => config.speedKw);
  return speeds.length > 0 ? Math.max(...speeds) : undefined;
}

export function getVersionsFromConfigs(configs?: ChargerConfig[] | null): string[] {
  return Array.from(new Set(normalizeChargerConfigs(configs).map((config) => config.version))).sort();
}

export function formatChargerConfig(config: ChargerConfig): string {
  return `${config.count} ${config.version} laders ${config.speedKw}kW`;
}

export function getChargerConfigs(charger: Supercharger): ChargerConfig[] {
  const direct = normalizeChargerConfigs(charger.chargerConfigs);
  if (direct.length > 0) return direct;
  return parseChargerConfigsFromLegacy(charger.stallTypes, charger.totalStalls, charger.maxSpeedKw, charger.versions);
}

export const openingDayKeys: OpeningDayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const openingDayLabels: Record<OpeningDayKey, string> = {
  mon: 'Ma',
  tue: 'Di',
  wed: 'Wo',
  thu: 'Do',
  fri: 'Vr',
  sat: 'Za',
  sun: 'Zo',
};

export function defaultOpeningHours(): OpeningHours {
  return {
    mode: '24_7',
    days: Object.fromEntries(openingDayKeys.map((day) => [day, { closed: false, open: '00:00', close: '23:59' }])) as OpeningHours['days'],
  };
}

export function normalizeOpeningHours(value?: unknown, openingTime?: string | null, closingTime?: string | null): OpeningHours {
  const fallback = defaultOpeningHours();
  if (value && typeof value === 'object') {
    const raw = value as Partial<OpeningHours>;
    const days = { ...fallback.days };
    if (raw.days && typeof raw.days === 'object') {
      for (const day of openingDayKeys) {
        const rawDay = raw.days[day];
        if (rawDay && typeof rawDay === 'object') {
          days[day] = {
            closed: !!rawDay.closed,
            open: typeof rawDay.open === 'string' && rawDay.open ? rawDay.open : '00:00',
            close: typeof rawDay.close === 'string' && rawDay.close ? rawDay.close : '23:59',
          };
        }
      }
    }
    if (raw.mode === 'weekly') return { mode: 'weekly', days };
    if (openingTime && closingTime) {
      return {
        mode: 'weekly',
        days: Object.fromEntries(openingDayKeys.map((day) => [day, { closed: false, open: openingTime.slice(0, 5), close: closingTime.slice(0, 5) }])) as OpeningHours['days'],
      };
    }
    return { mode: '24_7', days };
  }
  if (openingTime && closingTime) {
    return {
      mode: 'weekly',
      days: Object.fromEntries(openingDayKeys.map((day) => [day, { closed: false, open: openingTime.slice(0, 5), close: closingTime.slice(0, 5) }])) as OpeningHours['days'],
    };
  }
  return fallback;
}

function minutesFromHHMM(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function dayKeyForDate(date: Date): OpeningDayKey {
  return openingDayKeys[(date.getDay() + 6) % 7];
}

export function formatOpeningHoursSummary(charger: Supercharger): string {
  const hours = normalizeOpeningHours(charger.openingHours, charger.openingTime, charger.closingTime);
  if (hours.mode === '24_7') return '24/7 open';
  const today = hours.days[dayKeyForDate(new Date())];
  if (!today || today.closed) return 'Vandaag gesloten';
  return `Vandaag ${today.open}–${today.close}`;
}

export function parseMaxSpeed(stallTypes?: string, maxSpeedKw?: number, chargerConfigs?: ChargerConfig[]): number {
  const configSpeed = getMaxSpeedFromConfigs(chargerConfigs);
  // A manually entered site limit can intentionally be lower than the
  // hardware rating (for example V2 hardware capped at 50kW).
  if (typeof maxSpeedKw === 'number' && maxSpeedKw > 0 && configSpeed) return Math.min(maxSpeedKw, configSpeed);
  if (typeof maxSpeedKw === 'number' && maxSpeedKw > 0) return maxSpeedKw;
  if (configSpeed) return configSpeed;
  if (!stallTypes) return 150;
  const speeds = stallTypes.match(/(\d+)\s*kw/gi);
  if (speeds && speeds.length > 0) return Math.max(...speeds.map(s => parseInt(s, 10)));
  if (/v4/i.test(stallTypes)) return 325;
  if (/v3/i.test(stallTypes)) return 250;
  if (/v2/i.test(stallTypes)) return 150;
  return 150;
}

export function effectiveChargeSpeedKw(chargerKw: number, modelName: string, maxKwOverride?: number): number {
  const cap = typeof maxKwOverride === 'number' && maxKwOverride > 0 ? maxKwOverride : (teslaMaxChargeKw[modelName] ?? 250);
  return Math.min(chargerKw, cap);
}


// Laadvermogen per batterijpercentage, aangeleverd voor de vier Tesla-modelfamilies.
// Tussen de opgegeven percentages wordt lineair geïnterpoleerd.
const TESLA_CHARGE_POWER_CURVES: Record<string, { percent: number; kw: number }[]> = {
  'Model 3': [
    { percent: 0, kw: 250 }, { percent: 10, kw: 227 }, { percent: 20, kw: 201 },
    { percent: 30, kw: 173 }, { percent: 40, kw: 125 }, { percent: 50, kw: 101 },
    { percent: 60, kw: 81 }, { percent: 70, kw: 64 }, { percent: 80, kw: 39 },
    { percent: 90, kw: 35 }, { percent: 95, kw: 28 },
  ],
  'Model Y': [
    { percent: 0, kw: 250 }, { percent: 10, kw: 225 }, { percent: 20, kw: 189 },
    { percent: 30, kw: 159 }, { percent: 40, kw: 130 }, { percent: 50, kw: 103 },
    { percent: 60, kw: 82 }, { percent: 70, kw: 71 }, { percent: 80, kw: 40 },
    { percent: 90, kw: 32 }, { percent: 95, kw: 30 },
  ],
  'Model S': [
    { percent: 0, kw: 250 }, { percent: 10, kw: 250 }, { percent: 20, kw: 220 },
    { percent: 30, kw: 195 }, { percent: 40, kw: 176 }, { percent: 50, kw: 140 },
    { percent: 60, kw: 112 }, { percent: 70, kw: 87 }, { percent: 80, kw: 62 },
    { percent: 90, kw: 41 }, { percent: 95, kw: 28 },
  ],
  'Model X': [
    { percent: 0, kw: 250 }, { percent: 10, kw: 250 }, { percent: 20, kw: 220 },
    { percent: 30, kw: 197 }, { percent: 40, kw: 176 }, { percent: 50, kw: 140 },
    { percent: 60, kw: 112 }, { percent: 70, kw: 87 }, { percent: 80, kw: 62 },
    { percent: 90, kw: 41 }, { percent: 95, kw: 28 },
  ],
};

function chargeCurveFamily(modelName: string): string {
  if (/model\s*y/i.test(modelName)) return 'Model Y';
  if (/model\s*s/i.test(modelName)) return 'Model S';
  if (/model\s*x/i.test(modelName)) return 'Model X';
  return 'Model 3';
}

/** Geschat laadvermogen bij een SOC, begrensd door de Supercharger en de auto. */
export function estimatedChargePowerKw(
  modelName: string,
  batteryPercent: number,
  chargerMaxSpeedKw: number,
  carMaxKwOverride?: number
): number {
  const points = TESLA_CHARGE_POWER_CURVES[chargeCurveFamily(modelName)];
  const p = Math.max(0, Math.min(100, batteryPercent));
  let lower = points[0];
  let upper = points[points.length - 1];
  for (let i = 1; i < points.length; i++) {
    if (p <= points[i].percent) {
      lower = points[i - 1];
      upper = points[i];
      break;
    }
  }
  const span = upper.percent - lower.percent;
  const fraction = span > 0 ? Math.max(0, Math.min(1, (p - lower.percent) / span)) : 0;
  const curveKw = lower.kw + (upper.kw - lower.kw) * fraction;
  const carCap = carMaxKwOverride && carMaxKwOverride > 0
    ? carMaxKwOverride
    : (teslaMaxChargeKw[modelName] ?? 250);
  return Math.max(1, Math.min(curveKw, chargerMaxSpeedKw || 250, carCap));
}

/** Charging-curve sample points after applying the selected car and station power caps. */
export function getChargeCurvePoints(modelName: string, chargerMaxSpeedKw: number, carMaxKwOverride?: number) {
  const family = chargeCurveFamily(modelName);
  return TESLA_CHARGE_POWER_CURVES[family].map((point) => ({
    percent: point.percent,
    kw: estimatedChargePowerKw(modelName, point.percent, chargerMaxSpeedKw, carMaxKwOverride),
  }));
}

export function calculateChargeDuration(
  batteryBefore: number,
  batteryAfter: number,
  batteryCapacityKWh: number,
  chargerMaxSpeedKw: number,
  modelName: string = 'Model 3 Long Range AWD',
  carMaxKwOverride?: number
): number {
  if (batteryAfter <= batteryBefore || batteryCapacityKWh <= 0) return 0;
  // Reken in stappen van 1% zodat de taper en tariefgrenzen nauwkeurig gevolgd kunnen worden.
  let minutes = 0;
  const start = Math.max(0, batteryBefore);
  const end = Math.min(100, batteryAfter);
  for (let pct = start; pct < end; pct += 1) {
    const next = Math.min(end, pct + 1);
    const midpoint = (pct + next) / 2;
    const powerKw = estimatedChargePowerKw(modelName, midpoint, chargerMaxSpeedKw, carMaxKwOverride);
    const energyKWh = batteryCapacityKWh * (next - pct) / 100;
    minutes += (energyKWh / powerKw) * 60;
  }
  return Math.max(1, Math.round(minutes));
}


export function isChargerOperationalAt(charger: Supercharger, atDate: Date = new Date()): boolean {
  const lifecycle = charger.status ?? 'operational';
  if (lifecycle !== 'operational' && lifecycle !== 'works' && lifecycle !== 'expanding') return false;
  if (getTotalStalls(charger) > 0 && getOpenStalls(charger, atDate) <= 0) return false;
  return charger.isAvailable !== false && isChargerOpenAt(charger, atDate);
}

export function getChargerStatus(charger: Supercharger, atDate: Date = new Date()): ChargerStatus {
  const lifecycle = charger.status ?? 'operational';
  if (lifecycle === 'construction') return 'In aanbouw';
  if (lifecycle === 'works_closed') return 'Dicht door werkzaamheden';
  if (lifecycle === 'temp_closed') return 'Tijdelijk gesloten';
  if (lifecycle === 'long_closed') return 'Langdurig gesloten';
  if (lifecycle === 'permanent_closed') return 'Permanent gesloten';
  if (lifecycle === 'voting') return 'Voting';
  if (lifecycle === 'plan') return 'Plan';
  if (lifecycle === 'permit') return 'Vergunning aangevraagd';
  if (lifecycle === 'unknown') return 'Onbekend';
  if (getTotalStalls(charger) > 0 && getOpenStalls(charger, atDate) <= 0) return 'Niet beschikbaar';
  if (charger.isAvailable === false) return 'Niet beschikbaar';
  if (!isChargerOpenAt(charger, atDate)) return 'Gesloten';
  if (lifecycle === 'works') return 'Werkzaamheden';
  if (lifecycle === 'expanding') return 'Wordt uitgebreid';
  // Live bezetting wordt niet gebruikt: operationele status komt uit de
  // officiële lifecycle-status, niet uit bezette/vrije laadplekken.
  return 'In bedrijf';
}



export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointToSegmentDistance(
  pLat: number, pLng: number,
  aLat: number, aLng: number,
  bLat: number, bLng: number
): number {
  const d13 = haversineDistance(pLat, pLng, aLat, aLng);
  const d23 = haversineDistance(pLat, pLng, bLat, bLng);
  const d12 = haversineDistance(aLat, aLng, bLat, bLng);
  if (d12 === 0) return d13;
  const r = Math.max(0, Math.min(1,
    ((d13 * d13) - (d23 * d23) + (d12 * d12)) / (2 * d12 * d12)
  ));
  const closestLat = aLat + r * (bLat - aLat);
  const closestLng = aLng + r * (bLng - aLng);
  return haversineDistance(pLat, pLng, closestLat, closestLng);
}

export function findChargersNearRoute(
  routeCoords: [number, number][],
  chargers: Supercharger[],
  maxDistanceKm: number = 5
): Supercharger[] {
  return chargers.filter(charger => {
    for (let i = 0; i < routeCoords.length - 1; i++) {
      const [aLng, aLat] = routeCoords[i];
      const [bLng, bLat] = routeCoords[i + 1];
      const dist = pointToSegmentDistance(charger.lat, charger.lng, aLat, aLng, bLat, bLng);
      if (dist <= maxDistanceKm) return true;
    }
    return false;
  });
}

/** Is charger open at given local time (HH:MM). null times = 24/7. */
export function isChargerOpenAt(charger: Supercharger, atDate: Date): boolean {
  const weekly = normalizeOpeningHours(charger.openingHours, charger.openingTime, charger.closingTime);
  if (weekly.mode === '24_7') return true;
  const today = weekly.days[dayKeyForDate(atDate)];
  if (!today || today.closed) return false;
  const mins = atDate.getHours() * 60 + atDate.getMinutes();
  const openMin = minutesFromHHMM(today.open);
  const closeMin = minutesFromHHMM(today.close);
  if (openMin === closeMin) return true;
  if (openMin < closeMin) return mins >= openMin && mins <= closeMin;
  return mins >= openMin || mins <= closeMin;
}

export function isChargerOpenAtLegacy(charger: Supercharger, atDate: Date): boolean {
  if (!charger.openingTime || !charger.closingTime) return true;
  const mins = atDate.getHours() * 60 + atDate.getMinutes();
  const [oh, om] = charger.openingTime.split(':').map(Number);
  const [ch, cm] = charger.closingTime.split(':').map(Number);
  const openMin = oh * 60 + (om || 0);
  const closeMin = ch * 60 + (cm || 0);
  if (openMin === closeMin) return true;
  if (openMin < closeMin) return mins >= openMin && mins <= closeMin;
  // overnight
  return mins >= openMin || mins <= closeMin;
}

export interface CalcChargingOptions {
  modelRangeKm: number;
  batteryPercent: number;
  trailerReductionPercent: number;
  chargers: Supercharger[];
  modelName?: string;
  targetArrivalPercent?: number;
  weatherMode?: WeatherMode;
  timeMode?: TimeMode;
  chargeTargetPercent?: number;
  /** Minimum SOC to charge to at each stop (floor). */
  minChargeTargetPercent?: number;
  /** Maximum SOC to charge to at each stop (cap). */
  maxChargeTargetPercent?: number;
  minChargerSpeedKw?: number;
  maxArrivalAtChargerPercent?: number;
  minSafetyPercent?: number;
  /** Battery capacity override (kWh) for manual model. */
  batteryCapacityKWhOverride?: number;
  /** Car max charge speed override (kW) for manual model. */
  carMaxKwOverride?: number;
  /** Only allow trailer-friendly chargers. */
  trailerOnly?: boolean;
  /** Prefer trailer-friendly chargers but allow others if needed. */
  preferTrailerFriendly?: boolean;
  /** Exclude chargers inside parking garages (trailer routes cannot enter). */
  excludeParkingGarage?: boolean;
  /** Vermijd locaties die door de admin als lage laadsnelheid zijn gemarkeerd. */
  avoidLowSpeed?: boolean;
  /** Eurotunnel-laders zijn alleen geldig wanneer de route daadwerkelijk door de tunnel gaat. */
  allowEurotunnel?: boolean;
  /** Time of departure — used to filter out chargers that are closed at arrival. */
  departureTime?: Date;
  /** >1 = meer verbruik (klimmen), <1 = minder verbruik (dalen/regeneratie). */
  consumptionMultiplier?: number;
  /** Verbruik in kWh/100 km. Aanwezig = energie-gebaseerde berekening. */
  consumptionKWh100?: number;
  /** Bruikbare accucapaciteit in kWh (voor de energieberekening). */
  usableBatteryKWh?: number;
  /** CCS niet bruikbaar (Model S/X vóór 2019 zonder CCS-adapter). */
  ccsBlocked?: boolean;
  /** Verplichte laadmomenten bij tussenstops (km langs de route). */
  forcedStops?: { routeKm: number; chargeTo: number; charger: Supercharger; kw: number }[];
  /** Laders die de gebruiker heeft geweigerd (bijv. status Onbekend of 'liever niet laden'). Id of naam. */
  excludeIds?: string[];
  /** Na afwijzen van een onbekende locatie: kies de dichtstbijzijnde haalbare volgende lader. */
  preferNearestCharger?: boolean;
  /** Laders met parkeerkosten overslaan. */
  avoidParkingFee?: boolean;

}


/** Concrete alternatieven wanneer een route niet haalbaar is. */
function buildSuggestions(ctx: { chargeTargetPercent: number; batteryPercent: number }): string[] {
  const out: string[] = [];
  if (ctx.batteryPercent < 95) out.push(`Vertrek met een hoger startpercentage (nu ${Math.round(ctx.batteryPercent)}%).`);
  if (ctx.chargeTargetPercent < 100) out.push(`Laad langer door: zet "opladen tot" hoger dan ${Math.round(ctx.chargeTargetPercent)}%.`);
  out.push('Verlaag de minimale laadsnelheid of sta laders met lage snelheid toe.');
  out.push('Kies een extra laadstop of een andere route (bijv. via een grotere weg).');
  out.push('Verlaag het gewenste aankomstpercentage op de bestemming.');
  return out;
}

export function calculateChargingStops(
  route: RouteResult,
  opts: CalcChargingOptions
): { stops: ChargingStop[]; arrivalPercent: number; unreachable: boolean; reason?: string; suggestions?: string[] } {
  const {
    modelRangeKm,
    batteryPercent,
    trailerReductionPercent,
    chargers,
    modelName = 'Model 3 Long Range AWD',
    targetArrivalPercent = 10,
    weatherMode = 'summer',
    timeMode = 'day',
    chargeTargetPercent = 80,
    minChargeTargetPercent,
    maxChargeTargetPercent,
    minChargerSpeedKw = 0,
    maxArrivalAtChargerPercent = 10,
    minSafetyPercent = 3,
    batteryCapacityKWhOverride,
    carMaxKwOverride,
    trailerOnly = false,
    preferTrailerFriendly = false,
    excludeParkingGarage = false,
    avoidLowSpeed = false,
    allowEurotunnel = false,
    departureTime = new Date(),
    consumptionMultiplier = 1,
    consumptionKWh100,
    usableBatteryKWh,
    ccsBlocked = false,
    forcedStops = [],
    excludeIds = [],
    preferNearestCharger = false,
    avoidParkingFee = false,
  } = opts;
  const pendingForced = [...forcedStops].sort((a, b) => a.routeKm - b.routeKm);
  const excluded = new Set(excludeIds);




  const stops: ChargingStop[] = [];

  if (route.coordinates.length < 2) {
    return { stops: [], arrivalPercent: batteryPercent, unreachable: false };
  }

  let filtered = chargers.filter(c => {
    const lifecycle = c.status ?? 'operational';
    if (c.published === false) return false;
    if ((c.id && excluded.has(c.id)) || excluded.has(c.name)) return false;
    if (lifecycle !== 'operational' && lifecycle !== 'works' && lifecycle !== 'expanding' && lifecycle !== 'unknown') return false;
    if (c.isAvailable === false) return false;
    // Een locatie met 0 bruikbare laadplekken is nooit een laadstop.
    if (getTotalStalls(c) > 0 && getOpenStalls(c) <= 0) return false;
    if (avoidLowSpeed && c.lowSpeed) return false;
    if (!allowEurotunnel && /eurotunnel/i.test(c.name)) return false;
    // Alleen Type 2 / CCS. Zonder CCS-adapter (Model S/X vóór 2019) vervallen CCS-only locaties.
    // Zonder CCS-adapter: alleen V2 Superchargers (die hebben de Tesla/Type 2-kabel).
    if (ccsBlocked && !hasV2Stalls(c)) return false;
    return parseMaxSpeed(c.stallTypes, c.maxSpeedKw, c.chargerConfigs) >= minChargerSpeedKw;
  });

  if (trailerOnly) filtered = filtered.filter(c => c.trailerFriendly);
  if (excludeParkingGarage) filtered = filtered.filter(c => !c.inParkingGarage);
  if (avoidParkingFee) filtered = filtered.filter(c => !c.parkingFee);

  const nearChargers = findChargersNearRoute(route.coordinates, filtered, 20);
  const routeDist = buildRouteDistanceIndex(route.coordinates);
  // Positie langs de route één keer berekenen (scheelt veel rekentijd).
  const posMap = new Map<Supercharger, { km: number; detour: number }>();
  for (const c of nearChargers) {
    const idx = findNearestCoordIndex(route.coordinates, [c.lng, c.lat]);
    posMap.set(c, { km: routeDist[idx], detour: haversineDistance(route.coordinates[idx][1], route.coordinates[idx][0], c.lat, c.lng) });
  }
  const safeMultiplier = Math.min(1.6, Math.max(0.75, consumptionMultiplier || 1));
  const packKWh = usableBatteryKWh || batteryCapacityKWhOverride || teslaBatteryKWh[modelName] || 79;
  // Energie-gebaseerd bereik wanneer een verbruik bekend is; anders de km-schatting.
  const fullRangeKm = consumptionKWh100 && consumptionKWh100 > 0
    ? rangeFromEnergy(packKWh, consumptionKWh100)
    : getAvailableRange(modelRangeKm, 100, trailerReductionPercent, weatherMode, timeMode) / safeMultiplier;
  const kWhPerPercent = packKWh / 100;


  const kmPerMin = route.totalDistanceKm > 0 && route.totalTimeMin > 0
    ? route.totalDistanceKm / route.totalTimeMin
    : 1.5;

  if (nearChargers.length === 0 && pendingForced.length === 0) {
    const directRange = getAvailableRange(modelRangeKm, batteryPercent, trailerReductionPercent, weatherMode, timeMode) / safeMultiplier;
    if (route.totalDistanceKm <= directRange) {
      const batteryAtDest = batteryPercent - (route.totalDistanceKm / fullRangeKm * 100);
      return { stops: [], arrivalPercent: Math.round(Math.max(0, batteryAtDest)), unreachable: false };
    }
    return {
      stops: [],
      arrivalPercent: 0,
      unreachable: true,
      reason: 'Geen geschikte Superchargers gevonden langs de route',
      suggestions: buildSuggestions({ chargeTargetPercent, batteryPercent }),
    };
  }

  let currentBattery = batteryPercent;
  let currentPositionKm = 0;
  let elapsedMin = 0;

  const maxIterations = 80;
  let iterations = 0;

  while (currentPositionKm < route.totalDistanceKm && iterations < maxIterations) {
    iterations++;
    const remainingToDest = route.totalDistanceKm - currentPositionKm;

    // Verplicht laden bij een tussenstop: daarna gewoon verder met het bereik van dat percentage.
    while (pendingForced.length > 0 && pendingForced[0].routeKm <= currentPositionKm + 0.5) pendingForced.shift();
    const nextForced = pendingForced[0];
    if (nextForced) {
      const legKm = nextForced.routeKm - currentPositionKm;
      const atForced = currentBattery - (legKm / fullRangeKm) * 100;
      if (atForced >= minSafetyPercent) {
        pendingForced.shift();
        const before = Math.round(atForced);
        const after = Math.max(before, Math.min(100, nextForced.chargeTo));
        const kWhNow = batteryCapacityKWhOverride || teslaBatteryKWh[modelName] || 79;
        // Ook bij verplichte tussenstops geldt de laagste limiet van de
        // gekozen laadconfiguratie en de daadwerkelijke Superchargerlocatie.
        const stationMaxKw = ccsBlocked
          ? (v2SpeedKw(nextForced.charger) ?? parseMaxSpeed(nextForced.charger.stallTypes, nextForced.charger.maxSpeedKw, nextForced.charger.chargerConfigs))
          : parseMaxSpeed(nextForced.charger.stallTypes, nextForced.charger.maxSpeedKw, nextForced.charger.chargerConfigs);
        const chargingLimitKw = Math.min(nextForced.kw, stationMaxKw);
        const dur = calculateChargeDuration(before, after, kWhNow, chargingLimitKw, modelName, carMaxKwOverride);
        stops.push({
          charger: nextForced.charger,
          batteryBefore: before,
          batteryAfter: after,
          distanceFromStart: Math.round(nextForced.routeKm),
          chargeDurationMin: dur,
          energyUsedKWh: Math.round(legKm / 100 * (consumptionKWh100 || 18) * 10) / 10,
          energyChargedKWh: Math.round((after - before) * kWhPerPercent * 10) / 10,
          stopNumber: stops.length + 1,
          etaMinFromStart: Math.round(elapsedMin + legKm / kmPerMin),
          forced: true,
        });
        elapsedMin += legKm / kmPerMin + dur;
        currentPositionKm = nextForced.routeKm;
        currentBattery = after;
        continue;
      }
    }

    const batteryNeededForDest = (remainingToDest / fullRangeKm) * 100 + targetArrivalPercent;
    if (!nextForced && currentBattery >= batteryNeededForDest) {
      const arrivalBattery = Math.max(0, currentBattery - (remainingToDest / fullRangeKm) * 100);
      stops.forEach((stop, idx) => { stop.stopNumber = idx + 1; });
      return { stops, arrivalPercent: Math.round(arrivalBattery), unreachable: false };
    }

    const usableRange = ((currentBattery - minSafetyPercent) / 100) * fullRangeKm;

    type Candidate = {
      charger: Supercharger;
      routeKm: number;
      detourKm: number;
      distanceTravelled: number;
      batteryAtCharger: number;
      estArrival: Date;
    };
    const candidates: Candidate[] = [];

    for (const c of nearChargers) {
      const pos = posMap.get(c)!;
      const chargerRouteKm = pos.km;
      const distFromRoute = pos.detour;
      if (chargerRouteKm <= currentPositionKm + 20) continue;
      if (nextForced && chargerRouteKm >= nextForced.routeKm) continue;
      const travelKm = (chargerRouteKm - currentPositionKm) + distFromRoute;
      if (travelKm > usableRange) continue;

      const travelMin = travelKm / kmPerMin;
      const estArrival = new Date(departureTime.getTime() + (elapsedMin + travelMin) * 60000);
      if (!isChargerOpenAt(c, estArrival)) continue;

      const batteryConsumed = (travelKm / fullRangeKm) * 100;
      candidates.push({
        charger: c,
        routeKm: chargerRouteKm,
        detourKm: distFromRoute,
        distanceTravelled: travelKm,
        batteryAtCharger: currentBattery - batteryConsumed,
        estArrival,
      });
    }

    if (candidates.length === 0) {
      if (!nextForced && usableRange + minSafetyPercent / 100 * fullRangeKm >= remainingToDest) {
        const arrivalBattery = Math.max(0, currentBattery - (remainingToDest / fullRangeKm) * 100);
        stops.forEach((stop, idx) => { stop.stopNumber = idx + 1; });
        return { stops, arrivalPercent: Math.round(arrivalBattery), unreachable: false };
      }
      return {
        stops,
        arrivalPercent: 0,
        unreachable: true,
        reason: 'Geen bereikbare Supercharger binnen actieradius (open op de verwachte aankomsttijd)',
        suggestions: buildSuggestions({ chargeTargetPercent, batteryPercent }),
      };
    }

    // Zo min mogelijk laadstops: kies de VERST haalbare lader. Liefst met het gewenste
    // aankomstpercentage; lukt dat niet, dan de verste met minimaal de veiligheidsmarge.
    const arriveTarget = Math.max(minSafetyPercent, maxArrivalAtChargerPercent);
    const penalty = (c: Candidate) => {
      // Vermijd bij vergelijkbare routes liever een drukke laadlocatie.
      // Een voorspelling met lage zekerheid weegt minder zwaar dan een handmatig beheerd profiel.
      const crowd = getTrafficForecastAt(c.charger.trafficForecast, c.estArrival, c.charger.province);
      const confidenceFactor = crowd?.confidence === "high" ? 0.3 : crowd?.confidence === "medium" ? 0.22 : 0.12;
      const crowdPenaltyKm = (crowd?.level ?? 0) * confidenceFactor;
      return c.detourKm * 2
        + crowdPenaltyKm
        + (preferTrailerFriendly && c.charger.trailerFriendly ? -15 : 0)
        + (c.charger.inParkingGarage ? 10 : 0);
    };
    const feasible = candidates.filter((c) => c.batteryAtCharger >= minSafetyPercent);
    const comfy = feasible.filter((c) => c.batteryAtCharger >= arriveTarget - 0.5);
    // Kan je vanaf een lader de bestemming halen (ook met max 100%), kies dan alleen uit die laders.
    const finishing = nextForced ? [] : feasible.filter((c) =>
      ((route.totalDistanceKm - c.routeKm) / fullRangeKm) * 100 + targetArrivalPercent <= 100);
    const pool = finishing.length > 0
      ? finishing.sort((x, y) => (x.routeKm - penalty(x)) - (y.routeKm - penalty(y)) )  // dichtstbij-de-start die nog kan finishen = minst laden
      : (comfy.length > 0 ? comfy : feasible.length > 0 ? feasible : candidates)
          .sort((x, y) => (y.routeKm - penalty(y)) - (x.routeKm - penalty(x)));
    // Bij finishing: kies de lader waarvandaan de bestemming het best haalbaar is (verst = minder laden).
    const best: Candidate = preferNearestCharger && feasible.length > 0
      ? [...feasible].sort((a, b) => a.distanceTravelled - b.distanceTravelled)[0]
      : (finishing.length > 0 ? pool[pool.length - 1] : pool[0]);

    const distToDestFromCharger = route.totalDistanceKm - best.routeKm;
    const needForDest = (distToDestFromCharger / fullRangeKm) * 100 + targetArrivalPercent;
    const userTarget = Math.min(100, Math.max(chargeTargetPercent, typeof minChargeTargetPercent === 'number' ? minChargeTargetPercent : 0));
    let batteryAfter: number;
    if (!nextForced && needForDest <= 100) {
      // Laatste lading: alleen tot wat nodig is om met het gewenste % op de bestemming te komen.
      batteryAfter = Math.ceil(needForDest) + 1;
    } else {
      // Tussenstop: normaal tot het ingestelde percentage. Ligt de verst haalbare volgende lader
      // dichterbij, dan alleen tot wat nodig is. Is er met het ingestelde % geen lader haalbaar
      // (groot gat, bv. Baltische staten), dan uitzonderlijk hoger laden.
      const limitKm = nextForced ? nextForced.routeKm : Infinity;
      const nextOptions: { km: number; need: number }[] = [];
      for (const c of nearChargers) {
        const pos = posMap.get(c)!;
        const km = pos.km;
        if (km <= best.routeKm + 20 || km >= limitKm) continue;
        const need = ((km - best.routeKm + pos.detour) / fullRangeKm) * 100 + arriveTarget;
        nextOptions.push({ km, need });
      }
      if (nextForced) {
        nextOptions.push({ km: nextForced.routeKm, need: ((nextForced.routeKm - best.routeKm) / fullRangeKm) * 100 + minSafetyPercent + 2 });
      }
      const withinTarget = nextOptions.filter((o) => o.need <= userTarget);
      if (withinTarget.length > 0) {
        const farthest = withinTarget.reduce((m, o) => (o.km > m.km ? o : m));
        batteryAfter = Math.ceil(farthest.need) + 1;
        // Dichtbij het ingestelde % → gewoon tot het ingestelde % laden.
        if (userTarget - batteryAfter < 15) batteryAfter = userTarget;
      } else {
        const reachable = nextOptions.filter((o) => o.need <= 100);
        const farthest = reachable.length > 0 ? reachable.reduce((m, o) => (o.km > m.km ? o : m)) : null;
        batteryAfter = farthest ? Math.ceil(farthest.need) + 1 : 100;
      }
    }
    batteryAfter = Math.min(100, Math.max(batteryAfter, Math.round(best.batteryAtCharger) + 1));

    const rawChargerKw = ccsBlocked ? (v2SpeedKw(best.charger) ?? 120) : parseMaxSpeed(best.charger.stallTypes, best.charger.maxSpeedKw, best.charger.chargerConfigs);
    const chargerSpeedKw = effectiveChargeSpeedKw(rawChargerKw, modelName, carMaxKwOverride);
    const batteryKWh = batteryCapacityKWhOverride || teslaBatteryKWh[modelName] || 79;
    const chargeDurationMin = calculateChargeDuration(
      Math.round(Math.max(minSafetyPercent, best.batteryAtCharger)),
      Math.round(batteryAfter),
      batteryKWh,
      chargerSpeedKw,
      modelName,
      carMaxKwOverride
    );


    const batteryBeforeRounded = Math.round(Math.max(minSafetyPercent, best.batteryAtCharger));
    stops.push({
      charger: best.charger,
      batteryBefore: batteryBeforeRounded,
      batteryAfter: Math.round(batteryAfter),
      distanceFromStart: Math.round(best.routeKm),
      chargeDurationMin,
      energyUsedKWh: Math.round((best.distanceTravelled / 100) * (consumptionKWh100 || (kWhPerPercent * 100) / Math.max(1, fullRangeKm) * 100) * 10) / 10,
      energyChargedKWh: Math.round(Math.max(0, Math.round(batteryAfter) - batteryBeforeRounded) * kWhPerPercent * 10) / 10,
      stopNumber: stops.length + 1,
      etaMinFromStart: Math.round(elapsedMin + best.distanceTravelled / kmPerMin),
    });

    elapsedMin += best.distanceTravelled / kmPerMin + chargeDurationMin;

    currentPositionKm = best.routeKm;
    currentBattery = batteryAfter;
  }

  const finalRemaining = route.totalDistanceKm - currentPositionKm;
  const arrivalBattery = Math.max(0, currentBattery - (finalRemaining / fullRangeKm) * 100);
  if (arrivalBattery < 0) {
    return {
      stops,
      arrivalPercent: 0,
      unreachable: true,
      reason: 'Niet genoeg energie om de bestemming te bereiken',
      suggestions: buildSuggestions({ chargeTargetPercent, batteryPercent }),
    };
  }
  stops.forEach((stop, idx) => { stop.stopNumber = idx + 1; });
  return { stops, arrivalPercent: Math.round(arrivalBattery), unreachable: false };
}




function findNextChargerDistance(
  currentRouteKm: number,
  currentCharger: Supercharger,
  allChargers: Supercharger[],
  routeCoords: [number, number][],
  routeDist: number[]
): number | null {
  let nextChargerRouteKm: number | null = null;
  let minDetour = Infinity;
  for (const c of allChargers) {
    if (c.name === currentCharger.name && c.lat === currentCharger.lat) continue;
    const nearestIdx = findNearestCoordIndex(routeCoords, [c.lng, c.lat]);
    const chargerRouteKm = routeDist[nearestIdx];
    const detour = haversineDistance(
      routeCoords[nearestIdx][1], routeCoords[nearestIdx][0],
      c.lat, c.lng
    );
    if (chargerRouteKm > currentRouteKm + 20) {
      if (nextChargerRouteKm === null || chargerRouteKm < nextChargerRouteKm) {
        nextChargerRouteKm = chargerRouteKm;
        minDetour = detour;
      }
    }
  }
  if (nextChargerRouteKm === null) return null;
  return (nextChargerRouteKm - currentRouteKm) + minDetour;
}

function buildRouteDistanceIndex(routeCoords: [number, number][]): number[] {
  const dists: number[] = [0];
  for (let i = 1; i < routeCoords.length; i++) {
    const [aLng, aLat] = routeCoords[i - 1];
    const [bLng, bLat] = routeCoords[i];
    dists.push(dists[i - 1] + haversineDistance(aLat, aLng, bLat, bLng));
  }
  return dists;
}

function findNearestCoordIndex(routeCoords: [number, number][], target: [number, number]): number {
  let bestIndex = 0;
  let bestDist = Infinity;
  for (let i = 0; i < routeCoords.length; i++) {
    const d = haversineDistance(target[1], target[0], routeCoords[i][1], routeCoords[i][0]);
    if (d < bestDist) { bestDist = d; bestIndex = i; }
  }
  return bestIndex;
}

export function distanceToRoute(lat: number, lng: number, routeCoords: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < routeCoords.length - 1; i++) {
    const [aLng, aLat] = routeCoords[i];
    const [bLng, bLat] = routeCoords[i + 1];
    const d = pointToSegmentDistance(lat, lng, aLat, aLng, bLat, bLng);
    if (d < best) best = d;
  }
  return best;
}

export function projectOntoRoute(lat: number, lng: number, routeCoords: [number, number][]): { km: number; index: number } {
  const idx = findNearestCoordIndex(routeCoords, [lng, lat]);
  const dists = buildRouteDistanceIndex(routeCoords);
  return { km: dists[idx], index: idx };
}

export function getStatusColor(status: ChargerStatus): string {
  switch (status) {
    case 'Beschikbaar': return '#22c55e';
    case 'Druk': return '#f59e0b';
    case 'Werkzaamheden': return '#f59e0b';
    case 'In aanbouw': return '#3b82f6';
    case 'Onbekend': return '#64748b';
    case 'Niet beschikbaar': return '#94a3b8';
    case 'Langdurig gesloten': return '#94a3b8';
    case 'Voting': return '#3b82f6';
    case 'Plan': case 'Vergunning aangevraagd': return '#a855f7';
    case 'Wordt uitgebreid': return '#22c55e';
    case 'Permanent gesloten': return '#0f172a';
    default: return '#ef4444';
  }
}

export const lifecycleLabels: Record<ChargerLifecycleStatus, string> = {
  operational: 'In bedrijf',
  construction: 'In aanbouw',
  works: 'Werkzaamheden (deels open)',
  works_closed: 'Dicht door werkzaamheden',
  temp_closed: 'Tijdelijk gesloten',
  long_closed: 'Langdurig gesloten',
  voting: 'Voting',
  plan: 'Plan',
  permit: 'Vergunning aangevraagd',
  expanding: 'Wordt uitgebreid',
  permanent_closed: 'Permanent gesloten',
  unknown: 'Onbekend',
};

export const stallConditionLabels: Record<string, string> = {
  available: 'Beschikbaar',
  defect: 'Defect',
  blocked: 'Geblokkeerd',
  maintenance: 'Onderhoud',
  other: 'Andere reden',
};

/** Snelheid van de V2-laadplekken (voor Model S/X zonder CCS-adapter). */
export function v2SpeedKw(charger: Supercharger): number | null {
  const v2 = getChargerConfigs(charger).filter((c) => String(c.version).toUpperCase() === 'V2');
  if (v2.length === 0) return hasV2Stalls(charger) ? Math.min(150, charger.maxSpeedKw ?? 150) : null;
  const speed = Math.max(...v2.map((c) => c.speedKw));
  return charger.maxSpeedKw && charger.maxSpeedKw > 0 ? Math.min(speed, charger.maxSpeedKw) : speed;
}

/** Heeft deze locatie V2-laadplekken? */
export function hasV2Stalls(charger: Supercharger): boolean {
  const configs = getChargerConfigs(charger);
  if (configs.length > 0) return configs.some((c) => String(c.version).toUpperCase() === 'V2');
  return (charger.versions ?? []).some((v) => String(v).toUpperCase() === 'V2');
}

/** Laadplekken die nu (nog) buiten gebruik zijn volgens de admin. */
export function getActiveStallIssues(charger: Supercharger, atDate: Date = new Date()) {
  return (charger.stallStates ?? []).filter((s) => {
    if (!s || s.condition === 'available') return false;
    if (s.until) { const t = new Date(s.until).getTime(); if (!isNaN(t) && t <= atDate.getTime()) return false; }
    return true;
  });
}

const PERMANENT_VISIBLE_MS = 14 * 24 * 3600 * 1000;

/** Hoort deze lader op de normale kaart? (verborgen of >14 dagen permanent gesloten = nee) */
export function isVisibleOnMap(charger: Supercharger, now: number = Date.now()): boolean {
  if (charger.hidden) return false;
  if (charger.status === 'permanent_closed') {
    const t = charger.permanentlyClosedAt ? new Date(charger.permanentlyClosedAt).getTime() : NaN;
    if (!isNaN(t) && now - t > PERMANENT_VISIBLE_MS) return false;
  }
  return true;
}

export const constructionProgressLabels: Record<string, string> = {
  planned: 'Gepland',
  permit: 'Vergunning aangevraagd',
  groundwork: 'Grondwerk bezig',
  cabling: 'Kabels & aansluiting',
  installing: 'Laders plaatsen',
  testing: 'Testfase',
};

/** Kan deze lader daadwerkelijk gebruikt worden in een route? */
export function isChargerUsable(charger: Supercharger, atDate: Date = new Date()): boolean {
  const status = charger.status ?? 'operational';
  if (status !== 'operational' && status !== 'works') return false;
  return isChargerOperationalAt(charger, atDate);
}

/** Totaal aantal laadplekken (configs of legacy veld). */
export function getTotalStalls(charger: Supercharger): number {
  return getTotalStallsFromConfigs(charger.chargerConfigs) ?? charger.totalStalls ?? 0;
}

/** Laadplekken die buiten gebruik zijn door werkzaamheden. */
export function getOutOfServiceStalls(charger: Supercharger): number {
  const works = charger.works || {};
  const fromConfigs = getTotalStallsFromConfigs(works.closedConfigs);
  if (fromConfigs !== undefined) return fromConfigs;
  return works.closedStalls ?? 0;
}

/** Aantal laadplekken dat nu open is (rekening houdend met werkzaamheden). */
export function getOpenStalls(charger: Supercharger, atDate: Date = new Date()): number {
  const total = getTotalStalls(charger);
  const status = charger.status ?? 'operational';
  const issues = getActiveStallIssues(charger, atDate).length;
  if (status === 'works') {
    const openConfigs = getTotalStallsFromConfigs(charger.works?.openConfigs);
    const base = openConfigs !== undefined ? Math.min(total, openConfigs) : Math.max(0, total - getOutOfServiceStalls(charger));
    return Math.max(0, base - issues);
  }
  if (status === 'operational' || status === 'expanding') return Math.max(0, total - issues);
  return 0;
}

/** "32 totaal · 20 buiten gebruik · 12 beschikbaar" */
export function formatStallAvailability(charger: Supercharger): string {
  const total = getTotalStalls(charger);
  const open = getOpenStalls(charger);
  const closed = Math.max(0, total - open);
  if (closed === 0) return `${total} laadplekken beschikbaar`;
  return `${open} / ${total} beschikbaar`;
}


export function formatDateNl(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (isNaN(date.getTime())) return value;
  return date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Korte statusregels voor popup/lijst, in tekst. */
export function describeChargerStatus(charger: Supercharger): string[] {
  const status = charger.status ?? 'operational';
  const lines: string[] = [];
  if (status === 'construction') {
    const c = charger.construction || {};
    lines.push('In aanbouw');
    if (c.plannedStalls) lines.push(`Komt: ${c.plannedStalls} laders${c.version ? ` ${c.version}` : ''}${c.speedKw ? ` ${c.speedKw}kW` : ''}`);
    if (c.progress) lines.push(`Voortgang: ${constructionProgressLabels[c.progress] ?? c.progress}`);
    if (c.steps && c.steps.length > 0) {
      lines.push(`Klaar: ${c.steps.map((s) => constructionStepLabels[s] ?? s).join(', ')}`);
    }
    if (c.expectedOpenMonth) lines.push(`Verwacht open: ${c.expectedOpenMonth}`);
    else if (c.expectedOpen) lines.push(`Verwacht open: ${formatDateNl(c.expectedOpen)}`);
    if (c.notes) lines.push(c.notes);
  } else if (status === 'works' || status === 'works_closed') {
    const w = charger.works || {};
    lines.push(status === 'works' ? 'Werkzaamheden — deels open' : 'Dicht door werkzaamheden');
    if (status === 'works') lines.push(formatStallAvailability(charger));
    if (w.reason) lines.push(`Reden: ${w.reason}`);
    if (w.expectedEnd) lines.push(`Klaar rond: ${formatDateNl(w.expectedEnd)}`);
    if (w.notes) lines.push(w.notes);
  } else if (status === 'voting') {
    lines.push('Tesla Voting');
    if (charger.voting?.votes) lines.push(`Stemmen: ${charger.voting.votes}`);
    if (charger.voting?.rank) lines.push(`Rang: #${charger.voting.rank}`);
  } else if (status === 'plan' || status === 'permit') {
    lines.push(status === 'plan' ? 'Gepland' : 'Vergunning aangevraagd');
  } else if (status === 'permanent_closed') {
    lines.push('Permanent gesloten');
    if (charger.permanentlyClosedAt) lines.push(`Gesloten sinds ${formatDateNl(charger.permanentlyClosedAt)}`);
  } else if (status === 'temp_closed' || status === 'long_closed') {
    const c = charger.closure || {};
    lines.push(status === 'temp_closed' ? 'Tijdelijk gesloten' : 'Langdurig gesloten');
    if (c.reason) lines.push(`Reden: ${c.reason}`);
    // Heropendatum is bewust alleen intern (admin) — niet tonen op de kaart.
    if (c.notes) lines.push(c.notes);
  }

  if (status === 'operational' || status === 'expanding' || status === 'works') {
    const issues = getActiveStallIssues(charger);
    const total = getTotalStalls(charger);
    if (issues.length > 0 && total > 0) {
      lines.push(`${getOpenStalls(charger)} / ${total} beschikbaar`);
      for (const i of issues) lines.push(`${i.name ? `${i.name} ` : ''}Dicht${i.version ? ` (${i.version}${i.speedKw ? ` ${i.speedKw}kW` : ''})` : ''}, reden: ${stallConditionLabels[i.condition] ?? i.condition}${i.note ? ` — ${i.note}` : ''}`);
    }
  }
  if (lines.length === 0 && status === 'expanding') lines.push('Wordt uitgebreid');

  const upgrade = charger.plannedUpgrade;
  if (upgrade && (upgrade.label || (upgrade.toConfigs && upgrade.toConfigs.length > 0))) {
    const from = (upgrade.fromConfigs ?? []).map(formatChargerConfig).join(' + ');
    const to = (upgrade.toConfigs ?? []).map(formatChargerConfig).join(' + ');
    if (from && to) lines.push(`Wordt aangepast: ${from} → ${to}`);
    else if (upgrade.label) lines.push(`Wordt aangepast: ${upgrade.label}`);
    if (upgrade.expected) lines.push(`Verwacht: ${upgrade.expected}`);
  }
  if (charger.lowSpeed) lines.push('Lage laadsnelheid');
  return lines;
}

export function matchesChargerFilters(charger: Supercharger, filters: ChargerFilterState): boolean {
  const status = charger.status ?? 'operational';
  if (!filters.statuses.includes(status)) return false;
  if (filters.minSpeedKw > 0 && parseMaxSpeed(charger.stallTypes, charger.maxSpeedKw, charger.chargerConfigs) < filters.minSpeedKw) return false;
  if (filters.versions.length > 0) {
    const versions = getChargerConfigs(charger).map((c) => c.version);
    if (!filters.versions.some((v) => versions.includes(v))) return false;
  }
  if (filters.trailerOnly && !charger.trailerFriendly) return false;
  if (filters.lowSpeedOnly && !charger.lowSpeed) return false;
  if (filters.ownerId && charger.ownerId !== filters.ownerId) return false;
  const stalls = getTotalStalls(charger);
  if (filters.exactStalls !== null && filters.exactStalls > 0) {
    if (stalls !== filters.exactStalls) return false;
  } else {
    if (filters.minStalls > 0 && stalls < filters.minStalls) return false;
    if (filters.maxStalls > 0 && stalls > filters.maxStalls) return false;
  }
  if (filters.noGarage && charger.inParkingGarage) return false;
  if (filters.noParkingFee && charger.parkingFee) return false;
  if (filters.openNow && !isChargerUsable(charger)) return false;
  if (filters.country && (charger.country || '').toLowerCase() !== filters.country.toLowerCase()) return false;
  if (filters.search) {
    const needle = filters.search.toLowerCase();
    const haystack = `${charger.name} ${charger.city ?? ''} ${charger.province ?? ''} ${charger.country ?? ''} ${charger.ownerName ?? ''}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}



/** Verwacht dat de laadsnelheid verborgen blijft (bouwlocatie zonder bekende gegevens). */
export function shouldHideSpeed(charger: Supercharger): boolean {
  // Geen aantal laadplekken ingesteld → ook geen laadsnelheid tonen.
  if (!getTotalStalls(charger)) return true;
  if (charger.status !== 'construction') return false;
  const info = charger.construction ?? {};
  if (info.dataUnknown) return true;
  const configs = info.configs ?? [];
  return configs.length === 0 && !info.speedKw;
}

/** Verdeel een routelijn in maximaal `count` gelijkmatig verdeelde punten. */
export function sampleRoutePoints(coords: [number, number][], count = 60): [number, number][] {
  if (coords.length <= count) return coords;
  const step = (coords.length - 1) / (count - 1);
  const out: [number, number][] = [];
  for (let i = 0; i < count; i++) out.push(coords[Math.round(i * step)]);
  return out;
}

/**
 * Extra/minder verbruik door hoogteverschil.
 * Klimmen kost energie, dalen levert (deels) energie terug via regeneratie.
 */
export function elevationConsumptionMultiplier(
  elevations: number[],
  distanceKm: number,
  massKg = 2100
): { multiplier: number; ascentM: number; descentM: number } {
  let ascentM = 0;
  let descentM = 0;
  for (let i = 1; i < elevations.length; i++) {
    const delta = elevations[i] - elevations[i - 1];
    if (delta > 2) ascentM += delta;
    else if (delta < -2) descentM += -delta;
  }
  if (distanceKm <= 0) return { multiplier: 1, ascentM, descentM };
  // kWh potentiële energie per meter hoogte, inclusief rendement.
  const kWhPerMeter = (massKg * 9.81) / 3_600_000;
  const climbKWh = ascentM * kWhPerMeter / 0.85;
  const regenKWh = descentM * kWhPerMeter * 0.65;
  const baselineKWh = distanceKm * 0.17;
  const multiplier = (baselineKWh + climbKWh - regenKWh) / baselineKWh;
  return { multiplier: Math.min(1.6, Math.max(0.8, multiplier)), ascentM: Math.round(ascentM), descentM: Math.round(descentM) };
}

/** Haalt hoogtes op via de gratis Open-Meteo elevation API (geen sleutel nodig). */
export async function fetchElevationProfile(coords: [number, number][]): Promise<number[] | null> {
  try {
    const pts = sampleRoutePoints(coords, 90);
    const lat = pts.map((p) => p[1].toFixed(4)).join(',');
    const lng = pts.map((p) => p[0].toFixed(4)).join(',');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const json = (await res.json()) as { elevation?: number[] };
    return Array.isArray(json.elevation) ? json.elevation : null;
  } catch {
    return null;
  }
}

/** Ligt dit punt binnen `radiusKm` van de route (hemelsbreed t.o.v. de weg)? */
export function passesCorridor(
  coords: [number, number][],
  point: { lat: number; lng: number; radiusKm: number }
): boolean {
  return distanceToRoute(point.lat, point.lng, coords) <= point.radiusKm;
}
