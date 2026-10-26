# PRD v1.1 — Hardening & Cloud (adendum PRD v1)

PT Winata Mega Agro · 26 Okt 2026 · Pemilik: Dika. Dokumen ini **menambah** `PRD-v1.md`; semua K/R/T/Q v1 tetap berlaku kecuali yang disebut di sini. Bila bertentangan, v1.1 menang untuk butir yang disebut, v1 untuk sisanya.

## 0. Latar

Review kode M0–M6 (26 Okt, dibuktikan dengan probe di PGlite dengan RLS aktif, sebagai peran `authenticated`) menemukan bahwa gerbang lokal hijau tetapi beberapa kontrol inti bisa dilewati lewat API langsung:

| # | Temuan | Bukti | Melanggar |
|---|---|---|---|
| F-0 | Repo GitHub publik; berisi angka TB, nama pelanggan grup, referensi Pending, password contoh | clone anonim berhasil | PRD §0 "privat" |
| F-1 | Accounting dapat `insert correction (status='posted', approved_by=<id bod>)` langsung — melewati `post_correction` | Rp 50 jt/3.000 kg ter-posting | K9 |
| F-2 | BoD menyetujui koreksi Rp 11 jt; accounting mengubah kg/Rp menjadi Rp 500 jt/30.000 kg; `post_correction` tetap lolos | approve→update→post OK | K9 |
| F-3 | `created_by` diisi bebas dari klien; manager menginput hitung fisik atas nama kandang lalu `approve_day` hari yang sama lolos | tanpa pemalsuan ditolak dengan benar | K1 |
| F-4 | Hapus permanen: marketing `delete outbound` di hari `locked`; accounting `delete opname` T0 berstatus `signed`; kandang `delete production` | ketiganya OK | K1, K6, PRD §5 soft delete |
| F-5 | Pembuatan akun di cloud akan gagal: `createUserAction` membuat `auth.users` dulu, padahal trigger allow-list menolak e-mail yang belum ada di `app_user`; langkah "admin pertama" di HANDOVER juga terkena | dari kode | K2 |
| F-6 | Antrean rebuild kehilangan pekerjaan: transaksi baru masuk saat worker berjalan → `mark_rebuild_done` menandai `done`, rebuild baru hilang → `position_daily` basi (K2 membacanya) | `queued 12-08` → `done` | R-15, K2 |
| F-7 | Worker cloud belum ada (Q-11) | cron 501; `rebuildLocal` no-op | R-15 |
| F-8 | K4 memakai **AND** (`> tolerance_kg` **dan** `> tolerance_pct`), basis persen = total stok lokasi | selisih 40 kg pada stok 100 kg tanpa catatan: `lock_day` lolos | K4, Q-19 |
| F-9 | Marketing dapat mengubah `outbound.status='dikirim'` sendiri (serah oleh kandang terlewati; stok berkurang tanpa konfirmasi kandang) | update OK | PRD §5 |
| F-10 | `WITH CHECK` `physical_count`, `opname` (update), penerimaan `transfer` tidak memeriksa status hari: kandang insert hitung fisik di hari `locked` | insert OK | K1 |
| F-11 | Trigger enqueue memakai lokasi/tanggal **baru** saja; bila tanggal transaksi dimundurkan atau lokasi diubah, rentang lama tidak dibangun ulang | dari kode | R-15 |
| F-12 | Rekonstruksi 30-06: hari bolong hanya menaikkan batas lewat produksi; DO yang tidak tercatat (kasus paling mungkin di bakul) tidak membuat batas atas naik | dari kode | R-43 |
| F-13 | Akun jurnal Usulan Koreksi dikarang (`5-2100`, `1-1300`) | `packages/engine/src/recon.ts` | R-43 |
| F-14 | `MOCK_AUTH=1` yang tak sengaja terpasang di Vercel = siapa pun jadi admin lewat cookie; di mode mock, user tanpa `password_hash` lolos dengan password apa pun | dari kode | K2 |
| F-15 | `pnpm e2e` tidak dapat direproduksi di lingkungan review (unduhan browser diblokir); hanya klaim DeepSeek | — | PLAN §Prinsip 2 |

