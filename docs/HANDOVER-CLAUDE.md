# Serah terima ke Claude Code — Winata Egg Position v1

Dokumen ini melanjutkan `PLAN.md` §Serah terima. Semua pekerjaan **M0–M6 sudah
selesai dan hijau di lingkungan lokal** (PGlite + mock auth). Tugas Claude Code
adalah **review, jalankan di Supabase staging/production, adaptasi worker cloud,
verifikasi lewat API asli, dan deploy Vercel** — bukan membangun ulang aplikasi.

- Repo: `C:\work\Winata-os` (branch `m0-m6-full`, commit `4a43001`, `3dd7165`,
  plus commit handover ini).
- Sumber kebenaran: `docs/PRD-v1.md` → `docs/PLAN.md` → `docs/DESIGN.md` →
  `docs/ARCHITECTURE.md`. PRD menang bila bertentangan.
- Laporan per milestone: `docs/log/M0.md` … `docs/log/M6.md`.
- Pertanyaan terbuka & default: `docs/QUESTIONS.md`. **Q-11 wajib diselesaikan
  sebelum production.**

---

## 1. Status gerbang yang sudah dibuktikan (lokal)

| Perintah | Hasil terakhir |
|---|---|
| `pnpm typecheck` | 0 galat |
| `pnpm test` | 15 file, **204 tes** lulus (termasuk 88 tes RLS, 17 workflow, 7 rebuild) |
| `pnpm e2e` | **28 lulus**, 8 dilewati (journey desktop tidak diulang di proyek mobile) |
| `pnpm lint` | eslint + `lint-ui` bersih |
| `pnpm build` | sukses, 21 rute (`apps/web`) |

E2E mencakup: 6 peran login + 404 + 390/1366 px, journey H (DO → produksi → susut
→ serah → mutasi → submit), journey A (submit → approve → lock → koreksi 8 jt),
offline draft + konflik hari approved, outlook order → kekurangan pasok, kas 13
minggu, upload Accurate → K8 → ekspor BS 04A, ekspor Usulan Koreksi.

Jangan mengubah fixture golden (`fixtures/*/golden.json`), migrasi yang sudah
di-merge, token DESIGN, atau keputusan K/R untuk membuat tes hijau. Bila golden
salah, buktikan manual lalu ubah golden + tes dalam satu commit.

---

## 2. Peta kode yang perlu dibaca lebih dulu

| Area | Berkas |
|---|---|
| Auth/sesi | `apps/web/lib/session.ts`, `lib/auth-actions.ts`, `lib/supabase/server.ts`, `middleware.ts` |
| Klien data lokal (PGlite, RLS) | `packages/db/src/local-client.ts`, `packages/db/src/pglite.ts` |
| Worker lokal | `packages/db/src/rebuild.ts`, `controls.ts`, `outlook-worker.ts` |
| Engine murni | `packages/engine/src/*.ts` (posisi, aging, konversi, HDP, proyeksi, kas, rekonstruksi, recon) |
| Aksi server | `apps/web/lib/actions/*.ts` |
| Halaman | `apps/web/app/(app)/…`, `app/login`, `app/api` |
| Migrasi & seed | `supabase/migrations/0001…0007*.sql`, `supabase/seed/*.sql` |
| Tes | `supabase/tests/*.test.ts`, `packages/*/test/*.test.ts`, `tests/e2e/*.spec.ts` |
| Fixture | `fixtures/{week,outlook,cash,reconstruct,accurate}-example/` |

Alur data: server action menulis tabel transaksi → trigger `txn_enqueue_rebuild`
mengisi `rebuild_queue` → worker menghitung `position_daily` / `projection_daily`
→ halaman hanya membaca tabel hasil + `control_result`.

---

## 3. P0 — pekerjaan wajib sebelum production

### 3.1 Worker cloud (Q-11) — **blocker utama**

Saat ini worker hanya berjalan di PGlite:

