import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMyAccountSettings, updateMyAccountSettings, listMyVehicles, saveMyVehicle, deleteMyVehicle } from "@/lib/account.functions";
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
  id: string; name: string; model_name: string; model_year?: number | null;
  battery_kwh?: number | null; summer_consumption_kwh100?: number | null;
  winter_consumption_kwh100?: number | null; max_charge_kw?: number | null;
  arrival_percent: number; trailer_enabled: boolean; trailer_consumption_increase_percent: number;
  is_default: boolean; battery_health_percent?: number | null;
  roof_or_rack_extra_percent: number; winter_tires_extra_percent: number;
};

const defaults: Settings = {
  email: "", display_name: "", gender: "unspecified",
  preferences: {
    vehicle_model: "", vehicle_year: null, consumption_kwh100: null, greeting: "",
    profile_color: "#e82127", language: "nl", units: "metric", display_density: "comfortable",
    font_scale: 1, theme: "dark", map_type: "road", map_zoom: 7, remembered_countries: [],
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
  const [vehicleDraft, setVehicleDraft] = useState({ name: "", model_name: "", model_year: "2025", battery_kwh: "75", summer_consumption_kwh100: "17", winter_consumption_kwh100: "22", max_charge_kw: "250", arrival_percent: "10", trailer_enabled: false, trailer_consumption_increase_percent: "20", is_default: true });
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
  const changePasswordFn = useServerFn(changePassword);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    void Promise.all([getMyAccountSettings(), listVehiclesFn()]).then(([data, list]) => {
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
        model_year: Number(vehicleDraft.model_year), battery_kwh: Number(vehicleDraft.battery_kwh),
        summer_consumption_kwh100: Number(vehicleDraft.summer_consumption_kwh100),
        winter_consumption_kwh100: Number(vehicleDraft.winter_consumption_kwh100),
        max_charge_kw: Number(vehicleDraft.max_charge_kw), arrival_percent: Number(vehicleDraft.arrival_percent),
        trailer_enabled: vehicleDraft.trailer_enabled,
        trailer_consumption_increase_percent: Number(vehicleDraft.trailer_consumption_increase_percent),
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
          <div><label className={labelClass}>Account-e-mailadres</label><Input value={settings.email} disabled className="bg-slate-800/60 border-slate-700 text-slate-400" /></div>
          <p className="text-xs text-slate-500">Profielfoto-upload wordt pas ingeschakeld zodra de veilige Cloudflare R2-opslag is ingericht.</p>
        </section>

        <section className={sectionClass}>
          <h3 className="font-semibold">Voertuigen</h3>
          {vehicles.map(v=><div key={v.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 p-3">
            <div className="min-w-0"><p className="font-medium">{v.name}{v.is_default ? " · Standaard" : ""}</p><p className="text-xs text-slate-400">{v.model_name} · {v.model_year ?? "jaar onbekend"} · zomer {v.summer_consumption_kwh100 ?? "—"} / winter {v.winter_consumption_kwh100 ?? "—"} kWh/100 km</p></div>
            <Button variant="outline" size="sm" className="border-slate-600" onClick={()=>void removeVehicle(v.id)}>Verwijderen</Button>
          </div>)}
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelClass}>Naam voertuig</label><Input value={vehicleDraft.name} onChange={e=>setVehicleDraft(v=>({...v,name:e.target.value}))} placeholder="Mijn Model Y" className="bg-slate-800 border-slate-700" /></div>
            <div><label className={labelClass}>Model / uitvoering</label><Input value={vehicleDraft.model_name} onChange={e=>setVehicleDraft(v=>({...v,model_name:e.target.value}))} placeholder="Model Y Long Range AWD" className="bg-slate-800 border-slate-700" /></div>
            {(["model_year","battery_kwh","summer_consumption_kwh100","winter_consumption_kwh100","max_charge_kw","arrival_percent","trailer_consumption_increase_percent"] as const).map(k=><div key={k}><label className={labelClass}>{{model_year:"Bouwjaar",battery_kwh:"Accu (kWh)",summer_consumption_kwh100:"Zomerverbruik (kWh/100 km)",winter_consumption_kwh100:"Winterverbruik (kWh/100 km)",max_charge_kw:"Max. laadsnelheid (kW)",arrival_percent:"Aankomstpercentage (%)",trailer_consumption_increase_percent:"Extra verbruik aanhanger (%)"}[k]}</label><Input type="number" value={vehicleDraft[k]} onChange={e=>setVehicleDraft(v=>({...v,[k]:e.target.value}))} className="bg-slate-800 border-slate-700" /></div>)}
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
          <h3 className="font-semibold">Meldingen</h3>
          {([
            ["favorite_status","Wijzigingen bij favoriete Superchargers"],["price_changes","Prijswijzigingen"],["new_locations","Nieuwe locaties"],["closed_locations","Gesloten locaties"],["status_changes","Statuswijzigingen"],["email_enabled","E-mailmeldingen inschakelen"],["push_enabled","Pushmeldingen inschakelen"],
          ] as const).map(([key,label])=><label key={key} className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={settings.preferences.notifications[key] ?? false} onChange={e=>setNested("notifications",key,e.target.checked)}/>{label}</label>)}
          <p className="text-xs text-amber-300">E-mail- en pushbezorging blijven uitgeschakeld totdat de externe maildienst en pushsleutels veilig zijn ingesteld. Deze keuzes bewaren alleen je voorkeur.</p>
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
