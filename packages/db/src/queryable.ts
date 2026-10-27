/**
 * K17 / ARCHITECTURE-v1.1 §2: permukaan minimum yang dipakai worker
 * (rebuild, kontrol, proyeksi). PGlite memenuhinya apa adanya; di cloud
 * `createCloudDb` (pg.Pool ke pooler Supabase) memenuhinya juga, sehingga
 * engine dan kode worker sama persis di lokal dan cloud.
 */
export interface QueryResultLike<T> {
  rows: T[];
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResultLike<T>>;
}
