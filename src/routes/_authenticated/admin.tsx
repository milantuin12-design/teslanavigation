import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Trash2, Pencil, Plus, Truck, X, ChevronDown, EyeOff } from "lucide-react";
import { CONSTRUCTION_STEPS, constructionStepLabels, type ChargerConfig, type ChargerLifecycleStatus, type ClosureInfo, type ConstructionInfo, type OpeningDayKey, type OpeningHours, type PlannedUpgrade, type WorksInfo } from "@/lib/tesla-types";
import type { Json } from "@/integrations/supabase/types";
import { constructionProgressLabels, defaultOpeningHours, lifecycleLabels, normalizeOpeningHours, openingDayKeys, openingDayLabels, parseChargerConfigsFromLegacy } from "@/lib/tesla-utils";


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
  province: string | null;
  city: string | null;
  total_stalls: number | null;
  stall_types: string | null;
  max_speed_kw: number | null;
  versions: string[] | null;
  opening_hours: OpeningHours | null;
  opening_time: string | null;
  closing_time: string | null;
  trailer_friendly: boolean;
  is_available: boolean;
  charger_configs: ChargerConfig[] | null;
  parking_fee: boolean;
  in_parking_garage: boolean;
  status: ChargerLifecycleStatus;
  construction: ConstructionInfo | null;
  works: WorksInfo | null;
  closure: ClosureInfo | null;
  owner_id: string | null;
  low_speed: boolean;
  published: boolean;
  reopen_at: string | null;
  planned_upgrade: PlannedUpgrade | null;
};

type Owner = { id: string; name: string };

const emptyCharger = {
  name: "", lat: 0, lng: 0, country: "", province: null as string | null, city: null as string | null,
  total_stalls: null as number | null, stall_types: null as string | null,
  max_speed_kw: null as number | null, versions: [] as string[],
  opening_hours: defaultOpeningHours() as OpeningHours,
  opening_time: null as string | null, closing_time: null as string | null,
  trailer_friendly: false, is_available: true,
  parking_fee: false, in_parking_garage: false,
  status: "operational" as ChargerLifecycleStatus,
  construction: {} as ConstructionInfo,
  works: {} as WorksInfo,
  closure: {} as ClosureInfo,
  owner_id: null as string | null,
  low_speed: false,
  published: true,
  reopen_at: null as string | null,
  planned_upgrade: {} as PlannedUpgrade,
  charger_configs: [{ count: 8, version: "V3", speedKw: 250 }] as ChargerConfig[],
};

const STATUS_OPTIONS: ChargerLifecycleStatus[] = [
  "operational", "construction", "works", "works_closed", "temp_closed", "long_closed",
];

const PROGRESS_OPTIONS = ["planned", "permit", "groundwork", "cabling", "installing", "testing"] as const;


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

