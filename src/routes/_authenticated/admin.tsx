import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Trash2, Pencil, Plus } from "lucide-react";

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
};

const emptyCharger = {
  name: "", lat: 0, lng: 0, country: "",
  total_stalls: null as number | null, stall_types: null as string | null,
  max_speed_kw: null as number | null, versions: [] as string[],
  opening_time: null as string | null, closing_time: null as string | null,
  trailer_friendly: false,
};

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
        .select("id,name,lat,lng,country,total_stalls,stall_types,max_speed_kw,versions,opening_time,closing_time,trailer_friendly")
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
  const openEdit = (c: Charger) => { setEditing({ ...c }); setCoordsInput(`${c.lat},${c.lng}`); };

  const save = async () => {
    if (!editing) return;
    const parts = coordsInput.split(",").map((s) => parseFloat(s.trim()));
    if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
      toast.error("Coordinaten moeten 'lat,lng' zijn — bijv. 52.3702,4.8952");
      return;
    }
    const payload = {
      name: editing.name || "",
      lat: parts[0], lng: parts[1],
      country: editing.country || "",
      total_stalls: editing.total_stalls ?? null,
      stall_types: editing.stall_types ?? null,
      max_speed_kw: editing.max_speed_kw ?? null,
      versions: editing.versions ?? [],
      opening_time: editing.opening_time || null,
      closing_time: editing.closing_time || null,
      trailer_friendly: !!editing.trailer_friendly,
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
                    <th className="p-3">Naam</th><th className="p-3">Land</th><th className="p-3">Laders</th><th className="p-3">Snelheid</th><th className="p-3">Versies</th><th className="p-3">Tijden</th><th className="p-3">🚚</th><th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} className="border-t border-slate-700 hover:bg-slate-800/50">
                      <td className="p-3">{c.name}</td>
                      <td className="p-3">{c.country}</td>
                      <td className="p-3">{c.total_stalls ?? "?"}</td>
                      <td className="p-3">{c.max_speed_kw ? `${c.max_speed_kw}kW` : "-"}</td>
                      <td className="p-3">{(c.versions || []).join(", ") || "-"}</td>
                      <td className="p-3">{c.opening_time && c.closing_time ? `${c.opening_time}-${c.closing_time}` : "24/7"}</td>
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
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Aantal laders</Label><Input type="number" value={editing.total_stalls ?? ""} onChange={(e) => setEditing({ ...editing, total_stalls: e.target.value ? parseInt(e.target.value) : null })} className="bg-slate-800 border-slate-700" /></div>
                <div><Label>Max snelheid (kW)</Label><Input type="number" value={editing.max_speed_kw ?? ""} onChange={(e) => setEditing({ ...editing, max_speed_kw: e.target.value ? parseInt(e.target.value) : null })} className="bg-slate-800 border-slate-700" /></div>
              </div>
              <div>
                <Label>Versies</Label>
                <div className="flex gap-4 mt-2">
                  {versionOpts.map((v) => {
                    const on = (editing.versions || []).includes(v);
                    return (
                      <label key={v} className="flex items-center gap-2 cursor-pointer">
                        <Checkbox checked={on} onCheckedChange={(c) => {
                          const cur = editing.versions || [];
                          setEditing({ ...editing, versions: c ? [...cur, v] : cur.filter((x) => x !== v) });
                        }} />
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
              <div><Label>Stall types (optioneel, bv "12x250kW")</Label><Input value={editing.stall_types || ""} onChange={(e) => setEditing({ ...editing, stall_types: e.target.value || null })} className="bg-slate-800 border-slate-700" /></div>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={!!editing.trailer_friendly} onCheckedChange={(c) => setEditing({ ...editing, trailer_friendly: !!c })} />
                Aanhangervriendelijk (doorrijbaar met aanhanger)
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
