import type { ChargerConfig, ChargerLifecycleStatus, Supercharger, TrafficForecast } from "./tesla-types";
import {
  getMaxSpeedFromConfigs,
  getTotalStallsFromConfigs,
  getVersionsFromConfigs,
  normalizeChargerConfigs,
  normalizeOpeningHours,
  parseChargerConfigsFromLegacy,
} from "./tesla-utils";
import { createRegionalTrafficForecast } from "./traffic-forecast";

type LocalRow = {
  id: string; name: string; lat: number; lng: number;
  total_stalls?: number | null; stall_types?: string | null; occupied_stalls?: number | null;
  country?: string | null; province?: string | null; city?: string | null;
  max_speed_kw?: number | null; versions?: string[] | null;
  opening_time?: string | null; closing_time?: string | null; opening_hours?: any;
  trailer_friendly?: boolean | null; is_available?: boolean | null;
  charger_configs?: ChargerConfig[] | null;
  parking_fee?: boolean | null; parking_fee_amount?: number | null; parking_free_minutes?: number | null;
  parking_per_minutes?: number | null; parking_per_euro?: number | null; parking_blocks?: any[] | null;
  price_currency?: string | null; price_per_kwh?: number | null; price_per_kwh_peak?: number | null;
  peak_hours?: string | null; price_blocks?: any[] | null; in_parking_garage?: boolean | null;
  status?: string | null; construction?: Record<string, any> | null; works?: any; closure?: any;
  owner_id?: string | null; owner_name?: string | null; low_speed?: boolean | null;
  published?: boolean | null; notes?: string | null; reopen_at?: string | null;
  planned_upgrade?: any; stall_states?: any[] | null; permanently_closed_at?: string | null;
  data_source?: string | null; voting?: any; hidden?: boolean | null; photos?: string[] | null;
  traffic_forecast?: TrafficForecast | null;
};
type Owner = { id: string; name: string; logo_url?: string | null; description?: string | null; website?: string | null; contact?: string | null; notes?: string | null };
type Dataset = { chargers: LocalRow[]; owners?: Owner[] };
type NetworkSite = Pick<Supercharger, "id" | "lat" | "lng">;

const lifecycle: ChargerLifecycleStatus[] = ["operational", "construction", "works", "works_closed", "temp_closed", "long_closed", "voting", "plan", "permit", "expanding", "permanent_closed", "unknown"];

