import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Trash2, Pencil, Plus, Truck, X } from "lucide-react";
import type { ChargerConfig } from "@/lib/tesla-types";
import type { Json } from "@/integrations/supabase/types";
import { parseChargerConfigsFromLegacy } from "@/lib/tesla-utils";

export const Route = createFileRoute("/_authenticated/admin")({
  ssr: false,
  head: () => ({ meta: [{ title: "Admin — Superchargers" }] }),
  component: AdminPage,
});

type Charger = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  country: string;
  total_stalls: number | null;
  stall_types: string | null;
  max_speed_kw: number | null;
  versions: string[] | null;
  opening_time: string | null;
  closing_time: string | null;
  trailer_friendly: boolean;
  is_available: boolean;
  charger_configs: ChargerConfig[] | null;
};

const emptyCharger = {
  name: "", lat: 0, lng: 0, country: "",
  total_stalls: null as number | null, stall_types: null as string | null,
  max_speed_kw: null as number | null, versions: [] as string[],
  opening_time: null as string | null, closing_time: null as string | null,
  trailer_friendly: false, is_available: true,
  charger_configs: [{ count: 8, version: "V3", speedKw: 250 }] as ChargerConfig[],
};

function normalizeConfigs(configs?: ChargerConfig[] | null): ChargerConfig[] {
  return (configs || [])
    .map((config) => ({
      count: Number(config.count) || 0,
      version: String(config.version || "V3").toUpperCase(),
      speedKw: Number(config.speedKw) || 0,
    }))
    .filter((config) => config.count > 0 && config.speedKw > 0);
}

function configSummary(configs?: ChargerConfig[] | null) {
  const normalized = normalizeConfigs(configs);
  return normalized.length > 0
    ? normalized.map((config) => `${config.count} ${config.version} laders ${config.speedKw}kW`).join(" · ")
    : "-";
}

function configsForCharger(charger: Charger): ChargerConfig[] {
  const direct = normalizeConfigs(charger.charger_configs);
  return direct.length > 0
    ? direct
    : parseChargerConfigsFromLegacy(charger.stall_types, charger.total_stalls, charger.max_speed_kw, charger.versions);
}

function totalFromConfigs(configs?: ChargerConfig[] | null) {
  const total = normalizeConfigs(configs).reduce((sum, config) => sum + config.count, 0);
  return total > 0 ? total : null;
}

function maxSpeedFromConfigs(configs?: ChargerConfig[] | null) {
  const speeds = normalizeConfigs(configs).map((config) => config.speedKw);
  return speeds.length > 0 ? Math.max(...speeds) : null;
}

function versionsFromConfigs(configs?: ChargerConfig[] | null) {
  return Array.from(new Set(normalizeConfigs(configs).map((config) => config.version)));
}

function AdminPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [chargers, setChargers] = useState<Charger[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Partial<Charger> | null>(null);
  const [coordsInput, setCoordsInput] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      const { data } = await supabase.rpc("has_role", { _user_id: userData.user.id, _role: "admin" });
      setIsAdmin(!!data);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const rows: Charger[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("superchargers")
        .select("id,name,lat,lng,country,total_stalls,stall_types,max_speed_kw,versions,opening_time,closing_time,trailer_friendly,is_available,charger_configs")
        .order("name").range(from, from + 999);
      if (error) { toast.error(error.message); break; }
      rows.push(...(data as Charger[]));
      if (!data || data.length < 1000) break;
    }
    setChargers(rows);
    setLoading(false);
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const openNew = () => { setEditing({ ...emptyCharger }); setCoordsInput(""); };
  const openEdit = (c: Charger) => { setEditing({ ...c, charger_configs: configsForCharger(c) }); setCoordsInput(`${c.lat},${c.lng}`); };

  const save = async () => {
    if (!editing) return;
    const parts = coordsInput.split(",").map((s) => parseFloat(s.trim()));
    if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
      toast.error("Coordinaten moeten 'lat,lng' zijn — bijv. 52.3702,4.8952");
      return;
    }
    const payload = {
      charger_configs: normalizeConfigs(editing.charger_configs).map((config) => ({ ...config })) as Json,
      name: editing.name || "",
      lat: parts[0], lng: parts[1],
      country: editing.country || "",
      total_stalls: totalFromConfigs(editing.charger_configs),
      stall_types: configSummary(editing.charger_configs).replaceAll(" · ", " - "),
      max_speed_kw: maxSpeedFromConfigs(editing.charger_configs),
      versions: versionsFromConfigs(editing.charger_configs),
      opening_time: editing.opening_time || null,
      closing_time: editing.closing_time || null,
      trailer_friendly: !!editing.trailer_friendly,
      is_available: editing.is_available !== false,
    };
    if (editing.id) {
      const { error } = await supabase.from("superchargers").update(payload).eq("id", editing.id);
      if (error) { toast.error(error.message); return; }
      toast.success("Bijgewerkt");
    } else {
      const { error } = await supabase.from("superchargers").insert(payload);
      if (error) { toast.error(error.message); return; }
      toast.success("Toegevoegd");
    }
    setEditing(null);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Weet je zeker dat je deze supercharger wilt verwijderen?")) return;
    const { error } = await supabase.from("superchargers").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Verwijderd"); load();
  };

  if (isAdmin === null) return <div className="min-h-screen bg-slate-900 text-white p-8">Laden…</div>;
  if (!isAdmin) return (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <h1 className="text-2xl font-bold">Geen toegang</h1>
      <p className="mt-2 text-slate-400">Alleen admins hebben toegang tot deze pagina.</p>
      <Link to="/" className="text-red-400 mt-4 inline-block">← Terug naar de kaart</Link>
    </div>
  );

  const filtered = chargers.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()) || (c.country || "").toLowerCase().includes(search.toLowerCase()));
  const versionOpts = ["V2", "V3", "V4"];

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <div>
            <Link to="/" className="text-sm text-slate-400 hover:text-white">← Terug naar kaart</Link>
            <h1 className="text-2xl md:text-3xl font-bold mt-1">Superchargers beheren</h1>
            <p className="text-sm text-slate-400">{chargers.length} laders totaal</p>
          </div>
          <Button onClick={openNew} className="bg-red-600 hover:bg-red-700"><Plus className="w-4 h-4 mr-1" /> Nieuw</Button>
        </div>
        <Input placeholder="Zoek op naam of land…" value={search} onChange={(e) => setSearch(e.target.value)} className="bg-slate-800 border-slate-700 mb-4" />
        {loading ? <div>Laden…</div> : (
          <div className="rounded-lg border border-slate-700 overflow-hidden">
            <div className="max-h-[70vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-800 sticky top-0">
                  <tr className="text-left">
                    <th className="p-3">Naam</th><th className="p-3">Land</th><th className="p-3">Laders</th><th className="p-3">Tijden</th><th className="p-3">Status</th><th className="p-3">🚚</th><th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} className="border-t border-slate-700 hover:bg-slate-800/50">
                      <td className="p-3">{c.name}</td>
                      <td className="p-3">{c.country}</td>
                      <td className="p-3 max-w-xs text-slate-300">{configSummary(configsForCharger(c))}</td>
                      <td className="p-3">{c.opening_time && c.closing_time ? `${c.opening_time}-${c.closing_time}` : "24/7"}</td>
                      <td className="p-3">{c.is_available === false ? <span className="text-red-400">Niet beschikbaar</span> : <span className="text-green-400">Beschikbaar</span>}</td>
                      <td className="p-3">{c.trailer_friendly ? "✓" : "-"}</td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(c)}><Pencil className="w-4 h-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => remove(c.id)}><Trash2 className="w-4 h-4 text-red-400" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Supercharger bewerken" : "Nieuwe supercharger"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div><Label>Naam</Label><Input value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="bg-slate-800 border-slate-700" /></div>
              <div><Label>Land</Label><Input value={editing.country || ""} onChange={(e) => setEditing({ ...editing, country: e.target.value })} className="bg-slate-800 border-slate-700" /></div>
              <div><Label>Coordinaten (lat,lng)</Label><Input value={coordsInput} onChange={(e) => setCoordsInput(e.target.value)} placeholder="52.3702,4.8952" className="bg-slate-800 border-slate-700" /></div>
              <div>
                <Label>Laders</Label>
                <div className="space-y-2 mt-2">
                  {(editing.charger_configs || []).map((config, index) => (
                    <div key={index} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                      <Input type="number" min={1} value={config.count || ""} onChange={(e) => {
                        const next = [...(editing.charger_configs || [])];
                        next[index] = { ...config, count: parseInt(e.target.value) || 0 };
                        setEditing({ ...editing, charger_configs: next });
                      }} placeholder="Aantal" className="bg-slate-800 border-slate-700" />
                      <select value={config.version || "V3"} onChange={(e) => {
                        const version = e.target.value;
                        const next = [...(editing.charger_configs || [])];
                        next[index] = { ...config, version, speedKw: version === "V4" ? 325 : version === "V3" ? 250 : 150 };
                        setEditing({ ...editing, charger_configs: next });
                      }} className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm">
                        {versionOpts.map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                      <Input type="number" min={1} value={config.speedKw || ""} onChange={(e) => {
                        const next = [...(editing.charger_configs || [])];
                        next[index] = { ...config, speedKw: parseInt(e.target.value) || 0 };
                        setEditing({ ...editing, charger_configs: next });
                      }} placeholder="kW" className="bg-slate-800 border-slate-700" />
                      <Button size="icon" variant="ghost" onClick={() => setEditing({ ...editing, charger_configs: (editing.charger_configs || []).filter((_, i) => i !== index) })}>
                        <X className="w-4 h-4 text-red-400" />
                      </Button>
                    </div>
                  ))}
                  <Button type="button" variant="outline" onClick={() => setEditing({ ...editing, charger_configs: [...(editing.charger_configs || []), { count: 8, version: "V3", speedKw: 250 }] })}>
                    <Plus className="w-4 h-4 mr-1" /> Laderregel toevoegen
                  </Button>
                  <p className="text-xs text-slate-400">Voorbeeld: 8 V2 laders 150kW en 16 V3 laders 250kW.</p>
                </div>
              </div>
              <div>
                <Label>Versies</Label>
                <div className="flex gap-4 mt-2 opacity-60">
                  {versionOpts.map((v) => {
                    const on = versionsFromConfigs(editing.charger_configs).includes(v);
                    return (
                      <label key={v} className="flex items-center gap-2 cursor-pointer">
                        <Checkbox checked={on} disabled />
                        {v}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Open vanaf (HH:MM)</Label><Input type="time" value={editing.opening_time || ""} onChange={(e) => setEditing({ ...editing, opening_time: e.target.value || null })} className="bg-slate-800 border-slate-700" /></div>
                <div><Label>Dicht vanaf</Label><Input type="time" value={editing.closing_time || ""} onChange={(e) => setEditing({ ...editing, closing_time: e.target.value || null })} className="bg-slate-800 border-slate-700" /></div>
              </div>
              <p className="text-xs text-slate-400">Beide leeg = 24/7 open</p>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={editing.is_available !== false} onCheckedChange={(c) => setEditing({ ...editing, is_available: !!c })} />
                Beschikbaar
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={!!editing.trailer_friendly} onCheckedChange={(c) => setEditing({ ...editing, trailer_friendly: !!c })} />
                <Truck className="w-4 h-4" /> Aanhangervriendelijk (doorrijbaar met aanhanger)
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Annuleren</Button>
            <Button onClick={save} className="bg-red-600 hover:bg-red-700">Opslaan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
