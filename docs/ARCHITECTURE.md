# ARCHITECTURE — Winata Egg Position v1

## 1. Gambaran

```
HP kandang / marketing ──┐
Laptop manager/accounting├──► Vercel (Next.js 15, App Router, server actions) ──► Supabase (Postgres + Auth + Storage + Realtime)
BoD (baca)            ──┘            │                                                 ▲
                                      └── /api/cron/rebuild, /api/cron/controls ─────────┘ (service role, bearer CRON_SECRET)
```

- **Hitung sekali, baca banyak** (pelajaran KGR v6): halaman tidak menghitung posisi; mereka membaca `position_daily`, `projection_daily`, `control_result` yang ditulis worker. Perubahan transaksi mengantre tanggal yang terpengaruh; worker membangun ulang dari tanggal itu ke depan.
- **Aturan di database**: RLS per peran, transisi status dan K9 sebagai fungsi SQL `security definer` dengan cek peran di dalamnya, sehingga tidak bisa dilewati dari API langsung.
- **Engine murni** di `packages/engine` (TS + decimal.js), tanpa I/O, diuji golden. Worker dan server action memanggilnya.

## 2. Repo

```
winata-egg-position/
  apps/web/                 Next.js 15, TS strict, Bahasa Indonesia
    app/                    rute (lihat DESIGN §3)
    app/api/cron/           rebuild, controls
    components/ui/          komponen DESIGN §2
    lib/                    supabase client (server/browser/service), session, rebuild, controls, actions
    lib/offline/            IndexedDB draft + sync (K8)
    middleware.ts           cek sesi + peran per rute
  packages/engine/          position, aging, conversion, daysOfStock, valuation, hdp, projection, pricing, cash13, cull, reconstruct, controls
  packages/parsers/         CSV importer (R-50), Accurate xlsx/csv (M5)
  packages/db/              tipe hasil `supabase gen types`, klien PGlite untuk tes, helper asRole()
  supabase/
    migrations/             0001_schema … 0007_recon (urut, tidak diubah sesudah merge)
    seed/                   master, parameter, hdp_standard, user uji
    tests/                  pgTAP-style SQL yang dijalankan di PGlite oleh vitest
  fixtures/                 week-example (M1), outlook-example (M3), cash-example (M4), accurate-example (M5), reconstruct-example (M6)
  tests/e2e/                Playwright journeys H, A, dan per milestone
  docs/                     PRD-v1, PLAN, DESIGN, ARCHITECTURE, PROMPT-DEEPSEEK, QUESTIONS, log/M{n}.md, reference/
  .github/workflows/ci.yml  typecheck, test, e2e, lint
```

Paket: Next.js 15, React 19, TypeScript 5.x strict, `@supabase/ssr`, `@supabase/supabase-js`, `decimal.js`, `zod`, `@electric-sql/pglite` (dev), `vitest`, `@playwright/test`, `xlsx` (versi dari npm resmi `xlsx@0.18.5`; **jangan** `cdn.sheetjs.com`), `exceljs` untuk ekspor. Tanpa ORM; SQL dan RPC lewat supabase-js.

## 3. Skema inti (ringkas)

Semua tabel: `id uuid pk default gen_random_uuid()`, `created_at`, `created_by uuid`, `updated_at`, `deleted_at` (soft delete). Kolom kuantitas `numeric(14,3)`; Rp `numeric(18,2)`.

