# ARCHITECTURE v1.1 — Hardening & Cloud (adendum)

Menambah `ARCHITECTURE.md`. Bagian yang tidak disebut tetap berlaku.

## 1. Gambaran cloud

```
Browser ──► Vercel sin1 (Next.js 15)
              │  server action / RSC ──► supabase-js (anon key + cookie JWT) ──► PostgREST ──► Postgres (RLS)
              │  rebuildLocal (inline ≤ 7 tgl) ──┐
              │  /api/cron/rebuild (tiap jam)     ├─► pg.Pool (SUPABASE_DB_URL, pooler 6543) ──► Postgres (bypass RLS: role postgres)
              │  /api/cron/controls (20:00 WIB)  ─┘
              └  auth.admin.createUser / Storage ──► service-role key (hanya server; env diisi pemilik)
```

**K17:** worker cloud adalah kode worker yang sama (`packages/db/src/{rebuild,controls,outlook-worker}.ts`) yang dijalankan terhadap `Queryable` berbasis `pg`. Tidak ada jalur PostgREST untuk worker, sehingga tidak ada paginasi 1000 baris, tidak ada serialisasi ganda `numeric`, dan tidak ada implementasi kedua untuk diuji.

## 2. `Queryable` dan adapter

```ts
// packages/db/src/queryable.ts
export interface QueryResultLike<T> { rows: T[] }
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResultLike<T>>;
}
```

- PGlite memenuhi antarmuka ini apa adanya. Semua fungsi worker mengganti tipe parameter `PGlite` → `Queryable`. Tes v1 tidak berubah.
- `packages/db/src/pg-cloud.ts` (`createCloudDb(url): Queryable & { end(): Promise<void> }`):
  - `new Pool({ connectionString, max: 1, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000, ssl: { rejectUnauthorized: false } })` — satu koneksi per instance serverless; pooler Supabase **transaction mode** (port 6543) → tidak memakai prepared statement bernama, tidak memakai `set role`/`set_config` lintas query (worker tidak membutuhkannya karena berjalan sebagai `postgres`).
  - Parser tipe (`pg.types.setTypeParser`): OID 1082 `date` → string `YYYY-MM-DD` (tanpa konversi zona waktu); 1114/1184 timestamp → string ISO; 1700 `numeric` tetap string; 20 `int8` → `Number` bila aman. Alasan: worker membandingkan tanggal sebagai string dan memakai `decimal.js` dari string, sama seperti dari PGlite. **Tes:** `packages/db/test/pg-types.test.ts` memverifikasi parser dengan nilai contoh (tanpa koneksi).
- `apps/web/lib/cloud-db.ts`: `getWorkerDb()` → `getLocalDb()` bila `isMockAuth()`, selain itu singleton `createCloudDb(requireEnv("SUPABASE_DB_URL"))` yang disimpan di `globalThis` agar dipakai ulang antar invokasi hangat.

## 3. Jalur rebuild di cloud

- **Inline:** `rebuildLocal(locationId, fromDate)` → `getWorkerDb()` → `rebuildPositions(db, { locationIds:[loc], fromDate })` bila `diffDays(today, fromDate) ≤ 7`, lalu `processControls(db, fromDate)` dan `(today)`; selain itu hanya `enqueue_rebuild` (sudah dilakukan trigger) dan cron mengambil. Galat ditangkap dan dicatat; aksi pengguna tetap sukses (data sudah tersimpan; antrean menjamin konsistensi).
- **Cron:** `GET /api/cron/rebuild` → `processRebuildQueue(db, 10)` → `refreshProjection(db)` → `processControls(db, today)`; `maxDuration = 300`; `dynamic = "force-dynamic"`; `runtime = "nodejs"`. `GET /api/cron/controls` → `processControls(db, date)`. Keduanya menolak tanpa `Authorization: Bearer $CRON_SECRET` (401) dan tanpa `SUPABASE_DB_URL` (503 dengan pesan nama variabel).
- **Bootstrap:** `GET /api/cron/rebuild?full=1&from=YYYY-MM-DD` menjalankan `rebuildAll(db, from)` untuk semua lokasi (dipakai sekali sesudah BA T0 diimpor).

## 4. Antrean versi (R-65)

```
rebuild_queue + generation bigint not null default 0
enqueue_rebuild(loc, from):   upsert; from_date = least(...); status = 'queued' bila 'done'/'queued'; bila 'running' status tetap 'running' tetapi generation += 1 dan from_date = least(...)
claim_rebuild(n):             ... returning location_id, from_date, generation
mark_rebuild_done(loc, gen):  update set status = case when generation = gen then 'done' else 'queued' end, claimed_at = null
```

Worker memanggil `mark_rebuild_done(location, generation)` dengan `generation` dari klaim. Bila ada enqueue di tengah, baris kembali `queued` dengan `from_date` terkecil dan diambil pada siklus berikutnya. Tanda tangan lama `mark_rebuild_done(uuid)` dipertahankan sebagai wrapper (generation = -1 → selalu `queued`) agar kode lama tidak rusak, lalu dihapus dari pemanggil.

## 5. Penjaga di database (R-60…R-69)

Semua trigger memeriksa `current_app_role()`; bila **null** (role `postgres`/`service_role`, worker, seed, importer server-side) trigger tidak membatasi. Pola:

```sql
create or replace function enforce_actor() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_app_role() is null then return new; end if;
  if tg_op = 'INSERT' then new.created_by := auth.uid();
  elsif new.created_by is distinct from old.created_by then
    raise exception 'created_by tidak boleh diubah' using errcode = '42501';
  end if;
  -- kolom aktor lain lewat tg_argv[0] (daftar kolom): bila diubah, harus = auth.uid()
  return new;
end $$;
```

