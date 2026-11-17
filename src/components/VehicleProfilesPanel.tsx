import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listMyVehicles, saveMyVehicle, deleteMyVehicle } from "@/lib/account.functions";
import { toast } from "sonner";

type Vehicle = {
  id: string;
  name: string;
  model_name: string;
  model_year: number | null;
  image_url: string | null;
  summer_consumption_kwh100: number | null;
  winter_consumption_kwh100: number | null;
  max_charge_kw: number | null;
  arrival_percent: number;
  trailer_enabled: boolean;
  trailer_reduction_percent: number;
  is_default: boolean;
};

const emptyVehicle = (): Omit<Vehicle, "id"> => ({
  name: "Mijn Tesla",
  model_name: "",
  model_year: null,
  image_url: null,
  summer_consumption_kwh100: null,
  winter_consumption_kwh100: null,
  max_charge_kw: null,
  arrival_percent: 10,
  trailer_enabled: false,
  trailer_reduction_percent: 40,
  is_default: false,
});

export function VehicleProfilesPanel() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [draft, setDraft] = useState(emptyVehicle());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const listFn = useServerFn(listMyVehicles);
  const saveFn = useServerFn(saveMyVehicle);
  const deleteFn = useServerFn(deleteMyVehicle);

  const reload = async () => {
    const rows = await listFn();
    setVehicles(rows.map((row) => ({
      ...row,
      trailer_enabled: row.trailer_enabled === 1 || row.trailer_enabled === true,
      is_default: row.is_default === 1 || row.is_default === true,
    })) as Vehicle[]);
  };

  useEffect(() => {
    let active = true;
    void listFn().then((rows) => {
      if (active) setVehicles(rows.map((row) => ({
        ...row,
        trailer_enabled: row.trailer_enabled === 1 || row.trailer_enabled === true,
        is_default: row.is_default === 1 || row.is_default === true,
      })) as Vehicle[]);
    }).catch((error) => toast.error(error instanceof Error ? error.message : "Voertuigen laden mislukt"))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [listFn]);

  const save = async (vehicle: Omit<Vehicle, "id">, id?: string) => {
    setSaving(true);
    try {
      await saveFn({ data: { ...vehicle, id } });
      await reload();
      setDraft(emptyVehicle());
      toast.success("Voertuig opgeslagen");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Voertuig opslaan mislukt");
    } finally { setSaving(false); }
  };

  const update = (id: string, patch: Partial<Vehicle>) => {
    setVehicles((old) => old.map((v) => v.id === id ? { ...v, ...patch } : v));
  };

  return (
    <section className="space-y-3 border-t border-slate-700 pt-4">
      <div>
        <h3 className="font-semibold">Meerdere voertuigen</h3>
        <p className="text-xs text-slate-500">Sla meerdere Tesla's op. Kies één standaardvoertuig voor de routeplanner.</p>
      </div>
      {loading ? <p className="text-xs text-slate-400">Voertuigen laden…</p> : vehicles.map((v) => (
        <div key={v.id} className="space-y-2 rounded-lg border border-slate-700 bg-slate-800/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <strong className="text-sm">{v.name}{v.is_default ? " · Standaard" : ""}</strong>
            <Button size="sm" variant="ghost" className="text-red-300" onClick={async () => {
              try { await deleteFn({ data: { id: v.id } }); await reload(); toast.success("Voertuig verwijderd"); }
              catch (error) { toast.error(error instanceof Error ? error.message : "Verwijderen mislukt"); }
            }}>Verwijderen</Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input value={v.name} aria-label="Voertuignaam" onChange={(e) => update(v.id,{name:e.target.value})} />
            <Input value={v.model_name} aria-label="Tesla-model" placeholder="Tesla-model" onChange={(e) => update(v.id,{model_name:e.target.value})} />
            <Input type="number" value={v.model_year ?? ""} aria-label="Bouwjaar" placeholder="Bouwjaar" onChange={(e) => update(v.id,{model_year:e.target.value ? Number(e.target.value) : null})} />
            <Input type="number" value={v.max_charge_kw ?? ""} aria-label="Maximale laadsnelheid kW" placeholder="Max. kW" onChange={(e) => update(v.id,{max_charge_kw:e.target.value ? Number(e.target.value) : null})} />
            <Input type="number" step="0.1" value={v.summer_consumption_kwh100 ?? ""} aria-label="Zomerverbruik" placeholder="Zomer kWh/100 km" onChange={(e) => update(v.id,{summer_consumption_kwh100:e.target.value ? Number(e.target.value) : null})} />
            <Input type="number" step="0.1" value={v.winter_consumption_kwh100 ?? ""} aria-label="Winterverbruik" placeholder="Winter kWh/100 km" onChange={(e) => update(v.id,{winter_consumption_kwh100:e.target.value ? Number(e.target.value) : null})} />
            <Input type="number" min="0" max="100" value={v.arrival_percent} aria-label="Aankomstpercentage" placeholder="Aankomst %" onChange={(e) => update(v.id,{arrival_percent:Number(e.target.value)})} />
            <Input type="number" min="0" max="100" value={v.trailer_reduction_percent} aria-label="Aanhangerverbruiksverhoging" placeholder="Aanhanger %" onChange={(e) => update(v.id,{trailer_reduction_percent:Number(e.target.value)})} />
          </div>
          <Input value={v.image_url ?? ""} aria-label="Tesla-afbeelding URL" placeholder="Afbeelding-URL (optioneel)" onChange={(e) => update(v.id,{image_url:e.target.value || null})} />
          <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={v.trailer_enabled} onChange={(e) => update(v.id,{trailer_enabled:e.target.checked})} /> Aanhanger standaard ingeschakeld</label>
          <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={v.is_default} onChange={(e) => update(v.id,{is_default:e.target.checked})} /> Gebruik als standaardvoertuig</label>
          <Button size="sm" disabled={saving} onClick={() => save(v,v.id)}>Wijzigingen opslaan</Button>
        </div>
      ))}
      <div className="space-y-2 rounded-lg border border-dashed border-slate-600 p-3">
        <strong className="text-sm">Nieuw voertuig toevoegen</strong>
        <div className="grid grid-cols-2 gap-2">
          <Input value={draft.name} placeholder="Naam, bijv. Model Y" onChange={(e) => setDraft((v) => ({...v,name:e.target.value}))} />
          <Input value={draft.model_name} placeholder="Model / uitvoering" onChange={(e) => setDraft((v) => ({...v,model_name:e.target.value}))} />
          <Input type="number" placeholder="Bouwjaar" value={draft.model_year ?? ""} onChange={(e) => setDraft((v) => ({...v,model_year:e.target.value ? Number(e.target.value) : null}))} />
          <Input type="number" placeholder="Max. laadsnelheid kW" value={draft.max_charge_kw ?? ""} onChange={(e) => setDraft((v) => ({...v,max_charge_kw:e.target.value ? Number(e.target.value) : null}))} />
          <Input type="number" step="0.1" placeholder="Zomer kWh/100 km" value={draft.summer_consumption_kwh100 ?? ""} onChange={(e) => setDraft((v) => ({...v,summer_consumption_kwh100:e.target.value ? Number(e.target.value) : null}))} />
          <Input type="number" step="0.1" placeholder="Winter kWh/100 km" value={draft.winter_consumption_kwh100 ?? ""} onChange={(e) => setDraft((v) => ({...v,winter_consumption_kwh100:e.target.value ? Number(e.target.value) : null}))} />
        </div>
        <Button size="sm" disabled={saving || !draft.name.trim()} onClick={() => save(draft)}>Voertuig toevoegen</Button>
      </div>
    </section>
  );
}
