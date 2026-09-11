/**
 * Local-first opslag: alles wat niet tussen gebruikers gedeeld hoeft te worden
 * (opgeslagen routes, voorkeuren, taal) staat primair in de browser.
 * De cloud is alleen een extra kopie. Import/export maakt verhuizen mogelijk.
 */

const PREFIX = "teslanav:";

export const LOCAL_KEYS = {
  routes: `${PREFIX}routes`,
  settings: `${PREFIX}settings`,
  language: `${PREFIX}language`,
} as const;

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    return safeParse<T>(window.localStorage.getItem(key), fallback);
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Opslag vol of geblokkeerd: de app moet gewoon blijven werken.
  }
}

export interface LocalRoute {
  id: string;
  name: string;
  startAddress?: string | null;
  endAddress?: string | null;
  modelName?: string;
  totalDistanceKm?: number | null;
  totalTimeMin?: number | null;
  createdAt: string;
  shareToken?: string | null;
  /** Volledige route-instellingen: voertuig, verbruik, tussenstops, laadinstellingen. */
  payload?: Record<string, unknown>;
}

export function getLocalRoutes(): LocalRoute[] {
  return readLocal<LocalRoute[]>(LOCAL_KEYS.routes, []);
}

export function saveLocalRoute(route: LocalRoute): LocalRoute[] {
  const list = getLocalRoutes().filter((r) => r.id !== route.id);
  const next = [route, ...list].slice(0, 200);
  writeLocal(LOCAL_KEYS.routes, next);
  return next;
}

export function removeLocalRoute(id: string): LocalRoute[] {
  const next = getLocalRoutes().filter((r) => r.id !== id);
  writeLocal(LOCAL_KEYS.routes, next);
  return next;
}

export function getLocalSettings(): Record<string, unknown> {
  return readLocal<Record<string, unknown>>(LOCAL_KEYS.settings, {});
}

export function setLocalSettings(patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...getLocalSettings(), ...patch };
  writeLocal(LOCAL_KEYS.settings, next);
  return next;
}

/** Back-up van alle lokale gegevens (routes + instellingen + taal). */
export function exportLocalData(): void {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    routes: getLocalRoutes(),
    settings: getLocalSettings(),
    language: readLocal<string>(LOCAL_KEYS.language, "nl"),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `teslanavigation-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Import voegt toe en werkt bij; bestaande gegevens worden nooit gewist. */
export function importLocalData(text: string): { routes: number } {
  const parsed = JSON.parse(text) as {
    routes?: LocalRoute[];
    settings?: Record<string, unknown>;
    language?: string;
  };
  const incoming = Array.isArray(parsed.routes) ? parsed.routes : [];
  const existing = getLocalRoutes();
  const byId = new Map(existing.map((r) => [r.id, r] as const));
  for (const route of incoming) if (route && route.id) byId.set(route.id, { ...byId.get(route.id), ...route });
  writeLocal(LOCAL_KEYS.routes, Array.from(byId.values()));
  if (parsed.settings) setLocalSettings(parsed.settings);
  if (parsed.language) writeLocal(LOCAL_KEYS.language, parsed.language);
  return { routes: incoming.length };
}