- `correction_guard` (R-60): memakai `current_setting('winata.rpc', true)`; `approve_correction`/`post_correction` memanggil `perform set_config('winata.rpc', 'correction', true)` di awal (lokal transaksi) sehingga hanya jalur RPC yang bisa mengubah status. Perubahan isi pada `approved` → `new.status := 'draft'; new.approved_by := null; new.approved_at := null`.
- `soft_delete_guard` (R-63): `deleted_at` hanya `null → not null`; `delete_reason` (kolom baru, text) wajib untuk `opname.signed`, `correction.posted`, dan semua baris di hari `approved` oleh accounting; `authenticated` tidak boleh mengubah kolom lain bersamaan dengan `deleted_at`.
- `revoke delete on table <daftar> from authenticated` + `drop policy *_delete`. Daftar: `opname, opname_line, production, outbound, outbound_line, transfer, shrinkage, physical_count, physical_count_line, correction, sales_plan, market_price, cash_plan, cash_balance, flock, flock_depletion, location, house, grade, unit_conversion, customer, parameter, item_map, app_user, user_location`. (`user_location` memakai kolom `deleted_at` baru; policy baca memfilter `deleted_at is null`; `my_locations()` ikut memfilter.)
- `outbound_guard` (R-68) menggantikan trigger `guard_changed_columns('status,delivered_at,delivered_by','kandang')` dengan fungsi khusus yang memeriksa transisi per peran.
- `auth_users_link` (R-64): `after insert on auth.users` → `update app_user set id = new.id where lower(email) = lower(new.email) and id <> new.id`. FK yang mereferensikan `app_user(id)`: `user_location.user_id`, `day_status.{submitted_by,approved_by,locked_by}`, `opname.{counter_id,witness_id,manager_id}`, `outbound.delivered_by`, `physical_count.{counted_by,checked_by}`, `correction.approved_by` → drop + add `on update cascade`. Kolom `created_by` tanpa FK: fungsi yang sama menjalankan `update <tabel> set created_by = new.id where created_by = old_id` untuk daftar tabel (loop `format`).
- `create_login(p_email, p_password)` (security definer, `revoke from public`, `grant to service_role`): di Supabase menulis `auth.users` lengkap (`instance_id '00000000-0000-0000-0000-000000000000'`, `aud 'authenticated'`, `role 'authenticated'`, `email_confirmed_at now()`, `raw_app_meta_data '{"provider":"email","providers":["email"]}'`, `raw_user_meta_data '{}'`, `encrypted_password extensions.crypt(p, extensions.gen_salt('bf'))`, `created_at/updated_at`) dan baris `auth.identities` (`provider 'email'`, `provider_id = email`, `identity_data {sub,email}`); di PGlite memakai shim `password_hash` seperti `set_login_password`. Dipanggil lewat `execute_sql` MCP (berjalan sebagai `postgres`).

## 6. Auth di cloud (R-64, R-72)

- Buat akun lewat app: `app_user` insert (id sementara `gen_random_uuid()`) → `auth.admin.createUser` → trigger allow-list lolos (e-mail sudah ada) → `auth_users_link` menyamakan id → cascade. Bila `createUser` gagal, `app_user` yang baru dibuat dihapus (`deleted_at`) oleh aksi.
- `isMockAuth()`:
  ```ts
  export function isMockAuth(): boolean {
    if (process.env.VERCEL) return false;
    if (process.env.NODE_ENV === "production" && process.env.MOCK_AUTH_ALLOW_PRODUCTION_BUILD !== "1") return false;
    return process.env.MOCK_AUTH === "1" || process.env.NODE_ENV === "test";
  }
  ```
  `scripts/e2e-server.mjs` dan CI mengeset `MOCK_AUTH_ALLOW_PRODUCTION_BUILD=1` untuk `next start`.
- Login mock: `password_hash` null → tolak dengan pesan "Akun belum punya kata sandi".
- `setPasswordAction` cloud: `auth.admin.listUsers({ page, perPage: 200 })` berulang sampai e-mail ditemukan, atau lebih baik `getUserById(app_user.id)` karena id sudah sama (R-64).

## 7. Supabase & Vercel (M9)

- Project: `winata-egg-position`, `ap-southeast-1`. Migrasi lewat `apply_migration` MCP berurutan; `supabase/migrations/*.sql` tetap sumber kebenaran (CLI `db push` di masa depan memakai file yang sama; nama migrasi = nama file tanpa `.sql` agar `supabase migration list` konsisten).
- Pooler: `SUPABASE_DB_URL = postgresql://postgres.<ref>:<db_pass>@<pooler-host>:6543/postgres` (transaction mode). Host pooler diambil dari `get_project` (field `database.host`/connection info) atau `search_docs` "connection pooling"; jangan ditebak. `sslmode=require`.
- Vercel: root `apps/web`; Next.js mendeteksi monorepo pnpm dari lockfile root. Install command di root: `pnpm install --frozen-lockfile`; build: `pnpm --filter @winata/web build`; output default. `vercel.json` sudah berisi `regions` dan `crons`. Env ke production dan preview; preview memakai DB yang sama (K16) — preview **tidak** boleh dibuka ke publik: aktifkan Vercel Authentication untuk preview bila tersedia.
- Backup: `backup.yml` dibuat di repo tetapi memerlukan secret `SUPABASE_DB_URL` **koneksi langsung** (port 5432, bukan pooler) yang diisi pemilik; dicatat sebagai tindakan pagi.

## 8. Yang tidak berubah

Engine murni, DESIGN token, skema v1 (hanya ditambah: `rebuild_queue.generation`, `delete_reason` di tabel transaksi, `user_location.deleted_at`, parameter baru), RLS baca, `claim_rebuild`, alur status hari.
