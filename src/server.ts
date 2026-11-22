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


type AdminD1Database = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      all<T = Record<string, unknown>>(): Promise<{ results?: T[]; success?: boolean }>;
    };
    all<T = Record<string, unknown>>(): Promise<{ results?: T[]; success?: boolean }>;
  };
};

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

  const bindings = workerEnv as { DB?: AdminD1Database } | null;
  const db = bindings?.DB;
  if (!db) return jsonResponse({ error: "Cloudflare D1-binding DB ontbreekt." }, 503);

  const admin = await authorizeAdmin(request, db);
  if (admin instanceof Response) return admin;
  try {
    const { ensureBundledD1Seed } = await import("./lib/d1-seed.server");
    await ensureBundledD1Seed();
  } catch (error) {
    console.error("[TeslaNavigation] Safe missing-row seed skipped; reading existing D1 rows:", error);
  }

  const result = await db.prepare(`
    SELECT * FROM superchargers
    WHERE LOWER(TRIM(COALESCE(status, ''))) NOT IN ('plan','planned','voting')
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
    if (pathname === "/api/admin/me") {
      if (request.method !== "GET") return jsonResponse({ error: "Methode niet toegestaan." }, 405);
      try {
        const db = (env as { DB?: AdminD1Database } | null)?.DB;
        if (!db) return jsonResponse({ error: "Cloudflare D1-binding DB ontbreekt." }, 503);
        const admin = await authorizeAdmin(request, db);
        if (admin instanceof Response) return admin;
        return jsonResponse({ is_admin: true });
      } catch (error) {
        console.error("[TeslaNavigation] Admin session check failed:", error);
        return jsonResponse({ error: error instanceof Error ? error.message : "Sessiecontrole mislukt." }, 500);
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
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
