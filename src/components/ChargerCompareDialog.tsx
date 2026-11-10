import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Supercharger } from "@/lib/tesla-types";
import { getChargerStatus, getTotalStallsFromConfigs, parseMaxSpeed } from "@/lib/tesla-utils";
import { getTrafficForecastAt } from "@/lib/traffic-forecast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chargers: Supercharger[];
  departure: Date;
}

function money(charger: Supercharger): string {
  const currency = charger.priceCurrency || "EUR";
  const block = (charger.priceBlocks ?? []).find((item) => item.type !== "power" && typeof item.pricePerKwh === "number");
  const price = block?.pricePerKwh ?? charger.pricePerKwh;
  if (typeof price !== "number") return "Geen prijs bekend";
  try { return new Intl.NumberFormat("nl-NL", { style: "currency", currency }).format(price) + "/kWh"; }
  catch { return price.toFixed(3) + " " + currency + "/kWh"; }
}

function crowd(charger: Supercharger, departure: Date): number | null {
  const value = getTrafficForecastAt(charger.trafficForecast, departure, charger.province)?.level;
  return typeof value === "number" ? value : null;
}

function quietestWindow(charger: Supercharger, start: Date): { at: Date; level: number } | null {
  if (!charger.trafficForecast) return null;
  let best: { at: Date; level: number } | null = null;
  // Sample every 30 minutes over the next 24 hours using the station's local-time forecast.
  for (let offset = 0; offset <= 24 * 60; offset += 30) {
    const at = new Date(start.getTime() + offset * 60_000);
    const level = getTrafficForecastAt(charger.trafficForecast, at, charger.province)?.level;
    if (typeof level === "number" && (best === null || level < best.level)) best = { at, level };
  }
  return best;
}

function formatQuietest(charger: Supercharger, departure: Date): string {
  const best = quietestWindow(charger, departure);
  if (!best) return "Geen voorspelling beschikbaar";
  return best.at.toLocaleString("nl-NL", { weekday: "short", hour: "2-digit", minute: "2-digit" }) + " · " + best.level + "% geschatte drukte";
}

function score(charger: Supercharger, departure: Date): number | null {
  const level = crowd(charger, departure);
  const stalls = getTotalStallsFromConfigs(charger.chargerConfigs) ?? charger.totalStalls ?? 0;
  const speed = parseMaxSpeed(charger.stallTypes, charger.maxSpeedKw, charger.chargerConfigs);
  const price = (charger.priceBlocks ?? []).find((item) => item.type !== "power" && typeof item.pricePerKwh === "number")?.pricePerKwh ?? charger.pricePerKwh;
  const parts: number[] = [];
  if (level !== null) parts.push(100 - level);
  if (stalls > 0) parts.push(Math.min(100, 35 + stalls * 2));
  if (speed > 0) parts.push(Math.min(100, speed / 2.5));
  if ((charger.priceCurrency ?? "EUR").toUpperCase() === "EUR" && typeof price === "number" && price > 0) parts.push(Math.max(0, 100 - price * 150));
  if (getChargerStatus(charger) === "Beschikbaar" || getChargerStatus(charger) === "In bedrijf") parts.push(100);
  if (parts.length < 2) return null;
  return Math.round(parts.reduce((sum, value) => sum + value, 0) / parts.length);
}

