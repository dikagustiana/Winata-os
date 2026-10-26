import type { PGlite, Transaction } from "@electric-sql/pglite";
import type { DataClient, QueryResult, ViewerClaims } from "./types";

/**
 * Klien data lokal: meniru subset supabase-js yang dipakai aplikasi, tetapi
 * dieksekusi langsung di PGlite (ARCHITECTURE §5). Setiap query pengguna
 * dijalankan di dalam transaksi dengan `set local role authenticated` dan
 * `request.jwt.claims`, sehingga RLS dievaluasi seperti di Supabase.
 *
 * Klien tanpa claims (service) berjalan sebagai owner dan melewati RLS,
 * hanya dipakai worker/cron di server.
 */

const IDENT = /^[a-z_][a-z0-9_]*$/;
const COLUMNS = /^[a-zA-Z0-9_,* ]+$/;

type Param = unknown;
type Row = Record<string, unknown>;

interface Filter {
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "is" | "isnot" | "like" | "ilike";
  column: string;
  value: unknown;
}

interface Order {
  column: string;
  ascending: boolean;
}

interface State {
  mode: "select" | "insert" | "update" | "delete";
  table: string;
  columns: string;
  values: Row | Row[] | null;
  filters: Filter[];
  orders: Order[];
  limit: number | null;
  single: "none" | "single" | "maybe";
  onConflict: string | null;
  returning: boolean;
}

// Antrean global per database: PGlite satu koneksi, jadi query diserialkan.
const queues = new WeakMap<PGlite, Promise<unknown>>();

function serialize<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(db) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  queues.set(
    db,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`Nama tabel/kolom tidak valid: ${name}`);
  return `"${name}"`;
}

function columnList(columns: string): string {
  const trimmed = columns.trim();
  if (trimmed === "*" || trimmed === "") return "*";
  if (!COLUMNS.test(trimmed)) throw new Error(`Daftar kolom tidak valid: ${columns}`);
  return trimmed
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => (c === "*" ? "*" : c))
    .join(", ");
}

function placeholders(count: number, params: Param[], value: Param, cast?: string): string {
  params.push(value);
  return `$${params.length}${cast ? `::${cast}` : ""}`;
}

function buildWhere(filters: Filter[], params: Param[]): string {
  if (filters.length === 0) return "";
  const parts = filters.map((f) => {
    const col = ident(f.column);
    switch (f.op) {
      case "eq":
        return f.value === null ? `${col} is null` : `${col} = ${placeholders(1, params, f.value)}`;
      case "neq":
        return `${col} <> ${placeholders(1, params, f.value)}`;
      case "gt":
        return `${col} > ${placeholders(1, params, f.value)}`;
      case "gte":
        return `${col} >= ${placeholders(1, params, f.value)}`;
      case "lt":
        return `${col} < ${placeholders(1, params, f.value)}`;
      case "lte":
        return `${col} <= ${placeholders(1, params, f.value)}`;
      case "in": {
        const values = f.value as unknown[];
        if (values.length === 0) return "false";
        const list = values.map((v) => placeholders(1, params, v)).join(", ");
        return `${col} in (${list})`;
      }
      case "is":
        return `${col} is ${f.value === null ? "null" : String(f.value)}`;
      case "isnot":
        return `${col} is not ${f.value === null ? "null" : String(f.value)}`;
      case "like":
        return `${col} like ${placeholders(1, params, f.value)}`;
      case "ilike":
        return `${col} ilike ${placeholders(1, params, f.value)}`;
    }
  });
  return ` where ${parts.join(" and ")}`;
}

function sqlValue(value: unknown, params: Param[]): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "object" && !(value instanceof Date)) {
    return placeholders(1, params, JSON.stringify(value), "jsonb");
  }
  return placeholders(1, params, value);
}

class QueryBuilder<T = Row> implements PromiseLike<QueryResult<T[]>> {
  private state: State;

