import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMyAccountSettings, updateMyAccountSettings, listMyVehicles, listPublishedVehicleModels, saveMyVehicle, deleteMyVehicle, listMyRouteProfiles, saveMyRouteProfile, deleteMyRouteProfile, listMyChargingSessions, saveMyChargingSession, deleteMyChargingSession } from "@/lib/account.functions";
import { changePassword } from "@/lib/auth.functions";
import { toast } from "sonner";

type Gender = "male" | "female" | "other" | "unspecified";
type Preferences = {
  vehicle_model?: string | null;
  vehicle_year?: number | null;
  consumption_kwh100?: number | null;
  greeting?: string | null;
  profile_color?: string;
  profile_image_url?: string | null;
  language?: string;
  units?: "metric" | "imperial";
  display_density?: "compact" | "comfortable";
  font_scale?: number;
  theme?: "light" | "dark" | "system";
  map_type?: "road" | "satellite";
  map_zoom?: number;
  map_marker_size?: number;
  remembered_countries?: string[];
  map_filters?: Record<string, unknown>;
  status_colors?: Record<string, string>;
  route_preferences?: {
    priority?: "cheapest" | "fastest" | "fewest_stops";
    default_charge_pause_min?: number;
    max_detour_km?: number;
    max_distance_between_stops_km?: number;
    min_charger_kw?: number;
  };
  notifications: {
    favorite_status: boolean; price_changes: boolean; new_locations: boolean;
    closed_locations?: boolean; status_changes?: boolean; email_enabled?: boolean; push_enabled?: boolean;
  };
  map: { show_development_chargers: boolean; remember_filters: boolean };
};
type Settings = { email: string; display_name: string; gender: Gender; preferences: Preferences };
type Vehicle = {
  id: string; name: string; model_name: string; model_year?: number | null; image_url?: string | null;
  battery_kwh?: number | null; summer_consumption_kwh100?: number | null;
  winter_consumption_kwh100?: number | null; max_charge_kw?: number | null;
  arrival_percent: number; trailer_enabled: boolean; trailer_consumption_increase_percent: number;
  is_default: boolean; battery_health_percent?: number | null;
  roof_or_rack_extra_percent: number; winter_tires_extra_percent: number;
};
type RouteProfile = { id: string; name: string; settings?: Record<string, unknown> };
type ChargingSession = { id: string; charger_name?: string | null; energy_kwh: number; cost_amount?: number | null; currency: string; started_at?: string | null; notes?: string | null };

const defaults: Settings = {
  email: "", display_name: "", gender: "unspecified",
  preferences: {
    vehicle_model: "", vehicle_year: null, consumption_kwh100: null, greeting: "",
    profile_color: "#e82127", language: "nl", units: "metric", display_density: "comfortable",
    font_scale: 1, theme: "dark", map_type: "satellite", map_zoom: 7, map_marker_size: 30, remembered_countries: [],
    notifications: { favorite_status: true, price_changes: true, new_locations: false, closed_locations: true, status_changes: true, email_enabled: false, push_enabled: false },
    map: { show_development_chargers: false, remember_filters: true },
    route_preferences: { priority: "fastest", default_charge_pause_min: 15, max_detour_km: 30, max_distance_between_stops_km: 250, min_charger_kw: 0 },
    status_colors: {},
  },
};

const fieldClass = "w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white";
const labelClass = "mb-1 block text-xs text-slate-400";
const sectionClass = "space-y-3 border-t border-slate-700 pt-4";
const colorDefaults: Record<string,string> = {
  "In bedrijf": "#22c55e", "Beschikbaar": "#22c55e", "Tijdelijk gesloten": "#cbd5e1",
  "Permanent gesloten": "#0f172a", "In aanbouw": "#f59e0b", "Plan": "#a855f7",
  "Vergunning aangevraagd": "#a855f7", "Onbekend": "#64748b",
};

