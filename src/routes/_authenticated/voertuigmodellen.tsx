import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentUser } from "@/lib/auth.functions";
import { adminListVehicleModels, adminSaveVehicleModel, adminDeleteVehicleModel } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/voertuigmodellen")({
  ssr: false,
  head: () => ({ meta: [{ title: "Voertuigdatabase beheren — TeslaNavigation" }] }),
  component: VehicleModelsAdmin,
});

type Model = {
  id:string; brand:string; model:string; trim:string|null; battery_kwh:number|null; usable_kwh:number|null;
  range_km:number|null; consumption_kwh100:number|null; winter_consumption_kwh100:number|null; year_from:number; year_to:number;
  max_charge_kw:number|null; connectors:string[]|string; image_url:string|null; notes:string|null; published:number|boolean;
};
const blank = {brand:"Tesla",model:"",trim:"",battery_kwh:"",usable_kwh:"",range_km:"",consumption_kwh100:"",winter_consumption_kwh100:"",year_from:"2025",year_to:"2025",max_charge_kw:"",connectors:"Type 2, CCS",image_url:"",notes:"",published:true};
function VehicleModelsAdmin(){
  const [admin,setAdmin]=useState<boolean|null>(null);
  const [rows,setRows]=useState<Model[]>([]);
  const [draft,setDraft]=useState(blank);
  const [editing,setEditing]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const listFn=useServerFn(adminListVehicleModels), saveFn=useServerFn(adminSaveVehicleModel), deleteFn=useServerFn(adminDeleteVehicleModel);
  const load=async()=>{setLoading(true);try{setRows(await listFn() as Model[]);}catch(e){toast.error(e instanceof Error?e.message:"Voertuigdatabase laden mislukt");}finally{setLoading(false);}};
  useEffect(()=>{let active=true;void getCurrentUser().then(u=>{if(!active)return;setAdmin(!!u?.is_admin);if(u?.is_admin)void load();}).catch(()=>{if(active)setAdmin(false);});return()=>{active=false;};},[]);
  const reset=()=>{setDraft(blank);setEditing(null);};
  const edit=(r:Model)=>{setEditing(r.id);setDraft({brand:r.brand,model:r.model,trim:r.trim??"",battery_kwh:r.battery_kwh?.toString()??"",usable_kwh:r.usable_kwh?.toString()??"",range_km:r.range_km?.toString()??"",consumption_kwh100:r.consumption_kwh100?.toString()??"",winter_consumption_kwh100:r.winter_consumption_kwh100?.toString()??"",year_from:String(r.year_from),year_to:String(r.year_to),max_charge_kw:r.max_charge_kw?.toString()??"",connectors:Array.isArray(r.connectors)?r.connectors.join(", "):String(r.connectors??"Type 2, CCS"),image_url:r.image_url??"",notes:r.notes??"",published:!!r.published});};
  const save=async()=>{if(!draft.model.trim()){toast.error("Vul een modelnaam in.");return;}try{await saveFn({data:{...(editing?{id:editing}:{}),brand:draft.brand,model:draft.model,trim:draft.trim||null,battery_kwh:draft.battery_kwh?Number(draft.battery_kwh):null,usable_kwh:draft.usable_kwh?Number(draft.usable_kwh):null,range_km:draft.range_km?Number(draft.range_km):null,consumption_kwh100:draft.consumption_kwh100?Number(draft.consumption_kwh100):null,winter_consumption_kwh100:draft.winter_consumption_kwh100?Number(draft.winter_consumption_kwh100):null,year_from:Number(draft.year_from),year_to:Number(draft.year_to),max_charge_kw:draft.max_charge_kw?Number(draft.max_charge_kw):null,connectors:draft.connectors.split(",").map(x=>x.trim()).filter(Boolean),image_url:draft.image_url||null,notes:draft.notes||null,published:draft.published}});toast.success("Voertuigvariant opgeslagen");reset();await load();}catch(e){toast.error(e instanceof Error?e.message:"Opslaan mislukt");}};
  const remove=async(id:string)=>{if(!window.confirm("Deze voertuigvariant verwijderen?"))return;try{await deleteFn({data:{id}});await load();toast.success("Variant verwijderd");}catch(e){toast.error(e instanceof Error?e.message:"Verwijderen mislukt");}};
  if(admin===null)return <main className="min-h-screen bg-slate-950 p-8 text-white">Controleren…</main>;
  if(!admin)return <main className="min-h-screen bg-slate-950 p-8 text-white">Alleen admins hebben toegang. <Link to="/" className="text-red-400">Terug</Link></main>;
  return <main className="min-h-screen bg-slate-950 p-4 md:p-8 text-white"><div className="mx-auto max-w-6xl space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><Link to="/admin" className="text-sm text-slate-400">← Terug naar admin</Link><h1 className="mt-2 text-2xl font-bold">Voertuigdatabase</h1><p className="text-sm text-slate-400">Beheer merk, model, bouwjaren en de technische gegevens die automatisch in routeberekeningen worden gebruikt.</p></div><Button variant="outline" onClick={reset}>Nieuwe variant</Button></header>
    <section className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-3"><h2 className="font-semibold">{editing?"Variant aanpassen":"Variant toevoegen"}</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{draft.image_url.trim() && <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800 p-3"><img src={draft.image_url} alt={`${draft.brand} ${draft.model}`} className="h-20 w-32 rounded-md object-contain bg-slate-900" /><span className="text-xs text-slate-400">Voorbeeldfoto voertuig</span></div>}
      {(["brand","model","trim","year_from","year_to","battery_kwh","usable_kwh","range_km","consumption_kwh100","winter_consumption_kwh100","max_charge_kw","connectors","image_url","notes"] as const).map(k=><label key={k} className="text-xs text-slate-400">{({brand:"Merk",model:"Model",trim:"Uitvoering",year_from:"Vanaf bouwjaar",year_to:"Tot bouwjaar",battery_kwh:"Accu bruto (kWh)",usable_kwh:"Accu bruikbaar (kWh)",range_km:"WLTP-bereik (km)",consumption_kwh100:"Zomerverbruik (kWh/100 km)",winter_consumption_kwh100:"Winterverbruik (kWh/100 km)",max_charge_kw:"Max. laden (kW)",connectors:"Stekkers (komma-gescheiden)",image_url:"Foto-URL",notes:"Opmerkingen"} as Record<string,string>)[k]}<Input value={draft[k]} onChange={e=>setDraft(d=>({...d,[k]:e.target.value}))} className="mt-1 border-slate-700 bg-slate-800 text-white"/></label>)}
    </div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.published} onChange={e=>setDraft(d=>({...d,published:e.target.checked}))}/> Beschikbaar voor gebruikers</label><div className="flex gap-2"><Button onClick={()=>void save()} className="bg-red-600 hover:bg-red-700">Opslaan</Button>{editing&&<Button variant="outline" onClick={reset}>Annuleren</Button>}</div></section>
    <section className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h2 className="mb-3 font-semibold">Opgeslagen voertuigvarianten</h2>{loading?<p className="text-sm text-slate-400">Laden…</p>:rows.length===0?<p className="text-sm text-slate-400">Nog geen varianten. Voeg hierboven de eerste toe.</p>:<div className="space-y-2">{rows.map(r=><div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-700 p-3">{r.image_url && <img src={r.image_url} alt={`${r.brand} ${r.model}`} className="h-14 w-24 rounded object-contain bg-slate-800" />}<div className="min-w-0 flex-1"><p className="font-medium">{r.brand} {r.model} {r.trim??""} · {r.year_from}–{r.year_to}</p><p className="text-xs text-slate-400">Accu {r.battery_kwh??"—"} kWh (bruikbaar {r.usable_kwh??"—"}) · {r.range_km??"—"} km · laden {r.max_charge_kw??"—"} kW · {r.published?"Gepubliceerd":"Verborgen"}</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={()=>edit(r)}>Aanpassen</Button><Button size="sm" variant="destructive" onClick={()=>void remove(r.id)}>Verwijderen</Button></div></div>)}</div>}</section>
  </div></main>;
}
