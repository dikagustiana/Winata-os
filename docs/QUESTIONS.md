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
| Q-10 | E-mail admin pemilik (Dika) | Seed `dika@winata.co.id` diganti saat serah terima | | terbuka |
| Q-11 | Adapter worker cloud (rebuild/kontrol/proyeksi) | Worker dibangun untuk PGlite (lokal/e2e). Di cloud route cron mengembalikan 501 sampai adapter PostgREST/service-role dibuat pada tahap staging (PLAN §Serah terima) | | **terbuka — wajib sebelum production** |
| Q-12 | Rencana jual tidak punya `location_id`; bagaimana alokasi per lokasi? | Proporsional terhadap stok awal grade di tiap lokasi | | terbuka |
| Q-13 | Semantik importer untuk mutasi | `mutasi_keluar`: kolom pelanggan = kode lokasi tujuan, status `in_transit`. `mutasi_masuk`: kolom pelanggan = kode lokasi asal, diterima pada tanggal yang sama | | terbuka |
| Q-14 | PDF BA opname | Belum ada generator PDF; BA dicetak dari halaman `/fisik/[lokasi]/ba/[id]` lewat dialog cetak browser (simpan sebagai PDF) | | terbuka |
| Q-15 | Nilai kg/peti, kg/tray, butir/kg awal | Diisi dari asumsi sampel T0 (15,0 kg/peti UB; lihat seed). Wajib diganti hasil timbang nyata | | terbuka |
| Q-16 | Harga pada baris DO hasil impor | `price_per_kg` null; K8 hanya memakai Rp dari DO yang punya harga | | terbuka |
| Q-17 | Deteksi nomor DO loncat lintas bulan | Diperiksa per lokasi memakai urutan angka di belakang nomor, tanpa memisahkan bulan | | terbuka |
| Q-18 | Batas BoD dihitung terhadap stok tanggal berapa? | Stok lokasi terakhir pada/sesudah tanggal efektif (`location_stock_kg`) | | terbuka |
| Q-19 | Batas K4 (selisih fisik) memakai stok hari hitung fisik | Ya: `|diff| > tolerance_kg` ATAU `|diff|/stok > tolerance_pct` | | terbuka |
| Q-20 | Apakah karyawan boleh memegang beberapa lokasi? | Ya; `user_location` many-to-many, manager boleh beberapa lokasi | | terjawab oleh PRD §3 |

## Catatan konflik dokumen

- **T-27** meminta uji dashboard dengan spy klien. Halaman dashboard adalah React Server
  Component, sehingga uji yang dijalankan adalah pemeriksaan sumber halaman
  (`supabase/tests/dashboard.test.ts`) yang memastikan tidak ada query ke tabel transaksi.
  Uji runtime dengan spy dicatat sebagai pekerjaan staging. Lihat `docs/log/M2.md`.
- **Kontras token:** `--warn #b5721a` pada latar `--warn-weak` hanya 3,48:1. Token tetap
  dipakai untuk garis/latar, sedangkan teks memakai token baru `--warn-ink #7a4a0e`
  (≥ 4,5:1). Ini memenuhi aksesibilitas AA DESIGN §1 tanpa mengubah arti warna.
