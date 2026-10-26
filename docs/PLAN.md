# PLAN — Winata Egg Position v1

Rencana eksekusi M0–M6 untuk agen coding (DeepSeek), lalu serah terima ke Claude Code. Acuan: `PRD-v1.md` (K/R/Q), `DESIGN.md`, `ARCHITECTURE.md`.

## Prinsip kerja

1. **Satu milestone = satu branch = satu PR ke `main`.** Nama branch `m0-foundation`, `m1-transactions`, dst. Tidak melompat milestone.
2. **Gerbang = tes, bukan klaim.** Milestone "selesai" hanya bila: `pnpm typecheck` 0 galat, `pnpm test` hijau (vitest, termasuk tes migrasi dan RLS di PGlite), `pnpm e2e` hijau (Playwright terhadap `next dev` + PGlite), dan `pnpm lint` bersih. Hasil ketiganya dicatat di `docs/log/M{n}.md` dengan jumlah tes per paket.
3. **Database hanya lewat migrasi.** Setiap perubahan skema = file baru `supabase/migrations/YYYYMMDDHHMMSS_<nama>.sql`. Tidak mengubah file migrasi yang sudah di-merge. Tes migrasi menjalankan semua file dari nol di PGlite setiap kali.
4. **Tidak ada kunci cloud di repo.** `.env.example` berisi nama variabel saja. DeepSeek tidak pernah memakai `SUPABASE_*` production/staging.
5. **Berhenti di akhir milestone.** Tulis `docs/log/M{n}.md` (apa yang dibuat, tes, keputusan kecil, pertanyaan baru → `docs/QUESTIONS.md`), lalu berhenti dan tunggu pemilik.
6. **Angka pakai desimal, bukan float** (`decimal.js` di TS; `numeric` di Postgres).
7. **Bahasa:** UI dan dokumen Bahasa Indonesia; nama tabel, kolom, fungsi, dan kode Inggris.

## Pra-syarat di laptop pemilik (sudah dipasang)

Node LTS ≥ 20, Git. `pnpm` dipasang oleh DeepSeek (`npm i -g pnpm`). Tidak ada Docker. Postgres untuk tes = PGlite (`@electric-sql/pglite`), dipasang sebagai devDependency.

## Milestone

### M0 — Fondasi

**Keluaran**
- Monorepo pnpm: `apps/web` (Next.js 15 App Router, TS strict), `packages/engine` (TS murni), `packages/db` (tipe + klien), `supabase/` (migrasi, seed, tes).
- Migrasi `0001_schema`: semua tabel master dan transaksi §4–§5 PRD (boleh tanpa isi logika), `audit_log`, `app_user`, `user_location`, `parameter`, `control_result`, `position_daily`, `day_status`, `reconciliation_item`, `item_map`, `hdp_standard`, `schema_version()`.
- Migrasi `0002_security`: RLS semua tabel; fungsi `current_role()`, `user_locations()`; policy per peran sesuai PRD §3 dan K1; trigger allow-list login; trigger audit generik.
- Seed master: lokasi, kandang, grade, parameter default, `hdp_standard` 3 strain, 1 user admin (e-mail pemilik), user contoh per peran dengan sufiks `@winata.test`.
- Login e-mail + kata sandi (Supabase Auth di cloud; di lokal: **mock auth** — lihat ARCHITECTURE §5), middleware, `getViewer()`, menu per peran.
- Layar `/master`, `/admin` (pengguna, penugasan lokasi, parameter, audit), `/flok` (register, deplesi).
- Harness tes: `packages/db/test/pglite.ts` (jalankan semua migrasi + seed ke PGlite baru), helper `asRole(role, userId)` yang mengeset `request.jwt.claims` agar RLS bisa diuji; Playwright + mock auth.

**Tes**

| T | Kriteria lolos |
|---|---|
| T-01 | Semua migrasi berjalan dari nol di PGlite tanpa galat; `schema_version()` = `1.0.0` |
| T-02 | RLS: 6 peran × 12 tabel inti — matriks baca/tulis sesuai PRD §3 (dibuktikan per sel; `kandang` lokasi A tidak melihat baris lokasi B) |
| T-03 | Pendaftaran mandiri ditolak (trigger); e-mail di `app_user` aktif saja yang bisa login (mock auth) |
| T-04 | Audit: update pada `grade` menghasilkan baris `audit_log` dengan nilai lama/baru dan `actor` |
| T-05 | Register flok: umur minggu dan populasi kini benar untuk 3 kasus (grower, layer, afkir) |
| T-06 | e2e: 6 peran login, melihat menu yang benar, 404 di rute yang dilarang; semua layar M0 di 390 dan 1366 px tanpa scroll samping |

