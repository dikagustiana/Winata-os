# CLOUD-RUN — Winata Egg Position v1.1 (run tanpa pengawasan, 26/27-10-2026)

Ringkasan untuk pemilik. Tidak ada rahasia di berkas ini (password admin, `CRON_SECRET`, password role
worker hanya ada di pesan akhir agen).

## Hasil singkat

- **Kode v1.1 selesai dan ter-merge ke `main`**: PR [dikagustiana/Winata-os#1](https://github.com/dikagustiana/Winata-os/pull/1)
  (squash `c94f8c8`). CI GitHub Actions hijau termasuk e2e.
- **Supabase**: project `winata-egg-position` dibuat (ref `sbldeewipmxhutbssspe`, `ap-southeast-1`,
  Postgres 17), pgcrypto aktif, role worker `winata_worker` dibuat. **Migrasi belum diterapkan**: server MCP
  Supabase meminta konfirmasi Anda untuk `apply_migration` dan tidak ada yang menjawab (detail: `docs/log/M9.md`).
- **Vercel: belum ada project.** Token konektor Vercel ditolak `403 forbidden` saat membuat project.
- **Aplikasi belum live.** Yang kurang hanya dua izin di atas; urutan lanjutan ada di bawah (≈ 20–30 menit).

## Status tes v1.1

| T | Status | Bukti |
|---|---|---|
| T-70…T-79 | hijau | `supabase/tests/hardening.test.ts` 22 tes; merah sebelum 0008 (`docs/log/M7.md`) |
| T-80, T-81 | hijau | `packages/engine/test/reconstruct.test.ts` 5 tes; merah sebelumnya |
| T-82 | hijau | `apps/web/test/mock-auth.test.ts` 4 tes |
| T-83 | hijau | `pnpm typecheck` 0 · `pnpm test` 245/245 (204 v1 + 41 baru) · `pnpm lint` bersih · `pnpm build` sukses |
| T-84 | tertunda | migrasi menunggu konfirmasi pemilik |
| T-85 | tertunda | butuh skema |
| T-86 | tertunda | butuh project Vercel |
| T-87 | tertunda | butuh skema + `create_login` |
| T-88 | hijau | CI run [40367877099](https://github.com/dikagustiana/Winata-os/actions/runs/40367877099): typecheck, test, lint, e2e `28 passed, 8 skipped` |

Tambahan: jalur worker `pg` diuji terhadap PostgreSQL 16 sungguhan. `position_daily` identik dengan PGlite
(1.770 baris), dan 0008 terbukti idempoten (`docs/log/M8.md`).

## Identitas cloud

| Item | Nilai |
|---|---|
| Supabase project ref | `sbldeewipmxhutbssspe` |
| Supabase URL | `https://sbldeewipmxhutbssspe.supabase.co` |
| Dashboard | https://supabase.com/dashboard/project/sbldeewipmxhutbssspe |
| Role worker DB | `winata_worker` (login, bypassrls; hak default untuk objek yang dibuat `postgres` di schema `public`) |
| Vercel tim | `dikagustiana-4804's projects` (`team_qkOkuTIM75I336YmxaGlDwWZ`) |
| Vercel project | belum ada (403) |
| URL production | belum ada |

Nama env yang harus terpasang di Vercel (production **dan** preview):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`, `CRON_SECRET`,
`SUPABASE_SERVICE_ROLE_KEY`. Jangan set `MOCK_AUTH`, `MOCK_AUTH_ALLOW_PRODUCTION_BUILD`, atau `LOCAL_DB_DIR`.

## Tindakan pemilik pagi ini (urut)

1. **Jadikan repo privat** (K10; repo masih publik dan berisi angka TB serta nama pelanggan).
   GitHub → `dikagustiana/Winata-os` → Settings → General → *Danger Zone* → **Change repository visibility** → Private.
2. **Izinkan migrasi Supabase.** Pilih salah satu:
   - **(disarankan)** Balas di sesi Claude ini: `lanjut M9`. Saat muncul pertanyaan konfirmasi dari server
     Supabase, setujui. Agen lalu menerapkan 0001…0008 (`apply_migration`, nama = nama berkas), seed
     `0001_master` + `0005_hdp` + `0006_item_map`, admin `dika.g.irawan@gmail.com` (`create_login`),
     bucket privat `ba-photos`/`attachments`/`uploads`, lalu menjalankan T-84, T-85 (6 akun uji
     `@winata.test`, lalu dihapus) dan T-87.
   - atau lewat CLI di laptop: `npx supabase login` → `npx supabase link --project-ref sbldeewipmxhutbssspe`
     → `npx supabase db push` (menerapkan `supabase/migrations/0001…0008`). Seed dan admin tetap lewat langkah
     agen di atas, atau SQL Editor (isi `supabase/seed/0001_master.sql`, `0005_hdp.sql`, `0006_item_map.sql`).
     **Jangan** jalankan `0002_flocks`, `0003_users`, `0004_opname_t0`.
3. **Buat project Vercel** (token konektor tidak berhak; 403). Vercel Dashboard → *Add New…* → *Project* →
   Import `dikagustiana/Winata-os` → nama `winata-egg-position` →
   Root Directory **`apps/web`** → Framework **Next.js** → Install Command `pnpm install --frozen-lockfile` →
   Build Command `pnpm --filter @winata/web build` → *Environment Variables* (production + preview):
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://sbldeewipmxhutbssspe.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = kunci anon (ada di pesan akhir; juga di Supabase → Project Settings → API Keys)
   - `CRON_SECRET` = nilai di pesan akhir
   - `SUPABASE_DB_URL` = Supabase Dashboard → **Connect** → *Transaction pooler* (port **6543**): salin
     string itu, ganti user `postgres.sbldeewipmxhutbssspe` menjadi `winata_worker.sbldeewipmxhutbssspe` dan
     password menjadi password worker di pesan akhir; tambahkan `?sslmode=require`.
   - `SUPABASE_SERVICE_ROLE_KEY` = Supabase → Project Settings → API Keys → `service_role` (atau secret key).
     Tanpa kunci ini, login, sesi, transaksi, dan worker tetap jalan; yang menunggu hanya **buat akun / ganti
     kata sandi di `/admin`** dan **unggah foto/berkas** (chip kuning di `/admin`).
   → **Deploy**. `apps/web/vercel.json` sudah berisi region `sin1` dan 2 cron (rebuild tiap jam, kontrol
   13:00 UTC = 20:00 WIB). Aktifkan *Vercel Authentication* untuk preview (preview memakai DB yang sama, K16).
   Atau beri hak "create project" ke konektor Vercel lalu balas `lanjut Vercel`; agen akan membuat project,
   memasang env, deploy, dan menjalankan T-86.
4. **Login dan ganti kata sandi admin** (sesudah langkah 2–3): buka URL production → `/login` →
   `dika.g.irawan@gmail.com` + kata sandi di pesan akhir → `/admin` → Pengguna → atur kata sandi baru
   (butuh `SUPABASE_SERVICE_ROLE_KEY`). Sebelum kunci terpasang: Supabase → Authentication → Users → *Reset password*.
5. **Jawab Q-21, Q-22, Q-23** di `docs/QUESTIONS.md`, lalu isi parameter di `/admin` → Parameter:
   `tb_total_rp` (default 389.792.323), `coa_inventory_egg`, `coa_inventory_variance` (masih placeholder,
   chip "Akun belum dikonfirmasi").
6. **BA T0**: tetapkan tanggal T0 → isi opname di `/fisik/<lokasi>?mode=opname` (tiga tanda tangan) → impor log
   kertas lewat `/rekon?tab=import` → bangun posisi sekali:
   `curl -H "Authorization: Bearer <CRON_SECRET>" "https://<url-production>/api/cron/rebuild?full=1&from=<T0>"`.
7. **Backup**: sesudah repo privat, tambahkan secret repo `SUPABASE_DB_URL` = Supabase → Connect →
   *Session pooler* (port **5432**, user `postgres.sbldeewipmxhutbssspe`; password `postgres` diatur ulang di
   Project Settings → Database). Koneksi langsung `db.<ref>.supabase.co` hanya IPv6 dan tidak terjangkau dari
   GitHub Actions. Jalankan workflow **backup** manual sekali (*Run workflow*), lalu uji restore ke project kosong.
   Workflow sengaja dilewati selama repo publik.

## Yang tidak selesai dan kenapa

| Butir | Penyebab | Bukti |
|---|---|---|
| Migrasi + seed + admin + bucket di Supabase | server MCP Supabase meminta konfirmasi manusia untuk `apply_migration`; tidak ada jawaban dalam 60 detik. Agen tidak mengakalinya lewat `execute_sql`. | `docs/log/M9.md` |
| Project/env/deploy Vercel, cron live | `403 forbidden` pada `create_project` dan `create_git_project`; CLI `vercel` tidak tersedia | `docs/log/M9.md` |
| Repo privat | `gh` di sesi tidak terautentikasi; tool GitHub tidak punya operasi ubah visibilitas | `docs/log/M7.md` |
| T-84…T-87 | bergantung pada dua butir pertama | — |
| Verifikasi host pooler | koneksi TCP keluar diblokir dari sesi; host diambil dari Dashboard → Connect | `docs/log/M9.md` |
| Branch `fix/v1.1-hardening-cloud` | sesi dikunci ke `claude/eloquent-goodall-w5a16l` (Q-26) | PR #1 |

## Catatan keamanan baru (sudah ditutup di 0008)

Default privileges Supabase memberi EXECUTE ke `anon`/`authenticated` untuk setiap fungsi baru. Tanpa 0008,
`set_login_password` (ganti kata sandi siapa pun) dan fungsi internal lain bisa dipanggil lewat
`/rest/v1/rpc` dengan anon key. 0008 mencabutnya (Q-28). Karena itu **jangan** menerapkan hanya 0001–0007
ke database yang bisa diakses publik.