```
location(code, name, kind kandang|gudang, active)
house(location_id, code, name, capacity_birds)
flock(house_id, code, strain, chick_in_date, initial_birds, status grower|layer|afkir, production_start_date, cull_date)
flock_depletion(flock_id, date, dead, culled, reason)
grade(code, name, sort, is_saleable, active)
unit_conversion(grade_id, valid_from, kg_per_crate, kg_per_tray, eggs_per_kg, source)
customer(code, name, kind, is_related_party, payment_terms_days)
parameter(key, value jsonb, valid_from)
app_user(id = auth.users.id, email, name, role, active)
user_location(user_id, location_id)
hdp_standard(strain, age_week, hdp_pct, egg_weight_g)

opname(location_id, date, cutoff_time, last_do_before, first_do_after, counter_id, witness_id, manager_id, signed_at ×3, status)
opname_line(opname_id, grade_id, crates, trays, loose_eggs, sample_crates, sample_kg, sample_eggs_per_tray, kg, eggs)
production(house_id, date, grade_id, qty, unit, kg)                  unique(house_id, date, grade_id)
outbound(location_id, do_number, customer_id, date, status draft|dikirim|diterima, delivered_at, delivered_by)   unique(location_id, do_number)
outbound_line(outbound_id, grade_id, qty, unit, kg_doc, kg_delivered, price_per_kg)
transfer(from_location_id, to_location_id, grade_id, kg, sent_date, received_date, status in_transit|received)
shrinkage(location_id, date, grade_id, kg, kind, reason)
physical_count(location_id, date, note) + physical_count_line(…, kg, eggs, computed_kg, diff_kg)
correction(location_id, effective_date, grade_id, kg, amount_rp, reason, attachment_path, status draft|approved|posted, approved_by, posted_at)
sales_plan(customer_id, date, grade_id, kg, price_per_kg, kind order|forecast)
market_price(date, region, price_per_kg)
cash_plan(week_start, category, direction in|out, amount_rp) ; cash_balance(as_of, amount_rp)

day_status(location_id, date, status open|submitted|approved|locked, submitted_by/at, approved_by/at, locked_by/at, return_reason)
rebuild_queue(location_id, from_date, status queued|running|done, claimed_at)
position_daily(location_id, grade_id, date, opening, production, transfer_in, outbound, transfer_out, shrinkage, correction, closing, in_transit, age_b1..b4, days_of_stock, value_rp, computed_at, inputs_hash)
projection_daily(flock_id|house_id, grade_id, date, kg_proj, calibration_factor, flag)
control_result(code, date, location_id, status ok|warn|fail, detail jsonb)
accurate_upload(kind sales|stock, period, file_path, rows, status) ; accurate_sales_line ; accurate_stock_line ; item_map(accurate_item_code, grade_id, accurate_unit, factor_to_kg)
reconciliation_item(period, grade_id, kind kg|rp|stock, app_value, accurate_value, diff, status open|explained|corrected, note, correction_id)
audit_log(table_name, row_id, action, actor, at, old jsonb, new jsonb)
```

Fungsi SQL (security definer, cek peran di dalam): `submit_day`, `approve_day`, `return_day`, `lock_day`, `post_correction`, `claim_rebuild(n)`, `set_login_password` (admin, tanpa grant ke API), `schema_version()`.

## 4. RLS (ringkas; matriks lengkap di tes T-02/T-18)

- `is_app_user()`, `current_app_role()`, `my_locations()` dari `auth.uid()` → `app_user`/`user_location`.
- Baca: semua peran aktif membaca master, `position_daily`, `control_result`, `projection_daily`; `kandang` membaca transaksi hanya lokasinya; `bod` membaca semuanya kecuali `app_user` detail.
- Tulis: `kandang` → `production`, `shrinkage`, `transfer`, `physical_count*`, `opname*` (sebagai counter), `outbound.status/delivered` **hanya** lokasinya dan hanya bila `day_status.status` ∈ {`open`,`submitted`}; `marketing` → `outbound*`, `customer`, `sales_plan`, `market_price`; `manager` → `flock*`, `day_status` via RPC; `accounting`/`admin` → semuanya, `correction`, `cash_*`, `item_map`, `parameter`; `bod` → hanya `correction.approved_by` via RPC `approve_correction`.
- `audit_log`: insert oleh trigger saja; baca accounting/admin.
- Storage: bucket privat `ba-photos` (foto BA), `attachments` (lampiran koreksi), `uploads` (Accurate). Policy: tulis oleh peran yang berhak, baca semua app_user.

## 5. Lingkungan pengembangan tanpa Docker

