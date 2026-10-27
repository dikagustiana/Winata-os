# CLOUD-RUN — Winata Egg Position v1.1

Ringkasan untuk pemilik. Tidak ada rahasia di berkas ini (password admin, `CRON_SECRET`, password role
worker hanya ada di pesan agen).

## Hasil

- **Production live: https://web-z3yx.vercel.app** (Vercel `web-z3yx`, deploy dari `main`).
- **Supabase** `winata-egg-position` (ref `sbldeewipmxhutbssspe`, `ap-southeast-1`, Postgres 17):
  skema 1.1.0, seed master/HDP/item_map, admin `dika.g.irawan@gmail.com`, 3 bucket privat.
- **Worker cloud** jalan: cron dengan bearer → 200, kontrol tertulis ke database production.
- Kode v1.1 di `main` lewat PR [#1](https://github.com/dikagustiana/Winata-os/pull/1),
  [#2](https://github.com/dikagustiana/Winata-os/pull/2), [#3](https://github.com/dikagustiana/Winata-os/pull/3),
  [#4](https://github.com/dikagustiana/Winata-os/pull/4); CI hijau termasuk e2e.

## Status tes v1.1

| T | Status | Bukti |
|---|---|---|
| T-70…T-79 | hijau | `supabase/tests/hardening.test.ts` 22 tes; merah sebelum 0008 (`docs/log/M7.md`) |
| T-80, T-81 | hijau | `packages/engine/test/reconstruct.test.ts` 5 tes |
| T-82 | hijau | `apps/web/test/mock-auth.test.ts` 4 tes; di production cookie `mock_user` → 307 `/login` |
| T-83 | hijau | typecheck 0 · test 245/245 · lint bersih · build sukses |
| T-84 | hijau (catatan) | `schema_version() = 1.1.0`; migrasi lewat bundel SQL Editor sehingga riwayat migrasi kosong (`docs/log/M9.md`) |
| T-85 | hijau | 18/18 sel matriks PostgREST; akun uji dihapus, 0 tersisa (`docs/log/M9.md`) |
| T-86 | hijau | cron 401 tanpa bearer, 200 dengan bearer; `control_result` 21 baris |
| T-87 | hijau | Auth API 200; login browser ke production → dashboard + `/admin` |
| T-88 | hijau | CI run [40367877099](https://github.com/dikagustiana/Winata-os/actions/runs/40367877099) e2e `28 passed, 8 skipped` |

## Identitas cloud

| Item | Nilai |
|---|---|
| Supabase ref / URL | `sbldeewipmxhutbssspe` / `https://sbldeewipmxhutbssspe.supabase.co` |
| Dashboard | https://supabase.com/dashboard/project/sbldeewipmxhutbssspe |
| Pooler worker | `aws-0-ap-southeast-1.pooler.supabase.com:6543`, user `winata_worker.sbldeewipmxhutbssspe` |
| Vercel | tim `dikagirawan-4804's projects`, project `web-z3yx` |
| Env Vercel terpasang | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `CRON_SECRET`, `SUPABASE_DB_URL` (production + preview) |
| Cron | rebuild 00:00 WIB, kontrol 20:00 WIB (Hobby: maks. harian, Q-32) |

## Tindakan pemilik yang tersisa (urut)

1. **Jadikan repo privat** (K10): GitHub → Settings → General → Danger Zone → Change visibility → Private.
2. **`SUPABASE_SERVICE_ROLE_KEY`**: Supabase → Project Settings → API Keys → `service_role` → salin ke
   Vercel → `web-z3yx` → Settings → Environment Variables (Production + Preview) → Redeploy. Tanpa ini
   aplikasi jalan; yang menunggu hanya buat akun / atur sandi di `/admin` dan unggah foto/berkas.
3. **Ganti kata sandi admin** sesudah langkah 2 (`/admin` → Pengguna), atau sekarang lewat Supabase →
   Authentication → Users → *Send password recovery*.
4. **Hapus project Vercel cadangan `winata-egg-position`** (Settings → General → Delete Project): duplikat
   dari import yang sama, berisi env yang sama, ikut membangun tiap push. Opsional: ganti nama `web-z3yx`
   dan domainnya di Settings → General / Domains.
5. **Aktifkan Vercel Authentication untuk preview** (Settings → Deployment Protection): preview memakai DB production (K16).
6. **Jawab Q-21, Q-22, Q-23** di `docs/QUESTIONS.md`; isi `tb_total_rp`, `coa_inventory_egg`,
   `coa_inventory_variance` di `/admin` → Parameter.
7. **Buat akun tim** (sesudah langkah 2) di `/admin`; lalu penugasan lokasi.
8. **BA T0**: opname di `/fisik/<lokasi>?mode=opname` (tiga tanda tangan) → impor log `/rekon?tab=import` →
   `curl -H "Authorization: Bearer <CRON_SECRET>" "https://web-z3yx.vercel.app/api/cron/rebuild?full=1&from=<T0>"`.
9. **Backup** (sesudah repo privat): secret repo `SUPABASE_DB_URL` = Supabase → Connect → *Session pooler*
   (port 5432, user `postgres.sbldeewipmxhutbssspe`, password `postgres` diatur ulang di Project Settings →
   Database) → jalankan workflow **backup** sekali → uji restore.

## Penyimpangan dan alasannya

| Butir | Alasan |
|---|---|
| Branch `claude/eloquent-goodall-w5a16l` | sesi dikunci ke branch ini (Q-26) |
| Migrasi via SQL Editor, bukan `apply_migration` | MCP meminta konfirmasi manusia yang tidak sempat terjawab; pemilik menjalankan bundel |
| 0001 diubah (PR #3) | Supabase menolak `create table if not exists auth.users` (42501); belum pernah diterapkan ke cloud |
| Role `winata_worker`, bukan `postgres` | password `postgres` tidak tersedia lewat MCP |
| Cron harian | paket Vercel Hobby (Q-32, keputusan pemilik) |
| Project Vercel `web-z3yx` | pilihan pemilik; konektor Vercel 403, dikerjakan lewat Vercel CLI |

## Catatan keamanan (sudah ditutup di 0008)

Default privileges Supabase memberi EXECUTE ke `anon`/`authenticated` untuk setiap fungsi baru; tanpa 0008,
`set_login_password` bisa dipanggil lewat `/rest/v1/rpc` dengan anon key. Di production diverifikasi:
anon → 401 (T-85).
