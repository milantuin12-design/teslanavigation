import { Supercharger, ChargingStop, ChargerStatus, RouteResult, WeatherMode, teslaBatteryKWh } from './tesla-types';

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

/**
 * Available range.
 * - trailerReductionPercent: 0-100, percentage reduction from trailer (default 0 = no trailer)
 * - weatherMode: summer (no penalty), winter (-20%), night (-5%)
 */
export function getAvailableRange(
  modelRangeKm: number,
  batteryPercent: number,
  trailerReductionPercent: number = 0,
  weatherMode: WeatherMode = 'summer'
): number {
  let range = modelRangeKm * batteryPercent / 100;
  if (trailerReductionPercent > 0) range *= (1 - trailerReductionPercent / 100);
  if (weatherMode === 'winter') range *= 0.80;
  else if (weatherMode === 'night') range *= 0.95;
  return range;
}

export function parseMaxSpeed(stallTypes?: string): number {
  if (!stallTypes) return 250;
  const speeds = stallTypes.match(/(\d+)kw/gi);
  if (!speeds || speeds.length === 0) {
    if (/v4/i.test(stallTypes)) return 250;
    if (/v3/i.test(stallTypes)) return 250;
    return 150;
  }
  return Math.max(...speeds.map(s => parseInt(s, 10)));
}

export function calculateChargeDuration(
  batteryBefore: number,
  batteryAfter: number,
  batteryCapacityKWh: number,
  chargerMaxSpeedKw: number
): number {
  const kwhNeeded = batteryCapacityKWh * (batteryAfter - batteryBefore) / 100;

  const midPoint = Math.min(batteryAfter, 50);
  const lowPhaseKwh = batteryCapacityKWh * (Math.min(midPoint, batteryAfter) - batteryBefore) / 100;
  const highPhaseKwh = Math.max(0, kwhNeeded - lowPhaseKwh);

  const lowPhaseHours = lowPhaseKwh / (chargerMaxSpeedKw * 0.70);
  const highPhaseHours = highPhaseKwh / (chargerMaxSpeedKw * 0.40);

  const totalHours = lowPhaseHours + highPhaseHours;
  return Math.max(5, Math.round(totalHours * 60));
}