Catatan: **tugas pertama M0** adalah membuktikan RLS berjalan di PGlite (set `role` dan `request.jwt.claims` via `set_config`, policy memakai `auth.uid()` yang dibuat sebagai fungsi shim di skema `auth`). Bila tidak bisa, catat di `docs/QUESTIONS.md` dan tandai T-02 sebagai "ditunda ke staging" — jangan mematikan RLS.

### M1 — Transaksi dan mesin posisi

**Keluaran**
- Migrasi `0003_transactions`: constraint, index, fungsi `recompute_position(location_id, from_date)`, trigger yang mengantre pembangunan ulang (`rebuild_queue`).
- `packages/engine`: `position.ts` (R-10), `aging.ts` (R-11 FIFO), `conversion.ts` (R-4, R-5), `daysOfStock.ts` (R-12), `valuation.ts` (R-13), semua dengan decimal.js dan tes golden dari fixture `fixtures/week-example/` (dibuat oleh DeepSeek: 3 lokasi, 5 grade, 10 hari, termasuk mutasi di jalan, susut, koreksi).
- Worker rebuild: `apps/web/lib/rebuild.ts` mengambil antrean, menghitung dengan engine, menulis `position_daily`; dipanggil dari aksi (inline ≤ 7 tanggal) dan route `GET /api/cron/rebuild` (bearer `CRON_SECRET`).
- Layar `/hari/[lokasi]/[tanggal]` (produksi, susut, konfirmasi serah DO, mutasi), `/fisik/[lokasi]` (hitung fisik + mode opname BA dengan 3 tanda tangan dan foto ke Storage), `/do` (marketing).
- Importer R-50: `/rekon/import` (upload CSV, validasi, pratinjau, muat).

**Tes**

| T | Kriteria lolos |
|---|---|
| T-10 | Golden posisi: `position_daily` fixture 10 hari × 3 lokasi × 5 grade sama dengan `fixtures/week-example/golden.json` hingga 0,001 kg |
| T-11 | Aging FIFO: 6 kasus (keluar menghabiskan lapisan tertua, mutasi membawa umur, koreksi membentuk lapisan baru, dsb.) |
| T-12 | Konversi: input peti/tray/butir → kg memakai versi `unit_conversion` yang berlaku pada tanggal transaksi; perubahan versi tidak mengubah transaksi lama |
| T-13 | Opname: kg hasil dari sampel sesuai R-5; opname menulis versi `unit_conversion` baru; menjadi opening hari pertama (K6) |
| T-14 | DO: nomor ganda ditolak; nomor loncat menghasilkan `control_result` K3 `warn` |
| T-15 | Mutasi: kg keluar dari asal pada tgl kirim dan masuk ke tujuan pada tgl terima; `in_transit` tampil di posisi |
| T-16 | Rebuild: mengubah transaksi tanggal d membangun ulang d..hari ini saja; antrean diklaim atomik (dua pemanggil tidak membangun tanggal yang sama) |
| T-17 | Importer: file 100 baris valid dimuat dengan `source=import`; file dengan 1 baris salah ditolak seluruhnya dengan nomor baris dan alasan |
| T-18 | RLS transaksi: `kandang` lokasi A tidak bisa menulis produksi lokasi B; `marketing` tidak bisa menulis produksi; `bod` tidak bisa menulis apa pun |
| T-19 | e2e journey H (hari kandang): login kandang → isi produksi 3 grade → susut → konfirmasi 1 DO → mutasi ke TSK → posisi di dashboard berubah sesuai angka |

### M2 — Alur persetujuan, kontrol, dashboard, offline

**Keluaran**
- Migrasi `0004_workflow`: `day_status` transisi (R-20) sebagai fungsi `submit_day`, `approve_day`, `return_day`, `lock_day` dengan cek peran dan K1 (pengisi ≠ penyetuju); `correction` dengan K9 di fungsi `post_correction`.
- Kontrol K1–K7 sebagai fungsi engine + penjadwal (`/api/cron/controls`), menulis `control_result`.
- Dashboard `/` (DESIGN §3): kartu posisi, hari stok, aging, produksi vs keluar 30 hari, kartu kontrol, lokasi belum submit. Membaca `position_daily` dan `control_result` saja. Auto-refresh 60 dtk (polling) atau Supabase Realtime bila tersedia.
- `/approve` (manager), kunci hari dan koreksi di `/rekon`.
- Offline draft (K8) untuk `/hari`: IndexedDB, antrean kirim, pesan konflik.

