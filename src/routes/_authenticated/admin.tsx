import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { importSuperchargers, getWinterSportsMode, setWinterSportsMode, getHolidayPeriodMode, setHolidayPeriodMode } from "@/lib/tesla.functions";
import { adminListOwners, adminCreateOwner, reverseGeocodeCharger } from "@/lib/admin.functions";
import localDataset from "@/data/superchargers.json";
import tariffDataset from "@/data/supercharger-tariffs.json";
import { getPendingAdminChanges } from "@/lib/local-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Trash2, Pencil, Plus, Truck, X, ChevronDown, EyeOff } from "lucide-react";
import { CONSTRUCTION_STEPS, constructionStepLabels, type OpeningDayKey, type ChargerConfig, type ChargerLifecycleStatus, type ClosureInfo, type ConstructionInfo, type OpeningHours, type PlannedUpgrade, type StallState, type StallCondition, type WorksInfo } from "@/lib/tesla-types";
import type { Json } from "@/integrations/supabase/types";
import type { ParkingFeeBlock } from "@/lib/tesla-types";
import { constructionProgressLabels, defaultOpeningHours, lifecycleLabels, normalizeOpeningHours, openingDayKeys, openingDayLabels, parseChargerConfigsFromLegacy } from "@/lib/tesla-utils";
import { TRAFFIC_PERIODS, createRegionalTrafficForecast, createEmptyTrafficForecast } from "@/lib/traffic-forecast";
import type { TrafficForecast, TrafficForecastPeriodSlot } from "@/lib/tesla-types";


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
  parking_blocks?: ParkingFeeBlock[] | null;
  price_currency?: string | null;
  price_per_kwh?: number | null;
  price_per_kwh_peak?: number | null;
  peak_hours?: string | null;
  price_blocks?: { type?: "kwh" | "power"; days?: string; from?: string; to?: string; pricePerKwh?: number; minKw?: number; maxKw?: number | null; pricePerMinute?: number }[] | null;
  in_parking_garage: boolean;
  status: ChargerLifecycleStatus;
  construction: ConstructionInfo | null;
  notes?: string | null;
  traffic_forecast?: TrafficForecast | null;
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
};

type Owner = { id: string; name: string };

type AdminTariff = {
  country: string;
  countryAliases?: string[];
  match: string[];
  pricePerKwh?: number;
  currency?: string;
  priceBlocks?: { from: string; to: string; pricePerKwh: number }[];
};


function normalizeTariffMatch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Laat de tarieven uit het Find Us-bestand ook in het adminformulier zien.
 * Een expliciet in Supabase opgeslagen tarief heeft altijd voorrang.
 */
function addAdminTariff(row: Charger): Charger {
  // Only saved time blocks count as a complete tariff.
  // Legacy price_per_kwh values are hidden in admin and must be upgraded
  // from the published time-block dataset whenever a matching station exists.
  const hasSavedTariff =
    Array.isArray(row.price_blocks) && row.price_blocks.length > 0;
  if (hasSavedTariff || row.status !== "operational") return row;

  const tariffs = (tariffDataset as unknown as { tariffs: AdminTariff[] }).tariffs;
  const country = normalizeTariffMatch(row.country ?? "");
  const name = normalizeTariffMatch([row.name, row.city, row.province].filter(Boolean).join(" "));
  const match = tariffs.find((tariff) => {
    const countries = [tariff.country, ...(tariff.countryAliases ?? [])];
    if (!countries.some((value) => normalizeTariffMatch(value) === country)) return false;
    return tariff.match.some((term) => {
      const normalizedTerm = normalizeTariffMatch(term);
      return name === normalizedTerm || name.includes(normalizedTerm);
    });
  });
  if (!match) return row;

  const priceBlocks = match.priceBlocks?.length
    ? match.priceBlocks.map((block) => ({
        days: "dagelijks",
        from: block.from,
        to: block.to === "24:00" ? "23:59" : block.to,
        pricePerKwh: block.pricePerKwh,
      }))
    : typeof match.pricePerKwh === "number"
      ? [{ days: "dagelijks", from: "00:00", to: "23:59", pricePerKwh: match.pricePerKwh }]
      : [];
  return {
    ...row,
    price_currency: match.currency || "EUR",
    price_blocks: priceBlocks.length ? priceBlocks : null,
  };
}

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
  parking_blocks: [] as ParkingFeeBlock[],
  price_currency: "EUR",
  price_per_kwh: null as number | null, price_per_kwh_peak: null as number | null,
  peak_hours: null as string | null,
  status: "operational" as ChargerLifecycleStatus,
  construction: {} as ConstructionInfo,
  traffic_forecast: createEmptyTrafficForecast(),
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
  charger_configs: [{ count: 8, version: "V3", speedKw: 250 }] as ChargerConfig[],
};


function TrafficForecastEditor({ value, onChange, title = "Druktevoorspelling", defaultLevel = 25 }: { value: TrafficForecast; onChange: (value: TrafficForecast) => void; title?: string; defaultLevel?: number }) {
  const formatHolidayPeriods = (periods: TrafficForecast["holidayPeriods"] = []) =>
    periods.map((period) => [period.label, period.from, period.to].join("|")).join("\n");
  const [holidayText, setHolidayText] = useState(() => formatHolidayPeriods(value.holidayPeriods));
  useEffect(() => setHolidayText(formatHolidayPeriods(value.holidayPeriods)), [value.holidayPeriods]);
  const saveHolidayPeriods = () => {
    const holidayPeriods = holidayText.split("\n").map((line) => {
      const [label, from, to] = line.split("|").map((part) => part.trim());
      if (!label || !/^\d{4}-\d{2}-\d{2}$/.test(from ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? "") || from > to) return null;
      return { label, from, to };
    }).filter((period): period is { label: string; from: string; to: string } => period !== null);
    onChange({ ...value, source: "admin", confidence: "medium", holidayPeriods });
  };
  const groups: { key: "weekdaySlots" | "weekendSlots" | "holidaySlots"; label: string; description: string }[] = [
    { key: "weekdaySlots", label: "Doordeweeks", description: "Maandag t/m vrijdag" },
    { key: "weekendSlots", label: "Weekend", description: "Zaterdag en zondag" },
    { key: "holidaySlots", label: "Vakanties", description: "Algemene schoolvakanties, feestdagen en vakantieperiodes" },
  ];
  const update = (key: "weekdaySlots" | "weekendSlots" | "holidaySlots", index: number, level: number) => {
    const current = TRAFFIC_PERIODS.map((period, i): TrafficForecastPeriodSlot => {
      const existing = value[key]?.[i];
      if (existing?.from === period.from && existing?.to === period.to) return existing;
      // Oude opgeslagen profielen met vijf brede dagdelen worden veilig uitgebreid naar 24 uur.
      const legacy = value[key]?.find((slot) => {
        const [fh] = slot.from.split(":").map(Number);
        const [th] = slot.to.split(":").map(Number);
        return i >= fh && i < (slot.to === "24:00" ? 24 : th);
      });
      return { from: period.from, to: period.to, level: legacy?.level ?? defaultLevel };
    });
    onChange({ ...value, source: "admin", confidence: "medium", [key]: current.map((slot, i) => i === index ? { ...slot, level: Math.max(0, Math.min(100, level)) } : slot) });
  };
  return (
    <div className="rounded-lg border border-cyan-700/50 bg-slate-900/70 p-3 space-y-3">
      <div>
        <div className="text-sm font-semibold text-cyan-200">{title}</div>
        <p className="text-[11px] text-slate-400">Vul per uur 0–100% verwachte drukte in. De drie uurprofielen worden gebruikt om de verwachte drukte bij een laadstop te tonen. Er wordt geen aantal vrije laadplekken of wachtrij voorspeld.</p>
      </div>
      {groups.map((group) => (
        <div key={group.key} className="space-y-2">
          <div>
            <div className="text-xs font-semibold text-white">{group.label}</div>
            <div className="text-[10px] text-slate-500">{group.description}</div>
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {TRAFFIC_PERIODS.map((period, index) => {
              const slot = value[group.key]?.[index];
              return (
                <label key={period.from} className="min-w-0 text-center">
                  <span className="block text-[9px] text-slate-400">{period.label}</span>
                  <input
                    type="number" min="0" max="100" step="5"
                    value={slot?.level ?? defaultLevel}
                    onChange={(event) => update(group.key, index, Number(event.target.value) || 0)}
                    className="mt-1 w-full min-w-0 rounded-md border border-slate-700 bg-slate-800 px-1 py-2 text-center text-xs text-white"
                  />
                </label>
              );
            })}
          </div>
        </div>
      ))}
      <div className="space-y-1 rounded-md bg-slate-800/70 p-2">
        <div className="text-[10px] font-semibold text-cyan-200">Vakantieperiodes die het vakantieprofiel activeren</div>
        <p className="text-[10px] text-slate-400">Eén periode per regel: naam | startdatum | einddatum. Gebruik dit voor algemene vakantieperiodes; geen land- of provinciegebonden Oostenrijkse kalender.</p>
        <textarea
          rows={Math.min(9, Math.max(3, value.holidayPeriods?.length ?? 0))}
          value={holidayText}
          onChange={(event) => setHolidayText(event.target.value)}
          onBlur={saveHolidayPeriods}
          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-[10px] text-white"
        />
      </div>
      <label className="block text-[10px] text-slate-400">
        Toelichting / bron
        <input value={value.note ?? ""} onChange={(event) => onChange({ ...value, source: "admin", confidence: "medium", note: event.target.value })} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-2 text-xs text-white" />
      </label>
    </div>
  );
}

