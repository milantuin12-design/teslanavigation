import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Supercharger, ChargingStop, RouteResult, ChargerStatus } from '@/lib/tesla-types';
import { getChargerStatus, getStatusColor, parseMaxSpeed } from '@/lib/tesla-utils';

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
  const color = getStatusColor(status);
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

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
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

        const maxSpeed = parseMaxSpeed(charger.stallTypes);

        let popup = `<div style="font-family:system-ui;font-size:13px;min-width:180px;">
          <strong style="font-size:14px;">${charger.name || 'Onbekend'}</strong>`;
        if (charger.totalStalls) {
          popup += `<br/><span style="color:#94a3b8;">${charger.totalStalls} laadpalen</span>`;
        }
        if (maxSpeed) {
          popup += `<br/><span style="color:#60a5fa;font-weight:500;">Max ${maxSpeed} kW</span>`;
        }
        if (charger.stallTypes) {
          popup += `<br/><span style="color:#64748b;font-size:11px;">${charger.stallTypes}</span>`;
        }
        popup += `</div>`;
        marker.bindPopup(popup);
        markersRef.current.addLayer(marker);
      } catch { /* skip bad charger */ }
    });

    chargingStops.forEach((stop, idx) => {
      try {
        const maxSpeed = parseMaxSpeed(stop.charger.stallTypes);
        const marker = L.marker([stop.charger.lat, stop.charger.lng], { icon: chargeStopIcon() });
        let popup = `<div style="font-family:system-ui;font-size:13px;">
          <strong>Opladen #${idx + 1}</strong><br/>
          ${stop.charger.name}<br/>
          Batterij: ${stop.batteryBefore}% &#8594; ${stop.batteryAfter}%`;
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
    if (map.getZoom() < 15) {
      map.setView([currentPosition.lat, currentPosition.lng], targetZoom, { animate: true });
    } else {
      map.panTo([currentPosition.lat, currentPosition.lng], { animate: true, duration: 0.5 });
    }
    setTimeout(() => { try { map.invalidateSize(); } catch { /* */ } }, 300);
  }, [currentPosition, isNavigating]);

  // Heading-up rotation via CSS on the leaflet container.
  const rotation = isNavigating && headingUp && typeof heading === 'number' ? -heading : 0;
  const isRotated = rotation !== 0;

  return (
    <div className="w-full h-full min-h-[400px] relative overflow-hidden" style={{ zIndex: 0 }}>
      <div
        ref={mapContainerRef}
        className="absolute"
        style={{
          transform: `rotate(${rotation}deg)`,
          transformOrigin: 'center center',
          transition: 'transform 0.4s ease-out',
          width: isRotated ? '160%' : '100%',
          height: isRotated ? '160%' : '100%',
          left: isRotated ? '-30%' : '0',
          top: isRotated ? '-30%' : '0',
        }}
      />
    </div>
  );
}
