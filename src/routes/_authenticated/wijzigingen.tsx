import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/wijzigingen")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Supercharger-wijzigingen — TeslaNavigation" },
      { name: "description", content: "Bekijk de laatste wijzigingen aan Superchargers per aantal en periode." },
    ],
  }),
  component: ChangesPage,
  errorComponent: ({ error }: { error: Error }) => (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <h1 className="text-2xl font-bold">Er ging iets mis</h1>
      <p className="mt-2 text-slate-400">{error.message}</p>
      <Link to="/admin" className="text-red-400 mt-4 inline-block">← Terug naar admin</Link>
    </div>
  ),
  notFoundComponent: () => (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <h1 className="text-2xl font-bold">Niet gevonden</h1>
      <Link to="/admin" className="text-red-400 mt-4 inline-block">← Terug naar admin</Link>
    </div>
  ),
});

type ChangeRow = {
  id: string;
  charger_id: string | null;
  charger_name: string;
  action: string;
  changed_fields: Record<string, { from: unknown; to: unknown }> | null;
  created_at: string;
};

const LIMITS = [10, 20, 30] as const;
const PERIODS = [
  { key: "1", label: "Vandaag", days: 1 },
  { key: "7", label: "7 dagen", days: 7 },
  { key: "30", label: "30 dagen", days: 30 },
  { key: "all", label: "Alles", days: 0 },
] as const;

const actionLabels: Record<string, string> = { create: "Toegevoegd", update: "Gewijzigd", delete: "Verwijderd" };

function fmt(value: unknown) {
  if (value === null || value === undefined) return "leeg";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function ChangesPage() {
  const [limit, setLimit] = useState<number>(10);
  const [period, setPeriod] = useState<string>("7");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [rows, setRows] = useState<ChangeRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("charger_changes")
      .select("id,charger_id,charger_name,action,changed_fields,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (from) query = query.gte("created_at", new Date(`${from}T00:00:00`).toISOString());
    if (to) query = query.lte("created_at", new Date(`${to}T23:59:59`).toISOString());
    if (!from && !to) {
      const preset = PERIODS.find((p) => p.key === period);
      if (preset && preset.days > 0) {
        const since = new Date(Date.now() - preset.days * 86400000).toISOString();
        query = query.gte("created_at", since);
      }
    }

    const { data } = await query;
    setRows((data as unknown as ChangeRow[]) || []);
    setLoading(false);
  }, [limit, period, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-5">
        <div>
          <Link to="/admin" className="text-sm text-slate-400 hover:text-white">← Terug naar admin</Link>
          <h1 className="text-2xl md:text-3xl font-bold mt-1">Laatste Supercharger-wijzigingen</h1>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          {LIMITS.map((n) => (
            <button
              key={n}
              onClick={() => setLimit(n)}
              className={`text-sm px-3 py-1.5 rounded-full border ${
                limit === n ? "bg-blue-600 border-blue-600" : "bg-slate-800 border-slate-700 text-slate-300"
              }`}
            >
              {n}
            </button>
          ))}
          <span className="w-px h-6 bg-slate-700 mx-1" />
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => {
                setPeriod(p.key);
                setFrom("");
                setTo("");
              }}
              className={`text-sm px-3 py-1.5 rounded-full border ${
                period === p.key && !from && !to ? "bg-blue-600 border-blue-600" : "bg-slate-800 border-slate-700 text-slate-300"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 items-center text-sm">
          <label className="text-slate-400">Van</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-2 py-1" />
          <label className="text-slate-400">tot</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-2 py-1" />
          <Button size="sm" variant="outline" className="border-slate-700" onClick={() => { setFrom(""); setTo(""); }}>
            Wissen
          </Button>
        </div>

        {loading ? (
          <div>Laden…</div>
        ) : rows.length === 0 ? (
          <p className="text-slate-400">Geen wijzigingen in deze periode.</p>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              const fields = Object.entries(row.changed_fields || {});
              return (
                <div key={row.id} className="rounded-lg border border-slate-700 bg-slate-800 p-4">
                  <div className="flex justify-between gap-3 flex-wrap">
                    <div className="font-semibold">{row.charger_name || "Onbekende lader"}</div>
                    <div className="text-xs text-slate-400">{new Date(row.created_at).toLocaleString("nl-NL")}</div>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">{actionLabels[row.action] || row.action}</div>
                  {fields.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm">
                      {fields.map(([key, change]) => (
                        <li key={key} className="text-slate-300">
                          <span className="text-slate-400">{key}:</span> {fmt(change?.from)} → <span className="text-white">{fmt(change?.to)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