  constructor(
    private client: LocalPgClient,
    table: string,
    mode: State["mode"],
  ) {
    if (!IDENT.test(table)) throw new Error(`Nama tabel tidak valid: ${table}`);
    this.state = {
      mode,
      table,
      columns: "*",
      values: null,
      filters: [],
      orders: [],
      limit: null,
      single: "none",
      onConflict: null,
      returning: false,
    };
  }

  select(columns = "*"): this {
    this.state.columns = columns;
    this.state.returning = true;
    return this;
  }

  insert(values: Row | Row[]): this {
    this.state.mode = "insert";
    this.state.values = values;
    return this;
  }

  update(values: Row): this {
    this.state.mode = "update";
    this.state.values = values;
    return this;
  }

  delete(): this {
    this.state.mode = "delete";
    return this;
  }

  upsert(values: Row | Row[], options?: { onConflict?: string }): this {
    this.state.mode = "insert";
    this.state.values = values;
    this.state.onConflict = options?.onConflict ?? "id";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.state.filters.push({ op: "eq", column, value });
    return this;
  }
  neq(column: string, value: unknown): this {
    this.state.filters.push({ op: "neq", column, value });
    return this;
  }
  gt(column: string, value: unknown): this {
    this.state.filters.push({ op: "gt", column, value });
    return this;
  }
  gte(column: string, value: unknown): this {
    this.state.filters.push({ op: "gte", column, value });
    return this;
  }
  lt(column: string, value: unknown): this {
    this.state.filters.push({ op: "lt", column, value });
    return this;
  }
  lte(column: string, value: unknown): this {
    this.state.filters.push({ op: "lte", column, value });
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.state.filters.push({ op: "in", column, value: values });
    return this;
  }
  is(column: string, value: null | boolean): this {
    this.state.filters.push({ op: "is", column, value });
    return this;
  }
  like(column: string, value: string): this {
    this.state.filters.push({ op: "like", column, value });
    return this;
  }
  ilike(column: string, value: string): this {
    this.state.filters.push({ op: "ilike", column, value });
    return this;
  }
  not(column: string, operator: "is", value: null | boolean): this {
    if (operator === "is") this.state.filters.push({ op: "isnot", column, value });
    return this;
  }
  order(column: string, options?: { ascending?: boolean }): this {
    this.state.orders.push({ column, ascending: options?.ascending ?? true });
    return this;
  }
  limit(count: number): this {
    this.state.limit = count;
    return this;
  }
  single(): Promise<QueryResult<T>> {
    this.state.single = "single";
    return this.executeOne() as Promise<QueryResult<T>>;
  }
  maybeSingle(): Promise<QueryResult<T | null>> {
    this.state.single = "maybe";
    return this.executeOne() as Promise<QueryResult<T | null>>;
  }

  private build(): { sql: string; params: Param[] } {
    const s = this.state;
    const params: Param[] = [];
    if (s.mode === "select") {
      let sql = `select ${columnList(s.columns)} from public.${ident(s.table)}`;
      sql += buildWhere(s.filters, params);
      if (s.orders.length) {
        sql += ` order by ${s.orders.map((o) => `${ident(o.column)} ${o.ascending ? "asc" : "desc"}`).join(", ")}`;
      }
      if (s.limit !== null) sql += ` limit ${Math.max(0, Math.floor(s.limit))}`;
      return { sql, params };
    }

    if (s.mode === "insert") {
      const rows = Array.isArray(s.values) ? s.values : [s.values ?? {}];
      if (rows.length === 0) throw new Error("Insert tanpa nilai");
      const columns = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
      columns.forEach((c) => ident(c));
      const tuples = rows.map(
        (row) => `(${columns.map((c) => sqlValue(row[c], params)).join(", ")})`,
      );
      let sql = `insert into public.${ident(s.table)} (${columns.map(ident).join(", ")}) values ${tuples.join(", ")}`;
      if (s.onConflict) {
        const conflict = s.onConflict
          .split(",")
          .map((c) => ident(c.trim()))
          .join(", ");
        const updates = columns
          .filter((c) => c !== "id" && c !== "created_at")
          .map((c) => `${ident(c)} = excluded.${ident(c)}`)
          .join(", ");
        sql += ` on conflict (${conflict}) do update set ${updates || `${ident(columns[0])} = excluded.${ident(columns[0])}`}`;
      }
      if (s.returning) sql += ` returning ${columnList(s.columns)}`;
      return { sql, params };
    }

    if (s.mode === "update") {
      const values = s.values ?? {};
      const assignments = Object.entries(values)
        .map(([c, v]) => `${ident(c)} = ${sqlValue(v, params)}`)
        .join(", ");
      let sql = `update public.${ident(s.table)} set ${assignments}`;
      sql += buildWhere(s.filters, params);
      if (s.returning) sql += ` returning ${columnList(s.columns)}`;
      return { sql, params };
    }

    let sql = `delete from public.${ident(s.table)}`;
    sql += buildWhere(s.filters, params);
    if (s.returning) sql += ` returning ${columnList(s.columns)}`;
    return { sql, params };
  }

