import { Supercharger, ChargingStop, ChargerStatus, RouteResult, teslaBatteryKWh } from './tesla-types';

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

export function getAvailableRange(modelRangeKm: number, batteryPercent: number, trailerMode: boolean, winterMode: boolean = false): number {
  let range = modelRangeKm * batteryPercent / 100;
  if (trailerMode) range *= 0.75;
  if (winterMode) range *= 0.80;
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

export function calculateChargingStops(
  route: RouteResult,
  modelRangeKm: number,
  batteryPercent: number,
  trailerMode: boolean,
  chargers: Supercharger[],
  modelName: string = 'Model 3 Long Range AWD',
  targetArrivalPercent: number = 10,
  winterMode: boolean = false,
  chargeTargetPercent: number = 80
): { stops: ChargingStop[]; arrivalPercent: number; unreachable: boolean; reason?: string } {
  const stops: ChargingStop[] = [];
  const nearChargers = findChargersNearRoute(route.coordinates, chargers, 20);

  if (route.coordinates.length < 2) {
    return { stops: [], arrivalPercent: batteryPercent, unreachable: false };
  }

  const routeDist = buildRouteDistanceIndex(route.coordinates);
  const minBatteryPercent = 1.5;

  if (nearChargers.length === 0) {
    const directRange = getAvailableRange(modelRangeKm, batteryPercent, trailerMode, winterMode);
    if (route.totalDistanceKm <= directRange) {
      const batteryAtDest = batteryPercent - (route.totalDistanceKm / getAvailableRange(modelRangeKm, 100, trailerMode, winterMode) * 100);
      return { stops: [], arrivalPercent: Math.round(Math.max(0, batteryAtDest)), unreachable: false };
    }
    return { stops: [], arrivalPercent: 0, unreachable: true, reason: 'Geen Superchargers gevonden langs de route' };
  }

  let currentBattery = batteryPercent;
  let currentPositionKm = 0;

  const maxIterations = 50;
  let iterations = 0;

  while (currentPositionKm < route.totalDistanceKm && iterations < maxIterations) {
    iterations++;

    const remainingToDest = route.totalDistanceKm - currentPositionKm;
    const rangeAtCurrent = getAvailableRange(modelRangeKm, currentBattery, trailerMode, winterMode);

    const batteryNeededForDest = (remainingToDest / getAvailableRange(modelRangeKm, 100, trailerMode, winterMode)) * 100 + targetArrivalPercent;
    if (currentBattery >= batteryNeededForDest) {
      const arrivalBattery = Math.max(0, currentBattery - (remainingToDest / getAvailableRange(modelRangeKm, 100, trailerMode, winterMode)) * 100);
      stops.forEach((stop, idx) => { stop.stopNumber = idx + 1; });
      return { stops, arrivalPercent: Math.round(arrivalBattery), unreachable: false };
    }

    const usableRange = rangeAtCurrent * ((currentBattery - minBatteryPercent) / currentBattery);

    const candidates: Array<{
      charger: Supercharger;
      routeKm: number;
      detourKm: number;
      distanceToCharger: number;
      batteryAtCharger: number;
    }> = [];

    for (const c of nearChargers) {
      const chargerCoord: [number, number] = [c.lng, c.lat];
      const nearestIdx = findNearestCoordIndex(route.coordinates, chargerCoord);
      const chargerRouteKm = routeDist[nearestIdx];
      const distFromRoute = haversineDistance(
        route.coordinates[nearestIdx][1], route.coordinates[nearestIdx][0],
        c.lat, c.lng
      );

      if (chargerRouteKm <= currentPositionKm + 1) continue;

      const distanceToCharger = chargerRouteKm - currentPositionKm + distFromRoute * 2;

      if (distanceToCharger > usableRange) continue;

      const batteryConsumed = (distanceToCharger / getAvailableRange(modelRangeKm, 100, trailerMode, winterMode)) * 100;
      const batteryAtCharger = Math.max(minBatteryPercent, currentBattery - batteryConsumed);

      candidates.push({
        charger: c,
        routeKm: chargerRouteKm,
        detourKm: distFromRoute,
        distanceToCharger,
        batteryAtCharger,
      });
    }

    if (candidates.length === 0) {
      if (rangeAtCurrent >= remainingToDest) {
        const arrivalBattery = Math.max(0, currentBattery - (remainingToDest / getAvailableRange(modelRangeKm, 100, trailerMode, winterMode)) * 100);
        stops.forEach((stop, idx) => { stop.stopNumber = idx + 1; });
        return { stops, arrivalPercent: Math.round(arrivalBattery), unreachable: false };
      }
      return { stops, arrivalPercent: 0, unreachable: true, reason: 'Geen bereikbare Supercharger binnen actieradius' };
    }

    candidates.sort((a, b) => b.routeKm - a.routeKm);

    const best = candidates[0];

    const nextChargerDist = findNextChargerDistance(
      best.routeKm,
      best.charger,
      nearChargers,
      route.coordinates
    );

    const distToDestFromCharger = route.totalDistanceKm - best.routeKm;
    const nextLegDistance = nextChargerDist !== null ? nextChargerDist : distToDestFromCharger;

    const batteryNeededForNextLeg = (nextLegDistance / getAvailableRange(modelRangeKm, 100, trailerMode, winterMode)) * 100;

    let minBatteryNeeded: number;

    if (nextChargerDist !== null) {
      minBatteryNeeded = minBatteryPercent + batteryNeededForNextLeg + 2;
    } else {
      minBatteryNeeded = batteryNeededForNextLeg + targetArrivalPercent;
    }

    let batteryAfter: number;

    if (minBatteryNeeded <= chargeTargetPercent) {
      batteryAfter = Math.ceil(minBatteryNeeded);
    } else {
      batteryAfter = Math.ceil(minBatteryNeeded);
    }

    batteryAfter = Math.min(100, batteryAfter);

    const chargerSpeedKw = parseMaxSpeed(best.charger.stallTypes);
    const batteryKWh = teslaBatteryKWh[modelName] || 79;
    const chargeDurationMin = calculateChargeDuration(
      Math.round(best.batteryAtCharger),
      Math.round(batteryAfter),
      batteryKWh,
      chargerSpeedKw
    );

    stops.push({
      charger: best.charger,
      batteryBefore: Math.round(best.batteryAtCharger),
      batteryAfter: Math.round(batteryAfter),
      distanceFromStart: Math.round(best.routeKm),
      chargeDurationMin,
      stopNumber: stops.length + 1,
    });

    currentPositionKm = best.routeKm;
    currentBattery = batteryAfter;
  }

  const finalRemaining = route.totalDistanceKm - currentPositionKm;
  const arrivalBattery = Math.max(0, currentBattery - (finalRemaining / getAvailableRange(modelRangeKm, 100, trailerMode, winterMode)) * 100);

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
  routeCoords: [number, number][]
): number | null {
  const routeDistCopy = buildRouteDistanceIndex(routeCoords);
  let nextChargerRouteKm: number | null = null;
  let minDetour = Infinity;

  for (const c of allChargers) {
    if (c.name === currentCharger.name && c.lat === currentCharger.lat) continue;

    const nearestIdx = findNearestCoordIndex(routeCoords, [c.lng, c.lat]);
    const chargerRouteKm = routeDistCopy[nearestIdx];
    const detour = haversineDistance(
      routeCoords[nearestIdx][1], routeCoords[nearestIdx][0],
      c.lat, c.lng
    );

    if (chargerRouteKm > currentRouteKm + 5) {
      if (nextChargerRouteKm === null || chargerRouteKm < nextChargerRouteKm) {
        nextChargerRouteKm = chargerRouteKm;
        minDetour = detour;
      }
    }
  }

  if (nextChargerRouteKm === null) return null;
  return (nextChargerRouteKm - currentRouteKm) + minDetour * 2;
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

export function getStatusColor(status: ChargerStatus): string {
  switch (status) {
    case 'Beschikbaar': return '#22c55e';
    case 'Druk': return '#f59e0b';
    case 'Vol': return '#ef4444';
    case 'Onbekend': return '#64748b';
  }
}
