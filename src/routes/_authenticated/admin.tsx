import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { importSuperchargers } from "@/lib/tesla.functions";
import { queueAdminChange, getPendingAdminChanges, clearPendingAdminChanges } from "@/lib/local-store";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Trash2, Pencil, Plus, Truck, X, ChevronDown, EyeOff } from "lucide-react";
import { CONSTRUCTION_STEPS, constructionStepLabels, type ChargerTrafficForecast, type OpeningDayKey, type ChargerConfig, type ChargerLifecycleStatus, type ClosureInfo, type ConstructionInfo, type OpeningDayKey, type OpeningHours, type PlannedUpgrade, type StallState, type StallCondition, type WorksInfo } from "@/lib/tesla-types";
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
  parking_fee_amount?: number | null;
  parking_free_minutes?: number | null;
  parking_per_minutes?: number | null;
  parking_per_euro?: number | null;
  price_per_kwh?: number | null;
  price_per_kwh_peak?: number | null;
  peak_hours?: string | null;
  price_blocks?: { days?: string; from?: string; to?: string; pricePerKwh: number }[] | null;
  in_parking_garage: boolean;
  status: ChargerLifecycleStatus;
  construction: ConstructionInfo | null;
  works: WorksInfo | null;
  closure: ClosureInfo | null;
  owner_id: string | null;
  owner_name?: string | null;
  low_speed: boolean;
  published: boolean;
  reopen_at: string | null;
  planned_upgrade: PlannedUpgrade | null;
  stall_states?: StallState[] | null;
  data_source?: string | null;
  hidden?: boolean | null;
  photos?: string[] | null;
  permanently_closed_at?: string | null;
  traffic_forecast?: ChargerTrafficForecast | null;
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
  parking_fee_amount: null as number | null, parking_free_minutes: null as number | null,
  parking_per_minutes: null as number | null, parking_per_euro: null as number | null,
  price_per_kwh: null as number | null, price_per_kwh_peak: null as number | null,
  peak_hours: null as string | null,
  status: "operational" as ChargerLifecycleStatus,
  construction: {} as ConstructionInfo,
  works: {} as WorksInfo,
  closure: {} as ClosureInfo,
  owner_id: null as string | null,
  low_speed: false,
  published: true,
  reopen_at: null as string | null,
  planned_upgrade: {} as PlannedUpgrade,
  stall_states: [] as StallState[],
  data_source: "manual" as string,
  hidden: false,
  photos: [] as string[],
  traffic_forecast: { weekly: [] } as ChargerTrafficForecast,
  charger_configs: [{ count: 8, version: "V3", speedKw: 250 }] as ChargerConfig[],
};

