import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { listVehicleModels, upsertVehicleModel, deleteVehicleModel } from "@/lib/vehicles.functions";
import type { VehicleModel } from "@/lib/vehicle-types";

export const Route = createFileRoute("/_authenticated/voertuigen")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Voertuigen beheren — TeslaNavigation" },
      { name: "description", content: "Beheer automodellen: accu, verbruik, bouwjaar, laadvermogen, stekkers en foto." },
      { property: "og:title", content: "Voertuigen beheren — TeslaNavigation" },
      { property: "og:description", content: "Beheer automodellen met accu, verbruik, laadvermogen en foto." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VehiclesPage,
});

type Draft = Partial<VehicleModel> & { brand: string; model: string };

const emptyDraft: Draft = {
  brand: "Tesla",
  model: "",
  trim: "",
  batteryKWh: null,
  usableKWh: null,
  rangeKm: null,
  consumptionKWh100: null,
  yearFrom: null,
  yearTo: null,
  maxChargeKw: null,
  connectors: ["Type 2", "CCS"],
  imageUrl: "",
  notes: "",
  published: true,
};

function numOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function VehiclesPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [rows, setRows] = useState<VehicleModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [search, setSearch] = useState("");

  const fetchList = useServerFn(listVehicleModels);
  const saveFn = useServerFn(upsertVehicleModel);
  const removeFn = useServerFn(deleteVehicleModel);

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return setIsAdmin(false);
      const { data } = await supabase.rpc("has_role", { _user_id: userData.user.id, _role: "admin" });
      setIsAdmin(!!data);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchList({}));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Laden mislukt");
    }
    setLoading(false);
  }, [fetchList]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const save = async () => {
    if (!editing) return;
    if (!editing.brand.trim() || !editing.model.trim()) {
      toast.error("Merk en model zijn verplicht");
      return;
    }
    try {
      await saveFn({
        data: {
          id: editing.id,
          brand: editing.brand.trim(),
          model: editing.model.trim(),
          trim: editing.trim?.trim() || null,
          batteryKWh: editing.batteryKWh ?? null,
          usableKWh: editing.usableKWh ?? null,
          rangeKm: editing.rangeKm ?? null,
          consumptionKWh100: editing.consumptionKWh100 ?? null,
          yearFrom: editing.yearFrom ?? null,
          yearTo: editing.yearTo ?? null,
          maxChargeKw: editing.maxChargeKw ?? null,
          connectors: editing.connectors?.length ? editing.connectors : ["Type 2", "CCS"],
          imageUrl: editing.imageUrl?.trim() || null,
          notes: editing.notes?.trim() || null,
          published: editing.published !== false,
        },
      });
      toast.success("Opgeslagen");
      setEditing(null);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Opslaan mislukt");
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Dit voertuig verwijderen?")) return;
    try {
      await removeFn({ data: { id } });
      toast.success("Verwijderd");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Verwijderen mislukt");
    }
  };

  if (isAdmin === null) return <div className="min-h-screen bg-slate-900 text-white p-8">Laden…</div>;
  if (!isAdmin)
    return (
      <div className="min-h-screen bg-slate-900 text-white p-8">
        <h1 className="text-2xl font-bold">Geen toegang</h1>
        <Link to="/" className="text-red-400 mt-4 inline-block">← Terug naar de kaart</Link>
      </div>
    );

  const filtered = rows.filter((v) =>
    `${v.brand} ${v.model} ${v.trim ?? ""}`.toLowerCase().includes(search.toLowerCase())
  );

  const toggleConnector = (name: string) => {
    if (!editing) return;
    const current = editing.connectors ?? [];
    setEditing({
      ...editing,
      connectors: current.includes(name) ? current.filter((c) => c !== name) : [...current, name],
    });
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
          <div>
            <Link to="/admin" className="text-sm text-slate-400 hover:text-white">← Terug naar admin</Link>
            <h1 className="text-2xl md:text-3xl font-bold mt-1">Voertuigen beheren</h1>
            <p className="text-sm text-slate-400">{rows.length} modellen</p>
          </div>
          <Button onClick={() => setEditing({ ...emptyDraft })} className="bg-red-600 hover:bg-red-700">
            <Plus className="w-4 h-4 mr-1" /> Nieuw model
          </Button>
        </div>

        <Input
          placeholder="Zoek op merk, model of uitvoering…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-slate-800 border-slate-700 mb-4"
        />

        {loading ? (
          <div>Laden…</div>
        ) : (
          <div className="rounded-lg border border-slate-700 overflow-hidden">
            <div className="max-h-[70vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-800 sticky top-0">
                  <tr className="text-left">
                    <th className="p-3">Foto</th>
                    <th className="p-3">Voertuig</th>
                    <th className="p-3">Accu</th>
                    <th className="p-3">Bereik</th>
                    <th className="p-3">Verbruik</th>
                    <th className="p-3">Laadvermogen</th>
                    <th className="p-3">Bouwjaar</th>
                    <th className="p-3">Stekkers</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((v) => (
                    <tr key={v.id} className="border-t border-slate-700 hover:bg-slate-800/50">
                      <td className="p-3">
                        {v.imageUrl ? (
                          <img src={v.imageUrl} alt={`${v.brand} ${v.model}`} loading="lazy" className="w-16 h-10 object-cover rounded" />
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        {v.brand} {v.model} {v.trim ?? ""}
                        {!v.published && <span className="ml-2 text-amber-300 text-xs">Concept</span>}
                      </td>
                      <td className="p-3 text-slate-300">{v.batteryKWh ? `${v.batteryKWh} kWh` : "—"}</td>
                      <td className="p-3 text-slate-300">{v.rangeKm ? `${v.rangeKm} km` : "—"}</td>
                      <td className="p-3 text-slate-300">{v.consumptionKWh100 ? `${v.consumptionKWh100} kWh/100` : "—"}</td>
                      <td className="p-3 text-slate-300">{v.maxChargeKw ? `${v.maxChargeKw} kW` : "—"}</td>
                      <td className="p-3 text-slate-300">{v.yearFrom ? `${v.yearFrom}${v.yearTo ? `–${v.yearTo}` : "+"}` : "—"}</td>
                      <td className="p-3 text-slate-300">{v.connectors.join(", ")}</td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => setEditing({ ...v })}><Pencil className="w-4 h-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => remove(v.id)}><Trash2 className="w-4 h-4 text-red-400" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Voertuig bewerken" : "Nieuw voertuig"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400">Merk</label>
                <Input className="bg-slate-800 border-slate-700" value={editing.brand} onChange={(e) => setEditing({ ...editing, brand: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-slate-400">Model</label>
                <Input className="bg-slate-800 border-slate-700" value={editing.model} onChange={(e) => setEditing({ ...editing, model: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-slate-400">Uitvoering</label>
                <Input className="bg-slate-800 border-slate-700" value={editing.trim ?? ""} onChange={(e) => setEditing({ ...editing, trim: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-slate-400">Accu (kWh)</label>
                <Input type="number" className="bg-slate-800 border-slate-700" value={editing.batteryKWh ?? ""} onChange={(e) => setEditing({ ...editing, batteryKWh: numOrNull(e.target.value) })} />
              </div>
              <div>
                <label className="text-xs text-slate-400">Bruikbaar (kWh)</label>
                <Input type="number" className="bg-slate-800 border-slate-700" value={editing.usableKWh ?? ""} onChange={(e) => setEditing({ ...editing, usableKWh: numOrNull(e.target.value) })} />
              </div>
              <div>
                <label className="text-xs text-slate-400">Bereik (km)</label>
                <Input type="number" className="bg-slate-800 border-slate-700" value={editing.rangeKm ?? ""} onChange={(e) => setEditing({ ...editing, rangeKm: numOrNull(e.target.value) })} />
              </div>
              <div>
                <label className="text-xs text-slate-400">Verbruik (kWh/100 km)</label>
                <Input type="number" step="0.1" className="bg-slate-800 border-slate-700" value={editing.consumptionKWh100 ?? ""} onChange={(e) => setEditing({ ...editing, consumptionKWh100: numOrNull(e.target.value) })} />
              </div>
              <div>
                <label className="text-xs text-slate-400">Max laadvermogen (kW)</label>
                <Input type="number" className="bg-slate-800 border-slate-700" value={editing.maxChargeKw ?? ""} onChange={(e) => setEditing({ ...editing, maxChargeKw: numOrNull(e.target.value) })} />
              </div>
              <div>
                <label className="text-xs text-slate-400">Bouwjaar vanaf</label>
                <Input type="number" className="bg-slate-800 border-slate-700" value={editing.yearFrom ?? ""} onChange={(e) => setEditing({ ...editing, yearFrom: numOrNull(e.target.value) })} />
              </div>
              <div>
                <label className="text-xs text-slate-400">Bouwjaar tot</label>
                <Input type="number" className="bg-slate-800 border-slate-700" value={editing.yearTo ?? ""} onChange={(e) => setEditing({ ...editing, yearTo: numOrNull(e.target.value) })} />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-400">Foto (URL)</label>
                <Input className="bg-slate-800 border-slate-700" placeholder="https://…" value={editing.imageUrl ?? ""} onChange={(e) => setEditing({ ...editing, imageUrl: e.target.value })} />
                {editing.imageUrl ? (
                  <img src={editing.imageUrl} alt="Voorbeeld voertuigfoto" className="mt-2 h-28 rounded object-cover" />
                ) : null}
              </div>
              <div className="col-span-2 flex items-center gap-4">
                <span className="text-xs text-slate-400">Stekkers:</span>
                {["Type 2", "CCS"].map((c) => (
                  <label key={c} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="accent-red-500" checked={(editing.connectors ?? []).includes(c)} onChange={() => toggleConnector(c)} />
                    {c}
                  </label>
                ))}
                <label className="flex items-center gap-2 text-sm ml-auto">
                  <input type="checkbox" className="accent-red-500" checked={editing.published !== false} onChange={(e) => setEditing({ ...editing, published: e.target.checked })} />
                  Gepubliceerd
                </label>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-400">Notities</label>
                <Input className="bg-slate-800 border-slate-700" value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Annuleren</Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={save}>Opslaan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
