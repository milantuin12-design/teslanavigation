import { Supercharger, ChargingStop, ChargerStatus, RouteResult, WeatherMode, TimeMode, teslaBatteryKWh, teslaMaxChargeKw, ChargerConfig, OpeningHours, OpeningDayKey, ChargerLifecycleStatus, ChargerFilterState } from './tesla-types';

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
  if (configSpeed) return configSpeed;
  if (typeof maxSpeedKw === 'number' && maxSpeedKw > 0) return maxSpeedKw;
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


// Tesla-typische laadtijden op ~79 kWh accu.
// Cumulatieve minuten vanaf 0% naar elk 10%-punt, per laadsnelheid.
const CHARGE_CURVES: Record<number, number[]> = {
  125: [0, 5, 10, 15, 21, 28, 36, 45, 56, 71, 91],
  150: [0, 4, 8, 12, 17, 23, 30, 38, 48, 62, 81],
  250: [0, 3, 6, 10, 14, 19, 25, 32, 41, 54, 72],
};

function curveArrayForSpeed(speedKw: number): number[] {
  const s = Math.max(30, Math.min(400, speedKw || 150));
  if (s <= 125) return CHARGE_CURVES[125];
  if (s >= 250) return CHARGE_CURVES[250];
  let lo = 125, hi = 150;
  if (s > 150) { lo = 150; hi = 250; }
  const t = (s - lo) / (hi - lo);
  const a = CHARGE_CURVES[lo];
  const b = CHARGE_CURVES[hi];
  return a.map((v, i) => v + (b[i] - v) * t);
}

function curveMinutesAt(percent: number, speedKw: number): number {
  const curve = curveArrayForSpeed(speedKw);
  const p = Math.max(0, Math.min(100, percent));
  const idx = Math.floor(p / 10);
  const frac = (p - idx * 10) / 10;
  const a = curve[idx] ?? curve[curve.length - 1];
  const b = curve[Math.min(idx + 1, curve.length - 1)];
  return a + (b - a) * frac;
}

export function calculateChargeDuration(
  batteryBefore: number,
  batteryAfter: number,
  batteryCapacityKWh: number,
  chargerMaxSpeedKw: number
): number {
  if (batteryAfter <= batteryBefore) return 0;
  const base = Math.max(0, curveMinutesAt(batteryAfter, chargerMaxSpeedKw) - curveMinutesAt(batteryBefore, chargerMaxSpeedKw));
  const kwhScale = Math.max(0.7, batteryCapacityKWh / 79);
  return Math.max(1, Math.round(base * kwhScale));
}


export function isChargerOperationalAt(charger: Supercharger, atDate: Date = new Date()): boolean {
  return charger.isAvailable !== false && isChargerOpenAt(charger, atDate);
}

export function getChargerStatus(charger: Supercharger, atDate: Date = new Date()): ChargerStatus {
  const lifecycle = charger.status ?? 'operational';
  if (lifecycle === 'construction') return 'In aanbouw';
  if (lifecycle === 'works_closed') return 'Dicht door werkzaamheden';
  if (lifecycle === 'temp_closed') return 'Tijdelijk gesloten';
  if (lifecycle === 'long_closed') return 'Langdurig gesloten';
  if (charger.isAvailable === false) return 'Niet beschikbaar';
  if (!isChargerOpenAt(charger, atDate)) return 'Gesloten';
  if (lifecycle === 'works') return 'Werkzaamheden';
  if (charger.totalStalls === undefined || charger.occupiedStalls === undefined) return 'Onbekend';
  const available = charger.totalStalls - charger.occupiedStalls;
  if (available === 0) return 'Vol';
  if (available <= Math.ceil(charger.totalStalls * 0.25)) return 'Druk';
  return 'Beschikbaar';
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
  /** Time of departure — used to filter out chargers that are closed at arrival. */
  departureTime?: Date;
}

