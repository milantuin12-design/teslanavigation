import { useMemo, useState } from "react";
import { Filter, ChevronDown, ChevronUp, Sparkles, X } from "lucide-react";
import type { ChargerFilterState, ChargerLifecycleStatus, Supercharger } from "@/lib/tesla-types";
import { defaultChargerFilters } from "@/lib/tesla-types";
import { lifecycleLabels } from "@/lib/tesla-utils";

// 'plan' is hier definitief verwijderd
const STATUS_ORDER: ChargerLifecycleStatus[] = [
  "voting",
  "permit",
  "construction",
  "operational",
  "expanding",
  "works",
  "works_closed",
  "temp_closed",
  "long_closed",
  "permanent_closed",
  "unknown",
];

const SPEEDS = [0, 100, 125, 150, 200, 250];
const VERSIONS = ["V2", "V3", "V4"];

interface Props {
  filters: ChargerFilterState;
  onChange: (filters: ChargerFilterState) => void;
  chargers: Supercharger[];
  visibleCount: number;
  owners?: { id: string; name: string }[];
}

export default function ChargerFilters({ filters, onChange, chargers, visibleCount, owners = [] }: Props) {
  const [open, setOpen] = useState(false);

  // Alleen landen tonen die daadwerkelijk laders hebben
  const countries = useMemo(
    () => Array.from(new Set(chargers.map((c) => c.country).filter(Boolean) as string[])).sort(),
    [chargers],
  );

  // Tellen per status: alleen statussen tonen die minimaal 1 lader hebben (en geen 'plan')
  const availableStatuses = useMemo(() => {
    const counts: Partial<Record<ChargerLifecycleStatus, number>> = {};
    for (const c of chargers) {
      if (c.status && c.status !== "plan") {
        counts[c.status] = (counts[c.status] || 0) + 1;
      }
    }
    return STATUS_ORDER.filter((s) => (counts[s] || 0) > 0).map((s) => ({
      status: s,
      count: counts[s] || 0,
    }));
  }, [chargers]);

  // Alleen versies tonen die daadwerkelijk voorkomen
  const availableVersions = useMemo(() => {
    const counts: Record<string, number> = { V2: 0, V3: 0, V4: 0 };
    for (const c of chargers) {
      const v = (c.stallType || "").toUpperCase();
      if (v.includes("V2")) counts.V2 = (counts.V2 || 0) + 1;
      if (v.includes("V3")) counts.V3 = (counts.V3 || 0) + 1;
      if (v.includes("V4")) counts.V4 = (counts.V4 || 0) + 1;
    }
    return VERSIONS.filter((v) => (counts[v] || 0) > 0);
  }, [chargers]);

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

  const hasActiveFilters =
    filters.search ||
    filters.statuses.length > 0 ||
    filters.minSpeedKw > 0 ||
    filters.versions.length > 0 ||
    filters.trailerOnly ||
    filters.noGarage ||
    filters.noParkingFee ||
    filters.openNow ||
    filters.lowSpeedOnly ||
    filters.country ||
    filters.ownerId;

  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 backdrop-blur-md shadow-xl overflow-hidden transition-all">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3.5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800/40 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Filter size={15} className="text-blue-400" />
          <span>Filters</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-mono font-normal">
            {visibleCount} laders
          </span>
        </span>
        {open ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>

      {open && (
        <div className="p-3.5 space-y-4 border-t border-slate-800/80 text-xs">
          {/* Zoekbalk */}
          <input
            type="text"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            placeholder="🔍 Zoek op naam of plaats…"
            className="w-full bg-slate-950/70 border border-slate-700/60 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/80 transition-colors"
          />

          {/* Statussen (alleen actieve en zonder Plan) */}
          <div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Status</div>
            <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto pr-1">
              {availableStatuses.map(({ status, count }) => {
                const active = filters.statuses.includes(status);
                return (
                  <button
                    key={status}
                    onClick={() => toggleStatus(status)}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                      active
                        ? "bg-blue-600 text-white shadow-sm shadow-blue-500/30"
                        : "bg-slate-800/70 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-700/40"
                    }`}
                  >
                    <span className="truncate">{lifecycleLabels[status]}</span>
                    <span className={`text-[10px] ml-1 font-mono ${active ? "text-blue-200" : "text-slate-400"}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Minimale laadsnelheid */}
          <div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Min. snelheid</div>
            <div className="grid grid-cols-6 gap-1">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => onChange({ ...filters, minSpeedKw: s })}
                  className={`py-1.5 rounded-md text-[11px] font-medium text-center transition-all ${
                    filters.minSpeedKw === s
                      ? "bg-blue-600 text-white shadow-sm"
                      : "bg-slate-800/70 text-slate-300 hover:bg-slate-800 border border-slate-700/40"
                  }`}
                >
                  {s === 0 ? "Alle" : `${s}`}
                </button>
              ))}
            </div>
          </div>

          {/* Versie (alleen aanwezige versies) */}
          {availableVersions.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Supercharger Versie</div>
              <div className="grid grid-cols-3 gap-1.5">
                {availableVersions.map((v) => (
                  <button
                    key={v}
                    onClick={() => toggleVersion(v)}
                    className={`py-1.5 rounded-lg text-[11px] font-medium text-center transition-all ${
                      filters.versions.includes(v)
                        ? "bg-blue-600 text-white shadow-sm"
                        : "bg-slate-800/70 text-slate-300 hover:bg-slate-800 border border-slate-700/40"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Eigenschappen toggles */}
          <div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Eigenschappen</div>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                ["trailerOnly", "Aanhanger vriendelijk"],
                ["noGarage", "Geen parkeergarage"],
                ["noParkingFee", "Geen parkeergeld"],
                ["openNow", "Nu geopend"],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => onChange({ ...filters, [key]: !filters[key] })}
                  className={`px-2 py-1.5 rounded-lg text-[11px] font-medium text-left transition-all ${
                    filters[key]
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "bg-slate-800/70 text-slate-300 hover:bg-slate-800 border border-slate-700/40"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Land */}
          {countries.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Land</div>
              <select
                value={filters.country}
                onChange={(e) => onChange({ ...filters, country: e.target.value })}
                className="w-full bg-slate-950/70 border border-slate-700/60 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none"
              >
                <option value="">Alle landen ({countries.length})</option>
                {countries.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}

          {/* Filter wissen */}
          {hasActiveFilters && (
            <button
              onClick={() => onChange({ ...defaultChargerFilters })}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30 transition-all"
            >
              <X size={13} />
              Alle filters wissen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

}
