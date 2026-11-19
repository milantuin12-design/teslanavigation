import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import EvMap from "@/components/EvMap";
import InputPanel, { type PlannedWaypoint } from "@/components/InputPanel";
import { estimateConsumption, needsCcsAdapter, type RouteWeather } from "@/lib/energy";
import { fetchRouteWeather } from "@/lib/weather";
import ChargingStops, { parkingCost } from "@/components/ChargingStops";
import { estimateChargingCost } from "@/lib/charging-cost";
import NavigationPanel from "@/components/NavigationPanel";
import ChargingScreen from "@/components/ChargingScreen";
import { AccountMenu } from "@/components/AccountMenu";
import { LanguageSwitcher, changeLanguage } from "@/components/LanguageProvider";
import { getMySavedRoute, saveMyRoute, getMyAccountSettings, listMyChargerFavorites, setMyChargerFavorite, createMyNotificationEvent, listMyVehicles } from "@/lib/account.functions";
import { getCurrentUser } from "@/lib/auth.functions";
import { listPublishedVehicleModels, listPublishedSuperchargers } from "@/lib/admin.functions";
import { getWinterSportsMode, getHolidayPeriodMode } from "@/lib/tesla.functions";
import { vehicleKey, type VehicleModel } from "@/lib/vehicle-types";

const hasSupabaseBrowserConfig = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
import { cacheSavedRouteRow, getCachedSavedRouteRow, saveLocalRoute, type LocalRoute } from "@/lib/local-store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Bookmark, History, SlidersHorizontal, AlertTriangle, Loader2, Navigation as NavigationIcon } from "lucide-react";
import ChargerFilters from "@/components/ChargerFilters";
import ReportChargerDialog, { type ReportTarget } from "@/components/ReportChargerDialog";
import OwnerPanel from "@/components/OwnerPanel";
import ChargerCompareDialog from "@/components/ChargerCompareDialog";
import SiteUpdatesPopup from "@/components/SiteUpdatesPopup";
import SplashScreen from "@/components/SplashScreen";
import {
  Supercharger,
  ChargingStop,
  RouteResult,
  WeatherMode,
  TimeMode,
  teslaModels,
  teslaBatteryKWh,
  defaultChargerFilters,
  type ChargerFilterState,
} from "@/lib/tesla-types";
import {
  getAvailableRange,
  calculateChargingStopsWithAccessibilityPreference,
  calculateChargeDuration,
  parseMaxSpeed,
  effectiveChargeSpeedKw,
  distanceToRoute,
  projectOntoRoute,
  haversineDistance,
  isChargerOperationalAt,
  matchesChargerFilters,
  elevationConsumptionMultiplier,
  fetchElevationProfile,
} from "@/lib/tesla-utils";
import { fetchTrafficRoutes } from "@/lib/traffic.functions";
import { getTrafficForecastAt, isSnowRegion } from "@/lib/traffic-forecast";

import { mapCloudSuperchargers, readCachedPublicSuperchargers, writeCachedPublicSuperchargers } from "@/lib/local-superchargers";
import { lookupThirdPartyCharger } from "@/lib/third-party";