function openingSummary(openingHours?: OpeningHours | null, openingTime?: string | null, closingTime?: string | null) {
  const hours = normalizeOpeningHours(openingHours, openingTime, closingTime);
  if (hours.mode === "24_7") return "24/7";
  return openingDayKeys.map((day) => {
    const dayHours = hours.days[day];
    return `${openingDayLabels[day]} ${dayHours.closed ? "dicht" : `${dayHours.open}-${dayHours.close}`}`;
  }).join(" · ");
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
  const [owners, setOwners] = useState<Owner[]>([]);
  const [newOwnerName, setNewOwnerName] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

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
        .select("id,name,lat,lng,country,province,city,total_stalls,stall_types,max_speed_kw,versions,opening_time,closing_time,opening_hours,trailer_friendly,is_available,charger_configs,parking_fee,in_parking_garage,status,construction,works,closure,owner_id,low_speed,published,reopen_at,planned_upgrade")
        .order("name").range(from, from + 999);
      if (error) { toast.error(error.message); break; }
      rows.push(...(data as Charger[]));
      if (!data || data.length < 1000) break;
    }
    setChargers(rows);
    const { data: ownerRows } = await supabase.from("charger_owners").select("id,name").order("name");
    setOwners((ownerRows as Owner[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const openNew = () => { setEditing({ ...emptyCharger, opening_hours: defaultOpeningHours() }); setCoordsInput(""); };
  const openEdit = (c: Charger) => { setEditing({ ...c, charger_configs: configsForCharger(c), opening_hours: normalizeOpeningHours(c.opening_hours, c.opening_time, c.closing_time) }); setCoordsInput(`${c.lat},${c.lng}`); };

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
      max_speed_kw: editing.max_speed_kw ?? maxSpeedFromConfigs(editing.charger_configs),
      versions: versionsFromConfigs(editing.charger_configs),
      opening_hours: normalizeOpeningHours(editing.opening_hours, editing.opening_time, editing.closing_time) as unknown as Json,
      opening_time: editing.opening_time || null,
      closing_time: editing.closing_time || null,
      trailer_friendly: !!editing.trailer_friendly,
      is_available: editing.is_available !== false,
      parking_fee: !!editing.parking_fee,
      in_parking_garage: !!editing.in_parking_garage,
      province: editing.province || null,
      city: editing.city || null,
      status: editing.status || "operational",
      construction: (editing.construction || {}) as Json,
      works: (editing.works || {}) as Json,
      closure: (editing.closure || {}) as Json,
      owner_id: editing.owner_id || null,
      low_speed: !!editing.low_speed,
      published: editing.published !== false,
      reopen_at: editing.status === "temp_closed" ? (editing.reopen_at || null) : null,
      planned_upgrade: (editing.planned_upgrade || {}) as Json,
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

  const setTemporaryClosureDays = (days: number) => {
    if (!editing) return;
    const reopen = new Date(Date.now() + Math.max(1, days) * 86400000);
    setEditing({
      ...editing,
      status: "temp_closed",
      is_available: false,
      reopen_at: reopen.toISOString(),
      closure: { ...(editing.closure || {}), until: reopen.toISOString().slice(0, 10) },
    });
  };

  const publishAllDrafts = async () => {
    const drafts = chargers.filter((c) => c.published === false);
    if (drafts.length === 0) { toast.info("Geen concepten om te publiceren"); return; }
    if (!confirm(`${drafts.length} concepten publiceren?`)) return;
    const { error } = await supabase.from("superchargers").update({ published: true }).eq("published", false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${drafts.length} concepten gepubliceerd`);
    load();
  };

  /** Eigenaar op naam: bestaat hij niet, dan maken we hem aan met alleen een titel. */
  const ensureOwnerByName = async (name: string): Promise<string | null> => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = owners.find((o) => o.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.id;
    const { data, error } = await supabase.from("charger_owners").insert({ name: trimmed }).select("id,name").single();
    if (error || !data) { toast.error(error?.message || "Eigenaar aanmaken mislukt"); return null; }
    setOwners((prev) => [...prev, data as Owner].sort((a, b) => a.name.localeCompare(b.name)));
    return data.id;
  };

  const bulkUpdate = async (changes: Partial<Pick<Charger, "trailer_friendly" | "low_speed" | "published" | "owner_id">>) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const { error } = await supabase.from("superchargers").update(changes).in("id", ids);
    if (error) { toast.error(error.message); return; }
    toast.success(`${ids.length} Superchargers bijgewerkt`);
    setSelectedIds(new Set());
    setBulkOpen(false);
    load();
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
          <div className="flex items-center gap-2">
            <Link to="/eigenaren"><Button variant="outline" size="sm" className="border-slate-700">Eigenaren</Button></Link>
            <Link to="/meldingen"><Button variant="outline" size="sm" className="border-slate-700">Meldingen</Button></Link>
            <Button variant="outline" size="sm" className="border-slate-700" onClick={publishAllDrafts}>Alle concepten publiceren</Button>
            <Button onClick={openNew} className="bg-red-600 hover:bg-red-700"><Plus className="w-4 h-4 mr-1" /> Nieuw</Button>
          </div>
        </div>
        {selectedIds.size > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 border border-blue-500/40 bg-blue-500/10 p-3 rounded-lg">
            <span className="text-sm font-semibold mr-2">{selectedIds.size} geselecteerd</span>
            <Button size="sm" variant="outline" onClick={() => bulkUpdate({ trailer_friendly: true })}>Aanhangervriendelijk</Button>
            <Button size="sm" variant="outline" onClick={() => bulkUpdate({ low_speed: true })}>Lage snelheid</Button>
            <Button size="sm" variant="outline" onClick={() => bulkUpdate({ published: false })}><EyeOff className="w-3.5 h-3.5 mr-1" /> Concept</Button>
            <div className="relative">
              <Button size="sm" variant="outline" onClick={() => setBulkOpen((value) => !value)}>Eigenaar <ChevronDown className="w-3.5 h-3.5 ml-1" /></Button>
              {bulkOpen && <div className="absolute z-20 mt-1 min-w-48 border border-slate-700 bg-slate-900 shadow-xl rounded-md p-1">
                <button className="block w-full text-left px-2 py-1.5 text-sm hover:bg-slate-800" onClick={() => bulkUpdate({ owner_id: null })}>Geen eigenaar</button>
                {owners.map((owner) => <button key={owner.id} className="block w-full text-left px-2 py-1.5 text-sm hover:bg-slate-800" onClick={() => bulkUpdate({ owner_id: owner.id })}>{owner.name}</button>)}
              </div>}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Selectie wissen</Button>
          </div>
        )}
        <Input placeholder="Zoek op naam of land…" value={search} onChange={(e) => setSearch(e.target.value)} className="bg-slate-800 border-slate-700 mb-4" />
        {loading ? <div>Laden…</div> : (
          <div className="rounded-lg border border-slate-700 overflow-hidden">
            <div className="max-h-[70vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-800 sticky top-0">
                  <tr className="text-left">
                    <th className="p-3"><Checkbox checked={filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id))} onCheckedChange={(checked) => setSelectedIds(checked ? new Set(filtered.map((c) => c.id)) : new Set())} /></th><th className="p-3">Naam</th><th className="p-3">Land</th><th className="p-3">Laders</th><th className="p-3">Tijden</th><th className="p-3">Status</th><th className="p-3">🚚</th><th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} className="border-t border-slate-700 hover:bg-slate-800/50">
                      <td className="p-3"><Checkbox checked={selectedIds.has(c.id)} onCheckedChange={(checked) => setSelectedIds((current) => { const next = new Set(current); if (checked) next.add(c.id); else next.delete(c.id); return next; })} /></td>
                      <td className="p-3">{c.name}</td>
                      <td className="p-3">{c.country}</td>
                      <td className="p-3 max-w-xs text-slate-300">{configSummary(configsForCharger(c))}</td>
                      <td className="p-3 max-w-sm text-slate-300">{openingSummary(c.opening_hours, c.opening_time, c.closing_time)}</td>
                      <td className="p-3">{c.status === "temp_closed" || c.status === "long_closed" || c.is_available === false ? <span className="text-slate-300">Niet beschikbaar</span> : c.published === false ? <span className="text-amber-300">Concept</span> : <span className="text-green-400">Beschikbaar</span>}</td>
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
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Provincie / regio</Label><Input value={editing.province || ""} onChange={(e) => setEditing({ ...editing, province: e.target.value })} className="bg-slate-800 border-slate-700" /></div>
                <div><Label>Plaats</Label><Input value={editing.city || ""} onChange={(e) => setEditing({ ...editing, city: e.target.value })} className="bg-slate-800 border-slate-700" /></div>
              </div>
              <div><Label>Coordinaten (lat,lng)</Label><Input value={coordsInput} onChange={(e) => setCoordsInput(e.target.value)} placeholder="52.3702,4.8952" className="bg-slate-800 border-slate-700" /></div>

              <div className="rounded-lg border border-slate-700 p-3 space-y-3">
                <div>
                  <Label>Status</Label>
                  <select
                    value={editing.status || "operational"}
                    onChange={(e) => { const status = e.target.value as ChargerLifecycleStatus; setEditing({ ...editing, status, is_available: status === "temp_closed" || status === "long_closed" || status === "works_closed" ? false : editing.is_available }); }}
                    className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm"
                  >
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{lifecycleLabels[s]}</option>)}
                  </select>
                </div>

                {editing.status === "construction" && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <Label className="text-xs">Aantal laders</Label>
                        <Input type="number" min={0} value={editing.construction?.plannedStalls ?? ""} onChange={(e) => setEditing({ ...editing, construction: { ...(editing.construction || {}), plannedStalls: parseInt(e.target.value) || undefined } })} className="bg-slate-800 border-slate-700" />
                      </div>
                      <div>
                        <Label className="text-xs">Versie</Label>
                        <select value={editing.construction?.version ?? "V4"} onChange={(e) => setEditing({ ...editing, construction: { ...(editing.construction || {}), version: e.target.value } })} className="w-full bg-slate-800 border border-slate-700 rounded-md px-2 py-2 text-sm">
                          {versionOpts.map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </div>
                      <div>
                        <Label className="text-xs">kW</Label>
                        <Input type="number" min={0} value={editing.construction?.speedKw ?? ""} onChange={(e) => setEditing({ ...editing, construction: { ...(editing.construction || {}), speedKw: parseInt(e.target.value) || undefined } })} className="bg-slate-800 border-slate-700" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Bouwvoortgang</Label>
                        <select value={editing.construction?.progress ?? "planned"} onChange={(e) => setEditing({ ...editing, construction: { ...(editing.construction || {}), progress: e.target.value as ConstructionInfo["progress"] } })} className="w-full bg-slate-800 border border-slate-700 rounded-md px-2 py-2 text-sm">
                          {PROGRESS_OPTIONS.map((p) => <option key={p} value={p}>{constructionProgressLabels[p]}</option>)}
                        </select>
                      </div>
                      <div>
                        <Label className="text-xs">Verwacht open</Label>
                        <Input type="date" value={editing.construction?.expectedOpen ?? ""} onChange={(e) => setEditing({ ...editing, construction: { ...(editing.construction || {}), expectedOpen: e.target.value } })} className="bg-slate-800 border-slate-700" />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Toelichting</Label>
                      <Input value={editing.construction?.notes ?? ""} onChange={(e) => setEditing({ ...editing, construction: { ...(editing.construction || {}), notes: e.target.value } })} className="bg-slate-800 border-slate-700" />
                    </div>
                    <div>
                      <Label className="text-xs">Verwachte openingsmaand / kwartaal</Label>
                      <Input placeholder="Bijv. Q1 2027 of voorjaar 2027" value={editing.construction?.expectedOpenMonth ?? ""} onChange={(e) => setEditing({ ...editing, construction: { ...(editing.construction || {}), expectedOpenMonth: e.target.value } })} className="bg-slate-800 border-slate-700" />
                    </div>
                    <div>
                      <Label className="text-xs">Checklist bouwvoortgang</Label>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        {CONSTRUCTION_STEPS.map((step) => <label key={step} className="flex items-center gap-2 text-xs"><Checkbox checked={(editing.construction?.steps || []).includes(step)} onCheckedChange={(checked) => { const current = editing.construction?.steps || []; const steps = checked ? [...current, step] : current.filter((value) => value !== step); setEditing({ ...editing, construction: { ...(editing.construction || {}), steps } }); }} />{constructionStepLabels[step]}</label>)}
                      </div>
                    </div>
                  </div>
                )}

                {(editing.status === "works" || editing.status === "works_closed") && (
                  <div className="space-y-2">
                    {editing.status === "works" && (
                      <div>
                        <Label className="text-xs">Aantal laders dicht</Label>
                        <Input type="number" min={0} value={editing.works?.closedStalls ?? ""} onChange={(e) => setEditing({ ...editing, works: { ...(editing.works || {}), closedStalls: parseInt(e.target.value) || 0 } })} className="bg-slate-800 border-slate-700" />
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Reden</Label>
                        <Input value={editing.works?.reason ?? ""} onChange={(e) => setEditing({ ...editing, works: { ...(editing.works || {}), reason: e.target.value } })} className="bg-slate-800 border-slate-700" />
                      </div>
                      <div>
                        <Label className="text-xs">Klaar rond</Label>
                        <Input type="date" value={editing.works?.expectedEnd ?? ""} onChange={(e) => setEditing({ ...editing, works: { ...(editing.works || {}), expectedEnd: e.target.value } })} className="bg-slate-800 border-slate-700" />
                      </div>
                    </div>
                    <div className="rounded-md border border-slate-700 p-2 space-y-2">
                      <Label className="text-xs">Wat wordt aangepast?</Label>
                      <Input placeholder="Bijv. 12x V3 wordt 16x V4" value={editing.planned_upgrade?.label ?? ""} onChange={(e) => setEditing({ ...editing, planned_upgrade: { ...(editing.planned_upgrade || {}), label: e.target.value } })} className="bg-slate-800 border-slate-700" />
                      <Input placeholder="Wanneer verwacht?" value={editing.planned_upgrade?.expected ?? ""} onChange={(e) => setEditing({ ...editing, planned_upgrade: { ...(editing.planned_upgrade || {}), expected: e.target.value } })} className="bg-slate-800 border-slate-700" />
                    </div>
                  </div>
                )}

                {(editing.status === "temp_closed" || editing.status === "long_closed") && (
                  <div className="space-y-2">
                    <div>
                      <Label className="text-xs">Reden van sluiting</Label>
                      <Input value={editing.closure?.reason ?? ""} onChange={(e) => setEditing({ ...editing, closure: { ...(editing.closure || {}), reason: e.target.value } })} className="bg-slate-800 border-slate-700" />
                    </div>
                    {editing.status === "temp_closed" && <div>
                      <Label className="text-xs">Automatisch heropenen (alleen admin)</Label>
                      <div className="grid grid-cols-4 gap-2 mt-1">
                        {[1, 3, 7, 14].map((days) => <Button key={days} type="button" size="sm" variant="outline" onClick={() => setTemporaryClosureDays(days)}>{days} {days === 1 ? "dag" : "dagen"}</Button>)}
                      </div>
                      <Input type="datetime-local" value={editing.reopen_at ? editing.reopen_at.slice(0, 16) : ""} onChange={(e) => setEditing({ ...editing, is_available: false, reopen_at: e.target.value ? new Date(e.target.value).toISOString() : null })} className="mt-2 bg-slate-800 border-slate-700" />
                    </div>}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Vanaf</Label>
                        <Input type="date" value={editing.closure?.from ?? ""} onChange={(e) => setEditing({ ...editing, closure: { ...(editing.closure || {}), from: e.target.value } })} className="bg-slate-800 border-slate-700" />
                      </div>
                      <div>
                        <Label className="text-xs">Tot (verwacht)</Label>
                        <Input type="date" value={editing.closure?.until ?? ""} onChange={(e) => setEditing({ ...editing, closure: { ...(editing.closure || {}), until: e.target.value } })} className="bg-slate-800 border-slate-700" />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <Label>Eigenaar</Label>
                <select value={editing.owner_id || ""} onChange={(e) => setEditing({ ...editing, owner_id: e.target.value || null })} className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm">
                  <option value="">Geen eigenaar</option>
                  {owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
                </select>
                <div className="mt-2 flex gap-2">
                  <Input
                    placeholder="Of typ een nieuwe eigenaarsnaam…"
                    value={newOwnerName}
                    onChange={(e) => setNewOwnerName(e.target.value)}
                    className="bg-slate-800 border-slate-700"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="border-slate-700"
                    onClick={async () => {
                      const id = await ensureOwnerByName(newOwnerName);
                      if (id) { setEditing({ ...editing, owner_id: id }); setNewOwnerName(""); toast.success("Eigenaar gekoppeld"); }
                    }}
                  >
                    Koppel
                  </Button>
                </div>
              </div>

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
                        next[index] = { ...config, version, speedKw: version === "V4" ? 250 : version === "V3" ? 250 : 150 };
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
                <Label>Werkelijke maximale snelheid (optioneel)</Label>
                <Input type="number" min={1} value={editing.max_speed_kw ?? ""} onChange={(e) => setEditing({ ...editing, max_speed_kw: e.target.value ? parseInt(e.target.value) : null })} placeholder="Bijv. 50 wanneer 150kW-hardware begrensd is" className="bg-slate-800 border-slate-700" />
                <p className="mt-1 text-xs text-slate-400">Overschrijft de snelheid van de laderregels voor route- en laadtijdberekeningen.</p>
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
              <div className="rounded-lg border border-slate-700 p-3 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={normalizeOpeningHours(editing.opening_hours, editing.opening_time, editing.closing_time).mode === "24_7"} onCheckedChange={(checked) => {
                    const current = normalizeOpeningHours(editing.opening_hours, editing.opening_time, editing.closing_time);
                    setEditing({ ...editing, opening_hours: { ...current, mode: checked ? "24_7" : "weekly" } });
                  }} />
                  24/7 open
                </label>
                {normalizeOpeningHours(editing.opening_hours, editing.opening_time, editing.closing_time).mode === "weekly" && (
                  <div className="space-y-2">
                    {openingDayKeys.map((day: OpeningDayKey) => {
                      const hours = normalizeOpeningHours(editing.opening_hours, editing.opening_time, editing.closing_time);
                      const dayHours = hours.days[day];
                      const updateDay = (next: Partial<typeof dayHours>) => {
                        setEditing({ ...editing, opening_hours: { ...hours, days: { ...hours.days, [day]: { ...dayHours, ...next } } } });
                      };
                      return (
                        <div key={day} className="grid grid-cols-[34px_1fr_1fr_auto] gap-2 items-center">
                          <span className="text-xs text-slate-400">{openingDayLabels[day]}</span>
                          <Input type="time" value={dayHours.open} disabled={dayHours.closed} onChange={(e) => updateDay({ open: e.target.value })} className="bg-slate-800 border-slate-700" />
                          <Input type="time" value={dayHours.close} disabled={dayHours.closed} onChange={(e) => updateDay({ close: e.target.value })} className="bg-slate-800 border-slate-700" />
                          <label className="flex items-center gap-1 text-xs text-slate-300">
                            <Checkbox checked={!!dayHours.closed} onCheckedChange={(checked) => updateDay({ closed: !!checked })} /> Dicht
                          </label>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={editing.is_available === false} onCheckedChange={(c) => setEditing({ ...editing, is_available: !c })} />
                Niet beschikbaar (grijs op de kaart)
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={!!editing.low_speed} onCheckedChange={(c) => setEditing({ ...editing, low_speed: !!c })} />
                Lage laadsnelheid (pijltje omlaag op de kaart)
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={editing.published !== false} onCheckedChange={(c) => setEditing({ ...editing, published: !!c })} />
                Gepubliceerd (uit = concept, alleen zichtbaar voor admin)
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={!!editing.trailer_friendly} onCheckedChange={(c) => setEditing({ ...editing, trailer_friendly: !!c })} />
                <Truck className="w-4 h-4" /> Aanhangervriendelijk (doorrijbaar met aanhanger)
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={!!editing.parking_fee} onCheckedChange={(c) => setEditing({ ...editing, parking_fee: !!c })} />
                💶 Parkeergeld verplicht
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={!!editing.in_parking_garage} onCheckedChange={(c) => setEditing({ ...editing, in_parking_garage: !!c })} />
                🅿️ In parkeergarage (niet voor aanhangerroute)
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
