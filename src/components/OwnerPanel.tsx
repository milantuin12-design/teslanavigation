import { Building2, ExternalLink, X } from "lucide-react";
import type { Supercharger } from "@/lib/tesla-types";

interface OwnerPanelProps {
  ownerId: string | null;
  chargers: Supercharger[];
  onClose: () => void;
  onSelectCharger?: (charger: Supercharger) => void;
}

/** Overzicht van één eigenaar plus alle Superchargers van die eigenaar. */
export default function OwnerPanel({ ownerId, chargers, onClose, onSelectCharger }: OwnerPanelProps) {
  if (!ownerId) return null;

  const owned = chargers.filter((c) => c.ownerId === ownerId);
  const first = owned[0];
  const name = first?.ownerName ?? "Onbekende eigenaar";
  const logo = first?.ownerLogoUrl ?? null;
  const description = first?.ownerDescription ?? null;
  const website = first?.ownerWebsite ?? null;
  const contact = first?.ownerContact ?? null;
  const notes = first?.ownerNotes ?? null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-950/60 px-4 backdrop-blur-sm animate-fade-in">
      <div className="glass-panel flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl p-5 animate-rise-in">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {logo ? (
              <img src={logo} alt={name} className="h-11 w-11 rounded-xl bg-white/10 object-contain p-1" />
            ) : (
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-500/20 text-blue-300">
                <Building2 size={20} />
              </span>
            )}
            <div>
              <h2 className="text-lg font-semibold text-white">{name}</h2>
              <p className="text-xs text-slate-400">{owned.length} laadlocaties</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {(description || website || contact || notes) && (
          <div className="mt-4 space-y-2 border-y border-slate-700/70 py-3 text-sm text-slate-300">
            {description && <p>{description}</p>}
            {website && (
              <a href={website} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-blue-300 hover:text-blue-200">
                <ExternalLink size={14} /> Website bekijken
              </a>
            )}
            {contact && <p><span className="text-slate-500">Contact:</span> {contact}</p>}
            {notes && <p className="text-xs text-slate-400">{notes}</p>}
          </div>
        )}

        <ul className="mt-4 space-y-1.5 overflow-y-auto pr-1">
          {owned.map((charger) => (
            <li key={charger.id ?? `${charger.lat},${charger.lng}`}>
              <button
                onClick={() => onSelectCharger?.(charger)}
                className="elevated-card flex w-full items-center justify-between gap-3 rounded-xl bg-slate-900/60 px-3 py-2.5 text-left hover:bg-slate-800/70"
              >
                <span>
                  <span className="block text-sm font-medium text-white">{charger.name}</span>
                  <span className="block text-[11px] text-slate-400">
                    {[charger.city, charger.country].filter(Boolean).join(", ")}
                  </span>
                </span>
                <ExternalLink size={14} className="shrink-0 text-slate-500" />
              </button>
            </li>
          ))}
          {owned.length === 0 && <li className="text-sm text-slate-400">Geen laders gekoppeld aan deze eigenaar.</li>}
        </ul>
      </div>
    </div>
  );
}