export function getChargerStatus(charger: Supercharger): ChargerStatus {
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
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
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

export interface CalcChargingOptions {
  modelRangeKm: number;
  batteryPercent: number;
  trailerReductionPercent: number;
  chargers: Supercharger[];
  modelName?: string;
  targetArrivalPercent?: number;
  weatherMode?: WeatherMode;
  chargeTargetPercent?: number;
  minChargerSpeedKw?: number;
  /** Max battery % allowed when arriving at a charger (push to bigger stops). */
  maxArrivalAtChargerPercent?: number;
  /** Minimum safety battery % at charger arrival. */
  minSafetyPercent?: number;
}

/**
 * Distance-from-current-position to use when calculating closest distance
 * (excludes already-passed segments).
 */
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
    chargeTargetPercent = 80,
    minChargerSpeedKw = 0,
    maxArrivalAtChargerPercent = 10,
    minSafetyPercent = 3,
  } = opts;

  const stops: ChargingStop[] = [];

  if (route.coordinates.length < 2) {
    return { stops: [], arrivalPercent: batteryPercent, unreachable: false };
  }

  // Filter chargers by minimum speed
  const speedFilteredChargers = chargers.filter(
    c => parseMaxSpeed(c.stallTypes) >= minChargerSpeedKw
  );

  const nearChargers = findChargersNearRoute(route.coordinates, speedFilteredChargers, 20);

  const routeDist = buildRouteDistanceIndex(route.coordinates);
  const fullRangeKm = getAvailableRange(modelRangeKm, 100, trailerReductionPercent, weatherMode);

  if (nearChargers.length === 0) {
    const directRange = getAvailableRange(modelRangeKm, batteryPercent, trailerReductionPercent, weatherMode);
    if (route.totalDistanceKm <= directRange) {
      const batteryAtDest = batteryPercent - (route.totalDistanceKm / fullRangeKm * 100);
      return { stops: [], arrivalPercent: Math.round(Math.max(0, batteryAtDest)), unreachable: false };
    }
    return { stops: [], arrivalPercent: 0, unreachable: true, reason: 'Geen geschikte Superchargers gevonden langs de route' };
  }

  let currentBattery = batteryPercent;
  let currentPositionKm = 0;

  const maxIterations = 80;
  let iterations = 0;

  while (currentPositionKm < route.totalDistanceKm && iterations < maxIterations) {
    iterations++;

    const remainingToDest = route.totalDistanceKm - currentPositionKm;

    // Can we reach destination directly with arrival target buffer?
    const batteryNeededForDest = (remainingToDest / fullRangeKm) * 100 + targetArrivalPercent;
    if (currentBattery >= batteryNeededForDest) {
      const arrivalBattery = Math.max(0, currentBattery - (remainingToDest / fullRangeKm) * 100);
      stops.forEach((stop, idx) => { stop.stopNumber = idx + 1; });
      return { stops, arrivalPercent: Math.round(arrivalBattery), unreachable: false };
    }

    // Reachable distance from here, leaving minSafetyPercent in battery
    const usableRange = ((currentBattery - minSafetyPercent) / 100) * fullRangeKm;

    type Candidate = {
      charger: Supercharger;
      routeKm: number;
      detourKm: number;
      distanceTravelled: number;
      batteryAtCharger: number;
    };

    const candidates: Candidate[] = [];

    for (const c of nearChargers) {
      const nearestIdx = findNearestCoordIndex(route.coordinates, [c.lng, c.lat]);
      const chargerRouteKm = routeDist[nearestIdx];
      const distFromRoute = haversineDistance(
        route.coordinates[nearestIdx][1], route.coordinates[nearestIdx][0],
        c.lat, c.lng
      );

      // Charger must be at least 20km ahead so we don't 3x-stop in 80km
      if (chargerRouteKm <= currentPositionKm + 20) continue;

      const travelKm = (chargerRouteKm - currentPositionKm) + distFromRoute;
      if (travelKm > usableRange) continue;

      const batteryConsumed = (travelKm / fullRangeKm) * 100;
      const batteryAtCharger = currentBattery - batteryConsumed;

      candidates.push({
        charger: c,
        routeKm: chargerRouteKm,
        detourKm: distFromRoute,
        distanceTravelled: travelKm,
        batteryAtCharger,
      });
    }

    if (candidates.length === 0) {
      // Can't reach any charger but can we still reach destination?
      if (usableRange + minSafetyPercent / 100 * fullRangeKm >= remainingToDest) {
        const arrivalBattery = Math.max(0, currentBattery - (remainingToDest / fullRangeKm) * 100);
        stops.forEach((stop, idx) => { stop.stopNumber = idx + 1; });
        return { stops, arrivalPercent: Math.round(arrivalBattery), unreachable: false };
      }
      return { stops, arrivalPercent: 0, unreachable: true, reason: 'Geen bereikbare Supercharger binnen actieradius' };
    }

    // PREFER: charger where we arrive with ≤ maxArrivalAtChargerPercent (uses
    // most of the battery between stops -> fewest stops). If none meets that,
    // fall back to the farthest reachable charger.
    const goodCandidates = candidates.filter(c => c.batteryAtCharger <= maxArrivalAtChargerPercent);

    let best: Candidate;
    if (goodCandidates.length > 0) {
      // Among those, pick the farthest (closest to destination)
      goodCandidates.sort((a, b) => b.routeKm - a.routeKm);
      best = goodCandidates[0];
    } else {
      // Pick the farthest reachable
      candidates.sort((a, b) => b.routeKm - a.routeKm);
      best = candidates[0];
    }

    // Look ahead to determine how much we need to charge
    const nextChargerDist = findNextChargerDistance(
      best.routeKm,
      best.charger,
      nearChargers,
      route.coordinates,
      routeDist
    );

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

    // Charge to user's target unless next leg needs more
    let batteryAfter = Math.max(chargeTargetPercent, Math.ceil(minBatteryNeeded));
    batteryAfter = Math.min(100, batteryAfter);

    const chargerSpeedKw = parseMaxSpeed(best.charger.stallTypes);
    const batteryKWh = teslaBatteryKWh[modelName] || 79;
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

function findNearestCoordIndex(
  routeCoords: [number, number][],
  target: [number, number]
): number {
  let bestIndex = 0;
  let bestDist = Infinity;
  for (let i = 0; i < routeCoords.length; i++) {
    const d = haversineDistance(target[1], target[0], routeCoords[i][1], routeCoords[i][0]);
    if (d < bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/** Distance from a point to the nearest point on the route polyline (km). */
export function distanceToRoute(
  lat: number,
  lng: number,
  routeCoords: [number, number][]
): number {
  let best = Infinity;
  for (let i = 0; i < routeCoords.length - 1; i++) {
    const [aLng, aLat] = routeCoords[i];
    const [bLng, bLat] = routeCoords[i + 1];
    const d = pointToSegmentDistance(lat, lng, aLat, aLng, bLat, bLng);
    if (d < best) best = d;
  }
  return best;
}

/** Find index along route closest to position; returns km from start. */
export function projectOntoRoute(
  lat: number,
  lng: number,
  routeCoords: [number, number][]
): { km: number; index: number } {
  const idx = findNearestCoordIndex(routeCoords, [lng, lat]);
  const dists = buildRouteDistanceIndex(routeCoords);
  return { km: dists[idx], index: idx };
}

export function getStatusColor(status: ChargerStatus): string {
  switch (status) {
    case 'Beschikbaar': return '#22c55e';
    case 'Druk': return '#f59e0b';
    case 'Vol': return '#ef4444';
    case 'Onbekend': return '#64748b';
  }
}
