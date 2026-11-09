import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { Supercharger, ChargingStop, RouteResult, ChargerStatus, constructionStepLabels, ConstructionStep, ChargerConfig, ParkingFeeBlock } from '@/lib/tesla-types';
import { describeChargerStatus, formatChargerConfig, formatOpeningHoursSummary, getChargerConfigs, getChargerStatus, isVisibleOnMap, getTotalStallsFromConfigs, getOpenStalls, formatStallAvailability, isChargerUsable, normalizeChargerConfigs, normalizeOpeningHours, openingDayKeys, openingDayLabels, parseMaxSpeed, shouldHideSpeed } from '@/lib/tesla-utils';


// Exchange rates are reference rates, cached in memory for 24 hours.
const eurRateCache = new Map<string, { rate: number; date: string; expiresAt: number }>();
async function getCurrencyToEurRate(currency: string): Promise<{ rate: number; date: string }> {
  const code = currency.trim().toUpperCase();
  if (code === "EUR") return { rate: 1, date: "" };
  const cached = eurRateCache.get(code);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const response = await fetch(`https://api.frankfurter.dev/v2/rate/${encodeURIComponent(code.toLowerCase())}/eur`);
  if (!response.ok) throw new Error(`Wisselkoers voor ${code} niet beschikbaar`);
  const data = await response.json() as { rate?: number; date?: string };
  if (typeof data.rate !== "number" || !Number.isFinite(data.rate) || data.rate <= 0) throw new Error("Ongeldige wisselkoers ontvangen");
  const result = { rate: data.rate, date: data.date ?? "", expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
  eurRateCache.set(code, result);
  return result;
}

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
  /** Zoom naar deze locatie zodra hij verandert. */
  focusCoord?: { lat: number; lng: number } | null;
  waypoints?: { lat: number; lng: number; label: string; corridor: boolean; charge: boolean; chargeTo: number }[];
  /** Route-only mode: show route chargers individually, without marker clusters. */
  routeChargersOnly?: boolean;
  favoriteChargerIds?: string[];
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

const waypointIcon = L.divIcon({
  className: 'custom-marker',
  html: `<div style="width:28px;height:28px;border-radius:50%;background:#16a34a;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:800;">T</div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

function chargerIcon(charger: Supercharger, status: ChargerStatus, isFavorite = false) {
  // Kleurlogica ongewijzigd: groen = open, rood = gesloten (openingstijden/sluiting), grijs = niet beschikbaar.
  let color = '#22c55e'; // groen = open/beschikbaar
  if (status === 'Niet beschikbaar' || status === 'Langdurig gesloten') color = '#94a3b8'; // grijs
  else if (status === 'In aanbouw') color = '#f59e0b'; // oranje voor in aanbouw
  else if (status === 'Werkzaamheden' || status === 'Druk') color = '#f59e0b'; // oranje
  else if (status === 'Onbekend') color = '#64748b';
  else if (status === 'Voting') color = '#3b82f6';
  else if (status === 'Plan' || status === 'Vergunning aangevraagd') color = '#a855f7';
  else if (status === 'Wordt uitgebreid') color = '#22c55e';
  else if (status === 'Permanent gesloten') color = '#0f172a';
  else if (status === 'Tijdelijk gesloten') color = '#cbd5e1';
  else if (status !== 'Beschikbaar' && status !== 'In bedrijf') color = '#ef4444'; // rood: gesloten varianten

  if (status === 'Voting') {
    return L.divIcon({
      className: 'custom-marker',
      html: `<div title="Voting" style="width:12px;height:12px;border-radius:50%;background:#3b82f6;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.35);"></div>`,
      iconSize: [12, 12], iconAnchor: [6, 6], popupAnchor: [0, -6],
    });
  }

  if (status === 'Plan') {
    return L.divIcon({
      className: 'custom-marker',
      html: `<div title="Plan" style="width:10px;height:10px;border-radius:50%;background:#a855f7;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.35);"></div>`,
      iconSize: [10, 10], iconAnchor: [5, 5], popupAnchor: [0, -5],
    });
  }

  const isConstruction = status === 'In aanbouw';
  const isPermit = status === 'Vergunning aangevraagd';
  const hasOpenWorks = charger.status === 'works' || charger.status === 'expanding';
  const hasClosedWorks = charger.status === 'works_closed';
  const isLowSpeed = !!charger.lowSpeed;

  // Geen live bezettingsaantallen op kaartmarkers tonen.

  const ringStyle = isConstruction
    ? 'border:2px dashed #fff;outline:2px dashed rgba(245,158,11,0.9);outline-offset:2px;'
    : 'border:2px solid #fff;';

  const wrenchGlyph = isConstruction
    ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);" xmlns="http://www.w3.org/2000/svg"><path d="M21.71 5.29a1 1 0 0 0-1.41 0l-2.13 2.12-1.58-1.58 2.12-2.13a1 1 0 0 0 0-1.41 5.5 5.5 0 0 0-7.44 7.44l-8.1 8.1a2.12 2.12 0 1 0 3 3l8.1-8.1a5.5 5.5 0 0 0 7.44-7.44z" fill="#fff"/></svg>`
    : isPermit
    ? `<svg width="12" height="13" viewBox="0 0 24 24" fill="none" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);" xmlns="http://www.w3.org/2000/svg"><path d="M6 2h9l5 5v15H6z" fill="#fff"/><path d="M15 2v5h5" fill="#e9d5ff"/><path d="M9 12h8M9 15h8M9 18h5" stroke="#a855f7" stroke-width="1.6"/></svg>`
    : '';

  const size = 30;
  // Toon het aantal laadplekken dat volgens de admin daadwerkelijk beschikbaar is.
  const totalStalls = getTotalStallsFromConfigs(charger.chargerConfigs) ?? charger.totalStalls ?? 0;
  const availableStalls = getOpenStalls(charger);
  const badges: string[] = [];
  if (hasOpenWorks) {
    badges.push(`<div style="position:absolute;top:-3px;right:-3px;width:14px;height:14px;border-radius:50%;background:#f59e0b;border:1.5px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-size:9px;font-weight:800;line-height:1;">&#10003;</div>`);
  }
  if (hasClosedWorks) {
    badges.push(`<div style="position:absolute;top:-3px;right:-3px;width:13px;height:13px;border-radius:50%;background:#dc2626;border:1.5px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-size:9px;font-weight:800;line-height:1;">&times;</div>`);
  }
  if (isLowSpeed) {
    badges.push(`<div style="position:absolute;bottom:-3px;right:-3px;width:13px;height:13px;border-radius:50%;background:#0f172a;border:1.5px solid #fff;display:flex;align-items:center;justify-content:center;color:#fbbf24;font-size:9px;line-height:1;">&#9660;</div>`);
  }

  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="position:relative;width:${size}px;height:${size}px;">
      <div style="width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};${ringStyle}${isFavorite ? "outline:3px solid #fbbf24;outline-offset:3px;" : ""}box-shadow:0 3px 8px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;">
        <div style="transform:rotate(45deg);color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;position:relative;">${wrenchGlyph || (totalStalls > 0 ? availableStalls : '')}</div>
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

function currentPositionIcon(heading?: number | null) {
  const rotation = typeof heading === "number" && Number.isFinite(heading) ? heading : 0;
  const html = '<div style="position:relative;width:42px;height:42px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 2px 8px rgba(0,0,0,.55))"><div style="position:absolute;inset:2px;border-radius:50%;background:rgba(34,153,255,.20);border:1px solid rgba(255,255,255,.38);animation:gps-ring 2s ease-out infinite"></div><div style="position:relative;width:30px;height:30px;border-radius:50%;background:linear-gradient(145deg,#62c7ff,#0878ed);border:3px solid #fff;box-shadow:0 0 0 2px #0878ed,0 0 18px rgba(0,132,255,.85);display:flex;align-items:center;justify-content:center"><div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:13px solid #fff;transform:translateY(-2px) rotate(' + rotation + 'deg);transform-origin:50% 60%"></div></div></div><style>@keyframes gps-ring{0%{transform:scale(.75);opacity:.85}100%{transform:scale(1.45);opacity:0}}</style>';
  return L.divIcon({ className: "tesla-gps-marker", html, iconSize: [42, 42], iconAnchor: [21, 21] });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] || char);
}

function groupChargerConfigs(configs: ChargerConfig[]): string[] {
  const grouped = new Map<string, number>();
  configs.forEach((config) => {
    const key = `${config.version}|${config.speedKw}`;
    grouped.set(key, (grouped.get(key) || 0) + config.count);
  });
  return Array.from(grouped.entries()).map(([key, count]) => {
    const [version, speedKw] = key.split('|');
    return `${count}x ${version} ${speedKw} kW`;
  });
}

export default function EvMap({ startCoord, destCoord, superchargers, route, routeVariants, selectedRouteType, chargingStops, currentPosition, isNavigating, heading, headingUp, showDrafts = false, focusCoord, waypoints = [], routeChargersOnly = false, favoriteChargerIds = [] }: EvMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<L.LayerGroup>(L.layerGroup());
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const routeRef = useRef<L.Polyline | null>(null);
  const routeVariantsRef = useRef<L.LayerGroup>(L.layerGroup());
  const trafficLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const currentMarkerRef = useRef<L.Marker | null>(null);
  const followPausedUntilRef = useRef(0);
  const lastAutoPanRef = useRef(0);
  const [statusTick, setStatusTick] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenActive = fullscreen || !!isNavigating;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !isNavigating) setFullscreen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isNavigating]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const timer = window.setTimeout(() => map.invalidateSize({ animate: false }), 220);
    return () => window.clearTimeout(timer);
  }, [fullscreenActive]);

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
      // Soepeler zoomen: kleinere stappen en vloeiende animatie.
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 90,
      zoomAnimation: true,
      fadeAnimation: true,
      markerZoomAnimation: true,
    });

    // Oorspronkelijke satellietkaart: Esri World Imagery met plaatsnamen en grenzen.
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics',
      maxZoom: 18,
    }).addTo(map);

    // Landgrenzen en plaatsnamen boven op de satellietbeelden.
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
      if (button) {
        button.addEventListener('click', () => {
          window.dispatchEvent(new CustomEvent('sc-report', {
            detail: { id: button.dataset.reportId || null, name: button.dataset.reportName || '' },
          }));
          map.closePopup();
        }, { once: true });
      }
      node?.querySelectorAll<HTMLImageElement>('img[data-photo]').forEach((img) => {
        img.addEventListener('dblclick', () => {
          const overlay = document.createElement('div');
          overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
          const big = document.createElement('img');
          big.src = img.dataset.photo || img.src;
          big.style.cssText = 'max-width:94vw;max-height:92vh;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,0.6);';
          overlay.appendChild(big);
          overlay.addEventListener('click', () => overlay.remove());
          document.body.appendChild(overlay);
        });
      });
      const favoriteButton = node?.querySelector<HTMLButtonElement>("[data-favorite-id]");
      if (favoriteButton) favoriteButton.addEventListener("click", () => { window.dispatchEvent(new CustomEvent("sc-favorite", { detail: { id: favoriteButton.dataset.favoriteId || "" } })); map.closePopup(); }, { once: true });
      const ownerButton = node?.querySelector<HTMLButtonElement>('[data-owner-id]');
      if (ownerButton) {
        ownerButton.addEventListener('click', () => {
          window.dispatchEvent(new CustomEvent('sc-owner', { detail: { id: ownerButton.dataset.ownerId || null } }));
          map.closePopup();
        }, { once: true });
      }
    });



    // Clustergroep voor duizenden Superchargers: houdt de kaart soepel.
    const cluster = L.markerClusterGroup({
      chunkedLoading: true,
      chunkInterval: 50,
      chunkDelay: 10,
      maxClusterRadius: 55,
      disableClusteringAtZoom: 12,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      iconCreateFunction: (c) => {
        const count = c.getChildCount();
        const size = count < 10 ? 34 : count < 100 ? 40 : 48;
        return L.divIcon({
          html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:linear-gradient(135deg,#1d4ed8,#0ea5e9);border:2px solid rgba(255,255,255,0.9);box-shadow:0 2px 8px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:${count < 100 ? 13 : 12}px;font-family:system-ui;">${count}</div>`,
          className: 'sc-cluster',
          iconSize: [size, size],
        });
      },
    });
    clusterRef.current = cluster;
    cluster.addTo(map);

    markersRef.current.addTo(map);
    routeVariantsRef.current.addTo(map);
    trafficLayerRef.current.addTo(map);
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
    clusterRef.current?.clearLayers();
    if (routeChargersOnly) clusterRef.current?.remove();
    else clusterRef.current?.addTo(map);

    superchargers.forEach(charger => {
      try {
        if (charger.published === false && !showDrafts) return;
        if (!isVisibleOnMap(charger)) return;

        const status = getChargerStatus(charger);
        const marker = L.marker([charger.lat, charger.lng], { icon: chargerIcon(charger, status, favoriteChargerIds.includes(charger.id ?? "")) });
        const maxSpeed = parseMaxSpeed(charger.stallTypes, charger.maxSpeedKw, charger.chargerConfigs);
        const configs = getChargerConfigs(charger);
        const usable = isChargerUsable(charger);
        const statusColor = usable
          ? (charger.status === 'works' ? '#b45309' : '#16a34a')
          : (charger.status === 'construction' ? '#f59e0b' : charger.status === 'long_closed' || charger.isAvailable === false ? '#64748b' : '#dc2626');
        const place = [charger.city, charger.province, charger.country].filter(Boolean).join(', ');
        const isFavorite = favoriteChargerIds.includes(charger.id ?? "");
        let popup = `<div style="font-family:system-ui;font-size:13px;min-width:240px;color:#0f172a;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding-right:2px;">
            <div style="min-width:0;flex:1;">
              <strong style="font-size:15px;display:block;">${escapeHtml(charger.name || 'Onbekend')}</strong>
              ${place ? `<div style="color:#64748b;font-size:11px;">${escapeHtml(place)}</div>` : ''}
            </div>
            <button type="button" data-favorite-id="${escapeHtml(charger.id ?? '')}" aria-label="${isFavorite ? "Favoriet verwijderen" : "Favoriet maken"}" title="${isFavorite ? "Favoriet verwijderen" : "Favoriet maken"}" style="all:unset;box-sizing:border-box;flex:none;width:22px;height:22px;margin:-2px -4px 0 0;display:flex;align-items:center;justify-content:center;border:0;background:transparent;color:${isFavorite ? "#f59e0b" : "#94a3b8"};font-size:18px;line-height:1;cursor:pointer;">${isFavorite ? "★" : "☆"}</button>
          </div>
          <div style="margin-top:4px;color:${statusColor};font-weight:700;">${escapeHtml(status)}</div>`;

        const hideSpeed = shouldHideSpeed(charger);
        const photoUrls = (charger.photos ?? []).filter((url) => typeof url === "string" && url.trim().length > 0);
        if (photoUrls.length > 0) {
          // Toon alle opgeslagen foto's; lazy loading in Leaflet-popups liet soms
          // afbeeldingen onzichtbaar totdat de popup opnieuw werd geopend.
          popup += `<div style="margin-top:6px;display:flex;gap:4px;overflow-x:auto;">${photoUrls.map((url) => {
            const photoUrl = escapeHtml(url.trim());
            return `<img data-photo="${photoUrl}" title="Dubbelklik om te vergroten" src="${photoUrl}" alt="Supercharger foto" loading="eager" referrerpolicy="no-referrer" style="cursor:zoom-in;width:110px;height:72px;object-fit:cover;border-radius:6px;flex:none;" />`;
          }).join('')}</div>`;
        }

        if (charger.ownerName) {
          popup += `<button type="button" data-owner-id="${escapeHtml(charger.ownerId ?? '')}" style="margin-top:4px;display:flex;align-items:center;gap:6px;color:#1d4ed8;font-weight:600;background:none;border:none;padding:0;cursor:pointer;text-decoration:underline;">`;
          if (charger.ownerLogoUrl) {
            popup += `<img src="${escapeHtml(charger.ownerLogoUrl)}" alt="${escapeHtml(charger.ownerName)}" style="width:16px;height:16px;object-fit:contain;border-radius:3px;" />`;
          }
          popup += `<span>${escapeHtml(charger.ownerName)}</span></button>`;
        }

        const statusLines = describeChargerStatus(charger);
        if (statusLines.length > 1) {
          popup += `<div style="margin-top:4px;display:grid;gap:2px;color:#334155;">${statusLines.slice(1).map((line) => `<div>${escapeHtml(line)}</div>`).join('')}</div>`;
        }

        if (hideSpeed) {
          popup += `<div style="margin-top:6px;color:#b45309;font-weight:600;">Gegevens nog onbekend</div>`;
        } else if (configs.length > 0) {
          popup += `<div style="margin-top:6px;display:grid;gap:3px;">${groupChargerConfigs(configs).map((line) => `<div>${escapeHtml(line)}</div>`).join('')}</div>`;
        } else if (charger.totalStalls) {
          popup += `<br/><span style="color:#475569;">${charger.totalStalls} laadplekken</span>`;
        }


        if (charger.status === 'works' || charger.status === 'works_closed') {
          const closedConfigs = normalizeChargerConfigs(charger.works?.closedConfigs);
          if (closedConfigs.length > 0) {
            const total = getTotalStallsFromConfigs(charger.chargerConfigs) ?? charger.totalStalls ?? 0;
            const closed = closedConfigs.reduce((sum, c) => sum + c.count, 0);
            const available = Math.max(0, total - closed);
            popup += `<div style="margin-top:4px;color:#b45309;font-weight:600;">${total} totaal · ${closed} buiten gebruik · ${available} beschikbaar</div>`;
          }
        }

        if (charger.status === 'construction') {
          const steps = charger.construction?.steps || [];
          if (steps.length > 0) {
            popup += `<div style="margin-top:8px;padding-top:6px;border-top:1px dashed #e2e8f0;display:grid;gap:2px;">${(Object.keys(constructionStepLabels) as ConstructionStep[]).map((key) => {
              const done = steps.includes(key);
              return `<div style="color:${done ? '#16a34a' : '#94a3b8'};display:flex;align-items:center;gap:6px;">
                <span style="width:14px;height:14px;border-radius:50%;background:${done ? '#16a34a' : 'transparent'};border:1.5px solid ${done ? '#16a34a' : '#cbd5e1'};display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:9px;">${done ? '&#10003;' : ''}</span>
                <span>${escapeHtml(constructionStepLabels[key])}</span>
              </div>`;
            }).join('')}</div>`;
          }
          if (charger.construction?.expectedOpenMonth) {
            popup += `<div style="margin-top:6px;color:#b45309;font-weight:600;">Verwachte opening: ${escapeHtml(charger.construction.expectedOpenMonth)}</div>`;
          }
        }

        if (charger.plannedUpgrade && (charger.plannedUpgrade.fromConfigs?.length || charger.plannedUpgrade.toConfigs?.length)) {
          const fromLines = groupChargerConfigs(normalizeChargerConfigs(charger.plannedUpgrade.fromConfigs));
          const toLines = groupChargerConfigs(normalizeChargerConfigs(charger.plannedUpgrade.toConfigs));
          popup += `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #e2e8f0;">
            ${charger.plannedUpgrade.label ? `<div style="font-weight:600;color:#334155;">${escapeHtml(charger.plannedUpgrade.label)}</div>` : ''}
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px;">
              <span style="color:#dc2626;">${escapeHtml(fromLines.join(', ') || 'huidig')}</span>
              <span style="color:#64748b;">&#8594;</span>
              <span style="color:#16a34a;">${escapeHtml(toLines.join(', ') || 'nieuw')}</span>
            </div>
            ${charger.plannedUpgrade.expected ? `<div style="color:#64748b;font-size:11px;margin-top:2px;">Verwacht: ${escapeHtml(charger.plannedUpgrade.expected)}</div>` : ''}
          </div>`;
        }

        if (!hideSpeed && maxSpeed > 0) {
          popup += `<div style="margin-top:6px;color:#2563eb;font-weight:600;">Max ${maxSpeed} kW</div>`;
        }

        const hideOpeningHours = status === 'In aanbouw' || status === 'Plan' || status === 'Vergunning aangevraagd';
        if (!hideOpeningHours) {
          popup += `<div style="margin-top:3px;color:#475569;">${escapeHtml(formatOpeningHoursSummary(charger))}</div>`;
        }

        if (charger.notes) {
          popup += `<div style="margin-top:6px;color:#64748b;font-size:11px;font-style:italic;">${escapeHtml(charger.notes)}</div>`;
        }

        const extras: string[] = [];
        if (charger.trailerFriendly) extras.push('Aanhangervriendelijk');
        if (charger.inParkingGarage) extras.push('In parkeergarage');
        if (charger.parkingFee) extras.push('Parkeergeld verplicht');
        if (extras.length > 0) {
          popup += `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #e2e8f0;display:grid;gap:2px;color:#334155;font-weight:500;">${extras.map((line) => `<div>• ${escapeHtml(line)}</div>`).join('')}</div>`;
        }


        popup += `<button type="button" data-report-id="${escapeHtml(charger.id ?? '')}" data-report-name="${escapeHtml(charger.name ?? '')}" style="margin-top:8px;width:100%;padding:6px 8px;border-radius:6px;border:1px solid #cbd5e1;background:#f8fafc;color:#b91c1c;font-weight:600;cursor:pointer;">Fout melden</button>`;
        popup += `</div>`;
        if (!hideOpeningHours) {
          const outerClose = popup.lastIndexOf('</div>');
          popup = popup.slice(0, outerClose) + '<div style="margin-top:6px;color:#64748b;font-size:11px;">Dubbelklik voor prijzen en parkeergeld</div>' + popup.slice(outerClose);
        }
        marker.bindPopup(popup);
        if (!hideOpeningHours) marker.on('dblclick', async (ev: L.LeafletMouseEvent) => {
          try {
            L.DomEvent.stop(ev);
          const rawCurrency = typeof charger.priceCurrency === 'string' ? charger.priceCurrency.trim().toUpperCase() : 'EUR';
          const currency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : 'EUR';
          let exchangeRate = 1;
          let rateDate = "";
          let exchangeRateError = false;
          if (currency !== "EUR") {
            L.popup({ maxWidth: 360 }).setLatLng([charger.lat, charger.lng]).setContent(`<div style="font-family:system-ui;padding:6px;">Wisselkoers ophalen voor ${escapeHtml(currency)}…</div>`).openOn(map);
            try {
              const quote = await getCurrencyToEurRate(currency);
              exchangeRate = quote.rate;
              rateDate = quote.date;
            } catch (rateError) {
              exchangeRateError = true;
              console.warn("[TeslaNavigation] Wisselkoers niet beschikbaar:", rateError);
            }
          }
          const localMoney = (v: number) => new Intl.NumberFormat('nl-NL', { style: 'currency', currency }).format(v);
          const euroMoney = (v: number) => new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(v * exchangeRate);
          const eur = (v?: number | null) => {
            if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
            if (currency === 'EUR') return euroMoney(v);
            if (exchangeRateError) return `${localMoney(v)} · EUR-koers niet beschikbaar`;
            return `${localMoney(v)} → ${euroMoney(v)}`;
          };
          const parkingBlocks = (Array.isArray(charger.parkingBlocks) ? charger.parkingBlocks : []) as ParkingFeeBlock[];
          const parkingRates = new Map<string, number | null>();
          await Promise.all([...new Set(parkingBlocks.map((block) => (block.currency || "EUR").toUpperCase()))].map(async (code) => {
            try { parkingRates.set(code, (await getCurrencyToEurRate(code)).rate); }
            catch { parkingRates.set(code, null); }
          }));
          const parkingMoney = (amount: number, rawCode: string) => {
            const code = /^[A-Z]{3}$/.test(rawCode) ? rawCode : "EUR";
            const local = new Intl.NumberFormat("nl-NL", { style: "currency", currency: code }).format(amount);
            if (code === "EUR") return local;
            const rate = parkingRates.get(code);
            if (rate == null) return local + " · EUR-koers niet beschikbaar";
            return local + " → " + new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(amount * rate);
          };
          const row = (k: string, v: string) => `<div style="display:flex;justify-content:space-between;gap:12px;"><span style="color:#64748b;">${k}</span><strong>${v}</strong></div>`;
          const allPriceBlocks = (Array.isArray(charger.priceBlocks) ? charger.priceBlocks : []).filter((b) => !!b);
          const priceBlocks = allPriceBlocks.filter((b) => b.type !== "power" && typeof b.pricePerKwh === "number" && Number.isFinite(b.pricePerKwh));
          const powerPriceBlocks = allPriceBlocks.filter((b) => b.type === "power" && typeof b.pricePerMinute === "number" && Number.isFinite(b.pricePerMinute));
          const hasTimeBasedPricing = priceBlocks.length > 0;
          const hasPowerPricing = powerPriceBlocks.length > 0;
          const hasRegularPricing = charger.pricePerKwh != null || charger.pricePerKwhPeak != null || !!charger.peakHours;
          let d = `<div style="font-family:system-ui;font-size:13px;min-width:260px;color:#0f172a;display:grid;gap:4px;">
            <strong style="font-size:15px;">${escapeHtml(charger.name || 'Onbekend')}</strong>`;
          if (hasTimeBasedPricing) {
            d += `<div style="font-weight:700;margin-top:4px;">⚡ Prijzen per tijdsblok</div>
              ${priceBlocks.map((b) => row(escapeHtml(`${b.days ?? 'Dagelijks'} ${b.from ?? ''}–${b.to ?? ''}`), eur(b.pricePerKwh))).join('')}`;
          }
          if (hasPowerPricing) {
            d += `<div style="font-weight:700;margin-top:8px;">⏱️ Prijzen per minuut · actueel laadvermogen</div>
              ${powerPriceBlocks.sort((a,b) => (a.minKw ?? 0) - (b.minKw ?? 0)).map((b) => row(escapeHtml(`${b.minKw ?? 0}–${b.maxKw == null ? '∞' : b.maxKw} kW`), eur(b.pricePerMinute) + ' / min')).join('')}`;
          }
          if (!hasTimeBasedPricing && !hasPowerPricing && hasRegularPricing) {
            d += `<div style="font-weight:700;margin-top:4px;">⚡ Prijzen</div>
              ${charger.pricePerKwh != null ? row('Per kWh', eur(charger.pricePerKwh)) : ''}
              ${charger.pricePerKwhPeak != null ? row('Piek per kWh', eur(charger.pricePerKwhPeak)) : ''}
              ${charger.peakHours ? row('Piekuren', escapeHtml(charger.peakHours)) : ''}`;
          }
          const forecast = charger.trafficForecast?.weekly ?? [];
          if (forecast.length) {
            const dayNames: Record<string,string> = { mon:"Ma", tue:"Di", wed:"Wo", thu:"Do", fri:"Vr", sat:"Za", sun:"Zo" };
            const byDay = ["mon","tue","wed","thu","fri","sat","sun"];
            const levelAt = (day: string, hour: number) => forecast.find((slot) => slot.day === day && slot.hour === hour)?.level;
            const heat = (level?: number) => level == null ? "#e2e8f0" : level < 25 ? "#86efac" : level < 50 ? "#fde68a" : level < 75 ? "#fdba74" : "#fca5a5";
            d += `<div style="font-weight:700;margin-top:8px;">📊 Gebruikelijke drukte</div><div style="font-size:10px;color:#64748b;">Gemiddelde drukte per uur (0–100%)</div><div style="display:grid;grid-template-columns:24px repeat(24,minmax(5px,1fr));gap:2px;margin-top:4px;">`;
            d += Array.from({length:24},(_,h)=>`<span style="font-size:8px;text-align:center;color:#64748b;">${h%3===0?String(h).padStart(2,"0"):""}</span>`).join("");
            for (const day of byDay) {
              d += `<span style="font-size:9px;color:#475569;align-self:center;">${dayNames[day]}</span>`;
              for (let hour=0;hour<24;hour++) {
                const value = levelAt(day,hour);
                d += `<span title="${dayNames[day]} ${hour}:00 · ${value == null ? "geen data" : value+"%"}" style="height:12px;border-radius:2px;background:${heat(value)};"></span>`;
              }
            }
            d += `</div><div style="display:flex;justify-content:space-between;font-size:9px;color:#64748b;margin-top:3px;"><span>Rustig</span><span>Gemiddeld</span><span>Druk</span></div>`;
          }
          const openingHours = normalizeOpeningHours(charger.openingHours, charger.openingTime, charger.closingTime);
          const openingHoursHtml = openingHours.mode === '24_7' ? '' : `
            <div style="font-weight:700;margin-top:6px;">🕒 Openingstijden hele week</div>
            <div style="display:grid;gap:3px;margin-top:2px;">
              ${(() => {
                const todayKey = (['sun','mon','tue','wed','thu','fri','sat'] as const)[new Date().getDay()];
                return openingDayKeys.map((day) => {
                  const dayHours = openingHours.days[day];
                  const isToday = day === todayKey;
                  const value = dayHours?.closed ? 'Gesloten' : `${dayHours?.open ?? '00:00'} – ${dayHours?.close ?? '23:59'}`;
                  return `<div style="display:flex;justify-content:space-between;gap:12px;padding:2px 5px;border-radius:4px;background:${isToday ? '#eff6ff' : 'transparent'};font-weight:${isToday ? '700' : '400'};"><span>${openingDayLabels[day]}${isToday ? ' · vandaag' : ''}</span><span style="color:${dayHours?.closed ? '#dc2626' : '#334155'};">${escapeHtml(value)}</span></div>`;
                }).join('');
              })()}
            </div>`;
          d += `${openingHoursHtml}
            <div style="font-weight:700;margin-top:6px;">🅿️ Parkeren</div>`;
          // Free initial periods may be stored in the legacy field or as a zero-cost
          // parking block. Detect them for every Supercharger.
          const freeBlockIndex = parkingBlocks.findIndex((block) =>
            Number(block.amount) === 0 && Number(block.afterMinutes) === 0 && Number(block.durationMinutes) > 0
          );
          const freeMinutes = Number(charger.parkingFreeMinutes) > 0
            ? Number(charger.parkingFreeMinutes)
            : freeBlockIndex >= 0 ? Number(parkingBlocks[freeBlockIndex].durationMinutes) : 0;
          const hasFreeInitialPeriod = freeMinutes > 0;
          if (!charger.parkingFee && !hasFreeInitialPeriod) {
            d += `<div>Gratis parkeren</div>`;
          } else {
            if (hasFreeInitialPeriod) d += `<div style="font-weight:600;">${freeMinutes} minuten gratis</div>`;
            const paidBlocks = parkingBlocks.filter((_, index) => index !== freeBlockIndex);
            if (paidBlocks.length > 0) {
              d += paidBlocks.map((block, index) => {
                const durationLabel = block.durationMinutes >= 60 && block.durationMinutes % 60 === 0 ? (block.durationMinutes / 60) + " uur" : block.durationMinutes + " min";
                const isHourlyRepeat = !!block.repeat && block.durationMinutes === 60;
                const label = block.label || (hasFreeInitialPeriod && index === 0 ? "Daarna" : block.durationMinutes === 0 ? "Vast bedrag" : `Vanaf ${block.afterMinutes} min`);
                const period = block.durationMinutes > 0 ? (block.repeat ? ` per ${durationLabel}` : ` voor ${durationLabel}`) : " eenmalig";
                const displayLabel = isHourlyRepeat && hasFreeInitialPeriod && index === 0 ? "Daarna per uur:" : label + period;
                return row(escapeHtml(displayLabel), parkingMoney(block.amount, block.currency || "EUR"));
              }).join("");
            } else {
              if (charger.parkingFeeAmount) d += row('Vast bedrag', eur(charger.parkingFeeAmount));
              if (charger.parkingPerMinutes && charger.parkingPerEuro) d += row(hasFreeInitialPeriod ? 'Daarna per uur:' : 'Daarna', `${eur(charger.parkingPerEuro)} per ${charger.parkingPerMinutes} min`);
              if (!charger.parkingFeeAmount && !charger.parkingPerEuro && !hasFreeInitialPeriod) d += `<div>Parkeergeld verplicht (bedrag onbekend)</div>`;
            }
          }
          if (charger.inParkingGarage) d += `<div>In parkeergarage</div>`;
          if (charger.trailerFriendly) d += `<div>Aanhangervriendelijk</div>`;
          if (charger.siteAmenities?.length) {
            d += `<div style="font-weight:700;margin-top:7px;">🛍️ Voorzieningen</div>${charger.siteAmenities.map((amenity) => `<span style="display:inline-block;margin:2px 3px 0 0;padding:3px 7px;border-radius:10px;background:#e0f2fe;color:#075985;font-size:11px;">${escapeHtml(amenity)}</span>`).join("")}`;
          }
          if (!hideSpeed && configs.length) d += `<div style="font-weight:700;margin-top:6px;">🔌 Laders</div>${groupChargerConfigs(configs).map((l) => `<div>${escapeHtml(l)}</div>`).join('')}`;
          d += `</div>`;
            L.popup({ maxWidth: 360 }).setLatLng([charger.lat, charger.lng]).setContent(d).openOn(map);
          } catch (error) {
            console.error('Supercharger details popup failed:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            const fallback = `<div style="font-family:system-ui;font-size:14px;min-width:220px;"><strong>${escapeHtml(charger.name || 'Supercharger')}</strong><div style="margin-top:6px;">Fout bij laden details: ${escapeHtml(errorMessage)}</div></div>`;
            L.popup({ maxWidth: 360 }).setLatLng([charger.lat, charger.lng]).setContent(fallback).openOn(map);
          }
        });
        const targetLayer = routeChargersOnly ? markersRef.current : (clusterRef.current ?? markersRef.current);
        targetLayer.addLayer(marker);
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
    waypoints.forEach((waypoint) => {
      const marker = L.marker([waypoint.lat, waypoint.lng], { icon: waypointIcon });
      const detail = waypoint.corridor
        ? `Route binnen de ingestelde straal`
        : waypoint.charge ? `Tussenstop · opladen tot ${waypoint.chargeTo}%` : 'Tussenstop';
      marker.bindPopup(`<div style="font-family:system-ui;font-size:13px"><strong>${escapeHtml(waypoint.label || 'Tussenstop')}</strong><br/>${detail}</div>`);
      markersRef.current.addLayer(marker);
    });
  }, [startCoord, destCoord, superchargers, chargingStops, statusTick, showDrafts, waypoints, routeChargersOnly, favoriteChargerIds]);

  // Draai de kaart tijdens navigatie wanneer rijrichting boven is ingeschakeld.
  useEffect(() => {
    const map = mapRef.current;
    const pane = map?.getPane('mapPane');
    if (!pane) return;
    pane.style.rotate = isNavigating && headingUp && typeof heading === 'number' && Number.isFinite(heading)
      ? `${-heading}deg`
      : '0deg';
    pane.style.transformOrigin = '50% 50%';
  }, [heading, headingUp, isNavigating]);

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
      currentMarkerRef.current = L.marker([currentPosition.lat, currentPosition.lng], { icon: currentPositionIcon(heading), zIndexOffset: 10000, keyboard: false }).addTo(map);
    } else {
      currentMarkerRef.current.setLatLng([currentPosition.lat, currentPosition.lng]);
      currentMarkerRef.current.setIcon(currentPositionIcon(heading));
      currentMarkerRef.current.setZIndexOffset(10000);
    }
  }, [currentPosition, heading]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    try {
      if (routeRef.current) { map.removeLayer(routeRef.current); routeRef.current = null; }
      routeVariantsRef.current.clearLayers();
      trafficLayerRef.current.clearLayers();

      // Tekent rode/oranje stukken en een file-icoon op de geselecteerde route.
      const drawTraffic = (r: RouteResult) => {
        const segments = r.trafficSegments ?? [];
        if (segments.length === 0) return;
        let worst: { lat: number; lng: number } | null = null;
        let worstLen = 0;
        for (const seg of segments) {
          const slice = r.coordinates.slice(seg.startIndex, seg.endIndex + 1);
          if (slice.length < 2) continue;
          const latLngs = slice.map(([lng, lat]) => [lat, lng] as L.LatLngExpression);
          trafficLayerRef.current.addLayer(L.polyline(latLngs, {
            color: seg.severity === 'jam' ? '#dc2626' : '#f59e0b',
            weight: 7,
            opacity: 0.75,
            smoothFactor: 1,
          }));
          if (seg.severity === 'jam' && slice.length > worstLen) {
            worstLen = slice.length;
            const mid = slice[Math.floor(slice.length / 2)];
            worst = { lat: mid[1], lng: mid[0] };
          }
        }
        if (worst) {
          const w = worst as { lat: number; lng: number };
          trafficLayerRef.current.addLayer(L.marker([w.lat, w.lng], {
            icon: L.divIcon({
              className: '',
              html: '<div style="background:#dc2626;color:#fff;border-radius:9999px;padding:3px 8px;font:600 11px system-ui;box-shadow:0 1px 4px rgba(0,0,0,.4);white-space:nowrap">🚗 File</div>',
              iconSize: [60, 22],
              iconAnchor: [30, 26],
            }),
            interactive: false,
          }));
        }
      };

      const variantEntries = Object.entries(routeVariants || {}).filter((entry): entry is [string, RouteResult] => !!entry[1]);
      if (variantEntries.length > 1) {
        variantEntries.forEach(([type, variantRoute]) => {
          const latLngs: L.LatLngExpression[] = variantRoute.coordinates.map(([lng, lat]) => [lat, lng] as L.LatLngExpression);
          const selected = type === selectedRouteType;
          const polyline = L.polyline(latLngs, {
            color: selected ? ((variantRoute.trafficDelayMin ?? 0) >= 20 ? '#ef4444' : (variantRoute.trafficDelayMin ?? 0) >= 8 ? '#f59e0b' : '#3b82f6') : '#94a3b8',
            weight: selected ? 5 : 3,
            opacity: selected ? 0.95 : 0.55,
            smoothFactor: 1,
          });
          routeVariantsRef.current.addLayer(polyline);
          if (selected) routeRef.current = polyline;
        });

        const selectedRoute = routeVariants?.[selectedRouteType || ''] || route;
        if (selectedRoute) drawTraffic(selectedRoute);
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
          color: (route.trafficDelayMin ?? 0) >= 20 ? '#ef4444' : (route.trafficDelayMin ?? 0) >= 8 ? '#f59e0b' : '#3b82f6',
          weight: 4,
          opacity: 0.85,
          smoothFactor: 1,
        }).addTo(map);

        routeRef.current = polyline;
        drawTraffic(route);

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
    if (now < followPausedUntilRef.current || now - lastAutoPanRef.current < 80) return;
    lastAutoPanRef.current = now;

    const targetZoom = 16;
    if (map.getZoom() < 14) {
      map.setView([currentPosition.lat, currentPosition.lng], targetZoom, {
        animate: true,
        duration: 1.2,
      });
    } else {
      // GPS itself is interpolated; another overlapping Leaflet animation causes jitter.
      map.panTo([currentPosition.lat, currentPosition.lng], { animate: false });
    }
  }, [currentPosition, isNavigating]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusCoord) return;
    map.flyTo([focusCoord.lat, focusCoord.lng], Math.max(map.getZoom(), 13), { duration: 0.9 });
  }, [focusCoord]);



  return (
    <div className={fullscreenActive ? "fixed inset-0 z-[5000] h-[100dvh] w-screen overflow-hidden bg-slate-950" : "relative h-full min-h-[400px] w-full overflow-hidden"} style={{ zIndex: fullscreenActive ? 5000 : 0 }}>\n      {isNavigating && (
        <div className="pointer-events-none absolute right-3 top-3 z-[1100] flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-slate-950/75 shadow-lg backdrop-blur-md" aria-label={headingUp ? "Kaart draait mee met rijrichting" : "Noord boven"}>
          <div className="relative flex h-8 w-8 items-center justify-center">
            <span className="absolute top-0 text-[9px] font-black text-white">N</span>
            <div className="absolute top-[7px] h-[17px] w-[2px] rounded-full bg-white" style={{ transform: `rotate(${headingUp && typeof heading === 'number' ? heading : 0}deg)`, transformOrigin: '50% 100%' }} />
            <div className="absolute top-[6px] h-0 w-0 border-x-[4px] border-b-[7px] border-x-transparent border-b-red-500" style={{ transform: `rotate(${headingUp && typeof heading === 'number' ? heading : 0}deg)`, transformOrigin: '50% 100%' }} />
            <div className="absolute bottom-0 h-1.5 w-1.5 rounded-full bg-white" />
          </div>
        </div>
      )}
      {!isNavigating && <button type="button" onClick={() => setFullscreen((value) => !value)} aria-label={fullscreen ? "Kaart sluiten" : "Kaart fullscreen"} title={fullscreen ? "Terug naar normale kaart" : "Kaart fullscreen"} className="absolute right-3 top-3 z-[1000] rounded-lg border border-slate-300/70 bg-white/95 px-3 py-2 text-sm font-semibold text-slate-800 shadow-lg hover:bg-white">{fullscreen ? "✕ Sluiten" : "⛶ Fullscreen"}</button>}
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
