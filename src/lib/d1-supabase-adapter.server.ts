import { getD1, jsonColumn } from "./d1.server";

const TABLES = new Set(["users","user_roles","sessions","charger_owners","superchargers","charger_reports","report_messages","charger_changes","admin_audit_log","site_updates","vehicle_models","saved_routes","languages","translations"]);
const JSON_COLUMNS = new Set(["construction","works","closure","versions","opening_hours","charger_configs","planned_upgrade","stall_states","voting","photos","price_blocks","parking_blocks","traffic_forecast","details","changed_fields","connectors","payload"]);
const BOOL_COLUMNS = new Set(["trailer_friendly","is_available","parking_fee","in_parking_garage","low_speed","published","hidden","shared","visible","enabled","is_default","rtl","blocked","email_verified","is_admin"]);
const ident = (value: string) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error("Ongeldige databasekolom.");
  return `"${value}"`;
};
function encode(value: unknown, column: string): unknown {
  if (JSON_COLUMNS.has(column)) return jsonColumn(value);
  if (BOOL_COLUMNS.has(column) && typeof value === "boolean") return value ? 1 : 0;
  return value;
}
function decode(row: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...row };
  for (const [key, value] of Object.entries(out)) {
    if (JSON_COLUMNS.has(key) && typeof value === "string") {
      try { out[key] = JSON.parse(value); } catch { /* leave legacy text untouched */ }
    }
    if (BOOL_COLUMNS.has(key) && (value === 0 || value === 1)) out[key] = value === 1;
  }
  return out;
}

