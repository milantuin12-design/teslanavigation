import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import EvMap from "@/components/EvMap";
import InputPanel from "@/components/InputPanel";
import ChargingStops from "@/components/ChargingStops";
import NavigationPanel from "@/components/NavigationPanel";
import {
  Supercharger,
  ChargingStop,
  RouteResult,
  WeatherMode,
  TimeMode,
  teslaModels,
  teslaBatteryKWh,
} from "@/lib/tesla-types";
import {
  getAvailableRange,
  calculateChargingStops,
  calculateChargeDuration,
  parseMaxSpeed,
  distanceToRoute,
  projectOntoRoute,
  haversineDistance,
} from "@/lib/tesla-utils";
import { listSuperchargers, refreshAvailability } from "@/lib/tesla.functions";

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

const OFF_ROUTE_KM_THRESHOLD = 0.2; // 200m
const OFF_ROUTE_PERSIST_MS = 8000; // off-route for 8s before rerouting

function Index() {
  const [startCoord, setStartCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [destCoord, setDestCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [waypoints, setWaypoints] = useState<{ lat: number; lng: number }[]>([]);
  const [selectedModel, setSelectedModel] = useState("Model 3 Long Range AWD");
  const [batteryPercent, setBatteryPercent] = useState(80);
  const [targetArrivalPercent, setTargetArrivalPercent] = useState(10);
  const [chargeTargetPercent, setChargeTargetPercent] = useState(80);
  const [weatherMode, setWeatherMode] = useState<WeatherMode>("summer");
  const [timeMode, setTimeMode] = useState<TimeMode>("day");
  const [trailerEnabled, setTrailerEnabled] = useState(false);
  const [trailerReductionPercent, setTrailerReductionPercent] = useState(40);
  const [minChargerSpeedKw, setMinChargerSpeedKw] = useState(0);

  const [superchargers, setSuperchargers] = useState<Supercharger[]>([]);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [chargingStops, setChargingStops] = useState<ChargingStop[]>([]);
  const [arrivalPercent, setArrivalPercent] = useState<number | null>(null);
  const [routeSteps, setRouteSteps] = useState<RouteStep[]>([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState("");
  const [isLoadingChargers, setIsLoadingChargers] = useState(true);
  const [isNavigating, setIsNavigating] = useState(false);
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [liveBattery, setLiveBattery] = useState<number>(80);
  const [lastAvailabilityUpdate, setLastAvailabilityUpdate] = useState<string | null>(null);

  const trailerReductionEffective = trailerEnabled ? trailerReductionPercent : 0;

  const modelRange = teslaModels[selectedModel];
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
    let mounted = true;
    const refresh = async () => {
      try {
        const res = await refreshAvailability({ data: {} });
        if (!mounted) return;
        if (res?.timestamp) setLastAvailabilityUpdate(res.timestamp);
        const data = await listSuperchargers();
        if (mounted) setSuperchargers(data);
      } catch {
        // ignore
      }
    };
    const timeout = setTimeout(refresh, 5000);
    const interval = setInterval(refresh, 60000);
    return () => {
      mounted = false;
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []);

  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (isNavigating && navigator.geolocation) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          setCurrentPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 3000 }
      );
    } else {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setCurrentPosition(null);
    }
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [isNavigating]);

  const fetchRouteWithInstructions = useCallback(async (
    start: [number, number],
    end: [number, number],
    intermediateWaypoints?: [number, number][]
  ): Promise<{ route: RouteResult; steps: RouteStep[] } | null> => {
    const allPoints: [number, number][] = [start];
    if (intermediateWaypoints && intermediateWaypoints.length > 0) {
      allPoints.push(...intermediateWaypoints);
    }
    allPoints.push(end);

    const coordString = allPoints.map((c) => `${c[0]},${c[1]}`).join(";");

    const osrmUrls = [
      `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson&steps=true`,
      `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coordString}?overview=full&geometries=geojson&steps=true`,
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
            const osrmRoute: OSRMRoute = data.routes[0];
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

  const computeRoute = useCallback(async (
    fromCoord: { lat: number; lng: number },
    toCoord: { lat: number; lng: number },
    fromBattery: number,
    extraWaypoints: { lat: number; lng: number }[]
  ): Promise<{ ok: boolean; error?: string } > => {
    const allWaypoints: [number, number][] = extraWaypoints.map((w) => [w.lng, w.lat]);

    const initialResult = await fetchRouteWithInstructions(
      [fromCoord.lng, fromCoord.lat],
      [toCoord.lng, toCoord.lat],
      allWaypoints.length > 0 ? allWaypoints : undefined
    );

    if (!initialResult) return { ok: false, error: "Kon geen route vinden." };
    const { route: initialRoute, steps: initialSteps } = initialResult;
    setRouteSteps(initialSteps);

    const result = calculateChargingStops(initialRoute, {
      modelRangeKm: modelRange,
      batteryPercent: fromBattery,
      trailerReductionPercent: trailerReductionEffective,
      chargers: superchargers,
      modelName: selectedModel,
      targetArrivalPercent,
      weatherMode,
      timeMode,
      chargeTargetPercent,
      minChargerSpeedKw,
    });

    if (result.unreachable) {
      setRoute(initialRoute);
      setChargingStops([]);
      return { ok: false, error: result.reason || "Deze route is niet mogelijk." };
    }

    setChargingStops(result.stops);
    setArrivalPercent(result.arrivalPercent);

    if (result.stops.length > 0) {
      const chargerWaypoints: [number, number][] = result.stops.map(
        (stop) => [stop.charger.lng, stop.charger.lat] as [number, number]
      );
      const finalWaypoints = [...allWaypoints, ...chargerWaypoints];
      const finalResult = await fetchRouteWithInstructions(
        [fromCoord.lng, fromCoord.lat],
        [toCoord.lng, toCoord.lat],
        finalWaypoints
      );
      if (finalResult) {
        setRoute(finalResult.route);
        setRouteSteps(finalResult.steps);
        const updated = calculateChargingStops(finalResult.route, {
          modelRangeKm: modelRange,
          batteryPercent: fromBattery,
          trailerReductionPercent: trailerReductionEffective,
          chargers: superchargers,
          modelName: selectedModel,
          targetArrivalPercent,
          weatherMode,
          chargeTargetPercent,
          minChargerSpeedKw,
        });
        if (!updated.unreachable) {
          setChargingStops(updated.stops);
          setArrivalPercent(updated.arrivalPercent);
        }
      } else {
        setRoute(initialRoute);
      }
    } else {
      setRoute(initialRoute);
    }
    return { ok: true };
  }, [fetchRouteWithInstructions, modelRange, trailerReductionEffective, superchargers, selectedModel, targetArrivalPercent, weatherMode, chargeTargetPercent, minChargerSpeedKw]);

  const handleCalculate = useCallback(async () => {
    setError("");
    setRoute(null);
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

  const handleStartNavigation = useCallback(() => {
    if (!route) return;
    setLiveBattery(batteryPercent);
    setIsNavigating(true);
  }, [route, batteryPercent]);

  const handleStopNavigation = useCallback(() => {
    setIsNavigating(false);
  }, []);

  // Derived values for navigation HUD
  const navInfo = useMemo(() => {
    if (!isNavigating || !currentPosition || !route || !destCoord) return null;
    const proj = projectOntoRoute(currentPosition.lat, currentPosition.lng, route.coordinates);
    const remainingKm = Math.max(0, route.totalDistanceKm - proj.km);
    const remainingMin = route.totalTimeMin > 0 && route.totalDistanceKm > 0
      ? Math.round((remainingKm / route.totalDistanceKm) * route.totalTimeMin)
      : 0;

    // next charging stop ahead
    let nextStop: ChargingStop | null = null;
    let nextKmFromStart = Infinity;
    for (const s of chargingStops) {
      if (s.distanceFromStart > proj.km + 0.5 && s.distanceFromStart < nextKmFromStart) {
        nextStop = s;
        nextKmFromStart = s.distanceFromStart;
      }
    }

    let nextCharging = null as null | { stop: ChargingStop; kmFromHere: number; etaMin: number };
    if (nextStop) {
      const km = Math.max(0, nextStop.distanceFromStart - proj.km);
      const minEta = route.totalDistanceKm > 0
        ? Math.round((km / route.totalDistanceKm) * route.totalTimeMin)
        : 0;
      nextCharging = { stop: nextStop, kmFromHere: km, etaMin: minEta };
    }

    // Current step: pick the step whose maneuver location is closest ahead
    let currentStepIdx = 0;
    let bestStepDist = Infinity;
    for (let i = 0; i < routeSteps.length; i++) {
      const loc = routeSteps[i].maneuver.location; // [lng, lat]
      const d = haversineDistance(currentPosition.lat, currentPosition.lng, loc[1], loc[0]);
      if (d < bestStepDist) {
        bestStepDist = d;
        currentStepIdx = i;
      }
    }

    return {
      currentStepIdx,
      nextCharging,
      destination: { kmFromHere: remainingKm, etaMin: remainingMin },
      offRouteKm: distanceToRoute(currentPosition.lat, currentPosition.lng, route.coordinates),
    };
  }, [isNavigating, currentPosition, route, destCoord, chargingStops, routeSteps]);

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

  // Auto-reroute when live battery insufficient for next charging stop
  useEffect(() => {
    if (!isNavigating || !navInfo || !currentPosition || !destCoord || !route) return;
    if (isReroutingRef.current) return;
    if (!navInfo.nextCharging) return;
    // estimated battery needed to reach next stop with 3% safety
    const fullRange = getAvailableRange(modelRange, 100, trailerReductionEffective, weatherMode);
    const needed = (navInfo.nextCharging.kmFromHere / fullRange) * 100 + 3;
    if (liveBattery < needed - 1) {
      isReroutingRef.current = true;
      (async () => {
        await computeRoute(currentPosition, destCoord, liveBattery, []);
        isReroutingRef.current = false;
      })();
    }
  }, [liveBattery, isNavigating, navInfo, currentPosition, destCoord, route, modelRange, trailerReductionEffective, weatherMode, computeRoute]);

  const handleChargerBatteryChange = useCallback(
    (index: number, newBatteryAfter: number) => {
      setChargingStops((prev) =>
        prev.map((stop, i) => {
          if (i !== index) return stop;
          const chargerSpeedKw = parseMaxSpeed(stop.charger.stallTypes);
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
              onMinChargerSpeedChange={setMinChargerSpeedKw}
              onCalculate={handleCalculate}
              onStartNavigation={handleStartNavigation}
              selectedModel={selectedModel}
              batteryPercent={batteryPercent}
              arrivalTarget={targetArrivalPercent}
              chargeTarget={chargeTargetPercent}
              trailerEnabled={trailerEnabled}
              trailerReductionPercent={trailerReductionPercent}
              weatherMode={weatherMode}
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
          chargingStops={chargingStops}
          currentPosition={currentPosition}
          isNavigating={isNavigating}
        />
        {isNavigating && (
          <NavigationPanel
            steps={routeSteps}
            currentStepIndex={navInfo?.currentStepIdx ?? 0}
            nextChargingStop={navInfo?.nextCharging ?? null}
            destination={navInfo?.destination ?? null}
            currentBattery={liveBattery}
            onBatteryChange={setLiveBattery}
            onStop={handleStopNavigation}
          />
        )}
      </div>
    </div>
  );
}