Yang **benar** dan tidak perlu disentuh: typecheck 0 galat; 204 tes vitest hijau (direproduksi); lint bersih; build sukses; service-role key tidak ada di bundle klien; golden `week-example`/`outlook-example` dihitung terpisah dari engine; RLS dievaluasi di PGlite; `claim_rebuild` atomik (`for update skip locked`); K1 jalur jujur ditolak; K2 memblokir submit/approve.

## 1. Tujuan v1.1

1. Menutup F-1…F-14 di **database** (migrasi baru `0008_hardening.sql`), dengan tes yang mereproduksi tiap temuan: merah sebelum, hijau sesudah.
2. Worker cloud (Q-11) memakai **engine dan kode worker yang sama** dengan lokal.
3. Supabase production di `ap-southeast-1` dengan skema + seed master; Vercel `sin1` live; cron aktif; akun admin pertama ada.
4. Bukti di `docs/log/CLOUD-RUN.md` + daftar tindakan pemilik pagi hari.

**Bukan v1.1:** fitur baru; perubahan DESIGN token/layout; PDF BA; costing flok.

## 2. Keputusan baru

- **K10 — Repo privat.** Tidak ada deploy sebelum repo privat. Bila tidak bisa diubah oleh agen, deploy tetap jalan tetapi dicatat sebagai tindakan pemilik nomor 1.
- **K11 — Status koreksi hanya bergerak lewat RPC.** `insert correction` oleh `authenticated` hanya boleh `status='draft'`, `approved_by/approved_at/posted_at` null. Perubahan `status`, `approved_*`, `posted_at` di luar `approve_correction`/`post_correction` ditolak trigger. Perubahan `kg`, `amount_rp`, `grade_id`, `location_id`, `effective_date` pada koreksi `approved` mengembalikannya ke `draft` dan menghapus `approved_by/at` (persetujuan BoD gugur). Koreksi `posted` immutable kecuali `deleted_at` oleh accounting dengan alasan, dan itu mengantre rebuild.
- **K12 — Jejak aktor tidak bisa dipalsukan.** `created_by` dipaksa `= auth.uid()` saat insert oleh `authenticated` dan tidak bisa diubah; `delivered_by`, `counted_by`, `checked_by`, `counter_id/witness_id/manager_id` (opname), `submitted_by/approved_by/locked_by` hanya boleh diisi dengan `auth.uid()` oleh peran yang berhak. Peran `service_role` (worker, importer, seed) dikecualikan.
- **K13 — Tidak ada hard delete oleh `authenticated`.** Hak `DELETE` dicabut dari `authenticated` untuk semua tabel transaksi dan master; "hapus" = `update set deleted_at = now()` dengan `WITH CHECK` yang sama dengan tulis (status hari, lokasi, peran). Opname `status='signed'` immutable (hanya `deleted_at` oleh accounting, dan itu mengantre rebuild dari tanggal opname). Baris `deleted_at is not null` tidak boleh dihidupkan lagi oleh `authenticated`.
- **K14 — Konfirmasi serah hanya oleh kandang.** `outbound.status` `draft→dikirim` dan `delivered_at/delivered_by` hanya oleh `kandang` lokasi itu (atau `accounting/admin`); marketing hanya `draft` dan koreksi dokumen; `dikirim→diterima` oleh marketing/accounting.
- **K15 — Mock auth tidak pernah hidup di cloud.** `isMockAuth()` = `MOCK_AUTH==='1'` **dan** `VERCEL` tidak terdefinisi **dan** `NODE_ENV!=='production'` (kecuali `MOCK_AUTH_ALLOW_PRODUCTION_BUILD==='1'` untuk e2e `next start` lokal/CI). Di mode mock, user tanpa `password_hash` **ditolak** login.
- **K16 — Satu project Supabase (production) di v1.1.** DB kosong sebelum BA T0 diimpor berfungsi sebagai staging. Verifikasi API (T-02/T-18 lewat PostgREST) dijalankan di project ini dengan 6 akun uji `@winata.test` yang **dihapus** sesudah verifikasi (sebelum data nyata). Project kedua (staging) ditambahkan nanti bila ada data nyata.
- **K17 — Worker cloud = kode worker lokal lewat koneksi Postgres langsung.** `packages/db` worker menerima antarmuka `Queryable { query(sql, params) → {rows} }`; di lokal PGlite, di cloud `pg.Pool` ke pooler Supabase (`SUPABASE_DB_URL`, transaction mode). Tidak ada implementasi ulang lewat PostgREST. Service-role key tetap hanya untuk Auth admin dan Storage.
- **K18 — Produksi dari `main`.** Semua perbaikan masuk lewat PR `fix/v1.1-hardening-cloud` → CI hijau → merge ke `main` → Vercel production. Tidak ada deploy dari branch.

