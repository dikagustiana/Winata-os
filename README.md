# Winata Egg Position v1

Aplikasi posisi telur harian PT Winata Mega Agro (Gunung Jati Group): master,
transaksi kandang, hitung fisik/opname, posisi FIFO, status hari, dashboard,
outlook, kas 13 minggu, rekonsiliasi Accurate, dan rekonstruksi 30-06-2026.

Sumber kebenaran ada di `docs/PRD-v1.md`, `docs/PLAN.md`, `docs/DESIGN.md`,
`docs/ARCHITECTURE.md`, ditambah adendum v1.1 (`docs/*-v1.1.md`, menang untuk butir yang disebut).
Status cloud terakhir: `docs/log/CLOUD-RUN.md`. Keputusan kecil dan pertanyaan terbuka di
`docs/QUESTIONS.md`. Laporan per milestone di `docs/log/`.

## Struktur

```
apps/web            Next.js 15 App Router (UI Bahasa Indonesia, server actions)
packages/engine     mesin murni: posisi, aging, konversi, HDP, proyeksi, kas, rekonstruksi
packages/db         PGlite (lokal/e2e), klien data, worker rebuild/kontrol/proyeksi
packages/parsers    CSV importer R-50, parser ekspor Accurate
supabase/migrations 0001_schema … 0008_hardening (v1.1)
supabase/seed       master, flok, pengguna, opname T0, HDP, item_map
supabase/tests      tes migrasi, RLS, workflow, rebuild, kontrol
fixtures            week-example, outlook-example, cash-example, reconstruct-example, accurate-example
tests/e2e           Playwright (desktop + mobile)
docs                PRD/PLAN/DESIGN/ARCHITECTURE, QUESTIONS, log, reference
```

## Menjalankan lokal (tanpa Docker, tanpa Supabase)

Prasyarat: Node ≥ 20, pnpm 10.

```powershell
pnpm install
pnpm typecheck
pnpm test        # vitest + PGlite (semua migrasi dijalankan dari nol)
pnpm e2e         # Playwright; server dev di 127.0.0.1:3100 dengan MOCK_AUTH=1
pnpm lint
pnpm build       # build produksi Next.js (butuh env Supabase hanya saat runtime cloud)
```

Menjalankan aplikasi:

```powershell
$env:MOCK_AUTH = "1"
$env:LOCAL_DB_DIR = ".local-db"
$env:WINATA_REPO_ROOT = (Get-Location).Path
$env:CRON_SECRET = "ganti-di-lokal"
pnpm dev         # http://localhost:3100
```

Database lokal (PGlite) dibuat otomatis dari `supabase/migrations` + `supabase/seed`,
lalu posisi T0..hari ini dan proyeksi 28 hari dibangun saat pertama kali dibuka.
Bila daftar migrasi berubah, DB lokal dibangun ulang (hanya saat `MOCK_AUTH=1`).

### Akun contoh

Kata sandi semua akun uji: `winata123`.

| Peran | E-mail |
|---|---|
| Admin (pemilik) | dika.g.irawan@gmail.com |
| Kandang SLP | kandang.slp@winata.test |
| Kandang CKL | kandang.ckl@winata.test |
| Gudang TSK | gudang.tsk@winata.test |
| Manager | manager@winata.test |
| Accounting | accounting@winata.test |
| Marketing | marketing@winata.test |
| Direksi | bod@winata.test |

Akun di atas hanya untuk lokal/e2e (`supabase/seed/0003_users.sql`), tidak pernah di production.
Pendaftaran mandiri ditolak trigger; admin membuat akun di `/admin` (v1.1 R-64: baris `app_user`
dibuat dulu, lalu akun Auth; trigger menyamakan `app_user.id = auth.users.id`).

## Peta layar

