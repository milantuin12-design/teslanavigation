import { useEffect, useState } from 'react';
import { BatteryCharging, X, Play, Edit3 } from 'lucide-react';
import { ChargingStop } from '@/lib/tesla-types';
import { calculateChargeDuration, effectiveChargeSpeedKw, parseMaxSpeed } from '@/lib/tesla-utils';
import { teslaBatteryKWh } from '@/lib/tesla-types';

interface ChargingScreenProps {
  stop: ChargingStop;
  modelName: string;
  batteryCapacityKWhOverride?: number;
  carMaxKwOverride?: number;
  currentBattery: number;
  onDone: (finalBatteryPercent: number) => void;
  onSkip: () => void;
}

export default function ChargingScreen({
  stop,
  modelName,
  batteryCapacityKWhOverride,
  carMaxKwOverride,
  currentBattery,
  onDone,
  onSkip,
}: ChargingScreenProps) {
  const [targetPercent, setTargetPercent] = useState(stop.batteryAfter);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(stop.batteryAfter);
  const [startedAt, setStartedAt] = useState<number>(Date.now());
  const [now, setNow] = useState<number>(Date.now());

  const rawKw = parseMaxSpeed(stop.charger.stallTypes, stop.charger.maxSpeedKw, stop.charger.chargerConfigs);
  const speedKw = effectiveChargeSpeedKw(rawKw, modelName, carMaxKwOverride);
  const capacityKWh = batteryCapacityKWhOverride || teslaBatteryKWh[modelName] || 79;
  const totalMin = Math.max(1, calculateChargeDuration(currentBattery, targetPercent, capacityKWh, speedKw));

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsedMs = now - startedAt;
  const remainingMs = Math.max(0, totalMin * 60_000 - elapsedMs);
  const remainingMin = Math.ceil(remainingMs / 60_000);
  const progress = Math.min(1, elapsedMs / (totalMin * 60_000));
  const currentEstimated = Math.min(targetPercent, Math.round(currentBattery + (targetPercent - currentBattery) * progress));

  const applyEdit = () => {
    const val = Math.max(currentBattery + 1, Math.min(100, editValue));
    setTargetPercent(val);
    setStartedAt(Date.now());
    setEditing(false);
  };

  return (
    <div className="absolute inset-0 z-[2000] flex items-center justify-center bg-slate-900/95 backdrop-blur-md p-4">
      <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BatteryCharging className="text-amber-400" size={24} />
            <h2 className="text-lg font-bold text-white">Aan het laden</h2>
          </div>
          <button
            onClick={() => onDone(currentEstimated)}
            className="text-slate-400 hover:text-white"
            title="Sluiten"
          >
            <X size={22} />
          </button>
        </div>

        <div className="text-sm text-slate-300 mb-1 truncate">{stop.charger.name}</div>
        <div className="text-xs text-slate-500 mb-5">Max {speedKw} kW</div>

        <div className="text-center mb-5">
          <div className="text-6xl font-bold text-white tabular-nums">
            {remainingMin}
            <span className="text-2xl font-medium text-slate-400 ml-2">min</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">resterend (totaal {totalMin} min)</div>
        </div>

        <div className="mb-5">
          <div className="flex justify-between text-xs text-slate-400 mb-1.5">
            <span>{currentBattery}%</span>
            <span className="font-semibold text-amber-300">Doel {targetPercent}%</span>
          </div>
          <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-green-400 transition-all"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <div className="text-center text-2xl font-bold text-green-400 mt-2 tabular-nums">≈ {currentEstimated}%</div>
        </div>

        {editing ? (
          <div className="flex items-center gap-2 mb-3">
            <input
              type="number"
              min={currentBattery + 1}
              max={100}
              value={editValue}
              onChange={(e) => setEditValue(parseInt(e.target.value) || currentBattery + 1)}
              className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white"
              autoFocus
            />
            <button
              onClick={applyEdit}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold"
            >Toepassen</button>
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm"
            >X</button>
          </div>
        ) : (
          <button
            onClick={() => { setEditValue(targetPercent); setEditing(true); }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium mb-2"
          >
            <Edit3 size={14} /> Doelpercentage aanpassen
          </button>
        )}

        <button
          onClick={() => onDone(Math.max(currentEstimated, targetPercent))}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg text-base font-semibold"
        >
          <Play size={16} /> Klaar &mdash; verder rijden
        </button>
        <button
          onClick={onSkip}
          className="w-full mt-2 text-xs text-slate-400 hover:text-slate-200"
        >
          Overslaan zonder wijziging
        </button>
      </div>
    </div>
  );
}
