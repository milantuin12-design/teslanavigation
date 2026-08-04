import { useState, useCallback, useEffect } from 'react';
import { MapPin, Battery, Zap, Car, Truck, Navigation, ChevronDown, ChevronUp, Plus, X, Locate, Compass, CloudSnow, Sun, Moon, Gauge } from 'lucide-react';
import { teslaModels, WeatherMode, TimeMode, teslaMaxChargeKw } from '@/lib/tesla-types';

interface Waypoint {
  id: string;
  input: string;
  coord: { lat: number; lng: number } | null;
  error: string;
  /** Corridor = je hoeft er niet heen, maar de route moet er binnen X km langs. */
  corridor: boolean;
  radiusKm: number;
  charge: boolean;
  chargeTo: number;
}

export interface PlannedWaypoint {
  lat: number;
  lng: number;
  label: string;
  corridor: boolean;
  radiusKm: number;
  charge: boolean;
  chargeTo: number;
}

interface InputPanelProps {
  onStartChange: (coord: { lat: number; lng: number } | null) => void;
  onDestChange: (coord: { lat: number; lng: number } | null) => void;
  onWaypointsChange: (waypoints: PlannedWaypoint[]) => void;
  onModelChange: (model: string) => void;
  onBatteryChange: (pct: number) => void;
  onArrivalTargetChange: (pct: number) => void;
  onChargeTargetChange: (pct: number) => void;
  onChargerArrivalTargetChange: (pct: number) => void;
  onTrailerChange: (enabled: boolean, reductionPercent: number) => void;
  onPreferTrailerFriendlyChange: (value: boolean) => void;
  onWeatherModeChange: (mode: WeatherMode) => void;
  onTimeModeChange: (mode: TimeMode) => void;
  onMinChargerSpeedChange: (kw: number) => void;
  onManualRangeChange?: (km: number) => void;
  onManualSpeedChange?: (kw: number) => void;
  onCalculate: () => void;
  onStartNavigation: () => void;
  selectedModel: string;
  batteryPercent: number;
  arrivalTarget: number;
  chargeTarget: number;
  chargerArrivalTarget: number;
  trailerEnabled: boolean;
  trailerReductionPercent: number;
  preferTrailerFriendly: boolean;
  weatherMode: WeatherMode;
  timeMode: TimeMode;
  minChargerSpeedKw: number;
  manualRangeKm?: number;
  manualSpeedKw?: number;
  isCalculating: boolean;
  totalDistanceKm: number | null;
  totalTimeMin: number | null;
  chargingStopsCount: number;
  availableRange: number;
  superchargersCount: number;
  isLoadingChargers: boolean;
  hasRoute: boolean;
  isNavigating: boolean;
  lastAvailabilityUpdate: string | null;
  arrivalPercent: number | null;
}



const coordRegex = /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/;

