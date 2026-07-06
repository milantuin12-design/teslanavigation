import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Supercharger, ChargingStop, RouteResult, ChargerStatus } from '@/lib/tesla-types';
import { formatChargerConfig, formatOpeningHoursSummary, getChargerConfigs, getChargerStatus, isChargerOperationalAt, parseMaxSpeed } from '@/lib/tesla-utils';

interface EvMapProps {
  startCoord: { lat: number; lng: number } | null;
  destCoord: { lat: number; lng: number } | null;
  superchargers: Supercharger[];
  route: RouteResult | null;
  routeVariants?: Partial<Record<string, RouteResult>>;
  selectedRouteType?: string;
  chargingStops: ChargingStop[];
  currentPosition?: { lat: number; lng: number } | null;
  isNavigating?: boolean;
  /** Heading in degrees clockwise from north; map rotates so this faces up when headingUp. */
  heading?: number | null;
  headingUp?: boolean;
}

const startIcon = L.divIcon({
  className: 'custom-marker',
  html: `<div style="width:28px;height:28px;border-radius:50%;background:#3b82f6;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:700;">A</div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const destIcon = L.divIcon({
  className: 'custom-marker',
  html: `<div style="width:28px;height:28px;border-radius:50%;background:#ef4444;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:700;">B</div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

function chargerIcon(status: ChargerStatus) {
  let color = '#22c55e'; // groen = open/beschikbaar
  if (status === 'Niet beschikbaar') color = '#94a3b8'; // grijs
  else if (status === 'Gesloten' || status === 'Vol') color = '#ef4444'; // rood
  else if (status === 'Druk') color = '#f59e0b';
  else if (status === 'Onbekend') color = '#64748b';
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="width:22px;height:22px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.25);"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}


function chargeStopIcon() {
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="width:26px;height:26px;border-radius:50%;background:#f59e0b;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700;">&#9889;</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function currentPositionIcon() {
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="width:20px;height:20px;border-radius:50%;background:#3b82f6;border:3px solid #fff;box-shadow:0 0 10px rgba(59,130,246,0.6);animation:pulse 2s infinite;"></div>
<style>@keyframes pulse{0%,100%{transform:scale(1);opacity:1;}50%{transform:scale(1.3);opacity:0.7;}}</style>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] || char);
}

