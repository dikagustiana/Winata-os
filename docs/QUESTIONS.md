# Pertanyaan terbuka — Winata Egg Position v1

Kolom **Jawaban** diisi pemilik. Selama kosong, kode memakai default di kolom ketiga
(PRD §13 dan keputusan kecil yang dicatat agen).

| Q | Pertanyaan | Default sampai dijawab | Jawaban | Status |
|---|---|---|---|---|
| Q-1 | Jumlah kandang per lokasi dan kapasitas | SLP 2 kandang, CKL 1, kapasitas kosong | | terbuka |
| Q-2 | Grade jual yang dipakai bakul; satuan transaksi | UB, US, UK, RT, PC; input bebas satuan (kg/peti/tray/btr) | | terbuka |
| Q-3 | DO sudah bernomor urut? Dibuat di Accurate atau manual? | App menerbitkan `LOK/YYYYMM/NNNN` bila nomor kosong | | terbuka |
| Q-4 | Umur mulai produksi dan strain tiap flok | 18 minggu; strain diisi manager | | terbuka |
| Q-5 | Kurva HDP standar strain Winata | Seed Isa Brown/Lohmann/Hy-Line, label "standar strain, seed" (lihat `docs/reference/hdp-sources.md`) | | terbuka |
| Q-6 | Alur telur: jual langsung dari kandang atau lewat Gudang Tasik | Keduanya didukung; rencana jual tanpa lokasi dialokasikan proporsional terhadap stok grade (Q-12) | | terbuka |
| Q-7 | Tanggal opname T0 | Seed 2026-07-01 untuk contoh; tanggal sebenarnya menentukan hari pertama posisi | | terbuka |
| Q-8 | Kebijakan SAK EP vs SAK untuk aset biologis | Di luar v1; HPP sementara Rp 17.419/kg | | terbuka |
| Q-9 | Region Supabase/Vercel | Singapura (`ap-southeast-1` / `sin1`) | | terbuka |
| Q-10 | E-mail admin pemilik (Dika) | v1.1: diganti Q-23 (`dika.g.irawan@gmail.com`) | | ditutup oleh Q-23 |
| Q-11 | Adapter worker cloud (rebuild/kontrol/proyeksi) | v1.1 (K17/M8): kode worker yang sama lewat `Queryable`; cloud = `pg.Pool` ke pooler Supabase (`SUPABASE_DB_URL`). Cron 200 dengan bearer, rebuild inline ≤ 7 tanggal di aksi | | **ditutup di M8** (bukti `docs/log/M8.md`, `docs/log/M9.md`) |
| Q-12 | Rencana jual tidak punya `location_id`; bagaimana alokasi per lokasi? | Proporsional terhadap stok awal grade di tiap lokasi | | terbuka |
| Q-13 | Semantik importer untuk mutasi | `mutasi_keluar`: kolom pelanggan = kode lokasi tujuan, status `in_transit`. `mutasi_masuk`: kolom pelanggan = kode lokasi asal, diterima pada tanggal yang sama | | terbuka |
| Q-14 | PDF BA opname | Belum ada generator PDF; BA dicetak dari halaman `/fisik/[lokasi]/ba/[id]` lewat dialog cetak browser (simpan sebagai PDF) | | terbuka |
| Q-15 | Nilai kg/peti, kg/tray, butir/kg awal | Diisi dari asumsi sampel T0 (15,0 kg/peti UB; lihat seed). Wajib diganti hasil timbang nyata | | terbuka |
| Q-16 | Harga pada baris DO hasil impor | `price_per_kg` null; K8 hanya memakai Rp dari DO yang punya harga | | terbuka |
| Q-17 | Deteksi nomor DO loncat lintas bulan | Diperiksa per lokasi memakai urutan angka di belakang nomor, tanpa memisahkan bulan | | terbuka |
| Q-18 | Batas BoD dihitung terhadap stok tanggal berapa? | Stok lokasi terakhir pada/sebelum tanggal efektif (`location_stock_kg`), dihitung ulang dari nilai koreksi **saat posting** (R-61); persetujuan BoD gugur bila isi berubah (R-60) | | terbuka |
| Q-19 | Batas K4 (selisih fisik) memakai stok hari hitung fisik | v1.1 (R-67): **OR per grade** — `|diff| > tolerance_kg` ATAU `|diff| > tolerance_pct × computed_kg` grade itu (bila computed 0/null hanya batas kg); catatan wajib ≥ 10 karakter; sama di `lock_day` dan kontrol K4 | | terbuka |
| Q-20 | Apakah karyawan boleh memegang beberapa lokasi? | Ya; `user_location` many-to-many, manager boleh beberapa lokasi | | terjawab oleh PRD §3 |
| Q-21 | Nilai buku pembanding rekonstruksi: 389.792.323 (jumlah dua akun) atau 791.313.199 (angka PRD)? | `tb_total_rp = 389792323`; layar menampilkan chip "Nilai buku belum dikonfirmasi" selama default | | terbuka |
| Q-22 | Kode akun CoA Winata untuk Persediaan Telur dan Selisih Persediaan | Parameter `coa_inventory_egg` / `coa_inventory_variance` berisi placeholder `<isi dari CoA Winata> …`; chip "Akun belum dikonfirmasi" | | terbuka |
| Q-23 | E-mail admin pemilik untuk production | `dika.g.irawan@gmail.com`; `dika@winata.co.id` tidak dibuat (seed lokal juga diganti) | | terbuka |
| Q-24 | Nama project Supabase dan Vercel | `winata-egg-position` keduanya | | terbuka |
| Q-25 | Akun uji `@winata.test` boleh tetap ada di production? | Tidak; dibuat untuk T-85 lalu dihapus, bukti di `docs/log/M9.md` | | terbuka |
| Q-26 | Nama branch v1.1 | Prompt meminta `fix/v1.1-hardening-cloud`; sesi cloud ini dikunci ke branch `claude/eloquent-goodall-w5a16l`, jadi PR dibuka dari branch itu (isi sama) | | keputusan agen |
| Q-27 | Baris antrean `running` yang macet (worker mati di tengah) | `claim_rebuild` boleh mengklaim ulang baris `running` yang `claimed_at` > 15 menit | | keputusan agen |
| Q-28 | Hak `anon` dan EXECUTE fungsi di Supabase | `anon` tidak punya hak tabel; EXECUTE dicabut dari semua fungsi `public` lalu diberikan hanya ke helper RLS + RPC alur hari/koreksi (default privileges Supabase memberi EXECUTE ke anon) | | keputusan agen |
| Q-29 | BA opname bertanda tangan: lampiran foto sesudah tanda tangan | Diizinkan (hanya `photo_note`); angka/kolom lain immutable | | keputusan agen |
| Q-30 | App cloud sebelum `SUPABASE_SERVICE_ROLE_KEY` diisi | Login, sesi, aksi, dan worker tidak memakai kunci layanan (RLS + `SUPABASE_DB_URL`); hanya buat akun/ganti kata sandi di `/admin` dan unggah foto/berkas yang menunggu kunci (chip kuning) | | keputusan agen |
| Q-31 | `user_location` dengan soft delete | Kunci utama diganti `id`; unik aktif `(user_id, location_id) where deleted_at is null` agar penugasan bisa dilepas lalu diberikan lagi | | keputusan agen |
| Q-32 | Vercel Hobby hanya mengizinkan cron 1x/hari | Diputuskan pemilik 27-10-2026: `/api/cron/rebuild` harian 17:00 UTC (00:00 WIB), `/api/cron/controls` 13:00 UTC (20:00 WIB). Posisi tetap diperbarui inline saat input (≤ 7 tanggal); cron menyapu antrean sisanya. Kembali ke tiap jam bila upgrade Pro | | terjawab pemilik |

## Catatan konflik dokumen

- **T-27** meminta uji dashboard dengan spy klien. Halaman dashboard adalah React Server
  Component, sehingga uji yang dijalankan adalah pemeriksaan sumber halaman
  (`supabase/tests/dashboard.test.ts`) yang memastikan tidak ada query ke tabel transaksi.
  Uji runtime dengan spy dicatat sebagai pekerjaan staging. Lihat `docs/log/M2.md`.
- **Kontras token:** `--warn #b5721a` pada latar `--warn-weak` hanya 3,48:1. Token tetap
  dipakai untuk garis/latar, sedangkan teks memakai token baru `--warn-ink #7a4a0e`
  (≥ 4,5:1). Ini memenuhi aksesibilitas AA DESIGN §1 tanpa mengubah arti warna.
