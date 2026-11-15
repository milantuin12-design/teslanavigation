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

export function getD1(): D1Database {
  const request = getRequest() as Request & {
    runtime?: { cloudflare?: { env?: { DB?: D1Database } } };
  };
  const db = request.runtime?.cloudflare?.env?.DB;
  if (!db) {
    throw new Error("Cloudflare D1 is niet beschikbaar. Publiceer de Worker met de DB-binding uit wrangler.toml.");
  }
  return db;
}

export function jsonColumn(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}
