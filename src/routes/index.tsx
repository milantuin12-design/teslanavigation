import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useEffect, useRef } from "react";
import EvMap from "@/components/EvMap";
import InputPanel from "@/components/InputPanel";
import ChargingStops from "@/components/ChargingStops";
import NavigationPanel from "@/components/NavigationPanel";
import {
  Supercharger,
  ChargingStop,
  RouteResult,
  teslaModels,
  teslaBatteryKWh,
} from "@/lib/tesla-types";
import {
  getAvailableRange,
  calculateChargingStops,
  calculateChargeDuration,
  parseMaxSpeed,
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

function Index() {
  const [startCoord, setStartCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [destCoord, setDestCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [waypoints, setWaypoints] = useState<{ lat: number; lng: number }[]>([]);
  const [selectedModel, setSelectedModel] = useState("Model 3 Long Range AWD");
  const [batteryPercent, setBatteryPercent] = useState(80);
  const [targetArrivalPercent, setTargetArrivalPercent] = useState(10);
  const [chargeTargetPercent, setChargeTargetPercent] = useState(80);
  const [winterMode, setWinterMode] = useState(false);
  const [trailerMode, setTrailerMode] = useState(false);
  const [superchargers, setSuperchargers] = useState<Supercharger[]>([]);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [chargingStops, setChargingStops] = useState<ChargingStop[]>([]);
  const [arrivalPercent, setArrivalPercent] = useState<number | null>(null);
  const [routeSteps, setRouteSteps] = useState<RouteStep[]>([]);
  const [currentStepIndex] = useState(0);
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState("");
  const [isLoadingChargers, setIsLoadingChargers] = useState(true);
  const [isNavigating, setIsNavigating] = useState(false);
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [lastAvailabilityUpdate, setLastAvailabilityUpdate] = useState<string | null>(null);

  const modelRange = teslaModels[selectedModel];
  const availableRange = getAvailableRange(modelRange, batteryPercent, trailerMode, winterMode);

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
    if (isNavigating && navigator.geolocation && route) {
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
  }, [isNavigating, route]);

  const fetchRouteWithInstructions = async (
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
  };

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

    try {
      const allWaypoints: [number, number][] = waypoints.map((w) => [w.lng, w.lat]);

      const initialResult = await fetchRouteWithInstructions(
        [startCoord.lng, startCoord.lat],
        [destCoord.lng, destCoord.lat],
        allWaypoints.length > 0 ? allWaypoints : undefined
      );

      if (!initialResult) {
        setError("Kon geen route vinden. Controleer de locaties.");
        setIsCalculating(false);
        return;
      }

      const { route: initialRoute, steps: initialSteps } = initialResult;
      setRouteSteps(initialSteps);

      const result = calculateChargingStops(
        initialRoute,
        modelRange,
        batteryPercent,
        trailerMode,
        superchargers,
        selectedModel,
        targetArrivalPercent,
        winterMode,
        chargeTargetPercent
      );

      if (result.unreachable) {
        setError(result.reason || "Deze route is niet mogelijk.");
        setRoute(initialRoute);
        setIsCalculating(false);
        return;
      }

      setChargingStops(result.stops);
      setArrivalPercent(result.arrivalPercent);

      if (result.stops.length > 0) {
        const chargerWaypoints: [number, number][] = result.stops.map(
          (stop) => [stop.charger.lng, stop.charger.lat] as [number, number]
        );

        const finalWaypoints = [...allWaypoints, ...chargerWaypoints];
        const finalResult = await fetchRouteWithInstructions(
          [startCoord.lng, startCoord.lat],
          [destCoord.lng, destCoord.lat],
          finalWaypoints.length > 0 ? finalWaypoints : undefined
        );

        if (finalResult) {
          setRoute(finalResult.route);
          setRouteSteps(finalResult.steps);

          const updatedResult = calculateChargingStops(
            finalResult.route,
            modelRange,
            batteryPercent,
            trailerMode,
            superchargers,
            selectedModel,
            targetArrivalPercent,
            winterMode
          );

          if (!updatedResult.unreachable) {
            setChargingStops(updatedResult.stops);
            setArrivalPercent(updatedResult.arrivalPercent);
          }
        } else {
          setRoute(initialRoute);
        }
      } else {
        setRoute(initialRoute);
      }
    } catch {
      setError("Er ging iets mis. Probeer opnieuw.");
    } finally {
      setIsCalculating(false);
    }
  }, [
    startCoord,
    destCoord,
    waypoints,
    modelRange,
    batteryPercent,
    trailerMode,
    superchargers,
    selectedModel,
    targetArrivalPercent,
    winterMode,
    chargeTargetPercent,
  ]);

  const handleStartNavigation = useCallback(() => {
    if (!route) return;
    setIsNavigating(true);
  }, [route]);

  const handleStopNavigation = useCallback(() => {
    setIsNavigating(false);
  }, []);

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
            onTrailerToggle={setTrailerMode}
            onWinterToggle={setWinterMode}
            onCalculate={handleCalculate}
            onStartNavigation={isNavigating ? handleStopNavigation : handleStartNavigation}
            selectedModel={selectedModel}
            batteryPercent={batteryPercent}
            arrivalTarget={targetArrivalPercent}
            chargeTarget={chargeTargetPercent}
            trailerMode={trailerMode}
            winterMode={winterMode}
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

        {isNavigating && routeSteps.length > 0 && (
          <NavigationPanel steps={routeSteps} currentStepIndex={currentStepIndex} />
        )}

        <div className="border-t border-slate-700/50 max-h-[40vh] overflow-y-auto">
          <ChargingStops
            stops={chargingStops}
            totalDistanceKm={route?.totalDistanceKm ?? null}
            onBatteryChange={handleChargerBatteryChange}
            onRemoveCharger={handleRemoveCharger}
          />
        </div>
      </div>

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
      </div>
    </div>
  );
}