## 3. Aturan baru

| R | Aturan | Menutup |
|---|---|---|
| R-60 | Trigger `correction_guard` (before insert/update, bila `current_app_role()` bukan null/service): insert hanya `draft` tanpa `approved_*`/`posted_at`; update `status`/`approved_*`/`posted_at` ditolak kecuali `current_setting('winata.rpc', true) = 'correction'` yang diset oleh `approve_correction`/`post_correction` (`set_config(..., true)` lokal transaksi); perubahan isi pada `approved` → `draft` + hapus persetujuan; `posted` immutable kecuali `deleted_at`+`delete_reason` oleh accounting | F-1, F-2 |
| R-61 | `post_correction`: batas K9 dihitung ulang pada saat posting dari nilai **saat ini**; `v_bod_ok` hanya bila `approved_by` berperan bod **dan** `approved_at` ≥ `updated_at` isi terakhir (atau cukup: R-60 menjamin persetujuan gugur saat isi berubah) | F-2 |
| R-62 | Trigger `enforce_actor` di tabel transaksi + `day_status` + `physical_count` + `opname`: untuk `authenticated`, `new.created_by := auth.uid()` saat insert; update `created_by` ditolak; kolom aktor lain (K12) bila diisi harus `= auth.uid()` | F-3 |
| R-63 | `revoke delete on <tabel transaksi & master> from authenticated`; policy `..._delete` dihapus; fungsi `soft_delete(table, id, reason)` tidak diperlukan — cukup update `deleted_at` lewat policy update yang sudah ada + trigger `soft_delete_guard`: `deleted_at` hanya null→now(); untuk `opname` `signed` dan `correction` `posted` hanya oleh accounting dan wajib `delete_reason`; `outbound` hanya bila `day_status ∉ {locked}`; perubahan `deleted_at` mengantre rebuild (trigger enqueue sudah menangkap update) | F-4 |
| R-64 | Trigger `auth_users_link` **after insert** on `auth.users`: `update app_user set id = new.id where lower(email)=lower(new.email) and id <> new.id`; semua FK ke `app_user(id)` diubah `on update cascade`; `created_by` (tanpa FK) di tabel diperbarui oleh fungsi yang sama. Alur app: `app_user` dulu (id sementara), lalu `auth.admin.createUser`; trigger menautkan. Alur admin pertama: `insert app_user` + `select create_login(email, password)` (fungsi security definer, service_role saja) yang menulis `auth.users` lengkap (`instance_id`, `aud`, `role`, `email_confirmed_at`, `raw_app_meta_data`, `encrypted_password=crypt(...)`) | F-5 |
| R-65 | `rebuild_queue` mendapat kolom `generation bigint default 0`; `enqueue_rebuild` menaikkan `generation` dan mengecilkan `from_date` juga saat `status='running'`; `claim_rebuild` mengembalikan `generation`; `mark_rebuild_done(location, generation)` hanya menandai `done` bila `generation` sama, selain itu kembali `queued` (worker berikutnya mengambil `from_date` terkecil) | F-6 |
| R-66 | Trigger enqueue memakai **old dan new** (lokasi dan tanggal) untuk update; untuk `transfer` keempat kombinasi; untuk `correction` juga `effective_date` lama | F-11 |
| R-67 | K4 di `lock_day`: `abs(diff_kg) > tolerance_kg` **OR** `abs(diff_kg) > tolerance_pct × computed_kg` (basis per grade; bila `computed_kg` null/0 pakai `tolerance_kg` saja); hitung fisik 7 hari terakhir di lokasi itu; catatan wajib `length(trim(note)) ≥ 10` | F-8 |
| R-68 | `outbound_guard` untuk `marketing`: kolom `status/delivered_at/delivered_by` tidak boleh berubah kecuali `dikirim→diterima`; `kandang` hanya `draft→dikirim` dengan `delivered_by = auth.uid()`; `WITH CHECK` `outbound_update` menambah `status` lama/baru | F-9 |
| R-69 | `WITH CHECK` `physical_count*`, `opname*` (update), `transfer` (terima) memeriksa `day_status_of(lokasi tujuan, received_date) in ('open','submitted')` untuk kandang; accounting `<> 'locked'` | F-10 |
| R-70 | Rekonstruksi: batas atas = `closing + Σ(rata-rata keluar harian Juli–T0 yang tercatat × hari bolong)`; batas bawah = `closing − Σ(rata-rata produksi 5 hari terakhir Juni × hari bolong)`; keduanya berlabel estimasi; parameter `reconstruct_missing_basis` (`june_avg`/`period_avg`, default `june_avg` untuk produksi, `period_avg` untuk keluar) | F-12 |
| R-71 | Akun jurnal dari parameter `coa_inventory_egg` dan `coa_inventory_variance` (nilai default: `"<isi dari CoA Winata> Persediaan Telur"` dan `"<isi dari CoA Winata> Selisih Persediaan (Pending RS-05)"`); layar `/rekonstruksi` menampilkan chip "Akun belum dikonfirmasi" selama default | F-13 |
| R-72 | `isMockAuth()` sesuai K15; login mock menolak user tanpa `password_hash`; `middleware` menolak cookie `mock_user` bila `!isMockAuth()` | F-14 |
| R-73 | Nilai buku rekonstruksi: parameter `tb_total_rp` default `389792323` (= 383.582.877 + 6.209.446; PRD v1 R-43 menulis 791.313.199 — **Q-21**, dikonfirmasi pemilik) | — |
| R-74 | Cron: `/api/cron/rebuild` tiap jam dan `/api/cron/controls` 20:00 WIB memproses lewat `Queryable` cloud, `maxDuration=300`, ≤ 10 lokasi per invokasi; `rebuildLocal` di aksi memproses inline ≤ 7 tanggal lewat `Queryable` yang sama | F-7 |