function normalizeTariffMatch(value: string) {
  return value.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function withBundledTariff(row: LocalRow, tariffs: any[]): LocalRow {
  if ((Array.isArray(row.price_blocks) && row.price_blocks.length) || row.status !== "operational") return row;
  const country = normalizeTariffMatch(row.country ?? "");
  const name = normalizeTariffMatch([row.name, row.city, row.province].filter(Boolean).join(" "));
  const match = tariffs.find((tariff) =>
    [tariff.country, ...(tariff.countryAliases ?? [])].some((value: string) => normalizeTariffMatch(value) === country) &&
    (tariff.match ?? []).some((term: string) => {
      const normalized = normalizeTariffMatch(term);
      return name === normalized || name.includes(normalized);
    })
  );
  if (!match) return row;
  return { ...row, price_currency: match.currency ?? "EUR", price_per_kwh: match.pricePerKwh ?? null,
    price_per_kwh_peak: null, peak_hours: null, price_blocks: match.priceBlocks?.length ? match.priceBlocks : null };
}

function toSupercharger(row: LocalRow, owners: Map<string, Owner>, network: NetworkSite[]): Supercharger {
  const configs = normalizeChargerConfigs(row.charger_configs).length
    ? normalizeChargerConfigs(row.charger_configs)
    : parseChargerConfigsFromLegacy(row.stall_types, row.total_stalls, row.max_speed_kw, row.versions);
  const rawStatus = row.status ?? "";
  let status: ChargerLifecycleStatus = lifecycle.includes(rawStatus as ChargerLifecycleStatus) ? rawStatus as ChargerLifecycleStatus : "operational";
  if (status === "temp_closed" && row.reopen_at && new Date(row.reopen_at).getTime() <= Date.now()) status = "operational";
  const owner = row.owner_id ? owners.get(row.owner_id) : undefined;
  const totalStalls = getTotalStallsFromConfigs(configs) ?? row.total_stalls ?? undefined;
  const generated = createRegionalTrafficForecast({
    id: row.id, name: row.name, city: row.city ?? undefined, province: row.province ?? undefined,
    country: row.country ?? undefined, totalStalls, lat: row.lat, lng: row.lng,
  }, network);
  const stored = row.construction?.trafficForecast ?? row.traffic_forecast;
  const trafficForecast = stored?.source === "admin" ? stored : generated;
  return {
    id: row.id, name: row.name, lat: row.lat, lng: row.lng, totalStalls,
    occupiedStalls: row.occupied_stalls ?? undefined, stallTypes: row.stall_types ?? undefined,
    country: row.country ?? undefined, province: row.province ?? undefined, city: row.city ?? undefined,
    maxSpeedKw: row.max_speed_kw ?? getMaxSpeedFromConfigs(configs) ?? undefined,
    versions: getVersionsFromConfigs(configs).length ? getVersionsFromConfigs(configs) : row.versions ?? [],
    chargerConfigs: configs,
    openingHours: normalizeOpeningHours(row.opening_hours, row.opening_time, row.closing_time),
    openingTime: row.opening_time, closingTime: row.closing_time,
    trailerFriendly: !!row.trailer_friendly,
    trailerFriendlyStalls: row.construction?.trailerFriendlyStalls != null
      ? Math.max(0, Math.floor(Number(row.construction.trailerFriendlyStalls) || 0))
      : (row.trailer_friendly ? 1 : 0),
    isAvailable: row.is_available !== false, parkingFee: !!row.parking_fee,
    parkingFeeAmount: row.parking_fee_amount ?? null, parkingFreeMinutes: row.parking_free_minutes ?? null,
    parkingPerMinutes: row.parking_per_minutes ?? null, parkingPerEuro: row.parking_per_euro ?? null,
    parkingBlocks: Array.isArray(row.parking_blocks) ? row.parking_blocks : null,
    priceCurrency: row.price_currency ?? "EUR", pricePerKwh: row.price_per_kwh ?? null,
    pricePerKwhPeak: row.price_per_kwh_peak ?? null, peakHours: row.peak_hours ?? null,
    priceBlocks: Array.isArray(row.price_blocks) ? row.price_blocks : null,
    inParkingGarage: !!row.in_parking_garage, status, construction: row.construction ?? {},
    trafficForecast: trafficForecast?.source === "regional-estimate" ? { ...trafficForecast, holidayPeriods: [] } : trafficForecast,
    siteAmenities: Array.isArray(row.construction?.siteAmenities) ? row.construction.siteAmenities.filter((v: unknown): v is string => typeof v === "string") : [],
    works: row.works ?? {}, closure: row.closure ?? {}, ownerId: row.owner_id ?? null,
    ownerName: row.owner_name ?? owner?.name ?? null, ownerLogoUrl: row.owner_name ? null : owner?.logo_url ?? null,
    ownerDescription: owner?.description ?? null, ownerWebsite: owner?.website ?? null,
    ownerContact: owner?.contact ?? null, ownerNotes: owner?.notes ?? null,
    lowSpeed: !!row.low_speed, published: row.published !== false, notes: row.notes ?? null,
    reopenAt: row.reopen_at ?? null, plannedUpgrade: row.planned_upgrade ?? {},
    stallStates: Array.isArray(row.stall_states) ? row.stall_states : [],
    permanentlyClosedAt: row.permanently_closed_at ?? null,
    dataSource: row.data_source === "automatic" ? "automatic" : "manual",
    voting: row.voting ?? {}, hidden: !!row.hidden, photos: row.photos ?? [],
  };
}

/** Laadt de volledige meegeleverde dataset rechtstreeks in de browser; geen Lovable Cloud of Supabase nodig. */
export async function loadBundledSuperchargers(): Promise<Supercharger[]> {
  const [{ default: dataset }, { default: tariffFile }] = await Promise.all([
    import("@/data/superchargers.json"),
    import("@/data/supercharger-tariffs.json"),
  ]);
  const data = dataset as unknown as Dataset;
  const owners = new Map((data.owners ?? []).map((owner) => [owner.id, owner]));
  const rows = Array.isArray(data.chargers) ? data.chargers : [];
  const network: NetworkSite[] = rows.map((row) => ({ id: row.id, lat: row.lat, lng: row.lng }));
  const tariffs = (tariffFile as unknown as { tariffs: any[] }).tariffs ?? [];
  return rows.map((row) => toSupercharger(withBundledTariff(row, tariffs), owners, network));
}
