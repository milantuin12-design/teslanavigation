import { ArrowUp, ArrowLeft, ArrowRight, RotateCcw, Merge, Flag, Zap, MapPin, Battery, X } from 'lucide-react';
import { useState } from 'react';
import { ChargingStop } from '@/lib/tesla-types';

interface RouteStep {
  distance: number;
  duration: number;
  instruction: string;
  name: string;
  maneuver: {
    type: string;
    modifier?: string;
    location: [number, number];
  };
}

interface NavigationPanelProps {
  steps: RouteStep[];
  currentStepIndex: number;
  /** Next charging stop ahead (km remaining + ETA min from now) */
  nextChargingStop: { stop: ChargingStop; kmFromHere: number; etaMin: number } | null;
  /** Destination info from current position */
  destination: { kmFromHere: number; etaMin: number } | null;
  currentBattery: number;
  onBatteryChange: (pct: number) => void;
  onStop: () => void;
}

function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`;
  }
  return `${Math.round(meters / 10) * 10} m`;
}

function formatKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${Math.round(km)} km`;
}

function formatMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}u ${m}m` : `${m}m`;
}

function getManeuverIcon(type: string, modifier?: string, size: number = 48): React.ReactNode {
  const cls = "text-white";
  switch (type) {
    case 'turn':
      if (modifier?.includes('left')) return <ArrowLeft size={size} className={cls} />;
      if (modifier?.includes('right')) return <ArrowRight size={size} className={cls} />;
      if (modifier === 'uturn') return <RotateCcw size={size} className={cls} />;
      return <ArrowUp size={size} className={cls} />;
    case 'merge': return <Merge size={size} className={cls} />;
    case 'roundabout': return <RotateCcw size={size} className={cls} />;
    case 'arrive': return <Flag size={size} className="text-green-400" />;
    case 'depart': return <Flag size={size} className="text-blue-400" />;
    case 'fork':
      if (modifier === 'left') return <ArrowLeft size={size} className={cls} />;
      if (modifier === 'right') return <ArrowRight size={size} className={cls} />;
      return <ArrowUp size={size} className={cls} />;
    default: return <ArrowUp size={size} className={cls} />;
  }
}

function getManeuverText(type: string, modifier?: string, name?: string): string {
  switch (type) {
    case 'turn':
      return `Sla ${modifier?.includes('left') ? 'linksaf' : modifier?.includes('right') ? 'rechtsaf' : 'rechtdoor'}${name ? ` op ${name}` : ''}`;
    case 'new name': return `Ga door${name ? ` op ${name}` : ''}`;
    case 'continue': return `Blijf volgen${name ? ` ${name}` : ''}`;
    case 'merge': return `Voeg in${name ? ` op ${name}` : ''}`;
    case 'roundabout': return `Neem de rotonde${name ? ` ${name}` : ''}`;
    case 'arrive': return 'Bestemming bereikt';
    case 'depart': return `Start${name ? ` op ${name}` : ''}`;
    case 'fork':
      return `Houd ${modifier === 'left' ? 'links' : modifier === 'right' ? 'rechts' : 'rechtdoor'}${name ? ` op ${name}` : ''}`;
    default: return 'Volg de route';
  }
}

export default function NavigationPanel({
  steps,
  currentStepIndex,
  nextChargingStop,
  destination,
  currentBattery,
  onBatteryChange,
  onStop,
}: NavigationPanelProps) {
  const [editingBattery, setEditingBattery] = useState(false);
  const [batteryDraft, setBatteryDraft] = useState(currentBattery);

  const currentStep = steps[currentStepIndex];
  const nextStep = steps[currentStepIndex + 1];

  return (
    <div className="absolute inset-0 pointer-events-none z-[1000] flex flex-col">
      {/* TOP — current step BIG */}
      <div className="pointer-events-auto bg-slate-900/95 backdrop-blur-sm border-b-2 border-blue-500/30 shadow-xl">
        <div className="flex items-center justify-between px-4 py-2">
          <span className="text-xs font-semibold text-blue-300 uppercase tracking-wider">Navigatie</span>
          <button
            onClick={onStop}
            className="flex items-center gap-1 px-3 py-1 bg-red-500/20 border border-red-500/40 text-red-300 rounded-lg text-xs font-medium hover:bg-red-500/30"
          >
            <X size={14} /> Stop
          </button>
        </div>
        {currentStep ? (
          <div className="flex items-center gap-4 px-5 pb-4 pt-1">
            <div className="w-20 h-20 flex items-center justify-center bg-blue-600 rounded-2xl shadow-lg shadow-blue-600/40 flex-shrink-0">
              {getManeuverIcon(currentStep.maneuver.type, currentStep.maneuver.modifier, 48)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-4xl font-bold text-white leading-none">
                {formatDistance(currentStep.distance)}
              </div>
              <div className="text-sm text-slate-300 mt-1.5 truncate">
                {getManeuverText(currentStep.maneuver.type, currentStep.maneuver.modifier, currentStep.name)}
              </div>
              {nextStep && (
                <div className="text-xs text-slate-500 mt-1 truncate">
                  Daarna: {getManeuverText(nextStep.maneuver.type, nextStep.maneuver.modifier, nextStep.name)}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="px-5 pb-4 text-slate-400">Route volgen...</div>
        )}
      </div>

      <div className="flex-1" />

      {/* BOTTOM — battery + next charge + destination */}
      <div className="pointer-events-auto bg-slate-900/95 backdrop-blur-sm border-t-2 border-blue-500/30 shadow-xl">
        {/* Live battery input */}
        <div className="px-4 pt-3 pb-2 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Battery size={16} className="text-green-400" />
            <span className="text-xs text-slate-400">Huidige batterij:</span>
            {editingBattery ? (
              <>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={batteryDraft}
                  onChange={(e) => setBatteryDraft(parseInt(e.target.value) || 0)}
                  className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-white"
                  autoFocus
                />
                <button
                  onClick={() => { onBatteryChange(Math.max(1, Math.min(100, batteryDraft))); setEditingBattery(false); }}
                  className="px-2 py-1 bg-green-600 text-white text-xs rounded"
                >OK</button>
                <button
                  onClick={() => { setBatteryDraft(currentBattery); setEditingBattery(false); }}
                  className="px-2 py-1 bg-slate-700 text-white text-xs rounded"
                >X</button>
              </>
            ) : (
              <button
                onClick={() => { setBatteryDraft(currentBattery); setEditingBattery(true); }}
                className="text-base font-bold text-green-400 hover:text-green-300"
                title="Klik om bij te werken"
              >
                {currentBattery}%
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 divide-x divide-slate-800">
          {/* Next charging stop */}
          <div className="px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] text-amber-400 uppercase font-semibold tracking-wider mb-1">
              <Zap size={11} />
              Volgende lading
            </div>
            {nextChargingStop ? (
              <>
                <div className="text-lg font-bold text-white leading-tight truncate" title={nextChargingStop.stop.charger.name}>
                  {nextChargingStop.stop.charger.name}
                </div>
                <div className="text-sm text-slate-300 mt-0.5">
                  {formatKm(nextChargingStop.kmFromHere)} • {formatMin(nextChargingStop.etaMin)}
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-500">Geen stops meer</div>
            )}
          </div>

          {/* Destination */}
          <div className="px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] text-red-400 uppercase font-semibold tracking-wider mb-1">
              <MapPin size={11} />
              Bestemming
            </div>
            {destination ? (
              <>
                <div className="text-lg font-bold text-white leading-tight">
                  {formatKm(destination.kmFromHere)}
                </div>
                <div className="text-sm text-slate-300 mt-0.5">
                  {formatMin(destination.etaMin)}
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-500">-</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