export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Tesla Routeplanner" },
      {
        name: "description",
        content:
          "Plan je Tesla rit met automatische Supercharger stops, live beschikbaarheid en navigatie.",
      },
      { property: "og:title", content: "Tesla Routeplanner" },
      {
        property: "og:description",
        content:
          "Plan je Tesla rit met automatische Supercharger stops, live beschikbaarheid en navigatie.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

interface RouteStep {
  distance: number;
  duration: number;
  instruction: string;
  name: string;
  maneuver: {
    type: string;
    modifier?: string;
    location: [number, number];
  };
}

interface RouteLeg {
  steps: RouteStep[];
}

interface OSRMRoute {
  geometry: { coordinates: [number, number][] };
  distance: number;
  duration: number;
  legs?: RouteLeg[];
}

interface RoutePlan {
  route: RouteResult;
  steps: RouteStep[];
  stops: ChargingStop[];
  arrivalPercent: number;
  whatIf?: {
    minus5: { reachable: boolean; arrivalPercent: number; stops: number };
    plus5: { reachable: boolean; arrivalPercent: number; stops: number };
  };
}

function estimateRouteCost(plan: RoutePlan, departure: Date, modelName: string, packKWh: number, carMaxKwOverride?: number): number | null {
  if (plan.stops.length === 0) return null;
  let total = 0;
  for (const stop of plan.stops) {
    const eta = new Date(departure.getTime() + (stop.etaMinFromStart ?? 0) * 60000);
    const charge = estimateChargingCost(stop, eta, modelName, packKWh, carMaxKwOverride);
    if (!charge || charge.currency !== "EUR") return null;
    const parking = parkingCost(stop, eta);
    if (stop.charger.parkingFee && parking === null) return null;
    total += charge.amount + (parking ?? 0);
  }
  return Number.isFinite(total) ? total : null;
}

type SavedVehicle = { id: string; name: string; model_name: string; model_year?: number | null; battery_kwh?: number | null; summer_consumption_kwh100?: number | null; winter_consumption_kwh100?: number | null; max_charge_kw?: number | null; arrival_percent: number; trailer_enabled: boolean; trailer_consumption_increase_percent: number; battery_health_percent?: number | null; roof_or_rack_extra_percent?: number; winter_tires_extra_percent?: number; is_default: boolean };

const OFF_ROUTE_KM_THRESHOLD = 0.2; // 200m
const OFF_ROUTE_PERSIST_MS = 8000; // off-route for 8s before rerouting

function Index() {
  const [startCoord, setStartCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [destCoord, setDestCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [waypoints, setWaypoints] = useState<PlannedWaypoint[]>([]);
  const [chargerArrivalTarget, setChargerArrivalTarget] = useState(15);
  const [preferTrailerFriendly, setPreferTrailerFriendly] = useState(false);

  const [selectedModel, setSelectedModel] = useState("Model 3 Long Range AWD");
  const [catalogueVehicles, setCatalogueVehicles] = useState<VehicleModel[]>([]);
  const listCatalogueFn = useServerFn(listPublishedVehicleModels);
  useEffect(() => { let active = true; void listCatalogueFn().then((rows) => { if (active) setCatalogueVehicles(rows as VehicleModel[]); }).catch(() => { if (active) setCatalogueVehicles([]); }); return () => { active = false; }; }, []);
  const [savedVehicles, setSavedVehicles] = useState<SavedVehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const activeVehicle = savedVehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null;
  const [manualRangeKm, setManualRangeKm] = useState(400);
  const [manualSpeedKw, setManualSpeedKw] = useState(250);
  const [modelYear, setModelYear] = useState<number>(2022);
  const selectedCatalogueVehicle = catalogueVehicles.find((vehicle) => vehicle.brand.toLowerCase() === "tesla" && vehicleKey(vehicle) === selectedModel && (vehicle.yearFrom == null || modelYear >= vehicle.yearFrom) && (vehicle.yearTo == null || modelYear <= vehicle.yearTo)) ?? catalogueVehicles.find((vehicle) => vehicle.brand.toLowerCase() === "tesla" && vehicleKey(vehicle) === selectedModel) ?? null;
  const carMaxKwOverride = activeVehicle?.max_charge_kw ?? selectedCatalogueVehicle?.maxChargeKw ?? (selectedModel === "Handmatig" ? manualSpeedKw : undefined);
  const vehicleBatteryHealth = Math.max(40, Math.min(100, activeVehicle?.battery_health_percent ?? 100)) / 100;
  const packKWh = activeVehicle?.battery_kwh ? activeVehicle.battery_kwh * vehicleBatteryHealth : (selectedCatalogueVehicle?.usableKWh ?? selectedCatalogueVehicle?.batteryKWh ?? (selectedModel === "Handmatig" ? Math.max(40, Math.round(manualRangeKm * 0.18)) : (teslaBatteryKWh[selectedModel] || 79)));
  const [batteryPercent, setBatteryPercent] = useState(80);
  const [targetArrivalPercent, setTargetArrivalPercent] = useState(10);
  const [chargeTargetPercent, setChargeTargetPercent] = useState(80);
  const [weatherMode, setWeatherMode] = useState<WeatherMode>("summer");
  const [timeMode, setTimeMode] = useState<TimeMode>("day");
  const [trailerEnabled, setTrailerEnabled] = useState(false);
  const [trailerReductionPercent, setTrailerReductionPercent] = useState(40);
  const [minChargerSpeedKw, setMinChargerSpeedKw] = useState(0);
  const [avoidLowSpeed, setAvoidLowSpeed] = useState(false);
  const [avoidParkingFee, setAvoidParkingFee] = useState(false);
  const [requireAccessibleStalls, setRequireAccessibleStalls] = useState(false);
  const [onlineTraffic, setOnlineTraffic] = useState(false);
  const [consumptionMode, setConsumptionMode] = useState<'auto' | 'manual'>('auto');
  const [manualConsumptionKWh100, setManualConsumptionKWh100] = useState(0);
  const applySavedVehicle = (vehicle: SavedVehicle) => {
    setSelectedVehicleId(vehicle.id);
    setSelectedModel(vehicle.model_name);
    if (vehicle.model_year) setModelYear(vehicle.model_year);
    const seasonalConsumption = weatherMode === "winter" ? vehicle.winter_consumption_kwh100 : vehicle.summer_consumption_kwh100;
    if (seasonalConsumption && seasonalConsumption > 0) { setManualConsumptionKWh100(seasonalConsumption); setConsumptionMode("manual"); }
    setTargetArrivalPercent(vehicle.arrival_percent ?? 10);
    setTrailerEnabled(!!vehicle.trailer_enabled);
    setTrailerReductionPercent((vehicle.trailer_consumption_increase_percent ?? 0) + (vehicle.roof_or_rack_extra_percent ?? 0) + (vehicle.winter_tires_extra_percent ?? 0));
  };
  const [tripDate, setTripDate] = useState<string>("");
  const [departTime, setDepartTime] = useState<string>("");
  const [elevProfile, setElevProfile] = useState<number[] | null>(null);
  const departureDate = useMemo(() => {
    const now = new Date();
    if (!tripDate && !departTime) return now;
    const day = tripDate || now.toISOString().slice(0, 10);
    const d = new Date(`${day}T${departTime || now.toTimeString().slice(0, 5)}`);
    return Number.isNaN(d.getTime()) ? now : d;
  }, [tripDate, departTime]);
  const isFutureTrip = !!tripDate && tripDate !== new Date().toISOString().slice(0, 10);
  const [manualWeather, setManualWeather] = useState<{ tempC?: number; windMs?: number; precipitationMm?: number }>({});
  const [hasCcsAdapter, setHasCcsAdapter] = useState(true);
  const [autoConsumption, setAutoConsumption] = useState<number | null>(null);
  const [routeWeather, setRouteWeather] = useState<RouteWeather | null>(null);
  const [energySummary, setEnergySummary] = useState<{ usedKWh: number; chargedKWh: number; kWh100: number } | null>(null);
  const [routeAdvice, setRouteAdvice] = useState<string[]>([]);
  const [excludedChargerIds, setExcludedChargerIds] = useState<string[]>([]);
  const [acceptedUnknownIds, setAcceptedUnknownIds] = useState<string[]>([]);
  const [riskCharger, setRiskCharger] = useState<Supercharger | null>(null);
  const [riskChargerQueue, setRiskChargerQueue] = useState<Supercharger[]>([]);
  const strictUnknownExclusionRef = useRef(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ start: string; dest: string; key: number } | null>(null);


  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [countryPricesOpen, setCountryPricesOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ id: string; display_name: string | null; gender?: string | null } | null>(null);
  const listVehiclesFn = useServerFn(listMyVehicles);
  useEffect(() => {
    if (!currentUser) { setSavedVehicles([]); setSelectedVehicleId(""); return; }
    let active = true;
    void listVehiclesFn().then((vehicles) => {
      if (!active) return;
      const list = vehicles as SavedVehicle[];
      setSavedVehicles(list);
      const preferred = list.find((vehicle) => vehicle.is_default) ?? list[0];
      if (preferred) applySavedVehicle(preferred);
    }).catch(() => { /* saved vehicles are optional */ });
    return () => { active = false; };
  }, [currentUser?.id]);
  useEffect(() => {
    let active = true;
    void getCurrentUser().then((user) => {
      if (active) setCurrentUser(user ? { id: user.id, display_name: user.display_name ?? null, gender: user.gender ?? null } : null);
    }).catch(() => { if (active) setCurrentUser(null); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ display_name: string | null; gender?: string | null }>).detail;
      const name = detail?.display_name ?? null;
      setCurrentUser((old) => old ? { ...old, display_name: name, gender: detail?.gender ?? old.gender } : old);
    };
    window.addEventListener("tn-profile-updated", handler);
    return () => window.removeEventListener("tn-profile-updated", handler);
  }, []);

  const loadPublicChargerFeed = useServerFn(listPublishedSuperchargers);
  const readGlobalWinterSportsMode = useServerFn(getWinterSportsMode);
  const readGlobalHolidayPeriodMode = useServerFn(getHolidayPeriodMode);
  const [superchargers, setSuperchargers] = useState<Supercharger[]>([]);
  const [holidayPeriodMode, setHolidayPeriodModeState] = useState(false);
  const [winterSportsMode, setWinterSportsModeState] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([readGlobalWinterSportsMode(), readGlobalHolidayPeriodMode()])
      .then(([winter, holiday]) => {
        if (!active) return;
        setWinterSportsModeState(!!winter);
        setHolidayPeriodModeState(!!holiday);
      })
      .catch(() => { /* Admin map modes are optional if the settings endpoint is unavailable. */ });
    return () => { active = false; };
  }, [readGlobalWinterSportsMode, readGlobalHolidayPeriodMode]);
  const [isLoadingChargers, setIsLoadingChargers] = useState(true);
  const [chargerLoadError, setChargerLoadError] = useState<string | null>(null);
  const previousChargerSnapshotRef = useRef<Map<string, string>>(new Map());
  const chargerSnapshot = (items: Supercharger[]) => new Map(items.filter((item) => item.id).map((item) => [item.id!, JSON.stringify({ status: item.status, available: item.isAvailable, stalls: item.stallStates })]));
  const [favoriteChargerIds, setFavoriteChargerIds] = useState<string[]>([]);
  // Keep an immediate reference so rapid add/remove clicks cannot reuse stale React state.
  const favoriteIdsRef = useRef<string[]>([]);
  const favoriteWriteQueuesRef = useRef<Map<string, Promise<void>>>(new Map());
  const listFavoritesFn = useServerFn(listMyChargerFavorites);
  const setFavoriteFn = useServerFn(setMyChargerFavorite);
  const createNotificationFn = useServerFn(createMyNotificationEvent);
  const [notifyPriceChanges, setNotifyPriceChanges] = useState(true);
  const [notifyStatusChanges, setNotifyStatusChanges] = useState(true);
  const [showFavoriteList, setShowFavoriteList] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("teslanavigation:favorites") || "[]");
      if (Array.isArray(saved)) {
        const ids = saved.filter((x): x is string => typeof x === "string");
        favoriteIdsRef.current = ids;
        setFavoriteChargerIds(ids);
      }
    } catch { /* ignore invalid local preferences */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem("teslanavigation:favorites", JSON.stringify(favoriteChargerIds)); }
    catch { /* storage may be unavailable */ }
  }, [favoriteChargerIds]);
  useEffect(() => {
    if (!currentUser) return;
    let active = true;
    void listFavoritesFn().then(async (remoteIds) => {
      if (!active) return;
      let localIds: string[] = [];
      try {
        const saved = JSON.parse(localStorage.getItem("teslanavigation:favorites") || "[]");
        if (Array.isArray(saved)) localIds = saved.filter((x): x is string => typeof x === "string");
      } catch { /* ignore invalid local preferences */ }
      if (remoteIds.length === 0 && localIds.length > 0) {
        // One-time safe migration from this browser's existing favorites into the signed-in account.
        await Promise.all(localIds.map((charger_id) => setFavoriteFn({ data: { charger_id, favorite: true } })));
        if (active) {
          favoriteIdsRef.current = localIds;
          setFavoriteChargerIds(localIds);
        }
      } else if (active) {
        favoriteIdsRef.current = remoteIds;
        setFavoriteChargerIds(remoteIds);
      }
    }).catch(() => { /* keep local favorites usable if D1 is temporarily unavailable */ });
    return () => { active = false; };
  }, [currentUser?.id]);
  const toggleFavoriteCharger = useCallback((id: string) => {
    const favorite = !favoriteIdsRef.current.includes(id);
    const updated = favorite
      ? [...favoriteIdsRef.current, id]
      : favoriteIdsRef.current.filter((item) => item !== id);
    // Update the ref and UI synchronously; this also makes repeated clicks reliable.
    favoriteIdsRef.current = updated;
    setFavoriteChargerIds(updated);
    if (!currentUser) return;

    // Serialize writes per charger so a quick add/remove sequence reaches D1 in click order.
    const previous = favoriteWriteQueuesRef.current.get(id) ?? Promise.resolve();
    const write = previous
      .catch(() => undefined)
      .then(() => setFavoriteFn({ data: { charger_id: id, favorite } }))
      .then(() => undefined)
      .catch(() => {
        toast.error("Favoriet kon niet met je account worden bijgewerkt. De lokale keuze blijft bewaard.");
      });
    favoriteWriteQueuesRef.current.set(id, write);
    void write.finally(() => {
      if (favoriteWriteQueuesRef.current.get(id) === write) {
        favoriteWriteQueuesRef.current.delete(id);
      }
    });
  }, [currentUser?.id, setFavoriteFn]);
  // Price alerts for favourite Superchargers: changes are detected on the next app refresh.
  useEffect(() => {
    if (isLoadingChargers || favoriteChargerIds.length === 0 || superchargers.length === 0) return;
    const key = "teslanavigation:favorite-price-snapshots";
    let previous: Record<string, string> = {};
    try { previous = JSON.parse(localStorage.getItem(key) || "{}") as Record<string, string>; } catch { previous = {}; }
    const next: Record<string, string> = {};
    const changes: string[] = [];
    for (const charger of superchargers) {
      if (!charger.id || !favoriteChargerIds.includes(charger.id)) continue;
      const snapshot = JSON.stringify({
        currency: charger.priceCurrency || "EUR",
        blocks: charger.priceBlocks ?? [],
        legacy: charger.pricePerKwh ?? null,
      });
      next[charger.id] = snapshot;
      if (previous[charger.id] && previous[charger.id] !== snapshot) changes.push(charger.name);
    }
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* local storage may be disabled */ }
    if (changes.length && notifyPriceChanges) {
      const first = changes.slice(0, 3).join(", ");
      toast.info(`Laadprijs gewijzigd bij favoriet: ${first}${changes.length > 3 ? ` en ${changes.length - 3} andere locatie(s)` : ""}.`);
      if (currentUser) {
        for (const charger of superchargers) {
          if (!charger.id || !changes.includes(charger.name)) continue;
          const snap = next[charger.id] ?? "";
          void createNotificationFn({ data: { event_type: "price_change", charger_id: charger.id, dedupe_key: "price:" + charger.id + ":" + snap, title: "Laadprijs gewijzigd", body: "De laadprijs bij " + charger.name + " is gewijzigd." } }).catch(() => {});
        }
      }
    }
  }, [favoriteChargerIds, isLoadingChargers, superchargers, notifyPriceChanges, currentUser?.id]);
  // Statuswijzigingen bij favoriete locaties worden in de persoonlijke inbox bewaard.
  useEffect(() => {
    if (!superchargers.length) return;
    const previous = previousChargerSnapshotRef.current;
    const next = chargerSnapshot(superchargers);
    if (previous.size > 0 && currentUser && notifyStatusChanges) {
      for (const charger of superchargers) {
        if (!charger.id || !favoriteChargerIds.includes(charger.id)) continue;
        const before = previous.get(charger.id);
        const after = next.get(charger.id);
        if (!before || !after || before === after) continue;
        let oldData: { status?: string; available?: boolean } = {};
        let newData: { status?: string; available?: boolean } = {};
        try { oldData = JSON.parse(before); newData = JSON.parse(after); } catch { continue; }
        if (oldData.status === newData.status && oldData.available === newData.available) continue;
        const oldStatus = oldData.status ?? "onbekend";
        const newStatus = newData.status ?? "onbekend";
        void createNotificationFn({
          data: {
            event_type: "status_change",
            charger_id: charger.id,
            dedupe_key: "status:" + charger.id + ":" + newStatus + ":" + String(newData.available),
            title: "Status gewijzigd",
            body: charger.name + ": " + oldStatus + " → " + newStatus,
          },
        }).catch(() => {});
      }
    }
    previousChargerSnapshotRef.current = next;
  }, [superchargers, favoriteChargerIds, currentUser?.id, notifyStatusChanges]);

  const [rememberFilters, setRememberFilters] = useState(true);
  const [chargerFilters, setChargerFilters] = useState<ChargerFilterState>(() => {
    try {
      const saved = typeof window !== "undefined" ? localStorage.getItem("teslanavigation:charger-filters") : null;
      if (!saved) return { ...defaultChargerFilters };
      const parsed = JSON.parse(saved) as Partial<ChargerFilterState>;
      return {
        ...defaultChargerFilters,
        ...parsed,
        // Oude opgeslagen filters mogen verwijderde Plan- en Voting-statussen niet terugzetten.
        statuses: (parsed.statuses ?? defaultChargerFilters.statuses).filter((status) => status !== "plan" && status !== "voting"),
      };
    } catch { return { ...defaultChargerFilters }; }
  });
  useEffect(() => {
    try {
      if (rememberFilters) localStorage.setItem("teslanavigation:charger-filters", JSON.stringify(chargerFilters));
      else localStorage.removeItem("teslanavigation:charger-filters");
    } catch { /* local storage may be disabled */ }
  }, [chargerFilters, rememberFilters]);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

  // Vergunning- en bouwlocaties standaard zichtbaar.
  const [showDevelopmentChargers, setShowDevelopmentChargers] = useState(true);
  const [showAllChargers, setShowAllChargers] = useState(false);
  const [mapType, setMapType] = useState<"road" | "satellite">("satellite");
  const [mapZoom, setMapZoom] = useState(7);
  const [mapMarkerSize, setMapMarkerSize] = useState(30);
  const [statusColors, setStatusColors] = useState<Record<string, string>>({});
  const [preferredRoutePriority, setPreferredRoutePriority] = useState<"cheapest" | "fastest" | "fewest_stops">("fastest");
  const [defaultChargePauseMin, setDefaultChargePauseMin] = useState(0);
  const [maxDetourKm, setMaxDetourKm] = useState(0);
  const [maxDistanceBetweenStopsKm, setMaxDistanceBetweenStopsKm] = useState(0);
  useEffect(() => {
    const handler = (event: Event) => {
      const prefs = (event as CustomEvent<{
        vehicle_model?: string | null; vehicle_year?: number | null; consumption_kwh100?: number | null;
        notifications?: { price_changes?: boolean; status_changes?: boolean };
        map?: { show_development_chargers?: boolean; remember_filters?: boolean };
        map_type?: "road" | "satellite"; map_zoom?: number; map_marker_size?: number; status_colors?: Record<string, string>;
        route_preferences?: { priority?: "cheapest" | "fastest" | "fewest_stops"; min_charger_kw?: number; default_charge_pause_min?: number; max_detour_km?: number; max_distance_between_stops_km?: number };
        theme?: "light" | "dark" | "system"; font_scale?: number; display_density?: "compact" | "comfortable";
        language?: string; profile_color?: string;
      }>).detail;
      if (!prefs) return;
      setRememberFilters(prefs.map?.remember_filters ?? true);
      setNotifyPriceChanges(prefs.notifications?.price_changes ?? true);
      setNotifyStatusChanges(prefs.notifications?.status_changes ?? true);
      if (prefs.map_type) setMapType(prefs.map_type);
      if (typeof prefs.map_zoom === "number") setMapZoom(Math.max(3, Math.min(18, prefs.map_zoom)));
      if (typeof prefs.map_marker_size === "number") setMapMarkerSize(Math.max(20, Math.min(48, prefs.map_marker_size)));
      if (prefs.status_colors) setStatusColors(prefs.status_colors);
      if (prefs.route_preferences?.priority) setPreferredRoutePriority(prefs.route_preferences.priority);
      if (typeof prefs.route_preferences?.min_charger_kw === "number") setMinChargerSpeedKw(prefs.route_preferences.min_charger_kw);
      if (typeof prefs.route_preferences?.default_charge_pause_min === "number") setDefaultChargePauseMin(prefs.route_preferences.default_charge_pause_min);
      if (typeof prefs.route_preferences?.max_detour_km === "number") setMaxDetourKm(prefs.route_preferences.max_detour_km);
      if (typeof prefs.route_preferences?.max_distance_between_stops_km === "number") setMaxDistanceBetweenStopsKm(prefs.route_preferences.max_distance_between_stops_km);
      if (prefs.theme) document.documentElement.classList.toggle("dark", prefs.theme === "dark" || (prefs.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches));
      if (typeof prefs.font_scale === "number") document.documentElement.style.fontSize = (16 * Math.max(0.85, Math.min(1.3, prefs.font_scale))) + "px";
      if (prefs.display_density) document.documentElement.dataset.displayDensity = prefs.display_density;
      if (prefs.profile_color && /^#[0-9a-fA-F]{6}$/.test(prefs.profile_color)) document.documentElement.style.setProperty("--profile-accent", prefs.profile_color);
      if (prefs.language) changeLanguage(prefs.language);
      if (prefs.vehicle_model && Object.prototype.hasOwnProperty.call(teslaModels, prefs.vehicle_model)) setSelectedModel(prefs.vehicle_model);
      if (typeof prefs.vehicle_year === "number") setModelYear(prefs.vehicle_year);
      if (typeof prefs.consumption_kwh100 === "number") {
        setManualConsumptionKWh100(prefs.consumption_kwh100);
        setConsumptionMode("manual");
      }
    };
    window.addEventListener("tn-preferences-updated", handler);
    return () => window.removeEventListener("tn-preferences-updated", handler);
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    let active = true;
    void getMyAccountSettings().then((account) => {
      if (!active) return;
      const prefs = account.preferences;
      setRememberFilters(prefs.map?.remember_filters ?? true);
      setNotifyPriceChanges(prefs.notifications?.price_changes ?? true);
      setNotifyStatusChanges(prefs.notifications?.status_changes ?? true);
      if (prefs.map_type) setMapType(prefs.map_type);
      if (typeof prefs.map_zoom === "number") setMapZoom(Math.max(3, Math.min(18, prefs.map_zoom)));
      if (typeof prefs.map_marker_size === "number") setMapMarkerSize(Math.max(20, Math.min(48, prefs.map_marker_size)));
      if (prefs.status_colors) setStatusColors(prefs.status_colors);
      if (prefs.route_preferences?.priority) setPreferredRoutePriority(prefs.route_preferences.priority);
      if (typeof prefs.route_preferences?.min_charger_kw === "number") setMinChargerSpeedKw(prefs.route_preferences.min_charger_kw);
      if (typeof prefs.route_preferences?.default_charge_pause_min === "number") setDefaultChargePauseMin(prefs.route_preferences.default_charge_pause_min);
      if (typeof prefs.route_preferences?.max_detour_km === "number") setMaxDetourKm(prefs.route_preferences.max_detour_km);
      if (typeof prefs.route_preferences?.max_distance_between_stops_km === "number") setMaxDistanceBetweenStopsKm(prefs.route_preferences.max_distance_between_stops_km);
      if (prefs.theme) document.documentElement.classList.toggle("dark", prefs.theme === "dark" || (prefs.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches));
      if (typeof prefs.font_scale === "number") document.documentElement.style.fontSize = (16 * Math.max(0.85, Math.min(1.3, prefs.font_scale))) + "px";
      if (prefs.display_density) document.documentElement.dataset.displayDensity = prefs.display_density;
      if (prefs.profile_color && /^#[0-9a-fA-F]{6}$/.test(prefs.profile_color)) document.documentElement.style.setProperty("--profile-accent", prefs.profile_color);
      if (prefs.language) changeLanguage(prefs.language);
      if (prefs.vehicle_model && teslaModels.includes(prefs.vehicle_model)) setSelectedModel(prefs.vehicle_model);
      if (typeof prefs.vehicle_year === "number") setModelYear(prefs.vehicle_year);
      if (typeof prefs.consumption_kwh100 === "number") {
        setManualConsumptionKWh100(prefs.consumption_kwh100);
        setConsumptionMode("manual");
      }
    }).catch(() => { /* Profile settings are optional; the route planner remains usable. */ });
    return () => { active = false; };
  }, [currentUser?.id]);

  const countryPriceStats = useMemo(() => {
    if (!countryPricesOpen) return [];
    const groups = new Map<string, { country: string; currency: string; total: number; count: number }>();
    for (const charger of superchargers) {
      if (charger.published === false || !charger.country) continue;
      const hasKwhPrice = typeof charger.pricePerKwh === "number" || (charger.priceBlocks ?? []).some((block) => block.type !== "power" && typeof block.pricePerKwh === "number");
      const hasMinutePrice = (charger.priceBlocks ?? []).some((block) => block.type === "power" && typeof block.pricePerMinute === "number");
      if (!hasKwhPrice && !hasMinutePrice) continue;
      const sampleStop: ChargingStop = {
        charger,
        batteryBefore: 10,
        batteryAfter: 80,
        distanceFromStart: 0,
        chargeDurationMin: 0,
        energyChargedKWh: packKWh * 0.7,
      };
      const estimate = estimateChargingCost(sampleStop, departureDate, selectedModel, packKWh, carMaxKwOverride);
      if (!estimate) continue;
      const key = `${charger.country}|${estimate.currency}`;
      const group = groups.get(key) ?? { country: charger.country, currency: estimate.currency, total: 0, count: 0 };
      group.total += estimate.amount / (packKWh * 0.7);
      group.count += 1;
      groups.set(key, group);
    }
    return [...groups.values()].map((group) => ({ ...group, average: group.total / group.count }))
      .sort((a, b) => a.currency.localeCompare(b.currency) || a.average - b.average);
  }, [countryPricesOpen, superchargers, departureDate, selectedModel, packKWh, carMaxKwOverride]);

  // Ontwikkellocaties blijven standaard zichtbaar; de knop "Alles tonen" kan ze verbergen/terugzetten.
  const isDevelopmentCharger = (charger: Supercharger) =>
    charger.status === "construction" || charger.status === "permit";
  const visibleChargers = useMemo(
    () => superchargers.filter((charger) =>
      matchesChargerFilters(charger, chargerFilters) && (showDevelopmentChargers || !isDevelopmentCharger(charger))
    ),
    [superchargers, chargerFilters, showDevelopmentChargers],
  );
  const favoriteChargers = useMemo(
    () => superchargers.filter((charger) => !!charger.id && favoriteChargerIds.includes(charger.id)),
    [superchargers, favoriteChargerIds],
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const id = (event as CustomEvent<{ id: string }>).detail?.id;
      if (id) toggleFavoriteCharger(id);
    };
    window.addEventListener("sc-favorite", handler);
    return () => window.removeEventListener("sc-favorite", handler);
  }, [toggleFavoriteCharger]);

  // Meldknop in de kaart-popup
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string | null; name: string }>).detail;
      setReportTarget({ id: detail?.id ?? null, name: detail?.name ?? "" });
    };
    window.addEventListener("sc-report", handler);
    return () => window.removeEventListener("sc-report", handler);
  }, []);

  // Eigenaar aanklikken in de kaart-popup
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string | null }>).detail;
      if (detail?.id) setOwnerPanelId(detail.id);
    };
    window.addEventListener("sc-owner", handler);
    return () => window.removeEventListener("sc-owner", handler);
  }, []);


  const [route, setRoute] = useState<RouteResult | null>(null);
  const [showRouteInputs, setShowRouteInputs] = useState(true);
  const [routeOptions, setRouteOptions] = useState<RoutePlan[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const fastestRouteIndex = routeOptions.length ? routeOptions.reduce((best, plan, i) => {
    const total = plan.route.totalTimeMin + plan.stops.reduce((sum, stop) => sum + stop.chargeDurationMin, 0);
    const bestTotal = routeOptions[best].route.totalTimeMin + routeOptions[best].stops.reduce((sum, stop) => sum + stop.chargeDurationMin, 0);
    return total < bestTotal ? i : best;
  }, 0) : -1;
  const fewestStopsIndex = routeOptions.length ? routeOptions.reduce((best, plan, i) => plan.stops.length < routeOptions[best].stops.length ? i : best, 0) : -1;
  const routeCosts = routeOptions.map((plan) => estimateRouteCost(plan, departureDate, selectedModel, packKWh, carMaxKwOverride));
  const pricedRoutes = routeCosts.map((cost, index) => ({ cost, index })).filter((item): item is { cost: number; index: number } => item.cost !== null);
  const cheapestRouteIndex = pricedRoutes.length ? pricedRoutes.reduce((best, item) => item.cost < best.cost ? item : best).index : -1;
  useEffect(() => {
    if (!routeOptions.length) return;
    const preferredIndex = preferredRoutePriority === "cheapest" ? cheapestRouteIndex : preferredRoutePriority === "fewest_stops" ? fewestStopsIndex : fastestRouteIndex;
    if (preferredIndex >= 0) setSelectedRouteIndex(preferredIndex);
  }, [routeOptions, preferredRoutePriority, cheapestRouteIndex, fewestStopsIndex, fastestRouteIndex]);
  // Vergelijk ook de verwachte drukte op de daadwerkelijke aankomsttijd bij elke laadstop.
  // Routes zonder bruikbare druktegegevens krijgen geen kunstmatig gunstige score.
  const routeCrowdLevels = routeOptions.map((plan) => {
    const levels = plan.stops.map((stop) => {
      if (!stop.charger.trafficForecast || typeof stop.etaMinFromStart !== "number") return null;
      return getTrafficForecastAt(
        stop.charger.trafficForecast,
        new Date(departureDate.getTime() + stop.etaMinFromStart * 60000),
        stop.charger.province,
        holidayPeriodMode,
        winterSportsMode && isSnowRegion(stop.charger),
      )?.level ?? null;
    }).filter((level): level is number => typeof level === "number");
    return levels.length ? levels.reduce((sum, level) => sum + level, 0) / levels.length : null;
  });
  const crowdRankedRoutes = routeCrowdLevels.map((level, index) => ({ level, index })).filter((item): item is { level: number; index: number } => item.level !== null);
  const quietestRouteIndex = crowdRankedRoutes.length ? crowdRankedRoutes.reduce((best, item) => item.level < best.level ? item : best).index : -1;
  const departureAdvice = useMemo(() => {
    const plan = routeOptions[selectedRouteIndex];
    if (!plan || plan.stops.length === 0) return null;
    // Gebruik uitsluitend de aparte globale vakantiemodus; wintersport is een losse instelling.
    const offsets = [-120, -60, -30, 0, 30, 60, 90, 120, 180, 240];
    const candidates = offsets
      .map((offset) => {
        const departure = new Date(departureDate.getTime() + offset * 60000);
        if (departure.getTime() < Date.now() - 60000) return null;
        const cost = estimateRouteCost(plan, departure, selectedModel, packKWh, carMaxKwOverride);
        if (cost === null) return null;
        const crowdLevels = plan.stops
          .map((stop) => getTrafficForecastAt(
            stop.charger.trafficForecast,
            new Date(departure.getTime() + (stop.etaMinFromStart ?? 0) * 60000),
            stop.charger.province,
            holidayPeriodMode,
            winterSportsMode && isSnowRegion(stop.charger),
          )?.level)
          .filter((level): level is number => typeof level === "number");
        const traffic = crowdLevels.length ? crowdLevels.reduce((sum, level) => sum + level, 0) / crowdLevels.length : null;
        return { departure, cost, offset, traffic };
      })
      .filter((item): item is { departure: Date; cost: number; offset: number; traffic: number | null } => item !== null);
    if (candidates.length < 2) return null;
    const current = candidates.find((item) => item.offset === 0);
    if (!current) return null;
    const trafficSafe = current.traffic === null ? candidates : candidates.filter((item) => item.traffic === null || item.traffic <= current.traffic! + 10);
    const pool = trafficSafe.length ? trafficSafe : candidates;
    const best = pool.reduce((a, b) => b.cost < a.cost ? b : a);
    const saving = current.cost - best.cost;
    return saving >= 0.5 && best.offset !== 0 ? { ...best, saving, currentTraffic: current.traffic } : null;
  }, [routeOptions, selectedRouteIndex, departureDate, selectedModel, packKWh, carMaxKwOverride, holidayPeriodMode, winterSportsMode]);
  const [ownerPanelId, setOwnerPanelId] = useState<string | null>(null);
  const [focusCoord, setFocusCoord] = useState<{ lat: number; lng: number } | null>(null);

  const [chargingStops, setChargingStops] = useState<ChargingStop[]>([]);
  const [arrivalPercent, setArrivalPercent] = useState<number | null>(null);
  const [routeSteps, setRouteSteps] = useState<RouteStep[]>([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [calculationProgress, setCalculationProgress] = useState(0);
  const [error, setError] = useState("");
  const [isNavigating, setIsNavigating] = useState(false);
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsError, setGpsError] = useState(false);
  const [currentSpeedKmh, setCurrentSpeedKmh] = useState<number | null>(null);
  const [currentHeading, setCurrentHeading] = useState<number | null>(null);
  const [headingUp, setHeadingUp] = useState(false);
  const [liveBattery, setLiveBattery] = useState<number>(80);
  const [lastAvailabilityUpdate, setLastAvailabilityUpdate] = useState<string | null>(null);
  const [chargerRevision, setChargerRevision] = useState(0);
  const [navStartBattery, setNavStartBattery] = useState<number>(80);
  const [navStartKm, setNavStartKm] = useState<number>(0);
  const [routeChangedAt, setRouteChangedAt] = useState<number | null>(null);
  const [routeChangedStops, setRouteChangedStops] = useState<ChargingStop[] | null>(null);
  const [activeChargingStop, setActiveChargingStop] = useState<ChargingStop | null>(null);
  const chargedStopKeysRef = useRef<Set<string>>(new Set());
  const prevPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const displayedPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const gpsTargetPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const gpsAnimationFrameRef = useRef<number | null>(null);
  const calculationIdRef = useRef(0);
  // Cache én deel lopende hoogte-/weerverzoeken tussen routevarianten.
  // Zonder deze in-flight cache konden drie varianten tegelijk dezelfde API's aanroepen.
  type ElevationWeather = [number[] | null, import("@/lib/energy").RouteWeather | null];
  const elevationWeatherCacheRef = useRef<Map<string, ElevationWeather>>(new Map());
  const elevationWeatherPendingRef = useRef<Map<string, Promise<ElevationWeather>>>(new Map());
  const fetchTrafficRoutesFn = useServerFn(fetchTrafficRoutes);
  const trailerReductionEffective = trailerEnabled ? trailerReductionPercent : 0;

  const catalogueBatteryForRange = selectedCatalogueVehicle?.usableKWh ?? selectedCatalogueVehicle?.batteryKWh ?? packKWh;
  const catalogueRangeFromConsumption = selectedCatalogueVehicle?.consumptionKWh100 && selectedCatalogueVehicle.consumptionKWh100 > 0
    ? Math.round(catalogueBatteryForRange / selectedCatalogueVehicle.consumptionKWh100 * 100)
    : null;
  const modelRange = activeVehicle?.battery_kwh && activeVehicle?.summer_consumption_kwh100
    ? Math.round(activeVehicle.battery_kwh / activeVehicle.summer_consumption_kwh100 * 100)
    : (selectedCatalogueVehicle?.rangeKm ?? catalogueRangeFromConsumption ?? (selectedModel === "Handmatig" ? manualRangeKm : (teslaModels[selectedModel] ?? 450)));
  const ccsBlocked = needsCcsAdapter(selectedModel, modelYear) && !hasCcsAdapter;
  const [autoConsumptionKWh100State, setAutoConsumptionState] = useState<number | null>(null);
  // Bereik volgt uitsluitend uit verbruik (kWh/100 km), niet uit een vaste km-waarde.
  const catalogueSeasonalConsumption = weatherMode === "winter" ? selectedCatalogueVehicle?.winterConsumptionKWh100 : selectedCatalogueVehicle?.consumptionKWh100;
  const savedSeasonalConsumption = activeVehicle ? (weatherMode === "winter" ? activeVehicle.winter_consumption_kwh100 : activeVehicle.summer_consumption_kwh100) : null;
  const effectiveKWh100 = consumptionMode === 'manual' && manualConsumptionKWh100 > 0
    ? manualConsumptionKWh100
    : ((savedSeasonalConsumption && savedSeasonalConsumption > 0 ? savedSeasonalConsumption : catalogueSeasonalConsumption) || (autoConsumptionKWh100State ?? Math.max(13, (packKWh / Math.max(1, modelRange)) * 100 * 1.1) * (1 + trailerReductionEffective / 100)));
  const fullEnergyRangeKm = Math.max(50, (packKWh / effectiveKWh100) * 100);
  const availableRange = fullEnergyRangeKm * batteryPercent / 100;


  // De kaart leest live uit dezelfde Cloudflare D1-database als het Admin-paneel.
  // De ingebouwde JSON wordt alleen als noodweergave gebruikt als D1 tijdelijk niet bereikbaar is.
  const refreshSuperchargers = useCallback(async () => {
    const feed = await loadPublicChargerFeed();
    if (!Array.isArray(feed?.chargers)) throw new Error("Cloudflare D1 gaf geen geldige openbare Superchargerlijst terug.");
    const mapped = await mapCloudSuperchargers(feed.chargers, Array.isArray(feed.owners) ? feed.owners : []);
    setSuperchargers(mapped);
    setChargerLoadError(null);
    // D1 blijft leidend; IndexedDB is uitsluitend een lokale startcache.
    void writeCachedPublicSuperchargers(mapped);
  }, [loadPublicChargerFeed]);

  useEffect(() => {
    let mounted = true;
    let liveFeedLoaded = false;
    // Toon de laatst bekende kaart direct vanuit IndexedDB terwijl D1 op de
    // achtergrond ververst. Een late cache-read mag nooit nieuwere D1-data overschrijven.
    const cachePromise = readCachedPublicSuperchargers();
    void cachePromise.then((cached) => {
      if (!mounted || liveFeedLoaded || !cached?.length) return;
      setSuperchargers(cached);
      setIsLoadingChargers(false);
    });

    void refreshSuperchargers()
      .then(() => { liveFeedLoaded = true; })
      .catch(async (error) => {
        console.error("[TeslaNavigation] Live D1-feed laden mislukt:", error);
        const cached = await cachePromise;
        if (cached?.length) {
          if (mounted) setChargerLoadError("Live D1 is tijdelijk niet bereikbaar; de laatst opgeslagen Superchargerdata wordt getoond.");
          return;
        }
        try {
          const { loadBundledSuperchargers } = await import("@/lib/local-superchargers");
          const fallback = await loadBundledSuperchargers();
          if (mounted) {
            setSuperchargers(fallback);
            setChargerLoadError("Live D1 is niet bereikbaar; je ziet mogelijk verouderde Superchargerdata.");
          }
        } catch (fallbackError) {
          if (mounted) setChargerLoadError(error instanceof Error ? error.message : "Superchargers konden niet worden geladen.");
          console.error("[TeslaNavigation] Ook de lokale noodlijst kon niet worden geladen:", fallbackError);
        }
      })
      .finally(() => { if (mounted) setIsLoadingChargers(false); });
    return () => { mounted = false; };
  }, [refreshSuperchargers]);

  // Houd de kaart van openstaande gebruikers actueel wanneer een beheerder
  // een status, beschikbaarheid of laadplekken wijzigt. Alleen pollen op een
  // zichtbaar tabblad en nooit twee D1-verzoeken tegelijk uitvoeren.
  useEffect(() => {
    let refreshing = false;
    const refreshLiveMap = async () => {
      if (refreshing || document.visibilityState !== "visible") return;
      refreshing = true;
      try {
        await refreshSuperchargers();
      } catch (error) {
        // Laat de laatst bekende kaart staan; een tijdelijke netwerkfout mag
        // de kaart niet leegmaken of de gebruiker steeds waarschuwen.
        console.warn("[TeslaNavigation] Live kaartupdate tijdelijk mislukt:", error);
      } finally {
        refreshing = false;
      }
    };
    const timer = window.setInterval(() => { void refreshLiveMap(); }, 15000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshLiveMap();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshSuperchargers]);

  useEffect(() => {
    setLastAvailabilityUpdate(new Date().toISOString());
  }, []);

  // Load saved route via ?load=<id>
  const [pendingLoadCalc, setPendingLoadCalc] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const loadId = params.get("load");
    if (!loadId) return;
    (async () => {
      type SavedRow = {
        id: string; start_lat: number; start_lng: number; end_lat: number; end_lng: number;
        model_name: string; battery_percent: number; trailer_mode: boolean; trailer_reduction: number;
        weather_mode: string; time_mode: string; payload: unknown;
      };
      // Lokaal eerst: direct inladen, ook als de database niet bereikbaar is.
      let data: SavedRow | null = getCachedSavedRouteRow<SavedRow>(loadId);
      if (!data) {
        try {
          data = await getMySavedRoute({ data: { id: loadId } }) as SavedRow | null;
          if (data) cacheSavedRouteRow(data as unknown as { id: string } & Record<string, unknown>);
        } catch { data = null; }
      }
      if (!data) { toast.error("Route niet gevonden (offline en niet lokaal bewaard)"); return; }
      setStartCoord({ lat: data.start_lat, lng: data.start_lng });
      setDestCoord({ lat: data.end_lat, lng: data.end_lng });
      setSelectedModel(data.model_name);
      setBatteryPercent(data.battery_percent);
      setTrailerEnabled(data.trailer_mode);
      setTrailerReductionPercent(data.trailer_reduction);
      setWeatherMode(data.weather_mode as WeatherMode);
      setTimeMode(data.time_mode as TimeMode);
      const payload = (data.payload ?? {}) as { plan?: RoutePlan; settings?: Record<string, unknown>; waypoints?: PlannedWaypoint[]; startLabel?: string; destLabel?: string };
      const st = payload.settings ?? {};
      if (typeof st.targetArrivalPercent === "number") setTargetArrivalPercent(st.targetArrivalPercent);
      if (typeof st.chargeTargetPercent === "number") setChargeTargetPercent(st.chargeTargetPercent);
      if (typeof st.chargerArrivalTarget === "number") setChargerArrivalTarget(st.chargerArrivalTarget);
      if (typeof st.modelYear === "number") setModelYear(st.modelYear);
      if (Array.isArray(payload.waypoints)) setWaypoints(payload.waypoints);
      setPrefill({
        start: data.start_address || payload.startLabel || `${data.start_lat.toFixed(5)}, ${data.start_lng.toFixed(5)}`,
        dest: data.end_address || payload.destLabel || `${data.end_lat.toFixed(5)}, ${data.end_lng.toFixed(5)}`,
        key: Date.now(),
      });
      if (payload.plan?.route?.coordinates?.length) {
        // Meteen tonen zoals opgeslagen — geen herberekening nodig.
        setRouteOptions([payload.plan]);
        setSelectedRouteIndex(0);
        setRoute(payload.plan.route);
        setRouteSteps(payload.plan.steps ?? []);
        setChargingStops(payload.plan.stops ?? []);
        setArrivalPercent(payload.plan.arrivalPercent ?? null);
        setLiveBattery(data.battery_percent);
        toast.success("Route geladen");
      } else {
        setPendingLoadCalc(true);
      }
      // Clear query
      window.history.replaceState(null, "", window.location.pathname);
    })();
  }, []);

  useEffect(() => {
    setExcludedChargerIds([]);
    setAcceptedUnknownIds([]);
    setRiskCharger(null);
    setRiskChargerQueue([]);
    strictUnknownExclusionRef.current = false;
  }, [startCoord, destCoord]);
  const recalcAfterExcludeRef = useRef(false);
  useEffect(() => {
    if (!recalcAfterExcludeRef.current) return;
    recalcAfterExcludeRef.current = false;
    // Wacht tot de nieuwe berekenfunctie (met de uitsluiting) klaarstaat.
    const t = window.setTimeout(() => handleCalculateRef.current?.(), 0);
    return () => window.clearTimeout(t);
  }, [excludedChargerIds]);

  // Once superchargers are loaded and a pending load is queued, calculate
  const handleCalculateRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!pendingLoadCalc || superchargers.length === 0 || !startCoord || !destCoord) return;
    setPendingLoadCalc(false);
    handleCalculateRef.current?.();
  }, [pendingLoadCalc, superchargers.length, startCoord, destCoord]);





  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (isNavigating && navigator.geolocation) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          setGpsError(false);
          const newPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setCurrentSpeedKmh(typeof pos.coords.speed === "number" && Number.isFinite(pos.coords.speed) && pos.coords.speed >= 0 ? Math.round(pos.coords.speed * 3.6) : null);
          // Compute heading from GPS heading or from prev->new bearing
          let h: number | null = typeof pos.coords.heading === 'number' && !isNaN(pos.coords.heading) ? pos.coords.heading : null;
          if (h === null && prevPositionRef.current) {
            const prev = prevPositionRef.current;
            const dy = newPos.lat - prev.lat;
            const dx = (newPos.lng - prev.lng) * Math.cos(((newPos.lat + prev.lat) / 2) * Math.PI / 180);
            if (Math.abs(dx) + Math.abs(dy) > 1e-6) {
              h = (Math.atan2(dx, dy) * 180) / Math.PI;
              if (h < 0) h += 360;
            }
          }
          if (h !== null) setCurrentHeading(h);
          prevPositionRef.current = newPos;
          // Bewaar steeds de nieuwste GPS-fix als doel. Laat één doorlopende animatie
          // daar vloeiend naartoe bewegen; een nieuwe GPS-fix mag de huidige beweging
          // nooit afbreken of opnieuw vanaf nul laten beginnen.
          gpsTargetPositionRef.current = newPos;
          if (!displayedPositionRef.current) {
            displayedPositionRef.current = newPos;
            setCurrentPosition(newPos);
            return;
          }
          if (gpsAnimationFrameRef.current === null) {
            let previousFrameTime = 0;
            let lastPaint = 0;
            const animate = (now: number) => {
              const target = gpsTargetPositionRef.current;
              const current = displayedPositionRef.current;
              if (!target || !current) {
                gpsAnimationFrameRef.current = null;
                return;
              }
              const deltaMs = previousFrameTime ? Math.min(50, now - previousFrameTime) : 16;
              previousFrameTime = now;
              // Exponentiële smoothing is onafhankelijk van de GPS-updatefrequentie.
              const alpha = 1 - Math.exp(-deltaMs / 260);
              const next = {
                lat: current.lat + (target.lat - current.lat) * alpha,
                lng: current.lng + (target.lng - current.lng) * alpha,
              };
              const remaining = Math.abs(target.lat - next.lat) + Math.abs(target.lng - next.lng);
              const settled = remaining < 0.000003;
              const displayed = settled ? target : next;
              displayedPositionRef.current = displayed;
              // Maximaal 30 updates per seconde voorkomt onnodige zware kaart-redraws.
              if (now - lastPaint >= 33 || settled) {
                lastPaint = now;
                setCurrentPosition(displayed);
              }
              if (settled) {
                gpsAnimationFrameRef.current = null;
              } else {
                gpsAnimationFrameRef.current = requestAnimationFrame(animate);
              }
            };
            gpsAnimationFrameRef.current = requestAnimationFrame(animate);
          }
        },
        (error) => {
          console.warn("[TeslaNavigation] GPS niet beschikbaar:", error.message);
          setGpsError(true);
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
      );
    } else {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setCurrentPosition(null);
      setGpsError(false);
      setCurrentSpeedKmh(null);
      setCurrentHeading(null);
      prevPositionRef.current = null;
      displayedPositionRef.current = null;
      if (gpsAnimationFrameRef.current !== null) {
        cancelAnimationFrame(gpsAnimationFrameRef.current);
        gpsAnimationFrameRef.current = null;
      }
    }
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (gpsAnimationFrameRef.current !== null) {
        cancelAnimationFrame(gpsAnimationFrameRef.current);
        gpsAnimationFrameRef.current = null;
      }
    };
  }, [isNavigating]);

  const fetchRouteWithInstructions = useCallback(async (
    start: [number, number],
    end: [number, number],
    intermediateWaypoints?: [number, number][],
    alternativeIndex: number = 0,
    avoidMotorway: boolean = false
  ): Promise<{ route: RouteResult; steps: RouteStep[] } | null> => {
    const allPoints: [number, number][] = [start];
    if (intermediateWaypoints && intermediateWaypoints.length > 0) {
      allPoints.push(...intermediateWaypoints);
    }
    allPoints.push(end);

    const coordString = allPoints.map((c) => `${c[0]},${c[1]}`).join(";");

    const baseQuery = `overview=full&geometries=geojson&steps=true&alternatives=3`;
    const osrmUrls = [
      ...(avoidMotorway ? [
        `https://router.project-osrm.org/route/v1/driving/${coordString}?${baseQuery}&exclude=motorway`,
        `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coordString}?${baseQuery}&exclude=motorway`,
      ] : []),
      `https://router.project-osrm.org/route/v1/driving/${coordString}?${baseQuery}`,
      `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coordString}?${baseQuery}`,
    ];

    for (const osrmUrl of osrmUrls) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4500);
        let response: Response;
        try {
          response = await fetch(osrmUrl, { signal: controller.signal });
        } finally {
          clearTimeout(timeoutId);
        }
        if (response.ok) {
          const data = await response.json();
          if (data.routes && data.routes.length > 0) {
              const osrmRoute: OSRMRoute = data.routes[Math.min(alternativeIndex, data.routes.length - 1)];
            const steps: RouteStep[] = [];
            if (osrmRoute.legs) {
              for (const leg of osrmRoute.legs) {
                steps.push(...leg.steps);
              }
            }
            return {
              route: {
                coordinates: osrmRoute.geometry.coordinates,
                totalDistanceKm: Math.round(osrmRoute.distance / 1000),
                totalTimeMin: Math.round(osrmRoute.duration / 60),
              },
              steps,
            };
          }
        }
      } catch {
        // try next
      }
    }
    return null;
  }, []);

  /** Haalt in één keer meerdere echt verschillende routes op (snelweg + alternatieven + binnendoor). */
  const fetchRouteAlternatives = useCallback(async (
    start: [number, number],
    end: [number, number],
    via: [number, number][],
  ): Promise<{ route: RouteResult; steps: RouteStep[] }[]> => {
    const coordString = [start, ...via, end].map((c) => `${c[0]},${c[1]}`).join(";");
    const baseQuery = `overview=full&geometries=geojson&steps=true&alternatives=3`;
    const urls = [
      `https://router.project-osrm.org/route/v1/driving/${coordString}?${baseQuery}`,
      `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coordString}?${baseQuery}&exclude=motorway`,
    ];

    const parse = async (url: string): Promise<{ route: RouteResult; steps: RouteStep[] }[]> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6500);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return [];
        const data = await response.json();
        const routes: OSRMRoute[] = Array.isArray(data.routes) ? data.routes : [];
        return routes.filter((item) => Array.isArray(item.geometry?.coordinates) && item.geometry.coordinates.length > 1).map((osrmRoute) => {
          const steps: RouteStep[] = [];
          for (const leg of osrmRoute.legs ?? []) steps.push(...(leg.steps ?? []).filter((step) => step.maneuver?.type !== "depart"));
          return {
            route: {
              coordinates: osrmRoute.geometry.coordinates,
              totalDistanceKm: Math.round(osrmRoute.distance / 1000),
              totalTimeMin: Math.round(osrmRoute.duration / 60),
            },
            steps,
          };
        });
      } catch {
        return [];
      } finally {
        clearTimeout(timeoutId);
      }
    };

    // Gebruik één router als standaard. De tweede publieke router is alleen
    // een fallback wanneer de eerste geen bruikbare route oplevert. Twee
    // publieke routeproviders parallel aanroepen verdubbelt de wachttijd niet,
    // maar wel het netwerkverkeer en de belasting.
    const primary = await parse(urls[0]);
    const results = primary.length > 0 ? primary : await parse(urls[1]);
    // Uniek op afstand zodat we echt andere wegen tonen.
    const unique: { route: RouteResult; steps: RouteStep[] }[] = [];
    for (const candidate of results) {
      if (unique.some((u) => Math.abs(u.route.totalDistanceKm - candidate.route.totalDistanceKm) < 5)) continue;
      unique.push(candidate);
    }
    return unique.sort((a, b) => a.route.totalDistanceKm - b.route.totalDistanceKm).slice(0, 5);
  }, []);

  const batteryCapacityOverride = activeVehicle?.battery_kwh ? activeVehicle.battery_kwh * vehicleBatteryHealth : (selectedCatalogueVehicle?.usableKWh ?? selectedCatalogueVehicle?.batteryKWh ?? (selectedModel === "Handmatig" ? Math.max(40, Math.round(manualRangeKm * 0.18)) : undefined));

  /** Berekent voor één routegeometrie de laadstops op basis van de ingevulde percentages. */
  const buildPlan = useCallback(async (
    base: { route: RouteResult; steps: RouteStep[] },
    fromCoord: { lat: number; lng: number },
    toCoord: { lat: number; lng: number },
    fromBattery: number,
    extraWaypoints: PlannedWaypoint[],
  ): Promise<RoutePlan | null> => {
    // Hoogte en weer zijn voor alle routevarianten vrijwel gelijk: cache op
    // afgeronde begin-/eindpunt zodat 5 varianten niet 5x het netwerk raken.
    const first = base.route.coordinates[0];
    const last = base.route.coordinates[base.route.coordinates.length - 1];
    const cacheKey = first && last
      ? `${first[0].toFixed(1)},${first[1].toFixed(1)}>${last[0].toFixed(1)},${last[1].toFixed(1)}|${tripDate || 'nu'}`
      : null;
    let elevationWeather = cacheKey ? elevationWeatherCacheRef.current.get(cacheKey) : undefined;
    if (!elevationWeather && cacheKey) {
      let pending = elevationWeatherPendingRef.current.get(cacheKey);
      if (!pending) {
        pending = Promise.all([
          fetchElevationProfile(base.route.coordinates),
          fetchRouteWeather(base.route.coordinates, tripDate || undefined),
        ]).then(([profile, weather]) => {
          const value: ElevationWeather = [profile, weather];
          elevationWeatherCacheRef.current.set(cacheKey, value);
          if (elevationWeatherCacheRef.current.size > 12) {
            const oldest = elevationWeatherCacheRef.current.keys().next().value;
            if (oldest) elevationWeatherCacheRef.current.delete(oldest);
          }
          return value;
        }).finally(() => {
          elevationWeatherPendingRef.current.delete(cacheKey);
        });
        elevationWeatherPendingRef.current.set(cacheKey, pending);
      }
      elevationWeather = await pending;
    }
    if (!elevationWeather) {
      elevationWeather = await Promise.all([
        fetchElevationProfile(base.route.coordinates),
        fetchRouteWeather(base.route.coordinates, tripDate || undefined),
      ]);
    }
    const [elevationProfile, fetchedWeather] = elevationWeather;
    // Handmatig: ingevuld weer gaat vóór de verwachting.
    let weather: RouteWeather | null = fetchedWeather;
    if (consumptionMode === 'manual' && (manualWeather.tempC !== undefined || manualWeather.windMs !== undefined || manualWeather.precipitationMm !== undefined)) {
      weather = {
        tempC: manualWeather.tempC ?? fetchedWeather?.tempC ?? 15,
        windMs: manualWeather.windMs ?? fetchedWeather?.windMs ?? 3,
        precipitationMm: manualWeather.precipitationMm ?? fetchedWeather?.precipitationMm ?? 0,
        snowfallCm: fetchedWeather?.snowfallCm ?? 0,
        fogFraction: fetchedWeather?.fogFraction ?? 0,
        temperatureSegments: fetchedWeather?.temperatureSegments,
      };
    }
    const elevation = elevationProfile
      ? elevationConsumptionMultiplier(elevationProfile, base.route.totalDistanceKm)
      : { multiplier: 1, ascentM: 0, descentM: 0 };
    const avgSpeedKmh = base.route.totalTimeMin > 0
      ? (base.route.totalDistanceKm / base.route.totalTimeMin) * 60
      : 90;
    const auto = estimateConsumption({
      modelName: selectedModel,
      batteryKWh: packKWh,
      rangeKm: modelRange,
      avgSpeedKmh,
      weatherMode: consumptionMode === 'manual' ? weatherMode : 'summer',
      timeMode: consumptionMode === 'manual' ? timeMode : 'day',
      trailerReductionPercent: trailerReductionEffective,
      elevationMultiplier: elevation.multiplier,
      weather,
    });
    const vehicleSeasonalConsumption = activeVehicle ? (weatherMode === "winter" ? activeVehicle.winter_consumption_kwh100 : activeVehicle.summer_consumption_kwh100) : null;
    const vehicleExtraPercent = activeVehicle ? (activeVehicle.roof_or_rack_extra_percent ?? 0) + (activeVehicle.winter_tires_extra_percent ?? 0) : 0;
    const baseConsumptionKWh100 = vehicleSeasonalConsumption && vehicleSeasonalConsumption > 0
      ? vehicleSeasonalConsumption
      : consumptionMode === 'manual' && manualConsumptionKWh100 > 0 ? Math.max(9, Math.min(60, manualConsumptionKWh100)) : auto.kWh100;
    const consumptionKWh100 = baseConsumptionKWh100 * (1 + vehicleExtraPercent / 100);
    setAutoConsumption(auto.kWh100);
    setAutoConsumptionState(auto.kWh100);
    setRouteWeather(weather);
    setElevProfile(elevationProfile);
    const folkestone = distanceToRoute(51.096, 1.132, base.route.coordinates) < 15;
    const coquelles = distanceToRoute(50.934, 1.811, base.route.coordinates) < 15;
    // Laden bij een tussenstop: zelf gekozen Supercharger (vergrendeld = nooit vervangen),
    // anders Supercharger binnen 1,5 km, anders lader van derden met echte naam.
    const forcedStops = await Promise.all(extraWaypoints
      .filter((wp) => !wp.corridor && ((wp.locked && wp.chargerId) || wp.chargeMode === 'forced' || wp.charge))
      .map(async (wp) => {
        const picked = wp.chargerId ? superchargers.find((c) => c.id === wp.chargerId) ?? null : null;
        let nearest: Supercharger | null = picked;
        let best = 1.5;
        if (!nearest) {
          for (const c of superchargers) {
            const d = haversineDistance(wp.lat, wp.lng, c.lat, c.lng);
            if (d < best) { best = d; nearest = c; }
          }
        }
        const charger: Supercharger = nearest ?? await lookupThirdPartyCharger(wp.lat, wp.lng, wp.label);
        return {
          routeKm: projectOntoRoute(wp.lat, wp.lng, base.route.coordinates).km,
          chargeTo: Math.max(10, Math.min(100, wp.chargeTo || 80)),
          charger,
          kw: nearest
            ? effectiveChargeSpeedKw(parseMaxSpeed(nearest.stallTypes, nearest.maxSpeedKw, nearest.chargerConfigs), selectedModel, carMaxKwOverride)
            : Math.min(charger.maxSpeedKw ?? 50, carMaxKwOverride ?? 250),
        };
      }));
    const calcOpts = {
      modelRangeKm: modelRange,
      batteryPercent: fromBattery,
      trailerReductionPercent: trailerReductionEffective,
      // Onbekende locaties worden pas als laatste redmiddel geprobeerd.
      // Als een route zonder onbekende status niet haalbaar is, volgt hieronder een risicokeuze.
      chargers: superchargers.filter((charger) =>
        charger.status !== "unknown" ||
        acceptedUnknownIds.includes(charger.id ?? "") ||
        acceptedUnknownIds.includes(charger.name)
      ),
      modelName: selectedModel,
      targetArrivalPercent,
      weatherMode,
      timeMode,
      minChargerSpeedKw,
      maxDetourKm,
      maxDistanceBetweenStopsKm,
      defaultChargePauseMin,
      carMaxKwOverride,
      batteryCapacityKWhOverride: batteryCapacityOverride,
      chargeTargetPercent,
      maxArrivalAtChargerPercent: chargerArrivalTarget,
      preferTrailerFriendly,
      excludeParkingGarage: preferTrailerFriendly,
      avoidLowSpeed,
      avoidParkingFee,
      requireWheelchairAccessible: requireAccessibleStalls,
      favoriteChargerIds,
      allowEurotunnel: folkestone && coquelles,
      consumptionMultiplier: elevation.multiplier,
      consumptionKWh100,
      usableBatteryKWh: packKWh,
      ccsBlocked,
      forcedStops,
      excludeIds: excludedChargerIds,
      preferNearestCharger: strictUnknownExclusionRef.current,
      departureTime: departureDate,
    };
    let result = calculateChargingStopsWithAccessibilityPreference(base.route, calcOpts);
    // Alleen wanneer er zonder onbekende locaties geen haalbare route bestaat,
    // proberen we onbekende Superchargers. De gebruiker krijgt dan eerst een keuze.
    if (result.unreachable) {
      const riskFallbackOpts = { ...calcOpts, chargers: superchargers };
      const riskFallback = calculateChargingStopsWithAccessibilityPreference(base.route, riskFallbackOpts);
      if (!riskFallback.unreachable) {
        Object.assign(calcOpts, riskFallbackOpts);
        result = riskFallback;
      }
    }
    // "Liever niet hier laden": kan het niet anders, dan toch die lader gebruiken.
    if (result.unreachable && excludedChargerIds.length > 0 && !strictUnknownExclusionRef.current) {
      const retry = calculateChargingStopsWithAccessibilityPreference(base.route, { ...calcOpts, excludeIds: [] });
      if (!retry.unreachable) {
        result = retry;
        toast.info("Zonder die Supercharger lukt de route niet — hij wordt toch gebruikt.");
      }
    }

    if (result.unreachable) {
      if (result.suggestions?.length) setRouteAdvice(result.suggestions);
      return null;
    }
    const minus5Result = calculateChargingStopsWithAccessibilityPreference(base.route, { ...calcOpts, batteryPercent: Math.max(0, fromBattery - 5) });
    const plus5Result = calculateChargingStopsWithAccessibilityPreference(base.route, { ...calcOpts, batteryPercent: Math.min(100, fromBattery + 5) });
    const whatIf = {
      minus5: { reachable: !minus5Result.unreachable, arrivalPercent: minus5Result.arrivalPercent, stops: minus5Result.stops.length },
      plus5: { reachable: !plus5Result.unreachable, arrivalPercent: plus5Result.arrivalPercent, stops: plus5Result.stops.length },
    };
    setRouteAdvice([]);
    setEnergySummary({
      usedKWh: Math.round((base.route.totalDistanceKm / 100) * consumptionKWh100),
      chargedKWh: Math.round(result.stops.reduce((sum, stop) => sum + (stop.energyChargedKWh ?? 0), 0)),
      kWh100: consumptionKWh100,
    });
    if (result.stops.length === 0) {
      return { route: base.route, steps: base.steps, stops: [], arrivalPercent: result.arrivalPercent, whatIf };
    }

    const finalWaypoints = [
      // Alleen echte tussenstops worden als routepunt doorgegeven.
      // 'Langs punt'-corridors zijn een voorkeur voor de route, nooit een stop/verplicht waypoint.
      ...extraWaypoints.filter((point) => !point.corridor).map((point) => ({ point: [point.lng, point.lat] as [number, number], km: projectOntoRoute(point.lat, point.lng, base.route.coordinates).km })),
      ...result.stops.filter((stop) => !stop.forced).map((stop) => ({ point: [stop.charger.lng, stop.charger.lat] as [number, number], km: stop.distanceFromStart })),
    ].sort((a, b) => a.km - b.km).map((entry) => entry.point);

    // Bij 'langs punt' behouden we de gekozen corridor-route exact.
    // Een tweede OSRM-aanvraag zonder corridor zou die route anders weer kunnen afsnijden.
    // Lees de corridorpunten hier uit de functie-input; corridors bestaat alleen in computeRoute.
    const hasCorridors = extraWaypoints.some((point) => point.corridor);
    const finalResult = hasCorridors
      ? base
      : await fetchRouteWithInstructions(
          [fromCoord.lng, fromCoord.lat],
          [toCoord.lng, toCoord.lat],
          finalWaypoints,
          0,
        );
    if (!finalResult) {
      return { route: base.route, steps: base.steps, stops: result.stops, arrivalPercent: result.arrivalPercent, whatIf };
    }

    // Uitsluitend op verbruik: bereik = bruikbare kWh / kWh per km.
    const fullRange = Math.max(50, (packKWh / consumptionKWh100) * 100);
    const batteryKWh = batteryCapacityOverride ?? packKWh;
    const kmPerMin = finalResult.route.totalDistanceKm > 0 && finalResult.route.totalTimeMin > 0
      ? finalResult.route.totalDistanceKm / finalResult.route.totalTimeMin
      : 1.5;
    let runningKm = 0;
    let runningBattery = fromBattery;
    let runningMin = 0;
    const fixedStops = result.stops
      .map((stop) => ({
        ...stop,
        distanceFromStart: Math.round(projectOntoRoute(stop.charger.lat, stop.charger.lng, finalResult.route.coordinates).km),
      }))
      .sort((a, b) => a.distanceFromStart - b.distanceFromStart)
      .map((stop, idx) => {
        const legKm = Math.max(0, stop.distanceFromStart - runningKm);
        const batteryBefore = Math.max(0, Math.round(runningBattery - (legKm / fullRange) * 100));
        const rawChargerKw = parseMaxSpeed(stop.charger.stallTypes, stop.charger.maxSpeedKw, stop.charger.chargerConfigs);
        const chargerSpeedKw = effectiveChargeSpeedKw(rawChargerKw, selectedModel, carMaxKwOverride);
        const batteryAfter = stop.forced ? Math.max(batteryBefore, stop.batteryAfter) : stop.batteryAfter;
        const chargeDurationMin = calculateChargeDuration(batteryBefore, batteryAfter, batteryKWh, chargerSpeedKw);
        runningMin += legKm / kmPerMin;
        const etaMinFromStart = Math.round(runningMin);
        runningMin += chargeDurationMin;
        runningKm = stop.distanceFromStart;
        runningBattery = batteryAfter;
        return { ...stop, stopNumber: idx + 1, batteryBefore, batteryAfter, chargeDurationMin, etaMinFromStart };
      });
    const finalLegKm = Math.max(0, finalResult.route.totalDistanceKm - runningKm);
    return {
      route: { ...finalResult.route, trafficDelayMin: base.route.trafficDelayMin, trafficSegments: base.route.trafficSegments },
      steps: finalResult.steps,
      stops: fixedStops,
      arrivalPercent: Math.round(Math.max(0, runningBattery - (finalLegKm / fullRange) * 100)),
      whatIf,
    };
  }, [departureDate, excludedChargerIds, acceptedUnknownIds, ccsBlocked, consumptionMode, manualConsumptionKWh100, tripDate, manualWeather, packKWh, avoidLowSpeed, avoidParkingFee, batteryCapacityOverride, carMaxKwOverride, chargeTargetPercent, chargerArrivalTarget, fetchRouteWithInstructions, minChargerSpeedKw, maxDetourKm, maxDistanceBetweenStopsKm, defaultChargePauseMin, requireAccessibleStalls, modelRange, preferTrailerFriendly, selectedModel, superchargers, targetArrivalPercent, timeMode, trailerReductionEffective, weatherMode, activeVehicle]);

  const applyPlan = useCallback((index: number, plan: RoutePlan) => {
    setSelectedRouteIndex(index);
    setRoute(plan.route);
    setRouteSteps(plan.steps);
    setChargingStops(plan.stops);
    setArrivalPercent(plan.arrivalPercent);
    setShowRouteInputs(false);
  }, []);

  const computeRoute = useCallback(async (
    fromCoord: { lat: number; lng: number },
    toCoord: { lat: number; lng: number },
    fromBattery: number,
    extraWaypoints: PlannedWaypoint[],
  ): Promise<{ ok: boolean; error?: string; plan?: RoutePlan }> => {
    const calculationId = ++calculationIdRef.current;
    const via = extraWaypoints.filter((w) => !w.corridor);
    const corridors = extraWaypoints.filter((w) => w.corridor);
    setCalculationProgress(8);

    const startPoint: [number, number] = [fromCoord.lng, fromCoord.lat];
    const endPoint: [number, number] = [toCoord.lng, toCoord.lat];
    const normalVia = via.map((w) => [w.lng, w.lat] as [number, number]);

    // Zoek bij "langs punt" actief naar routes via wegen in de cirkel.
    // De gegenereerde coördinaten zijn alleen routeringshulp (geen laad-/stoplocaties).
    const corridorRoutePromises: Promise<{ route: RouteResult; steps: RouteStep[] }[]>[] = [];
    if (corridors.length > 0) {
      // Eerst via het middelpunt: de router snapt dit naar een berijdbare weg.
      // Daarna proberen we alternatieve snap-punten binnen de cirkel, zodat
      // een weg vlak langs het punt gekozen kan worden zonder naar de pin te rijden.
      const centerVia: [number, number][] = extraWaypoints.map((point) =>
        [point.lng, point.lat] as [number, number],
      );
      corridorRoutePromises.push(fetchRouteAlternatives(startPoint, endPoint, centerVia));

      const bearings = [0, 45, 90, 135, 180, 225, 270, 315];
      // Eén goed gekozen ring van alternatieve snap-punten is meestal genoeg.
      // Twee ringen verdubbelden het aantal routerverzoeken zonder evenredige winst.
      const offsetFactors = [0.65];
      for (let corridorIndex = 0; corridorIndex < corridors.length; corridorIndex++) {
        const corridor = corridors[corridorIndex];
        for (const factor of offsetFactors) {
          for (const bearing of bearings) {
            const angle = (bearing * Math.PI) / 180;
            const distanceKm = Math.max(0.05, corridor.radiusKm * factor);
            const latOffset = (distanceKm * Math.cos(angle)) / 111.32;
            const lngScale = Math.max(0.2, Math.cos((corridor.lat * Math.PI) / 180));
            const lngOffset = (distanceKm * Math.sin(angle)) / (111.32 * lngScale);
            const shapedVia: [number, number][] = extraWaypoints.map((point) => {
              if (!point.corridor || point !== corridor) return [point.lng, point.lat];
              return [point.lng + lngOffset, point.lat + latOffset];
            });
            corridorRoutePromises.push(fetchRouteAlternatives(startPoint, endPoint, shapedVia));
          }
        }
      }
    }
    const basePromise = corridors.length > 0
      ? Promise.all(corridorRoutePromises).then((groups) => groups.flat())
      : fetchRouteAlternatives(startPoint, endPoint, normalVia);
    // Verkeersroutes bevatten geen corridor-shaping; gebruik ze daarom niet
    // wanneer "langs punt" actief is, anders kunnen ze geldige kandidaten verdringen.
    const trafficPromise = onlineTraffic && !isFutureTrip && corridors.length === 0
      ? fetchTrafficRoutesFn({ data: { origin: fromCoord, destination: toCoord, waypoints: via.map(({ lat, lng }) => ({ lat, lng })), avoidHighways: false, alternatives: true } })
      : Promise.resolve(null);
    const [offlineBases, trafficRoutes] = await Promise.all([basePromise, trafficPromise]);
    if (calculationId !== calculationIdRef.current) return { ok: false, error: "Berekening vervangen." };
    setCalculationProgress(32);
    let bases = offlineBases;
    if (trafficRoutes && trafficRoutes.length > 0) {
      const trafficBases = trafficRoutes.map((trafficRoute) => ({
        route: { coordinates: trafficRoute.coordinates, totalDistanceKm: trafficRoute.totalDistanceKm, totalTimeMin: trafficRoute.totalTimeMin, trafficDelayMin: trafficRoute.delayMin, trafficSegments: trafficRoute.slowSegments },
        steps: [] as RouteStep[],
      }));
      bases = [...trafficBases, ...bases].filter((candidate, index, all) => all.findIndex((other) => Math.abs(other.route.totalDistanceKm - candidate.route.totalDistanceKm) < 3) === index).slice(0, 5);
    }
    if (bases.length === 0) return { ok: false, error: "Kon geen route vinden." };

    // "Langs punt": accepteer uitsluitend routes die werkelijk binnen iedere ingestelde straal lopen.
    if (corridors.length > 0) {
      const withinCorridor = bases.filter((base) =>
        corridors.every((c) => distanceToRoute(c.lat, c.lng, base.route.coordinates) <= c.radiusKm),
      );
      if (withinCorridor.length > 0) {
        // Kies routes die binnen de ingestelde corridor vallen.
        // Een corridor is nadrukkelijk GEEN verplicht route-waypoint.
        bases = withinCorridor;
      } else {
        // Weiger een route buiten de straal; toon nooit alsof de corridor is gehaald.
        const nearestDistance = Math.min(
          ...bases.map((base) => Math.max(
            ...corridors.map((c) => distanceToRoute(c.lat, c.lng, base.route.coordinates)),
          )),
        );
        const limit = Math.min(...corridors.map((c) => c.radiusKm));
        return {
          ok: false,
          error: `De route kon niet binnen ${limit} km van het punt worden gelegd. Dichtstbij gevonden: ${nearestDistance.toFixed(1)} km. Probeer een grotere straal of een punt dichter bij een berijdbare weg.`,
        };
      }
    }
    setCalculationProgress(48);

    // Beperk het volledig doorrekenen tot maximaal twee basisroutes.
    // De routeprovider levert al alternatieven; elke extra variant veroorzaakt
    // opnieuw laadstopberekeningen én een routeaanvraag met laadstops.
    const candidates = [...bases].sort((a, b) => a.route.totalTimeMin - b.route.totalTimeMin).slice(0, 2);
    let completed = 0;
    const plans = (await Promise.all(candidates.map(async (base) => {
      const plan = await buildPlan(base, fromCoord, toCoord, fromBattery, extraWaypoints);
      completed += 1;
      if (calculationId === calculationIdRef.current) setCalculationProgress(48 + Math.round((completed / candidates.length) * 47));
      return plan;
    })))
      .filter((plan): plan is RoutePlan => plan !== null);
    if (calculationId !== calculationIdRef.current) return { ok: false, error: "Berekening vervangen." };

    if (plans.length === 0) return { ok: false, error: "Deze route is niet mogelijk met deze instellingen." };

    // Geef routes zonder onbekende Superchargers altijd voorrang.
    plans.sort((a, b) => {
      const unknownA = a.stops.filter((stop) => stop.charger.status === "unknown").length;
      const unknownB = b.stops.filter((stop) => stop.charger.status === "unknown").length;
      return unknownA - unknownB || a.route.totalDistanceKm - b.route.totalDistanceKm;
    });
    const limited = plans.slice(0, 5);
    setRouteOptions(limited);
    applyPlan(0, limited[0]);
    setCalculationProgress(100);
    return { ok: true, plan: limited[0] };
  }, [applyPlan, buildPlan, fetchRouteAlternatives, fetchTrafficRoutesFn, onlineTraffic, isFutureTrip]);

  const handleCalculate = useCallback(async () => {
    setError("");
    setIsNavigating(false);

    if (!startCoord || !destCoord) {
      setError("Voer start- en bestemmingslocatie in");
      return;
    }
    if (superchargers.length === 0) {
      setError("Superchargers worden nog geladen. Wacht even en probeer opnieuw.");
      return;
    }

    setRiskCharger(null);
    setRiskChargerQueue([]);
    setIsCalculating(true);
    setCalculationProgress(2);
    setLiveBattery(batteryPercent);
    try {
      const res = await computeRoute(startCoord, destCoord, batteryPercent, waypoints);
      strictUnknownExclusionRef.current = false;
      const riskyStops = (res.plan?.stops ?? []).filter((st) =>
        st.charger.status === "unknown" &&
        !(st.charger.id && acceptedUnknownIds.includes(st.charger.id)) &&
        !acceptedUnknownIds.includes(st.charger.name)
      );
      setRiskCharger(riskyStops[0]?.charger ?? null);
      setRiskChargerQueue(riskyStops.slice(1).map((st) => st.charger));
      if (!res.ok) setError(res.error || "Er ging iets mis.");
    } catch {
      setError("Er ging iets mis. Probeer opnieuw.");
    } finally {
      strictUnknownExclusionRef.current = false;
      setIsCalculating(false);
    }
  }, [startCoord, destCoord, superchargers, batteryPercent, waypoints, computeRoute, acceptedUnknownIds]);

  useEffect(() => { handleCalculateRef.current = handleCalculate; }, [handleCalculate]);

  const handleSelectRoute = useCallback((index: number) => {
    const plan = routeOptions[index];
    if (plan) applyPlan(index, plan);
  }, [applyPlan, routeOptions]);


  const handleStartNavigation = useCallback(() => {
    if (!route) return;
    setLiveBattery(batteryPercent);
    setNavStartBattery(batteryPercent);
    setNavStartKm(0);
    setHeadingUp(true);
    setIsNavigating(true);
    setRouteChangedStops(null);
    setRouteChangedAt(null);
    setActiveChargingStop(null);
    chargedStopKeysRef.current = new Set();
  }, [route, batteryPercent]);

  const handleStopNavigation = useCallback(() => {
    setIsNavigating(false);
    setHeadingUp(false);
    setActiveChargingStop(null);
  }, []);

  // Position projected onto route
  const positionProj = useMemo(() => {
    if (!isNavigating || !currentPosition || !route) return null;
    return projectOntoRoute(currentPosition.lat, currentPosition.lng, route.coordinates);
  }, [isNavigating, currentPosition, route]);

  // Estimated current battery based on distance traveled from nav start
  const fullRangeKmActive = useMemo(() => {
    return fullEnergyRangeKm;
  }, [fullEnergyRangeKm]);

  const estimatedBattery = useMemo(() => {
    if (!isNavigating || !positionProj) return null;
    const traveledKm = Math.max(0, positionProj.km - navStartKm);
    const consumed = (traveledKm / fullRangeKmActive) * 100;
    return Math.max(0, navStartBattery - consumed);
  }, [isNavigating, positionProj, navStartKm, navStartBattery, fullRangeKmActive]);

  // Derived values for navigation HUD
  const navInfo = useMemo(() => {
    if (!isNavigating || !currentPosition || !route || !destCoord || !positionProj) return null;
    const proj = positionProj;
    const remainingKm = Math.max(0, route.totalDistanceKm - proj.km);
    const remainingMin = route.totalTimeMin > 0 && route.totalDistanceKm > 0
      ? Math.round((remainingKm / route.totalDistanceKm) * route.totalTimeMin)
      : 0;

    let nextStop: ChargingStop | null = null;
    let nextKmFromStart = Infinity;
    for (const s of chargingStops) {
      if (s.distanceFromStart > proj.km + 0.5 && s.distanceFromStart < nextKmFromStart) {
        nextStop = s;
        nextKmFromStart = s.distanceFromStart;
      }
    }

    let nextCharging = null as null | { stop: ChargingStop; kmFromHere: number; etaMin: number; arrivalPercent: number };
    if (nextStop) {
      const km = Math.max(0, nextStop.distanceFromStart - proj.km);
      const minEta = route.totalDistanceKm > 0
        ? Math.round((km / route.totalDistanceKm) * route.totalTimeMin)
        : 0;
      const consumed = (km / fullRangeKmActive) * 100;
      const arrivalPct = Math.max(0, liveBattery - consumed);
      nextCharging = { stop: nextStop, kmFromHere: km, etaMin: minEta, arrivalPercent: arrivalPct };
    }

    const destConsumed = (remainingKm / fullRangeKmActive) * 100;
    // For destination % we assume charging happens at planned stops
    let destPct = liveBattery;
    let runningKm = proj.km;
    let runningBat = liveBattery;
    for (const s of chargingStops) {
      if (s.distanceFromStart <= proj.km) continue;
      const leg = s.distanceFromStart - runningKm;
      runningBat = Math.max(0, runningBat - (leg / fullRangeKmActive) * 100);
      runningBat = Math.max(runningBat, s.batteryAfter);
      runningKm = s.distanceFromStart;
    }
    const finalLeg = route.totalDistanceKm - runningKm;
    destPct = Math.max(0, runningBat - (finalLeg / fullRangeKmActive) * 100);
    if (chargingStops.length === 0) destPct = Math.max(0, liveBattery - destConsumed);

    // Bepaal de afstand tot een manoeuvre via de echte routegeometrie.
    // OSRM step-afstanden beginnen per leg/step opnieuw; ze optellen vanaf nul
    // geeft daardoor een foutieve afstand (bijv. 1,4 km terwijl de afslag 300 m is).
    let currentStepIdx = 0;
    let distanceToNextManeuver: number | null = null;
    if (routeSteps.length > 0) {
      const traveledKm = proj.km;
      let foundIdx = -1;
      for (let i = 0; i < routeSteps.length; i++) {
        const [maneuverLng, maneuverLat] = routeSteps[i].maneuver.location;
        const maneuverOnRoute = projectOntoRoute(maneuverLat, maneuverLng, route.coordinates);
        const remainingKm = maneuverOnRoute.km - traveledKm;
        if (remainingKm > 0.01) {
          foundIdx = i;
          distanceToNextManeuver = remainingKm * 1000;
          break;
        }
      }
      currentStepIdx = foundIdx >= 0 ? foundIdx : routeSteps.length - 1;
      if (distanceToNextManeuver === null && routeSteps[currentStepIdx]) {
        distanceToNextManeuver = haversineDistance(
          currentPosition.lat,
          currentPosition.lng,
          routeSteps[currentStepIdx].maneuver.location[1],
          routeSteps[currentStepIdx].maneuver.location[0],
        ) * 1000;
      }
    }

    return {
      currentStepIdx,
      distanceToNextManeuver,
      nextCharging,
      destination: { kmFromHere: remainingKm, etaMin: remainingMin, arrivalPercent: destPct },
      offRouteKm: distanceToRoute(currentPosition.lat, currentPosition.lng, route.coordinates),
    };
  }, [isNavigating, currentPosition, route, destCoord, chargingStops, routeSteps, positionProj, liveBattery, fullRangeKmActive]);


  // Auto-reroute when off-route
  const offRouteSinceRef = useRef<number | null>(null);
  const isReroutingRef = useRef(false);
  useEffect(() => {
    if (!navInfo || !isNavigating || !currentPosition || !destCoord) return;
    if (isReroutingRef.current) return;

    if (navInfo.offRouteKm > OFF_ROUTE_KM_THRESHOLD) {
      if (offRouteSinceRef.current === null) offRouteSinceRef.current = Date.now();
      const elapsed = Date.now() - offRouteSinceRef.current;
      if (elapsed > OFF_ROUTE_PERSIST_MS) {
        isReroutingRef.current = true;
        offRouteSinceRef.current = null;
        (async () => {
          await computeRoute(currentPosition, destCoord, liveBattery, []);
          isReroutingRef.current = false;
        })();
      }
    } else {
      offRouteSinceRef.current = null;
    }
  }, [navInfo, isNavigating, currentPosition, destCoord, liveBattery, computeRoute]);

  // Auto-reroute when live battery insufficient for next charging stop, or when we can skip it
  useEffect(() => {
    if (!isNavigating || !navInfo || !currentPosition || !destCoord || !route) return;
    if (isReroutingRef.current) return;
    if (!navInfo.nextCharging) return;
    const fullRange = fullEnergyRangeKm;
    const neededForNext = (navInfo.nextCharging.kmFromHere / fullRange) * 100 + 3;

    // Find the stop AFTER next (within current chargingStops)
    const proj = positionProj;
    let stopAfter: ChargingStop | null = null;
    let foundCurrent = false;
    for (const s of chargingStops) {
      if (proj && s.distanceFromStart > proj.km + 0.5) {
        if (!foundCurrent) { foundCurrent = true; continue; }
        stopAfter = s; break;
      }
    }
    const canSkip = stopAfter && proj
      ? liveBattery >= ((stopAfter.distanceFromStart - proj.km) / fullRange) * 100 + 8
      : false;

    const shouldReroute = liveBattery < neededForNext - 1 || canSkip;
    if (shouldReroute) {
      isReroutingRef.current = true;
      (async () => {
        const res = await computeRoute(currentPosition, destCoord, liveBattery, []);
        setNavStartBattery(liveBattery);
        setNavStartKm(proj?.km ?? 0);
        setRouteChangedAt(Date.now());
        // Toon NIEUWE stops (route zoals hij nu is).
        setRouteChangedStops(res.plan?.stops ?? null);
        setTimeout(() => {
          setRouteChangedStops(null);
          setRouteChangedAt(null);
        }, 12000);
        isReroutingRef.current = false;
      })();
    }
  }, [liveBattery, isNavigating, navInfo, currentPosition, destCoord, route, modelRange, fullEnergyRangeKm, trailerReductionEffective, weatherMode, timeMode, computeRoute, chargingStops, positionProj]);

  useEffect(() => {
    if (!isNavigating || !navInfo?.nextCharging || !currentPosition || !destCoord) return;
    if (isReroutingRef.current) return;
    const eta = new Date(Date.now() + navInfo.nextCharging.etaMin * 60000);
    if (isChargerOperationalAt(navInfo.nextCharging.stop.charger, eta)) return;
    isReroutingRef.current = true;
    setError("Volgende Supercharger is dicht of niet beschikbaar. Route wordt aangepast.");
    (async () => {
      const res = await computeRoute(currentPosition, destCoord, liveBattery, []);
      setRouteChangedAt(Date.now());
      setRouteChangedStops(res.plan?.stops ?? null);
      setTimeout(() => { setRouteChangedStops(null); setRouteChangedAt(null); }, 12000);
      isReroutingRef.current = false;
    })();
  }, [computeRoute, currentPosition, destCoord, isNavigating, liveBattery, navInfo]);

  // Iedere adminwijziging wordt direct in een actieve navigatie verwerkt.
  const lastHandledRevisionRef = useRef(0);
  useEffect(() => {
    if (chargerRevision === 0 || chargerRevision === lastHandledRevisionRef.current) return;
    const rerouteOrigin = isNavigating ? currentPosition : startCoord;
    if (!route || !rerouteOrigin || !destCoord || isReroutingRef.current) return;
    lastHandledRevisionRef.current = chargerRevision;
    isReroutingRef.current = true;
    void (async () => {
      const res = await computeRoute(
        rerouteOrigin,
        destCoord,
        isNavigating ? liveBattery : batteryPercent,
        isNavigating ? [] : waypoints,
      );
      if (res.ok) {
        setRouteChangedAt(Date.now());
        setRouteChangedStops(res.plan?.stops ?? []);
        setTimeout(() => { setRouteChangedStops(null); setRouteChangedAt(null); }, 12000);
      }
      isReroutingRef.current = false;
    })();
  }, [batteryPercent, chargerRevision, computeRoute, currentPosition, destCoord, isNavigating, liveBattery, route, startCoord, waypoints]);

  // Auto-open charging screen when arrived at (or nearly at) next supercharger
  useEffect(() => {
    if (!isNavigating || !navInfo?.nextCharging || activeChargingStop) return;
    if (navInfo.nextCharging.kmFromHere > 0.15) return;
    const stop = navInfo.nextCharging.stop;
    const key = `${stop.charger.id ?? stop.charger.name}-${stop.distanceFromStart}`;
    if (chargedStopKeysRef.current.has(key)) return;
    chargedStopKeysRef.current.add(key);
    setActiveChargingStop(stop);
  }, [isNavigating, navInfo, activeChargingStop]);


  // When user manually updates liveBattery, reset estimate baseline
  useEffect(() => {
    if (!isNavigating || !positionProj) return;
    setNavStartBattery(liveBattery);
    setNavStartKm(positionProj.km);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveBattery]);

  const handleChargerBatteryChange = useCallback(
    (index: number, newBatteryAfter: number) => {
      setChargingStops((prev) =>
        prev.map((stop, i) => {
          if (i !== index) return stop;
          const chargerSpeedKw = effectiveChargeSpeedKw(parseMaxSpeed(stop.charger.stallTypes, stop.charger.maxSpeedKw, stop.charger.chargerConfigs), selectedModel, carMaxKwOverride);
          const batteryKWh = batteryCapacityOverride ?? packKWh;
          const chargeDurationMin = calculateChargeDuration(
            stop.batteryBefore,
            newBatteryAfter,
            batteryKWh,
            chargerSpeedKw
          );
          return { ...stop, batteryAfter: newBatteryAfter, chargeDurationMin };
        })
      );
    },
    [batteryCapacityOverride, carMaxKwOverride, packKWh, selectedModel]
  );

  const handleChargerArrivalChange = useCallback((index: number, arrival: number) => {
    setChargingStops((current) => current.map((stop, stopIndex) => {
      if (stopIndex === index) return { ...stop, batteryBefore: arrival };
      if (stopIndex !== index - 1) return stop;
      const legKm = Math.max(0, current[index].distanceFromStart - stop.distanceFromStart);
      const requiredDeparture = Math.min(100, Math.ceil(arrival + (legKm / fullRangeKmActive) * 100));
      const chargerSpeedKw = effectiveChargeSpeedKw(parseMaxSpeed(stop.charger.stallTypes, stop.charger.maxSpeedKw, stop.charger.chargerConfigs), selectedModel, carMaxKwOverride);
      const batteryKWh = batteryCapacityOverride ?? packKWh;
      return {
        ...stop,
        batteryAfter: requiredDeparture,
        chargeDurationMin: calculateChargeDuration(stop.batteryBefore, requiredDeparture, batteryKWh, chargerSpeedKw),
      };
    }));
  }, [batteryCapacityOverride, carMaxKwOverride, fullRangeKmActive, packKWh, selectedModel]);

  // Na een berekende route blijven vergunning- en bouwlocaties zichtbaar,
  // naast de laadstations die voor de route zijn geselecteerd.
  const mapChargers = useMemo(() => {
    const isDevelopment = (c: Supercharger) => c.status === "construction" || c.status === "permit";
    if (!route || showAllChargers || chargingStops.length === 0) return visibleChargers;
    const used = new Set(chargingStops.map((s) => s.charger.id ?? s.charger.name));
    return visibleChargers.filter((c) => isDevelopment(c) || used.has(c.id ?? c.name));
  }, [route, showAllChargers, chargingStops, visibleChargers]);

  const handleRemoveCharger = useCallback((index: number) => {
    // "Liever niet hier laden": sluit deze lader uit en zoek een andere Supercharger.
    const stop = chargingStops[index];
    if (!stop) return;
    const key = stop.charger.id ?? stop.charger.name;
    recalcAfterExcludeRef.current = true;
    setExcludedChargerIds((prev) => (prev.includes(key) ? prev : [...prev, key]));
  }, [chargingStops]);

  return (
    <div className="h-screen w-screen flex flex-col lg:flex-row bg-slate-900 text-white overflow-hidden">
      {!isNavigating && (
        <div className={`w-full ${route && !showRouteInputs ? "lg:w-[520px] xl:w-[560px]" : "lg:w-[380px] xl:w-[420px]"} flex-shrink-0 bg-slate-900 border-b lg:border-b-0 lg:border-r border-slate-700/50 flex flex-col overflow-hidden`}>
          <div
            className={`${route && !showRouteInputs ? "flex-none" : "flex-1"} overflow-y-auto overscroll-contain`}
            style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
          >
            {route && !showRouteInputs && (
              <div className="px-4 pt-4">
                <button type="button" onClick={() => setShowRouteInputs(true)} className="w-full rounded-xl border border-white/15 bg-slate-800/70 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700/80">
                  Route aanpassen
                </button>
              </div>
            )}
            {(!route || showRouteInputs) && <>
{savedVehicles.length > 0 && <div className="px-4 pt-3"><label className="mb-1 block text-xs font-medium text-slate-400">Voertuigprofiel</label><select value={selectedVehicleId} onChange={(event) => { const id = event.target.value; setSelectedVehicleId(id); const vehicle = savedVehicles.find((item) => item.id === id); if (vehicle) applySavedVehicle(vehicle); }} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"><option value="">Gebruik standaard modelkeuze</option>{savedVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name}{vehicle.is_default ? " · standaard" : ""}</option>)}</select></div>}
<InputPanel
              prefill={prefill}
              onStartChange={setStartCoord}
              onDestChange={setDestCoord}
              onWaypointsChange={setWaypoints}
              superchargers={superchargers}
              vehicleModels={catalogueVehicles}
              onModelChange={(model) => { setSelectedVehicleId(""); setSelectedModel(model); }}
              onBatteryChange={setBatteryPercent}
              onArrivalTargetChange={setTargetArrivalPercent}
              onChargeTargetChange={setChargeTargetPercent}
              onChargerArrivalTargetChange={setChargerArrivalTarget}
              chargerArrivalTarget={chargerArrivalTarget}
              preferTrailerFriendly={preferTrailerFriendly}
              onPreferTrailerFriendlyChange={setPreferTrailerFriendly}

              onTrailerChange={(enabled, pct) => { setTrailerEnabled(enabled); setTrailerReductionPercent(pct); }}
              onWeatherModeChange={setWeatherMode}
              onTimeModeChange={setTimeMode}
              onMinChargerSpeedChange={setMinChargerSpeedKw}
              onAvoidLowSpeedChange={setAvoidLowSpeed}
              onAvoidParkingFeeChange={setAvoidParkingFee}
              onRequireAccessibleStallsChange={setRequireAccessibleStalls}
              onOnlineTrafficChange={setOnlineTraffic}
              onManualRangeChange={setManualRangeKm}
              onManualSpeedChange={setManualSpeedKw}
              manualRangeKm={manualRangeKm}
              manualSpeedKw={manualSpeedKw}

              onCalculate={handleCalculate}
              onStartNavigation={handleStartNavigation}
              selectedModel={selectedModel}
              batteryPercent={batteryPercent}
              arrivalTarget={targetArrivalPercent}
              chargeTarget={chargeTargetPercent}
              trailerEnabled={trailerEnabled}
              trailerReductionPercent={trailerReductionPercent}
              weatherMode={weatherMode}
              timeMode={timeMode}
              minChargerSpeedKw={minChargerSpeedKw}
              avoidLowSpeed={avoidLowSpeed}
              avoidParkingFee={avoidParkingFee}
              requireAccessibleStalls={requireAccessibleStalls}
              onlineTraffic={onlineTraffic}
              consumptionMode={consumptionMode}
              onConsumptionModeChange={setConsumptionMode}
              manualConsumptionKWh100={manualConsumptionKWh100}
              onManualConsumptionChange={setManualConsumptionKWh100}
              autoConsumptionKWh100={autoConsumption}
              routeWeather={routeWeather}
              energySummary={energySummary}
              routeAdvice={routeAdvice}
              modelYear={modelYear}
              tripDate={tripDate}
              onTripDateChange={setTripDate}
              departTime={departTime}
              onDepartTimeChange={setDepartTime}
              manualWeather={manualWeather}
              onManualWeatherChange={setManualWeather}
              onModelYearChange={setModelYear}
              hasCcsAdapter={hasCcsAdapter}
              onCcsAdapterChange={setHasCcsAdapter}
              ccsBlocked={ccsBlocked}
              isCalculating={isCalculating}
              calculationProgress={calculationProgress}
              totalDistanceKm={route?.totalDistanceKm ?? null}
              totalTimeMin={route?.totalTimeMin ?? null}
              chargingStopsCount={chargingStops.length}
              availableRange={availableRange}
              superchargersCount={superchargers.length}
              isLoadingChargers={isLoadingChargers}
              hasRoute={!!route}
              isNavigating={isNavigating}
              lastAvailabilityUpdate={lastAvailabilityUpdate}
              arrivalPercent={arrivalPercent}
            />
            </>}

          </div>


          <div className={`border-t border-slate-700/50 overflow-y-auto ${route && !showRouteInputs ? "flex-1 min-h-0" : "max-h-[40vh]"}`}>
            <ChargingStops
              stops={chargingStops}
              holidayMode={holidayPeriodMode}
              winterSportsMode={winterSportsMode}
              totalDistanceKm={route?.totalDistanceKm ?? null}
              onBatteryChange={handleChargerBatteryChange}
              onRemoveCharger={handleRemoveCharger}
              departure={departureDate}
              route={route}
              packKWh={packKWh}
              consumptionKWh100={energySummary?.kWh100 ?? null}
              arrivalPercent={arrivalPercent}
              weather={routeWeather}
              elevation={elevProfile}
              liveTraffic={onlineTraffic && !isFutureTrip}
              ccsBlocked={ccsBlocked}
              showTrailer={preferTrailerFriendly || trailerReductionEffective > 0}
              modelName={selectedModel}
              carMaxKwOverride={carMaxKwOverride}
              whatIf={routeOptions[selectedRouteIndex]?.whatIf}
              restMin={waypoints.filter((w) => !w.corridor).reduce((sum, w) => {
                if (!w.departAt || !route) return sum + (w.restMin ?? 0);
                const kmAtWaypoint = projectOntoRoute(w.lat, w.lng, route.coordinates).km;
                const travelMinToWaypoint = route.totalDistanceKm > 0 ? (kmAtWaypoint / route.totalDistanceKm) * route.totalTimeMin : 0;
                const estimatedArrivalMs = departureDate.getTime() + (travelMinToWaypoint + sum) * 60000;
                const plannedDepartureMs = new Date(w.departAt).getTime();
                const waitMin = Number.isFinite(plannedDepartureMs) ? Math.max(0, Math.ceil((plannedDepartureMs - estimatedArrivalMs) / 60000)) : 0;
                return sum + waitMin;
              }, 0)}
            />
          </div>
        </div>
      )}

      <div className="flex-1 relative">
        {!isNavigating && (
          <>
          <div className="absolute top-16 left-3 z-[1000]">
            <Button size="sm" variant="outline" className="dark bg-background/90 text-foreground border-border shadow-lg" onClick={() => setShowFavoriteList((v) => !v)}>Favorieten ({favoriteChargerIds.length})</Button>
            {showFavoriteList && (
              <div className="mt-2 w-[min(320px,calc(100vw-24px))] max-h-[45vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-950/95 p-2 shadow-2xl">
                <div className="px-2 py-1 text-xs font-semibold text-slate-300">Mijn favoriete Superchargers</div>
                {favoriteChargers.length === 0 ? <p className="px-2 py-3 text-xs text-slate-400">Nog geen favorieten. Open een Supercharger op de kaart en tik op de ster.</p> : favoriteChargers.map((charger) => (
                  <div key={charger.id} className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-white/5">
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { setFocusCoord({ lat: charger.lat, lng: charger.lng }); setShowFavoriteList(false); }}>
                      <span className="block truncate text-xs font-medium text-white">{charger.name}</span>
                      <span className="block truncate text-[10px] text-slate-400">{[charger.city, charger.country].filter(Boolean).join(", ")}</span>
                    </button>
                    <button type="button" aria-label={charger.name + " uit favorieten verwijderen"} title="Uit favorieten verwijderen" className="rounded-md px-2 py-1 text-lg leading-none text-amber-400 hover:bg-amber-400/10" onClick={() => toggleFavoriteCharger(charger.id!)}>★</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {chargerLoadError && (
            <div role="alert" className="absolute top-20 left-3 z-[1100] max-w-[min(420px,calc(100vw-24px))] rounded-lg border border-red-500/40 bg-slate-950/95 px-3 py-2 text-xs text-red-200 shadow-xl">
              Superchargers laden mislukt: {chargerLoadError}
              <button
                type="button"
                className="ml-2 underline underline-offset-2"
                onClick={() => {
                  setChargerLoadError(null);
                  setIsLoadingChargers(true);
                  refreshSuperchargers()
                    .then((data) => {
                      setSuperchargers(data);
                      setChargerLoadError(data.length ? null : "Er zijn geen Superchargers ontvangen.");
                    })
                    .catch((error) => {
                      console.error("[TeslaNavigation] Superchargers opnieuw laden mislukt:", error);
                      setChargerLoadError(error instanceof Error ? error.message : "Superchargers konden niet worden geladen.");
                    })
                    .finally(() => setIsLoadingChargers(false));
                }}
              >Opnieuw proberen</button>
            </div>
          )}
          <div className="absolute top-3 right-3 z-[1000] flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="dark bg-background/90 text-foreground border-border shadow-lg" onClick={() => setShowDevelopmentChargers((v) => !v)}>
                {showDevelopmentChargers ? "Verberg plannen & bouwlocaties" : "Alles tonen"}
              </Button>
              <Button size="sm" variant="outline" className="dark bg-background/90 text-foreground border-border" onClick={() => setFiltersOpen((v) => !v)} title="Filters">
                <SlidersHorizontal className="size-4" aria-hidden="true" /><span className="hidden sm:inline">Filters</span>
              </Button>
              <Button size="sm" variant="outline" className="dark bg-background/90 text-foreground border-border" onClick={() => setCountryPricesOpen(true)}>Prijs per land</Button>
              <Button size="sm" variant="outline" className="dark bg-background/90 text-foreground border-border" onClick={() => setCompareOpen(true)}>Vergelijk locaties</Button>
              <AccountMenu />
            </div>
            {filtersOpen && (
              <div className="glass-panel w-[min(340px,90vw)] max-h-[70vh] overflow-y-auto rounded-xl p-3">
                <ChargerFilters filters={chargerFilters} onChange={setChargerFilters} chargers={superchargers} visibleCount={visibleChargers.length} />
              </div>
            )}
            {departureAdvice && (
              <div className="glass-panel rounded-xl border border-amber-400/20 px-3 py-2 text-[11px] text-amber-200">
                💡 Tariefadvies: vertrek rond {departureAdvice.departure.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })} voor ongeveer €{departureAdvice.saving.toFixed(2)} lagere laadkosten.
                <span className="ml-1 text-slate-400">{departureAdvice.traffic !== null ? `Verwachte drukte bij laadstops: ${Math.round(departureAdvice.traffic)}%` : "Geen druktegegevens voor deze laadstops"}. Het weer wordt op reisdatum geschat; verkeerssituatie kan veranderen.</span>
              </div>
            )}
            {routeOptions.length > 0 && (
              <div className="glass-panel flex flex-wrap items-center gap-1.5 rounded-xl px-2 py-1.5">
                {cheapestRouteIndex >= 0 && <button onClick={() => handleSelectRoute(cheapestRouteIndex)} className="rounded-lg bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-200 hover:bg-amber-500/25">Kies goedkoopste route</button>}
                {quietestRouteIndex >= 0 && <button onClick={() => handleSelectRoute(quietestRouteIndex)} className="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25">Kies rustigste route</button>}
                {routeOptions.map((plan, i) => (
                  <button
                    key={i}
                    onClick={() => handleSelectRoute(i)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${selectedRouteIndex === i ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}
                  >
                    Route {i + 1} · {plan.route.totalDistanceKm} km · {plan.stops.length} stop{plan.stops.length === 1 ? "" : "s"} · {Math.round(plan.route.totalTimeMin + plan.stops.reduce((sum, stop) => sum + stop.chargeDurationMin, 0))} min totaal
                    {i === fastestRouteIndex && <span className="ml-1 rounded bg-emerald-500/20 px-1 text-emerald-300">Snelst</span>}
                    {i === fewestStopsIndex && <span className="ml-1 rounded bg-blue-500/20 px-1 text-blue-300">Minste stops</span>}
                    {i === cheapestRouteIndex && <span className="ml-1 rounded bg-amber-500/20 px-1 text-amber-300">Goedkoopst · €{routeCosts[i]!.toFixed(2)}</span>}
                    {i === quietestRouteIndex && routeCrowdLevels[i] !== null && <span className="ml-1 rounded bg-emerald-500/20 px-1 text-emerald-300">Rustigst · {Math.round(routeCrowdLevels[i]!)}% drukte</span>}
                    {routeCrowdLevels[i] !== null && i !== quietestRouteIndex && <span className="ml-1 text-slate-400">± {Math.round(routeCrowdLevels[i]!)}% drukte</span>}
                    {routeCosts[i] !== null && i !== cheapestRouteIndex && <span className="ml-1 text-slate-400">± €{routeCosts[i]!.toFixed(2)}</span>}
                    {(plan.route.trafficDelayMin ?? 0) > 0 && (
                      <span className={plan.route.trafficDelayMin! >= 20 ? "text-red-400" : "text-amber-400"}>
                        {" "}· +{plan.route.trafficDelayMin} min file
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}


            {route && chargingStops.length > 0 && (
              <Button size="sm" variant="outline" className="dark bg-background/90 text-foreground border-border" onClick={() => setShowAllChargers((v) => !v)}>
                {showAllChargers ? "Alleen laders van mijn route" : "Toon alle Superchargers"}
              </Button>
            )}
            {route && currentUser && (
              <Button size="sm" onClick={() => setSaveOpen(true)} className="bg-red-600 hover:bg-red-700"><Bookmark className="w-4 h-4 mr-1" />Opslaan</Button>
            )}
          </div>
          </>
        )}
        {error && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-red-500/90 backdrop-blur-sm text-white text-sm font-medium px-4 py-2 rounded-lg shadow-lg max-w-md text-center">
            {error}
          </div>
        )}
     {isCalculating && (
       <div className="absolute inset-0 z-[1200] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm pointer-events-auto">
         <div className="bg-slate-900/95 border border-blue-500/40 rounded-2xl p-6 shadow-2xl flex flex-col items-center gap-4 max-w-sm w-[90%] text-center animate-in fade-in zoom-in-95 duration-200">
           <div className="relative flex items-center justify-center">
             <Loader2 className="w-14 h-14 text-blue-500 animate-spin" />
           </div>
           <div>
             <div className="text-base font-bold text-white">Route & laadstops berekenen…</div>
             <div className="text-xs text-slate-400 mt-1">Energieverbruik, weersomstandigheden en laadtijden worden geoptimaliseerd</div>
           </div>
           <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden mt-1">
             <div className="bg-blue-500 h-full rounded-full transition-all duration-300" style={{ width: `${calculationProgress}%` }} />
           </div>
           <div className="text-xs font-mono text-blue-400 font-semibold">{calculationProgress}%</div>
         </div>
       </div>
     )}

        <EvMap
          startCoord={startCoord}
          destCoord={destCoord}
          superchargers={mapChargers}
          chargingStops={chargingStops}
          departure={departureDate}
          modelName={selectedModel}
          packKWh={packKWh}
          carMaxKwOverride={carMaxKwOverride}
          route={route}
          routeVariants={Object.fromEntries(routeOptions.map((plan, i) => [String(i), plan.route]))}
          selectedRouteType={String(selectedRouteIndex)}
          focusCoord={focusCoord}

          currentPosition={currentPosition}
          isNavigating={isNavigating}
          heading={currentHeading}
          headingUp={headingUp}
          waypoints={waypoints}
          routeChargersOnly={!!route && !showAllChargers && chargingStops.length > 0}
          favoriteChargerIds={favoriteChargerIds}
          mapType={mapType}
          mapZoom={mapZoom}
          markerSize={mapMarkerSize}
          statusColors={statusColors}
          winterSportsMode={winterSportsMode}
          holidayPeriodMode={holidayPeriodMode}
        />

        {route && !isNavigating && (
          <div className="absolute bottom-5 right-4 z-[1200] pointer-events-auto">
            <Button onClick={handleStartNavigation} className="h-14 rounded-2xl bg-blue-600 hover:bg-blue-500 px-6 text-base font-bold shadow-2xl shadow-blue-950/60 ring-1 ring-white/20">
              <NavigationIcon className="mr-2 h-5 w-5" /> Start navigatie
            </Button>
          </div>
        )}

        {isNavigating && (
          <NavigationPanel
            steps={routeSteps}
            currentStepIndex={navInfo?.currentStepIdx ?? 0}
            distanceToNextManeuver={navInfo?.distanceToNextManeuver ?? null}
            nextChargingStop={navInfo?.nextCharging ?? null}
            destination={navInfo?.destination ?? null}
            currentBattery={liveBattery}
            estimatedBattery={estimatedBattery}
            onBatteryChange={setLiveBattery}
            onStop={handleStopNavigation}
            headingUp={headingUp}
            onToggleHeadingUp={() => setHeadingUp((v) => !v)}
            routeChangedStops={routeChangedStops}
            currentSpeedKmh={currentSpeedKmh}
            totalDistanceKm={route?.totalDistanceKm ?? 0}
            hasGps={!!currentPosition}
            gpsError={gpsError}
          />
        )}
        {isNavigating && activeChargingStop && (
          <ChargingScreen
            stop={activeChargingStop}
            modelName={selectedModel}
            batteryCapacityKWhOverride={batteryCapacityOverride}
            carMaxKwOverride={carMaxKwOverride}
            currentBattery={Math.round(estimatedBattery ?? liveBattery)}
            onDone={(finalPct) => {
              setLiveBattery(finalPct);
              setActiveChargingStop(null);
            }}
            onSkip={() => setActiveChargingStop(null)}
          />
        )}
      </div>
      <ChargerCompareDialog open={compareOpen} onOpenChange={setCompareOpen} chargers={superchargers} departure={departureDate} />
      <Dialog open={countryPricesOpen} onOpenChange={setCountryPricesOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto bg-slate-900 border-slate-700 text-white">
          <DialogHeader><DialogTitle>Laadprijzen per land vergelijken</DialogTitle></DialogHeader>
          <p className="text-xs text-slate-400">Gemiddelde geschatte prijs per kWh-equivalent voor laden van 10% naar 80% met {selectedModel}. Zowel kWh-tarieven als tarieven per minuut worden omgerekend met de laadcurve en vermogenslimieten. Tijdstarieven worden beoordeeld op het geplande vertrekmoment.</p>
          {countryPriceStats.length === 0 ? <p className="text-sm text-slate-400">Er zijn nog niet genoeg bekende tarieven om landen te vergelijken.</p> : (
            <div className="space-y-2">
              {countryPriceStats.map((item) => (
                <div key={item.country + item.currency} className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2">
                  <div><div className="text-sm font-medium">{item.country}</div><div className="text-[10px] text-slate-400">{item.count} Superchargers met bekend tarief</div></div>
                  <div className="text-right"><div className="text-sm font-semibold tabular-nums">{new Intl.NumberFormat("nl-NL", { style: "currency", currency: item.currency }).format(item.average)}/kWh</div><div className="text-[10px] text-slate-500">gemiddelde</div></div>
                </div>
              ))}
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setCountryPricesOpen(false)}>Sluiten</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader><DialogTitle>Route opslaan</DialogTitle></DialogHeader>
          <div><Label>Naam</Label><Input value={saveName} onChange={(e) => setSaveName(e.target.value)} className="bg-slate-800 border-slate-700" placeholder="Bijv. Amsterdam → Berlijn" /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>Annuleren</Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={async () => {
              if (!currentUser || !startCoord || !destCoord || !route) return;
              const row = {
                id: crypto.randomUUID(),
                name: saveName || "Naamloze route",
                start_lat: startCoord.lat, start_lng: startCoord.lng,
                end_lat: destCoord.lat, end_lng: destCoord.lng,
                model_name: selectedModel,
                battery_percent: batteryPercent,
                trailer_mode: trailerEnabled,
                trailer_reduction: trailerReductionPercent,
                weather_mode: weatherMode,
                time_mode: timeMode,
                route_type: `route-${selectedRouteIndex + 1}`,
                charger_ids: chargingStops.map(s => s.charger.id).filter((x): x is string => !!x),
                payload: JSON.parse(JSON.stringify({
                  plan: { route, steps: routeSteps, stops: chargingStops, arrivalPercent: arrivalPercent ?? 0 },
                  waypoints,
                  settings: { targetArrivalPercent, chargeTargetPercent, chargerArrivalTarget, modelYear, departureDate: departureDate.toISOString(), packKWh },
                })),
                total_distance_km: route.totalDistanceKm,
                total_time_min: route.totalTimeMin,
              };
              // Altijd eerst lokaal bewaren; cloud is een extra kopie.
              cacheSavedRouteRow({ ...row, start_address: null, end_address: null, created_at: new Date().toISOString() });
              saveLocalRoute({ id: row.id, name: row.name, createdAt: new Date().toISOString() } as LocalRoute);
              let cloudOk = false;
              try {
                await saveMyRoute({ data: row });
                cloudOk = true;
              } catch { cloudOk = false; }
              toast.success(cloudOk ? "Route opgeslagen in Cloudflare D1" : "Route lokaal opgeslagen (Cloudflare D1 niet bereikbaar)");
              setSaveOpen(false); setSaveName("");
            }}>Opslaan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!riskCharger} onOpenChange={(o) => { if (!o) setRiskCharger(null); }}>
        <DialogContent className="max-w-md overflow-hidden rounded-2xl border border-amber-400/25 bg-slate-950 p-0 text-white shadow-2xl">
          <div className="relative h-36 overflow-hidden bg-gradient-to-br from-amber-950 via-slate-900 to-black">
            {riskCharger?.photos?.[0] ? <img src={riskCharger.photos[0]} alt="" className="h-full w-full object-cover opacity-65" /> : <div className="flex h-full items-center justify-center"><AlertTriangle className="size-12 text-amber-400/80" /></div>}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950 to-transparent p-4 pt-8">
              <div className="text-xs font-semibold uppercase tracking-wider text-amber-300">Controleer voor vertrek</div>
              <div className="text-lg font-bold">{riskCharger?.name}</div>
            </div>
          </div>
          <div className="space-y-3 p-4">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="size-5 text-amber-400" />Deze Supercharger is mogelijk noodzakelijk</DialogTitle></DialogHeader>
            <p className="text-sm leading-relaxed text-slate-300">De route is zonder deze Supercharger niet haalbaar met je huidige accu- en route-instellingen. De status is onbekend: het is dus niet bevestigd of je hier kunt laden. Wil je het risico nemen?</p>
            <DialogFooter className="flex-col gap-2 sm:flex-col">
              <Button variant="outline" className="w-full border-slate-700" onClick={() => {
                const key = riskCharger?.id ?? riskCharger?.name;
                setRiskCharger(null);
                setRiskChargerQueue([]);
                if (key) { strictUnknownExclusionRef.current = true; recalcAfterExcludeRef.current = true; setExcludedChargerIds((prev) => (prev.includes(key) ? prev : [...prev, key])); }
              }}>Nee, kies een andere Supercharger</Button>
              <Button className="w-full bg-amber-600 hover:bg-amber-700" onClick={() => {
                const key = riskCharger?.id ?? riskCharger?.name;
                if (key) setAcceptedUnknownIds((prev) => (prev.includes(key) ? prev : [...prev, key]));
                const [next, ...remaining] = riskChargerQueue;
                setRiskChargerQueue(remaining);
                setRiskCharger(next ?? null);
              }}>Ja, ik aanvaard het risico</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
      <ReportChargerDialog target={reportTarget} onClose={() => setReportTarget(null)} />
      <OwnerPanel
        ownerId={ownerPanelId}
        chargers={superchargers}
        onClose={() => setOwnerPanelId(null)}
        onSelectCharger={(charger: Supercharger) => {
          setFocusCoord({ lat: charger.lat, lng: charger.lng });
          setOwnerPanelId(null);
        }}
      />
      <SiteUpdatesPopup />
      <SplashScreen show={isLoadingChargers} />

    </div>

  );
}