- **Database tes**: `@electric-sql/pglite` dimuat oleh vitest. `packages/db/test/pglite.ts` membuat instance baru, membuat skema `auth` shim (`auth.users` tabel minimal, fungsi `auth.uid()` yang membaca `current_setting('request.jwt.claims', true)::json->>'sub'`, `auth.role()`), menjalankan semua migrasi dan seed. Helper `asRole(db, role, userId)` memanggil `set_config('request.jwt.claims', …)` dan `set role authenticated` sehingga policy RLS dievaluasi seperti di Supabase. Bila PGlite tidak mendukung `set role` dengan RLS penuh, fallback: jalankan tes RLS dengan `security_invoker` view dan catat di QUESTIONS; **jangan** menonaktifkan RLS.
- **Auth lokal (dev dan e2e)**: `MOCK_AUTH=1` mengaktifkan provider sesi palsu di `lib/session.ts`: cookie `mock_user=<email>`; `getViewer()` membaca `app_user` lewat klien service PGlite-backed (`packages/db/local-server.ts` menyediakan HTTP shim minimal PostgREST untuk `select/insert/update/rpc` yang dipakai app — cukup untuk dev dan e2e; **bukan** PostgREST lengkap). Dengan `MOCK_AUTH` kosong, app memakai Supabase asli.
- **Storage lokal**: `lib/storage.ts` abstraksi `put/get/signedUrl`; implementasi `fs` ke `.local-storage/` saat `MOCK_AUTH=1`, Supabase Storage saat production.
- **Realtime**: di lokal polling 60 dtk; di production boleh Realtime bila mudah, polling tetap sebagai fallback.

Konsekuensi yang disadari: perbedaan antara shim dan Supabase asli (Auth, PostgREST, Storage, `numeric` serialisasi) diuji oleh Claude Code di **staging** sesudah M6 (PLAN §Serah terima). Semua kode yang menyentuh Supabase melalui `lib/supabase/*` agar penggantian shim → asli hanya di satu tempat.

## 6. Worker rebuild dan kontrol

- Trigger `after insert/update/delete` pada tabel transaksi → `insert into rebuild_queue(location_id, from_date)` (dedupe: satu baris per lokasi, `from_date` = min).
- `processRebuildQueue(limit)`: `claim_rebuild(n)` (update bersyarat `queued→running returning`), untuk tiap klaim: muat transaksi lokasi dari `from_date − 1` ke hari ini, jalankan `engine.position` + `aging` + `daysOfStock` + `valuation`, tulis `position_daily` upsert dengan `inputs_hash`; untuk M3+ juga `projection_daily` 28 hari. Aksi di app memproses inline ≤ 7 tanggal; sisanya cron.
- `processControls(date)`: K1–K7 dari `position_daily`, `day_status`, `outbound`, `transfer`, `physical_count` → `control_result` upsert (kode, tanggal, lokasi).
- Cron Vercel: `0 13 * * *` UTC (20:00 WIB, K1) dan tiap jam untuk rebuild; route menolak tanpa `Authorization: Bearer $CRON_SECRET`.

## 7. Offline (K8)

`lib/offline/`: `draftStore` (IndexedDB via `idb`), `syncQueue`. Form `/hari` menulis draft lokal pada setiap perubahan; tombol "Selesai hari ini" menaruh aksi di antrean; `online` event mengirim berurutan; respons 409 (hari sudah `approved`/`locked`) → draft ditandai konflik dan ditampilkan, tidak dikirim ulang otomatis. Service worker tidak dipakai di v1 (cukup cache halaman oleh Next; halaman `/hari` harus sudah terbuka sebelum offline).

## 8. Keamanan

- Repo privat; `.env*` di `.gitignore`; `SUPABASE_SERVICE_ROLE_KEY` hanya di server (route cron dan worker), tidak pernah di komponen klien.
- Semua mutasi lewat server action atau RPC; validasi `zod` di server; RLS sebagai lapisan kedua.
- Audit trail wajib untuk semua tabel transaksi dan master.
- Backup harian `pg_dump` ke artifact GitHub (pola KGR), retensi 30 hari.

## 9. CI

`.github/workflows/ci.yml`: `pnpm install --frozen-lockfile` → `typecheck` → `test` (vitest, termasuk PGlite) → `e2e` (Playwright, `MOCK_AUTH=1`, `next build && next start`) → `lint` (eslint + skrip `scripts/lint-ui.ts`: tidak ada `placeholder=` sebagai label, tidak ada `window.confirm`, tidak ada kode K/R di teks UI, kontras token). PR tidak bisa di-merge bila merah.

## 10. Deploy (dilakukan Claude Code)

- Supabase: staging lalu production, region `ap-southeast-1`; `supabase db push`; seed master; `set_login_password` admin.
- Vercel: project `winata-egg-position`, root `apps/web`, region `sin1`, env 4 variabel, crons di `apps/web/vercel.json`. Production hanya dari `main`; preview dari branch memakai staging.
