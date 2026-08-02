import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Supercharger, ChargingStop, RouteResult, ChargerStatus, constructionStepLabels, ConstructionStep, ChargerConfig } from '@/lib/tesla-types';
import { describeChargerStatus, formatChargerConfig, formatOpeningHoursSummary, getChargerConfigs, getChargerStatus, getOpenStalls, getTotalStallsFromConfigs, isChargerUsable, normalizeChargerConfigs, parseMaxSpeed } from '@/lib/tesla-utils';

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
  /** Toon ook niet-gepubliceerde (concept) laders. Standaard verborgen. */
  showDrafts?: boolean;
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

function chargerIcon(charger: Supercharger, status: ChargerStatus) {
  // Kleurlogica ongewijzigd: groen = open, rood = gesloten (openingstijden/sluiting), grijs = niet beschikbaar.
  let color = '#22c55e'; // groen = open/beschikbaar
  if (status === 'Niet beschikbaar') color = '#94a3b8'; // grijs
  else if (status === 'In aanbouw') color = '#f59e0b'; // oranje voor in aanbouw
  else if (status === 'Werkzaamheden' || status === 'Druk') color = '#f59e0b'; // oranje
  else if (status === 'Onbekend') color = '#64748b';
  else if (status !== 'Beschikbaar') color = '#ef4444'; // rood: gesloten varianten

  const isConstruction = status === 'In aanbouw';
  const hasWorks = charger.status === 'works' || charger.status === 'works_closed';
  const isLowSpeed = !!charger.lowSpeed;

  const stalls = getTotalStallsFromConfigs(charger.chargerConfigs) ?? charger.totalStalls;
  const label = stalls ? String(stalls) : '';

  const ringStyle = isConstruction
    ? 'border:2px dashed #fff;outline:2px dashed rgba(245,158,11,0.9);outline-offset:2px;'
    : 'border:2px solid #fff;';

  const wrenchGlyph = isConstruction
    ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);" xmlns="http://www.w3.org/2000/svg"><path d="M21.71 5.29a1 1 0 0 0-1.41 0l-2.13 2.12-1.58-1.58 2.12-2.13a1 1 0 0 0 0-1.41 5.5 5.5 0 0 0-7.44 7.44l-8.1 8.1a2.12 2.12 0 1 0 3 3l8.1-8.1a5.5 5.5 0 0 0 7.44-7.44z" fill="#fff"/></svg>`
    : '';

  const size = 30;
  const badges: string[] = [];
  if (hasWorks) {
    badges.push(`<div style="position:absolute;top:-3px;right:-3px;width:13px;height:13px;border-radius:50%;background:#dc2626;border:1.5px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-size:9px;font-weight:800;line-height:1;">&times;</div>`);
  }
  if (isLowSpeed) {
    badges.push(`<div style="position:absolute;bottom:-3px;right:-3px;width:13px;height:13px;border-radius:50%;background:#0f172a;border:1.5px solid #fff;display:flex;align-items:center;justify-content:center;color:#fbbf24;font-size:9px;line-height:1;">&#9660;</div>`);
  }

  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="position:relative;width:${size}px;height:${size}px;">
      <div style="width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};${ringStyle}box-shadow:0 3px 8px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;">
        <div style="transform:rotate(45deg);color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;position:relative;">${wrenchGlyph || escapeHtml(label)}</div>
      </div>
      ${badges.join('')}
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
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

    map.on('popupopen', (event: L.PopupEvent) => {
      const node = event.popup.getElement();
      const button = node?.querySelector<HTMLButtonElement>('[data-report-id]');
      if (!button) return;
      button.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('sc-report', {
          detail: { id: button.dataset.reportId || null, name: button.dataset.reportName || '' },
        }));
        map.closePopup();
      }, { once: true });
    });


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
        const usable = isChargerUsable(charger);
        const statusColor = usable ? '#16a34a' : (charger.status === 'construction' ? '#2563eb' : '#dc2626');
        const place = [charger.city, charger.province, charger.country].filter(Boolean).join(', ');
        let popup = `<div style="font-family:system-ui;font-size:13px;min-width:230px;color:#0f172a;">
          <strong style="font-size:15px;display:block;">${escapeHtml(charger.name || 'Onbekend')}</strong>
          ${place ? `<div style="color:#64748b;font-size:11px;">${escapeHtml(place)}</div>` : ''}
          <div style="margin-top:4px;color:${statusColor};font-weight:700;">${escapeHtml(status)}</div>`;

        const statusLines = describeChargerStatus(charger);
        if (statusLines.length > 1) {
          popup += `<div style="margin-top:4px;display:grid;gap:2px;color:#334155;">${statusLines.slice(1).map((line) => `<div>${escapeHtml(line)}</div>`).join('')}</div>`;
        }

        if (configs.length > 0) {
          popup += `<div style="margin-top:6px;display:grid;gap:3px;">${configs.map((config) => `<div>${escapeHtml(formatChargerConfig(config))}</div>`).join('')}</div>`;
        } else if (charger.totalStalls) {
          popup += `<br/><span style="color:#475569;">${charger.totalStalls} laadplekken</span>`;
        }
        if (charger.status === 'works') {
          popup += `<div style="margin-top:4px;color:#b45309;font-weight:600;">${getOpenStalls(charger)} laders nu bruikbaar</div>`;
        }
        popup += `<div style="margin-top:6px;color:#2563eb;font-weight:600;">Max ${maxSpeed} kW</div>`;
        popup += `<div style="margin-top:3px;color:#475569;">${escapeHtml(formatOpeningHoursSummary(charger))}</div>`;
        const extras: string[] = [];
        if (charger.trailerFriendly) extras.push('Aanhangervriendelijk');
        if (charger.inParkingGarage) extras.push('In parkeergarage');
        if (charger.parkingFee) extras.push('Parkeergeld verplicht');
        if (extras.length > 0) {
          popup += `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #e2e8f0;display:grid;gap:2px;color:#334155;font-weight:500;">${extras.map((line) => `<div>• ${escapeHtml(line)}</div>`).join('')}</div>`;
        }
        popup += `<button type="button" data-report-id="${escapeHtml(charger.id ?? '')}" data-report-name="${escapeHtml(charger.name ?? '')}" style="margin-top:8px;width:100%;padding:6px 8px;border-radius:6px;border:1px solid #cbd5e1;background:#f8fafc;color:#b91c1c;font-weight:600;cursor:pointer;">Fout melden</button>`;
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
