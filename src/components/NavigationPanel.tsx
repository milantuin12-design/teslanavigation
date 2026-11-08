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
function getManeuverIcon(type: string, modifier?: string, size = 64): React.ReactNode {
  const cls = 'text-white';
  switch (type) {
    case 'turn':
      if (modifier?.includes('left')) return <ArrowLeft size={size} className={cls} />;
      if (modifier?.includes('right')) return <ArrowRight size={size} className={cls} />;
      if (modifier === 'uturn') return <RotateCcw size={size} className={cls} />;
      return <ArrowUp size={size} className={cls} />;
    case 'merge': return <Merge size={size} className={cls} />;
    case 'roundabout': return <RotateCcw size={size} className={cls} />;
    case 'arrive': return <Flag size={size} className="text-emerald-300" />;
    case 'depart': return <Flag size={size} className="text-sky-300" />;
    case 'fork':
      if (modifier === 'left') return <ArrowLeft size={size} className={cls} />;
      if (modifier === 'right') return <ArrowRight size={size} className={cls} />;
      return <ArrowUp size={size} className={cls} />;
    default: return <ArrowUp size={size} className={cls} />;
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
  onToggleHeadingUp, routeChangedStops, currentSpeedKmh, totalDistanceKm,
}: NavigationPanelProps) {
  const [editingBattery, setEditingBattery] = useState(false);
  const [batteryDraft, setBatteryDraft] = useState(currentBattery);
  const currentStep = steps[currentStepIndex];
  const nextStep = steps[currentStepIndex + 1];
  const liveDistance = distanceToNextManeuver ?? currentStep?.distance ?? 0;
  const remainingKm = destination?.kmFromHere ?? totalDistanceKm;
  const progress = totalDistanceKm > 0 ? Math.max(0, Math.min(100, ((totalDistanceKm - remainingKm) / totalDistanceKm) * 100)) : 0;

  return (
    <div className="absolute inset-0 pointer-events-none z-[1000] flex flex-col justify-between p-3 sm:p-4">
      <div className="pointer-events-auto mx-auto w-full max-w-3xl space-y-3">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/85 px-4 py-3 text-white shadow-2xl shadow-black/30 backdrop-blur-xl">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/20 text-blue-300"><NavIcon size={22} /></div>
            <div className="min-w-0"><div className="text-sm font-bold tracking-wide">TESLANAVIGATION</div><div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live routebegeleiding</div></div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2"><Gauge size={16} className="text-sky-300" /><span className="text-lg font-bold tabular-nums">{currentSpeedKmh == null ? '—' : currentSpeedKmh}</span><span className="text-[10px] text-slate-400">km/u</span></div>
            <button onClick={onToggleHeadingUp} className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10" title={headingUp ? 'Noord boven' : 'Rijrichting boven'}>{headingUp ? <NavIcon size={15} /> : <Compass size={15} />}<span className="hidden sm:inline">{headingUp ? 'Rijrichting' : 'Noord boven'}</span></button>
            <button onClick={onStop} className="flex items-center gap-1.5 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-200 hover:bg-rose-500/20"><X size={15} /><span className="hidden sm:inline">Stop</span></button>
          </div>
        </div>

        <div className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-blue-700/95 via-blue-800/95 to-slate-950/95 text-white shadow-2xl shadow-black/40 backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-100/80">Volgende manoeuvre</div>
            <div className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-blue-50">{currentStep?.name || 'Route volgen'}</div>
          </div>
          <div className="flex items-center gap-4 px-5 py-5 sm:gap-6 sm:px-7">
            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-[1.7rem] border border-white/15 bg-white/10 shadow-inner sm:h-28 sm:w-28">{currentStep ? getManeuverIcon(currentStep.maneuver.type, currentStep.maneuver.modifier, 64) : <LocateFixed size={56} />}</div>
            <div className="min-w-0 flex-1">
              <div className="text-4xl font-black leading-none tracking-tight sm:text-5xl">{formatDistance(liveDistance)}</div>
              <div className="mt-2 text-lg font-bold leading-tight sm:text-xl">{currentStep ? getManeuverText(currentStep.maneuver.type, currentStep.maneuver.modifier, currentStep.name) : 'Volg de route'}</div>
              {nextStep && <div className="mt-3 flex items-center gap-1.5 text-xs text-blue-100/70"><ChevronRight size={14} /> Daarna: {getManeuverText(nextStep.maneuver.type, nextStep.maneuver.modifier, nextStep.name)}</div>}
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-white/10 bg-black/10 px-5 py-2.5 text-xs text-blue-100/80 sm:hidden"><span className="flex items-center gap-1.5"><Gauge size={14} /> Huidige snelheid</span><strong className="text-base text-white tabular-nums">{currentSpeedKmh == null ? '—' : `${currentSpeedKmh} km/u`}</strong></div>
        </div>

        {routeChangedStops && <div className="rounded-2xl border border-amber-300/40 bg-amber-400/95 px-4 py-3 text-slate-950 shadow-xl"><div className="text-sm font-black">⚡ Route automatisch aangepast</div><div className="mt-1 text-xs">{routeChangedStops.length ? routeChangedStops.map((stop, i) => `${i + 1}. ${stop.charger.name} · laden tot ${stop.batteryAfter}%`).join('  •  ') : 'Je hebt geen laadstops meer nodig.'}</div></div>}
      </div>

      <div className="pointer-events-auto mx-auto w-full max-w-3xl">
        <div className="rounded-3xl border border-white/10 bg-slate-950/90 p-4 text-white shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3"><div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Ritoverzicht</div><div className="text-sm font-bold text-emerald-300">{Math.round(progress)}% afgelegd</div></div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-sky-400 via-blue-400 to-emerald-400 transition-[width] duration-500" style={{ width: `${progress}%` }} /></div>
          <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-4">
            <div><div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500"><Clock size={12} /> Aankomst</div><div className="mt-1 text-2xl font-black tabular-nums sm:text-3xl">{destination ? arrivalClock(destination.etaMin) : '--:--'}</div><div className="text-xs text-slate-400">{destination ? formatMin(destination.etaMin) + ' resterend' : 'ETA'}</div></div>
            <div><div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500"><MapPin size={12} /> Afstand</div><div className="mt-1 text-2xl font-black tabular-nums sm:text-3xl">{destination ? formatKm(destination.kmFromHere) : '--'}</div><div className="text-xs text-slate-400">tot bestemming</div></div>
            <div><div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500"><BatteryCharging size={12} /> Aankomst</div><div className={`mt-1 text-2xl font-black tabular-nums sm:text-3xl ${(destination?.arrivalPercent ?? 50) < 5 ? 'text-rose-400' : 'text-emerald-300'}`}>{destination ? `~${Math.round(destination.arrivalPercent)}%` : '--'}</div><div className="text-xs text-slate-400">batterij</div></div>
          </div>
          <div className="mt-4 grid gap-2 border-t border-white/10 pt-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-amber-400/10 p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-300"><Zap size={13} /> Volgende Supercharger</div>
              {nextChargingStop ? <><div className="mt-1 truncate text-base font-bold">{nextChargingStop.stop.charger.name}</div><div className="mt-0.5 text-xs text-slate-300">{formatKm(nextChargingStop.kmFromHere)} · {formatMin(nextChargingStop.etaMin)} · aankomst ~{Math.round(nextChargingStop.arrivalPercent)}%</div></> : <div className="mt-1 text-sm text-slate-400">Geen laadstop meer nodig</div>}
            </div>
            <div className="rounded-2xl bg-emerald-400/10 p-3">
              <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300"><Battery size={13} /> Batterij nu</div>{estimatedBattery !== null && <span className="text-[10px] text-slate-400">schatting ~{Math.round(estimatedBattery)}%</span>}</div>
              {editingBattery ? <div className="mt-2 flex items-center gap-2"><input type="number" min={1} max={100} value={batteryDraft} onChange={(e) => setBatteryDraft(parseInt(e.target.value) || 0)} className="w-20 rounded-lg border border-white/15 bg-slate-900 px-2 py-1.5 text-sm" autoFocus /><button onClick={() => { onBatteryChange(Math.max(1, Math.min(100, batteryDraft))); setEditingBattery(false); }} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950">Opslaan</button><button onClick={() => { setBatteryDraft(currentBattery); setEditingBattery(false); }} className="rounded-lg bg-white/10 px-2 py-1.5 text-xs">Annuleer</button></div> : <button onClick={() => { setBatteryDraft(currentBattery); setEditingBattery(true); }} className="mt-1 text-2xl font-black text-white hover:text-emerald-200">{currentBattery}% <span className="text-[10px] font-medium text-slate-400">aanpassen</span></button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
