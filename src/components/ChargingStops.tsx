import { Zap, BatteryCharging, MapPin, Gauge, Clock, Ban, Edit3, Mountain, Thermometer, Wind, CloudRain, Car, Flag, Route as RouteIcon } from 'lucide-react';
import { useState } from 'react';
import type { ChargingStop, RouteResult } from '@/lib/tesla-types';
import type { RouteWeather } from '@/lib/energy';
import { parseMaxSpeed } from '@/lib/tesla-utils';

interface ChargingStopsProps {
  stops: ChargingStop[];
  totalDistanceKm: number | null;
  onBatteryChange?: (index: number, newBatteryAfter: number) => void;
  onRemoveCharger?: (index: number) => void;
  onArrivalChange?: (index: number, arrivalPercent: number) => void;
  departure?: Date;
  route?: RouteResult | null;
  packKWh?: number;
  consumptionKWh100?: number | null;
  arrivalPercent?: number | null;
  weather?: RouteWeather | null;
  elevation?: number[] | null;
  liveTraffic?: boolean;
}

function isWeekend(d: Date) { const day = d.getDay(); return day === 0 || day === 6; }

export function parkingCost(stop: ChargingStop, at?: Date): number | null {
  const c = stop.charger;
  if (!c.parkingFee) return null;
  // "alleen weekend" in de notitie/piekuren: doordeweeks gratis.
  const weekendOnly = /weekend/i.test(`${c.peakHours ?? ''} ${c.notes ?? ''}`) && /park/i.test(`${c.peakHours ?? ''} ${c.notes ?? ''}`);
  if (weekendOnly && at && !isWeekend(at)) return 0;
  if (typeof c.parkingFeeAmount === 'number' && c.parkingFeeAmount > 0) return c.parkingFeeAmount;
  const free = c.parkingFreeMinutes ?? 0;
  const perMin = c.parkingPerMinutes ?? 0;
  const perEuro = c.parkingPerEuro ?? 0;
  if (perMin > 0 && perEuro > 0) {
    const billable = Math.max(0, stop.chargeDurationMin - free);
    return Math.ceil(billable / perMin) * perEuro;
  }
  return null;
}

function chargingCost(stop: ChargingStop): number | null {
  const price = stop.charger.pricePerKwh;
  if (typeof price !== 'number' || price <= 0) return null;
  const kwh = stop.energyChargedKWh ?? 0;
  if (kwh <= 0) return null;
  return kwh * price;
}