export default function ChargerCompareDialog({ open, onOpenChange, chargers, departure }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const filtered = useMemo(() => chargers
    .filter((charger) => charger.published !== false && (charger.name + " " + (charger.city ?? "") + " " + (charger.country ?? "")).toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 100), [chargers, query]);
  const selected = selectedIds.map((id) => chargers.find((charger) => (charger.id ?? charger.name) === id)).filter((charger): charger is Supercharger => !!charger);
  const toggle = (id: string) => setSelectedIds((old) => old.includes(id) ? old.filter((value) => value !== id) : old.length >= 3 ? old : [...old, id]);
  const ranked = [...selected].sort((a, b) => (score(b, departure) ?? -1) - (score(a, departure) ?? -1));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto bg-slate-900 border-slate-700 text-white sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Superchargers vergelijken</DialogTitle>
          <DialogDescription className="text-slate-400">Selecteer maximaal drie locaties. Drukte is een voorspelling voor {departure.toLocaleString("nl-NL", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}; geen live bezettingsmeting. Tijden gebruiken de tijdzone van je apparaat.</DialogDescription>
        </DialogHeader>
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Zoek op Supercharger, plaats of land…" className="bg-slate-800 border-slate-700" />
        <div className="grid max-h-44 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-slate-700 p-2 sm:grid-cols-2">
          {filtered.map((charger) => {
            const id = charger.id ?? charger.name;
            const checked = selectedIds.includes(id);
            return <button key={id} onClick={() => toggle(id)} disabled={!checked && selectedIds.length >= 3} className={`flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs ${checked ? "bg-blue-600/30 text-blue-100 ring-1 ring-blue-500" : "text-slate-300 hover:bg-slate-800 disabled:opacity-40"}`}>
              <span className="min-w-0"><span className="block truncate font-medium">{charger.name}</span><span className="block truncate text-[10px] text-slate-400">{[charger.city, charger.country].filter(Boolean).join(", ")}</span></span>
              <span className="shrink-0">{checked ? "✓ Gekozen" : "＋"}</span>
            </button>;
          })}
          {filtered.length === 0 && <p className="p-3 text-xs text-slate-400">Geen locaties gevonden.</p>}
        </div>
        {selected.length > 0 && <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-left text-xs">
            <thead><tr><th className="p-2 text-slate-400">Eigenschap</th>{selected.map((charger) => <th key={charger.id ?? charger.name} className="p-2 align-top text-white">{charger.name}<button className="ml-2 text-red-300" onClick={() => toggle(charger.id ?? charger.name)} aria-label={"Verwijder " + charger.name}>×</button></th>)}</tr></thead>
            <tbody className="[&_td]:border-t [&_td]:border-slate-700 [&_td]:p-2">
              <tr><td className="text-slate-400">Indicatieve score</td>{selected.map((c) => <td key={c.id ?? c.name} className="font-semibold">{score(c, departure) === null ? "Onvoldoende gegevens" : score(c, departure) + "/100"}</td>)}</tr>
              <tr><td className="text-slate-400">Status</td>{selected.map((c) => <td key={c.id ?? c.name}>{getChargerStatus(c)}</td>)}</tr>
              <tr><td className="text-slate-400">Laadplekken</td>{selected.map((c) => <td key={c.id ?? c.name}>{getTotalStallsFromConfigs(c.chargerConfigs) ?? c.totalStalls ?? "Onbekend"}</td>)}</tr>
              <tr><td className="text-slate-400">Max. vermogen</td>{selected.map((c) => <td key={c.id ?? c.name}>{parseMaxSpeed(c.stallTypes, c.maxSpeedKw, c.chargerConfigs) || "Onbekend"} kW</td>)}</tr>
              <tr><td className="text-slate-400">Verwachte drukte</td>{selected.map((c) => <td key={c.id ?? c.name}>{crowd(c, departure) === null ? "Geen voorspelling" : crowd(c, departure) + "% bezetting (schatting)"}</td>)}</tr>
              <tr><td className="text-slate-400">Rustigste moment komende 24 uur (apparaat-tijd)</td>{selected.map((c) => <td key={c.id ?? c.name}>{formatQuietest(c, departure)}</td>)}</tr>
              <tr><td className="text-slate-400">kWh-tarief (eerste blok)</td>{selected.map((c) => <td key={c.id ?? c.name}>{money(c)}</td>)}</tr>
              <tr><td className="text-slate-400">Parkeerkosten</td>{selected.map((c) => <td key={c.id ?? c.name}>{c.parkingFee ? "Mogelijk betaald" : "Geen bekende parkeerkosten"}</td>)}</tr>
              <tr><td className="text-slate-400">Aanhanger</td>{selected.map((c) => <td key={c.id ?? c.name}>{c.trailerFriendly ? "Geschikt volgens gegevens" : "Niet bevestigd"}</td>)}</tr>
              <tr><td className="text-slate-400">Voorzieningen</td>{selected.map((c) => <td key={c.id ?? c.name}>{c.siteAmenities?.length ? c.siteAmenities.join(", ") : "Niet geregistreerd"}</td>)}</tr>
              <tr><td className="text-slate-400">Eigenaar</td>{selected.map((c) => <td key={c.id ?? c.name}>{c.ownerName || "Tesla / niet opgegeven"}</td>)}</tr>
            </tbody>
          </table>
          {ranked[0] && score(ranked[0], departure) !== null && <p className="mt-3 rounded-lg bg-emerald-500/10 p-3 text-xs text-emerald-200">Beste indicatieve balans: <strong>{ranked[0].name}</strong>. De score combineert alleen beschikbare gegevens over drukte, prijs, capaciteit, vermogen en status; hij is geen historische betrouwbaarheidsscore.</p>}
        </div>}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Sluiten</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
