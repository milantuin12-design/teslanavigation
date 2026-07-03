import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Supercharger, ChargingStop, RouteResult, ChargerStatus } from '@/lib/tesla-types';
import { formatChargerConfig, getChargerConfigs, getChargerStatus, isChargerOperationalAt, parseMaxSpeed } from '@/lib/tesla-utils';

interface EvMapProps {
  startCoord: { lat: number; lng: number } | null;
  destCoord: { lat: number; lng: number } | null;
  superchargers: Supercharger[];
  route: RouteResult | null;
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
  const color = status === 'Niet beschikbaar' || status === 'Vol' ? '#ef4444' : status === 'Druk' ? '#f59e0b' : '#22c55e';
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

function formatOpeningHours(charger: Supercharger): string {
  if (!charger.openingTime || !charger.closingTime) return '24/7 open';
  return `Open ${charger.openingTime.slice(0, 5)}–${charger.closingTime.slice(0, 5)}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] || char);
}

export default function EvMap({ startCoord, destCoord, superchargers, route, chargingStops, currentPosition, isNavigating, heading, headingUp }: EvMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<L.LayerGroup>(L.layerGroup());
  const routeRef = useRef<L.Polyline | null>(null);

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

    markersRef.current.addTo(map);
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
        let popup = `<div style="font-family:system-ui;font-size:13px;min-width:220px;position:relative;color:#0f172a;">
          ${charger.trailerFriendly ? '<div style="position:absolute;right:0;top:0;font-size:18px;" title="Aanhangervriendelijk">🚚</div>' : ''}
          <strong style="font-size:15px;padding-right:24px;display:block;">${escapeHtml(charger.name || 'Onbekend')}</strong>
          <div style="margin-top:4px;color:${operational ? '#16a34a' : '#dc2626'};font-weight:700;">${operational ? 'Beschikbaar' : 'Niet beschikbaar'}</div>`;
        if (configs.length > 0) {
          popup += `<div style="margin-top:6px;display:grid;gap:3px;">${configs.map((config) => `<div>${escapeHtml(formatChargerConfig(config))}</div>`).join('')}</div>`;
        } else if (charger.totalStalls) {
          popup += `<br/><span style="color:#475569;">${charger.totalStalls} laadplekken</span>`;
        }
        popup += `<div style="margin-top:6px;color:#2563eb;font-weight:600;">Max ${maxSpeed} kW</div>`;
        popup += `<div style="margin-top:3px;color:#475569;">${formatOpeningHours(charger)}</div>`;
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
    if (currentPosition) {
      markersRef.current.addLayer(L.marker([currentPosition.lat, currentPosition.lng], { icon: currentPositionIcon() }));
    }
  }, [startCoord, destCoord, superchargers, chargingStops, currentPosition]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    try {
      if (routeRef.current) {
        map.removeLayer(routeRef.current);
        routeRef.current = null;
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
  }, [route, isNavigating]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isNavigating || !currentPosition) return;

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