- `apps/web/app/api/cron/rebuild/route.ts` dan `…/controls/route.ts` mengembalikan
  **501** bila `MOCK_AUTH != "1"`.
- `apps/web/lib/actions/common.ts#rebuildLocal` langsung `return` bila bukan mock,
  sehingga posisi tidak diperbarui inline di cloud.
- `packages/db/src/rebuild.ts`, `controls.ts`, `outlook-worker.ts` menerima `PGlite`.

**Yang harus dibuat Claude Code** (pilih satu, rekomendasi A):

**A. Adapter service-role di Vercel (paling sederhana, memakai engine yang sudah ada)**

1. Buat `packages/db/src/cloud-worker.ts` (atau `apps/web/lib/cloud-worker.ts`):
   - fungsi `loadRebuildInput(service, toDate)` memuat:
     `location`, `grade`, `opname` + `opname_line` (hanya `status='signed'`),
     `production`, `outbound` + `outbound_line` (`status in ('dikirim','diterima')`,
     `kg = coalesce(kg_delivered,kg_doc)`), `transfer`, `shrinkage`,
     `correction` (`status='posted'`), parameter `hpp_per_kg`, `age_buckets_days`.
   - **wajib paginasi** `.range(from, from+999)`; PostgREST default membatasi 1000 baris.
   - panggil `computePosition()` dari `@winata/engine`; tulis `position_daily`
     dengan upsert berkelompok ±150 baris memakai `service.from("position_daily").upsert(rows,
     { onConflict: "location_id,grade_id,date" })`.
   - `claim_rebuild(n)` dan `mark_rebuild_done(location)` adalah RPC `security definer`
     yang sudah di-grant ke `service_role` (migrasi `0003`).
2. Sambungkan ke route cron: hapus guard 501, panggil adapter, lalu
   `refreshProjectionCloud()` dan `processControlsCloud()`. Tambahkan
   `export const maxDuration = 300;` dan batasi jumlah lokasi per invokasi (mis. 10).
3. Di `lib/actions/common.ts`, buat `rebuildLocal` memakai adapter cloud saat
   `!isMockAuth()` dan tetap memproses ≤7 tanggal secara inline supaya angka
   dashboard berubah setelah submit (K1/K2 membutuhkan `position_daily` segar).
4. Bootstrap awal: setelah BA T0 diimpor, jalankan satu kali build penuh
   T0…hari ini (lewat route dengan `from_date=T0` atau skrip Node service-role).
   Jangan mengandalkan cron per jam untuk 100+ hari pertama.

**B. Edge Function/cron terpisah** — hanya bila A tidak memungkinkan; tetap wajib
memakai engine yang sama, bukan menghitung ulang di SQL.

**Kriteria terima:**
- `GET /api/cron/rebuild` dengan bearer mengembalikan 200, bukan 501.
- `rebuild_queue` kosong/`done` setelah cron; `position_daily` berisi T0…hari ini
  untuk semua (lokasi × grade).
- Dashboard menampilkan posisi setelah transaksi disimpan tanpa menunggu cron.
- Angka `position_daily` sama dengan hasil `pnpm test` (golden) pada data uji.

### 3.2 Identitas Auth = `app_user.id`

RLS memakai `auth.uid()`, jadi **`app_user.id` wajib sama dengan `auth.users.id`**.

- `createUserAction` (`apps/web/lib/actions/admin.ts`) **sudah diperbaiki** pada
  commit handover: di cloud ia membuat user Auth lebih dulu, lalu memakai
  `created.user.id` untuk `app_user`. Verifikasi di staging.
