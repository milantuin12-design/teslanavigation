import { ArrowUp, ArrowLeft, ArrowRight, RotateCcw, Merge, Flag, Zap, MapPin, Battery, X, Compass, Navigation as NavIcon, Clock, Gauge, ChevronRight, LocateFixed, BatteryCharging } from 'lucide-react';
import { useState } from 'react';
import { ChargingStop } from '@/lib/tesla-types';

interface RouteStep {
  distance: number;
  duration: number;
  instruction: string;
  name: string;
  maneuver: { type: string; modifier?: string; location: [number, number] };
}
interface NavigationPanelProps {
  steps: RouteStep[];
  currentStepIndex: number;
  distanceToNextManeuver: number | null;
  nextChargingStop: { stop: ChargingStop; kmFromHere: number; etaMin: number; arrivalPercent: number } | null;
  destination: { kmFromHere: number; etaMin: number; arrivalPercent: number } | null;
  currentBattery: number;
  estimatedBattery: number | null;
  onBatteryChange: (pct: number) => void;
  onStop: () => void;
  headingUp: boolean;
  onToggleHeadingUp: () => void;
  routeChangedStops: ChargingStop[] | null;
  currentSpeedKmh: number | null;
  totalDistanceKm: number;
  hasGps: boolean;
  gpsError: boolean;
}

function formatDistance(meters: number): string {
  if (meters < 15) return 'NU';
  if (meters <= 1000) {
    const snaps = [25, 100, 250, 500, 800, 1000];
    let snap = 25;
    for (const value of snaps) if (meters >= value) snap = value;
    return snap >= 1000 ? '1 km' : `${snap} m`;
  }
  return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`;
}
function formatKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${Math.round(km)} km`;
}
function formatMin(min: number): string {
  const hours = Math.floor(min / 60);
  const minutes = Math.round(min % 60);
  return hours > 0 ? `${hours}u ${minutes}m` : `${minutes} min`;
}
function arrivalClock(min: number): string {
  return new Date(Date.now() + Math.max(0, min) * 60000).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}
function getManeuverIcon(type: string, modifier?: string, size = 48): React.ReactNode {
  const cls = 'text-white';
  switch (type) {
    case 'turn':
      if (modifier?.includes('left')) return <ArrowLeft size={size} strokeWidth={2.8} className={cls} />;
      if (modifier?.includes('right')) return <ArrowRight size={size} strokeWidth={2.8} className={cls} />;
      if (modifier === 'uturn') return <RotateCcw size={size} strokeWidth={2.8} className={cls} />;
      return <ArrowUp size={size} strokeWidth={2.8} className={cls} />;
    case 'merge': return <Merge size={size} strokeWidth={2.8} className={cls} />;
    case 'roundabout': return <RotateCcw size={size} strokeWidth={2.8} className={cls} />;
    case 'arrive': return <Flag size={size} className="text-emerald-300" />;
    case 'depart': return <Flag size={size} className="text-sky-300" />;
    case 'fork':
      if (modifier === 'left') return <ArrowLeft size={size} strokeWidth={2.8} className={cls} />;
      if (modifier === 'right') return <ArrowRight size={size} strokeWidth={2.8} className={cls} />;
      return <ArrowUp size={size} strokeWidth={2.8} className={cls} />;
    default: return <ArrowUp size={size} strokeWidth={2.8} className={cls} />;
  }
}
function getManeuverText(type: string, modifier?: string, name?: string): string {
  switch (type) {
    case 'turn': return `Sla ${modifier?.includes('left') ? 'linksaf' : modifier?.includes('right') ? 'rechtsaf' : modifier === 'uturn' ? 'om' : 'rechtdoor'}${name ? ` op ${name}` : ''}`;
    case 'new name': return `Ga verder${name ? ` op ${name}` : ''}`;
    case 'continue': return `Blijf volgen${name ? ` ${name}` : ''}`;
    case 'merge': return `Voeg in${name ? ` op ${name}` : ''}`;
    case 'roundabout': return `Neem de rotonde${name ? ` ${name}` : ''}`;
    case 'arrive': return 'Bestemming bereikt';
    case 'depart': return `Vertrek${name ? ` via ${name}` : ''}`;
    case 'fork': return `Houd ${modifier === 'left' ? 'links' : modifier === 'right' ? 'rechts' : 'rechtdoor'} aan${name ? ` richting ${name}` : ''}`;
    default: return name ? `Volg ${name}` : 'Volg de route';
  }
}