export function calculateChargingStops(
  route: RouteResult,
  opts: CalcChargingOptions
): { stops: ChargingStop[]; arrivalPercent: number; unreachable: boolean; reason?: string } {
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
    departureTime = new Date(),
  } = opts;


  const stops: ChargingStop[] = [];

  if (route.coordinates.length < 2) {
    return { stops: [], arrivalPercent: batteryPercent, unreachable: false };
  }

  let filtered = chargers.filter(c => {
    const lifecycle = c.status ?? 'operational';
    if (lifecycle !== 'operational' && lifecycle !== 'works') return false;
    if (c.isAvailable === false) return false;
    return parseMaxSpeed(c.stallTypes, c.maxSpeedKw, c.chargerConfigs) >= minChargerSpeedKw;
  });

  if (trailerOnly) filtered = filtered.filter(c => c.trailerFriendly);
  if (excludeParkingGarage) filtered = filtered.filter(c => !c.inParkingGarage);

  const nearChargers = findChargersNearRoute(route.coordinates, filtered, 20);
  const routeDist = buildRouteDistanceIndex(route.coordinates);
  const fullRangeKm = getAvailableRange(modelRangeKm, 100, trailerReductionPercent, weatherMode, timeMode);
  const kmPerMin = route.totalDistanceKm > 0 && route.totalTimeMin > 0
    ? route.totalDistanceKm / route.totalTimeMin
    : 1.5;

  if (nearChargers.length === 0) {
    const directRange = getAvailableRange(modelRangeKm, batteryPercent, trailerReductionPercent, weatherMode, timeMode);
    if (route.totalDistanceKm <= directRange) {
      const batteryAtDest = batteryPercent - (route.totalDistanceKm / fullRangeKm * 100);
      return { stops: [], arrivalPercent: Math.round(Math.max(0, batteryAtDest)), unreachable: false };
    }
    return { stops: [], arrivalPercent: 0, unreachable: true, reason: 'Geen geschikte Superchargers gevonden langs de route' };
  }

  let currentBattery = batteryPercent;
  let currentPositionKm = 0;
  let elapsedMin = 0;

  const maxIterations = 80;
  let iterations = 0;

  while (currentPositionKm < route.totalDistanceKm && iterations < maxIterations) {
    iterations++;
    const remainingToDest = route.totalDistanceKm - currentPositionKm;

    const batteryNeededForDest = (remainingToDest / fullRangeKm) * 100 + targetArrivalPercent;
    if (currentBattery >= batteryNeededForDest) {
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
      const nearestIdx = findNearestCoordIndex(route.coordinates, [c.lng, c.lat]);
      const chargerRouteKm = routeDist[nearestIdx];
      const distFromRoute = haversineDistance(
        route.coordinates[nearestIdx][1], route.coordinates[nearestIdx][0],
        c.lat, c.lng
      );
      if (chargerRouteKm <= currentPositionKm + 20) continue;
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
      if (usableRange + minSafetyPercent / 100 * fullRangeKm >= remainingToDest) {
        const arrivalBattery = Math.max(0, currentBattery - (remainingToDest / fullRangeKm) * 100);
        stops.forEach((stop, idx) => { stop.stopNumber = idx + 1; });
        return { stops, arrivalPercent: Math.round(arrivalBattery), unreachable: false };
      }
      return { stops, arrivalPercent: 0, unreachable: true, reason: 'Geen bereikbare Supercharger binnen actieradius (open op verwachte aankomsttijd)' };
    }

    const goodCandidates = candidates.filter(c => c.batteryAtCharger <= maxArrivalAtChargerPercent);
    let best: Candidate;
    if (goodCandidates.length > 0) {
      goodCandidates.sort((a, b) => scoreCandidate(b, preferTrailerFriendly) - scoreCandidate(a, preferTrailerFriendly));
      best = goodCandidates[0];
    } else {
      candidates.sort((a, b) => scoreCandidate(b, preferTrailerFriendly) - scoreCandidate(a, preferTrailerFriendly));
      best = candidates[0];
    }

    const nextChargerDist = findNextChargerDistance(best.routeKm, best.charger, nearChargers, route.coordinates, routeDist);
    const distToDestFromCharger = route.totalDistanceKm - best.routeKm;
    const useDestAsNext = nextChargerDist === null || nextChargerDist > distToDestFromCharger;
    const nextLegDistance = useDestAsNext ? distToDestFromCharger : nextChargerDist!;
    const batteryNeededForNextLeg = (nextLegDistance / fullRangeKm) * 100;

    let minBatteryNeeded: number;
    if (useDestAsNext) {
      minBatteryNeeded = batteryNeededForNextLeg + targetArrivalPercent;
    } else {
      minBatteryNeeded = batteryNeededForNextLeg + minSafetyPercent + 2;
    }
    const floor = typeof minChargeTargetPercent === 'number' ? minChargeTargetPercent : chargeTargetPercent;
    const cap = typeof maxChargeTargetPercent === 'number' ? maxChargeTargetPercent : 100;
    let batteryAfter = useDestAsNext
      ? Math.min(cap, Math.max(Math.ceil(minBatteryNeeded), floor))
      : Math.max(floor, Math.ceil(minBatteryNeeded));
    batteryAfter = Math.min(cap, Math.max(batteryAfter, Math.ceil(minBatteryNeeded)));
    batteryAfter = Math.min(100, batteryAfter);

    const rawChargerKw = parseMaxSpeed(best.charger.stallTypes, best.charger.maxSpeedKw, best.charger.chargerConfigs);
    const chargerSpeedKw = effectiveChargeSpeedKw(rawChargerKw, modelName, carMaxKwOverride);
    const batteryKWh = batteryCapacityKWhOverride || teslaBatteryKWh[modelName] || 79;
    const chargeDurationMin = calculateChargeDuration(
      Math.round(Math.max(minSafetyPercent, best.batteryAtCharger)),
      Math.round(batteryAfter),
      batteryKWh,
      chargerSpeedKw
    );


    stops.push({
      charger: best.charger,
      batteryBefore: Math.round(Math.max(minSafetyPercent, best.batteryAtCharger)),
      batteryAfter: Math.round(batteryAfter),
      distanceFromStart: Math.round(best.routeKm),
      chargeDurationMin,
      stopNumber: stops.length + 1,
    });

    elapsedMin += best.distanceTravelled / kmPerMin + chargeDurationMin;
    currentPositionKm = best.routeKm;
    currentBattery = batteryAfter;
  }

  const finalRemaining = route.totalDistanceKm - currentPositionKm;
  const arrivalBattery = Math.max(0, currentBattery - (finalRemaining / fullRangeKm) * 100);
  if (arrivalBattery < 0) {
    return { stops, arrivalPercent: 0, unreachable: true, reason: 'Niet genoeg bereik om bestemming te bereiken' };
  }
  stops.forEach((stop, idx) => { stop.stopNumber = idx + 1; });
  return { stops, arrivalPercent: Math.round(arrivalBattery), unreachable: false };
}

