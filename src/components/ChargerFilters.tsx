import { useMemo, useState } from "react";
import { Filter, ChevronDown, ChevronUp } from "lucide-react";
import type { ChargerFilterState, ChargerLifecycleStatus, Supercharger } from "@/lib/tesla-types";
import { defaultChargerFilters } from "@/lib/tesla-types";
import { lifecycleLabels } from "@/lib/tesla-utils";

const STATUS_ORDER: ChargerLifecycleStatus[] = [
  "operational",
  "works",
  "construction",
  "works_closed",
  "temp_closed",
  "long_closed",
];

const SPEEDS = [0, 100, 125, 150, 250];
const VERSIONS = ["V2", "V3", "V4"];

interface Props {
  filters: ChargerFilterState;
  onChange: (filters: ChargerFilterState) => void;
  chargers: Supercharger[];
  visibleCount: number;
}

export default function ChargerFilters({ filters, onChange, chargers, visibleCount }: Props) {
  const [open, setOpen] = useState(false);

  const countries = useMemo(
    () => Array.from(new Set(chargers.map((c) => c.country).filter(Boolean) as string[])).sort(),
    [chargers],
  );

  const toggleStatus = (status: ChargerLifecycleStatus) => {
    const next = filters.statuses.includes(status)
      ? filters.statuses.filter((s) => s !== status)
      : [...filters.statuses, status];
    onChange({ ...filters, statuses: next });
  };

  const toggleVersion = (version: string) => {
    const next = filters.versions.includes(version)
      ? filters.versions.filter((v) => v !== version)
      : [...filters.versions, version];
    onChange({ ...filters, versions: next });
  };

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/40">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-slate-200"
      >
        <span className="flex items-center gap-2">
          <Filter size={14} className="text-blue-400" />
          Filters ({visibleCount} zichtbaar)
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          <input
            type="text"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            placeholder="Zoek naam, plaats of provincie"
            className="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500"
          />

          <div>
            <div className="text-xs text-slate-400 mb-1.5">Status</div>
            <div className="grid grid-cols-2 gap-1">
              {STATUS_ORDER.map((status) => (
                <button
                  key={status}
                  onClick={() => toggleStatus(status)}
                  className={`px-2 py-1.5 rounded text-[11px] font-medium text-left transition-all ${
                    filters.statuses.includes(status)
                      ? "bg-blue-600 text-white"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                  }`}
                >
                  {lifecycleLabels[status]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-400 mb-1.5">Minimale snelheid</div>
            <div className="grid grid-cols-5 gap-1">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => onChange({ ...filters, minSpeedKw: s })}
                  className={`px-1 py-1.5 rounded text-[11px] font-medium ${
                    filters.minSpeedKw === s ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                  }`}
                >
                  {s === 0 ? "Alle" : `${s}+`}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-400 mb-1.5">Versie</div>
            <div className="grid grid-cols-3 gap-1">
              {VERSIONS.map((v) => (
                <button
                  key={v}
                  onClick={() => toggleVersion(v)}
                  className={`px-2 py-1.5 rounded text-[11px] font-medium ${
                    filters.versions.includes(v) ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1">
            {([
              ["trailerOnly", "Aanhangervriendelijk"],
              ["noGarage", "Geen parkeergarage"],
              ["noParkingFee", "Geen parkeergeld"],
              ["openNow", "Nu open"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => onChange({ ...filters, [key]: !filters[key] })}
                className={`px-2 py-1.5 rounded text-[11px] font-medium ${
                  filters[key] ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div>
            <div className="text-xs text-slate-400 mb-1.5">Aantal laadplekken</div>
            <div className="grid grid-cols-3 gap-1">
              <input
                type="number"
                min={0}
                value={filters.minStalls || ""}
                onChange={(e) => onChange({ ...filters, minStalls: Number(e.target.value) || 0, exactStalls: null })}
                placeholder="min"
                className="bg-slate-800 border border-slate-600/50 rounded-lg px-2 py-1.5 text-xs text-white placeholder-slate-500"
              />
              <input
                type="number"
                min={0}
                value={filters.maxStalls || ""}
                onChange={(e) => onChange({ ...filters, maxStalls: Number(e.target.value) || 0, exactStalls: null })}
                placeholder="max"
                className="bg-slate-800 border border-slate-600/50 rounded-lg px-2 py-1.5 text-xs text-white placeholder-slate-500"
              />
              <input
                type="number"
                min={0}
                value={filters.exactStalls ?? ""}
                onChange={(e) =>
                  onChange({ ...filters, exactStalls: e.target.value ? Number(e.target.value) : null })
                }
                placeholder="exact"
                className="bg-slate-800 border border-slate-600/50 rounded-lg px-2 py-1.5 text-xs text-white placeholder-slate-500"
              />
            </div>
          </div>

          <button
            onClick={() => onChange({ ...filters, lowSpeedOnly: !filters.lowSpeedOnly })}
            className={`w-full px-2 py-1.5 rounded text-[11px] font-medium ${
              filters.lowSpeedOnly ? "bg-amber-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
            }`}
          >
            Alleen lage laadsnelheid
          </button>

          {owners.length > 0 && (
            <div>
              <div className="text-xs text-slate-400 mb-1.5">Eigenaar</div>
              <select
                value={filters.ownerId}
                onChange={(e) => onChange({ ...filters, ownerId: e.target.value })}
                className="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="">Alle eigenaren</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <div className="text-xs text-slate-400 mb-1.5">Land</div>
            <select
              value={filters.country}
              onChange={(e) => onChange({ ...filters, country: e.target.value })}
              className="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="">Alle landen</option>
              {countries.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>


          <button
            onClick={() => onChange({ ...defaultChargerFilters })}
            className="w-full px-3 py-2 rounded-lg text-xs bg-slate-800 text-slate-300 hover:bg-slate-700"
          >
            Filters wissen
          </button>
        </div>
      )}
    </div>
  );
}