- **Admin pertama** (chicken-and-egg):
  1. Supabase Dashboard → Authentication → Users → *Add user* (`dika@…`, password kuat).
  2. Salin UID, jalankan di SQL Editor:
     ```sql
     insert into public.app_user (id, email, name, role, active)
     values ('<AUTH_UID>', 'dika@winata.co.id', 'Dika', 'admin', true);
     -- penugasan bila perlu:
     -- insert into public.user_location (user_id, location_id)
     -- values ('<AUTH_UID>', '<LOCATION_ID>');
     ```
  3. Login sebagai admin → buat 6 akun lain lewat `/admin` (alur yang sudah benar).
- **Seed `0003_users.sql` hanya untuk lokal/e2e.** File itu membuat 9 `app_user`
  dengan ID acak tanpa baris `auth.users`; jangan dijalankan di production.
  Untuk staging: jalankan seed master/flok/HDP/item_map saja, atau bersihkan
  setelah uji:
  ```sql
  -- hanya staging, sebelum data nyata
  update opname set counter_id = null, witness_id = null, manager_id = null
   where counter_id in (select id from app_user where email like '%@winata.test');
  delete from user_location where user_id in (select id from app_user where email like '%@winata.test');
  delete from app_user where email like '%@winata.test';
  ```
  (Di DB staging baru, tabel transaksi belum mereferensikan user seed kecuali
  opname contoh; hapus/ubah opname contoh lebih dulu.)
- `setPasswordAction` di cloud memakai `auth.admin.listUsers()` (default 50);
  bila pengguna >50 tambahkan paginasi sebelum dipakai luas.

### 3.3 Storage (foto BA, lampiran, upload Accurate)

- Buat 3 bucket **privat**: `ba-photos`, `attachments`, `uploads`.
- Aplikasi mengunggah lewat service role (`apps/web/lib/storage.ts`) dan membaca
  lewat **signed URL**. Halaman `/fisik` dan BA sudah memakai signed URL; rute
  `/api/storage/[...path]` adalah fs lokal dan tidak dipakai di cloud.
- Tidak perlu policy Storage publik; semua akses server-side. Bila nanti browser
  mengunggah langsung, tambahkan policy per `app_user`/lokasi.
- Uji: unggah 1 foto BA di staging, buka signed URL, pastikan 404 setelah kedaluwarsa.

### 3.4 Migrasi di Supabase

```bash
npx supabase login
npx supabase link --project-ref <REF>
npx supabase db push
```

Catatan yang sudah diuji secara logis tetapi belum di cloud:

- `0001` membuat skema `auth`/`auth.users` **hanya bila belum ada**; di Supabase
  objek auth tidak ditimpa (`create table if not exists`, fungsi `auth.uid()`
  dibuat kondisional).
- `set_login_password` memakai `encrypted_password` + `crypt()` dari schema
  `extensions`; pastikan `pgcrypto` ada:
  ```sql
  create extension if not exists pgcrypto with schema extensions;
  ```
  Fungsi ini tidak di-grant ke API; hanya `service_role`/SQL Editor.
- Peran `anon/authenticated/service_role` sudah ada; pembuatan role memakai
  `if not exists`.
- `db push` tidak menjalankan seed. Terapkan seed secara sadar (lihat §5).

### 3.5 RLS lewat API asli (T-02/T-18 di staging)

Untuk setiap peran, login lewat aplikasi (atau `signInWithPassword` dengan anon key),
ambil access token, lalu uji PostgREST:

```bash
curl -s "<SUPABASE_URL>/rest/v1/production?select=location_id" \
  -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <USER_JWT>"
```

Kriteria:

- `kandang.slp@…` hanya melihat `production.location_id = SLP`; tidak melihat CKL.
- `marketing` tidak dapat `INSERT production` (HTTP 403 / error RLS).
- `bod` tidak dapat menulis; hanya membaca (kecuali self `app_user`).
- `kandang` tidak dapat menulis produksi pada hari `approved`/`locked`.
- `manager` dapat `approve_day` hanya untuk lokasi yang ditugaskan; K1 menolak
  bila ia menginput hari itu.
- `accounting` dapat `lock_day`; `post_correction` K9 menolak tanpa BoD.

