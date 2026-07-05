import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import EvMap from "@/components/EvMap";
import InputPanel from "@/components/InputPanel";
import ChargingStops from "@/components/ChargingStops";
import NavigationPanel from "@/components/NavigationPanel";
import { AccountMenu } from "@/components/AccountMenu";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Bookmark } from "lucide-react";
import {
  Supercharger,
  ChargingStop,
  RouteResult,
  WeatherMode,
  TimeMode,
  RouteType,
  teslaModels,
  teslaBatteryKWh,
} from "@/lib/tesla-types";
import {
  getAvailableRange,
  calculateChargingStops,
  calculateChargeDuration,
  parseMaxSpeed,
  effectiveChargeSpeedKw,
  distanceToRoute,
  projectOntoRoute,
  haversineDistance,
  isChargerOperationalAt,
} from "@/lib/tesla-utils";
import { listSuperchargers } from "@/lib/tesla.functions";


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
}

const OFF_ROUTE_KM_THRESHOLD = 0.2; // 200m
const OFF_ROUTE_PERSIST_MS = 8000; // off-route for 8s before rerouting

function Index() {
  const [startCoord, setStartCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [destCoord, setDestCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [waypoints, setWaypoints] = useState<{ lat: number; lng: number }[]>([]);
  const [selectedModel, setSelectedModel] = useState("Model 3 Long Range AWD");
  const [manualRangeKm, setManualRangeKm] = useState(400);
  const [manualSpeedKw, setManualSpeedKw] = useState(250);
  const [batteryPercent, setBatteryPercent] = useState(80);
  const [targetArrivalPercent, setTargetArrivalPercent] = useState(10);
  const [chargeTargetPercent, setChargeTargetPercent] = useState(80);
  const [weatherMode, setWeatherMode] = useState<WeatherMode>("summer");
  const [timeMode, setTimeMode] = useState<TimeMode>("day");
  const [trailerEnabled, setTrailerEnabled] = useState(false);
  const [trailerReductionPercent, setTrailerReductionPercent] = useState(40);
  const [minChargerSpeedKw, setMinChargerSpeedKw] = useState(0);

  const [routeType, setRouteType] = useState<RouteType>("fastest");

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [currentUser, setCurrentUser] = useState<{ id: string } | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUser(data.user ? { id: data.user.id } : null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setCurrentUser(s?.user ? { id: s.user.id } : null));
    return () => sub.subscription.unsubscribe();
  }, []);
  const [superchargers, setSuperchargers] = useState<Supercharger[]>([]);

  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeVariants, setRouteVariants] = useState<Partial<Record<RouteType, RouteResult>>>({});
  const [routePlans, setRoutePlans] = useState<Partial<Record<RouteType, RoutePlan>>>({});
  const [chargingStops, setChargingStops] = useState<ChargingStop[]>([]);
  const [arrivalPercent, setArrivalPercent] = useState<number | null>(null);
  const [routeSteps, setRouteSteps] = useState<RouteStep[]>([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState("");
  const [isLoadingChargers, setIsLoadingChargers] = useState(true);
  const [isNavigating, setIsNavigating] = useState(false);
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [currentHeading, setCurrentHeading] = useState<number | null>(null);
  const [headingUp, setHeadingUp] = useState(false);
  const [liveBattery, setLiveBattery] = useState<number>(80);
  const [lastAvailabilityUpdate, setLastAvailabilityUpdate] = useState<string | null>(null);
  const [navStartBattery, setNavStartBattery] = useState<number>(80);
  const [navStartKm, setNavStartKm] = useState<number>(0);
  const [routeChangedAt, setRouteChangedAt] = useState<number | null>(null);
  const [routeChangedStops, setRouteChangedStops] = useState<ChargingStop[] | null>(null);
  const prevPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const displayedPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const gpsAnimationFrameRef = useRef<number | null>(null);

  const trailerReductionEffective = trailerEnabled ? trailerReductionPercent : 0;

  const modelRange = selectedModel === "Handmatig" ? manualRangeKm : teslaModels[selectedModel];
  const carMaxKwOverride = selectedModel === "Handmatig" ? manualSpeedKw : undefined;
  const availableRange = getAvailableRange(modelRange, batteryPercent, trailerReductionEffective, weatherMode, timeMode);


  useEffect(() => {
    let mounted = true;
    listSuperchargers()
      .then((data) => {
        if (mounted) setSuperchargers(data);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setIsLoadingChargers(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

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
      const { data, error } = await supabase.from("saved_routes").select("*").eq("id", loadId).maybeSingle();
      if (error || !data) { toast.error("Route niet gevonden"); return; }
      setStartCoord({ lat: data.start_lat, lng: data.start_lng });
      setDestCoord({ lat: data.end_lat, lng: data.end_lng });
      setSelectedModel(data.model_name);
      setBatteryPercent(data.battery_percent);
      setTrailerEnabled(data.trailer_mode);
      setTrailerReductionPercent(data.trailer_reduction);
      setWeatherMode(data.weather_mode as WeatherMode);
      setTimeMode(data.time_mode as TimeMode);
      setRouteType(data.route_type as RouteType);
      setPendingLoadCalc(true);
      // Clear query
      window.history.replaceState(null, "", window.location.pathname);
    })();
  }, []);

  // Once superchargers are loaded and a pending load is queued, calculate
  useEffect(() => {
    if (!pendingLoadCalc || superchargers.length === 0 || !startCoord || !destCoord) return;
    setPendingLoadCalc(false);
    handleCalculate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLoadCalc, superchargers.length, startCoord, destCoord]);



  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (isNavigating && navigator.geolocation) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const newPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
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
          const from = displayedPositionRef.current ?? newPos;
          if (gpsAnimationFrameRef.current !== null) cancelAnimationFrame(gpsAnimationFrameRef.current);
          if (!displayedPositionRef.current) {
            displayedPositionRef.current = newPos;
            setCurrentPosition(newPos);
            return;
          }
          const start = performance.now();
          const durationMs = 1100;
          const animate = (now: number) => {
            const t = Math.min(1, (now - start) / durationMs);
            const eased = 1 - Math.pow(1 - t, 3);
            const interpolated = {
              lat: from.lat + (newPos.lat - from.lat) * eased,
              lng: from.lng + (newPos.lng - from.lng) * eased,
            };
            displayedPositionRef.current = interpolated;
            setCurrentPosition(interpolated);
            if (t < 1) gpsAnimationFrameRef.current = requestAnimationFrame(animate);
          };
          gpsAnimationFrameRef.current = requestAnimationFrame(animate);
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
      );
    } else {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setCurrentPosition(null);
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
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        const response = await fetch(osrmUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
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

  const computeRoutePlan = useCallback(async (
    fromCoord: { lat: number; lng: number },
    toCoord: { lat: number; lng: number },
    fromBattery: number,
    extraWaypoints: { lat: number; lng: number }[],
    selectedType: RouteType,
    alternativeIndex: number = 0
  ): Promise<{ ok: boolean; plan?: RoutePlan; error?: string } > => {
    const allWaypoints: [number, number][] = extraWaypoints.map((w) => [w.lng, w.lat]);

    const initialResult = await fetchRouteWithInstructions(
      [fromCoord.lng, fromCoord.lat],
      [toCoord.lng, toCoord.lat],
      allWaypoints.length > 0 ? allWaypoints : undefined,
      alternativeIndex,
      selectedType === "scenic"
    );

    if (!initialResult) return { ok: false, error: "Kon geen route vinden." };
    const { route: initialRoute, steps: initialSteps } = initialResult;

    // Per-variant charging strategy
    let minChargeTarget: number | undefined;
    let maxChargeTarget: number | undefined;
    let chargeTargetForVariant = chargeTargetPercent;
    if (selectedType === "fastest" || selectedType === "trailer") {
      minChargeTarget = 60; maxChargeTarget = 85; chargeTargetForVariant = 60;
    } else if (selectedType === "fewest") {
      minChargeTarget = 80; maxChargeTarget = 100; chargeTargetForVariant = 80;
    } else if (selectedType === "manual") {
      chargeTargetForVariant = chargeTargetPercent;
    }

    const variantOpts = {
      chargeTargetPercent: chargeTargetForVariant,
      minChargeTargetPercent: minChargeTarget,
      maxChargeTargetPercent: maxChargeTarget,
      maxArrivalAtChargerPercent: selectedType === "fewest" ? 5 : 10,
      preferTrailerFriendly: selectedType === "trailer",
    };
    const result = calculateChargingStops(initialRoute, {
      modelRangeKm: modelRange,
      batteryPercent: fromBattery,
      trailerReductionPercent: trailerReductionEffective,
      chargers: superchargers,
      modelName: selectedModel,
      targetArrivalPercent,
      weatherMode,
      timeMode,
      minChargerSpeedKw: selectedType === "scenic" ? 0 : minChargerSpeedKw,
      carMaxKwOverride,
      batteryCapacityKWhOverride: selectedModel === "Handmatig" ? Math.max(40, Math.round(manualRangeKm * 0.18)) : undefined,
      ...variantOpts,
    });


    if (result.unreachable) {
      return { ok: false, error: result.reason || "Deze route is niet mogelijk." };
    }

    let finalPlan: RoutePlan = { route: initialRoute, steps: initialSteps, stops: result.stops, arrivalPercent: result.arrivalPercent };

    if (result.stops.length > 0) {
      const finalWaypoints = [
        ...extraWaypoints.map((point) => ({ point: [point.lng, point.lat] as [number, number], km: projectOntoRoute(point.lat, point.lng, initialRoute.coordinates).km })),
        ...result.stops.map((stop) => ({ point: [stop.charger.lng, stop.charger.lat] as [number, number], km: stop.distanceFromStart })),
      ]
        .sort((a, b) => a.km - b.km)
        .map((entry) => entry.point);
      const finalResult = await fetchRouteWithInstructions(
        [fromCoord.lng, fromCoord.lat],
        [toCoord.lng, toCoord.lat],
        finalWaypoints,
        alternativeIndex,
        selectedType === "scenic"
      );
      if (finalResult) {
        const fullRange = getAvailableRange(modelRange, 100, trailerReductionEffective, weatherMode, timeMode);
        const batteryKWh = selectedModel === "Handmatig" ? Math.max(40, Math.round(manualRangeKm * 0.18)) : (teslaBatteryKWh[selectedModel] || 79);
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
            const chargeDurationMin = calculateChargeDuration(batteryBefore, stop.batteryAfter, batteryKWh, chargerSpeedKw);
            const travelMin = legKm / kmPerMin;
            runningMin += travelMin;
            const etaMinFromStart = Math.round(runningMin);
            runningMin += chargeDurationMin;
            runningKm = stop.distanceFromStart;
            runningBattery = stop.batteryAfter;
            return { ...stop, stopNumber: idx + 1, batteryBefore, chargeDurationMin, etaMinFromStart };
          });
        const finalLegKm = Math.max(0, finalResult.route.totalDistanceKm - runningKm);
        finalPlan = {
          route: finalResult.route,
          steps: finalResult.steps,
          stops: fixedStops,
          arrivalPercent: Math.round(Math.max(0, runningBattery - (finalLegKm / fullRange) * 100)),
        };
      } else {
        finalPlan = { route: initialRoute, steps: initialSteps, stops: result.stops, arrivalPercent: result.arrivalPercent };
      }
    }

    return { ok: true, plan: finalPlan };
  }, [fetchRouteWithInstructions, modelRange, trailerReductionEffective, superchargers, selectedModel, targetArrivalPercent, weatherMode, timeMode, chargeTargetPercent, minChargerSpeedKw, carMaxKwOverride, manualRangeKm]);


  const applyPlan = useCallback((type: RouteType, plan: RoutePlan) => {
    setRouteType(type);
    setRoute(plan.route);
    setRouteSteps(plan.steps);
    setChargingStops(plan.stops);
    setArrivalPercent(plan.arrivalPercent);
  }, []);

  const computeRoute = useCallback(async (
    fromCoord: { lat: number; lng: number },
    toCoord: { lat: number; lng: number },
    fromBattery: number,
    extraWaypoints: { lat: number; lng: number }[]
  ): Promise<{ ok: boolean; error?: string } > => {
    const selected = await computeRoutePlan(fromCoord, toCoord, fromBattery, extraWaypoints, routeType, routeType === "scenic" ? 1 : 0);
    if (!selected.ok || !selected.plan) return { ok: false, error: selected.error };

    const nextPlans: Partial<Record<RouteType, RoutePlan>> = { [routeType]: selected.plan };
    const nextVariants: Partial<Record<RouteType, RouteResult>> = { [routeType]: selected.plan.route };

    if (selected.plan.route.totalDistanceKm >= 1000) {
      const allTypes: RouteType[] = ["fastest", "fewest", "scenic", "trailer", "manual"];
      await Promise.all(allTypes.filter((type) => type !== routeType).map(async (type) => {
        const planned = await computeRoutePlan(fromCoord, toCoord, fromBattery, extraWaypoints, type, type === "scenic" ? 1 : 0);
        if (planned.ok && planned.plan) {
          const plan = planned.plan;
          nextPlans[type] = plan;
          nextVariants[type] = plan.route;
        }
      }));
    }

    setRoutePlans(nextPlans);
    setRouteVariants(nextVariants);
    applyPlan(routeType, selected.plan);
    return { ok: true };
  }, [applyPlan, computeRoutePlan, routeType]);


  const handleCalculate = useCallback(async () => {
    setError("");
    setRoute(null);
    setRouteVariants({});
    setRoutePlans({});
    setChargingStops([]);
    setRouteSteps([]);
    setIsNavigating(false);
    setArrivalPercent(null);

    if (!startCoord || !destCoord) {
      setError("Voer start- en bestemmingslocatie in");
      return;
    }
    if (superchargers.length === 0) {
      setError("Superchargers worden nog geladen. Wacht even en probeer opnieuw.");
      return;
    }

    setIsCalculating(true);
    setLiveBattery(batteryPercent);
    try {
      const res = await computeRoute(startCoord, destCoord, batteryPercent, waypoints);
      if (!res.ok) setError(res.error || "Er ging iets mis.");
    } catch {
      setError("Er ging iets mis. Probeer opnieuw.");
    } finally {
      setIsCalculating(false);
    }
  }, [startCoord, destCoord, superchargers, batteryPercent, waypoints, computeRoute]);

  const handleSelectRouteType = useCallback(async (type: RouteType) => {
    const existing = routePlans[type];
    if (existing) {
      applyPlan(type, existing);
      return;
    }
    if (!startCoord || !destCoord) return;
    setRouteType(type);
    setIsCalculating(true);
    try {
      const planned = await computeRoutePlan(startCoord, destCoord, batteryPercent, waypoints, type, type === "scenic" ? 1 : 0);
      if (planned.ok && planned.plan) {
        const plan = planned.plan;
        setRoutePlans((prev) => ({ ...prev, [type]: plan }));
        setRouteVariants((prev) => ({ ...prev, [type]: plan.route }));
        applyPlan(type, plan);
      } else {
        setError(planned.error || "Deze routevariant lukt niet.");
      }
    } finally {
      setIsCalculating(false);
    }
  }, [applyPlan, batteryPercent, computeRoutePlan, destCoord, routePlans, startCoord, waypoints]);

  const handleStartNavigation = useCallback(() => {
    if (!route) return;
    setLiveBattery(batteryPercent);
    setNavStartBattery(batteryPercent);
    setNavStartKm(0);
    setIsNavigating(true);
    setRouteChangedStops(null);
    setRouteChangedAt(null);
  }, [route, batteryPercent]);

  const handleStopNavigation = useCallback(() => {
    setIsNavigating(false);
    setHeadingUp(false);
  }, []);

  // Position projected onto route
  const positionProj = useMemo(() => {
    if (!isNavigating || !currentPosition || !route) return null;
    return projectOntoRoute(currentPosition.lat, currentPosition.lng, route.coordinates);
  }, [isNavigating, currentPosition, route]);

  // Estimated current battery based on distance traveled from nav start
  const fullRangeKmActive = useMemo(() => {
    return getAvailableRange(modelRange, 100, trailerReductionEffective, weatherMode, timeMode);
  }, [modelRange, trailerReductionEffective, weatherMode, timeMode]);

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

    // currentStepIdx = first maneuver we haven't reached yet, based on
    // cumulative step distance along the route vs. our projected position.
    let currentStepIdx = 0;
    let distanceToNextManeuver: number | null = null;
    if (routeSteps.length > 0) {
      let cumKm = 0;
      let foundIdx = -1;
      const traveledKm = proj.km;
      for (let i = 0; i < routeSteps.length; i++) {
        cumKm += routeSteps[i].distance / 1000;
        if (cumKm > traveledKm + 0.005) {
          foundIdx = i;
          distanceToNextManeuver = Math.max(0, (cumKm - traveledKm) * 1000);
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
    const fullRange = getAvailableRange(modelRange, 100, trailerReductionEffective, weatherMode, timeMode);
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
        const before = chargingStops;
        await computeRoute(currentPosition, destCoord, liveBattery, []);
        // Show "Route aangepast" banner with new stops for 10 s
        setNavStartBattery(liveBattery);
        setNavStartKm(proj?.km ?? 0);
        setRouteChangedAt(Date.now());
        // chargingStops state will update on next render; show what's there now
        setRouteChangedStops(before);
        setTimeout(() => {
          setRouteChangedStops(null);
          setRouteChangedAt(null);
        }, 10000);
        isReroutingRef.current = false;
      })();
    }
  }, [liveBattery, isNavigating, navInfo, currentPosition, destCoord, route, modelRange, trailerReductionEffective, weatherMode, timeMode, computeRoute, chargingStops, positionProj]);

  useEffect(() => {
    if (!isNavigating || !navInfo?.nextCharging || !currentPosition || !destCoord) return;
    if (isReroutingRef.current) return;
    const eta = new Date(Date.now() + navInfo.nextCharging.etaMin * 60000);
    if (isChargerOperationalAt(navInfo.nextCharging.stop.charger, eta)) return;
    isReroutingRef.current = true;
    setError("Volgende Supercharger is dicht of niet beschikbaar. Route wordt aangepast.");
    (async () => {
      await computeRoute(currentPosition, destCoord, liveBattery, []);
      isReroutingRef.current = false;
    })();
  }, [computeRoute, currentPosition, destCoord, isNavigating, liveBattery, navInfo]);

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
          const chargerSpeedKw = effectiveChargeSpeedKw(parseMaxSpeed(stop.charger.stallTypes, stop.charger.maxSpeedKw, stop.charger.chargerConfigs), selectedModel);
          const batteryKWh = teslaBatteryKWh[selectedModel] || 79;
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
    [selectedModel]
  );

  const handleRemoveCharger = useCallback((index: number) => {
    setChargingStops((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col lg:flex-row bg-slate-900 text-white overflow-hidden">
      {!isNavigating && (
        <div className="w-full lg:w-[380px] xl:w-[420px] flex-shrink-0 bg-slate-900 border-b lg:border-b-0 lg:border-r border-slate-700/50 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <InputPanel
              onStartChange={setStartCoord}
              onDestChange={setDestCoord}
              onWaypointsChange={setWaypoints}
              onModelChange={setSelectedModel}
              onBatteryChange={setBatteryPercent}
              onArrivalTargetChange={setTargetArrivalPercent}
              onChargeTargetChange={setChargeTargetPercent}
              onTrailerChange={(enabled, pct) => { setTrailerEnabled(enabled); setTrailerReductionPercent(pct); }}
              onWeatherModeChange={setWeatherMode}
              onTimeModeChange={setTimeMode}
              onMinChargerSpeedChange={setMinChargerSpeedKw}
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
              isCalculating={isCalculating}
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
          </div>

          <div className="border-t border-slate-700/50 max-h-[40vh] overflow-y-auto">
            <ChargingStops
              stops={chargingStops}
              totalDistanceKm={route?.totalDistanceKm ?? null}
              onBatteryChange={handleChargerBatteryChange}
              onRemoveCharger={handleRemoveCharger}
            />
          </div>
        </div>
      )}

      <div className="flex-1 relative">
        {!isNavigating && (
          <div className="absolute top-3 right-3 z-[1000] flex flex-col items-end gap-2">
            <AccountMenu />
            {route && (
              <div className="flex flex-wrap gap-2 bg-slate-800/90 backdrop-blur px-2 py-1 rounded-lg border border-slate-700">
                {(["fastest","fewest","scenic","trailer","manual"] as RouteType[]).map(t => (
                  <button key={t} onClick={() => handleSelectRouteType(t)} className={`px-2 py-1 text-xs rounded ${routeType===t?"bg-red-600 text-white":"text-slate-300 hover:text-white"}`}>
                    {t==="fastest"?"Snelste":t==="fewest"?"Minste stops":t==="scenic"?"Toeristisch":t==="trailer"?"Aanhanger":"Handmatig"}
                  </button>
                ))}
              </div>
            )}

            {route && currentUser && (
              <Button size="sm" onClick={() => setSaveOpen(true)} className="bg-red-600 hover:bg-red-700"><Bookmark className="w-4 h-4 mr-1" />Opslaan</Button>
            )}
          </div>
        )}
        {error && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-red-500/90 backdrop-blur-sm text-white text-sm font-medium px-4 py-2 rounded-lg shadow-lg max-w-md text-center">
            {error}
          </div>
        )}

        <EvMap
          startCoord={startCoord}
          destCoord={destCoord}
          superchargers={superchargers}
          route={route}
          routeVariants={routeVariants}
          selectedRouteType={routeType}
          chargingStops={chargingStops}
          currentPosition={currentPosition}
          isNavigating={isNavigating}
          heading={currentHeading}
          headingUp={headingUp}
        />
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
          />
        )}
      </div>
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader><DialogTitle>Route opslaan</DialogTitle></DialogHeader>
          <div><Label>Naam</Label><Input value={saveName} onChange={(e) => setSaveName(e.target.value)} className="bg-slate-800 border-slate-700" placeholder="Bijv. Amsterdam → Berlijn" /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>Annuleren</Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={async () => {
              if (!currentUser || !startCoord || !destCoord || !route) return;
              const { error } = await supabase.from("saved_routes").insert({
                user_id: currentUser.id,
                name: saveName || "Naamloze route",
                start_lat: startCoord.lat, start_lng: startCoord.lng,
                end_lat: destCoord.lat, end_lng: destCoord.lng,
                model_name: selectedModel,
                battery_percent: batteryPercent,
                trailer_mode: trailerEnabled,
                trailer_reduction: trailerReductionPercent,
                weather_mode: weatherMode,
                time_mode: timeMode,
                route_type: routeType,
                charger_ids: chargingStops.map(s => s.charger.id).filter((x): x is string => !!x),
                total_distance_km: route.totalDistanceKm,
                total_time_min: route.totalTimeMin,
              });
              if (error) toast.error(error.message);
              else { toast.success("Route opgeslagen"); setSaveOpen(false); setSaveName(""); }
            }}>Opslaan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

