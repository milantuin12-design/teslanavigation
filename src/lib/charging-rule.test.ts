import { describe, it, expect } from 'vitest';
import { calculateChargingStops } from './tesla-utils';
import type { RouteResult, Supercharger } from './tesla-types';

// Rechte lijn langs de evenaar: 1 graad lengte ≈ 111,2 km.
const KM_PER_DEG = 111.195;
function line(totalKm: number): RouteResult {
  const coords: [number, number][] = [];
  for (let km = 0; km <= totalKm; km += 5) coords.push([km / KM_PER_DEG, 0]);
  return { coordinates: coords, totalDistanceKm: totalKm, totalTimeMin: totalKm / 1.5 } as RouteResult;
}
const charger = (km: number): Supercharger => ({
  id: `c${km}`, name: `SC ${km}`, lat: 0, lng: km / KM_PER_DEG, status: 'operational', published: true, maxSpeedKw: 250, totalStalls: 8,
} as Supercharger);

// 100 kWh, 20 kWh/100km → 500 km bereik → 1% = 5 km.
const base = {
  modelRangeKm: 500, batteryPercent: 90, trailerReductionPercent: 0, usableBatteryKWh: 100, consumptionKWh100: 20,
  targetArrivalPercent: 10, maxArrivalAtChargerPercent: 10, chargeTargetPercent: 80, minSafetyPercent: 3,
};

describe('laadregel', () => {
  it('laadt bij een tussenstop normaal tot het ingestelde percentage', () => {
    const chargers = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200].map(charger);
    const r = calculateChargingStops(line(1500), { ...base, chargers });
    expect(r.unreachable).toBe(false);
    expect(r.stops[0].batteryAfter).toBe(80);
  });

  it('laadt bij de laatste stop alleen tot wat nodig is voor het aankomstpercentage', () => {
    const chargers = [350].map(charger);
    const r = calculateChargingStops(line(500), { ...base, chargers });
    // Vanaf 350 km nog 150 km = 30% + 10% aankomst ≈ 41%.
    expect(r.stops).toHaveLength(1);
    expect(r.stops[0].batteryAfter).toBeLessThanOrEqual(42);
  });

  it('laadt niet verder dan nodig als de volgende lader dichterbij ligt', () => {
    // Vanaf 400 km is de volgende haalbare lader op 600 km (200 km = 40% + 10%).
    const chargers = [400, 600, 1000].map(charger);
    const r = calculateChargingStops(line(1200), { ...base, chargers });
    expect(r.stops[0].batteryAfter).toBeLessThan(60);
  });

  it('laadt uitzonderlijk boven het ingestelde percentage bij een groot gat', () => {
    // Na 350 km pas weer een lader op 800 km (450 km = 90% + 10%).
    const chargers = [350, 800].map(charger);
    const r = calculateChargingStops(line(1100), { ...base, chargers });
    expect(r.unreachable).toBe(false);
    expect(r.stops[0].batteryAfter).toBeGreaterThan(80);
  });

  it('kiest de verst haalbare lader (zo min mogelijk stops)', () => {
    const chargers = [100, 150, 200, 250, 300, 350, 400].map(charger);
    const r = calculateChargingStops(line(700), { ...base, chargers });
    expect(r.stops).toHaveLength(1);
  });
});

import { v2SpeedKw } from './tesla-utils';
describe('Model S/X zonder CCS-adapter', () => {
  it('toont de snelheid van de V2-laders bij een gemengde locatie', () => {
    const c = { name: 'Mix', lat: 0, lng: 0, chargerConfigs: [{ count: 3, version: 'V3', speedKw: 250 }, { count: 7, version: 'V2', speedKw: 150 }] } as Supercharger;
    expect(v2SpeedKw(c)).toBe(150);
  });
});
