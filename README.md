# Winata Egg Position v1

Aplikasi posisi telur harian PT Winata Mega Agro (Gunung Jati Group): master,
transaksi kandang, hitung fisik/opname, posisi FIFO, status hari, dashboard,
outlook, kas 13 minggu, rekonsiliasi Accurate, dan rekonstruksi 30-06-2026.

Sumber kebenaran ada di `docs/PRD-v1.md`, `docs/PLAN.md`, `docs/DESIGN.md`,
`docs/ARCHITECTURE.md`. Keputusan kecil dan pertanyaan terbuka di
`docs/QUESTIONS.md`. Laporan per milestone di `docs/log/`.

## Struktur

```
apps/web            Next.js 15 App Router (UI Bahasa Indonesia, server actions)
packages/engine     mesin murni: posisi, aging, konversi, HDP, proyeksi, kas, rekonstruksi
packages/db         PGlite (lokal/e2e), klien data, worker rebuild/kontrol/proyeksi
packages/parsers    CSV importer R-50, parser ekspor Accurate
supabase/migrations 0001_schema … 0007_recon
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
| Admin (pemilik) | dika@winata.co.id |
| Kandang SLP | kandang.slp@winata.test |
| Kandang CKL | kandang.ckl@winata.test |
| Gudang TSK | gudang.tsk@winata.test |
| Manager | manager@winata.test |
| Accounting | accounting@winata.test |
| Marketing | marketing@winata.test |
| Direksi | bod@winata.test |

Pendaftaran mandiri ditolak trigger; admin membuat akun di `/admin`.

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

- `GET /api/cron/rebuild` — klaim antrean rebuild, proyeksi, kontrol. Butuh
  `Authorization: Bearer $CRON_SECRET`.
- `GET /api/cron/controls` — kontrol harian K1–K7.
- `GET /api/export/bs04a?date=YYYY-MM-DD` — XLSX BS 04A.
- `GET /api/export/usulan-koreksi?target=…&t0=…` — XLSX draft Usulan Koreksi.
- `GET /api/storage/[...path]` — berkas lokal (foto BA/lampiran) saat `MOCK_AUTH=1`.

## Batasan yang disadari

- Worker rebuild/kontrol/proyeksi di jalur cloud (Supabase/Vercel) belum dibuat;
  route cron mengembalikan 501 di cloud. Jadwal adaptasi ada di `docs/QUESTIONS.md`
  Q-11 dan PLAN §Serah terima. Semua gerbang lokal (M0–M6) hijau.
- Auth lokal adalah mock allow-list (cookie `mock_user`). Auth cloud memakai
  Supabase Auth + RLS yang sama.
- BA dicetak lewat dialog browser (belum generator PDF).
- HPP selalu "HPP sementara" sampai costing flok ada (v1).

## Serah terima

Pekerjaan lanjutan untuk tahap cloud ada di
[docs/HANDOVER-CLAUDE.md](docs/HANDOVER-CLAUDE.md): review, Supabase staging/production,
worker cloud (Q-11), Auth/Storage, cron, impor BA T0, backup, dan checklist verifikasi.
Branch pengiriman: `m0-m6-full`.

## Lisensi / kepemilikan

Repo privat PT Winata Mega Agro. Jangan menyimpan kunci cloud di repo; `.env.example`
hanya berisi nama variabel.