export default function NavigationPanel({
  steps, currentStepIndex, distanceToNextManeuver, nextChargingStop, destination,
  currentBattery, estimatedBattery, onBatteryChange, onStop, headingUp,
  onToggleHeadingUp, routeChangedStops, currentSpeedKmh, totalDistanceKm, hasGps, gpsError,
}: NavigationPanelProps) {
  const [editingBattery, setEditingBattery] = useState(false);
  const [batteryDraft, setBatteryDraft] = useState(currentBattery);
  const currentStep = steps[currentStepIndex];
  const nextStep = steps[currentStepIndex + 1];
  const liveDistance = distanceToNextManeuver ?? currentStep?.distance ?? 0;
  const remainingKm = destination?.kmFromHere ?? totalDistanceKm;
  const progress = totalDistanceKm > 0 ? Math.max(0, Math.min(100, ((totalDistanceKm - remainingKm) / totalDistanceKm) * 100)) : 0;

  return (
    <div className="pointer-events-none fixed inset-0 z-[6000] flex flex-col justify-between p-2 pt-[max(6px,env(safe-area-inset-top))] pb-[max(6px,env(safe-area-inset-bottom))] sm:p-3">
      <div className="pointer-events-auto mx-auto w-full max-w-[560px] space-y-1.5">
        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[#07111f]/75 px-3 py-1.5 text-white shadow-[0_12px_40px_rgba(0,0,0,.38)] backdrop-blur-2xl">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-400/15 text-cyan-300"><NavIcon size={19} /></div>
            <div className="min-w-0"><div className="text-[11px] font-black tracking-[.18em]">TESLANAVIGATION</div><div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold text-slate-300"><span className={`h-1.5 w-1.5 rounded-full ${hasGps ? 'bg-emerald-400 shadow-[0_0_9px_#34d399]' : gpsError ? 'bg-rose-400' : 'bg-amber-400 animate-pulse'}`} />{hasGps ? 'GPS-positie actief' : gpsError ? 'Locatietoegang vereist' : 'GPS-positie zoeken…'}</div></div>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-white/[.07] px-2 py-1 text-right"><div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Snelheid</div><div className="text-base font-black leading-none tabular-nums">{currentSpeedKmh == null ? '—' : currentSpeedKmh}<span className="ml-1 text-[9px] font-semibold text-slate-400">km/u</span></div></div>
            <button onClick={onToggleHeadingUp} aria-label={headingUp ? "Schakel naar noord boven" : "Schakel naar rijrichting boven"} title={headingUp ? "Schakel naar noord boven" : "Schakel naar rijrichting boven"} className={`flex h-9 w-9 items-center justify-center rounded-lg border ${headingUp ? "border-cyan-300/40 bg-cyan-400/15 text-cyan-200" : "border-white/10 bg-white/[.06] text-slate-100"}`}><Compass size={18} /></button>
            <button onClick={onStop} title="Navigatie stoppen" className="flex h-9 w-9 items-center justify-center rounded-lg border border-rose-400/20 bg-rose-500/15 text-rose-200"><X size={18} /></button>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/15 bg-gradient-to-br from-[#102b50]/85 via-[#0a1c35]/85 to-[#07111f]/85 text-white shadow-[0_18px_55px_rgba(0,0,0,.48)] backdrop-blur-2xl">
          <div className="flex items-center justify-between gap-3 px-3 pt-2 sm:px-4">
            <div className="text-[9px] font-extrabold uppercase tracking-[.18em] text-cyan-200/80">Volgende manoeuvre</div>
            <div className="max-w-[55%] truncate rounded-full border border-white/10 bg-white/[.07] px-2 py-0.5 text-[9px] font-semibold text-slate-200">{currentStep?.name || 'Route volgen'}</div>
          </div>
          <div className="flex items-center gap-3 px-3 pb-2.5 pt-1.5 sm:gap-4 sm:px-4 sm:pb-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-cyan-200/20 bg-cyan-300/10 shadow-inner sm:h-14 sm:w-14">{currentStep ? getManeuverIcon(currentStep.maneuver.type, currentStep.maneuver.modifier, 34) : <LocateFixed size={34} />}</div>
            <div className="min-w-0 flex-1">
              <div className="text-[26px] font-black leading-none tracking-[-.04em] sm:text-[30px]">{formatDistance(liveDistance)}</div>
              <div className="mt-1 text-sm font-bold leading-tight sm:text-base">{currentStep ? getManeuverText(currentStep.maneuver.type, currentStep.maneuver.modifier, currentStep.name) : 'Volg de route'}</div>
              {nextStep && <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-300"><ChevronRight size={13} className="text-cyan-300" /> Daarna: {getManeuverText(nextStep.maneuver.type, nextStep.maneuver.modifier, nextStep.name)}</div>}
            </div>
          </div>
        </div>
        {routeChangedStops && <div className="rounded-2xl border border-amber-300/30 bg-amber-400/95 px-4 py-3 text-slate-950 shadow-xl"><div className="text-sm font-black">Route automatisch aangepast</div><div className="mt-1 text-xs">{routeChangedStops.length ? routeChangedStops.map((stop, i) => `${i + 1}. ${stop.charger.name} · laden tot ${stop.batteryAfter}%`).join(' • ') : 'Je hebt geen laadstops meer nodig.'}</div></div>}
      </div>

      <div className="pointer-events-auto mx-auto w-full max-w-[560px] space-y-1.5">
        {nextChargingStop && <div className="flex items-center gap-3 rounded-xl border border-amber-300/20 bg-[#07111f]/80 px-3 py-2 text-white shadow-[0_12px_35px_rgba(0,0,0,.38)] backdrop-blur-2xl"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-400/15 text-amber-300"><Zap size={19} /></div><div className="min-w-0 flex-1"><div className="text-[9px] font-extrabold uppercase tracking-[.18em] text-amber-300">Volgende Supercharger</div><div className="truncate text-sm font-bold">{nextChargingStop.stop.charger.name}</div><div className="text-[10px] text-slate-300">{formatKm(nextChargingStop.kmFromHere)} · {formatMin(nextChargingStop.etaMin)} · aankomst ~{Math.round(nextChargingStop.arrivalPercent)}%</div></div><ChevronRight size={18} className="text-slate-400" /></div>}
        <div className="rounded-xl border border-white/10 bg-[#07111f]/80 p-2 text-white shadow-[0_18px_55px_rgba(0,0,0,.38)] backdrop-blur-xl sm:p-4">
          <div className="mb-1.5 flex items-center justify-between gap-3"><div className="text-[10px] font-extrabold uppercase tracking-[.2em] text-slate-400">Ritoverzicht</div><div className="text-xs font-bold text-cyan-300">{Math.round(progress)}% afgelegd</div></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-blue-400 to-emerald-300 transition-[width] duration-500" style={{ width: `${progress}%` }} /></div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <div><div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-400"><Clock size={11} /> Aankomst</div><div className="mt-0.5 text-lg font-black tabular-nums sm:text-xl">{destination ? arrivalClock(destination.etaMin) : '--:--'}</div><div className="text-[10px] text-slate-400">{destination ? formatMin(destination.etaMin) + ' resterend' : 'ETA'}</div></div>
            <div><div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-400"><MapPin size={11} /> Afstand</div><div className="mt-0.5 text-lg font-black tabular-nums sm:text-xl">{destination ? formatKm(destination.kmFromHere) : '--'}</div><div className="text-[10px] text-slate-400">tot bestemming</div></div>
            <div><div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-400"><BatteryCharging size={11} /> Batterij</div><div className={`mt-0.5 text-lg font-black tabular-nums sm:text-xl ${(destination?.arrivalPercent ?? 50) < 5 ? 'text-rose-400' : 'text-emerald-300'}`}>{destination ? `~${Math.round(destination.arrivalPercent)}%` : '--'}</div><div className="text-[10px] text-slate-400">bij aankomst</div></div>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2">
            <div className="flex items-center gap-2 text-[10px] text-slate-300"><Battery size={14} className="text-emerald-300" /> Batterij nu</div>
            {editingBattery ? <div className="flex items-center gap-1.5"><input type="number" min={1} max={100} value={batteryDraft} onChange={(e) => setBatteryDraft(parseInt(e.target.value) || 0)} className="w-16 rounded-lg border border-white/15 bg-slate-900 px-2 py-1.5 text-sm" autoFocus /><button onClick={() => { onBatteryChange(Math.max(1, Math.min(100, batteryDraft))); setEditingBattery(false); }} className="rounded-lg bg-emerald-400 px-2.5 py-1.5 text-[10px] font-bold text-slate-950">Opslaan</button><button onClick={() => { setBatteryDraft(currentBattery); setEditingBattery(false); }} className="rounded-lg bg-white/10 px-2 py-1.5 text-[10px]">Annuleer</button></div> : <button onClick={() => { setBatteryDraft(currentBattery); setEditingBattery(true); }} className="text-sm font-black text-white">{currentBattery}% <span className="text-[10px] font-medium text-slate-400">aanpassen</span>{estimatedBattery !== null && <span className="ml-2 text-[10px] font-medium text-emerald-300">schatting ~{Math.round(estimatedBattery)}%</span>}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
