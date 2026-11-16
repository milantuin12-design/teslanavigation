import { env } from "cloudflare:workers";

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
 * Cloudflare injects Worker bindings through the cloudflare:workers module.
 * Do not read them from TanStack's Request object: internal server-function
 * requests do not reliably preserve custom Request properties.
 */
export function getCloudflareEnv(): Record<string, unknown> {
  return env as unknown as Record<string, unknown>;
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
