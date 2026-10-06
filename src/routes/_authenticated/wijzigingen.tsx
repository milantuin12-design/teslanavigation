import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { lifecycleLabels } from "@/lib/tesla-utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/wijzigingen")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Supercharger-wijzigingen — TeslaNavigation" },
      { name: "description", content: "Bekijk de laatste wijzigingen aan Superchargers per aantal en periode." },
    ],
  }),
  component: ChangesPage,
  errorComponent: ({ error }: { error: any }) => (
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

const STATUS_KEYS = Object.keys(lifecycleLabels) as (keyof typeof lifecycleLabels)[];

function fmt(value: unknown) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" && value in lifecycleLabels) return lifecycleLabels[value as keyof typeof lifecycleLabels];
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
      .limit(limit * 3);

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
    // Alleen statuswijzigingen (plus toevoegen/verwijderen) — foto's e.d. horen hier niet.
    const onlyStatus = ((data as unknown as ChangeRow[]) || [])
      .filter((r) => r.action !== "update" || !!r.changed_fields?.status)
      .slice(0, limit);
    setRows(onlyStatus);
    setLoading(false);
  }, [limit, period, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; from: string; to: string }>({ name: "", from: "", to: "" });
  const saveEdit = async (row: ChangeRow) => {
    const changed = { ...(row.changed_fields || {}), status: { from: draft.from || null, to: draft.to || null } };
    const { error } = await supabase.from("charger_changes").update({ charger_name: draft.name, changed_fields: changed }).eq("id", row.id);
    if (error) { toast.error("Opslaan mislukt (alleen admins)"); return; }
    toast.success("Wijziging aangepast");
    setEditId(null);
    load();
  };
  const removeRow = async (id: string) => {
    if (!confirm("Deze wijziging verwijderen?")) return;
    const { error } = await supabase.from("charger_changes").delete().eq("id", id);
    if (error) { toast.error("Verwijderen mislukt (alleen admins)"); return; }
    load();
  };

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
              const fields = Object.entries(row.changed_fields || {}).filter(([k]) => k === "status");
              if (editId === row.id) {
                return (
                  <div key={row.id} className="rounded-lg border border-blue-600 bg-slate-800 p-4 space-y-2 text-sm">
                    <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1" />
                    <div className="flex flex-wrap gap-2 items-center">
                      <select value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} className="bg-slate-900 border border-slate-700 rounded px-2 py-1">
                        <option value="">—</option>
                        {STATUS_KEYS.map((k) => <option key={k} value={k}>{lifecycleLabels[k]}</option>)}
                      </select>
                      <span>→</span>
                      <select value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} className="bg-slate-900 border border-slate-700 rounded px-2 py-1">
                        <option value="">—</option>
                        {STATUS_KEYS.map((k) => <option key={k} value={k}>{lifecycleLabels[k]}</option>)}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => saveEdit(row)}>Opslaan</Button>
                      <Button size="sm" variant="outline" className="border-slate-700" onClick={() => setEditId(null)}>Annuleren</Button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={row.id} className="rounded-lg border border-slate-700 bg-slate-800 p-4">
                  <div className="flex justify-between gap-3 flex-wrap">
                    <div className="font-semibold">{row.charger_name || "Onbekende lader"}</div>
                    <div className="text-xs text-slate-400">{new Date(row.created_at).toLocaleString("nl-NL")}</div>
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <div className="text-xs text-slate-400">{actionLabels[row.action] || row.action}</div>
                    <div className="flex gap-2 text-xs">
                      <button className="text-blue-300 hover:underline" onClick={() => { setEditId(row.id); setDraft({ name: row.charger_name, from: String(row.changed_fields?.status?.from ?? ""), to: String(row.changed_fields?.status?.to ?? "") }); }}>Aanpassen</button>
                      <button className="text-red-400 hover:underline" onClick={() => removeRow(row.id)}>Verwijderen</button>
                    </div>
                  </div>
                  {fields.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm">
                      {fields.map(([key, change]) => (
                        <li key={key} className="text-slate-300">
                          <span className="text-slate-400">Status:</span> {fmt(change?.from)} → <span className="text-white">{fmt(change?.to)}</span>
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