export default function EvMap({ startCoord, destCoord, superchargers, route, routeVariants, selectedRouteType, chargingStops, currentPosition, isNavigating, heading, headingUp }: EvMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<L.LayerGroup>(L.layerGroup());
  const routeRef = useRef<L.Polyline | null>(null);
  const routeVariantsRef = useRef<L.LayerGroup>(L.layerGroup());
  const currentMarkerRef = useRef<L.Marker | null>(null);
  const followPausedUntilRef = useRef(0);
  const lastAutoPanRef = useRef(0);
  const [statusTick, setStatusTick] = useState(0);

  // Refresh charger colours every 60s zodat openingstijden/beschikbaarheid live is.
  useEffect(() => {
    const id = setInterval(() => setStatusTick((v) => v + 1), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [52.3676, 4.9041],
      zoom: 7,
      zoomControl: true,
    });

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics',
      maxZoom: 18,
    }).addTo(map);

    // Country/region borders + place labels overlay
    L.tileLayer('https://services.arcgisonline.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      attribution: '&copy; Esri Boundaries',
      maxZoom: 18,
      pane: 'overlayPane',
      opacity: 0.9,
    }).addTo(map);


    const pauseFollow = () => {
      followPausedUntilRef.current = Date.now() + 8000;
    };
    map.on('dragstart zoomstart', pauseFollow);

    markersRef.current.addTo(map);
    routeVariantsRef.current.addTo(map);
    mapRef.current = map;

    return () => {
      try { map.remove(); } catch { /* ignore */ }
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.clearLayers();

    superchargers.forEach(charger => {
      try {
        const status = getChargerStatus(charger);
        const marker = L.marker([charger.lat, charger.lng], { icon: chargerIcon(status) });
        const maxSpeed = parseMaxSpeed(charger.stallTypes, charger.maxSpeedKw, charger.chargerConfigs);
        const configs = getChargerConfigs(charger);
        const operational = isChargerOperationalAt(charger);
        const statusColor = operational ? '#16a34a' : '#dc2626';
        let popup = `<div style="font-family:system-ui;font-size:13px;min-width:220px;position:relative;color:#0f172a;">
          <div style="position:absolute;right:0;top:0;display:flex;gap:4px;font-size:16px;">
            ${charger.trailerFriendly ? '<span title="Aanhangervriendelijk">🚚</span>' : ''}
            ${charger.inParkingGarage ? '<span title="In parkeergarage">🅿️</span>' : ''}
            ${charger.parkingFee ? '<span title="Parkeergeld verplicht">💶</span>' : ''}
          </div>
          <strong style="font-size:15px;padding-right:60px;display:block;">${escapeHtml(charger.name || 'Onbekend')}</strong>
          <div style="margin-top:4px;color:${statusColor};font-weight:700;">${escapeHtml(status)}</div>`;

        if (configs.length > 0) {
          popup += `<div style="margin-top:6px;display:grid;gap:3px;">${configs.map((config) => `<div>${escapeHtml(formatChargerConfig(config))}</div>`).join('')}</div>`;
        } else if (charger.totalStalls) {
          popup += `<br/><span style="color:#475569;">${charger.totalStalls} laadplekken</span>`;
        }
        popup += `<div style="margin-top:6px;color:#2563eb;font-weight:600;">Max ${maxSpeed} kW</div>`;
        popup += `<div style="margin-top:3px;color:#475569;">${escapeHtml(formatOpeningHoursSummary(charger))}</div>`;
        popup += `</div>`;
        marker.bindPopup(popup);
        markersRef.current.addLayer(marker);
      } catch { /* skip bad charger */ }
    });

    chargingStops.forEach((stop, idx) => {
      try {
        const maxSpeed = parseMaxSpeed(stop.charger.stallTypes, stop.charger.maxSpeedKw, stop.charger.chargerConfigs);
        const configs = getChargerConfigs(stop.charger);
        const marker = L.marker([stop.charger.lat, stop.charger.lng], { icon: chargeStopIcon() });
        let popup = `<div style="font-family:system-ui;font-size:13px;">
          <strong>Opladen #${idx + 1}</strong><br/>
          ${escapeHtml(stop.charger.name)}<br/>
          Batterij: ${stop.batteryBefore}% &#8594; ${stop.batteryAfter}%`;
        if (configs.length > 0) {
          popup += `<br/>${configs.map((config) => escapeHtml(formatChargerConfig(config))).join('<br/>')}`;
        } else if (stop.charger.totalStalls) {
          popup += `<br/><span style="color:#94a3b8;">${stop.charger.totalStalls} laadplekken</span>`;
        }
        if (maxSpeed) {
          popup += `<br/><span style="color:#60a5fa;">Max ${maxSpeed}kW</span>`;
        }
        popup += `</div>`;
        marker.bindPopup(popup);
        markersRef.current.addLayer(marker);
      } catch { /* skip bad stop */ }
    });

    if (startCoord) {
      markersRef.current.addLayer(L.marker([startCoord.lat, startCoord.lng], { icon: startIcon }));
    }
    if (destCoord) {
      markersRef.current.addLayer(L.marker([destCoord.lat, destCoord.lng], { icon: destIcon }));
    }
  }, [startCoord, destCoord, superchargers, chargingStops, statusTick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!currentPosition) {
      if (currentMarkerRef.current) {
        map.removeLayer(currentMarkerRef.current);
        currentMarkerRef.current = null;
      }
      return;
    }

    if (!currentMarkerRef.current) {
      currentMarkerRef.current = L.marker([currentPosition.lat, currentPosition.lng], { icon: currentPositionIcon() }).addTo(map);
    } else {
      currentMarkerRef.current.setLatLng([currentPosition.lat, currentPosition.lng]);
    }
  }, [currentPosition]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    try {
      if (routeRef.current) { map.removeLayer(routeRef.current); routeRef.current = null; }
      routeVariantsRef.current.clearLayers();

      const variantEntries = Object.entries(routeVariants || {}).filter((entry): entry is [string, RouteResult] => !!entry[1]);
      if (variantEntries.length > 1) {
        variantEntries.forEach(([type, variantRoute]) => {
          const latLngs: L.LatLngExpression[] = variantRoute.coordinates.map(([lng, lat]) => [lat, lng] as L.LatLngExpression);
          const selected = type === selectedRouteType;
          const polyline = L.polyline(latLngs, {
            color: selected ? '#3b82f6' : '#94a3b8',
            weight: selected ? 5 : 3,
            opacity: selected ? 0.95 : 0.55,
            smoothFactor: 1,
          });
          routeVariantsRef.current.addLayer(polyline);
          if (selected) routeRef.current = polyline;
        });

        const selectedRoute = routeVariants?.[selectedRouteType || ''] || route;
        if (selectedRoute && selectedRoute.coordinates.length > 0 && !isNavigating) {
          const bounds = L.latLngBounds(selectedRoute.coordinates.map(([lng, lat]) => [lat, lng] as L.LatLngExpression));
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
        }
        return;
      }

      if (route && route.coordinates.length > 0) {
        const latLngs: L.LatLngExpression[] = route.coordinates.map(
          ([lng, lat]) => [lat, lng] as L.LatLngExpression
        );

        const polyline = L.polyline(latLngs, {
          color: '#3b82f6',
          weight: 4,
          opacity: 0.85,
          smoothFactor: 1,
        }).addTo(map);

        routeRef.current = polyline;

        if (latLngs.length > 1 && !isNavigating) {
          map.fitBounds(polyline.getBounds(), { padding: [40, 40], maxZoom: 13 });
        }
      }
    } catch { /* ignore route rendering errors */ }
  }, [route, routeVariants, selectedRouteType, isNavigating]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isNavigating || !currentPosition) return;
    const now = Date.now();
    if (now < followPausedUntilRef.current || now - lastAutoPanRef.current < 300) return;
    lastAutoPanRef.current = now;

    const targetZoom = 16;
    if (map.getZoom() < 14) {
      map.setView([currentPosition.lat, currentPosition.lng], targetZoom, {
        animate: true,
        duration: 1.2,
      });
    } else {
      map.panTo([currentPosition.lat, currentPosition.lng], {
        animate: true,
        duration: 1.2,
        easeLinearity: 0.25,
      });
    }
  }, [currentPosition, isNavigating]);

  return (
    <div className="w-full h-full min-h-[400px] relative overflow-hidden" style={{ zIndex: 0 }}>
      <div
        ref={mapContainerRef}
        className="absolute"
        style={{
          width: '100%',
          height: '100%',
          left: '0',
          top: '0',
        }}
      />
    </div>
  );
}
