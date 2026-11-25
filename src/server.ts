import { env as cloudflareEnv } from "cloudflare:workers";
import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}


type AdminD1Statement = {
  bind(...values: unknown[]): AdminD1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[]; success?: boolean }>;
  run(): Promise<{ success?: boolean; meta?: { changes?: number } }>;
};
type AdminD1Database = { prepare(query: string): AdminD1Statement; batch(statements: AdminD1Statement[]): Promise<unknown[]> };

/**
 * Nitro/TanStack may call the custom server entry with a platform wrapper
 * instead of the raw Workers env argument. Resolve the real binding from
 * every supported request/runtime location, with Cloudflare's module env
 * as the authoritative fallback.
 */
function getWorkerBindingValue(input: unknown, key: string): unknown {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const runtime = value.runtime && typeof value.runtime === "object" ? value.runtime as Record<string, unknown> : {};
  const cloudflare = value.cloudflare && typeof value.cloudflare === "object" ? value.cloudflare as Record<string, unknown> : {};
  const runtimeCloudflare = runtime.cloudflare && typeof runtime.cloudflare === "object" ? runtime.cloudflare as Record<string, unknown> : {};
  const nestedEnv = value.env && typeof value.env === "object" ? value.env as Record<string, unknown> : {};

  // Cloudflare's module-scoped env is the stable Workers binding source.
  // Check it first; framework wrappers may pass request metadata as the
  // second argument instead of the raw binding object on some code paths.
  const candidates = [
    // The env argument supplied to this exact fetch invocation is authoritative.
    // Never prefer a module-scoped binding over the request's live Worker env:
    // doing so can select a stale/empty binding during isolate reuse or rollout.
    value,
    nestedEnv,
    cloudflare.env && typeof cloudflare.env === "object" ? cloudflare.env as Record<string, unknown> : {},
    runtimeCloudflare.env && typeof runtimeCloudflare.env === "object" ? runtimeCloudflare.env as Record<string, unknown> : {},
    cloudflareEnv as unknown as Record<string, unknown>,
  ];
  for (const candidate of candidates) {
    const found = candidate[key];
    if (found !== undefined && found !== null) return found;
  }
  return undefined;
}

function getD1Binding(input: unknown): AdminD1Database | undefined {
  const candidate = getWorkerBindingValue(input, "DB");
  if (!candidate || typeof candidate !== "object" || typeof (candidate as AdminD1Database).prepare !== "function") {
    return undefined;
  }
  return candidate as AdminD1Database;
}

async function authorizeAdmin(request: Request, db: AdminD1Database): Promise<{ id: string } | Response> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith("__Host-tn-session="));
  const token = cookie?.slice("__Host-tn-session=".length);
  if (!token) return jsonResponse({ error: "Je bent niet ingelogd. Log opnieuw in." }, 401);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const digestBytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of digestBytes) binary += String.fromCharCode(byte);
  const tokenHash = btoa(binary);
  const user = await db.prepare(`
    SELECT u.id, EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'admin') AS is_admin
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.blocked = 0 LIMIT 1
  `).bind(tokenHash).first<{ id: string; is_admin: number | boolean }>();
  if (!user) return jsonResponse({ error: "Je sessie is verlopen. Log opnieuw in." }, 401);
  if (!(user.is_admin === true || Number(user.is_admin) === 1)) return jsonResponse({ error: "Je account heeft geen beheerdersrechten." }, 403);
  return { id: user.id };
}