| Rute | Peran |
|---|---|
| `/` | semua (dashboard baca `position_daily` + `control_result`) |
| `/hari/[lokasi]/[tanggal]` | kandang, accounting, admin |
| `/fisik/[lokasi]` (+ BA) | kandang, manager, accounting, admin |
| `/approve` | manager, admin |
| `/do`, `/rencana` | marketing (+ accounting/admin) |
| `/outlook` | bod, marketing, manager, accounting, admin |
| `/flok` | manager, accounting, admin |
| `/rekon`, `/rekonstruksi` | accounting, admin (bod hanya tab koreksi) |
| `/master`, `/admin` | accounting/admin, admin |

## API internal

- `GET /api/cron/rebuild` — klaim antrean rebuild (≤ 10 lokasi), proyeksi, kontrol. Butuh
  `Authorization: Bearer $CRON_SECRET` (401 tanpa; 503 bila `SUPABASE_DB_URL` kosong di cloud).
  `?full=1&from=YYYY-MM-DD` membangun ulang semua lokasi dari tanggal itu.
- `GET /api/cron/controls` — kontrol harian K1–K7.
- `GET /api/export/bs04a?date=YYYY-MM-DD` — XLSX BS 04A.
- `GET /api/export/usulan-koreksi?target=…&t0=…` — XLSX draft Usulan Koreksi.
- `GET /api/storage/[...path]` — berkas lokal (foto BA/lampiran) saat `MOCK_AUTH=1`.

## Deploy (cloud)

- Supabase project `winata-egg-position` (`ap-southeast-1`). Migrasi: `supabase/migrations/0001…0008`
  (`npx supabase db push` atau MCP `apply_migration` berurutan). Seed production hanya `0001_master`,
  `0005_hdp`, `0006_item_map`. Admin pertama: `insert into app_user …` lalu
  `select create_login('<email>', '<sandi>')` (SQL Editor / service role).
- Vercel: root `apps/web`, install `pnpm install --frozen-lockfile`, build `pnpm --filter @winata/web build`,
  region `sin1`, cron di `apps/web/vercel.json` (Hobby: rebuild harian 00:00 WIB, kontrol 20:00 WIB; Q-32).
- Env (production + preview):

| Variabel | Isi |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | URL dan anon key project |
| `SUPABASE_DB_URL` | pooler **transaction** port 6543 untuk worker cloud (role `winata_worker`) |
| `CRON_SECRET` | acak ≥ 32 byte; Vercel Cron mengirim `Authorization: Bearer …` |
| `SUPABASE_SERVICE_ROLE_KEY` | hanya Auth admin (`/admin`) dan Storage; tanpa ini app tetap jalan |

Jangan set `MOCK_AUTH`/`MOCK_AUTH_ALLOW_PRODUCTION_BUILD`/`LOCAL_DB_DIR` di Vercel; mode mock juga
dimatikan otomatis bila `VERCEL` terisi (K15).

- Bootstrap posisi sesudah BA T0: `GET /api/cron/rebuild?full=1&from=YYYY-MM-DD` dengan bearer.
- Backup harian: `.github/workflows/backup.yml` (secret `SUPABASE_DB_URL` session pooler 5432; hanya
  berjalan bila repo privat).

## Batasan yang disadari

- Auth lokal adalah mock allow-list (cookie `mock_user`), hanya di luar Vercel. Auth cloud memakai
  Supabase Auth + RLS yang sama.
- BA dicetak lewat dialog browser (belum generator PDF).
- HPP selalu "HPP sementara" sampai costing flok ada (v1).

## Serah terima

Pekerjaan lanjutan untuk tahap cloud ada di
[docs/HANDOVER-CLAUDE.md](docs/HANDOVER-CLAUDE.md): review, Supabase staging/production,
worker cloud (Q-11), Auth/Storage, cron, impor BA T0, backup, dan checklist verifikasi.
v1.1 (hardening + worker cloud) ter-merge lewat PR #1; status cloud di `docs/log/CLOUD-RUN.md`.

## Lisensi / kepemilikan

Repo privat PT Winata Mega Agro. Jangan menyimpan kunci cloud di repo; `.env.example`
hanya berisi nama variabel.