function scoreCandidate(candidate: { routeKm: number; detourKm: number; charger: Supercharger }, preferTrailerFriendly: boolean): number {
  const garagePenalty = candidate.charger.inParkingGarage ? -30 : 0;
  return candidate.routeKm - candidate.detourKm * 2 + (preferTrailerFriendly && candidate.charger.trailerFriendly ? 80 : 0) + garagePenalty;
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
};

export const constructionProgressLabels: Record<string, string> = {
  planned: 'Gepland',
  permit: 'Vergunning rond',
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
export function getOpenStalls(charger: Supercharger): number {
  const total = getTotalStalls(charger);
  const status = charger.status ?? 'operational';
  if (status === 'construction') return 0;
  if (status === 'works') {
    const openConfigs = getTotalStallsFromConfigs(charger.works?.openConfigs);
    if (openConfigs !== undefined) return Math.min(total, openConfigs);
    return Math.max(0, total - getOutOfServiceStalls(charger));
  }
  if (status === 'operational') return total;
  return 0;
}

/** "32 totaal · 20 buiten gebruik · 12 beschikbaar" */
export function formatStallAvailability(charger: Supercharger): string {
  const total = getTotalStalls(charger);
  const open = getOpenStalls(charger);
  const closed = Math.max(0, total - open);
  if (closed === 0) return `${total} laadplekken beschikbaar`;
  return `${total} totaal · ${closed} buiten gebruik · ${open} beschikbaar`;
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
  } else if (status === 'temp_closed' || status === 'long_closed') {
    const c = charger.closure || {};
    lines.push(status === 'temp_closed' ? 'Tijdelijk gesloten' : 'Langdurig gesloten');
    if (c.reason) lines.push(`Reden: ${c.reason}`);
    if (c.until) lines.push(`Tot: ${formatDateNl(c.until)}`);
    if (charger.reopenAt) lines.push(`Gaat weer open: ${formatDateNl(charger.reopenAt)}`);
    if (c.notes) lines.push(c.notes);
  }
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