function withBuildHeaders(response: Response, env: unknown): Response {
  const headers = new Headers(response.headers);
  const buildSha = (getWorkerBindingValue(env, "BUILD_SHA") as string | undefined) ?? "unknown";
  headers.set("x-teslanavigation-build", buildSha);
  if ((headers.get("content-type") ?? "").includes("text/html")) {
    // Never let a browser or intermediary keep an old app shell after a deployment.
    headers.set("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
    headers.set("cdn-cache-control", "no-store");
    headers.set("pragma", "no-cache");
    headers.set("expires", "0");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function invalidatePublicMapCache(): Promise<void> {
  try {
    const cache = caches.default;
    const origin = "https://teslanavigation.milantuin12.workers.dev";
    await Promise.all([
      cache.delete(new Request(origin + "/__cache/public-superchargers/fresh-v1")),
      cache.delete(new Request(origin + "/__cache/public-superchargers/stale-v1")),
    ]);
  } catch (error) {
    // Cache invalidation is best-effort; D1 remains the source of truth.
    console.warn("[TeslaNavigation] Could not invalidate public map cache:", error);
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * Read-only admin list endpoint. This deliberately bypasses the Start
 * server-function transport, which was returning undefined to the admin UI.
 * It never seeds, imports, updates, or deletes D1 records.
 */
async function handleAdminSuperchargerList(request: Request, workerEnv: unknown): Promise<Response> {
  if (request.method !== "GET") {
    return jsonResponse({ error: "Methode niet toegestaan." }, 405);
  }

  const db = getD1Binding(workerEnv);
  if (!db) return jsonResponse({ error: "Cloudflare D1-binding DB ontbreekt." }, 503);

  const admin = await authorizeAdmin(request, db);
  if (admin instanceof Response) return admin;
  // This endpoint is strictly read-only. Baseline seeding is intentionally
  // excluded from admin reads so every reload is a single bounded D1 query.
  const result = await db.prepare(`
    SELECT * FROM superchargers
    ORDER BY name COLLATE NOCASE
    LIMIT 5000
  `).all<Record<string, unknown>>();

  if (!Array.isArray(result.results)) {
    return jsonResponse({ error: "Cloudflare D1 gaf geen geldige Supercharger-lijst terug." }, 502);
  }

  const jsonColumns = ["versions", "opening_hours", "charger_configs", "parking_blocks", "construction", "planned_upgrade", "stall_states", "traffic_forecast", "works", "closure", "photos", "price_blocks", "voting"];
  const boolColumns = ["trailer_friendly", "is_available", "parking_fee", "in_parking_garage", "low_speed", "published", "hidden"];
  const chargers = result.results.map((row) => {
    const decoded: Record<string, unknown> = { ...row };
    for (const key of jsonColumns) {
      if (typeof decoded[key] === "string") {
        try { decoded[key] = JSON.parse(decoded[key] as string); } catch { /* retain legacy data */ }
      }
    }
    for (const key of boolColumns) {
      if (decoded[key] !== undefined && decoded[key] !== null) decoded[key] = Number(decoded[key]) === 1;
    }
    return decoded;
  });

  return jsonResponse(chargers);
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/__version") {
      return jsonResponse({
        app: "TeslaNavigation",
        build: (getWorkerBindingValue(env, "BUILD_SHA") as string | undefined) ?? "unknown",
        d1Bound: getD1Binding(env) !== undefined,
        deployedAt: new Date().toISOString(),
      });
    }
    // Public, read-only diagnostic: prove D1 accepts a real query, not merely
    // that a binding-shaped object exists. Never expose database contents.
    if (pathname === "/__health/d1" || pathname === "/__health/admin-d1") {
      try {
        const db = getD1Binding(env);
        if (!db) return jsonResponse({ ok: false, error: "D1 binding missing", source: "request-env" }, 503);
        if (pathname === "/__health/admin-d1") {
          // Exercise the same table and read path used by the admin list, without
          // returning station names, IDs, or any other database contents.
          const probe = await db.prepare(`
            SELECT * FROM superchargers
            ORDER BY name COLLATE NOCASE
            LIMIT 5000
          `).all<Record<string, unknown>>();
          if (!Array.isArray(probe.results)) {
            return jsonResponse({ ok: false, error: "Admin D1 query returned unexpected result" }, 503);
          }
          // Return only the row count; never expose station data from this probe.
          return jsonResponse({ ok: true, adminQuery: true, count: probe.results.length });
        }
        const probe = await db.prepare("SELECT 1 AS ok").first<{ ok: number }>();
        if (Number(probe?.ok) !== 1) return jsonResponse({ ok: false, error: "D1 query returned unexpected result" }, 503);
        return jsonResponse({ ok: true });
      } catch (error) {
        console.error("[TeslaNavigation] D1 health probe failed:", error);
        return jsonResponse({ ok: false, error: error instanceof Error ? error.message : "D1 query failed" }, 503);
      }
    }
    if (pathname === "/api/auth/login") {
      if (request.method !== "POST") return jsonResponse({ error: "Methode niet toegestaan." }, 405);
      try {
        const db = getD1Binding(env);
        if (!db) return jsonResponse({ error: "Cloudflare D1-binding DB ontbreekt." }, 503);
        const input = await request.json() as { email?: unknown; password?: unknown };
        const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
        const password = typeof input.password === "string" ? input.password : "";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 1 || password.length > 200) {
          return jsonResponse({ error: "Vul een geldig e-mailadres en wachtwoord in." }, 400);
        }
        const user = await db.prepare("SELECT id,email,password_hash,blocked FROM users WHERE email=? LIMIT 1")
          .bind(email).first<{ id: string; email: string; password_hash: string; blocked: number }>();
        if (!user || user.blocked) return jsonResponse({ error: "E-mailadres of wachtwoord is onjuist." }, 401);
        const stored = user.password_hash;
        let algorithm = "";
        let rounds = "";
        let saltText = "";
        let expectedText = "";
        if (stored.includes("$")) {
          [algorithm, rounds, saltText, expectedText] = stored.split("$");
        } else {
          algorithm = stored.slice(0, 13);
          rounds = stored.slice(13, 19);
          saltText = stored.slice(19, 43);
          expectedText = stored.slice(43);
        }
        const iterations = Number(rounds);
        if (algorithm !== "pbkdf2-sha256" || !/^\d+$/.test(rounds) || !Number.isInteger(iterations) || iterations < 1 || iterations > 100000 || !saltText || !expectedText) {
          return jsonResponse({ error: "E-mailadres of wachtwoord is onjuist." }, 401);
        }
        const decodeBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
        const salt = decodeBase64(saltText);
        const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
        const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
        const actual = new Uint8Array(bits);
        const expected = decodeBase64(expectedText);
        if (actual.length !== expected.length) return jsonResponse({ error: "E-mailadres of wachtwoord is onjuist." }, 401);
        let mismatch = 0;
        for (let i = 0; i < actual.length; i++) mismatch |= actual[i] ^ expected[i];
        if (mismatch !== 0) return jsonResponse({ error: "E-mailadres of wachtwoord is onjuist." }, 401);

        const random = new Uint8Array(32);
        crypto.getRandomValues(random);
        let tokenBinary = "";
        for (const byte of random) tokenBinary += String.fromCharCode(byte);
        const token = btoa(tokenBinary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
        const digestBytes = new Uint8Array(digest);
        let digestBinary = "";
        for (const byte of digestBytes) digestBinary += String.fromCharCode(byte);
        const tokenHash = btoa(digestBinary);
        const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
        await db.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)")
          .bind(crypto.randomUUID(), user.id, tokenHash, expiresAt).run();
        return new Response(JSON.stringify({ ok: true, id: user.id, email: user.email }), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store, max-age=0",
            "set-cookie": "__Host-tn-session=" + token + "; Path=/; Max-Age=1209600; HttpOnly; Secure; SameSite=Lax",
          },
        });
      } catch (error) {
        console.error("[TeslaNavigation] Direct D1 login failed:", error);
        return jsonResponse({ error: error instanceof Error ? error.message : "Inloggen bij Cloudflare D1 mislukt." }, 500);
      }
    }
    if (pathname === "/api/auth/me") {
      if (request.method !== "GET") return jsonResponse({ error: "Methode niet toegestaan." }, 405);
      try {
        const db = getD1Binding(env);
        if (!db) return jsonResponse({ error: "Cloudflare D1-binding DB ontbreekt." }, 503);
        const cookieHeader = request.headers.get("cookie") ?? "";
        const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith("__Host-tn-session="));
        const token = cookie?.slice("__Host-tn-session=".length);
        if (!token) return jsonResponse({ error: "Je bent niet ingelogd." }, 401);
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
        const bytes = new Uint8Array(digest);
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        const row = await db.prepare("SELECT u.id,u.email,u.display_name,u.gender,EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role='admin') AS is_admin FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP AND u.blocked=0 LIMIT 1")
          .bind(btoa(binary)).first<{ id: string; email: string; display_name: string | null; gender: string | null; is_admin: number | boolean }>();
        if (!row) return jsonResponse({ error: "Je sessie is verlopen. Log opnieuw in." }, 401);
        // Sliding session: keep an active account signed in without requiring
        // a fresh login every 14 days. D1 remains the source of truth.
        await db.prepare("UPDATE sessions SET expires_at = datetime('now', '+14 days') WHERE token_hash = ?")
          .bind(btoa(binary)).run();
        return new Response(JSON.stringify({ ...row, is_admin: row.is_admin === true || Number(row.is_admin) === 1 }), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store, max-age=0",
            "set-cookie": "__Host-tn-session=" + token + "; Path=/; Max-Age=1209600; HttpOnly; Secure; SameSite=Lax",
          },
        });
      } catch (error) {
        console.error("[TeslaNavigation] Direct session lookup failed:", error);
        return jsonResponse({ error: error instanceof Error ? error.message : "Sessiecontrole mislukt." }, 500);
      }
    }
    if (pathname === "/api/auth/claim-admin") {
      if (request.method !== "POST") return jsonResponse({ error: "Methode niet toegestaan." }, 405);
      try {
        const db = getD1Binding(env);
        if (!db) return jsonResponse({ error: "Cloudflare D1-binding DB ontbreekt." }, 503);
        const cookieHeader = request.headers.get("cookie") ?? "";
        const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith("__Host-tn-session="));
        const sessionToken = cookie?.slice("__Host-tn-session=".length);
        if (!sessionToken) return jsonResponse({ error: "Log eerst in met je account." }, 401);
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sessionToken));
        const digestBytes = new Uint8Array(digest);
        let digestBinary = "";
        for (const byte of digestBytes) digestBinary += String.fromCharCode(byte);
        const user = await db.prepare("SELECT u.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP AND u.blocked=0 LIMIT 1")
          .bind(btoa(digestBinary)).first<{ id: string }>();
        if (!user) return jsonResponse({ error: "Je sessie is verlopen. Log opnieuw in." }, 401);
        const input = await request.json().catch(() => null) as { token?: unknown } | null;
        const supplied = typeof input?.token === "string" ? input.token : "";
        const configured = (getWorkerBindingValue(env, "ADMIN_BOOTSTRAP_TOKEN") as string | undefined) ?? "";
        if (configured.length < 32) return jsonResponse({ error: "De eenmalige beheerderscode is nog niet ingesteld in Cloudflare." }, 503);
        const a = new TextEncoder().encode(supplied);
        const b = new TextEncoder().encode(configured);
        if (a.length !== b.length) return jsonResponse({ error: "De beheerderscode is onjuist." }, 403);
        let mismatch = 0;
        for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
        if (mismatch !== 0) return jsonResponse({ error: "De beheerderscode is onjuist." }, 403);
        const result = await db.prepare("INSERT INTO user_roles (id,user_id,role) SELECT ?, ?, 'admin' WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE role='admin')")
          .bind(crypto.randomUUID(), user.id).run();
        if (!result.meta?.changes) {
          const existing = await db.prepare("SELECT id FROM user_roles WHERE user_id=? AND role='admin' LIMIT 1").bind(user.id).first();
          if (!existing) return jsonResponse({ error: "De eerste beheerder is al ingesteld voor een ander account." }, 409);
        }
        return jsonResponse({ ok: true, is_admin: true });
      } catch (error) {
        console.error("[TeslaNavigation] Direct admin bootstrap failed:", error);
        return jsonResponse({ error: error instanceof Error ? error.message : "Beheerder activeren mislukt." }, 500);
      }
    }
    if (pathname === "/api/admin/me") {
      if (request.method !== "GET") return jsonResponse({ error: "Methode niet toegestaan." }, 405);
      try {
        const db = getD1Binding(env);
        if (!db) return jsonResponse({ error: "Cloudflare D1-binding DB ontbreekt." }, 503);
        const admin = await authorizeAdmin(request, db);
        if (admin instanceof Response) return admin;
        const cookieHeader = request.headers.get("cookie") ?? "";
        const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith("__Host-tn-session="));
        const token = cookie?.slice("__Host-tn-session=".length);
        if (!token) return jsonResponse({ error: "Je bent niet ingelogd." }, 401);
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
        const bytes = new Uint8Array(digest);
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        await db.prepare("UPDATE sessions SET expires_at = datetime('now', '+14 days') WHERE token_hash = ?")
          .bind(btoa(binary)).run();
        return new Response(JSON.stringify({ is_admin: true }), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store, max-age=0",
            "set-cookie": "__Host-tn-session=" + token + "; Path=/; Max-Age=1209600; HttpOnly; Secure; SameSite=Lax",
          },
        });
      } catch (error) {
        console.error("[TeslaNavigation] Admin session check failed:", error);
        return jsonResponse({ error: error instanceof Error ? error.message : "Sessiecontrole mislukt." }, 500);
      }
    }

    if (pathname === "/api/admin/superchargers" && request.method === "POST") {
      try {
        const db = getD1Binding(env);
        if (!db) return jsonResponse({ error: "Cloudflare D1-binding DB ontbreekt." }, 503);
        const admin = await authorizeAdmin(request, db);
        if (admin instanceof Response) return admin;
        const input = await request.json() as Record<string, unknown>;
        if (!input || typeof input !== "object" || Array.isArray(input)) return jsonResponse({ error: "Ongeldige Supercharger-gegevens." }, 400);
        const allowed = new Set(["id","name","lat","lng","country","province","city","total_stalls","stall_types","max_speed_kw","versions","opening_time","closing_time","opening_hours","trailer_friendly","is_available","charger_configs","parking_fee","parking_fee_amount","parking_free_minutes","parking_per_minutes","parking_per_euro","parking_blocks","price_currency","price_per_kwh","price_per_kwh_peak","peak_hours","in_parking_garage","status","construction","traffic_forecast","works","closure","owner_id","owner_name","low_speed","published","notes","reopen_at","planned_upgrade","stall_states","data_source","hidden","photos","permanently_closed_at","price_blocks","occupied_stalls","last_updated","updated_at","voting"]);
        const jsonFields = new Set(["versions","opening_hours","charger_configs","parking_blocks","construction","planned_upgrade","stall_states","traffic_forecast","works","closure","photos","price_blocks","voting"]);
        const boolFields = new Set(["trailer_friendly","is_available","parking_fee","in_parking_garage","low_speed","published","hidden"]);
        const row = Object.fromEntries(Object.entries(input).filter(([key, value]) => allowed.has(key) && value !== undefined));
        if (typeof row.name !== "string" || !row.name.trim() || typeof row.country !== "string" || !row.country.trim()
          || typeof row.lat !== "number" || !Number.isFinite(row.lat) || row.lat < -90 || row.lat > 90
          || typeof row.lng !== "number" || !Number.isFinite(row.lng) || row.lng < -180 || row.lng > 180) {
          return jsonResponse({ error: "Naam, land en geldige GPS-coördinaten zijn verplicht." }, 400);
        }
        if (!row.id) row.id = crypto.randomUUID();
        row.data_source = "manual";
        const columns = Object.keys(row);
        const values = columns.map((key) => {
          const value = row[key];
          if (jsonFields.has(key) && value !== null && value !== undefined) return typeof value === "string" ? value : JSON.stringify(value);
          if (boolFields.has(key) && typeof value === "boolean") return value ? 1 : 0;
          return value;
        });
        const updates = columns.filter((key) => key !== "id" && key !== "data_source" && key !== "updated_at")
          .map((key) => key + "=excluded." + key).concat(["data_source='manual'","updated_at=CURRENT_TIMESTAMP"]).join(",");
        const sql = "INSERT INTO superchargers (" + columns.join(",") + ") VALUES (" + columns.map(() => "?").join(",") + ") ON CONFLICT(id) DO UPDATE SET " + (updates || "id=excluded.id");
        const result = await db.prepare(sql).bind(...values).run();
        if (result.success === false) throw new Error("Cloudflare D1 heeft de wijziging niet opgeslagen.");
        await invalidatePublicMapCache();
        await db.prepare("INSERT INTO admin_audit_log (id,user_id,action,target_count,details) VALUES (?,?,?,?,?)")
          .bind(crypto.randomUUID(), admin.id, "supercharger_upsert", 1, JSON.stringify({ id: row.id, name: row.name })).run();
        return jsonResponse({ ok: true, id: row.id });
      } catch (error) {
        console.error("[TeslaNavigation] Direct admin D1 upsert failed:", error);
        return jsonResponse({ error: error instanceof Error ? error.message : "Opslaan in D1 mislukt." }, 500);
      }
    }
    if (pathname === "/api/admin/superchargers/bulk" && request.method === "POST") {
      try {
        const db = getD1Binding(env);
        if (!db) return jsonResponse({ error: "Cloudflare D1-binding DB ontbreekt." }, 503);
        const admin = await authorizeAdmin(request, db);
        if (admin instanceof Response) return admin;
        const input = await request.json() as { ids?: unknown; changes?: unknown };
        if (!Array.isArray(input.ids) || input.ids.length < 1 || input.ids.length > 5000
          || input.ids.some((id) => typeof id !== "string" || !id || id.length > 120)
          || !input.changes || typeof input.changes !== "object" || Array.isArray(input.changes)) {
          return jsonResponse({ error: "Ongeldige bulk-wijziging." }, 400);
        }
        const allowed = new Set(["country","province","max_speed_kw","versions","trailer_friendly","is_available","parking_fee","in_parking_garage","low_speed","published","notes","reopen_at","status","owner_id","owner_name","price_blocks","price_currency","parking_fee_amount","parking_free_minutes","parking_per_minutes","parking_per_euro"]);
        const jsonFields = new Set(["versions","price_blocks"]);
        const boolFields = new Set(["trailer_friendly","is_available","parking_fee","in_parking_garage","low_speed","published"]);
        const changes = Object.fromEntries(Object.entries(input.changes as Record<string, unknown>).filter(([key, value]) => allowed.has(key) && value !== undefined));
        const keys = Object.keys(changes);
        if (!keys.length) return jsonResponse({ error: "Geen geldige velden om bij te werken." }, 400);
        const values = keys.map((key) => {
          const value = changes[key];
          if (jsonFields.has(key) && value !== null && value !== undefined) return typeof value === "string" ? value : JSON.stringify(value);
          if (boolFields.has(key) && typeof value === "boolean") return value ? 1 : 0;
          return value;
        });
        const statements: AdminD1Statement[] = [];
        const ids = input.ids as string[];
        for (let i = 0; i < ids.length; i += 100) {
          const group = ids.slice(i, i + 100);
          const set = keys.map((key) => key + "=?").join(",");
          statements.push(db.prepare("UPDATE superchargers SET " + set + ", data_source='manual', updated_at=CURRENT_TIMESTAMP WHERE id IN (" + group.map(() => "?").join(",") + ")").bind(...values, ...group));
        }
        await db.batch(statements);
        await invalidatePublicMapCache();
        await db.prepare("INSERT INTO admin_audit_log (id,user_id,action,target_count,details) VALUES (?,?,?,?,?)")
          .bind(crypto.randomUUID(), admin.id, "supercharger_bulk_update", ids.length, JSON.stringify({ fields: keys })).run();
        return jsonResponse({ ok: true, updated: ids.length });
      } catch (error) {
        console.error("[TeslaNavigation] Direct admin D1 bulk update failed:", error);
        return jsonResponse({ error: error instanceof Error ? error.message : "Bulk bijwerken in D1 mislukt." }, 500);
      }
    }
    if (pathname === "/api/admin/superchargers" && request.method === "DELETE") {
      try {
        const db = getD1Binding(env);
        if (!db) return jsonResponse({ error: "Cloudflare D1-binding DB ontbreekt." }, 503);
        const admin = await authorizeAdmin(request, db);
        if (admin instanceof Response) return admin;
        const id = new URL(request.url).searchParams.get("id");
        if (!id || id.length > 120) return jsonResponse({ error: "Ongeldig Supercharger-ID." }, 400);
        const result = await db.prepare("DELETE FROM superchargers WHERE id = ?").bind(id).run();
        if (!result.meta?.changes) return jsonResponse({ error: "Supercharger niet gevonden." }, 404);
        await invalidatePublicMapCache();
        await db.prepare("INSERT INTO admin_audit_log (id,user_id,action,target_count,details) VALUES (?,?,?,?,?)")
          .bind(crypto.randomUUID(), admin.id, "supercharger_delete", 1, JSON.stringify({ id })).run();
        return jsonResponse({ ok: true });
      } catch (error) {
        console.error("[TeslaNavigation] Direct admin D1 delete failed:", error);
        return jsonResponse({ error: error instanceof Error ? error.message : "Verwijderen uit D1 mislukt." }, 500);
      }
    }
    // Public map feed: read the same live D1 records as Admin. A short edge
    // cache prevents every open map/tab from repeatedly scanning the full D1
    // table; a separate stale copy keeps the map usable during brief D1 outages.
    if (pathname === "/api/public/superchargers") {
      if (request.method !== "GET") return jsonResponse({ error: "Methode niet toegestaan." }, 405);
      const cache = caches.default;
      const cacheOrigin = new URL(request.url).origin;
      const freshKey = new Request(cacheOrigin + "/__cache/public-superchargers/fresh-v1");
      const staleKey = new Request(cacheOrigin + "/__cache/public-superchargers/stale-v1");
      const serveCached = async (key: Request, cacheState: "HIT" | "STALE"): Promise<Response | null> => {
        try {
          const cached = await cache.match(key);
          if (!cached) return null;
          const headers = new Headers(cached.headers);
          headers.set("cache-control", "no-store, max-age=0");
          headers.set("x-teslanavigation-map-cache", cacheState);
          return new Response(cached.body, { status: 200, headers });
        } catch (cacheError) {
          console.warn("[TeslaNavigation] Public map cache read failed:", cacheError);
          return null;
        }
      };
      const staleFallback = async (reason: string): Promise<Response> => {
        const stale = await serveCached(staleKey, "STALE");
        if (stale) {
          console.warn("[TeslaNavigation] Serving last good map feed because D1 is temporarily unavailable:", reason);
          return stale;
        }
        return jsonResponse({ error: reason }, 503);
      };

      const fresh = await serveCached(freshKey, "HIT");
      if (fresh) return fresh;

      try {
        const db = getD1Binding(env);
        if (!db) return await staleFallback("Cloudflare D1-binding DB ontbreekt.");
        // Use the same bounded live Supercharger query as the working admin.
        // Owner metadata is optional for route planning: an owner-table hiccup
        // must not make otherwise valid charger records unavailable.
        const chargerRows = await db.prepare(`
          SELECT * FROM superchargers
          WHERE COALESCE(hidden,0) = 0
          ORDER BY name COLLATE NOCASE
          LIMIT 5000
        `).all<Record<string, unknown>>();
        if (!Array.isArray(chargerRows.results)) {
          return await staleFallback("Cloudflare D1 gaf geen geldige openbare Superchargerdata terug.");
        }
        let ownerRows: { results?: Record<string, unknown>[] } = { results: [] };
        try {
          const owners = await db.prepare("SELECT id,name,logo_url,description,website,contact,notes FROM charger_owners ORDER BY name COLLATE NOCASE").all<Record<string, unknown>>();
          if (Array.isArray(owners.results)) ownerRows = owners;
        } catch (ownerError) {
          console.warn("[TeslaNavigation] Owner metadata unavailable; serving charger data without it:", ownerError);
        }
        const jsonColumns = ["opening_hours","charger_configs","parking_blocks","price_blocks","construction","works","closure","traffic_forecast","planned_upgrade","stall_states","voting","photos"];
        const boolColumns = ["trailer_friendly","is_available","parking_fee","in_parking_garage","low_speed","published","hidden"];
        const chargers = chargerRows.results.map((source) => {
          const row: Record<string, unknown> = { ...source };
          for (const key of jsonColumns) {
            if (typeof row[key] === "string") {
              try { row[key] = JSON.parse(row[key] as string); } catch { /* preserve legacy value */ }
            }
          }
          for (const key of boolColumns) {
            if (row[key] !== undefined && row[key] !== null) row[key] = Number(row[key]) === 1;
          }
          return row;
        });
        const payload = { chargers, owners: ownerRows.results };
        const response = jsonResponse(payload);
        // Keep the browser response private/no-store; only the Worker edge
        // cache gets a short freshness window and a longer stale-if-error copy.
        const freshHeaders = new Headers(response.headers);
        freshHeaders.set("cache-control", "public, max-age=20");
        const staleHeaders = new Headers(response.headers);
        staleHeaders.set("cache-control", "public, max-age=300");
        try {
          await Promise.all([
            cache.put(freshKey, new Response(response.clone().body, { status: 200, headers: freshHeaders })),
            cache.put(staleKey, new Response(response.clone().body, { status: 200, headers: staleHeaders })),
          ]);
        } catch (cacheError) {
          console.warn("[TeslaNavigation] Public map cache write failed:", cacheError);
        }
        response.headers.set("x-teslanavigation-map-cache", "MISS");
        return response;
      } catch (error) {
        console.error("[TeslaNavigation] Public D1 map feed failed:", error);
        return await staleFallback(error instanceof Error ? error.message : "Live Superchargerdata laden mislukt.");
      }
    }
    if (pathname === "/api/admin/superchargers") {
      try {
        return await handleAdminSuperchargerList(request, env);
      } catch (error) {
        console.error("[TeslaNavigation] Direct admin D1 list failed:", error);
        return jsonResponse({ error: error instanceof Error ? error.message : "Onbekende D1-fout." }, 500);
      }
    }
    try {
      // Expose the Cloudflare bindings on the same Request object used by
      // TanStack Start server functions. The D1 adapter reads this from
      // getRequest().runtime.cloudflare.env. Without this bridge the Worker
      // receives env in fetch(), but application server functions can see an
      // empty environment and every login/session query fails.
      const workerRequest = request as Request & {
        runtime?: { cloudflare?: { env?: unknown; ctx?: unknown } };
      };
      const previousRuntime = workerRequest.runtime ?? {};
      Object.defineProperty(workerRequest, "runtime", {
        configurable: true,
        value: {
          ...previousRuntime,
          cloudflare: {
            ...(previousRuntime.cloudflare ?? {}),
            env,
            ctx,
          },
        },
      });
      const handler = await getServerEntry();
      const response = await handler.fetch(workerRequest, env, ctx);
      return withBuildHeaders(await normalizeCatastrophicSsrResponse(response), env);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