async function geocodeAddress(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) {
        return {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
        };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function parseCoordinateInput(input: string): { lat: number; lng: number } | null {
  const trimmed = input.trim();
  if (!coordRegex.test(trimmed)) return null;
  const parts = trimmed.split(',');
  const lat = parseFloat(parts[0].trim());
  const lng = parseFloat(parts[1].trim());
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

const MIN_SPEEDS = [0, 100, 125, 150, 200, 250];

export default function InputPanel({
  onStartChange,
  onDestChange,
  onWaypointsChange,
  onModelChange,
  onBatteryChange,
  onArrivalTargetChange,
  onChargeTargetChange,
  onTrailerChange,
  onWeatherModeChange,
  onTimeModeChange,
  onMinChargerSpeedChange,
  onManualRangeChange,
  onManualSpeedChange,
  onCalculate,
  onStartNavigation,
  selectedModel,
  batteryPercent,
  arrivalTarget,
  chargeTarget,
  trailerEnabled,
  trailerReductionPercent,
  weatherMode,
  timeMode,
  minChargerSpeedKw,
  manualRangeKm = 400,
  manualSpeedKw = 250,

  isCalculating,
  totalDistanceKm,
  totalTimeMin,
  chargingStopsCount,
  availableRange,
  superchargersCount,
  isLoadingChargers,
  hasRoute,
  isNavigating,
  lastAvailabilityUpdate,
  arrivalPercent,
}: InputPanelProps) {
  const [startInput, setStartInput] = useState('');
  const [destInput, setDestInput] = useState('');
  const [startError, setStartError] = useState('');
  const [destError, setDestError] = useState('');
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [mobileExpanded, setMobileExpanded] = useState(true);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [editingTrailer, setEditingTrailer] = useState(false);

  const parseOrGeocode = useCallback(async (
    input: string,
    setCoord: (c: { lat: number; lng: number } | null) => void,
    setError: (e: string) => void
  ) => {
    if (!input.trim()) {
      setError('');
      setCoord(null);
      return;
    }

    const coord = parseCoordinateInput(input);
    if (coord) {
      setError('');
      setCoord(coord);
      return;
    }

    setIsGeocoding(true);
    const geoResult = await geocodeAddress(input);
    setIsGeocoding(false);

    if (geoResult) {
      setError('');
      setCoord(geoResult);
    } else {
      setError('Locatie niet gevonden');
      setCoord(null);
    }
  }, []);

  const handleStartBlur = useCallback(() => {
    parseOrGeocode(startInput, onStartChange, setStartError);
  }, [startInput, onStartChange, parseOrGeocode]);

  const handleDestBlur = useCallback(() => {
    parseOrGeocode(destInput, onDestChange, setDestError);
  }, [destInput, onDestChange, parseOrGeocode]);

  const addWaypoint = useCallback((corridor: boolean) => {
    setWaypoints(prev => [...prev, {
      id: crypto.randomUUID(),
      input: '',
      coord: null,
      error: '',
      corridor,
      radiusKm: 20,
      charge: false,
      chargeTo: 80,
    }]);
  }, []);

  const removeWaypoint = useCallback((id: string) => {
    setWaypoints(prev => prev.filter(w => w.id !== id));
  }, []);

  const updateWaypoint = useCallback((id: string, patch: Partial<Waypoint>) => {
    setWaypoints(prev => prev.map(w => w.id === id ? { ...w, ...patch } : w));
  }, []);

  const handleWaypointBlur = useCallback((id: string) => {
    const wp = waypoints.find(w => w.id === id);
    if (!wp) return;

    const updateCoord = (coord: { lat: number; lng: number } | null) => {
      setWaypoints(prev => prev.map(w => w.id === id ? { ...w, coord, error: '' } : w));
    };
    const setError = (error: string) => {
      setWaypoints(prev => prev.map(w => w.id === id ? { ...w, error } : w));
    };

    parseOrGeocode(wp.input, updateCoord, setError);
  }, [waypoints, parseOrGeocode]);


  const handleUseCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setStartError('GPS niet beschikbaar');
      return;
    }
    setIsGeocoding(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coord = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setStartInput(`${coord.lat.toFixed(6)}, ${coord.lng.toFixed(6)}`);
        setStartError('');
        onStartChange(coord);
        setIsGeocoding(false);
      },
      () => {
        setStartError('Kan locatie niet ophalen');
        setIsGeocoding(false);
      },
      { enableHighAccuracy: true }
    );
  }, [onStartChange]);

  useEffect(() => {
    const validWaypoints = waypoints.filter(w => w.coord).map(w => w.coord!);
    onWaypointsChange(validWaypoints);
  }, [waypoints, onWaypointsChange]);

  const formatTime = (min: number) => {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return h > 0 ? `${h}u ${m}m` : `${m}m`;
  };

  return (
    <div className="flex flex-col h-full">
      <button
        onClick={() => setMobileExpanded(!mobileExpanded)}
        className="lg:hidden flex items-center justify-between w-full px-4 py-3 bg-slate-800 text-white font-semibold text-sm border-b border-slate-700"
      >
        <span>Routeplanner</span>
        {mobileExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>

      <div
        className={`flex-1 overflow-y-auto overscroll-contain ${mobileExpanded ? 'block' : 'hidden'} lg:block`}
        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
      >
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Zap size={22} className="text-blue-400" />
            <h1 className="text-lg font-bold text-white tracking-tight">Tesla Routeplanner</h1>
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-400 mb-1.5">
              <MapPin size={13} className="text-blue-400" />
              Start
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={startInput}
                onChange={e => setStartInput(e.target.value)}
                onBlur={handleStartBlur}
                onKeyDown={e => e.key === 'Enter' && handleStartBlur()}
                placeholder="Amsterdam of 52.3676, 4.9041"
                className="flex-1 bg-slate-800/70 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-all"
                disabled={isGeocoding}
              />
              <button
                onClick={handleUseCurrentLocation}
                className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
                title="Gebruik huidige locatie"
              >
                <Locate size={16} className="text-blue-400" />
              </button>
            </div>
            {startError && <p className="text-red-400 text-xs mt-1">{startError}</p>}
          </div>

          {waypoints.map((wp, idx) => (
            <div key={wp.id} className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-2.5 space-y-2">
              <label className="flex items-center justify-between text-xs font-medium text-slate-400">
                <span className="flex items-center gap-1.5">
                  <MapPin size={13} className="text-amber-400" />
                  {wp.corridor ? `Langs punt #${idx + 1}` : `Via #${idx + 1}`}
                </span>
                <button
                  onClick={() => removeWaypoint(wp.id)}
                  className="text-slate-500 hover:text-red-400 transition-colors"
                >
                  <X size={14} />
                </button>
              </label>
              <input
                type="text"
                value={wp.input}
                onChange={e => updateWaypoint(wp.id, { input: e.target.value })}
                onBlur={() => handleWaypointBlur(wp.id)}
                onKeyDown={e => e.key === 'Enter' && handleWaypointBlur(wp.id)}
                placeholder="Antwerpen of 51.2194, 4.4011"
                className="w-full bg-slate-800/70 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/50 transition-all"
                disabled={isGeocoding}
              />
              {wp.error && <p className="text-red-400 text-xs">{wp.error}</p>}

              {wp.corridor ? (
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  Binnen
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={wp.radiusKm}
                    onChange={e => updateWaypoint(wp.id, { radiusKm: Math.max(1, Number(e.target.value) || 20) })}
                    className="w-16 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white"
                  />
                  km van de route
                </label>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={wp.charge}
                      onChange={e => updateWaypoint(wp.id, { charge: e.target.checked })}
                      className="accent-blue-500"
                    />
                    Hier opladen
                  </label>
                  {wp.charge && (
                    <label className="flex items-center gap-1.5 text-xs text-slate-300">
                      tot
                      <input
                        type="number"
                        min={10}
                        max={100}
                        value={wp.chargeTo}
                        onChange={e => updateWaypoint(wp.id, { chargeTo: Math.min(100, Math.max(10, Number(e.target.value) || 80)) })}
                        className="w-16 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white"
                      />
                      %
                    </label>
                  )}
                </div>
              )}
            </div>
          ))}

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => addWaypoint(false)}
              className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border border-dashed border-slate-600 text-slate-400 hover:text-slate-300 hover:border-slate-500 transition-all text-xs"
            >
              <Plus size={14} />
              Via punt
            </button>
            <button
              onClick={() => addWaypoint(true)}
              className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border border-dashed border-slate-600 text-slate-400 hover:text-slate-300 hover:border-slate-500 transition-all text-xs"
            >
              <Plus size={14} />
              Langs punt
            </button>
          </div>


          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-400 mb-1.5">
              <Navigation size={13} className="text-red-400" />
              Bestemming
            </label>
            <input
              type="text"
              value={destInput}
              onChange={e => setDestInput(e.target.value)}
              onBlur={handleDestBlur}
              onKeyDown={e => e.key === 'Enter' && handleDestBlur()}
              placeholder="Berlijn of 52.5200, 13.4050"
              className="w-full bg-slate-800/70 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500/40 focus:border-red-500/50 transition-all"
              disabled={isGeocoding}
            />
            {destError && <p className="text-red-400 text-xs mt-1">{destError}</p>}
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-400 mb-1.5">
              <Car size={13} className="text-slate-300" />
              Model <span className="text-slate-500">(dubbelklik = volgende)</span>
            </label>
            <select
              value={selectedModel}
              onChange={e => onModelChange(e.target.value)}
              onDoubleClick={() => {
                const keys = Object.keys(teslaModels);
                const idx = keys.indexOf(selectedModel);
                const next = keys[(idx + 1) % keys.length];
                onModelChange(next);
              }}
              className="w-full bg-slate-800/70 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-all appearance-none cursor-pointer"
            >
              {Object.keys(teslaModels).map(model => (
                <option key={model} value={model}>
                  {model} ({teslaModels[model]} km)
                </option>
              ))}
              <option value="Handmatig">Handmatig (eigen instellingen)</option>
            </select>
            {selectedModel === 'Handmatig' && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-slate-400">Bereik (km)</label>
                  <input
                    type="number"
                    min={50}
                    max={1500}
                    value={manualRangeKm}
                    onChange={(e) => onManualRangeChange?.(parseInt(e.target.value) || 400)}
                    className="w-full bg-slate-800/70 border border-slate-600/50 rounded-lg px-2 py-1.5 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-400">Laadsnelheid (kW)</label>
                  <input
                    type="number"
                    min={11}
                    max={500}
                    value={manualSpeedKw}
                    onChange={(e) => onManualSpeedChange?.(parseInt(e.target.value) || 250)}
                    className="w-full bg-slate-800/70 border border-slate-600/50 rounded-lg px-2 py-1.5 text-sm text-white"
                  />
                </div>
              </div>
            )}
          </div>


          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-400 mb-1.5">
              <Battery size={13} className="text-green-400" />
              Startbatterij: {batteryPercent}%
            </label>
            <input
              type="range"
              min={1}
              max={100}
              value={batteryPercent}
              onChange={e => onBatteryChange(parseInt(e.target.value))}
              className="w-full h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer accent-green-500"
            />
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-400 mb-1.5">
              <Gauge size={13} className="text-blue-400" />
              Opladen tot: {chargeTarget}% <span className="text-slate-500 text-[10px]">(alleen bij Handmatige route)</span>
            </label>
            <input
              type="range"
              min={50}
              max={100}
              value={chargeTarget}
              onChange={e => onChargeTargetChange(parseInt(e.target.value))}
              className="w-full h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer accent-blue-500"
            />
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-400 mb-1.5">
              <MapPin size={13} className="text-red-400" />
              Aankomst: {arrivalTarget}%
            </label>
            <input
              type="range"
              min={1}
              max={100}
              value={arrivalTarget}
              onChange={e => onArrivalTargetChange(parseInt(e.target.value))}
              className="w-full h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer accent-red-500"
            />
          </div>

          {/* Min charger speed — show orange warning when car can't use 250kW */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-400 mb-1.5">
              <Zap size={13} className="text-blue-400" />
              Minimale laadsnelheid
            </label>
            <div className="grid grid-cols-6 gap-1">
              {MIN_SPEEDS.map(s => {
                const carMax = teslaMaxChargeKw[selectedModel] ?? 250;
                const tooFast = s > carMax;
                const selected = minChargerSpeedKw === s;
                return (
                  <button
                    key={s}
                    onClick={() => onMinChargerSpeedChange(s)}
                    title={tooFast ? `${selectedModel} laadt max ${carMax}kW` : undefined}
                    className={`px-1 py-1.5 rounded text-[11px] font-medium transition-all ${
                      selected
                        ? tooFast
                          ? 'bg-amber-500 text-white'
                          : 'bg-blue-600 text-white'
                        : tooFast
                          ? 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border border-amber-500/30'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {s === 0 ? 'Alle' : `${s}+`}
                  </button>
                );
              })}
            </div>
            {(() => {
              const carMax = teslaMaxChargeKw[selectedModel] ?? 250;
              return carMax < 250 ? (
                <p className="text-[10px] text-amber-400/80 mt-1">
                  ⚠ {selectedModel} laadt max {carMax}kW
                </p>
              ) : null;
            })()}
          </div>

          {/* Weather */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Weer</label>
            <div className="grid grid-cols-3 gap-1">
              {([
                { mode: 'summer' as WeatherMode, label: 'Zomer', icon: Sun },
                { mode: 'winter' as WeatherMode, label: 'Winter (-20%)', icon: CloudSnow },
                { mode: 'fog' as WeatherMode, label: 'Mist (-10%)', icon: CloudSnow },
              ]).map(({ mode, label, icon: Icon }) => (
                <button
                  key={mode}
                  onClick={() => onWeatherModeChange(mode)}
                  className={`flex items-center justify-center gap-1 px-2 py-2 rounded-lg border text-xs font-medium transition-all ${
                    weatherMode === mode
                      ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
                      : 'bg-slate-800/50 border-slate-600/50 text-slate-400 hover:text-slate-300'
                  }`}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Time of day (dag / nacht) — separate from season */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Tijd van de dag</label>
            <div className="grid grid-cols-3 gap-1">
              {([
                { mode: 'day' as TimeMode, label: 'Dag', icon: Sun },
                { mode: 'night' as TimeMode, label: 'Nacht (-5%)', icon: Moon },
              ]).map(({ mode, label, icon: Icon }) => (
                <button
                  key={mode}
                  onClick={() => onTimeModeChange(mode)}
                  className={`flex items-center justify-center gap-1 px-2 py-2 rounded-lg border text-xs font-medium transition-all ${
                    timeMode === mode
                      ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                      : 'bg-slate-800/50 border-slate-600/50 text-slate-400 hover:text-slate-300'
                  }`}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
          </div>


          {/* Trailer with double-click for custom */}
          <div>
            <button
              onClick={() => onTrailerChange(!trailerEnabled, trailerReductionPercent)}
              onDoubleClick={() => setEditingTrailer(true)}
              className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border transition-all text-sm font-medium ${
                trailerEnabled
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                  : 'bg-slate-800/50 border-slate-600/50 text-slate-400 hover:text-slate-300'
              }`}
              title="Klik om aan/uit te zetten, dubbelklik om % aan te passen"
            >
              <Truck size={16} />
              Aanhanger {trailerEnabled ? `(-${trailerReductionPercent}%)` : ''}
            </button>
            {editingTrailer && (
              <div className="mt-2 bg-slate-800 border border-slate-600 rounded-lg p-3 space-y-2">
                <div className="text-xs text-slate-300">Bereikverlies door aanhanger</div>
                <input
                  type="range"
                  min={10}
                  max={70}
                  value={trailerReductionPercent}
                  onChange={(e) => onTrailerChange(trailerEnabled, parseInt(e.target.value))}
                  className="w-full accent-amber-500"
                />
                <div className="flex items-center justify-between">
                  <span className="text-amber-300 font-bold text-sm">-{trailerReductionPercent}%</span>
                  <button
                    onClick={() => setEditingTrailer(false)}
                    className="text-xs px-2 py-1 bg-slate-700 rounded hover:bg-slate-600"
                  >
                    Klaar
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="bg-slate-800/50 rounded-lg px-3 py-2 border border-slate-700/50">
            <div className="text-xs text-slate-400">Actieradius</div>
            <div className="text-lg font-bold text-white">{Math.round(availableRange)} km</div>
          </div>

          <button
            onClick={onCalculate}
            disabled={isCalculating || isGeocoding}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg transition-all text-sm shadow-lg shadow-blue-600/20"
          >
            {isCalculating || isGeocoding ? 'Berekenen...' : 'Route berekenen'}
          </button>

          {hasRoute && (
            <button
              onClick={onStartNavigation}
              className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-semibold transition-all text-sm ${
                isNavigating
                  ? 'bg-green-600 text-white'
                  : 'bg-green-500/20 border border-green-500/40 text-green-400 hover:bg-green-500/30'
              }`}
            >
              <Compass size={18} />
              {isNavigating ? 'Stop navigatie' : 'Start navigatie'}
            </button>
          )}

          {totalDistanceKm !== null && (
            <div className="space-y-2 pt-1">
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-800/50 rounded-lg px-3 py-2 border border-slate-700/50">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">Afstand</div>
                  <div className="text-base font-bold text-white">{totalDistanceKm} km</div>
                </div>
                <div className="bg-slate-800/50 rounded-lg px-3 py-2 border border-slate-700/50">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">Tijd</div>
                  <div className="text-base font-bold text-white">{formatTime(totalTimeMin ?? 0)}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-800/50 rounded-lg px-3 py-2 border border-slate-700/50">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">Oplaadstops</div>
                  <div className="text-base font-bold text-white">{chargingStopsCount}</div>
                </div>
                {arrivalPercent !== null && (
                  <div className="bg-slate-800/50 rounded-lg px-3 py-2 border border-slate-700/50">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider">Aankomst</div>
                    <div className="text-base font-bold text-white">{arrivalPercent}%</div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="text-[10px] text-slate-500 pt-2 border-t border-slate-800">
            {isLoadingChargers ? 'Laden van Superchargers...' : `${superchargersCount} Superchargers geladen`}
            {lastAvailabilityUpdate && (
              <div className="mt-1">Beschikbaarheid: {new Date(lastAvailabilityUpdate).toLocaleTimeString('nl-NL')}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