Catat hasilnya di `docs/log/STAGING.md` (buat baru) dengan peran, endpoint,
HTTP code, dan jumlah baris.

### 3.6 Cron & zona waktu

- Vercel Cron mengirim `Authorization: Bearer $CRON_SECRET` bila env `CRON_SECRET`
  diisi. Route menolak tanpa header itu.
- `apps/web/vercel.json`: rebuild tiap jam; controls `0 13 * * *` UTC = 20:00 WIB.
- `input_deadline` parameter default `"20:00"` dibandingkan dengan jam WIB di
  `packages/engine/src/controls.ts` (`nowTimeWib`), bukan UTC.

---

## 4. P1 — perbaikan yang disarankan saat staging

| Isu | Lokasi | Catatan |
|---|---|---|
| T-27 diuji statis, bukan spy runtime | `supabase/tests/dashboard.test.ts` | Bila memungkinkan, refactor loader dashboard menjadi fungsi yang diuji dengan klien proxy |
| BA belum PDF | `/fisik/[lokasi]/ba/[id]` | Cetak browser; bila perlu PDF server, tambahkan `pdf-lib`/LibreOffice, jangan ubah tata letak |
| Harga DO impor null | `lib/actions/recon.ts` | K8 hanya menghitung Rp dari DO berharga; pemilik dapat memperbaiki CSV |
| Nomor DO loncat lintas bulan | `packages/engine/src/controls.ts` | Q-17: periksa apakah perlu reset per bulan |
| Kalibrasi flok tanpa aktual | `packages/engine/src/hdp.ts` | Faktor 1 + flag `insufficient_calibration`; Q-5 |
| `nextDoNumber` balapan dua DO bersamaan | `apps/web/lib/convert.ts` | Unique constraint menolak; tambahkan retry sekali bila terjadi |
| Halaman foto cloud sudah signed URL | `apps/web/lib/storage.ts` | Verifikasi di staging; jangan pakai `/api/storage` di cloud |
| `pnpm db:reset` menghapus DB lokal | `scripts/reset-local-db.ts` | Hanya untuk lokal; jangan dijalankan di cloud |

---

## 5. Kebijakan seed

| File seed | Boleh di production? | Tindakan |
|---|---|---|
| `0001_master.sql` | ya, setelah diganti | Ganti kode/nama lokasi, grade, pelanggan, parameter; update `opname_t0_date`, HPP, TB |
| `0002_flocks.sql` | tidak | Contoh flok; ganti dengan register nyata (manager) |
| `0003_users.sql` | **tidak** | Hanya lokal/e2e (lihat §3.2) |
| `0004_opname_t0.sql` | **tidak** | BA contoh; production memakai BA T0 asli |
| `0005_hdp.sql` | sementara | Kurva seed; ganti dengan panduan strain resmi (Q-5, `docs/reference/hdp-sources.md`) |
| `0006_item_map.sql` | tidak | Kode item sintetis; ganti dengan kode Accurate asli |

Database lokal (`MOCK_AUTH=1`) otomatis menjalankan semua migrasi + seed + build
posisi/proyeksi. **Di cloud, seed dijalankan manual dan selektif.**

---

## 6. Skenario staging (urutan yang disarankan)

1. **Review kode** (checklist §8) — jangan deploy sebelum RLS/workflow dipahami.
2. Buat project Supabase **staging** region `ap-southeast-1`.
3. `supabase db push`; cek `select schema_version();` = `1.0.0`, tabel inti ada.
4. Terapkan seed master + HDP + item map (bukan users/opname/flok contoh).
5. Buat admin pertama (§3.2), login, lalu buat 6 akun uji lewat `/admin`.
6. Buat 3 bucket Storage (§3.3); uji upload foto BA.
7. Implementasi/aktifkan worker cloud (§3.1); bootstrap posisi; uji cron.
8. Uji matriks RLS T-02/T-18 via API (§3.5); catat di `docs/log/STAGING.md`.
9. Uji alur penuh di browser staging: login 6 peran, isi produksi, submit,
   approve, lock, koreksi, offline tidak diuji di cloud (hanya lokal).
