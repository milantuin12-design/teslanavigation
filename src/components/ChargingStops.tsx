import { Zap, BatteryCharging, MapPin, Gauge, Clock, X, Edit3 } from 'lucide-react';
import { useState } from 'react';
import { ChargingStop } from '@/lib/tesla-types';
import { parseMaxSpeed } from '@/lib/tesla-utils';

interface ChargingStopsProps {
  stops: ChargingStop[];
  totalDistanceKm: number | null;
  onBatteryChange?: (index: number, newBatteryAfter: number) => void;
  onRemoveCharger?: (index: number) => void;
}

function formatDuration(min: number): string {
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}u ${m}m` : `${h}u`;
  }
  return `${min}m`;
}

export default function ChargingStops({ stops, totalDistanceKm, onBatteryChange, onRemoveCharger }: ChargingStopsProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState(80);

  if (stops.length === 0 && totalDistanceKm !== null) {
    return (
      <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3 mx-5 mb-4">
        <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
          <Zap size={16} />
          Geen oplaadstops nodig - bereik is voldoende
        </div>
      </div>
    );
  }

  if (stops.length === 0) return null;

  const handleStartEdit = (index: number, currentValue: number) => {
    setEditingIndex(index);
    setEditValue(currentValue);
  };

  const handleSaveEdit = () => {
    if (editingIndex !== null && onBatteryChange) {
      onBatteryChange(editingIndex, editValue);
    }
    setEditingIndex(null);
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
  };

  return (
    <div className="px-5 pb-5 space-y-2">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
        Oplaadstops
      </h3>
      {stops.map((stop, idx) => {
        const maxSpeedKw = parseMaxSpeed(stop.charger.stallTypes, stop.charger.maxSpeedKw, stop.charger.chargerConfigs);
        const maxSpeedLabel = maxSpeedKw ? `${maxSpeedKw}kW` : '';
        const stallCountLabel = stop.charger.totalStalls ? `${stop.charger.totalStalls} laadplekken` : '';
        const isEditing = editingIndex === idx;
        const eta = typeof stop.etaMinFromStart === 'number'
          ? new Date(Date.now() + stop.etaMinFromStart * 60000)
          : null;

        return (
          <div
            key={idx}
            className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-white">
                {stop.charger.name}
              </span>
              <div className="flex items-center gap-1">
                {onRemoveCharger && (
                  <button
                    onClick={() => onRemoveCharger(idx)}
                    className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                    title="Verwijder stop"
                  >
                    <X size={12} />
                  </button>
                )}
                <span className="text-[10px] text-slate-500 bg-slate-700/50 px-1.5 py-0.5 rounded">
                  Stop #{idx + 1}
                </span>
              </div>
            </div>
            {eta && (
              <div className="text-[11px] text-blue-300 mt-0.5">
                Aankomst ± {eta.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
              <span className="flex items-center gap-1">
                <MapPin size={11} />
                {stop.distanceFromStart} km
              </span>

              {isEditing ? (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={stop.batteryBefore + 5}
                    max={100}
                    value={editValue}
                    onChange={(e) => setEditValue(parseInt(e.target.value) || 80)}
                    className="w-14 bg-slate-700 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-white"
                  />
                  <span className="text-slate-400">%</span>
                  <button onClick={handleSaveEdit} className="px-1.5 py-0.5 bg-green-600 text-white text-[10px] rounded">OK</button>
                  <button onClick={handleCancelEdit} className="px-1.5 py-0.5 bg-slate-600 text-white text-[10px] rounded">Annuleer</button>
                </div>
              ) : (
                <span
                  className="flex items-center gap-1 cursor-pointer hover:text-amber-300 transition-colors"
                  onClick={() => onBatteryChange && handleStartEdit(idx, stop.batteryAfter)}
                  title="Klik om aan te passen"
                >
                  <BatteryCharging size={11} className="text-amber-400" />
                  {stop.batteryBefore}% → {stop.batteryAfter}%
                  {onBatteryChange && <Edit3 size={9} className="text-slate-500" />}
                </span>
              )}
              <span className="flex items-center gap-1 text-green-400">
                <Clock size={11} />
                {formatDuration(stop.chargeDurationMin)}
              </span>
              {maxSpeedLabel && (
                <span className="flex items-center gap-1 text-blue-400">
                  <Gauge size={11} />
                  {maxSpeedLabel}
                </span>
              )}
              {stallCountLabel && (
                <span className="flex items-center gap-1 text-slate-300">
                  <Zap size={11} />
                  {stallCountLabel}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