const STATUS_OPTIONS: ChargerLifecycleStatus[] = [
  "operational", "construction", "works", "works_closed", "temp_closed", "long_closed", "voting", "plan", "permit", "expanding", "permanent_closed", "unknown",
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
  const [bulkPriceOpen, setBulkPriceOpen] = useState(false);
  const [bulkPrice, setBulkPrice] = useState({ parkingFeeAmount: "", parkingFreeMinutes: "", parkingPerMinutes: "", parkingPerEuro: "" });
  const fileRef = useRef<HTMLInputElement>(null);\n  const trafficFileRef = useRef<HTMLInputElement>(null);
  const runImport = useServerFn(importSuperchargers);

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
    // Eerst eventuele wijzigingen versturen die in de wachtrij stonden (cloud was weg).
    const pending = getPendingAdminChanges();
    if (pending.length > 0) {
      let failed = false;
      for (const change of pending) {
        try {
          if (change.type === "delete" && change.id) {
            const { error } = await supabase.from("superchargers").delete().eq("id", change.id);
            if (error) failed = true;
          } else if (change.type === "upsert" && change.payload) {
            const { error } = await supabase.from("superchargers").upsert(change.payload as never);
            if (error) failed = true;
          }
        } catch { failed = true; }
        if (failed) break;
      }
      if (!failed) {
        clearPendingAdminChanges();
        toast.success("Wachtrij met wijzigingen verstuurd naar de cloud");
      }
    }
    const rows: Charger[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("superchargers")
        .select("id,name,lat,lng,country,province,city,total_stalls,stall_types,max_speed_kw,versions,opening_time,closing_time,opening_hours,trailer_friendly,is_available,charger_configs,parking_fee,parking_fee_amount,parking_free_minutes,parking_per_minutes,parking_per_euro,price_per_kwh,price_per_kwh_peak,peak_hours,in_parking_garage,status,construction,works,closure,owner_id,owner_name,low_speed,published,reopen_at,planned_upgrade,stall_states,data_source,hidden,photos,permanently_closed_at,price_blocks,traffic_forecast")

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
      parking_fee_amount: editing.parking_fee_amount ?? null,
      parking_free_minutes: editing.parking_free_minutes ?? null,
      parking_per_minutes: editing.parking_per_minutes ?? null,
      parking_per_euro: editing.parking_per_euro ?? null,
      price_per_kwh: null,
      price_per_kwh_peak: null,
      peak_hours: null,
      price_blocks: (editing.price_blocks && editing.price_blocks.length > 0 ? editing.price_blocks : null) as unknown as Json,
      in_parking_garage: !!editing.in_parking_garage,
      province: editing.province || null,
      city: editing.city || null,
      status: editing.status || "operational",
      construction: (editing.construction || {}) as Json,
      works: (editing.works || {}) as Json,
      closure: (editing.closure || {}) as Json,
      owner_id: editing.owner_id || null,
      owner_name: editing.owner_name?.trim() || null,
      ...(editing.status === "permanent_closed" && editing.permanently_closed_at ? { permanently_closed_at: editing.permanently_closed_at } : {}),
      low_speed: !!editing.low_speed,
      published: editing.published !== false,
      reopen_at: editing.status === "temp_closed" ? (editing.reopen_at || null) : null,
      planned_upgrade: (editing.planned_upgrade || {}) as Json,
      stall_states: (editing.stall_states || []).filter((x) => x.condition !== "available") as unknown as Json,
      data_source: editing.data_source === "automatic" ? "automatic" : "manual",
      hidden: !!editing.hidden,
      photos: (editing.photos || []).map((u) => u.trim()).filter(Boolean),\n      traffic_forecast: editing.traffic_forecast?.weekly?.length ? ({ ...editing.traffic_forecast, updatedAt: new Date().toISOString() } as unknown as Json) : null,
    };
    try {
      if (editing.id) {
        const { error } = await supabase.from("superchargers").update(payload).eq("id", editing.id);
        if (error) throw new Error(error.message);
        toast.success("Bijgewerkt");
      } else {
        const { error } = await supabase.from("superchargers").insert(payload);
        if (error) throw new Error(error.message);
        toast.success("Toegevoegd");
      }
    } catch (error) {
      // Bewaar de wijziging lokaal, maar toon ook de echte databasefout zodat schema-
      // of validatiefouten niet onterecht als alleen een cloudstoring worden gemeld.
      queueAdminChange({ type: "upsert", id: editing.id, payload: editing.id ? { id: editing.id, ...payload } : payload });
      if (editing.id) setChargers((prev) => prev.map((c) => (c.id === editing.id ? ({ ...c, ...payload } as Charger) : c)));
      const message = error instanceof Error ? error.message : String(error);
      console.error("[TeslaNavigation] Supercharger opslaan mislukt:", error);
      toast.error(`Opslaan mislukt: ${message}`);
      setEditing(null);
      return;
    }
    setEditing(null);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Weet je zeker dat je deze supercharger wilt verwijderen?")) return;
    try {
      const { error } = await supabase.from("superchargers").delete().eq("id", id);
      if (error) throw new Error(error.message);
      toast.success("Verwijderd");
    } catch {
      queueAdminChange({ type: "delete", id });
      setChargers((prev) => prev.filter((c) => c.id !== id));
      toast.warning("Cloud onbereikbaar — verwijdering in wachtrij gezet");
      return;
    }
    load();
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

  /** Back-up: alle laders als JSON-bestand, zodat de data mee kan naar een nieuwe versie. */
  const exportData = () => {
    if (chargers.length === 0) { toast.info("Geen data om te exporteren"); return; }
    const payload = { version: 1, exportedAt: new Date().toISOString(), chargers };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `superchargers-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${chargers.length} Superchargers geëxporteerd`);
  };

  /** Import voegt toe en werkt bij; bestaande laders worden nooit verwijderd. */
  const importData = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as { chargers?: unknown } | unknown[];
      const list = Array.isArray(parsed) ? parsed : (parsed.chargers as unknown[] | undefined);
      if (!Array.isArray(list) || list.length === 0) { toast.error("Geen laders in dit bestand"); return; }
      const result = await runImport({ data: { chargers: list as Record<string, unknown>[] } });
      toast.success(`${result.imported} Superchargers geïmporteerd`);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Importeren mislukt");
    }
  };

  /** CSV-formaat: charger,day,hour,level — één regel per uur. */
  const importTrafficCsv = async (file: File) => {
    try {
      const lines = (await file.text()).replace(/^\\uFEFF/, "").split(/\\r?\\n/).filter((line) => line.trim());
      if (lines.length < 2) throw new Error("CSV bevat geen gegevensregels");
      const delimiter = lines[0].includes(";") ? ";" : ",";
      const headers = lines[0].split(delimiter).map((v) => v.trim().toLowerCase().replace(/^"|"$/g, ""));
      const col = (name: string) => headers.indexOf(name);
      const required = ["charger", "day", "hour", "level"];
      if (required.some((name) => col(name) < 0)) throw new Error("Kolommen vereist: charger,day,hour,level");
      const dayAliases: Record<string, OpeningDayKey> = { ma: "mon", maandag: "mon", mon: "mon", monday: "mon", di: "tue", dinsdag: "tue", tue: "tue", tuesday: "tue", wo: "wed", woensdag: "wed", wed: "wed", wednesday: "wed", do: "thu", donderdag: "thu", thu: "thu", thursday: "thu", vr: "fri", vrijdag: "fri", fri: "fri", friday: "fri", za: "sat", zaterdag: "sat", sat: "sat", saturday: "sat", zo: "sun", zondag: "sun", sun: "sun", sunday: "sun" };
      const grouped = new Map<string, { charger: Charger; weekly: { day: OpeningDayKey; hour: number; level: number }[] }>();
      const normalize = (s: string) => s.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const byName = new Map(chargers.map((c) => [normalize(c.name), c]));
      let skipped = 0;
      for (const line of lines.slice(1)) {
        const cells = line.split(delimiter).map((v) => v.trim().replace(/^"|"$/g, ""));
        const charger = byName.get(normalize(cells[col("charger")] ?? ""));
        const day = dayAliases[(cells[col("day")] ?? "").toLowerCase()];
        const hour = Number(cells[col("hour")]);
        const level = Number(cells[col("level")]);
        if (!charger?.id || !day || !Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isFinite(level) || level < 0 || level > 100) { skipped++; continue; }
        const entry = grouped.get(charger.id) ?? { charger, weekly: [] };
        entry.weekly.push({ day, hour, level: Math.round(level) });
        grouped.set(charger.id, entry);
      }
      if (!grouped.size) throw new Error("Geen regels konden aan bestaande Superchargers worden gekoppeld");
      let updated = 0;
      for (const [id, entry] of grouped) {
        const { error } = await supabase.from("superchargers").update({ traffic_forecast: { weekly: entry.weekly, source: "CSV-import", updatedAt: new Date().toISOString() } as unknown as Json }).eq("id", id);
        if (error) throw new Error(entry.charger.name + ": " + error.message);
        updated++;
      }
      toast.success(`${updated} Superchargers bijgewerkt · ${skipped} regels overgeslagen`);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Drukte-import mislukt");
    }
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

  const bulkUpdate = async (changes: Record<string, unknown>) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const { error } = await supabase.from("superchargers").update(changes as never).in("id", ids);
    if (error) { toast.error(error.message); return; }
    toast.success(`${ids.length} Superchargers bijgewerkt`);
    setSelectedIds(new Set());
    setBulkOpen(false);
    setBulkPriceOpen(false);
    load();
  };

  const applyBulkPrice = () => {
    const changes: Record<string, unknown> = {};
    if (bulkPrice.parkingFeeAmount !== "") { changes.parking_fee = true; changes.parking_fee_amount = Number(bulkPrice.parkingFeeAmount); }
    if (bulkPrice.parkingFreeMinutes !== "") { changes.parking_fee = true; changes.parking_free_minutes = Number(bulkPrice.parkingFreeMinutes); }
    if (bulkPrice.parkingPerMinutes !== "") { changes.parking_fee = true; changes.parking_per_minutes = Number(bulkPrice.parkingPerMinutes); }
    if (bulkPrice.parkingPerEuro !== "") { changes.parking_fee = true; changes.parking_per_euro = Number(bulkPrice.parkingPerEuro); }
    if (Object.keys(changes).length === 0) { toast.error("Vul minstens één prijs in"); return; }
    bulkUpdate(changes);
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
            <Link to="/voertuigen"><Button variant="outline" size="sm" className="border-slate-700">Voertuigen</Button></Link>
            <Link to="/gebruikers"><Button variant="outline" size="sm" className="border-slate-700">Gebruikers</Button></Link>
            <Link to="/talen"><Button variant="outline" size="sm" className="border-slate-700">Talen</Button></Link>
            <Link to="/wijzigingen"><Button variant="outline" size="sm" className="border-slate-700">Wijzigingen</Button></Link>
            <Button variant="outline" size="sm" className="border-slate-700" onClick={publishAllDrafts}>Alle concepten publiceren</Button>
            <Button variant="outline" size="sm" className="border-slate-700" onClick={exportData}>Exporteer back-up</Button>\n            <Button variant="outline" size="sm" className="border-slate-700" onClick={() => trafficFileRef.current?.click()}>Importeer drukte-CSV</Button>\n            <input ref={trafficFileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) importTrafficCsv(file); e.target.value = ""; }} />
            <Button variant="outline" size="sm" className="border-slate-700" onClick={() => fileRef.current?.click()}>Importeer back-up</Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => { const file = e.target.files?.[0]; if (file) importData(file); e.target.value = ""; }}
            />
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
            <Button size="sm" variant="outline" onClick={() => setBulkPriceOpen((value) => !value)}>💶 Prijzen</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Selectie wissen</Button>
          </div>
        )}
        {selectedIds.size > 0 && bulkPriceOpen && (
          <div className="mb-4 border border-emerald-500/40 bg-emerald-500/10 p-3 rounded-lg space-y-2">
            <p className="text-sm font-semibold">Zelfde prijzen instellen voor {selectedIds.size} Superchargers</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <label className="flex items-center gap-1">Parkeren vast €
                <Input type="number" step="0.10" min="0" className="h-7 bg-slate-800 border-slate-600" value={bulkPrice.parkingFeeAmount} onChange={(e) => setBulkPrice({ ...bulkPrice, parkingFeeAmount: e.target.value })} />
              </label>
              <label className="flex items-center gap-1">Gratis min
                <Input type="number" min="0" className="h-7 bg-slate-800 border-slate-600" value={bulkPrice.parkingFreeMinutes} onChange={(e) => setBulkPrice({ ...bulkPrice, parkingFreeMinutes: e.target.value })} />
              </label>
              <label className="flex items-center gap-1">Per (min)
                <Input type="number" min="1" placeholder="10" className="h-7 bg-slate-800 border-slate-600" value={bulkPrice.parkingPerMinutes} onChange={(e) => setBulkPrice({ ...bulkPrice, parkingPerMinutes: e.target.value })} />
              </label>
              <label className="flex items-center gap-1">€ per blok
                <Input type="number" step="0.10" min="0" placeholder="1.00" className="h-7 bg-slate-800 border-slate-600" value={bulkPrice.parkingPerEuro} onChange={(e) => setBulkPrice({ ...bulkPrice, parkingPerEuro: e.target.value })} />
              </label>
            </div>
            <p className="text-[11px] text-slate-400">Alleen ingevulde velden worden aangepast. Parkeervelden zetten ook “parkeergeld verplicht” aan.</p>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={applyBulkPrice}>Toepassen op selectie</Button>
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
                      <td className="p-3">{c.published === false ? <span className="text-amber-300">Concept</span> : c.status && c.status !== "operational" ? <span className={c.status === "expanding" ? "text-green-400" : c.status === "construction" ? "text-orange-300" : c.status === "voting" ? "text-blue-300" : c.status === "plan" || c.status === "permit" ? "text-purple-300" : "text-slate-300"}>{lifecycleLabels[c.status] ?? c.status}</span> : c.is_available === false ? <span className="text-slate-300">Niet beschikbaar</span> : <span className="text-green-400">Beschikbaar</span>}</td>
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

                <div className="space-y-2 rounded-lg border border-slate-700 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs">Gebruikelijke drukte per dag en uur (0–100%)</Label>
                    <span className="text-[10px] text-slate-400">{editing.traffic_forecast?.weekly?.length ?? 0} uren ingevuld</span>
                  </div>
                  <p className="text-xs text-slate-400">0 = rustig, 100 = zeer druk. Lege vakken betekenen: geen gegevens.</p>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-xs">
                      <thead><tr><th className="p-1 text-left">Dag</th>{Array.from({length:24},(_,h)=><th key={h} className="p-0.5 font-normal">{String(h).padStart(2,"0")}</th>)}</tr></thead>
                      <tbody>
                        {([{key:"mon",label:"Ma"},{key:"tue",label:"Di"},{key:"wed",label:"Wo"},{key:"thu",label:"Do"},{key:"fri",label:"Vr"},{key:"sat",label:"Za"},{key:"sun",label:"Zo"}] as {key:OpeningDayKey;label:string}[]).map(({key,label}) => (
                          <tr key={key}>
                            <td className="p-1 font-semibold">{label}</td>
                            {Array.from({length:24},(_,hour) => {
                              const current = editing.traffic_forecast?.weekly?.find((slot) => slot.day === key && slot.hour === hour)?.level;
                              return <td key={hour} className="p-0.5"><input aria-label={label+" "+hour+" uur drukte"} type="number" min="0" max="100" step="10" value={current ?? ""} placeholder="–" onChange={(e) => {
                                const weekly = (editing.traffic_forecast?.weekly ?? []).filter((slot) => !(slot.day === key && slot.hour === hour));
                                if (e.target.value !== "") weekly.push({ day:key, hour, level:Math.max(0,Math.min(100,Number(e.target.value))) });
                                setEditing({ ...editing, traffic_forecast: { ...(editing.traffic_forecast ?? {weekly:[]}), weekly } });
                              }} className="w-9 rounded bg-slate-800 border border-slate-700 px-0.5 py-1 text-center" /></td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10px] text-slate-500">CSV-kolommen: charger,day,hour,level. Dagen mogen Nederlands of Engels zijn; uur is 0–23.</p>
                </div>

                <StallEditor
                  value={editing.stall_states || []}
                  onChange={(stall_states) => setEditing({ ...editing, stall_states })}
                />

                <div className="space-y-2 rounded-lg border border-slate-700 p-3">
                  <Label className="text-xs">Foto's (één link per regel, alleen zichtbaar in detailvenster)</Label>
                  <textarea rows={2} value={(editing.photos || []).join("\n")} onChange={(e) => setEditing({ ...editing, photos: e.target.value.split("\n") })} className="w-full rounded-md bg-slate-800 border border-slate-700 p-2 text-sm" />
                  <div className="flex flex-wrap gap-4 text-sm">
                    <label className="flex items-center gap-2">Bron
                      <select value={editing.data_source || "manual"} onChange={(e) => setEditing({ ...editing, data_source: e.target.value })} className="rounded bg-slate-800 border border-slate-700 px-2 py-1">
                        <option value="manual">Handmatig</option>
                        <option value="automatic">Automatisch</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!editing.hidden} onChange={(e) => setEditing({ ...editing, hidden: e.target.checked })} /> Verbergen op kaart</label>
                  </div>
                  {editing.status === "permanent_closed" && <div><Label className="text-xs">Datum permanent gesloten</Label><Input type="date" value={editing.permanently_closed_at ? editing.permanently_closed_at.slice(0, 10) : ""} onChange={(e) => setEditing({ ...editing, permanently_closed_at: e.target.value ? new Date(e.target.value + "T12:00:00").toISOString() : null })} className="mt-1 bg-slate-800 border-slate-700" /></div>}
                  {editing.status === "permanent_closed" && <p className="text-xs text-slate-400">Permanent gesloten blijft 14 dagen zichtbaar (zwart) en verdwijnt daarna van de kaart; de gegevens blijven bewaard.</p>}
                </div>

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
                <div className="mt-2">
                  <Label className="text-xs">Of alleen tekst (bijv. een hotelnaam — geen profiel, geen link)</Label>
                  <Input placeholder="Bijv. Van der Valk Hotel" value={editing.owner_name ?? ""} onChange={(e) => setEditing({ ...editing, owner_name: e.target.value })} className="mt-1 bg-slate-800 border-slate-700" />
                  {editing.owner_name?.trim() && <p className="mt-1 text-[11px] text-slate-400">Deze tekst wordt als eigenaar getoond bij deze lader.</p>}
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
              {editing.parking_fee && (
                <div className="ml-6 grid grid-cols-2 gap-2 text-xs">
                  <label className="flex items-center gap-1">Vast bedrag €
                    <Input type="number" step="0.10" min="0" className="h-7 bg-slate-800 border-slate-600" value={editing.parking_fee_amount ?? ''} onChange={(e) => setEditing({ ...editing, parking_fee_amount: e.target.value === '' ? null : Number(e.target.value) })} />
                  </label>
                  <label className="flex items-center gap-1">Gratis minuten
                    <Input type="number" min="0" className="h-7 bg-slate-800 border-slate-600" value={editing.parking_free_minutes ?? ''} onChange={(e) => setEditing({ ...editing, parking_free_minutes: e.target.value === '' ? null : Number(e.target.value) })} />
                  </label>
                  <label className="flex items-center gap-1">Per (minuten)
                    <Input type="number" min="1" placeholder="10" className="h-7 bg-slate-800 border-slate-600" value={editing.parking_per_minutes ?? ''} onChange={(e) => setEditing({ ...editing, parking_per_minutes: e.target.value === '' ? null : Number(e.target.value) })} />
                  </label>
                  <label className="flex items-center gap-1">Kosten per blok €
                    <Input type="number" step="0.10" min="0" placeholder="1.00" className="h-7 bg-slate-800 border-slate-600" value={editing.parking_per_euro ?? ''} onChange={(e) => setEditing({ ...editing, parking_per_euro: e.target.value === '' ? null : Number(e.target.value) })} />
                  </label>
                  <p className="col-span-2 text-slate-400">Bijv. 90 gratis minuten, daarna €1 per 10 minuten. Kosten kunnen per dag/tijd verschillen — gebruik het gemiddelde of het duurste tarief.</p>
                </div>
              )}
              <div className="space-y-1.5 text-xs rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <Label className="text-sm font-semibold">⚡ Tesla-prijzen per tijdsblok</Label>
                    <p className="text-[11px] text-slate-400">Voeg voor elk tarief de dagen, begin- en eindtijd en prijs per kWh toe.</p>
                  </div>
                  <Button type="button" size="sm" variant="outline" className="h-7 shrink-0" onClick={() => setEditing({ ...editing, price_blocks: [...(editing.price_blocks ?? []), { days: "dagelijks", from: "00:00", to: "23:59", pricePerKwh: 0.4 }] })}>+ Tijdsblok</Button>
                </div>
                {(editing.price_blocks ?? []).map((block: { days?: string; from?: string; to?: string; pricePerKwh: number }, idx: number) => {
                  const blocks = [...(editing.price_blocks ?? [])];
                  const update = (patch: Partial<typeof block>) => { blocks[idx] = { ...block, ...patch }; setEditing({ ...editing, price_blocks: blocks }); };
                  return (
                    <div key={idx} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-1.5 items-center">
                      <Input placeholder="ma-vr / weekend / dagelijks" className="h-7 bg-slate-800 border-slate-600" value={block.days ?? ''} onChange={(e) => update({ days: e.target.value })} />
                      <Input type="time" className="h-7 w-24 bg-slate-800 border-slate-600" value={block.from ?? ''} onChange={(e) => update({ from: e.target.value })} />
                      <Input type="time" className="h-7 w-24 bg-slate-800 border-slate-600" value={block.to ?? ''} onChange={(e) => update({ to: e.target.value })} />
                      <Input type="number" step="0.01" min="0" placeholder="€/kWh" className="h-7 w-20 bg-slate-800 border-slate-600" value={block.pricePerKwh} onChange={(e) => update({ pricePerKwh: Number(e.target.value) })} />
                      <Button type="button" size="sm" variant="ghost" className="h-6 text-red-400" onClick={() => setEditing({ ...editing, price_blocks: blocks.filter((_, i) => i !== idx) })}>✕</Button>
                    </div>
                  );
                })}
              </div>
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


const CONDITIONS: { value: StallCondition; label: string }[] = [
  { value: "available", label: "Beschikbaar" },
  { value: "defect", label: "Defect" },
  { value: "blocked", label: "Geblokkeerd" },
  { value: "maintenance", label: "Onderhoud" },
  { value: "other", label: "Andere reden" },
];

function StallEditor({ value, onChange }: { value: StallState[]; onChange: (v: StallState[]) => void }) {
  const closed = value.filter((x) => x.condition !== "available");
  const update = (i: number, patch: Partial<StallState>) => onChange(closed.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const add = () => onChange([...closed, { stall: Math.max(0, ...closed.map((x) => x.stall)) + 1, condition: "defect", version: "V3", speedKw: 250 }]);
  return (
    <div className="space-y-2 rounded-lg border border-slate-700 p-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Gesloten laders (live voor gebruikers)</Label>
        <Button type="button" size="sm" variant="outline" className="border-slate-700" onClick={add}>+ Gesloten lader</Button>
      </div>
      {closed.length === 0 && <p className="text-xs text-slate-400">Alle laders open.</p>}
      {closed.map((s, i) => (
        <div key={s.stall} className="grid grid-cols-2 sm:grid-cols-[5rem_4.5rem_5rem_8rem_1fr_auto] gap-1 items-center text-xs">
          <input placeholder="Naam (2B)" value={s.name ?? ""} onChange={(e) => update(i, { name: e.target.value })} className="rounded bg-slate-800 border border-slate-700 px-1 py-1" />
          <select value={s.version ?? "V3"} onChange={(e) => { const v = e.target.value; update(i, { version: v, speedKw: v === "V2" ? 150 : 250 }); }} className="rounded bg-slate-800 border border-slate-700 px-1 py-1">
            {["V2", "V3", "V4"].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <input type="number" min={1} title="kW" value={s.speedKw ?? ""} onChange={(e) => update(i, { speedKw: parseInt(e.target.value) || undefined })} className="rounded bg-slate-800 border border-slate-700 px-1 py-1" />
          <select value={s.condition} onChange={(e) => update(i, { condition: e.target.value as StallCondition })} className="rounded bg-red-950 border border-slate-700 px-1 py-1">
            {CONDITIONS.filter((c) => c.value !== "available").map((c) => <option key={c.value} value={c.value}>Reden: {c.label}</option>)}
          </select>
          <input placeholder="Toelichting (optioneel)" value={s.note ?? ""} onChange={(e) => update(i, { note: e.target.value })} className="rounded bg-slate-800 border border-slate-700 px-1 py-1" />
          <button type="button" onClick={() => onChange(closed.filter((_, j) => j !== i))} className="px-2 text-red-400" aria-label="Verwijderen">✕</button>
        </div>
      ))}
    </div>
  );
}