10. BA T0 asli: mode opname per lokasi, tiga tanda tangan, foto; set
    `parameter.opname_t0_date`; build ulang posisi; bandingkan opening vs BA.
11. Impor log kertas Juli–T0 lewat `/rekon?tab=import`; verifikasi `source=import`.
12. Accurate: ganti `item_map` dengan kode asli, unggah ekspor asli, hitung K8,
    jelaskan/dikoreksi selisih, ekspor BS 04A.
13. Rekonstruksi 30-06: target/T0/nilai buku dari parameter; ekspor Usulan Koreksi.
14. Backup harian (§7).
15. Baru setelah semua hijau, ulangi untuk **production**.

---

## 7. Production: Vercel, akun, backup

### Vercel

- Project baru, root directory **`apps/web`**, framework Next.js, region **sin1**.
- Repo monorepo pnpm; Vercel mendeteksi lockfile di root. Bila build tidak
  menemukan `@winata/*`, aktifkan “Include source files outside of the Root
  Directory” atau set install command di root repo.
- Env (production & preview):
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (server-only; jangan `NEXT_PUBLIC_`)
  - `CRON_SECRET` (acak ≥ 32 byte)
  - **Jangan** set `MOCK_AUTH` atau `LOCAL_DB_DIR` di Vercel.
- `apps/web/vercel.json` sudah berisi cron; pastikan cron muncul di dashboard
  Vercel dan mengirim header bearer.
- Setelah deploy: buka `/login`, login admin, cek `/api/cron/rebuild` manual
  dengan bearer, cek dashboard.

### Backup harian (contoh, belum diaktifkan)

Buat `.github/workflows/backup.yml` di repo (butuh secret
`SUPABASE_DB_URL` = connection string langsung, bukan pooler transaksi):

```yaml
name: backup
on:
  schedule: [{ cron: "0 18 * * *" }]   # 01:00 WIB
  workflow_dispatch:
jobs:
  dump:
    runs-on: ubuntu-latest
    steps:
      - run: |
          sudo apt-get update && sudo apt-get install -y postgresql-client
          pg_dump "${{ secrets.SUPABASE_DB_URL }}" --no-owner --no-privileges \
            | gzip > backup-$(date +%F).sql.gz
      - uses: actions/upload-artifact@v4
        with:
          name: backup-${{ github.run_id }}
          path: backup-*.sql.gz
          retention-days: 30
```

Jangan commit connection string. Uji restore ke project sekali sebelum go-live.

---

## 8. Checklist review kode (fokus PLAN §Serah terima)

**Wajib dibaca/diuji:**

- [ ] RLS per tabel (`0002_security.sql`): baca/tulis 6 peran; `kandang` A ≠ B;
      `marketing` tidak menulis produksi; `bod` tidak menulis; `audit_log` hanya
      accounting/admin.
- [ ] K1: `approve_day` memeriksa `current_user_has_input` + `submitted_by`.
- [ ] K2: closing negatif memblokir approve.
- [ ] K4: `lock_day` memeriksa selisih fisik 7 hari + `note`.
- [ ] K9: `post_correction` memeriksa Rp/±% stok dan `approved_by` berperan `bod`.
- [ ] `claim_rebuild` atomik; dua pemanggil tidak membangun lokasi yang sama.
- [ ] Offline conflict: draft tidak ditimpa saat hari approved (lokal e2e).
- [ ] Semua nominal Decimal/`numeric`, tidak ada float; cek `packages/engine`.
- [ ] Tidak ada `SUPABASE_SERVICE_ROLE_KEY` di bundle klien (`grep -r` di `.next/static`).
- [ ] `set_login_password` tidak dapat dipanggil `authenticated`.