const euro = (n: number) => `€ ${n.toFixed(2).replace('.', ',')}`;
const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}u${min % 60 ? ` ${min % 60}m` : ''}` : `${min}m`);
const time = (d: Date) => d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

/** Klimmen/dalen tussen twee posities (km) op basis van het gelijkmatig gesamplede hoogteprofiel. */
function climb(profile: number[] | null | undefined, totalKm: number, fromKm: number, toKm: number) {
  if (!profile || profile.length < 2 || totalKm <= 0) return null;
  const n = profile.length - 1;
  const a = Math.max(0, Math.min(n, Math.round((fromKm / totalKm) * n)));
  const b = Math.max(0, Math.min(n, Math.round((toKm / totalKm) * n)));
  let up = 0; let down = 0;
  for (let i = a + 1; i <= b; i++) {
    const d = profile[i] - profile[i - 1];
    if (d > 0) up += d; else down -= d;
  }
  return { up: Math.round(up), down: Math.round(down) };
}

function LegRow({ fromLabel, toLabel, km, kWh, rangeKm, from, to, climbInfo }: {
  fromLabel: string; toLabel: string; km: number; kWh: number | null; rangeKm: number | null; from: number; to: number;
  climbInfo: { up: number; down: number } | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-dashed border-white/10 px-3 py-2 text-[11px] text-slate-400">
      <span className="flex items-center gap-1 text-slate-300"><RouteIcon size={11} />{fromLabel} → {toLabel}</span>
      <span>{Math.round(km)} km</span>
      {kWh !== null && <span className="text-emerald-300">⚡ {kWh.toFixed(1)} kWh</span>}
      <span>🔋 {from}% → {to}%</span>
      {climbInfo && <span className="flex items-center gap-1"><Mountain size={11} />↑{climbInfo.up} m ↓{climbInfo.down} m</span>}
      {rangeKm !== null && <span className="text-blue-300">bereik ± {rangeKm} km</span>}
    </div>
  );
}

export default function ChargingStops({ stops, totalDistanceKm, onBatteryChange, onRemoveCharger, onArrivalChange, departure, route, packKWh, consumptionKWh100, arrivalPercent, weather, elevation, liveTraffic }: ChargingStopsProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState(80);
  const start = departure ?? new Date();
  const total = route?.totalDistanceKm ?? totalDistanceKm ?? 0;
  const k100 = consumptionKWh100 && consumptionKWh100 > 0 ? consumptionKWh100 : null;
  const fullRange = k100 && packKWh ? Math.round((packKWh / k100) * 100) : null;
  const totalKWh = k100 ? (total / 100) * k100 : null;
  const totalClimb = climb(elevation, total, 0, total);
  const totalChargeMin = stops.reduce((s, x) => s + x.chargeDurationMin, 0);
  const totalCost = stops.reduce((s, x) => s + (chargingCost(x) ?? 0) + (parkingCost(x, new Date(start.getTime() + (x.etaMinFromStart ?? 0) * 60000)) ?? 0), 0);
  const arrivalTime = route ? new Date(start.getTime() + (route.totalTimeMin + totalChargeMin) * 60000) : null;

  if (totalDistanceKm === null || !route) {
    if (stops.length === 0) return null;
  }

  const summary = route && (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-800/80 via-slate-900/80 to-blue-950/40 p-3 shadow-lg animate-fade-in">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Route-overzicht</div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-white/5 p-2"><div className="text-slate-400">Afstand</div><div className="text-sm font-semibold text-white">{Math.round(total)} km</div></div>
        <div className="rounded-lg bg-white/5 p-2"><div className="text-slate-400">Aankomst</div><div className="text-sm font-semibold text-white">{arrivalTime ? time(arrivalTime) : '–'}{typeof arrivalPercent === 'number' ? ` · ${arrivalPercent}%` : ''}</div></div>
        <div className="rounded-lg bg-white/5 p-2"><div className="text-slate-400">Verbruik</div><div className="text-sm font-semibold text-emerald-300">{totalKWh !== null ? `${totalKWh.toFixed(0)} kWh` : '–'}{k100 ? <span className="text-[11px] font-normal text-slate-400"> · {k100.toFixed(1)}/100km</span> : null}</div></div>
        <div className="rounded-lg bg-white/5 p-2"><div className="text-slate-400">Actieradius nu</div><div className="text-sm font-semibold text-blue-300">{fullRange !== null ? `${fullRange} km` : '–'}<span className="text-[11px] font-normal text-slate-400"> bij 100%</span></div></div>
        <div className="rounded-lg bg-white/5 p-2"><div className="text-slate-400">Laden</div><div className="text-sm font-semibold text-white">{stops.length} stop{stops.length === 1 ? '' : 's'} · {dur(totalChargeMin)}</div></div>
        <div className="rounded-lg bg-white/5 p-2"><div className="text-slate-400">Kosten</div><div className="text-sm font-semibold text-white">{totalCost > 0 ? euro(totalCost) : 'onbekend'}</div></div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-300">
        {totalClimb && <span className="flex items-center gap-1"><Mountain size={11} />↑ {totalClimb.up} m · ↓ {totalClimb.down} m (dalen = terugwinnen)</span>}
        {weather && <span className="flex items-center gap-1"><Thermometer size={11} />{Math.round(weather.tempC)}°C</span>}
        {weather && <span className="flex items-center gap-1"><Wind size={11} />{Math.round(weather.windMs * 3.6)} km/u{typeof weather.headwindMs === 'number' && weather.headwindMs > 1 ? ' tegenwind' : ''}</span>}
        {weather && (weather.precipitationMm > 0 || weather.snowfallCm > 0) && <span className="flex items-center gap-1"><CloudRain size={11} />{weather.snowfallCm > 0 ? `${weather.snowfallCm} cm sneeuw` : `${weather.precipitationMm.toFixed(1)} mm regen`}</span>}
        {weather && weather.fogFraction > 0.1 && <span>🌫️ mist op {Math.round(weather.fogFraction * 100)}%</span>}
        {liveTraffic ? (
          <span className={`flex items-center gap-1 ${(route.trafficDelayMin ?? 0) >= 20 ? 'text-red-400' : (route.trafficDelayMin ?? 0) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
            <Car size={11} />{(route.trafficDelayMin ?? 0) > 0 ? `+${route.trafficDelayMin} min files/werkzaamheden` : 'Geen files'}
            {route.trafficSegments?.length ? ` · ${route.trafficSegments.length} knelpunt${route.trafficSegments.length === 1 ? '' : 'en'}` : ''}
          </span>
        ) : <span className="text-slate-500">Files/werkzaamheden: niet meegerekend</span>}
      </div>
    </div>
  );

  if (stops.length === 0) {
    return (
      <div className="space-y-2 px-4 py-4">
        {summary}
        {route && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-400">
            <Zap size={16} /> Geen laadstops nodig
          </div>
        )}
      </div>
    );
  }

  // Rijstukken: start → stop 1 → … → bestemming
  const legs: { fromLabel: string; toLabel: string; fromKm: number; toKm: number; fromPct: number; toPct: number }[] = [];
  let prevKm = 0; let prevPct = stops[0].batteryBefore + Math.round(fullRange ? (stops[0].distanceFromStart / fullRange) * 100 : 0);
  let prevLabel = 'Start';
  stops.forEach((s, i) => {
    legs.push({ fromLabel: prevLabel, toLabel: `Stop ${i + 1}`, fromKm: prevKm, toKm: s.distanceFromStart, fromPct: Math.min(100, prevPct), toPct: s.batteryBefore });
    prevKm = s.distanceFromStart; prevPct = s.batteryAfter; prevLabel = `Stop ${i + 1}`;
  });
  legs.push({ fromLabel: prevLabel, toLabel: 'Bestemming', fromKm: prevKm, toKm: total, fromPct: prevPct, toPct: arrivalPercent ?? 0 });
  const legEl = (i: number) => {
    const l = legs[i];
    const km = Math.max(0, l.toKm - l.fromKm);
    return (
      <LegRow key={`leg-${i}`} fromLabel={l.fromLabel} toLabel={l.toLabel} km={km}
        kWh={k100 ? (km / 100) * k100 : null}
        rangeKm={fullRange ? Math.round((l.fromPct / 100) * fullRange) : null}
        from={l.fromPct} to={l.toPct} climbInfo={climb(elevation, total, l.fromKm, l.toKm)} />
    );
  };

  return (
    <div className="space-y-2 px-4 pb-5 pt-4">
      {summary}
      <h3 className="pt-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Laadstops & rijstukken</h3>
      {stops.map((stop, idx) => {
        const maxSpeedKw = parseMaxSpeed(stop.charger.stallTypes, stop.charger.maxSpeedKw, stop.charger.chargerConfigs);
        const isEditing = editingIndex === idx;
        const eta = typeof stop.etaMinFromStart === 'number' ? new Date(start.getTime() + stop.etaMinFromStart * 60000) : null;
        const park = parkingCost(stop, eta ?? undefined);
        const charge = chargingCost(stop);
        return (
          <div key={idx} className="space-y-2">
            {legEl(idx)}
            <div className="rounded-2xl border border-white/10 bg-slate-800/60 px-3 py-3 shadow-md transition-all hover:border-blue-500/40 animate-fade-in">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-white">{stop.charger.name}</div>
                  {eta && <div className="mt-0.5 text-[11px] text-blue-300">Aankomst ± {time(eta)} · vertrek ± {time(new Date(eta.getTime() + stop.chargeDurationMin * 60000))}</div>}
                </div>
                <span className="rounded-md bg-blue-600/20 px-2 py-0.5 text-[10px] font-semibold text-blue-300">Stop {idx + 1}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                <span className="flex items-center gap-1"><MapPin size={11} />{stop.distanceFromStart} km</span>
                <label className="flex items-center gap-1 text-slate-300" title="Gewenst percentage bij aankomst">
                  Aankomst
                  <input type="number" min={1} max={50} value={stop.batteryBefore}
                    onChange={(e) => onArrivalChange?.(idx, Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                    className="w-12 rounded border border-slate-600 bg-slate-700 px-1 py-0.5 text-xs text-white" />%
                </label>
                {isEditing ? (
                  <span className="flex items-center gap-1">
                    <input type="number" min={stop.batteryBefore + 5} max={100} value={editValue} onChange={(e) => setEditValue(parseInt(e.target.value) || 80)} className="w-14 rounded border border-slate-600 bg-slate-700 px-1.5 py-0.5 text-xs text-white" />%
                    <button onClick={() => { onBatteryChange?.(idx, editValue); setEditingIndex(null); }} className="rounded bg-green-600 px-1.5 py-0.5 text-[10px] text-white">OK</button>
                    <button onClick={() => setEditingIndex(null)} className="rounded bg-slate-600 px-1.5 py-0.5 text-[10px] text-white">Annuleer</button>
                  </span>
                ) : (
                  <span className="flex cursor-pointer items-center gap-1 hover:text-amber-300" onClick={() => { if (onBatteryChange) { setEditingIndex(idx); setEditValue(stop.batteryAfter); } }} title="Klik om aan te passen">
                    <BatteryCharging size={11} className="text-amber-400" />{stop.batteryBefore}% → {stop.batteryAfter}%{onBatteryChange && <Edit3 size={9} className="text-slate-500" />}
                  </span>
                )}
                <span className="flex items-center gap-1 text-green-400"><Clock size={11} />{dur(stop.chargeDurationMin)}</span>
                {maxSpeedKw > 0 && stop.charger.totalStalls ? <span className="flex items-center gap-1 text-blue-400"><Gauge size={11} />{maxSpeedKw} kW</span> : null}
                {typeof stop.energyChargedKWh === 'number' && <span className="text-emerald-300">+{stop.energyChargedKWh} kWh</span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                {typeof stop.charger.pricePerKwh === 'number' && stop.charger.pricePerKwh > 0 && (
                  <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-emerald-300">€ {stop.charger.pricePerKwh.toFixed(2).replace('.', ',')}/kWh{charge !== null ? ` · ${euro(charge)}` : ''}</span>
                )}
                {stop.charger.parkingFee && (
                  <span className="rounded-md bg-orange-500/10 px-2 py-0.5 text-orange-300">🅿️ {park === 0 ? 'nu gratis' : park !== null ? euro(park) : 'parkeergeld'}</span>
                )}
              </div>
              {onRemoveCharger && !stop.forced && (
                <button onClick={() => onRemoveCharger(idx)}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/20">
                  <Ban size={14} /> Ik laad hier liever niet
                </button>
              )}
            </div>
          </div>
        );
      })}
      {legEl(legs.length - 1)}
      <div className="flex items-center gap-2 px-1 text-[11px] text-slate-400"><Flag size={11} /> Bestemming{typeof arrivalPercent === 'number' ? ` met ± ${arrivalPercent}%` : ''}</div>
    </div>
  );
}
