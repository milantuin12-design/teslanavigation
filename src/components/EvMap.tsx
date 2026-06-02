import { useEffect, useRef, useState } from 'react';
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
}

const getTypicalBusyPattern = (): number[] => [
  15, 12, 10, 8, 8, 10, 15, 25, 40, 55, 70, 80, 75, 65, 60, 55, 60, 75, 85, 80, 70, 55, 40, 25
];

const getCurrentHour = (): number => new Date().getHours();

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

function generateBusyGraph(currentHour: number): string {
  const pattern = getTypicalBusyPattern();
  const hours = [];
  for (let i = 0; i < 24; i++) {
    const hourIndex = (currentHour - 6 + i) % 24;
    const adjustedIndex = hourIndex < 0 ? hourIndex + 24 : hourIndex;
    hours.push({ hour: adjustedIndex, busy: pattern[adjustedIndex] });
  }

  const bars = hours.slice(0, 12).map((h, i) => {
    const isCurrent = h.hour === currentHour;
    const height = Math.round(h.busy * 0.4);
    const color = isCurrent ? '#3b82f6' : h.busy > 70 ? '#ef4444' : h.busy > 40 ? '#f59e0b' : '#22c55e';
    return `<div style="width:6px;height:${height}px;background:${color};border-radius:2px;margin:0 1px;${isCurrent ? 'box-shadow:0 0 4px #3b82f6;' : ''}"></div>`;
  }).join('');

  return `<div style="display:flex;align-items:flex-end;height:45px;padding:4px 0;">${bars}</div>`;
}

function getEstimatedPrice(country?: string): { perKwh: number; currency: string } {
  const prices: Record<string, { perKwh: number; currency: string }> = {
    'Netherlands': { perKwh: 0.52, currency: '€' },
    'Nederland': { perKwh: 0.52, currency: '€' },
    'Belgium': { perKwh: 0.48, currency: '€' },
    'België': { perKwh: 0.48, currency: '€' },
    'Germany': { perKwh: 0.45, currency: '€' },
    'Duitsland': { perKwh: 0.45, currency: '€' },
    'France': { perKwh: 0.42, currency: '€' },
    'Frankrijk': { perKwh: 0.42, currency: '€' },
    'Switzerland': { perKwh: 0.55, currency: 'CHF' },
    'Zwitserland': { perKwh: 0.55, currency: 'CHF' },
    'Austria': { perKwh: 0.43, currency: '€' },
    'Oostenrijk': { perKwh: 0.43, currency: '€' },
    'Denmark': { perKwh: 0.50, currency: 'DKK' },
    'Denemarken': { perKwh: 0.50, currency: 'DKK' },
    'Sweden': { perKwh: 0.48, currency: 'SEK' },
    'Zweden': { perKwh: 0.48, currency: 'SEK' },
    'Norway': { perKwh: 0.40, currency: 'NOK' },
    'Noorwegen': { perKwh: 0.40, currency: 'NOK' },
    'Estonia': { perKwh: 0.35, currency: '€' },
    'Estland': { perKwh: 0.35, currency: '€' },
  };

  return prices[country || 'Netherlands'] || { perKwh: 0.45, currency: '€' };
}

export default function EvMap({ startCoord, destCoord, superchargers, route, chargingStops, currentPosition, isNavigating }: EvMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<L.LayerGroup>(L.layerGroup());
  const routeRef = useRef<L.Polyline | null>(null);
  const [, setUpdateTimer] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setUpdateTimer(n => n + 1);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

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
    const currentHour = getCurrentHour();
    const busyPattern = getTypicalBusyPattern();
    const currentBusyPercent = busyPattern[currentHour];

    superchargers.forEach(charger => {
      try {
        const status = getChargerStatus(charger);
        const marker = L.marker([charger.lat, charger.lng], { icon: chargerIcon(status) });

        const maxSpeed = parseMaxSpeed(charger.stallTypes);
        const price = getEstimatedPrice(charger.country);

        let popup = `<div style="font-family:system-ui;font-size:13px;min-width:200px;">
          <strong style="font-size:14px;">${charger.name || 'Onbekend'}</strong><br/>
          <span style="color:${getStatusColor(status)};font-weight:600;">${status}</span>`;

        if (status !== 'Onbekend' && charger.totalStalls !== undefined && charger.occupiedStalls !== undefined) {
          const avail = charger.totalStalls - charger.occupiedStalls;
          popup += `<br/><span>${avail}/${charger.totalStalls} beschikbaar</span>`;
        }

        if (maxSpeed) {
          popup += `<br/><span style="color:#60a5fa;font-weight:500;">Max ${maxSpeed}kW</span>`;
        }

        popup += `<br/><span style="color:#22c55e;font-weight:500;">~${price.perKwh.toFixed(2)}${price.currency}/kWh</span>`;

        popup += `<hr style="margin:8px 0;border-color:#334155;"/>
          <div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">Drukte vandaag (${currentBusyPercent}% nu)</div>
          ${generateBusyGraph(currentHour)}
          <div style="display:flex;justify-content:space-between;font-size:10px;color:#64748b;margin-top:2px;">
            <span>${((currentHour - 6 + 24) % 24).toString().padStart(2, '0')}:00</span>
            <span>Nu</span>
            <span>${((currentHour + 5) % 24).toString().padStart(2, '0')}:00</span>
          </div>`;

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
      const marker = L.marker([startCoord.lat, startCoord.lng], { icon: startIcon });
      marker.bindPopup(`<div style="font-family:system-ui;font-size:13px;"><strong>Start</strong><br/>${startCoord.lat.toFixed(4)}, ${startCoord.lng.toFixed(4)}</div>`);
      markersRef.current.addLayer(marker);
    }

    if (destCoord) {
      const marker = L.marker([destCoord.lat, destCoord.lng], { icon: destIcon });
      marker.bindPopup(`<div style="font-family:system-ui;font-size:13px;"><strong>Bestemming</strong><br/>${destCoord.lat.toFixed(4)}, ${destCoord.lng.toFixed(4)}</div>`);
      markersRef.current.addLayer(marker);
    }

    if (currentPosition) {
      const marker = L.marker([currentPosition.lat, currentPosition.lng], { icon: currentPositionIcon() });
      marker.bindPopup(`<div style="font-family:system-ui;font-size:13px;"><strong>Jouw locatie</strong></div>`);
      markersRef.current.addLayer(marker);
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

        if (latLngs.length > 1) {
          map.fitBounds(polyline.getBounds(), { padding: [40, 40], maxZoom: 13 });
        }
      }
    } catch { /* ignore route rendering errors */ }
  }, [route]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isNavigating || !currentPosition) return;

    map.panTo([currentPosition.lat, currentPosition.lng], { animate: true, duration: 0.5 });
  }, [currentPosition, isNavigating]);

  return (
    <div
      ref={mapContainerRef}
      className="w-full h-full min-h-[400px] rounded-xl overflow-hidden"
      style={{ zIndex: 0 }}
    />
  );
}