**Celah yang sudah diketahui (jangan terkejut):**

- Worker cloud belum ada — Q-11, blocker.
- T-27 statis — lihat log M2.
- PDF BA via print browser.
- HPP sementara di semua kartu.
- `local-client` hanya untuk mock; jangan dipakai di jalur cloud.

---

## 9. Verifikasi pasca-deploy (bukti yang harus dikumpulkan)

Simpan hasil di `docs/log/STAGING.md` / `PRODUCTION.md`:

1. `select schema_version();` dan jumlah migrasi.
2. Login 6 peran; screenshot dashboard 390 px dan 1366 px.
3. Matriks RLS per sel (minimal 12 tabel × 6 peran untuk baca; 16 tes tulis).
4. `POST` production sebagai kandang SLP → `GET` sebagai kandang CKL (0 baris).
5. `approve_day` oleh manager yang menginput → error; oleh manager lain → sukses.
6. `lock_day` dengan selisih fisik tanpa note → error; dengan note → sukses.
7. Koreksi Rp 12 jt tanpa BoD → error; setelah `approve_correction` BoD → posted.
8. Upload foto BA → signed URL 200; path tidak dapat diakses tanpa signed URL.
9. `GET /api/cron/rebuild` tanpa bearer → 401; dengan bearer → 200 dan antrean berubah.
10. Impor 100 baris CSV → 100 baris `source=import`; 1 baris salah → 0 baris.
11. Upload Accurate asli → K8 item; ekspor BS 04A terbuka di Excel.
12. Rekonstruksi → XLSX Usulan Koreksi; total Dr = Cr, memo RS-05.
13. Backup artifact muncul; restore ke project kosong berhasil.

---

## 10. Perintah lokal yang tetap berlaku

```powershell
cd C:\work\Winata-os
pnpm install
pnpm typecheck
pnpm test
pnpm e2e
pnpm lint
pnpm build

# aplikasi lokal
$env:MOCK_AUTH="1"
$env:LOCAL_DB_DIR=".local-db"
$env:WINATA_REPO_ROOT=(Get-Location).Path
$env:CRON_SECRET="lokal"
pnpm dev            # http://localhost:3100

# utilitas
pnpm db:reset       # hapus DB lokal; dibuat ulang saat dev
pnpm golden:week    # fixture week-example + golden
pnpm golden:outlook # fixture outlook + golden
pnpm golden:cash    # fixture kas/rekonstruksi/Accurate (make-fixtures)
```

Akun lokal (password `winata123`): lihat `README.md` §Akun contoh.

---

## 11. Definisi selesai untuk Claude Code

- [ ] Worker cloud berjalan; cron 200; posisi live setelah input.
- [ ] RLS T-02/T-18 terbukti lewat API staging, dicatat dengan HTTP code.
- [ ] Auth 6 peran staging + admin pertama; `app_user.id = auth.uid`.
- [ ] Storage BA teruji; foto dapat dibuka lewat signed URL.
- [ ] BA T0 asli menjadi opening hari pertama; impor log Juli–T0 selesai.
- [ ] K8 dengan ekspor Accurate asli; selisih dijelaskan/dikoreksi.
- [ ] Rekonstruksi 30-06 + Usulan Koreksi diuji di staging.
- [ ] Production Supabase + Vercel `sin1` live; env 4 variabel; cron aktif.
- [ ] Backup harian + uji restore.
- [ ] `docs/log/STAGING.md` dan `PRODUCTION.md` diisi bukti.
- [ ] Q-11 ditutup di `docs/QUESTIONS.md`; Q-10/Q-15/Q-5 dijawab pemilik bila ada.

Bila menemukan konflik dokumen, catat di `docs/QUESTIONS.md` dan ikuti PRD.
Jangan mengubah migrasi yang sudah di-merge; tambahkan migrasi baru bernomor
`2026…` bila perlu perubahan skema.