const STATUS_OPTIONS: ChargerLifecycleStatus[] = [
  "operational", "construction", "works", "works_closed", "temp_closed", "long_closed", "permit", "expanding", "permanent_closed", "unknown",
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

function priceSummary(charger: Charger) {
  const blocks = charger.price_blocks ?? [];
  if (blocks.length === 0) return "—";
  const currency = charger.price_currency || "EUR";
  const prices = Array.from(new Set(blocks.map((block) =>
    Number(block.pricePerKwh).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 3 })
  )));
  return `${prices.map((price) => `${price} ${currency}`).join(" / ")} · ${blocks.length} blok(ken)`;
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

function stripLegacyTrafficColumn<T extends Record<string, unknown>>(input: T): T {
  const output = { ...input } as Record<string, unknown>;
  const legacyForecast = output.traffic_forecast;
  delete output.traffic_forecast;
  if (legacyForecast && typeof legacyForecast === "object") {
    const construction = output.construction && typeof output.construction === "object" ? output.construction as Record<string, unknown> : {};
    output.construction = { ...construction, trafficForecast: legacyForecast };
  }
  return output as T;
}

function AdminPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [chargers, setChargers] = useState<Charger[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Partial<Charger> | null>(null);
  const [coordsInput, setCoordsInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [cloudConnected, setCloudConnected] = useState(false);
  const [cloudConnectionError, setCloudConnectionError] = useState<string | null>(null);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [newOwnerName, setNewOwnerName] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPriceOpen, setBulkPriceOpen] = useState(false);
  const [bulkPrice, setBulkPrice] = useState({ parkingFeeAmount: "", parkingFreeMinutes: "", parkingPerMinutes: "", parkingPerEuro: "" });
  const fileRef = useRef<HTMLInputElement>(null);
  const [wheelchairImporting, setWheelchairImporting] = useState(false);
  const wheelchairFileRef = useRef<HTMLInputElement>(null);
  const [wheelchairImportReport, setWheelchairImportReport] = useState("");
  const runImport = useServerFn(importSuperchargers);
  const readWinterSportsMode = useServerFn(getWinterSportsMode);
  const saveWinterSportsMode = useServerFn(setWinterSportsMode);
  const readHolidayPeriodMode = useServerFn(getHolidayPeriodMode);
  const saveHolidayPeriodMode = useServerFn(setHolidayPeriodMode);
  const listAdminSuperchargers = useCallback(async (): Promise<Charger[]> => {
    const response = await fetch("/api/admin/superchargers", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Adminverbinding mislukt (HTTP ${response.status}).`;
      throw new Error(message);
    }
    if (!Array.isArray(payload)) {
      throw new Error("De Worker gaf geen geldige Supercharger-lijst terug.");
    }
    return payload as Charger[];
  }, []);
  const listAdminOwners = useServerFn(adminListOwners);
  const geocodeCharger = useServerFn(reverseGeocodeCharger);
  const [geocodingCoordinates, setGeocodingCoordinates] = useState(false);
  const createAdminOwner = useServerFn(adminCreateOwner);
  const [holidayPeriodEnabled, setHolidayPeriodEnabled] = useState(false);
  const [holidayPeriodSaving, setHolidayPeriodSaving] = useState(false);
  const [winterSportsEnabled, setWinterSportsEnabled] = useState(false);
  const [winterSportsSaving, setWinterSportsSaving] = useState(false);

  useEffect(() => {
    let active = true;
    // Use the same Worker-owned D1 session endpoint as login, AccountMenu,
    // and the authenticated route guard so admin visibility cannot disagree.
    void fetch("/api/auth/me", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      const user = response.ok
        ? await response.json() as { is_admin?: boolean }
        : null;
      if (!active) return;
      const admin = user?.is_admin === true;
      setIsAdmin(admin);
      if (admin) {
        try {
          const [winter, holiday] = await Promise.all([readWinterSportsMode(), readHolidayPeriodMode()]);
          if (active) { setWinterSportsEnabled(winter); setHolidayPeriodEnabled(holiday); }
        } catch { if (active) { setWinterSportsEnabled(false); setHolidayPeriodEnabled(false); } }
      }
    }).catch((error) => {
      console.error("[TeslaNavigation] Worker admin identity check failed:", error);
      if (active) setIsAdmin(false);
    });
    return () => { active = false; };
  }, [readWinterSportsMode, readHolidayPeriodMode]);

  const toggleWinterSports = async (enabled: boolean) => {
    setWinterSportsSaving(true);
    try {
      await saveWinterSportsMode({ data: { enabled } });
      setWinterSportsEnabled(enabled);
      toast.success(enabled ? "Wintersportmodus ingeschakeld" : "Wintersportmodus uitgeschakeld");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Instelling opslaan mislukt");
    } finally { setWinterSportsSaving(false); }
  };

  const toggleHolidayPeriod = async (enabled: boolean) => {
    setHolidayPeriodSaving(true);
    try {
      await saveHolidayPeriodMode({ data: { enabled } });
      setHolidayPeriodEnabled(enabled);
      toast.success(enabled ? "Vakantieperiode ingeschakeld" : "Vakantieperiode uitgeschakeld");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Vakantieperiode opslaan mislukt");
    } finally { setHolidayPeriodSaving(false); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setCloudConnected(false);
    setCloudConnectionError(null);
    const rows: Charger[] = [];
    const unwrapArray = (value: unknown, depth = 0, seen = new Set<unknown>()): unknown[] | null => {
      if (Array.isArray(value)) return value;
      if (!value || typeof value !== "object" || depth >= 8 || seen.has(value)) return null;
      seen.add(value);
      const record = value as Record<string, unknown>;
      const keys = ["chargers", "owners", "rows", "results", "items", "data", "result", "value", "payload", "response", "body", "json"];
      for (const key of keys) {
        if (!(key in record)) continue;
        const found = unwrapArray(record[key], depth + 1, seen);
        if (found) return found;
      }
      for (const nested of Object.values(record)) {
        const found = unwrapArray(nested, depth + 1, seen);
        if (found) return found;
      }
      return null;
    };

    try {
      // Eerst alleen-lezen controleren of D1 werkelijk bereikbaar is.
      // Pas daarna mogen eventueel lokaal bewaarde wijzigingen worden verstuurd.
      const healthResponse = await listAdminSuperchargers();
      const healthRows = unwrapArray(healthResponse) as Charger[] | null;
      if (!healthRows) {
        let received = typeof healthResponse;
        try { received = JSON.stringify(healthResponse).slice(0, 700); } catch { /* keep type */ }
        throw new Error("Cloudflare D1 gaf geen herkenbare Supercharger-lijst terug: " + received);
      }

      // Oude lokale wachtrij-items nooit automatisch opnieuw afspelen.
      // Ze kunnen ouder zijn dan de actuele D1-records en anders nieuwere
      // instellingen/stations overschrijven zodra de verbinding terugkomt.
      // Bewaar de wachtrij ongewijzigd zodat niets verloren gaat; nieuwe
      // wijzigingen worden alleen na een expliciete handmatige opslag verstuurd.
      const pending = getPendingAdminChanges();
      if (pending.length > 0) {
        toast.warning(`${pending.length} oude lokale wijziging(en) staan nog in de wachtrij. Ze zijn NIET automatisch toegepast om nieuwere D1-gegevens te beschermen.`);
      }

      // Gebruik dezelfde geverifieerde D1-respons; er is geen tweede, afwijkende read nodig.
      rows.push(...healthRows.map((row) => addAdminTariff(row)));

      if (rows.length === 0) {
        throw new Error("Cloudflare D1 is bereikbaar, maar bevat na de veilige basisimport nog geen Superchargers. De lokale noodlijst wordt niet als database getoond en opslaan blijft uitgeschakeld om gegevensverlies te voorkomen.");
      }

      // Een storing in de aparte eigenaarslijst mag de volledige Supercharger-admin
      // niet onterecht offline zetten of opslaan blokkeren.
      setCloudConnected(true);
      try {
        const ownerResponse = await listAdminOwners();
        const ownerRows = unwrapArray(ownerResponse);
        if (!ownerRows) throw new Error("Onbekend antwoordformaat voor de eigenaarslijst.");
        setOwners(ownerRows as Owner[]);
      } catch (ownerError) {
        console.error("[TeslaNavigation] Eigenaarslijst niet beschikbaar; Superchargerbeheer blijft actief:", ownerError);
        setOwners([]);
        toast.error("Superchargers zijn verbonden met D1, maar de eigenaarslijst kon niet worden geladen.");
      }
    } catch (error) {
      setCloudConnected(false);
      const connectionMessage = error instanceof Error ? error.message : String(error);
      setCloudConnectionError(connectionMessage);
      console.error("[TeslaNavigation] D1-adminlijst niet bereikbaar; toon lokale dataset:", error);
      const localRows = (localDataset as { chargers?: Charger[] }).chargers ?? [];
      if (rows.length === 0 && localRows.length > 0) {
        rows.push(...localRows.map((row) => addAdminTariff(row)));
        toast.error("Cloudflare D1 kon de beheerlijst niet laden: " + connectionMessage);
        toast.info("De lokale Superchargerlijst wordt alleen als noodweergave getoond. Opslaan is uitgeschakeld totdat de cloudverbinding werkt.");
      } else {
        toast.error("Superchargers konden niet uit Cloudflare D1 worden geladen: " + connectionMessage);
      }
    }
    setChargers(rows);
    setLoading(false);
  }, []);
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const openNew = () => { setEditing({ ...emptyCharger, opening_hours: defaultOpeningHours(), traffic_forecast: createEmptyTrafficForecast() }); setCoordsInput(""); };
  const openEdit = (c: Charger) => {
    const legacyParking: ParkingFeeBlock[] = [];
    if (c.parking_fee_amount != null && c.parking_fee_amount > 0) legacyParking.push({ label: "Vast starttarief", afterMinutes: 0, durationMinutes: 0, amount: c.parking_fee_amount, currency: "EUR" });
    if (c.parking_per_euro != null && c.parking_per_minutes != null) legacyParking.push({ label: c.parking_free_minutes ? "Daarna" : "Parkeertarief", afterMinutes: c.parking_free_minutes ?? 0, durationMinutes: c.parking_per_minutes, amount: c.parking_per_euro, currency: "EUR", repeat: true });
    setEditing({ ...c, traffic_forecast: (c.construction?.trafficForecast ?? c.traffic_forecast)?.source === "admin" ? (c.construction?.trafficForecast ?? c.traffic_forecast) : createRegionalTrafficForecast({ name: c.name, city: c.city ?? undefined, province: c.province ?? undefined, country: c.country ?? undefined, totalStalls: totalFromConfigs(c.charger_configs) ?? c.total_stalls ?? undefined, lat: c.lat, lng: c.lng }), parking_blocks: c.parking_blocks?.length ? c.parking_blocks : legacyParking, charger_configs: configsForCharger(c), opening_hours: normalizeOpeningHours(c.opening_hours, c.opening_time, c.closing_time) });
    setCoordsInput(`${c.lat},${c.lng}`);
  };

  const fillLocationFromCoordinates = async () => {
    const parts = coordsInput.split(",").map((part) => Number(part.trim()));
    if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1]) || Math.abs(parts[0]) > 90 || Math.abs(parts[1]) > 180) return;
    setGeocodingCoordinates(true);
    try {
      const place = await geocodeCharger({ data: { lat: parts[0], lng: parts[1] } });
      setEditing((current) => current ? { ...current, city: place.city || current.city || "", province: place.province || current.province || "", country: place.country || current.country || "" } : current);
      toast.success("Plaats, provincie en land automatisch ingevuld");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Locatiegegevens konden niet worden opgehaald");
    } finally {
      setGeocodingCoordinates(false);
    }
  };

  const save = async () => {
    if (!cloudConnected) { toast.error("Cloudflare D1 is niet verbonden. Wijzigingen zijn uitgeschakeld; probeer eerst opnieuw te laden."); return; }
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
      // Tariefblokken zijn leidend: zodra er blokken zijn, staat parkeergeld automatisch aan.
      parking_fee: !!editing.parking_fee || !!editing.parking_blocks?.length,
      parking_fee_amount: editing.parking_fee_amount ?? null,
      parking_free_minutes: editing.parking_free_minutes ?? null,
      parking_per_minutes: editing.parking_per_minutes ?? null,
      parking_per_euro: null,
      // De databasekolom is NOT NULL en gebruikt [] als waarde zonder tarieven.
      parking_blocks: (editing.parking_blocks ?? []) as unknown as Json,
      price_currency: (editing.price_currency || "EUR").toUpperCase(),
      price_per_kwh: null,
      price_per_kwh_peak: null,
      peak_hours: null,
      price_blocks: (editing.price_blocks && editing.price_blocks.length > 0 ? editing.price_blocks : null) as unknown as Json,
      in_parking_garage: !!editing.in_parking_garage,
      province: editing.province || null,
      city: editing.city || null,
      status: editing.status || "operational",
      // Bewaar drukteprofielen in het bestaande construction JSONB-veld.
      // Zo werkt opslaan ook bij databases zonder de optionele traffic_forecast-kolom.
      notes: editing.notes?.trim() || null,
      construction: {
        ...(editing.construction || {}),
        customLabel: editing.construction?.customLabel?.trim() || null,
        trafficForecast: editing.traffic_forecast || createEmptyTrafficForecast(),
        trailerFriendlyStalls: Math.max(0, Math.min(100, Math.floor(Number(editing.construction?.trailerFriendlyStalls ?? (editing.trailer_friendly ? 1 : 0)) || 0))),
        trailerStallsPerSpace: Math.max(1, Math.min(20, Math.floor(Number(editing.construction?.trailerStallsPerSpace ?? 1) || 1))),
      } as unknown as Json,
      works: (editing.works || {}) as Json,
      closure: (editing.closure || {}) as Json,
      owner_id: editing.owner_id || null,
      owner_name: editing.owner_name?.trim() || null,
      ...(editing.status === "permanent_closed" && editing.permanently_closed_at ? { permanently_closed_at: editing.permanently_closed_at } : {}),
      low_speed: !!editing.low_speed,
      published: editing.published !== false,
      reopen_at: ["temp_closed", "long_closed", "works_closed", "unknown"].includes(editing.status || "") ? (editing.reopen_at || null) : null,
      planned_upgrade: (editing.planned_upgrade || {}) as Json,
      stall_states: (editing.stall_states || []).filter((x) => x.condition !== "available") as unknown as Json,
      data_source: editing.data_source === "automatic" ? "automatic" : "manual",
      hidden: !!editing.hidden,
      photos: (editing.photos || []).map((u) => u.trim()).filter(Boolean),
    };
    try {
      const response = await fetch("/api/admin/superchargers", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(stripLegacyTrafficColumn({ ...(editing.id ? { id: editing.id } : {}), ...payload } as Record<string, unknown>)),
      });
      const result = await response.json().catch(() => null) as { error?: string; id?: string } | null;
      if (!response.ok || !result?.id) throw new Error(result?.error || "Opslaan mislukt (HTTP " + response.status + ").");
      toast.success(editing.id ? "Bijgewerkt in Cloudflare D1" : "Toegevoegd aan Cloudflare D1");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[TeslaNavigation] Supercharger opslaan mislukt:", error);
      toast.error("Niet opgeslagen in Cloudflare D1: " + message + ". Je formulier blijft open; er is geen lokale schijnopslag uitgevoerd.");
      return;
    }
    setEditing(null);
    load();
  };

  const remove = async (id: string) => {
    if (!cloudConnected) { toast.error("Cloudflare D1 is niet verbonden. Verwijderen is uitgeschakeld."); return; }
    if (!confirm("Weet je zeker dat je deze supercharger wilt verwijderen?")) return;
    try {
      const response = await fetch("/api/admin/superchargers?id=" + encodeURIComponent(id), {
        method: "DELETE", credentials: "same-origin", headers: { Accept: "application/json" },
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "Verwijderen mislukt (HTTP " + response.status + ").");
      toast.success("Verwijderd uit Cloudflare D1");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Verwijderen uit Cloudflare D1 mislukt.");
      return;
    }
    load();
  };

  const setTemporaryClosureDays = (days: number) => {
    if (!editing) return;
    const reopen = new Date(Date.now() + Math.max(1, days) * 86400000);
    const status = editing.status || "temp_closed";
    setEditing({
      ...editing,
      status,
      is_available: status === "unknown" ? true : false,
      reopen_at: reopen.toISOString(),
      closure: { ...(editing.closure || {}), until: reopen.toISOString().slice(0, 10) },
    });
  };

  const publishAllDrafts = async () => {
    if (!cloudConnected) { toast.error("Cloudflare D1 is niet verbonden. Publiceren is uitgeschakeld."); return; }
    const drafts = chargers.filter((c) => c.published === false);
    if (drafts.length === 0) { toast.info("Geen concepten om te publiceren"); return; }
    if (!confirm(`${drafts.length} concepten publiceren?`)) return;
    try { await sendAdminBulkUpdate(drafts.map((draft) => draft.id), { published: true }); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Publiceren mislukt"); return; }
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
    if (!cloudConnected) { toast.error("Cloudflare D1 is niet verbonden. Importeren is uitgeschakeld."); return; }
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

  /** Eigenaar op naam: bestaat hij niet, dan maken we hem aan met alleen een titel. */
  const ensureOwnerByName = async (name: string): Promise<string | null> => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = owners.find((o) => o.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.id;
    let data: { id: string; name: string } | null = null;
    try { data = await createAdminOwner({ data: { name: trimmed } }) as { id: string; name: string }; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Eigenaar aanmaken mislukt"); return null; }
    if (!data) return null;
    setOwners((prev) => [...prev, data as Owner].sort((a, b) => a.name.localeCompare(b.name)));
    return data.id;
  };

  const sendAdminBulkUpdate = async (ids: string[], changes: Record<string, unknown>) => {
    const response = await fetch("/api/admin/superchargers/bulk", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ids, changes }),
    });
    const result = await response.json().catch(() => null) as { error?: string; updated?: number } | null;
    if (!response.ok || typeof result?.updated !== "number") {
      throw new Error(result?.error || "Bulk opslaan in Cloudflare D1 mislukt (HTTP " + response.status + ").");
    }
    return result;
  };

  const importWheelchairList = async (file: File) => {
    if (!cloudConnected) { toast.error("Cloudflare D1 is niet verbonden."); return; }
    setWheelchairImporting(true);
    try {
      const raw = await file.text();
      const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
      const rows = raw.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.split("\t")).filter((cells) => cells.some((cell) => cell.trim()));
      const matchedIds = new Set<string>();
      const unmatched: string[] = [];
      const ambiguous: string[] = [];
      for (const cells of rows) {
        const nameIndex = cells.findIndex((cell) => cell.trim() !== "");
        if (nameIndex < 0) continue;
        const name = cells[nameIndex].trim();
        const country = (cells[nameIndex + 5] ?? "").trim();
        if (!country) { unmatched.push(name + " (land ontbreekt)"); continue; }
        const matches = chargers.filter((charger) => normalize(charger.name) === normalize(name) && normalize(charger.country) === normalize(country));
        if (matches.length === 1) matchedIds.add(matches[0].id);
        else if (matches.length > 1) ambiguous.push(name + ", " + country);
        else unmatched.push(name + ", " + country);
      }
      const ids = Array.from(matchedIds);
      if (ids.length) {
        for (let i = 0; i < ids.length; i += 100) {
          await sendAdminBulkUpdate(ids.slice(i, i + 100), { wheelchairAccessible: true });
        }
      }
      await load();
      const report = [
        "Rolstoeltoegankelijk gemarkeerd: " + ids.length,
        "Niet gevonden: " + unmatched.length + (unmatched.length ? "\\n" + unmatched.join("\\n") : ""),
        "Meerdere exacte matches (overgeslagen): " + ambiguous.length + (ambiguous.length ? "\\n" + ambiguous.join("\\n") : ""),
      ].join("\\n\\n");
      setWheelchairImportReport(report);
      console.info("[TeslaNavigation] Rolstoelimportresultaat\\n" + report);
      toast.success(ids.length + " Superchargers bijgewerkt. " + (unmatched.length + ambiguous.length) + " overgeslagen; bekijk de lijst hieronder.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import van rolstoeltoegankelijkheid mislukt.");
    } finally {
      setWheelchairImporting(false);
      if (wheelchairFileRef.current) wheelchairFileRef.current.value = "";
    }
  };

  const bulkUpdate = async (changes: Record<string, unknown>) => {
    if (!cloudConnected) { toast.error("Cloudflare D1 is niet verbonden. Bulk wijzigen is uitgeschakeld."); return; }
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try { await sendAdminBulkUpdate(ids, changes); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Bijwerken mislukt"); return; }
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

  // Automatische kwaliteitscontrole: signaleert ontbrekende of onlogische data,
  // maar wijzigt nooit automatisch bestaande Supercharger-gegevens.
  const dataQualityIssues: { id: string; name: string; country: string; issue: string; severity: "high" | "medium" | "low" }[] = [];
  const seenNames = new Map<string, string>();
  const seenCoords = new Map<string, string>();
  for (const charger of chargers) {
    const addIssue = (issue: string, severity: "high" | "medium" | "low" = "medium") => {
      dataQualityIssues.push({ id: charger.id, name: charger.name, country: charger.country || "Onbekend", issue, severity });
    };
    const identity = `${charger.name.trim().toLowerCase()}|${(charger.country || "").trim().toLowerCase()}`;
    const priorName = seenNames.get(identity);
    if (priorName) addIssue(`Mogelijke dubbele locatie (zelfde naam/land; ook bij ${priorName})`, "high");
    else seenNames.set(identity, charger.name);
    const coordKey = `${Number(charger.lat).toFixed(5)},${Number(charger.lng).toFixed(5)}`;
    const priorCoord = seenCoords.get(coordKey);
    if (priorCoord) addIssue(`Exact dezelfde coördinaten als ${priorCoord}; controleer of dit een duplicaat is`, "high");
    else seenCoords.set(coordKey, charger.name);
    if (!Number.isFinite(charger.lat) || !Number.isFinite(charger.lng) || Math.abs(charger.lat) > 90 || Math.abs(charger.lng) > 180) addIssue("Ongeldige GPS-coördinaten", "high");
    if (!charger.country?.trim()) addIssue("Land ontbreekt", "high");
    if (!charger.city?.trim() && !charger.province?.trim()) addIssue("Stad en regio ontbreken", "low");
    const configs = configsForCharger(charger);
    if (!configs.length || !totalFromConfigs(configs)) addIssue("Aantal laadpunten / laadconfiguratie ontbreekt", "medium");
    if (!configs.length || !maxSpeedFromConfigs(configs)) addIssue("Maximaal laadvermogen ontbreekt", "medium");
    if (charger.status === "operational" && !(charger.price_blocks?.length)) addIssue("Geen tijdsgebonden laadprijs ingevuld", "low");
    if (charger.status === "operational" && !charger.traffic_forecast && !charger.construction?.trafficForecast) addIssue("Geen drukteprofiel opgeslagen", "low");
    if (charger.status === "operational" && !charger.opening_hours && !charger.opening_time && !charger.closing_time) addIssue("Openingstijden niet expliciet gecontroleerd (24/7 wordt niet aangenomen als geverifieerd)", "low");
  }
  const qualityCounts = {
    high: dataQualityIssues.filter((issue) => issue.severity === "high").length,
    medium: dataQualityIssues.filter((issue) => issue.severity === "medium").length,
    low: dataQualityIssues.filter((issue) => issue.severity === "low").length,
  };
  const exportQualityReport = () => {
    const escapeCsv = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = ["Locatie;Land;Probleem;Prioriteit", ...dataQualityIssues.map((issue) => [issue.name, issue.country, issue.issue, issue.severity].map(escapeCsv).join(";"))].join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `teslanavigation-datacontrole-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const versionOpts = ["V2", "V3", "V4"];

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {cloudConnectionError && (
          <div role="alert" className="mb-4 rounded-lg border border-red-500/60 bg-red-950/50 p-4 text-sm text-red-100">
            <div className="font-semibold">Cloudflare D1-verbinding mislukt — opslaan staat uit</div>
            <p className="mt-2 break-words font-mono text-xs whitespace-pre-wrap">{cloudConnectionError}</p>
            <p className="mt-2 text-xs text-red-200">Deze fout komt rechtstreeks uit de serveraanroep. De lokale lijst is alleen-lezen; er worden geen wijzigingen weggegooid.</p>
            <Button variant="outline" size="sm" className="mt-3 border-red-300/40" onClick={() => load()} disabled={loading}>Opnieuw proberen</Button>
          </div>
        )}
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <div>
            <Link to="/" className="text-sm text-slate-400 hover:text-white">← Terug naar kaart</Link>
            <h1 className="text-2xl md:text-3xl font-bold mt-1">Superchargers beheren</h1>
            <p className="text-sm text-slate-400">{chargers.length} laders totaal</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input ref={wheelchairFileRef} type="file" accept=".txt,.tsv,.csv" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importWheelchairList(file); }} />
              <Button size="sm" variant="outline" className="border-cyan-700 text-cyan-200" disabled={wheelchairImporting || !cloudConnected} onClick={() => wheelchairFileRef.current?.click()}>
                {wheelchairImporting ? "Rolstoelijst verwerken…" : "♿ Rolstoelvriendelijke lijst importeren"}
              </Button>
              <span className="text-xs text-slate-500">Selecteer het aangeleverde TXT-bestand. Alleen exacte naam + land matches worden aangepast; overige locaties worden overgeslagen.</span>
              {wheelchairImportReport && <pre className="mt-2 max-h-64 w-full overflow-auto whitespace-pre-wrap rounded-md border border-slate-700 bg-slate-950 p-3 text-xs text-slate-300">{wheelchairImportReport}</pre>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/eigenaren"><Button variant="outline" size="sm" className="border-slate-700">Eigenaren</Button></Link>
            <Link to="/meldingen"><Button variant="outline" size="sm" className="border-slate-700">Meldingen</Button></Link>
            <Link to="/voertuigmodellen"><Button variant="outline" size="sm" className="border-slate-700">Voertuigdatabase</Button></Link>
            <Link to="/gebruikers"><Button variant="outline" size="sm" className="border-slate-700">Gebruikers</Button></Link>
            <Link to="/talen"><Button variant="outline" size="sm" className="border-slate-700">Talen</Button></Link>
            <Link to="/wijzigingen"><Button variant="outline" size="sm" className="border-slate-700">Wijzigingen</Button></Link>
            <Button variant="outline" size="sm" className="border-slate-700" onClick={publishAllDrafts} disabled={!cloudConnected || loading}>Alle concepten publiceren</Button>
            <Button variant="outline" size="sm" className="border-slate-700" onClick={exportData}>Exporteer back-up</Button>
            <Button variant="outline" size="sm" className="border-slate-700" onClick={() => fileRef.current?.click()} disabled={!cloudConnected || loading}>Importeer back-up</Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => { const file = e.target.files?.[0]; if (file) importData(file); e.target.value = ""; }}
            />
            <Button onClick={openNew} disabled={!cloudConnected || loading} className="bg-red-600 hover:bg-red-700"><Plus className="w-4 h-4 mr-1" /> Nieuw</Button>
          </div>
        </div>
        <div className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-sky-500/40 bg-sky-500/10 p-3">
          <div><div className="text-sm font-semibold text-sky-200">❄ Wintersportmodus</div><p className="text-xs text-slate-300">Toont een sneeuwvlok en een druktewaarschuwing bij Superchargers in sneeuw- en wintersportgebieden.</p></div>
          <label className="flex shrink-0 items-center gap-2 text-sm"><Checkbox checked={winterSportsEnabled} disabled={winterSportsSaving} onCheckedChange={(checked) => void toggleWinterSports(!!checked)} />{winterSportsSaving ? "Opslaan…" : winterSportsEnabled ? "Aan" : "Uit"}</label>
        </div>
        <div className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <div><div className="text-sm font-semibold text-amber-200">🏖 Vakantieperiode</div><p className="text-xs text-slate-300">Activeert direct het vakantieprofiel voor alle Superchargers. Wintersportmodus activeert dit profiel ook automatisch.</p></div>
          <label className="flex shrink-0 items-center gap-2 text-sm"><Checkbox checked={holidayPeriodEnabled} disabled={holidayPeriodSaving} onCheckedChange={(checked) => void toggleHolidayPeriod(!!checked)} />{holidayPeriodSaving ? "Opslaan…" : holidayPeriodEnabled ? "Actief" : "Uit"}</label>
        </div>
        {selectedIds.size > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 border border-blue-500/40 bg-blue-500/10 p-3 rounded-lg">
            <span className="text-sm font-semibold mr-2">{selectedIds.size} geselecteerd</span>
            <Button size="sm" variant="outline" onClick={() => bulkUpdate({ trailer_friendly: true })}>Aanhangervriendelijk</Button>
            <Button size="sm" variant="outline" onClick={() => bulkUpdate({ wheelchairAccessible: true })}>♿ Invalidenplek aanwezig</Button>
            <Button size="sm" variant="outline" onClick={() => bulkUpdate({ wheelchairAccessible: false })}>♿ Invalidenplek verwijderen</Button>
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
        <section className="mb-4 rounded-xl border border-cyan-700/50 bg-slate-800/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-cyan-200">Automatische datacontrole Europa</div>
              <p className="mt-1 text-xs text-slate-400">Controleert dubbele locaties, GPS, laadconfiguraties, prijzen en ontbrekende locatiegegevens. Er wordt niets automatisch aangepast.</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="rounded-md bg-rose-500/15 px-2 py-1 text-rose-300">{qualityCounts.high} belangrijk</span>
                <span className="rounded-md bg-amber-500/15 px-2 py-1 text-amber-300">{qualityCounts.medium} aandacht</span>
                <span className="rounded-md bg-slate-700 px-2 py-1 text-slate-300">{qualityCounts.low} ontbrekend / controleren</span>
                <span className="rounded-md bg-slate-700 px-2 py-1 text-slate-300">{dataQualityIssues.length} signalen · {chargers.length} locaties</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="border-slate-600" onClick={exportQualityReport} disabled={!dataQualityIssues.length}>Exporteer controlelijst</Button>
              <Button size="sm" variant="outline" className="border-slate-600" onClick={() => setQualityOpen((value) => !value)}>{qualityOpen ? "Verbergen" : "Bekijk problemen"}</Button>
            </div>
          </div>
          {qualityOpen && <div className="mt-3 max-h-72 space-y-1 overflow-y-auto border-t border-slate-700 pt-3">
            {dataQualityIssues.length === 0 ? <p className="text-xs text-emerald-300">Geen dataproblemen gevonden in de uitgevoerde controles.</p> : dataQualityIssues.slice(0, 250).map((issue, index) => (
              <div key={issue.id + issue.issue + index} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-900/70 px-2 py-1.5 text-xs">
                <div className="min-w-0"><span className="font-semibold text-white">{issue.name}</span><span className="ml-2 text-slate-500">{issue.country}</span><div className="mt-0.5 text-slate-300">{issue.issue}</div></div>
                <span className={issue.severity === "high" ? "text-rose-300" : issue.severity === "medium" ? "text-amber-300" : "text-slate-400"}>{issue.severity === "high" ? "Belangrijk" : issue.severity === "medium" ? "Aandacht" : "Controleren"}</span>
              </div>
            ))}
            {dataQualityIssues.length > 250 && <p className="pt-1 text-[11px] text-slate-500">De lijst toont de eerste 250 signalen. De CSV bevat alle {dataQualityIssues.length} signalen.</p>}
          </div>}
        </section>
        {loading ? <div>Laden…</div> : (
          <div className="rounded-lg border border-slate-700 overflow-hidden">
            <div className="max-h-[70vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-800 sticky top-0">
                  <tr className="text-left">
                    <th className="p-3"><Checkbox checked={filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id))} onCheckedChange={(checked) => setSelectedIds(checked ? new Set(filtered.map((c) => c.id)) : new Set())} /></th><th className="p-3">Naam</th><th className="p-3">Land</th><th className="p-3">Laders</th><th className="p-3">Tijden</th><th className="p-3">kWh-tarief</th><th className="p-3">Status</th><th className="p-3">🚚</th><th className="p-3"></th>
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
                      <td className="p-3 max-w-xs text-emerald-300">{priceSummary(c)}</td>
                      <td className="p-3">{c.published === false ? <span className="text-amber-300">Concept</span> : c.status && c.status !== "operational" ? <span className={c.status === "expanding" ? "text-green-400" : c.status === "construction" ? "text-orange-300" : c.status === "permit" ? "text-purple-300" : "text-slate-300"}>{lifecycleLabels[c.status] ?? c.status}</span> : c.is_available === false ? <span className="text-slate-300">Niet beschikbaar</span> : <span className="text-green-400">Beschikbaar</span>}</td>
                      <td className="p-3">{c.trailer_friendly ? "✓" : "-"}</td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" disabled={!cloudConnected || loading} onClick={() => openEdit(c)}><Pencil className="w-4 h-4" /></Button>
                        <Button size="sm" variant="ghost" disabled={!cloudConnected || loading} onClick={() => remove(c.id)}><Trash2 className="w-4 h-4 text-red-400" /></Button>
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
        <DialogContent className="bg-slate-950 border-slate-700/80 text-white max-w-4xl max-h-[92vh] overflow-y-auto shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl">{editing?.id ? "Supercharger bewerken" : "Nieuwe Supercharger"}</DialogTitle>
            <p className="text-xs text-slate-400">Beheer locatie, status en laadgegevens op één plek</p>
          </DialogHeader>
          {editing && (
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-800 via-slate-900 to-black">
              {editing.photos?.[0] ? <img src={editing.photos[0]} alt="" className="h-36 w-full object-cover opacity-75" /> : <div className="flex h-28 items-center justify-center bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-red-950 via-slate-900 to-slate-950"><div className="text-center"><div className="text-3xl">⚡</div><div className="mt-1 text-xs text-slate-400">Tesla Supercharger</div></div></div>}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/95 to-transparent p-3 pt-8">
                <div className="text-sm font-semibold">{editing.name || "Nieuwe locatie"}</div>
                <div className="text-[11px] text-slate-300">{[editing.city, editing.country].filter(Boolean).join(", ") || "Locatie nog niet ingevuld"}</div>
              </div>
            </div>
          )}
          {editing && (
            <div className="space-y-3">
              <div><Label>Naam</Label><Input value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="bg-slate-800 border-slate-700" /></div>
              <div><Label>Eigen label (optioneel)</Label><Input placeholder="Bijv. Favoriete stop, ruime parkeerplaats…" value={editing.construction?.customLabel ?? ""} onChange={(e) => setEditing({ ...editing, construction: { ...(editing.construction || {}), customLabel: e.target.value } })} className="bg-slate-800 border-slate-700" /></div>
              <div><Label>Persoonlijke notitie</Label><textarea rows={2} placeholder="Eigen notitie over deze Supercharger…" value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} className="w-full rounded-md bg-slate-800 border border-slate-700 p-2 text-sm" /></div>
              <div><Label>Land</Label><Input value={editing.country || ""} onChange={(e) => setEditing({ ...editing, country: e.target.value })} className="bg-slate-800 border-slate-700" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Provincie / regio</Label><Input value={editing.province || ""} onChange={(e) => setEditing({ ...editing, province: e.target.value })} className="bg-slate-800 border-slate-700" /></div>
                <div><Label>Plaats</Label><Input value={editing.city || ""} onChange={(e) => setEditing({ ...editing, city: e.target.value })} className="bg-slate-800 border-slate-700" /></div>
              </div>
              <div><Label>Coördinaten (lat,lng)</Label><Input value={coordsInput} onChange={(e) => setCoordsInput(e.target.value)} onBlur={() => void fillLocationFromCoordinates()} placeholder="52.3702,4.8952" className="bg-slate-800 border-slate-700" /><p className="mt-1 text-[11px] text-slate-400">{geocodingCoordinates ? "Plaats, provincie en land ophalen…" : "Na het invoeren van coördinaten worden plaats, provincie en land automatisch ingevuld. De naam vul je zelf in."}</p></div>

              <div className="rounded-2xl border border-sky-400/20 bg-gradient-to-br from-slate-900 to-slate-950 p-4 shadow-lg space-y-3">
                <div>
                  <Label>Status</Label>
                  <select
                    value={editing.status || "operational"}
                    onChange={(e) => { const status = e.target.value as ChargerLifecycleStatus; setEditing({ ...editing, status, is_available: status === "unknown" ? true : status === "temp_closed" || status === "long_closed" || status === "works_closed" ? false : editing.is_available, reopen_at: ["unknown", "temp_closed", "long_closed", "works_closed"].includes(status) ? editing.reopen_at : null }); }}
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

                <StallEditor
                  value={editing.stall_states || []}
                  onChange={(stall_states) => setEditing({ ...editing, stall_states })}
                />

                <div className="space-y-2 rounded-lg border border-slate-700 p-3">
                  <Label className="text-xs">Voorzieningen op locatie (één per regel)</Label>
                  <p className="text-[11px] text-slate-400">Vul alleen voorzieningen in die je hebt gecontroleerd, bijvoorbeeld toilet, restaurant, supermarkt, overdekt laden of speeltuin.</p>
                  <textarea
                    rows={3}
                    value={(editing.construction?.siteAmenities ?? []).join("\n")}
                    onChange={(e) => setEditing({ ...editing, construction: { ...(editing.construction || {}), siteAmenities: e.target.value.split("\n").map((item) => item.trim()).filter(Boolean).slice(0, 20) } })}
                    placeholder={"Toilet\nRestaurant\nSupermarkt"}
                    className="w-full rounded-md bg-slate-800 border border-slate-700 p-2 text-sm"
                  />
                </div>
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

                {(["temp_closed", "long_closed", "works_closed", "unknown"].includes(editing.status || "")) && (
                  <div className="space-y-2">
                    <div>
                      <Label className="text-xs">Reden van sluiting</Label>
                      <Input value={editing.closure?.reason ?? ""} onChange={(e) => setEditing({ ...editing, closure: { ...(editing.closure || {}), reason: e.target.value } })} className="bg-slate-800 border-slate-700" />
                    </div>
                    {["temp_closed", "long_closed", "works_closed", "unknown"].includes(editing.status || "") && <div>
                      <Label className="text-xs">Automatisch status herstellen (alleen admin)</Label>
                      <div className="grid grid-cols-4 gap-2 mt-1">
                        {[1, 3, 7, 14].map((days) => <Button key={days} type="button" size="sm" variant="outline" onClick={() => setTemporaryClosureDays(days)}>{days} {days === 1 ? "dag" : "dagen"}</Button>)}
                      </div>
                      <Input type="datetime-local" value={editing.reopen_at ? editing.reopen_at.slice(0, 16) : ""} onChange={(e) => setEditing({ ...editing, is_available: editing.status === "unknown" ? true : false, reopen_at: e.target.value ? new Date(e.target.value).toISOString() : null })} className="mt-2 bg-slate-800 border-slate-700" />
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

              <TrafficForecastEditor
                value={editing.traffic_forecast ? { ...editing.traffic_forecast, holidayPeriods: editing.traffic_forecast.source === "regional-estimate" ? [] : editing.traffic_forecast.holidayPeriods } : createEmptyTrafficForecast()}
                onChange={(traffic_forecast) => setEditing({ ...editing, traffic_forecast })}
              />



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
                <Checkbox checked={!!editing.trailer_friendly} onCheckedChange={(c) => setEditing({ ...editing, trailer_friendly: !!c, construction: { ...(editing.construction ?? {}), trailerFriendlyStalls: c ? Math.max(1, editing.construction?.trailerFriendlyStalls ?? 0) : 0 } })} />
                <Truck className="w-4 h-4" /> Aanhangervriendelijk (doorrijbaar met aanhanger)
              </label>
              <div className="ml-6 max-w-xs space-y-1">
                <Label htmlFor="trailer-friendly-stalls">Aantal geschikte laadplekken voor aanhangers</Label>
                <Input id="trailer-friendly-stalls" type="number" min="0" max="100" step="1" value={editing.construction?.trailerFriendlyStalls ?? (editing.trailer_friendly ? 1 : 0)} onChange={(e) => setEditing({ ...editing, trailer_friendly: Number(e.target.value) > 0, construction: { ...(editing.construction ?? {}), trailerFriendlyStalls: Math.max(0, Math.min(100, Math.floor(Number(e.target.value) || 0))) } })} className="bg-slate-800 border-slate-700" />
                <p className="text-xs text-slate-500">Alleen het echte aantal geschikte plekken wordt opgeslagen. Er wordt geen drukte of aantal vrije aanhangerplekken berekend.</p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-sky-500/20 bg-sky-500/5 p-2">
                <Checkbox checked={!!editing.construction?.wheelchairAccessible} onCheckedChange={(checked) => setEditing({ ...editing, construction: { ...(editing.construction ?? {}), wheelchairAccessible: !!checked } })} />
                ♿ Invalidenplek aanwezig
              </label>
              <p className="ml-7 text-[11px] text-slate-500">Vink dit alleen aan als er bij deze Supercharger een officiële invalidenparkeerplek aanwezig is. Het rolstoelicoon verschijnt op de kaart.</p>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={!!editing.parking_fee} onCheckedChange={(c) => setEditing({ ...editing, parking_fee: !!c })} />
                💶 Parkeergeld verplicht
              </label>
              {editing.parking_fee && (
                <div className="ml-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div><Label className="text-sm font-semibold">🅿️ Parkeertarieven per stap</Label><p className="text-[11px] text-slate-400">Iedere stap heeft een eigen valuta. Periode 0 = eenmalig vast bedrag.</p></div>
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditing({ ...editing, parking_blocks: [...(editing.parking_blocks ?? []), { label: "Nieuw tarief", afterMinutes: 0, durationMinutes: 60, amount: 0, currency: "EUR", repeat: false }] })}>+ Tariefstap</Button>
                  </div>
                  {(editing.parking_blocks ?? []).map((block: ParkingFeeBlock, idx: number) => {
                    const blocks = [...(editing.parking_blocks ?? [])];
                    const update = (patch: Partial<ParkingFeeBlock>) => { blocks[idx] = { ...block, ...patch }; setEditing({ ...editing, parking_blocks: blocks }); };
                    return <div key={idx} className="rounded-lg border border-slate-700 bg-slate-900/70 p-2 space-y-2">
                      <div className="flex items-center gap-2"><Input className="h-8 flex-1 bg-slate-800 border-slate-600" placeholder="Bijv. Starttarief / eerste uur / daarna" value={block.label ?? ""} onChange={(e) => update({ label: e.target.value })} /><Button type="button" size="sm" variant="ghost" className="text-red-400" onClick={() => setEditing({ ...editing, parking_blocks: blocks.filter((_, i) => i !== idx) })}>✕</Button></div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <label>Vanaf (min)<Input type="number" min="0" className="mt-1 h-8 bg-slate-800 border-slate-600" value={block.afterMinutes} onChange={(e) => update({ afterMinutes: Math.max(0, Number(e.target.value) || 0) })} /></label>
                        <label>Periode (min)<Input type="number" min="0" className="mt-1 h-8 bg-slate-800 border-slate-600" value={block.durationMinutes} onChange={(e) => update({ durationMinutes: Math.max(0, Number(e.target.value) || 0) })} /></label>
                        <label>Bedrag<Input type="number" min="0" step="0.01" className="mt-1 h-8 bg-slate-800 border-slate-600" value={block.amount} onChange={(e) => update({ amount: Math.max(0, Number(e.target.value) || 0) })} /></label>
                        <label>Valuta<select className="mt-1 h-8 w-full rounded-md border border-slate-600 bg-slate-800 px-2" value={block.currency || "EUR"} onChange={(e) => update({ currency: e.target.value })}>{["EUR","CHF","GBP","USD","NOK","SEK","DKK","PLN","CZK","HUF","RON","BGN","TRY","ISK"].map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-slate-300"><Checkbox checked={!!block.repeat} onCheckedChange={(checked) => update({ repeat: !!checked })} /> Herhaal dit bedrag iedere periode</label>
                      {block.durationMinutes === 0 && <p className="text-[10px] text-slate-500">Eenmalig vast bedrag bij aanvang (bijvoorbeeld toegang/parkeerticket).</p>}
                    </div>;
                  })}
                  {(editing.parking_blocks ?? []).length === 0 && <p className="text-xs text-slate-500">Nog geen tariefstappen toegevoegd.</p>}
                  <p className="text-[11px] text-slate-400">Voorbeeld: starttarief 2 EUR (periode 0), eerste uur 2,50 EUR (vanaf 0, periode 60), daarna 5 EUR per uur (vanaf 60, periode 60, herhalen aan).</p>
                </div>
              )}
              <div className="space-y-3 text-xs rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                <label className="flex items-center gap-2">Valuta van de tarieven
                  <select className="h-8 rounded-md border border-slate-600 bg-slate-800 px-2" value={editing.price_currency ?? "EUR"} onChange={(e) => setEditing({ ...editing, price_currency: e.target.value })}>
                    {["EUR","CHF","GBP","USD","NOK","SEK","DKK","PLN","CZK","HUF","RON","BGN","TRY","ISK"].map((code) => <option key={code} value={code}>{code}</option>)}
                  </select>
                </label>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <Label className="text-sm font-semibold">⚡ Tesla-prijzen per tijdsblok</Label>
                    <p className="text-[11px] text-slate-400">Tarieven per kWh op basis van dag en tijd.</p>
                  </div>
                  <Button type="button" size="sm" variant="outline" className="h-7 shrink-0" onClick={() => setEditing({ ...editing, price_blocks: [...(editing.price_blocks ?? []), { type: "kwh", days: "dagelijks", from: "00:00", to: "23:59", pricePerKwh: 0.4 }] })}>+ kWh-tijdsblok</Button>
                </div>
                {(editing.price_blocks ?? []).filter((b: any) => b.type !== "power").map((block: any) => {
                  const all = [...(editing.price_blocks ?? [])]; const idx = all.indexOf(block);
                  const update = (patch: any) => { all[idx] = { ...block, ...patch, type: "kwh" }; setEditing({ ...editing, price_blocks: all }); };
                  return <div key={idx} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-1.5 items-center">
                    <Input placeholder="ma-vr / weekend / dagelijks" className="h-7 bg-slate-800 border-slate-600" value={block.days ?? "dagelijks"} onChange={(e) => update({ days: e.target.value })} />
                    <Input type="time" className="h-7 w-24 bg-slate-800 border-slate-600" value={block.from ?? "00:00"} onChange={(e) => update({ from: e.target.value })} />
                    <Input type="time" className="h-7 w-24 bg-slate-800 border-slate-600" value={block.to ?? "23:59"} onChange={(e) => update({ to: e.target.value })} />
                    <Input type="number" step="0.01" min="0" placeholder="EUR/kWh" className="h-7 w-20 bg-slate-800 border-slate-600" value={block.pricePerKwh ?? 0} onChange={(e) => update({ pricePerKwh: Number(e.target.value) })} />
                    <Button type="button" size="sm" variant="ghost" className="h-6 text-red-400" onClick={() => setEditing({ ...editing, price_blocks: all.filter((_, i) => i !== idx) })}>✕</Button>
                  </div>;
                })}
                <div className="border-t border-slate-700 pt-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div><Label className="text-sm font-semibold">⏱️ Prijzen per minuut op actueel laadvermogen</Label><p className="text-[11px] text-slate-400">De actieve prijs volgt het actuele laadvermogen van de auto, niet het maximum van de laadpaal.</p></div>
                    <Button type="button" size="sm" variant="outline" className="h-7 shrink-0" onClick={() => setEditing({ ...editing, price_blocks: [...(editing.price_blocks ?? []), { type: "power", minKw: 0, maxKw: 60, pricePerMinute: 0.36 }] })}>+ Vermogensblok</Button>
                  </div>
                  {(editing.price_blocks ?? []).filter((b: any) => b.type === "power").map((block: any) => {
                    const all = [...(editing.price_blocks ?? [])]; const idx = all.indexOf(block);
                    const update = (patch: any) => { all[idx] = { ...block, ...patch, type: "power" }; setEditing({ ...editing, price_blocks: all }); };
                    return <div key={idx} className="grid grid-cols-[1fr_auto_auto_auto] gap-1.5 items-center">
                      <span className="text-slate-300">kW</span>
                      <Input aria-label="Vanaf kW" type="number" min="0" step="1" className="h-7 w-20 bg-slate-800 border-slate-600" value={block.minKw ?? 0} onChange={(e) => update({ minKw: Math.max(0, Number(e.target.value)) })} />
                      <Input aria-label="Tot kW (leeg = onbeperkt)" type="number" min="0" step="1" placeholder="Onbeperkt" className="h-7 w-24 bg-slate-800 border-slate-600" value={block.maxKw ?? ""} onChange={(e) => update({ maxKw: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })} />
                      <div className="flex items-center gap-1"><Input aria-label="Prijs per minuut" type="number" min="0" step="0.01" className="h-7 w-20 bg-slate-800 border-slate-600" value={block.pricePerMinute ?? 0} onChange={(e) => update({ pricePerMinute: Math.max(0, Number(e.target.value)) })} /><span>€/min</span><Button type="button" size="sm" variant="ghost" className="h-6 text-red-400" onClick={() => setEditing({ ...editing, price_blocks: all.filter((_, i) => i !== idx) })}>✕</Button></div>
                    </div>;
                  })}
                  <p className="text-[10px] text-slate-500">Voorbeeld: 0–60 kW, 60–90 kW en 90–125 kW. De ondergrens telt mee; de bovengrens niet.</p>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={!!editing.in_parking_garage} onCheckedChange={(c) => setEditing({ ...editing, in_parking_garage: !!c })} />
                🅿️ In parkeergarage (niet voor aanhangerroute)
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Annuleren</Button>
            <Button onClick={save} disabled={!cloudConnected} className="bg-red-600 hover:bg-red-700">Opslaan</Button>
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