type Filter = { column: string; op: "=" | "!=" | "IS"; value: unknown };
class Query {
  private action: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private columns = "*";
  private values: Record<string, unknown>[] = [];
  private filters: Filter[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private maxRows: number | null = null;
  private offset = 0;
  private cardinality: "many" | "single" | "maybe" = "many";
  private conflict = "id";
  constructor(private table: string) {
    if (!TABLES.has(table)) throw new Error(`Tabel niet toegestaan: ${table}`);
  }
  select(columns = "*") { this.columns = columns; return this; }
  insert(values: Record<string, unknown> | Record<string, unknown>[]) { this.action = "insert"; this.values = Array.isArray(values) ? values : [values]; return this; }
  update(values: Record<string, unknown>) { this.action = "update"; this.values = [values]; return this; }
  delete() { this.action = "delete"; return this; }
  upsert(values: Record<string, unknown> | Record<string, unknown>[], options?: { onConflict?: string }) { this.action = "upsert"; this.values = Array.isArray(values) ? values : [values]; this.conflict = options?.onConflict || "id"; return this; }
  eq(column: string, value: unknown) { this.filters.push({ column, op: "=", value }); return this; }
  neq(column: string, value: unknown) { this.filters.push({ column, op: "!=", value }); return this; }
  is(column: string, value: unknown) { this.filters.push({ column, op: "IS", value }); return this; }
  in(column: string, values: unknown[]) { this.filters.push({ column, op: "=", value: { __in: values } }); return this; }
  order(column: string, options?: { ascending?: boolean }) { this.orders.push({ column, ascending: options?.ascending !== false }); return this; }
  limit(value: number) { this.maxRows = Math.max(0, Math.min(10000, value)); return this; }
  range(from: number, to: number) { this.offset = Math.max(0, from); this.maxRows = Math.max(0, Math.min(10000, to - from + 1)); return this; }
  single() { this.cardinality = "single"; return this; }
  maybeSingle() { this.cardinality = "maybe"; return this; }
  then<TResult1 = { data: unknown; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
  private where() {
    const clauses: string[] = [];
    const params: unknown[] = [];
    for (const f of this.filters) {
      const col = ident(f.column);
      if (f.value && typeof f.value === "object" && "__in" in (f.value as object)) {
        const vals = (f.value as { __in: unknown[] }).__in;
        if (!vals.length) clauses.push("1 = 0");
        else { clauses.push(`${col} IN (${vals.map(() => "?").join(",")})`); params.push(...vals.map(v => encode(v, f.column))); }
      } else if (f.value === null) clauses.push(`${col} ${f.op === "!=" ? "IS NOT" : "IS"} NULL`);
      else { clauses.push(`${col} ${f.op} ?`); params.push(encode(f.value, f.column)); }
    }
    return { sql: clauses.length ? " WHERE " + clauses.join(" AND ") : "", params };
  }
  private async execute(): Promise<{ data: unknown; error: { message: string } | null }> {
    try {
      const db = getD1();
      const { sql: whereSql, params: whereParams } = this.where();
      let statement = "";
      let params: unknown[] = [];
      if (this.action === "select") {
        statement = `SELECT ${this.columns === "*" ? "*" : this.columns.split(",").map(c => ident(c.trim())).join(",")} FROM ${ident(this.table)}${whereSql}`;
        params = [...whereParams];
        if (this.orders.length) statement += " ORDER BY " + this.orders.map(o => `${ident(o.column)} ${o.ascending ? "ASC" : "DESC"}`).join(",");
        if (this.maxRows !== null) { statement += " LIMIT ? OFFSET ?"; params.push(this.maxRows, this.offset); }
      } else if (this.action === "update") {
        const row = this.values[0] ?? {};
        const entries = Object.entries(row);
        if (!entries.length) return { data: null, error: null };
        statement = `UPDATE ${ident(this.table)} SET ${entries.map(([k]) => `${ident(k)} = ?`).join(",")}${whereSql}`;
        params = [...entries.map(([k,v]) => encode(v,k)), ...whereParams];
        if (this.columns !== "*") statement += ` RETURNING ${this.columns.split(",").map(c => ident(c.trim())).join(",")}`;
      } else if (this.action === "delete") {
        statement = `DELETE FROM ${ident(this.table)}${whereSql}`;
        params = [...whereParams];
        if (this.columns !== "*") statement += ` RETURNING ${this.columns.split(",").map(c => ident(c.trim())).join(",")}`;
      } else {
        if (!this.values.length) return { data: [], error: null };
        const cols = [...new Set(this.values.flatMap(v => Object.keys(v)))];
        const rows = this.values.map(v => `(${cols.map(() => "?").join(",")})`).join(",");
        statement = `INSERT INTO ${ident(this.table)} (${cols.map(ident).join(",")}) VALUES ${rows}`;
        params = this.values.flatMap(v => cols.map(c => encode(v[c], c) ?? null));
        if (this.action === "upsert") {
          const conflictCols = this.conflict.split(",").map(s => s.trim());
          const updates = cols.filter(c => !conflictCols.includes(c));
          statement += updates.length
            ? ` ON CONFLICT (${conflictCols.map(ident).join(",")}) DO UPDATE SET ${updates.map(c => `${ident(c)} = excluded.${ident(c)}`).join(",")}`
            : ` ON CONFLICT (${conflictCols.map(ident).join(",")}) DO NOTHING`;
        }
        if (this.columns !== "*") statement += ` RETURNING ${this.columns.split(",").map(c => ident(c.trim())).join(",")}`;
      }
      const stmt = db.prepare(statement).bind(...params);
      const returnsRows = this.action === "select" || this.columns !== "*";
      if (!returnsRows) {
        const result = await stmt.run();
        return { data: null, error: null };
      }
      const result = await stmt.all<Record<string, unknown>>();
      const rows = (result.results ?? []).map(decode);
      if (this.cardinality === "single") {
        if (rows.length !== 1) throw new Error(`Verwacht één rij, kreeg ${rows.length}.`);
        return { data: rows[0], error: null };
      }
      if (this.cardinality === "maybe") {
        if (rows.length > 1) throw new Error("Verwacht maximaal één rij.");
        return { data: rows[0] ?? null, error: null };
      }
      return { data: rows, error: null };
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : String(error) } };
    }
  }
}

export function createD1SupabaseClient() {
  return {
    from(table: string) { return new Query(table); },
    async rpc(name: string, args: { _user_id: string; _role: string }) {
      if (name !== "has_role") return { data: null, error: { message: "Onbekende databasefunctie." } };
      try {
        const row = await getD1().prepare("SELECT 1 AS allowed FROM user_roles WHERE user_id = ? AND role = ? LIMIT 1")
          .bind(args._user_id, args._role).first<{ allowed: number }>();
        return { data: !!row, error: null };
      } catch (error) { return { data: null, error: { message: error instanceof Error ? error.message : String(error) } }; }
    },
  };
}