**Tes**

| T | Kriteria lolos |
|---|---|
| T-20 | Transisi status: semua transisi sah berhasil, semua yang tidak sah ditolak (matriks 4 status × 6 peran) |
| T-21 | K1 (PRD): user yang menginput transaksi hari d di lokasi L tidak bisa `approve_day(L, d)` |
| T-22 | Hari `approved`: tulis produksi oleh `kandang` ditolak oleh RLS; hari `locked`: tulis oleh siapa pun ditolak; `correction` diterima dan membangun ulang posisi dengan jejak |
| T-23 | K9: koreksi Rp 12 jt tanpa `approved_by` bod gagal `posted`; Rp 8 jt berhasil; 2,5 % stok lokasi gagal |
| T-24 | K1–K7: setiap kontrol punya kasus `ok` dan `warn/fail` dari fixture; hasil ada di `control_result` |
| T-25 | K2 memblokir approve bila `closing` negatif |
| T-26 | K4 memblokir lock bila selisih fisik > toleransi tanpa catatan; dengan catatan lolos |
| T-27 | Dashboard: angka kartu = `position_daily`; tidak ada query ke tabel transaksi dari halaman (diuji dengan spy klien) |
| T-28 | Offline: Playwright `context.setOffline(true)` → isi form → draft tersimpan → online → terkirim; bila hari sudah `approved` saat online, pesan konflik dan draft tidak ditimpa |
| T-29 | e2e journey A: kandang submit → manager approve → accounting lock → kandang coba ubah (ditolak) → accounting koreksi 8 jt → posisi berubah → dashboard menampilkan koreksi |

### M3 — Outlook: produksi, rencana jual, posisi proyeksi, harga/GP

**Keluaran**
- Migrasi `0005_outlook`: `sales_plan`, `market_price`, `projection_daily` (per flok/kandang/grade/tanggal), `hdp_standard` lengkap 3 strain umur 18–90 minggu.
- Engine: `hdp.ts` (R-30–R-32 termasuk faktor kalibrasi dan batas 0,6–1,2), `salesPlan.ts` (R-33), `projection.ts` (R-34), `pricing.ts` (R-35).
- Worker memperluas rebuild untuk `projection_daily` 28 hari.
- Layar `/outlook` tab Produksi, Posisi proyeksi, Harga & GP; `/rencana` (marketing).

**Tes**

| T | Kriteria lolos |
|---|---|
| T-30 | Umur dan HDP standar: 5 flok fixture → nilai sesuai tabel strain |
| T-31 | Kalibrasi: faktor = Σ aktual ÷ Σ standar 14 hari; dibatasi 0,6–1,2; < 14 hari data → flag `insufficient_calibration` |
| T-32 | Proyeksi produksi 28 hari: golden dari fixture (3 flok, 1 grower belum produksi) hingga 0,01 kg |
| T-33 | Grade mix: memakai mix aktual 14 hari; sebelum itu `default_grade_mix` |
| T-34 | Posisi proyeksi: `closing_proj` benar untuk order + forecast; tanda kekurangan pasok saat order > stok + produksi |
| T-35 | Harga realisasi tertimbang per grade per hari dari `outbound`; GP proyeksi dengan label HPP sementara |
| T-36 | e2e: marketing input order 5 hari ke depan → `/outlook` menunjukkan kekurangan pasok pada hari ke-4 sesuai fixture |

### M4 — Kas 13 minggu dan afkir indikatif

**Keluaran**
- Migrasi `0006_cash`: `cash_plan`, `cash_balance`.
- Engine: `cash13.ts` (R-36, profil penagihan per jenis pelanggan), `cull.ts` (R-37).
- Layar `/outlook` tab Kas 13 minggu dan Afkir; input rencana kas di `/rekon/kas`.

**Tes**