  private async execute(): Promise<QueryResult<T[]>> {
    const { sql, params } = this.build();
    const result = await this.client.runQuery(sql, params);
    if (result.error) return { data: null, error: result.error };
    return { data: result.rows as T[], error: null };
  }

  private async executeOne(): Promise<QueryResult<T | null>> {
    const { sql, params } = this.build();
    const result = await this.client.runQuery(sql, params);
    if (result.error) return { data: null, error: result.error };
    const rows = result.rows as T[];
    if (this.state.single === "single") {
      if (rows.length !== 1) {
        return { data: null, error: { message: `Diharapkan 1 baris, didapat ${rows.length}`, code: "PGRST116" } };
      }
      return { data: rows[0], error: null };
    }
    return { data: rows[0] ?? null, error: null };
  }

  then<TResult1 = QueryResult<T[]>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<T[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export class LocalPgClient implements DataClient {
  constructor(
    private db: PGlite,
    private claims: ViewerClaims | null = null,
  ) {}

  from<T = Row>(table: string): QueryBuilder<T> {
    return new QueryBuilder<T>(this, table, "select");
  }

  async runQuery(
    sql: string,
    params: Param[] = [],
  ): Promise<{ rows: unknown[]; error: { message: string; code?: string } | null }> {
    return serialize(this.db, async () => {
      try {
        const rows = await this.db.transaction(async (tx) => {
          await this.applyClaims(tx);
          const result = await tx.query(sql, params);
          return result.rows;
        });
        return { rows, error: null };
      } catch (error) {
        const err = error as Error & { code?: string };
        return { rows: [], error: { message: err.message, code: err.code } };
      }
    });
  }

  async rpc<T = Row>(fn: string, args: Record<string, unknown> = {}): Promise<QueryResult<T | T[]>> {
    if (!IDENT.test(fn)) return { data: null, error: { message: `Nama fungsi tidak valid: ${fn}` } };
    const params: Param[] = [];
    const named = Object.entries(args).map(([key, value]) => {
      if (!IDENT.test(key)) throw new Error(`Nama argumen tidak valid: ${key}`);
      if (value !== null && typeof value === "object" && !(value instanceof Date)) {
        return `${key} := ${placeholders(1, params, JSON.stringify(value), "jsonb")}`;
      }
      return `${key} := ${placeholders(1, params, value)}`;
    });
    const sql = `select * from public.${ident(fn)}(${named.join(", ")})`;
    const result = await this.runQuery(sql, params);
    if (result.error) return { data: null, error: result.error };
    const rows = result.rows as T[];
    if (rows.length === 1) return { data: rows[0] as T, error: null };
    return { data: rows, error: null };
  }

  private async applyClaims(tx: Transaction): Promise<void> {
    if (!this.claims) return;
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({
        sub: this.claims.userId,
        email: this.claims.email,
        role: "authenticated",
        aud: "authenticated",
      }),
    ]);
    await tx.exec(`set local role authenticated`);
  }
}

export function createLocalClient(db: PGlite, claims: ViewerClaims | null = null): LocalPgClient {
  return new LocalPgClient(db, claims);
}
