import { Zap, BatteryCharging, MapPin, Gauge, Clock, Ban, Mountain, Thermometer, Wind, CloudRain, Car, Flag, Route as RouteIcon } from 'lucide-react';
import type { ChargingStop, RouteResult } from '@/lib/tesla-types';
import type { RouteWeather } from '@/lib/energy';
import { getChargeCurvePoints, getOpenStalls, parseMaxSpeed, v2SpeedKw } from '@/lib/tesla-utils';
import { estimateFreeStalls, getTrafficForecastAt, trafficLevelLabel } from '@/lib/traffic-forecast';
import { estimateChargingCost } from '@/lib/charging-cost';

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
  ccsBlocked?: boolean;
  showTrailer?: boolean;
  restMin?: number;
  modelName?: string;
  carMaxKwOverride?: number;
  whatIf?: {
    minus5: { reachable: boolean; arrivalPercent: number; stops: number };
    plus5: { reachable: boolean; arrivalPercent: number; stops: number };
  };
}

function isWeekend(d: Date) { const day = d.getDay(); return day === 0 || day === 6; }

export function parkingCost(stop: ChargingStop, at?: Date): number | null {
  const c = stop.charger;
  if (!c.parkingFee) return null;
  if (Array.isArray(c.parkingBlocks) && c.parkingBlocks.length > 0) {
    const currencies = new Set(c.parkingBlocks.filter((block) => block.amount > 0).map((block) => (block.currency || "EUR").toUpperCase()));
    if (currencies.size > 1 || (currencies.size === 1 && !currencies.has("EUR"))) return null;
    const duration = Math.max(0, stop.chargeDurationMin);
    return c.parkingBlocks.reduce((sum, block) => {
      if (block.amount <= 0 || duration <= block.afterMinutes) return sum;
      if (block.durationMinutes <= 0) return sum + block.amount;
      const billable = Math.max(0, duration - block.afterMinutes);
      return sum + (block.repeat ? Math.ceil(billable / block.durationMinutes) * block.amount : block.amount);
    }, 0);
  }
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

/** Kiest het geldende kWh-tarief op het laadmoment: tijdsblokken hebben voorrang. */
export function activePricePerKwh(stop: ChargingStop, at?: Date): number | null {
  const blocks = stop.charger.priceBlocks;
  if (at && Array.isArray(blocks) && blocks.length > 0) {
    const day = at.getDay(); // 0 = zo
    const mins = at.getHours() * 60 + at.getMinutes();
    const dayMatch = (d?: string) => {
      const s = (d ?? '').toLowerCase();
      if (!s || s.includes('dagelijks') || s.includes('daily')) return true;
      if (s.includes('weekend')) return day === 0 || day === 6;
      if (s.includes('ma-vr') || s.includes('weekdag')) return day >= 1 && day <= 5;
      return true;
    };
    for (const b of blocks) {
      if (b.type === "power" || !dayMatch(b.days)) continue;
      const from = b.from ? parseInt(b.from.slice(0, 2), 10) * 60 + parseInt(b.from.slice(3, 5) || '0', 10) : 0;
      const to = b.to ? parseInt(b.to.slice(0, 2), 10) * 60 + parseInt(b.to.slice(3, 5) || '0', 10) : 1439;
      if (mins >= from && mins < to && typeof b.pricePerKwh === "number" && b.pricePerKwh >= 0) return b.pricePerKwh;
    }
    return null;
  }
  const price = stop.charger.pricePerKwh;
  return typeof price === 'number' && price > 0 ? price : null;
}

function chargingCost(stop: ChargingStop, at?: Date): number | null {
  const price = activePricePerKwh(stop, at);
  if (price === null) return null;
  const kwh = stop.energyChargedKWh ?? 0;
  if (kwh <= 0) return null;
  return kwh * price;
}

const euro = (n: number) => `€ ${n.toFixed(2).replace('.', ',')}`;
const localCurrency = (n: number, currency?: string) => new Intl.NumberFormat('nl-NL', { style: 'currency', currency: currency ?? 'EUR' }).format(n);
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

function LegRow({ fromLabel, toLabel, km, kWh, rangeKm, from, to, climbInfo, temperatureC, segmentWeather }: {
  fromLabel: string; toLabel: string; km: number; kWh: number | null; rangeKm: number | null; from: number; to: number;
  climbInfo: { up: number; down: number } | null;
  temperatureC: number | null;
  segmentWeather?: { windMs: number; precipitationMm: number; snowfallCm: number } | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-dashed border-white/10 px-3 py-2 text-[11px] text-slate-400">
      <span className="flex items-center gap-1 text-slate-300"><RouteIcon size={11} />{fromLabel} → {toLabel}</span>
      <span>{Math.round(km)} km</span>
      {segmentWeather && <span className="flex items-center gap-1"><Wind size={11}/>{segmentWeather.windMs.toFixed(0)} m/s</span>}
      {segmentWeather && segmentWeather.precipitationMm > 0 && <span className="flex items-center gap-1"><CloudRain size={11}/>{segmentWeather.precipitationMm.toFixed(1)} mm</span>}
      {segmentWeather && segmentWeather.snowfallCm > 0 && <span>❄ {segmentWeather.snowfallCm.toFixed(1)} cm</span>}
      {temperatureC !== null && <span className="flex items-center gap-1 text-amber-300"><Thermometer size={11} />{temperatureC.toFixed(1)}°C</span>}
      {kWh !== null && <span className="text-emerald-300">⚡ {kWh.toFixed(1)} kWh</span>}
      <span>🔋 {from}% → {to}%</span>
      {climbInfo && <span className="flex items-center gap-1"><Mountain size={11} />↑{climbInfo.up} m ↓{climbInfo.down} m</span>}
      {rangeKm !== null && <span className="text-blue-300">bereik ± {rangeKm} km</span>}
    </div>
  );
}

export default function ChargingStops({ stops, totalDistanceKm, onBatteryChange, onRemoveCharger, onArrivalChange, departure, route, packKWh, consumptionKWh100, arrivalPercent, weather, elevation, liveTraffic, ccsBlocked, showTrailer, restMin = 0, modelName = 'Model 3 Long Range AWD', carMaxKwOverride, whatIf }: ChargingStopsProps) {
  const start = departure ?? new Date();
  const total = route?.totalDistanceKm ?? totalDistanceKm ?? 0;
  const k100 = consumptionKWh100 && consumptionKWh100 > 0 ? consumptionKWh100 : null;
  const fullRange = k100 && packKWh ? Math.round((packKWh / k100) * 100) : null;
  const totalKWh = k100 ? (total / 100) * k100 : null;
  const totalClimb = climb(elevation, total, 0, total);
  const totalChargeMin = stops.reduce((s, x) => s + x.chargeDurationMin, 0);
  const stopCosts = stops.map((stop) => {
    const at = new Date(start.getTime() + (stop.etaMinFromStart ?? 0) * 60000);
    const estimate = estimateChargingCost(stop, at, modelName, packKWh, carMaxKwOverride);
    const charge = estimate?.currency === "EUR" ? estimate.amount : null;
    const parking = parkingCost(stop, at);
    const parkingKnown = !stop.charger.parkingFee || parking !== null;
    return { charge, parking, known: charge !== null && parkingKnown };
  });
  const allCostsKnown = stops.length > 0 && stopCosts.every((cost) => cost.known);
  const knownStopCosts = stopCosts.map((cost, index) => ({ ...cost, index, total: cost.charge !== null && (!stops[index].charger.parkingFee || cost.parking !== null) ? cost.charge + (cost.parking ?? 0) : null })).filter((cost): cost is typeof cost & { total: number } => cost.total !== null);
  const cheapestStopIndex = knownStopCosts.length ? knownStopCosts.reduce((best, item) => item.total < best.total ? item : best).index : -1;
  const totalCost = stopCosts.reduce((sum, cost) => sum + (cost.charge ?? 0) + (cost.parking ?? 0), 0);
  const arrivalTime = route ? new Date(start.getTime() + (route.totalTimeMin + totalChargeMin + restMin) * 60000) : null;

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
        <div className="rounded-lg bg-white/5 p-2"><div className="text-slate-400">Kosten</div><div className="text-sm font-semibold text-white">{allCostsKnown ? euro(totalCost) : 'onbekend'}</div></div>
      </div>
      {whatIf && (
        <div className="mt-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Wat als je 5% meer of minder vertrekt?</div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg bg-white/5 p-2"><div className="text-slate-400">5% minder accu</div><div className="font-semibold text-white">{whatIf.minus5.reachable ? `${whatIf.minus5.arrivalPercent}% aankomst · ${whatIf.minus5.stops} stops` : "Route niet haalbaar"}</div></div>
            <div className="rounded-lg bg-white/5 p-2"><div className="text-slate-400">5% meer accu</div><div className="font-semibold text-white">{whatIf.plus5.reachable ? `${whatIf.plus5.arrivalPercent}% aankomst · ${whatIf.plus5.stops} stops` : "Route niet haalbaar"}</div></div>
          </div>
        </div>
      )}
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
        from={l.fromPct} to={l.toPct} climbInfo={climb(elevation, total, l.fromKm, l.toKm)}
        temperatureC={weather?.temperatureSegments?.length ? weather.temperatureSegments.reduce((best, point) => Math.abs(point.km - ((l.fromKm + l.toKm) / 2)) < Math.abs(best.km - ((l.fromKm + l.toKm) / 2)) ? point : best).tempC : weather?.tempC ?? null}
        segmentWeather={weather?.weatherSegments?.length ? weather.weatherSegments.reduce((best, point) => Math.abs(point.km - ((l.fromKm + l.toKm) / 2)) < Math.abs(best.km - ((l.fromKm + l.toKm) / 2)) ? point : best) : null} />
    );
  };

  return (
    <div className="space-y-2 px-4 pb-5 pt-4">
      {summary}
      <h3 className="pt-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Laadstops & rijstukken</h3>
      {stops.map((stop, idx) => {
        const maxSpeedKw = ccsBlocked ? (v2SpeedKw(stop.charger) ?? 0) : parseMaxSpeed(stop.charger.stallTypes, stop.charger.maxSpeedKw, stop.charger.chargerConfigs);
        const eta = typeof stop.etaMinFromStart === 'number' ? new Date(start.getTime() + stop.etaMinFromStart * 60000) : null;
        const park = parkingCost(stop, eta ?? undefined);
        const charge = chargingCost(stop, eta ?? undefined);
        const activePrice = activePricePerKwh(stop, eta ?? undefined);
        const costEstimate = eta ? estimateChargingCost(stop, eta, modelName, packKWh ?? undefined, carMaxKwOverride) : null;
        return (
          <div key={idx} className="space-y-2">
            {legEl(idx)}
            <div className="rounded-2xl border border-white/10 bg-slate-800/60 px-3 py-3 shadow-md transition-all hover:border-blue-500/40 animate-fade-in">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-white">{stop.charger.name}</div>
                  {eta && <div className="mt-0.5 text-[11px] text-blue-300">Aankomst ± {time(eta)} · vertrek ± {time(new Date(eta.getTime() + stop.chargeDurationMin * 60000))}</div>}
                  {cheapestStopIndex === idx && knownStopCosts.length > 1 && <div className="mt-1 inline-flex rounded-md bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-300">Goedkoopste berekende laadstop incl. parkeren</div>}
                  {eta && (stop.etaMinFromStart ?? 0) >= 25 && <div className="mt-1 text-[10px] text-cyan-300">❄ Accu-voorverwarming: Tesla kan circa 20–30 min voor aankomst beginnen bij navigeren naar deze Supercharger</div>}
                </div>
                <span className="rounded-md bg-blue-600/20 px-2 py-0.5 text-[10px] font-semibold text-blue-300">Stop {idx + 1}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                <span className="flex items-center gap-1"><MapPin size={11} />{stop.distanceFromStart} km</span>
                <span className="flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-amber-300">
                  <BatteryCharging size={11} />{stop.batteryBefore}% → {stop.batteryAfter}%
                </span>
                <span className="flex items-center gap-1 text-green-400"><Clock size={11} />{dur(stop.chargeDurationMin)}</span>
                {maxSpeedKw > 0 && stop.charger.totalStalls ? <span className="flex items-center gap-1 text-blue-400"><Gauge size={11} />{maxSpeedKw} kW{ccsBlocked ? ' (V2)' : ''}</span> : null}
                {showTrailer && (stop.charger.trailerFriendly
                  ? <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">🚐 Aanhangervriendelijk</span>
                  : <span className="rounded-md bg-red-500/10 px-1.5 py-0.5 text-red-300">🚐 Niet aanhangervriendelijk</span>)}
                {typeof stop.energyChargedKWh === 'number' && <span className="text-emerald-300">+{stop.energyChargedKWh} kWh</span>}
              </div>
              {stop.charger.trafficForecast && eta && (() => {
                const forecast = getTrafficForecastAt(stop.charger.trafficForecast, eta, stop.charger.province);
                if (!forecast) return null;
                const color = forecast.level >= 70 ? "bg-red-500/15 text-red-300" : forecast.level <= 30 ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300";
                const total = stop.charger.totalStalls ?? stop.charger.chargerConfigs?.reduce((sum, config) => sum + config.count, 0) ?? 0;
                const free = Math.min(getOpenStalls(stop.charger, eta ?? new Date()), estimateFreeStalls(total, forecast.level) ?? total);
                return <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className={`rounded-md px-2 py-1 ${color}`}>{trafficLevelLabel(forecast.level)} · {forecast.level}%</span>
                  <span className="rounded-md bg-sky-500/10 px-2 py-1 text-sky-300">Waarschijnlijk {free} van de {total} vrij</span>
                  <span className="text-slate-400">{forecast.from}–{forecast.to} · {forecast.holiday ? `vakantie: ${forecast.holiday}` : forecast.category === "weekend" ? "weekend" : "doordeweeks"} · {forecast.confidence === "low" ? "lage zekerheid" : forecast.confidence === "high" ? "hoge zekerheid" : "gemiddelde zekerheid"}</span>
                </div>;
              })()}
      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                {costEstimate?.type === "minute" && (
                  <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
                    {localCurrency(costEstimate.amount, costEstimate.currency)} · per minuut ({Math.round(costEstimate.initialPowerKw ?? 0)} kW start)
                  </span>
                )}
                {costEstimate?.type === "kwh" && (
                  <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
                    {localCurrency(costEstimate.amount, costEstimate.currency)} totaal · kWh-tarief
                  </span>
                )}
                {!costEstimate && activePrice !== null && (
                  <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-emerald-300">{localCurrency(activePrice, stop.charger.priceCurrency)}/kWh{charge !== null ? ` · ${localCurrency(charge, stop.charger.priceCurrency)}` : ''}</span>
                )}
                {stop.charger.parkingFee && (
                  <span className="rounded-md bg-orange-500/10 px-2 py-0.5 text-orange-300">🅿️ {park === 0 ? 'nu gratis' : park !== null ? euro(park) : 'parkeergeld'}</span>
                )}
              </div>
              <details className="mt-3 rounded-lg border border-white/10 bg-black/10 px-2 py-2">
                <summary className="cursor-pointer text-[11px] font-medium text-slate-300">Laadcurve bekijken · {modelName}</summary>
                <div className="mt-2">
                  <div className="mb-2 flex items-center justify-between text-[10px] text-slate-500">
                    <span>Geschat laadvermogen per accupercentage</span>
                    <span>Max. {Math.round(Math.min(maxSpeedKw || 150, carMaxKwOverride || 250))} kW</span>
                  </div>
                  <div className="grid grid-cols-6 gap-1 sm:grid-cols-11">
                    {getChargeCurvePoints(modelName, maxSpeedKw || 150, carMaxKwOverride).map((point) => (
                      <div key={point.percent} className="flex min-w-0 flex-col items-center justify-end gap-1">
                        <span className="text-[9px] tabular-nums text-slate-300">{Math.round(point.kw)}</span>
                        <div className="flex h-12 w-full items-end rounded-sm bg-white/5">
                          <div className="w-full rounded-sm bg-sky-500/80" style={{ height: `${Math.max(3, point.kw / 250 * 48)}px` }} />
                        </div>
                        <span className="text-[9px] tabular-nums text-slate-500">{point.percent}%</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] text-slate-500">De curve is begrensd op zowel het maximale vermogen van de auto als dat van deze Supercharger. Dit is een schatting; temperatuur en accupreconditionering kunnen de werkelijke curve beïnvloeden.</p>
                </div>
              </details>
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
