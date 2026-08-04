import { useQuery } from "@tanstack/react-query";
import { Megaphone, X } from "lucide-react";
import { useEffect, useState } from "react";
import { listSiteUpdates } from "@/lib/admin.functions";
import type { SiteUpdate } from "@/lib/tesla-types";

const STORAGE_KEY = "seen-site-updates";

const toneByImportance: Record<string, string> = {
  critical: "from-red-500/25 to-red-500/5 border-red-400/40",
  high: "from-amber-500/25 to-amber-500/5 border-amber-400/40",
  normal: "from-blue-500/25 to-blue-500/5 border-blue-400/40",
  low: "from-slate-500/20 to-slate-500/5 border-slate-500/40",
};

/** Toont de nieuwste updates als titel-popup bij het openen van de site. */
export default function SiteUpdatesPopup() {
  const [dismissed, setDismissed] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["site-updates"],
    queryFn: () => listSiteUpdates(),
    staleTime: 60_000,
  });

  const updates: SiteUpdate[] = (data ?? []).filter((u) => u.visible).slice(0, 4);

  useEffect(() => {
    if (updates.length === 0) return;
    let seen: string[] = [];
    try {
      seen = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as string[];
    } catch {
      seen = [];
    }
    const hasNew = updates.some((u) => !seen.includes(u.id));
    if (hasNew) setDismissed(false);
  }, [updates]);

  const close = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updates.map((u) => u.id)));
    } catch {
      /* storage kan geblokkeerd zijn */
    }
  };

  if (dismissed || updates.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-start justify-center bg-slate-950/60 px-4 pt-16 backdrop-blur-sm animate-fade-in">
      <div className="glass-panel w-full max-w-md rounded-2xl p-5 animate-rise-in">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-500/20 text-blue-300">
              <Megaphone size={18} />
            </span>
            <div>
              <h2 className="text-base font-semibold text-white">Nieuwste updates</h2>
              <p className="text-xs text-slate-400">Klik op een titel voor meer informatie</p>
            </div>
          </div>
          <button onClick={close} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <ul className="mt-4 space-y-2">
          {updates.map((u) => {
            const open = expandedId === u.id;
            return (
              <li
                key={u.id}
                className={`rounded-xl border bg-gradient-to-br p-3 transition-all ${toneByImportance[u.importance] ?? toneByImportance["normal"]}`}
              >
                <button
                  onClick={() => setExpandedId(open ? null : u.id)}
                  className="flex w-full items-baseline justify-between gap-3 text-left"
                >
                  <span className="text-sm font-semibold text-white">{u.title}</span>
                  <span className="shrink-0 text-[10px] text-slate-300/80">
                    {new Date(u.publishedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}
                  </span>
                </button>
                {open && (
                  <div className="mt-2 animate-fade-in">
                    {u.body && <p className="whitespace-pre-line text-xs text-slate-200/90">{u.body}</p>}
                    {u.imageUrl && (
                      <img src={u.imageUrl} alt={u.title} loading="lazy" className="mt-2 max-h-48 w-full rounded-lg object-cover" />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <button
          onClick={close}
          className="mt-4 w-full rounded-xl bg-white/10 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/20"
        >
          Aan de slag
        </button>
      </div>
    </div>
  );
}