## 4. Tes v1.1 (semua di PGlite/vitest kecuali yang ditandai cloud)

| T | Kriteria lolos | Temuan |
|---|---|---|
| T-70 | Insert `correction` status `posted`/`approved` oleh accounting ditolak; `approved_by` di insert ditolak | F-1 |
| T-71 | BoD approve → accounting ubah `amount_rp` → status kembali `draft`, `approved_by` null → `post_correction` 12 jt ditolak; approve ulang → posted | F-2 |
| T-72 | Insert `physical_count` dengan `created_by` orang lain → tersimpan sebagai `auth.uid()`; update `created_by` ditolak; skenario F-3 → `approve_day` ditolak | F-3 |
| T-73 | `delete` oleh 6 peran pada 8 tabel transaksi + 4 master → ditolak (permission denied); `update deleted_at` oleh marketing pada DO hari `locked` ditolak; oleh accounting pada opname `signed` tanpa `delete_reason` ditolak, dengan alasan diterima dan `rebuild_queue` terisi dari tanggal opname | F-4 |
| T-74 | `insert app_user` lalu `insert auth.users` (shim) dengan e-mail sama → `app_user.id` = `auth.users.id`; `user_location` dan `day_status.submitted_by` ikut (cascade); e-mail di luar allow-list tetap ditolak | F-5 |
| T-75 | enqueue saat `running` → `generation` naik; `mark_rebuild_done` dengan generation lama → status `queued`, `from_date` terkecil; dengan generation sama → `done` | F-6 |
| T-76 | Update tanggal produksi 10→8 Okt → antrean `from_date` = 8 Okt; update lokasi SLP→CKL → kedua lokasi antre | F-11 |
| T-77 | K4: selisih 40 kg/stok grade 100 kg tanpa catatan → lock ditolak; 0,5 kg/100 kg → lolos; 60 kg/10.000 kg (0,6 %) → ditolak karena > 50 kg; catatan 10 karakter → lolos | F-8 |
| T-78 | Marketing set `status='dikirim'` ditolak; kandang lokasi lain ditolak; kandang lokasi sendiri lolos dengan `delivered_by=auth.uid()`; marketing `dikirim→diterima` lolos | F-9 |
| T-79 | Kandang insert `physical_count`/`opname` hari `locked`/`approved` ditolak; terima `transfer` ke lokasi tujuan hari `locked` ditolak | F-10 |
| T-80 | Rekonstruksi dengan 3 hari bolong: batas atas naik sebesar rata-rata keluar × 3, batas bawah turun sebesar rata-rata produksi Juni × 3; tanpa hari bolong batas = closing | F-12 |
| T-81 | Usulan Koreksi memakai `coa_*` dari parameter; dengan default → `accountsConfirmed=false` | F-13 |
| T-82 | `isMockAuth()` false bila `VERCEL=1` walau `MOCK_AUTH=1`; login mock user tanpa hash ditolak | F-14 |
| T-83 | Semua tes v1 (204) tetap hijau; `pnpm typecheck`, `pnpm lint` bersih | regresi |
| T-84 (cloud) | `select schema_version()` di Supabase = `1.1.0`; 8 migrasi tercatat | — |
| T-85 (cloud) | PostgREST dengan JWT 6 peran uji: `kandang.slp` 0 baris `production` lokasi CKL; `marketing` insert `production` → 42501; `bod` insert apa pun → 42501; `DELETE` oleh semua peran → 42501; `insert correction status='posted'` → ditolak | T-02/T-18 |
| T-86 (cloud) | `GET /api/cron/rebuild` tanpa bearer → 401; dengan bearer → 200, `rebuild_queue` `done`, `position_daily` terisi untuk data uji; input produksi lewat UI → dashboard berubah tanpa cron | F-7 |
| T-87 (cloud) | Login admin pemilik berhasil; buat 1 user lewat `/admin` → `app_user.id = auth.users.id` | F-5 |
| T-88 (cloud) | `pnpm e2e` hijau di CI GitHub Actions pada PR v1.1 (bukti tautan run) | F-15 |

## 5. Pertanyaan terbuka baru (default dipakai; jangan difinalkan)

| Q | Pertanyaan | Default |
|---|---|---|
| Q-21 | Nilai buku pembanding rekonstruksi: 389.792.323 (jumlah dua akun) atau 791.313.199 (angka PRD)? | `tb_total_rp = 389792323` |
| Q-22 | Kode akun CoA Winata untuk Persediaan Telur dan Selisih Persediaan | placeholder R-71, chip "belum dikonfirmasi" |
| Q-23 | E-mail admin pemilik untuk production | `dika.g.irawan@gmail.com` (akun Google pemilik); `dika@winata.co.id` tidak dibuat |
| Q-24 | Nama project Supabase dan Vercel | `winata-egg-position` keduanya |
| Q-25 | Apakah akun uji `@winata.test` boleh tetap ada di production setelah verifikasi? | tidak; dihapus di akhir verifikasi, bukti disimpan di log |