export function AccountSettingsDialog({ open, onOpenChange, onSaved }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  onSaved: (displayName: string | null, gender: Gender) => void;
}) {
  const [settings, setSettings] = useState<Settings>(defaults);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleCatalogue, setVehicleCatalogue] = useState<Array<{id:string;brand:string;model:string;trim:string|null;battery_kwh:number|null;usable_kwh:number|null;range_km:number|null;consumption_kwh100:number|null;winter_consumption_kwh100:number|null;year_from:number;year_to:number;max_charge_kw:number|null;image_url:string|null}>>([]);
  const [selectedCatalogueId, setSelectedCatalogueId] = useState("");
  const [vehicleDraft, setVehicleDraft] = useState({ name: "", model_name: "", model_year: "2025", image_url: "", battery_kwh: "75", summer_consumption_kwh100: "17", winter_consumption_kwh100: "22", max_charge_kw: "250", arrival_percent: "10", trailer_enabled: false, trailer_consumption_increase_percent: "20", battery_health_percent: "100", roof_or_rack_extra_percent: "0", winter_tires_extra_percent: "0", is_default: true });
  const [routeProfiles, setRouteProfiles] = useState<RouteProfile[]>([]);
  const [profileName, setProfileName] = useState("");
  const [chargingSessions, setChargingSessions] = useState<ChargingSession[]>([]);
  const [sessionDraft, setSessionDraft] = useState({ charger_name: "", energy_kwh: "30", cost_amount: "", notes: "" });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [vehicleSaving, setVehicleSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const saveSettingsFn = useServerFn(updateMyAccountSettings);
  const listVehiclesFn = useServerFn(listMyVehicles);
  const saveVehicleFn = useServerFn(saveMyVehicle);
  const deleteVehicleFn = useServerFn(deleteMyVehicle);
  const listRouteProfilesFn = useServerFn(listMyRouteProfiles);
  const saveRouteProfileFn = useServerFn(saveMyRouteProfile);
  const deleteRouteProfileFn = useServerFn(deleteMyRouteProfile);
  const listSessionsFn = useServerFn(listMyChargingSessions);
  const saveSessionFn = useServerFn(saveMyChargingSession);
  const deleteSessionFn = useServerFn(deleteMyChargingSession);
  const changePasswordFn = useServerFn(changePassword);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    void Promise.all([getMyAccountSettings(), listVehiclesFn(), listRouteProfilesFn(), listSessionsFn(), listPublishedVehicleModels().catch(() => [])]).then(([data, list, profiles, sessions, catalogue]) => {
      if (!active) return;
      const p = data.preferences ?? {};
      setSettings({ ...defaults, ...data, preferences: {
        ...defaults.preferences, ...p,
        notifications: { ...defaults.preferences.notifications, ...p.notifications },
        map: { ...defaults.preferences.map, ...p.map },
        route_preferences: { ...defaults.preferences.route_preferences, ...p.route_preferences },
        status_colors: { ...defaults.preferences.status_colors, ...p.status_colors },
      } as Preferences });
      setVehicles(list as Vehicle[]);
      setVehicleCatalogue(catalogue as typeof vehicleCatalogue);
      setRouteProfiles(profiles as RouteProfile[]);
      setChargingSessions(sessions as ChargingSession[]);
    }).catch((error) => toast.error(error instanceof Error ? error.message : "Accountinstellingen laden mislukt"))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, listVehiclesFn]);

  const setPref = <K extends keyof Preferences,>(key: K, value: Preferences[K]) =>
    setSettings(old => ({ ...old, preferences: { ...old.preferences, [key]: value } }));
  const setNested = (section: "notifications" | "map" | "route_preferences" | "status_colors", key: string, value: unknown) =>
    setSettings(old => ({ ...old, preferences: { ...old.preferences, [section]: { ...((old.preferences[section] ?? {}) as object), [key]: value } } }));
  const save = async () => {
    setSaving(true);
    try {
      await saveSettingsFn({ data: {
        display_name: settings.display_name.trim() || null,
        gender: settings.gender,
        preferences: {
          ...settings.preferences,
          vehicle_model: settings.preferences.vehicle_model?.trim() || null,
          vehicle_year: settings.preferences.vehicle_year ?? null,
          consumption_kwh100: settings.preferences.consumption_kwh100 ?? null,
        },
      } });
      onSaved(settings.display_name.trim() || null, settings.gender);
      window.dispatchEvent(new CustomEvent("tn-preferences-updated", { detail: settings.preferences }));
      toast.success("Accountinstellingen opgeslagen");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Opslaan mislukt"); }
    finally { setSaving(false); }
  };
  const addVehicle = async () => {
    if (!vehicleDraft.name.trim() || !vehicleDraft.model_name.trim()) { toast.error("Vul een voertuignaam en model in."); return; }
    setVehicleSaving(true);
    try {
      await saveVehicleFn({ data: {
        name: vehicleDraft.name.trim(), model_name: vehicleDraft.model_name.trim(),
        model_year: Number(vehicleDraft.model_year), image_url: vehicleDraft.image_url.trim() || null, battery_kwh: Number(vehicleDraft.battery_kwh),
        summer_consumption_kwh100: Number(vehicleDraft.summer_consumption_kwh100),
        winter_consumption_kwh100: Number(vehicleDraft.winter_consumption_kwh100),
        max_charge_kw: Number(vehicleDraft.max_charge_kw), arrival_percent: Number(vehicleDraft.arrival_percent),
        trailer_enabled: vehicleDraft.trailer_enabled,
        trailer_consumption_increase_percent: Number(vehicleDraft.trailer_consumption_increase_percent),
        battery_health_percent: Number(vehicleDraft.battery_health_percent),
        roof_or_rack_extra_percent: Number(vehicleDraft.roof_or_rack_extra_percent),
        winter_tires_extra_percent: Number(vehicleDraft.winter_tires_extra_percent),
        is_default: vehicleDraft.is_default,
      } });
      setVehicles(await listVehiclesFn());
      setVehicleDraft(v => ({ ...v, name: "", model_name: "", is_default: false }));
      toast.success("Voertuig opgeslagen");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Voertuig opslaan mislukt"); }
    finally { setVehicleSaving(false); }
  };
  const removeVehicle = async (id: string) => {
    if (!window.confirm("Weet je zeker dat je dit voertuig wilt verwijderen?")) return;
    try { await deleteVehicleFn({ data: { id } }); setVehicles(await listVehiclesFn()); toast.success("Voertuig verwijderd"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Verwijderen mislukt"); }
  };
  const saveRouteProfile = async () => {
    if (!profileName.trim()) { toast.error("Geef het routeprofiel een naam."); return; }
    try {
      await saveRouteProfileFn({ data: { name: profileName.trim(), settings: { route_preferences: settings.preferences.route_preferences, vehicle_model: settings.preferences.vehicle_model, vehicle_year: settings.preferences.vehicle_year, consumption_kwh100: settings.preferences.consumption_kwh100, map_type: settings.preferences.map_type } } });
      setRouteProfiles(await listRouteProfilesFn()); setProfileName(""); toast.success("Routeprofiel opgeslagen");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Routeprofiel opslaan mislukt"); }
  };
  const applyRouteProfile = (profile: RouteProfile) => {
    const saved = profile.settings ?? {};
    setSettings((old) => ({
      ...old,
      preferences: {
        ...old.preferences,
        vehicle_model: typeof saved.vehicle_model === "string" ? saved.vehicle_model : old.preferences.vehicle_model,
        vehicle_year: typeof saved.vehicle_year === "number" ? saved.vehicle_year : old.preferences.vehicle_year,
        consumption_kwh100: typeof saved.consumption_kwh100 === "number" ? saved.consumption_kwh100 : old.preferences.consumption_kwh100,
        map_type: saved.map_type === "road" || saved.map_type === "satellite" ? saved.map_type : old.preferences.map_type,
        route_preferences: { ...old.preferences.route_preferences, ...((saved.route_preferences ?? {}) as Preferences["route_preferences"]) },
      },
    }));
    toast.success("Routeprofiel geladen. Sla de accountinstellingen op om het toe te passen.");
  };
  const removeRouteProfile = async (id: string) => {
    try { await deleteRouteProfileFn({ data: { id } }); setRouteProfiles(await listRouteProfilesFn()); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Routeprofiel verwijderen mislukt"); }
  };
  const addChargingSession = async () => {
    const energy = Number(sessionDraft.energy_kwh); const cost = sessionDraft.cost_amount.trim() ? Number(sessionDraft.cost_amount) : null;
    if (!Number.isFinite(energy) || energy <= 0 || (cost !== null && (!Number.isFinite(cost) || cost < 0))) { toast.error("Controleer de kWh- en prijswaarden."); return; }
    try {
      await saveSessionFn({ data: { charger_name: sessionDraft.charger_name.trim() || null, started_at: new Date().toISOString(), energy_kwh: energy, cost_amount: cost, currency: "EUR", notes: sessionDraft.notes.trim() || null } });
      setChargingSessions(await listSessionsFn()); setSessionDraft({ charger_name: "", energy_kwh: "30", cost_amount: "", notes: "" }); toast.success("Laadsessie opgeslagen");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Laadsessie opslaan mislukt"); }
  };
  const removeChargingSession = async (id: string) => {
    try { await deleteSessionFn({ data: { id } }); setChargingSessions(await listSessionsFn()); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Laadsessie verwijderen mislukt"); }
  };

  const exportAccountData = () => {
    const payload = { version: 1, exported_at: new Date().toISOString(), settings: { display_name: settings.display_name, gender: settings.gender, preferences: settings.preferences }, vehicles };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "teslanavigation-instellingen.json"; link.click();
    URL.revokeObjectURL(url);
    toast.success("Instellingenbestand aangemaakt");
  };
  const importAccountData = async (file?: File) => {
    if (!file) return;
    if (file.size > 1_000_000) { toast.error("Het bestand is te groot (maximaal 1 MB)."); return; }
    try {
      const payload = JSON.parse(await file.text()) as { version?: number; settings?: { display_name?: string; gender?: Gender; preferences?: Record<string, unknown> }; vehicles?: Array<Record<string, unknown>> };
      if (payload.version !== 1 || !payload.settings || typeof payload.settings !== "object") throw new Error("Dit is geen geldig TeslaNavigation-instellingenbestand.");
      const importedPreferences = payload.settings.preferences && typeof payload.settings.preferences === "object" ? payload.settings.preferences : {};
      const nextSettings = { ...defaults.preferences, ...importedPreferences } as Preferences;
      const nextName = typeof payload.settings.display_name === "string" ? payload.settings.display_name.slice(0,80) : settings.display_name;
      const nextGender = ["male","female","other","unspecified"].includes(payload.settings.gender ?? "") ? payload.settings.gender as Gender : settings.gender;
      await saveSettingsFn({ data: { display_name: nextName.trim() || null, gender: nextGender, preferences: nextSettings } });
      setSettings(old => ({ ...old, display_name: nextName, gender: nextGender, preferences: nextSettings }));
      for (const item of (Array.isArray(payload.vehicles) ? payload.vehicles.slice(0,20) : [])) {
        if (typeof item.name !== "string" || typeof item.model_name !== "string") continue;
        const num = (key: string, fallback: number) => typeof item[key] === "number" && Number.isFinite(item[key]) ? item[key] as number : fallback;
        const image = typeof item.image_url === "string" && /^https?:\/\//i.test(item.image_url) ? item.image_url : null;
        await saveVehicleFn({ data: {
          name: item.name.slice(0,80), model_name: item.model_name.slice(0,120), model_year: num("model_year",2025),
          image_url: image, battery_kwh: num("battery_kwh",75), summer_consumption_kwh100: num("summer_consumption_kwh100",17),
          winter_consumption_kwh100: num("winter_consumption_kwh100",22), max_charge_kw: num("max_charge_kw",250),
          battery_health_percent: num("battery_health_percent",100), roof_or_rack_extra_percent: num("roof_or_rack_extra_percent",0),
          winter_tires_extra_percent: num("winter_tires_extra_percent",0), arrival_percent: num("arrival_percent",10),
          trailer_enabled: item.trailer_enabled === true, trailer_consumption_increase_percent: num("trailer_consumption_increase_percent",0),
          is_default: item.is_default === true,
        } });
      }
      setVehicles(await listVehiclesFn());
      window.dispatchEvent(new CustomEvent("tn-preferences-updated", { detail: nextSettings }));
      toast.success("Instellingen geïmporteerd. Bestaande voertuigen zijn behouden; voertuigen uit het bestand zijn toegevoegd.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Importeren mislukt"); }
  };

  const savePassword = async () => {
    if (newPassword !== confirmPassword) { toast.error("De nieuwe wachtwoorden komen niet overeen."); return; }
    try {
      await changePasswordFn({ data: { currentPassword, newPassword } });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      toast.success("Wachtwoord gewijzigd. Je huidige sessie blijft actief.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Wachtwoord wijzigen mislukt"); }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-slate-700 bg-slate-900 text-white">
      <DialogHeader><DialogTitle>Accountinstellingen</DialogTitle></DialogHeader>
      {loading ? <p className="py-8 text-sm text-slate-400">Instellingen laden…</p> : <div className="space-y-6">
        <section className="space-y-3">
          <h3 className="font-semibold">Persoonlijk profiel</h3>
          <div><label className={labelClass}>Weergavenaam</label><Input value={settings.display_name} maxLength={80} onChange={e=>setSettings(s=>({...s,display_name:e.target.value}))} className="bg-slate-800 border-slate-700" /></div>
          <div><label className={labelClass}>Eigen begroeting</label><Input value={settings.preferences.greeting ?? ""} maxLength={120} onChange={e=>setPref("greeting",e.target.value)} placeholder="Bijv. Welkom terug!" className="bg-slate-800 border-slate-700" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelClass}>Profielkleur</label><Input type="color" value={settings.preferences.profile_color ?? "#e82127"} onChange={e=>setPref("profile_color",e.target.value)} className="h-10 bg-slate-800 border-slate-700" /></div>
            <div><label className={labelClass}>Aanspreekvorm</label><select className={fieldClass} value={settings.gender} onChange={e=>setSettings(s=>({...s,gender:e.target.value as Gender}))}><option value="unspecified">Niet instellen</option><option value="male">Man</option><option value="female">Vrouw</option><option value="other">Anders</option></select></div>
          </div>
          <div><label className={labelClass}>Profielfoto uploaden</label><div className="flex items-center gap-3">{settings.preferences.profile_image_url && <img src={settings.preferences.profile_image_url} alt="Profielfoto" className="h-14 w-14 rounded-full object-cover"/>}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>350000){toast.error("Kies een afbeelding kleiner dan 350 KB.");e.currentTarget.value="";return;}const reader=new FileReader();reader.onload=()=>{if(typeof reader.result==="string")setPref("profile_image_url",reader.result);};reader.onerror=()=>toast.error("Afbeelding kon niet worden gelezen.");reader.readAsDataURL(file);}} className="min-w-0 text-xs text-slate-300"/></div><p className="mt-1 text-xs text-slate-500">PNG, JPG of WebP · maximaal 350 KB. De foto wordt bij je account opgeslagen.</p></div>
          <div><label className={labelClass}>Account-e-mailadres</label><Input value={settings.email} disabled className="bg-slate-800/60 border-slate-700 text-slate-400" /></div>
        </section>

        <section className={sectionClass}>
          <h3 className="font-semibold">Voertuigen</h3>
          {vehicles.map(v=><div key={v.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 p-3">
            <div className="flex min-w-0 items-center gap-2">{v.image_url && <img src={v.image_url} alt="" className="h-10 w-14 rounded object-cover"/>}<div><p className="font-medium">{v.name}{v.is_default ? " · Standaard" : ""}</p><p className="text-xs text-slate-400">{v.model_name} · {v.model_year ?? "jaar onbekend"} · zomer {v.summer_consumption_kwh100 ?? "—"} / winter {v.winter_consumption_kwh100 ?? "—"} kWh/100 km</p></div></div>
            <Button variant="outline" size="sm" className="border-slate-600" onClick={()=>void removeVehicle(v.id)}>Verwijderen</Button>
          </div>)}
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelClass}>Naam voertuig</label><Input value={vehicleDraft.name} onChange={e=>setVehicleDraft(v=>({...v,name:e.target.value}))} placeholder="Mijn Model Y" className="bg-slate-800 border-slate-700" /></div>
            <div className="col-span-2"><label className={labelClass}>Model / uitvoering uit admin-voertuigdatabase</label><select value={selectedCatalogueId} onChange={e=>{const id=e.target.value;setSelectedCatalogueId(id);const m=vehicleCatalogue.find(x=>x.id===id);if(m)setVehicleDraft(v=>({...v,model_name:[m.brand,m.model,m.trim].filter(Boolean).join(" "),model_year:String(m.year_to),battery_kwh:m.battery_kwh?.toString()??v.battery_kwh,summer_consumption_kwh100:m.consumption_kwh100?.toString()??v.summer_consumption_kwh100,winter_consumption_kwh100:m.winter_consumption_kwh100?.toString()??v.winter_consumption_kwh100,max_charge_kw:m.max_charge_kw?.toString()??v.max_charge_kw,image_url:m.image_url??v.image_url}))}} className={fieldClass}><option value="">Kies een voertuigvariant…</option>{vehicleCatalogue.map(m=><option key={m.id} value={m.id}>{m.brand} {m.model} {m.trim??""} ({m.year_from}–{m.year_to})</option>)}</select></div>
            <div className="col-span-2"><label className={labelClass}>Afbeeldings-URL van je Tesla (optioneel)</label><Input value={vehicleDraft.image_url} onChange={e=>setVehicleDraft(v=>({...v,image_url:e.target.value}))} placeholder="https://…" className="bg-slate-800 border-slate-700" /></div>
            {(["model_year","battery_kwh","summer_consumption_kwh100","winter_consumption_kwh100","max_charge_kw","arrival_percent","trailer_consumption_increase_percent","battery_health_percent","roof_or_rack_extra_percent","winter_tires_extra_percent"] as const).map(k=><div key={k}><label className={labelClass}>{{model_year:"Bouwjaar",battery_kwh:"Accu (kWh)",summer_consumption_kwh100:"Zomerverbruik (kWh/100 km)",winter_consumption_kwh100:"Winterverbruik (kWh/100 km)",max_charge_kw:"Max. laadsnelheid (kW)",arrival_percent:"Aankomstpercentage (%)",trailer_consumption_increase_percent:"Extra verbruik aanhanger (%)",battery_health_percent:"Accugezondheid (%)",roof_or_rack_extra_percent:"Extra verbruik dakdrager (%)",winter_tires_extra_percent:"Extra verbruik winterbanden (%)"}[k]}</label><Input type="number" value={vehicleDraft[k]} onChange={e=>{setVehicleDraft(v=>({...v,[k]:e.target.value}));if(k==="model_year"&&selectedCatalogueId){const selected=vehicleCatalogue.find(x=>x.id===selectedCatalogueId);const y=Number(e.target.value);const m=selected&&vehicleCatalogue.find(x=>x.brand===selected.brand&&x.model===selected.model&&x.trim===selected.trim&&y>=x.year_from&&y<=x.year_to);if(m){setSelectedCatalogueId(m.id);setVehicleDraft(v=>({...v,model_name:[m.brand,m.model,m.trim].filter(Boolean).join(" "),battery_kwh:m.battery_kwh?.toString()??v.battery_kwh,summer_consumption_kwh100:m.consumption_kwh100?.toString()??v.summer_consumption_kwh100,winter_consumption_kwh100:m.winter_consumption_kwh100?.toString()??v.winter_consumption_kwh100,max_charge_kw:m.max_charge_kw?.toString()??v.max_charge_kw,image_url:m.image_url??v.image_url}));}}}} className="bg-slate-800 border-slate-700" /></div>)}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={vehicleDraft.trailer_enabled} onChange={e=>setVehicleDraft(v=>({...v,trailer_enabled:e.target.checked}))}/> Aanhangermodus standaard aan</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={vehicleDraft.is_default} onChange={e=>setVehicleDraft(v=>({...v,is_default:e.target.checked}))}/> Instellen als standaardvoertuig</label>
          <Button disabled={vehicleSaving} onClick={()=>void addVehicle()} className="bg-red-600 hover:bg-red-700">{vehicleSaving ? "Opslaan…" : "Voertuig toevoegen"}</Button>
        </section>

        <section className={sectionClass}>
          <h3 className="font-semibold">Weergave en taal</h3>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelClass}>Taal</label><select className={fieldClass} value={settings.preferences.language ?? "nl"} onChange={e=>setPref("language",e.target.value)}><option value="nl">Nederlands</option><option value="en">English</option><option value="de">Deutsch</option><option value="fr">Français</option><option value="tr">Türkçe</option></select></div>
            <div><label className={labelClass}>Eenheden</label><select className={fieldClass} value={settings.preferences.units ?? "metric"} onChange={e=>setPref("units",e.target.value as "metric"|"imperial")}><option value="metric">Metrisch (km, kWh)</option><option value="imperial">Imperial (miles)</option></select></div>
            <div><label className={labelClass}>Thema</label><select className={fieldClass} value={settings.preferences.theme ?? "dark"} onChange={e=>setPref("theme",e.target.value as "light"|"dark"|"system")}><option value="dark">Donker</option><option value="light">Licht</option><option value="system">Systeem</option></select></div>
            <div><label className={labelClass}>Weergave</label><select className={fieldClass} value={settings.preferences.display_density ?? "comfortable"} onChange={e=>setPref("display_density",e.target.value as "compact"|"comfortable")}><option value="comfortable">Uitgebreid</option><option value="compact">Compact</option></select></div>
            <div><label className={labelClass}>Tekstgrootte</label><select className={fieldClass} value={String(settings.preferences.font_scale ?? 1)} onChange={e=>setPref("font_scale",Number(e.target.value))}><option value="0.85">Klein</option><option value="1">Normaal</option><option value="1.15">Groot</option><option value="1.3">Extra groot</option></select></div>
          </div>
        </section>

        <section className={sectionClass}>
          <h3 className="font-semibold">Kaart</h3>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelClass}>Kaarttype</label><select className={fieldClass} value={settings.preferences.map_type ?? "road"} onChange={e=>setPref("map_type",e.target.value as "road"|"satellite")}><option value="road">Normaal</option><option value="satellite">Satelliet</option></select></div>
            <div><label className={labelClass}>Standaard zoom (3–18)</label><Input type="number" min="3" max="18" value={settings.preferences.map_zoom ?? 7} onChange={e=>setPref("map_zoom",Math.max(3,Math.min(18,Number(e.target.value)||7)))} className="bg-slate-800 border-slate-700" /></div>
            <div><label className={labelClass}>Grootte kaartpunten (20–48)</label><Input type="number" min="20" max="48" value={settings.preferences.map_marker_size ?? 30} onChange={e=>setPref("map_marker_size",Math.max(20,Math.min(48,Number(e.target.value)||30)))} className="bg-slate-800 border-slate-700" /></div>
          </div>
          {(["show_development_chargers","remember_filters"] as const).map(k=><label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.preferences.map[k]} onChange={e=>setNested("map",k,e.target.checked)}/>{k==="show_development_chargers"?"Toon plannen en bouwlocaties standaard":"Kaartfilters onthouden"}</label>)}
          <div><label className={labelClass}>Landen onthouden (komma-gescheiden landcodes, bijv. NL,BE,DE)</label><Input value={(settings.preferences.remembered_countries ?? []).join(",")} onChange={e=>setPref("remembered_countries",e.target.value.split(",").map(x=>x.trim().toUpperCase()).filter(Boolean).slice(0,100))} className="bg-slate-800 border-slate-700" /></div>
          <h4 className="pt-2 text-sm font-medium">Eigen statuskleuren</h4>
          <div className="grid grid-cols-2 gap-3">{Object.entries(colorDefaults).map(([status, fallback])=><div key={status} className="flex items-center justify-between gap-2"><label className="text-xs text-slate-400">{status}</label><Input type="color" value={settings.preferences.status_colors?.[status] ?? fallback} onChange={e=>setNested("status_colors",status,e.target.value)} className="h-8 w-14 bg-slate-800 border-slate-700 p-1"/></div>)}</div>
        </section>

        <section className={sectionClass}>
          <h3 className="font-semibold">Routevoorkeuren</h3>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelClass}>Standaardroute</label><select className={fieldClass} value={settings.preferences.route_preferences?.priority ?? "fastest"} onChange={e=>setNested("route_preferences","priority",e.target.value)}><option value="fastest">Snelste</option><option value="cheapest">Goedkoopste</option><option value="fewest_stops">Minste laadstops</option></select></div>
            {(["default_charge_pause_min","max_detour_km","max_distance_between_stops_km","min_charger_kw"] as const).map(k=><div key={k}><label className={labelClass}>{{default_charge_pause_min:"Standaard laadpauze (min)",max_detour_km:"Max. omrijden (km)",max_distance_between_stops_km:"Max. afstand tussen stops (km)",min_charger_kw:"Min. laadvermogen (kW)"}[k]}</label><Input type="number" value={settings.preferences.route_preferences?.[k] ?? 0} onChange={e=>setNested("route_preferences",k,Number(e.target.value))} className="bg-slate-800 border-slate-700"/></div>)}
          </div>
        </section>

        <section className={sectionClass}>
          <h3 className="font-semibold">Opgeslagen routeprofielen</h3>
          <div className="flex gap-2"><Input value={profileName} onChange={e=>setProfileName(e.target.value)} placeholder="Bijv. Vakantie met aanhanger" className="bg-slate-800 border-slate-700"/><Button onClick={()=>void saveRouteProfile()} disabled={!profileName.trim()} className="bg-red-600 hover:bg-red-700">Opslaan</Button></div>
          {routeProfiles.length===0 ? <p className="text-xs text-slate-500">Nog geen routeprofielen opgeslagen.</p> : routeProfiles.map(p=><div key={p.id} className="flex items-center justify-between gap-2 rounded border border-slate-700 p-2 text-sm"><span>{p.name}</span><div className="flex gap-1"><Button size="sm" variant="outline" className="border-slate-600" onClick={()=>applyRouteProfile(p)}>Gebruiken</Button><Button size="sm" variant="ghost" onClick={()=>void removeRouteProfile(p.id)}>Verwijderen</Button></div></div>)}
        </section>

        <section className={sectionClass}>
          <h3 className="font-semibold">Laadgeschiedenis</h3>
          <div className="grid grid-cols-2 gap-2">
            <Input value={sessionDraft.charger_name} onChange={e=>setSessionDraft(v=>({...v,charger_name:e.target.value}))} placeholder="Supercharger / locatie" className="bg-slate-800 border-slate-700"/>
            <Input type="number" value={sessionDraft.energy_kwh} onChange={e=>setSessionDraft(v=>({...v,energy_kwh:e.target.value}))} placeholder="kWh geladen" className="bg-slate-800 border-slate-700"/>
            <Input type="number" value={sessionDraft.cost_amount} onChange={e=>setSessionDraft(v=>({...v,cost_amount:e.target.value}))} placeholder="Kosten in euro (optioneel)" className="bg-slate-800 border-slate-700"/>
            <Input value={sessionDraft.notes} onChange={e=>setSessionDraft(v=>({...v,notes:e.target.value}))} placeholder="Notitie (optioneel)" className="bg-slate-800 border-slate-700"/>
          </div>
          <div className="rounded border border-slate-700 bg-slate-800/60 p-2 text-xs text-slate-300">Totaal geregistreerd: {chargingSessions.reduce((sum, item) => sum + Number(item.energy_kwh || 0), 0).toFixed(1)} kWh · {chargingSessions.filter(item => item.cost_amount != null).reduce((sum, item) => sum + Number(item.cost_amount || 0), 0).toFixed(2)} EUR</div>
          <Button onClick={()=>void addChargingSession()} className="bg-red-600 hover:bg-red-700">Laadsessie toevoegen</Button>
          {chargingSessions.slice(0,8).map(session=><div key={session.id} className="flex items-center justify-between gap-2 rounded border border-slate-700 p-2 text-xs"><span>{session.charger_name || "Locatie onbekend"} · {session.energy_kwh} kWh{session.cost_amount != null ? " · €" + Number(session.cost_amount).toFixed(2) : ""}</span><Button size="sm" variant="ghost" onClick={()=>void removeChargingSession(session.id)}>Verwijderen</Button></div>)}
        </section>

        <section className={sectionClass}>
          <h3 className="font-semibold">Meldingen</h3>
          {([
            ["favorite_status","Wijzigingen bij favoriete Superchargers"],["price_changes","Prijswijzigingen"],["new_locations","Nieuwe locaties"],["closed_locations","Gesloten locaties"],["status_changes","Statuswijzigingen"],["email_enabled","E-mailmeldingen inschakelen"],["push_enabled","Pushmeldingen inschakelen"],
          ] as const).map(([key,label])=><label key={key} className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={settings.preferences.notifications[key] ?? false} onChange={e=>setNested("notifications",key,e.target.checked)}/>{label}</label>)}
          <p className="text-xs text-amber-300">E-mail- en pushbezorging blijven uitgeschakeld totdat de externe maildienst en pushsleutels veilig zijn ingesteld. Deze keuzes bewaren alleen je voorkeur.</p>
        </section>

        <section className={sectionClass}>
          <h3 className="font-semibold">Instellingen exporteren / importeren</h3>
          <p className="text-xs text-slate-400">Maak een reservekopie van je voorkeuren en voertuigen. Importeren voegt voertuigen toe en verwijdert geen bestaande gegevens.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="border-slate-600" onClick={exportAccountData}>Exporteren als JSON</Button>
            <label className="inline-flex cursor-pointer items-center rounded-md border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800">JSON importeren<input type="file" accept="application/json,.json" className="sr-only" onChange={e=>{ void importAccountData(e.target.files?.[0]); e.currentTarget.value=""; }}/></label>
          </div>
        </section>

        <section className={sectionClass}>
          <h3 className="font-semibold">Wachtwoord wijzigen</h3>
          <Input type="password" autoComplete="current-password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} placeholder="Huidig wachtwoord" className="bg-slate-800 border-slate-700"/>
          <Input type="password" autoComplete="new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="Nieuw wachtwoord (minimaal 10 tekens)" className="bg-slate-800 border-slate-700"/>
          <Input type="password" autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} placeholder="Herhaal nieuw wachtwoord" className="bg-slate-800 border-slate-700"/>
          <Button variant="outline" className="border-slate-600" disabled={!currentPassword || newPassword.length<10 || !confirmPassword} onClick={()=>void savePassword()}>Wachtwoord wijzigen</Button>
        </section>
      </div>}
      <DialogFooter>
        <Button variant="ghost" onClick={()=>onOpenChange(false)}>Sluiten</Button>
        <Button disabled={loading || saving} className="bg-red-600 hover:bg-red-700" onClick={()=>void save()}>{saving?"Opslaan…":"Instellingen opslaan"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