| T | Kriteria lolos |
|---|---|
| T-40 | Profil penagihan: bakul masuk minggu 0; agen 50/50; grup 0/100 minggu 2 — golden 13 minggu dari fixture |
| T-41 | Saldo terendah dan minggunya benar; perubahan `cash_plan` membangun ulang |
| T-42 | Afkir indikatif: margin harian dan ambang untuk 3 flok fixture; label indikatif selalu tampil |
| T-43 | e2e: accounting isi saldo awal + 3 baris rencana → tab Kas menunjukkan 13 kolom dan saldo terendah |

### M5 — Rekonsiliasi Accurate dan ekspor BS 04A

**Keluaran**
- Migrasi `0007_recon`: `accurate_upload`, `accurate_sales_line`, `accurate_stock_line`, `item_map`, `reconciliation_item`.
- Parser (`packages/parsers`): *Sales by Item Detail* dan *Inventory Valuation* (xlsx/csv) → baris; item tanpa `item_map` → upload ditolak dengan daftar item.
- K8 (R-41) sebagai fungsi engine + layar `/rekon` tab Accurate; `reconciliation_item` dengan status; ekspor BS 04A (R-42) XLSX.

**Tes**

| T | Kriteria lolos |
|---|---|
| T-50 | Parser: fixture ekspor Accurate (dibuat sintetis mengikuti kolom standar Accurate; pemilik akan mengganti dengan ekspor asli) → jumlah baris dan Σ kg/Rp sama |
| T-51 | Item tanpa map → ditolak, daftar item lengkap; sesudah map ditambah → berhasil |
| T-52 | K8: selisih per grade kg dan Rp dan stok akhir bulan masuk `reconciliation_item`; nol selisih → tidak ada item |
| T-53 | Ekspor BS 04A: kolom dan subtotal sama dengan bagian B dan C sheet "BS 04A Persediaan" (kolom disalin dari `docs/reference/bs04a-columns.md`) |
| T-54 | e2e: accounting upload 2 file → K8 tampil → tandai 1 item `explained` → ekspor terunduh |

### M6 — Rekonstruksi 30-06-2026

**Keluaran**
- Engine `reconstruct.ts` (R-43) termasuk mode estimasi bila data bolong (batas atas/bawah).
- Layar `/rekonstruksi`: input tanggal target, hasil per grade, selisih vs TB (parameter `tb_egg_whole_rp` 383.582.877, `tb_egg_broken_rp` 6.209.446, `tb_hpp_per_kg` 17.419), ekspor draft Usulan Koreksi (XLSX dengan kolom sheet "Usulan Koreksi").

**Tes**

| T | Kriteria lolos |
|---|---|
| T-60 | Rekonstruksi mundur: fixture T0 + 20 hari data → closing 30-06 sama dengan golden; hari tanpa data → batas atas/bawah dan label estimasi |
| T-61 | Selisih vs TB dihitung per grade dan total; kg × HPP sementara |
| T-62 | Ekspor Usulan Koreksi: baris Dr/Cr seimbang; referensi RS-05 |

## Serah terima ke Claude Code (sesudah M6)

Checklist yang dijalankan Claude Code, bukan DeepSeek:

1. Review kode M0–M6 terhadap PRD (K dan R), fokus: RLS, transisi status, K9, rebuild atomik, offline conflict.
2. Supabase project **staging** (Singapura): `supabase link`, `supabase db push`, seed master, buat 6 akun uji.
3. Uji di staging lewat API asli: login tiap peran; matriks RLS T-02 dan T-18 lewat PostgREST; upload foto BA ke Storage bucket privat; `release`/cron dengan bearer.
4. Perbaiki bug yang hanya muncul di cloud (Auth, Storage, Realtime); PR kecil ke `main`.
5. Supabase **production** (Singapura) + Vercel `winata-egg-position` (root `apps/web`, region `sin1`, env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`); cron `/api/cron/rebuild` dan `/api/cron/controls`.
6. Admin pertama (`set_login_password` di SQL Editor), akun per peran, penugasan lokasi.
7. Impor BA opname T0 dan log kertas/sheet lewat importer; verifikasi posisi hari pertama = BA.
8. Backup harian (`pg_dump` via GitHub Action, pola KGR `backup.yml`).

## Kalender jembatan sebelum go-live

Agar data tidak hilang selama pembangunan:
- Opname T0 dengan BA kertas (prosedur di PRD §5 dan DESIGN §6), kolom = `opname_line`.
- Log harian di sheet dengan kolom importer R-50 persis (`tanggal, lokasi, kandang, grade, jenis, qty, satuan, nomor_do, pelanggan, catatan`).
- Semua diimpor di langkah serah terima 7.
