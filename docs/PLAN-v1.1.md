# PLAN v1.1 — Hardening & Cloud

Rencana eksekusi untuk **Claude Code (cloud, tanpa pengawasan)** sesudah serah terima DeepSeek. Acuan: `PRD-v1.1.md` (F/K/R/T baru), lalu `PRD-v1.md`, `ARCHITECTURE-v1.1.md`, `DESIGN-v1.1.md`.

## Prinsip kerja (tambahan atas PLAN v1)

1. **Tanpa pengawasan.** Pemilik tidur. Tidak ada pertanyaan di tengah jalan: ambil default dari PRD-v1.1 §5, catat di `docs/QUESTIONS.md`, lanjut. Satu-satunya alasan berhenti total: tindakan yang tidak bisa dibatalkan dan belum diputuskan dokumen (contoh: menghapus project Supabase yang sudah ada dan berisi data).
2. **Gerbang = tes yang dijalankan, bukan klaim.** Setiap T di PRD-v1.1 §4: tulis tes yang **merah** dulu terhadap kode lama (jalankan dan tempel hasilnya di log), baru perbaiki sampai hijau. Tes v1 (204) tidak boleh berubah kecuali bila sengaja menguji perilaku yang kini dilarang (hard delete, insert posted); perubahan tes v1 dicatat per kasus dengan alasan.
3. **Migrasi baru saja.** `supabase/migrations/0008_hardening.sql` (dan `0009_…` bila perlu). `0001–0007` tidak disentuh. `schema_version()` → `1.1.0`.
4. **Satu branch, satu PR.** `fix/v1.1-hardening-cloud` → PR ke `main` → CI hijau (typecheck, test, lint, e2e) → **merge** oleh agen (K18) → Vercel production dari `main`. Bila CI merah dan tidak bisa diperbaiki dalam 3 iterasi, PR dibiarkan terbuka, deploy dibatalkan, laporkan.
5. **Rahasia tidak masuk repo.** Password DB, service-role key, `CRON_SECRET`, password admin: hanya di Supabase/Vercel env dan di pesan akhir ke pemilik. `docs/log/CLOUD-RUN.md` berisi nama variabel, bukan nilai.
6. **Urutan: kode dulu, cloud kemudian.** Jangan membuat project Supabase sebelum M7–M8 hijau di lokal, agar migrasi yang di-push sudah final.

## Milestone

### M7 — Hardening database dan app (menutup F-1…F-6, F-8…F-14)

**Keluaran**
- `supabase/migrations/0008_hardening.sql`: R-60…R-69, R-71 (parameter), R-73 (parameter), `schema_version()='1.1.0'`, `create_login(email, password)` (R-64), FK `on update cascade` ke `app_user`.
- `apps/web`: `isMockAuth()` K15/R-72; `createUserAction` urutan baru (R-64); aksi "Hapus" → soft delete lewat update; `setPasswordAction` paginasi `listUsers`; pesan galat baru sesuai DESIGN-v1.1 §2.
- `packages/engine`: `reconstruct.ts` R-70; `recon.ts` R-71 (`accountsConfirmed`).
- Tes: `supabase/tests/hardening.test.ts` (T-70…T-79), `packages/engine/test/reconstruct.test.ts` (T-80, T-81), `apps/web` unit `isMockAuth` (T-82).
- Seed: `0003_users.sql` tetap lokal; e-mail admin seed diganti `dika.g.irawan@gmail.com` (Q-23); `0001_master.sql` menambah parameter `tb_total_rp`, `coa_inventory_egg`, `coa_inventory_variance`, `reconstruct_missing_basis`.
- `docs/QUESTIONS.md`: Q-21…Q-25 ditambah; Q-11, Q-18, Q-19 diperbarui.

**Gerbang:** T-70…T-83 hijau; `pnpm typecheck && pnpm test && pnpm lint` bersih; `pnpm e2e` hijau **di lokal agen bila browser tersedia**, selain itu di CI (T-88).

### M8 — Worker cloud (menutup F-7)

**Keluaran**
- `packages/db/src/queryable.ts`: `interface Queryable { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }`; `rebuild.ts`, `controls.ts`, `outlook-worker.ts` menerima `Queryable` (PGlite memenuhinya tanpa perubahan).
- `packages/db/src/pg-cloud.ts`: `createCloudDb(url)` memakai `pg.Pool` (`max: 1`, `idleTimeoutMillis: 10_000`, `ssl: { rejectUnauthorized: false }` hanya bila host pooler Supabase; parser tipe: `date`(1082) → string `YYYY-MM-DD`, `timestamptz` → string ISO, `numeric`(1700) tetap string, `int8` → number). Tes unit parser tipe.
- `apps/web/lib/cloud-db.ts`: singleton `getWorkerDb()` → PGlite lokal bila mock, `createCloudDb(process.env.SUPABASE_DB_URL)` di cloud.
- Route `api/cron/rebuild` & `controls`: hapus guard 501, pakai `getWorkerDb()`, `export const maxDuration = 300`, batas 10 lokasi, respons JSON jumlah.
- `lib/actions/common.ts#rebuildLocal`: jalur cloud inline ≤ 7 tanggal lewat `getWorkerDb()`; galat worker tidak menggagalkan aksi (dicatat).
- `.env.example` + `apps/web/vercel.json`: variabel `SUPABASE_DB_URL`.
- Dependensi baru `pg` + `@types/pg` (dicatat di log dengan alasan: K17).

**Gerbang:** tes worker v1 (rebuild/controls 7+3 tes) hijau lewat `Queryable` PGlite; `pnpm typecheck`; tes parser tipe; **uji nyata di M9** (T-86).

### M9 — Supabase production + Vercel

