import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listPublicChargerHistory } from "@/lib/admin.functions";
import type { Supercharger } from "@/lib/tesla-types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart3, Compass, Gauge, GitCompareArrows, History, Lightbulb, Radar, Sparkles, TrendingUp, Trophy, WandSparkles } from "lucide-react";

type Props = { open: boolean; onOpenChange: (open: boolean) => void; chargers: Supercharger[] };

const statusLabel: Record<string, string> = {
  operational: "In bedrijf", construction: "In aanbouw", permit: "Vergunning",
  expanding: "Wordt uitgebreid", works: "Werkzaamheden", works_closed: "Dicht door werkzaamheden",
  temp_closed: "Tijdelijk gesloten", long_closed: "Langdurig gesloten",
  permanent_closed: "Permanent gesloten", unknown: "Onbekend",
};



const fmt = (n?: number) => typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("nl-NL") : "—";
const chargerKey = (charger: Supercharger) => charger.id || `${charger.name}|${charger.lat}|${charger.lng}`;

export default function SuperchargerLab({ open, onOpenChange, chargers }: Props) {
  const [firstId, setFirstId] = useState("");
  const [firstSearch, setFirstSearch] = useState("");
  const [secondSearch, setSecondSearch] = useState("");
  const [scenarioSearch, setScenarioSearch] = useState("");
  const [collectionSearch, setCollectionSearch] = useState("");
  const [secondId, setSecondId] = useState("");
  const [scenarioId, setScenarioId] = useState("");
  const [history, setHistory] = useState<Array<{id:string;chargerName:string;action:string;changedFields:Record<string,unknown>;createdAt:string}>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [visitedIds, setVisitedIds] = useState<string[]>([]);
  const [visitedLoaded, setVisitedLoaded] = useState(false);
  const loadHistory = useServerFn(listPublicChargerHistory);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("teslanavigation-visited-superchargers-v1");
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed)) setVisitedIds(parsed.filter((id): id is string => typeof id === "string"));
      }
    } catch { /* Local collection remains available even if browser storage is blocked. */ }
    setVisitedLoaded(true);
  }, []);
  useEffect(() => {
    if (!visitedLoaded) return;
    try { window.localStorage.setItem("teslanavigation-visited-superchargers-v1", JSON.stringify(visitedIds)); } catch { /* Do not interrupt discovery tools when storage is unavailable. */ }
  }, [visitedIds, visitedLoaded]);
  const toggleVisited = (id: string) => setVisitedIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setHistoryLoading(true);
    void loadHistory({ data: { limit: 60 } }).then(rows => { if (active) setHistory(rows); }).catch(() => { if (active) setHistory([]); }).finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [open, loadHistory]);

  const matchesSearch = (charger: Supercharger, query: string) => {
    const normalize = (value?: string | null) => (value ?? "").normalize("NFKC").trim().toLocaleLowerCase("nl-NL");
    const needle = normalize(query);
    if (!needle) return true;
    return [charger.name, charger.country, charger.city, charger.province].some(value => normalize(value).includes(needle));
  };
  const operational = useMemo(() => chargers.filter(c => c.status === "operational"), [chargers]);
  const countries = useMemo(() => {
    const map = new Map<string, { total: number; active: number; building: number }>();
    chargers.forEach(c => {
      const country = c.country?.trim() || "Onbekend";
      const row = map.get(country) ?? { total: 0, active: 0, building: 0 };
      row.total++;
      if (c.status === "operational") row.active++;
      if (c.status === "construction" || c.status === "permit" || c.status === "expanding") row.building++;
      map.set(country, row);
    });
    return [...map.entries()].map(([country, value]) => ({ country, ...value })).sort((a,b) => b.total-a.total);
  }, [chargers]);

  const biggest = useMemo(() => [...operational].sort((a,b) => (b.totalStalls ?? 0)-(a.totalStalls ?? 0)).slice(0,5), [operational]);
  const fastest = useMemo(() => [...operational].sort((a,b) => (b.maxSpeedKw ?? 0)-(a.maxSpeedKw ?? 0)).slice(0,5), [operational]);
  const selectedA = chargers.find(c => chargerKey(c) === firstId);
  const selectedB = chargers.find(c => chargerKey(c) === secondId);
  const scenario = chargers.find(c => chargerKey(c) === scenarioId);
  const alternatives = useMemo(() => {
    if (!scenario) return [];
    return operational.filter(c => c.id !== scenario.id).map(c => ({
      charger: c,
      distance: 6371 * 2 * Math.asin(Math.sqrt(
        Math.sin(((c.lat-scenario.lat)*Math.PI/180)/2)**2 +
        Math.cos(scenario.lat*Math.PI/180)*Math.cos(c.lat*Math.PI/180)*
        Math.sin(((c.lng-scenario.lng)*Math.PI/180)/2)**2
      )),
    })).sort((a,b) => a.distance-b.distance).slice(0,5);
  }, [scenario, operational]);

  const compareRows = selectedA && selectedB ? [
    ["Status", statusLabel[selectedA.status ?? "unknown"], statusLabel[selectedB.status ?? "unknown"]],
    ["Laadpunten", fmt(selectedA.totalStalls), fmt(selectedB.totalStalls)],
    ["Maximaal vermogen", selectedA.maxSpeedKw ? selectedA.maxSpeedKw+" kW" : "—", selectedB.maxSpeedKw ? selectedB.maxSpeedKw+" kW" : "—"],
    ["Land", selectedA.country || "—", selectedB.country || "—"],
    ["Eigenaar", selectedA.ownerName || "—", selectedB.ownerName || "—"],
    ["Voorzieningen", (selectedA.siteAmenities ?? selectedA.construction?.siteAmenities ?? []).join(", ") || "—", (selectedB.siteAmenities ?? selectedB.construction?.siteAmenities ?? []).join(", ") || "—"],
  ] : [];

  const featureCards = [
    { icon: Radar, title: "Risicometer", text: "Locaties met sluitings- of werkzaamhedenstatus vallen direct op.", value: chargers.filter(c => ["temp_closed","long_closed","works_closed","unknown"].includes(c.status ?? "unknown")).length + " aandachtspunten" },
    { icon: Compass, title: "Wat-als-scenario", text: "Kies een locatie en bekijk vijf operationele alternatieven in de buurt." },
    { icon: Sparkles, title: "Supercharger-DNA", text: "Bekijk de unieke combinatie van capaciteit, vermogen, eigenaar en voorzieningen." },
    { icon: TrendingUp, title: "Europa groeit", text: countries.length + " landen/regio's in de huidige dataset" },
    { icon: Lightbulb, title: "Verborgen parels", text: chargers.filter(c => (c.siteAmenities?.length ?? c.construction?.siteAmenities?.length ?? 0) > 0).length + " locaties met geregistreerde voorzieningen" },
    { icon: Trophy, title: "Netwerkrecords", text: "Grootste locaties en hoogste geregistreerde laadvermogens." },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[min(1100px,96vw)] max-w-none overflow-y-auto border-slate-200 bg-white p-0 text-slate-900">
        <div className="bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 p-6 text-white sm:p-8">
          <DialogHeader>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-cyan-300"><WandSparkles className="h-4 w-4" /> TESLANAVIGATION LAB</div>
            <DialogTitle className="text-2xl font-black tracking-tight text-white sm:text-3xl">Ontdek het Supercharger-netwerk</DialogTitle>
            <DialogDescription className="max-w-2xl text-slate-300">Nieuwe manieren om Europa's Tesla Superchargers te ontdekken, vergelijken en onderzoeken. Alles hieronder gebruikt de actuele dataset; ontbrekende historische gegevens worden niet verzonnen.</DialogDescription>
          </DialogHeader>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["Locaties", chargers.length],["In bedrijf", operational.length],["Landen", countries.length],["In ontwikkeling", chargers.filter(c => ["construction","permit","expanding"].includes(c.status ?? "")).length]].map(([label,value]) => <div key={label} className="rounded-2xl border border-white/10 bg-white/10 p-3"><div className="text-xs text-slate-300">{label}</div><div className="mt-1 text-2xl font-black">{fmt(Number(value))}</div></div>)}
          </div>
        </div>

        <div className="space-y-7 p-4 sm:p-7">
          <section>
            <div className="mb-3 flex items-center gap-2"><Sparkles className="h-5 w-5 text-blue-600"/><h3 className="text-lg font-bold">Nieuwe interactieve tools</h3></div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {featureCards.map(({icon: Icon,title,text,value}) => <div key={title} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center justify-between"><Icon className="h-5 w-5 text-blue-600"/>{value && <Badge variant="secondary">{value}</Badge>}</div><h4 className="mt-3 font-bold">{title}</h4><p className="mt-1 text-sm leading-relaxed text-slate-600">{text}</p></div>)}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="mb-3 flex items-center gap-2"><GitCompareArrows className="h-5 w-5 text-blue-600"/><h3 className="font-bold">Supercharger-duel</h3></div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-2"><input value={firstSearch} onChange={e=>setFirstSearch(e.target.value)} placeholder="Zoek op naam, land, stad of provincie…" className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"/><Select value={firstId} onValueChange={setFirstId}><SelectTrigger><SelectValue placeholder="Eerste locatie"/></SelectTrigger><SelectContent>{chargers.filter(c=>matchesSearch(c,firstSearch)).map(c => <SelectItem key={chargerKey(c)} value={chargerKey(c)}>{c.name} · {[c.city,c.province,c.country].filter(Boolean).join(", ")}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><input value={secondSearch} onChange={e=>setSecondSearch(e.target.value)} placeholder="Zoek op naam, land, stad of provincie…" className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"/><Select value={secondId} onValueChange={setSecondId}><SelectTrigger><SelectValue placeholder="Tweede locatie"/></SelectTrigger><SelectContent>{chargers.filter(c=>matchesSearch(c,secondSearch)).map(c => <SelectItem key={c.id ?? c.name} value={c.id ?? c.name}>{c.name} · {[c.city,c.province,c.country].filter(Boolean).join(", ")}</SelectItem>)}</SelectContent></Select></div>
              </div>
              {compareRows.length > 0 ? <div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="p-2 text-left text-slate-500">Eigenschap</th><th className="p-2 text-left">{selectedA?.name}</th><th className="p-2 text-left">{selectedB?.name}</th></tr></thead><tbody>{compareRows.map(row=><tr key={row[0]} className="border-t border-slate-100"><td className="p-2 text-slate-500">{row[0]}</td><td className="p-2 font-medium">{row[1]}</td><td className="p-2 font-medium">{row[2]}</td></tr>)}</tbody></table></div> : <p className="mt-3 text-sm text-slate-500">Kies twee locaties om ze direct te vergelijken.</p>}
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="mb-3 flex items-center gap-2"><Compass className="h-5 w-5 text-blue-600"/><h3 className="font-bold">Wat-als: locatie valt uit</h3></div>
              <div className="space-y-2"><input value={scenarioSearch} onChange={e=>setScenarioSearch(e.target.value)} placeholder="Zoek op naam, land, stad of provincie…" className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"/><Select value={scenarioId} onValueChange={setScenarioId}><SelectTrigger><SelectValue placeholder="Kies een Supercharger"/></SelectTrigger><SelectContent>{chargers.filter(c=>matchesSearch(c,scenarioSearch)).map(c => <SelectItem key={c.id ?? c.name} value={c.id ?? c.name}>{c.name} · {[c.city,c.province,c.country].filter(Boolean).join(", ")}</SelectItem>)}</SelectContent></Select></div>
              {scenario && <div className="mt-3 space-y-2"><p className="text-sm text-slate-600">Dichtstbijzijnde operationele alternatieven vanaf {scenario.name} (hemelsbrede afstand, geen routeafstand):</p>{alternatives.map(({charger,distance},i)=><div key={charger.id ?? charger.name} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-2 text-sm"><span className="min-w-0 truncate font-medium">{i+1}. {charger.name}</span><span className="shrink-0 text-slate-500">{distance.toFixed(1).replace(".",",")} km</span></div>)}</div>}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="mb-3 flex items-center gap-2"><Trophy className="h-5 w-5 text-amber-500"/><h3 className="font-bold">Grootste Superchargers</h3></div>
              {biggest.map((c,i)=><div key={c.id ?? c.name} className="flex items-center justify-between border-t border-slate-100 py-2 text-sm"><span>{i+1}. {c.name}</span><strong>{fmt(c.totalStalls)} laadpunten</strong></div>)}
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="mb-3 flex items-center gap-2"><Gauge className="h-5 w-5 text-emerald-600"/><h3 className="font-bold">Hoogste laadvermogen</h3></div>
              {fastest.map((c,i)=><div key={c.id ?? c.name} className="flex items-center justify-between border-t border-slate-100 py-2 text-sm"><span>{i+1}. {c.name}</span><strong>{fmt(c.maxSpeedKw)} kW</strong></div>)}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 p-4">
            <div className="mb-3 flex items-center gap-2"><BarChart3 className="h-5 w-5 text-blue-600"/><h3 className="font-bold">Europa in cijfers</h3></div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{countries.slice(0,12).map(c=><div key={c.country} className="rounded-xl bg-slate-50 p-3"><div className="flex justify-between gap-2 text-sm font-semibold"><span>{c.country}</span><span>{c.total}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-blue-600" style={{width:Math.max(2,c.total/Math.max(1,countries[0]?.total ?? 1)*100)+"%"}}/></div><div className="mt-1 text-xs text-slate-500">{c.active} in bedrijf · {c.building} in ontwikkeling</div></div>)}</div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="mb-3 flex items-center gap-2"><Trophy className="h-5 w-5 text-amber-500"/><h3 className="font-bold">Supercharger-verzamelboek</h3><Badge variant="secondary">{visitedIds.length} bezocht</Badge></div>
              <p className="mb-3 text-sm text-slate-500">Vink zelf locaties aan die je echt hebt bezocht. Je voortgang wordt op dit apparaat bewaard; bezoeken worden nooit automatisch geregistreerd.</p>
              <input value={collectionSearch} onChange={e=>setCollectionSearch(e.target.value)} placeholder="Zoek op naam, land, stad of provincie…" className="mb-3 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"/>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {chargers.filter(c => c.status === "operational" && matchesSearch(c,collectionSearch)).sort((a,b) => a.name.localeCompare(b.name)).map(c => {
                  const id = chargerKey(c);
                  const visited = visitedIds.includes(id);
                  return <button key={id} type="button" onClick={() => toggleVisited(id)} className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left text-sm transition-colors ${visited ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                    <span className="min-w-0"><span className="block truncate font-semibold">{c.name}</span><span className="text-xs text-slate-500">{[c.city, c.province, c.country].filter(Boolean).join(", ") || "Plaats onbekend"}</span></span>
                    <span className="shrink-0 font-semibold">{visited ? "✓ Bezocht" : "+ Bezocht"}</span>
                  </button>;
                })}
              </div>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
              <div className="mb-3 flex items-center gap-2"><Radar className="h-5 w-5 text-amber-600"/><h3 className="font-bold">Supercharger-waakhond</h3><Badge variant="secondary">{chargers.filter(c => ["temp_closed","long_closed","works_closed","unknown","permanent_closed"].includes(c.status ?? "unknown")).length} aandachtspunten</Badge></div>
              <p className="mb-3 text-sm text-slate-600">Actuele meldingen op basis van de statussen in de dataset en recent geregistreerde wijzigingen. Dit is geen voorspelde storingskans.</p>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {chargers.filter(c => ["temp_closed","long_closed","works_closed","unknown","permanent_closed"].includes(c.status ?? "unknown")).sort((a,b) => a.name.localeCompare(b.name)).slice(0,20).map(c => <div key={c.id ?? c.name} className="flex items-center justify-between gap-3 rounded-xl bg-white p-3 text-sm"><span className="min-w-0 truncate font-semibold">{c.name}</span><Badge variant="outline">{statusLabel[c.status ?? "unknown"]}</Badge></div>)}
                {chargers.every(c => !["temp_closed","long_closed","works_closed","unknown","permanent_closed"].includes(c.status ?? "unknown")) && <p className="rounded-xl bg-white p-3 text-sm text-slate-600">Geen bekende sluitingen of onzekere statussen in de huidige dataset.</p>}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 p-4">
            <div className="mb-3 flex items-center gap-2"><History className="h-5 w-5 text-blue-600"/><h3 className="font-bold">Tijdmachine · echte wijzigingen</h3><Badge variant="secondary">{history.length} gebeurtenissen</Badge></div>
            <p className="mb-3 text-sm text-slate-500">Hier zie je geregistreerde wijzigingen uit de TeslaNavigation-beheergeschiedenis. Dit is geen volledige historische kaart: alleen wijzigingen die daadwerkelijk zijn vastgelegd verschijnen.</p>
            {historyLoading ? <p className="text-sm text-slate-500">Geschiedenis laden…</p> : history.length ? <div className="max-h-72 space-y-2 overflow-y-auto">{history.map(item => <div key={item.id} className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 p-3"><div className="min-w-0"><div className="truncate text-sm font-semibold">{item.chargerName}</div><div className="text-xs text-slate-500">{item.action === "create" ? "Locatie toegevoegd" : item.action === "delete" ? "Locatie verwijderd" : "Locatiegegevens gewijzigd"}</div></div><time className="shrink-0 text-xs text-slate-500">{item.createdAt ? new Date(item.createdAt.replace(" ", "T") + (item.createdAt.endsWith("Z") ? "" : "Z")).toLocaleString("nl-NL") : "Datum onbekend"}</time></div>)}</div> : <p className="text-sm text-slate-500">Er zijn nog geen historische wijzigingen beschikbaar. Nieuwe geregistreerde updates verschijnen hier vanzelf.</p>}
          </section>


        </div>
      </DialogContent>
    </Dialog>
  );
}
