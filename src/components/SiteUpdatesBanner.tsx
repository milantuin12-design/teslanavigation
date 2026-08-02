import { useQuery } from "@tanstack/react-query";
import { Megaphone, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { listSiteUpdates } from "@/lib/admin.functions";

const importanceStyles: Record<string, string> = {
  critical: "border-red-500/50 bg-red-500/10 text-red-200",
  high: "border-amber-500/50 bg-amber-500/10 text-amber-200",
  normal: "border-blue-500/40 bg-blue-500/10 text-blue-200",
  low: "border-slate-600/50 bg-slate-800/60 text-slate-300",
};

export default function SiteUpdatesBanner() {
  const [open, setOpen] = useState(true);
  const { data } = useQuery({
    queryKey: ["site-updates"],
    queryFn: () => listSiteUpdates(),
    staleTime: 60_000,
  });

  const updates = (data ?? []).filter((u) => u.visible).slice(0, 5);
  if (updates.length === 0) return null;

  const latest = updates[0]!;

  return (
    <div className={`rounded-xl border ${importanceStyles[latest.importance] ?? importanceStyles["normal"]} backdrop-blur`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm font-medium"
      >
        <span className="flex items-center gap-2 truncate">
          <Megaphone size={14} />
          <span className="truncate">Nieuwste updates — {latest.title}</span>
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {open && (
        <ul className="px-3 pb-3 space-y-2">
          {updates.map((u) => (
            <li key={u.id} className="rounded-lg bg-slate-900/50 p-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-white">{u.title}</span>
                <span className="text-[10px] text-slate-400 shrink-0">
                  {new Date(u.publishedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}
                </span>
              </div>
              {u.body && <p className="mt-1 text-xs text-slate-300 whitespace-pre-line">{u.body}</p>}
              {u.imageUrl && (
                <img src={u.imageUrl} alt={u.title} loading="lazy" className="mt-2 rounded-lg max-h-40 w-full object-cover" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