**Keluaran (lewat MCP Supabase dan Vercel yang tersedia di sesi; fallback CLI bila ada token)**
1. Supabase: `list_organizations` → pilih organisasi pemilik (bila lebih dari satu: yang namanya mengandung "dika"/"winata", selain itu yang pertama); `list_projects` → bila sudah ada project bernama `winata-egg-position` **dan** tabel `app_user` ada, pakai itu (jangan buat baru, jangan reset); bila tidak ada → `create_project(name='winata-egg-position', region='ap-southeast-1', db_pass=<acak 32 karakter>)`; tunggu `ACTIVE_HEALTHY`.
2. `create extension if not exists pgcrypto with schema extensions` (bila belum); `apply_migration` untuk `0001…0008` **berurutan**, nama = nama file; `select schema_version()` = `1.1.0` (T-84).
3. Seed **selektif** via `execute_sql`: `0001_master.sql` (lokasi SLP/CKL/TSK, kandang, grade, pelanggan, parameter), `0005_hdp.sql`, `0006_item_map.sql`. **Bukan** `0002_flocks`, `0003_users`, `0004_opname_t0`.
4. Akun: `insert app_user (email='dika.g.irawan@gmail.com', name='Dika', role='admin')` + `select create_login(...)` dengan password acak 16 karakter (dilaporkan di pesan akhir saja). 6 akun uji `@winata.test` dibuat dengan cara yang sama untuk T-85, lalu **dihapus** (urutan: `user_location`, lalu `app_user`, lalu `auth.users`).
5. Storage: bucket privat `ba-photos`, `attachments`, `uploads` (lewat SQL `insert into storage.buckets (id, name, public) values (..., false)` bila MCP tidak punya tool bucket).
6. Vercel: `list_teams` → scope; `create_git_project` (repo `dikagustiana/winata-os`, `rootDirectory='apps/web'`, framework `nextjs`, install command `pnpm install --frozen-lockfile` di root, build `pnpm --filter @winata/web build`); bila tautan Git gagal (integrasi GitHub belum ada) → `create_project` + `create_deployment` dari sumber git `main`; bila itu pun gagal → catat sebagai tindakan pemilik dengan perintah persis.
7. Env (production **dan** preview): `NEXT_PUBLIC_SUPABASE_URL` (`get_project_url`), `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`get_publishable_keys`), `SUPABASE_DB_URL` (pooler transaction mode port 6543 dengan `db_pass` yang dibuat agen; host dari `get_project`/dokumentasi region), `CRON_SECRET` (acak ≥ 32 byte). `SUPABASE_SERVICE_ROLE_KEY` **tidak bisa diambil lewat MCP** → tindakan pemilik pagi hari (Dashboard → Project Settings → API → service_role) — fitur yang bergantung padanya: buat akun lewat `/admin`, unggah foto BA/lampiran/Accurate. Jangan `MOCK_AUTH`, jangan `LOCAL_DB_DIR`.
8. Deploy production dari `main` sesudah PR merge; tunggu `READY`; `GET /login` 200.

**Gerbang:** T-84, T-86 (dengan `curl` ke URL production memakai bearer), T-87 (login admin lewat Playwright/curl ke `/login` bila memungkinkan; minimal `signInWithPassword` lewat `fetch` ke `/auth/v1/token` berhasil), T-85 (6 akun uji + JWT lewat `/auth/v1/token?grant_type=password` + PostgREST `curl`).

### M10 — Bukti, log, dan serah terima pagi

**Keluaran**
- `docs/log/M7.md`, `M8.md`, `M9.md` (format log v1) dan `docs/log/CLOUD-RUN.md`:
  - status tiap T v1.1 (hijau/merah/ditunda + bukti perintah/HTTP code),
  - URL production, project ref Supabase, ID project Vercel, nama env yang terpasang,
  - **"Tindakan pemilik pagi ini"** terurut: (1) repo privat bila belum, (2) paste `SUPABASE_SERVICE_ROLE_KEY` ke Vercel + redeploy, (3) ganti password admin, (4) jawab Q-21/Q-22/Q-23, (5) tanggal BA T0 dan impor, (6) `backup.yml` + secret `SUPABASE_DB_URL` (connection string langsung, bukan pooler).
  - yang **tidak** selesai dan kenapa.
- `docs/HANDOVER-CLAUDE.md` §3.1/§3.2 diperbarui (Q-11 ditutup, alur akun baru); `README.md` §Akun contoh dan §Deploy disesuaikan.
- PR merged; pesan akhir ke pemilik: ringkasan 10 baris + rahasia (password admin, `CRON_SECRET` hanya bila diperlukan pemilik) **hanya di pesan, tidak di repo**.

## Gerbang keseluruhan ("selesai" untuk run ini)

- [ ] T-70…T-83 hijau di `pnpm test`; typecheck 0; lint bersih
- [ ] PR `fix/v1.1-hardening-cloud` CI hijau termasuk e2e (T-88) dan ter-merge ke `main`
- [ ] Supabase `winata-egg-position` `schema_version()='1.1.0'`, seed master/HDP/item_map, 3 bucket, admin pemilik bisa login
- [ ] Vercel production `READY`, 4 env terpasang (+ catatan service-role key), cron terdaftar, `/api/cron/rebuild` 401/200 sesuai bearer
- [ ] T-85 matriks RLS via PostgREST dicatat per sel; akun uji dihapus
- [ ] `docs/log/CLOUD-RUN.md` lengkap dengan "Tindakan pemilik pagi ini"

## Kalender pemilik (pagi)

1. Baca `docs/log/CLOUD-RUN.md` dan pesan akhir agen.
2. Jalankan tindakan 1–6 di atas (≈ 20 menit).
3. BA opname T0 kertas → impor (PLAN v1 §Serah terima 7).
