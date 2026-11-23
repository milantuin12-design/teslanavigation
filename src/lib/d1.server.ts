import { env } from "cloudflare:workers";
import { getRequest } from "@tanstack/react-start/server";

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta?: { changes?: number; last_row_id?: number };
}
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  run(): Promise<D1Result>;
}
export interface D1Database {
  prepare(query: string): D1Statement;
  batch<T = unknown>(statements: D1Statement[]): Promise<D1Result<T>[]>;
}

/**
 * Prefer Cloudflare's request-scoped env binding. The Worker entry also
 * attaches the bindings to the TanStack request as a compatibility fallback
 * for server-function requests. Keep the module binding as the final fallback
 * for contexts where getRequest() is not available.
 */
export function getCloudflareEnv(): Record<string, unknown> {
  const moduleEnv = env as unknown as Record<string, unknown>;

  // For request-bound server functions, prefer the bindings attached to this
  // exact Worker request. The module-scoped env is only a fallback for contexts
  // where TanStack has no active request; preferring it can select an empty or
  // stale binding during Worker version propagation.
  try {
    const request = getRequest() as Request & {
      runtime?: { cloudflare?: { env?: Record<string, unknown> } };
    };
    const requestEnv = request.runtime?.cloudflare?.env;
    if (requestEnv && typeof requestEnv === "object" && requestEnv.DB) return requestEnv;
  } catch {
    // getRequest() is unavailable outside an active TanStack request context.
  }

  return moduleEnv;
}

export function getD1(): D1Database {
  const db = getCloudflareEnv().DB as D1Database | undefined;
  if (!db) {
    throw new Error("Cloudflare D1-binding ontbreekt. Controleer DB in wrangler.toml en publiceer de Worker opnieuw.");
  }
  return db;
}

export function jsonColumn(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}
