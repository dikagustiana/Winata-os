# PRD v1 — Winata Egg Position

PT Winata Mega Agro (Gunung Jati Group) · 26 Okt 2026 · Pemilik: Dika (Group Controller, advisory)
Repo: `winata-egg-position` (privat). Dokumen pendamping: `PLAN.md`, `DESIGN.md`, `ARCHITECTURE.md`, `PROMPT-DEEPSEEK.md`.

## 0. Cara membaca dokumen ini

- **K-n** = keputusan yang mengikat. Agen coding tidak mengubahnya; kalau bertentangan dengan kode yang sudah ada, kode yang diubah.
- **R-n** = aturan yang harus diimplementasikan. Setiap R menyebut modul yang menyentuhnya.
- **T-n** = tes dengan kriteria lolos yang terukur. Milestone selesai hanya bila semua T milestone itu hijau.
- **Q-n** = pertanyaan terbuka. Dibangun di belakang parameter dengan nilai default; jangan difinalkan di kode.
- Konvensi angka di UI: titik ribuan, koma desimal, satuan "kg", "btr", "peti", "tray", "Rp jt". Minus U+2212. Bahasa UI: Indonesia.
- Istilah: **lokasi** = tempat fisik telur disimpan (kandang atau gudang); **kandang** = unit produksi di dalam lokasi; **flok** = kelompok ayam satu chick-in di satu kandang; **grade** = kelas telur; **DO** = dokumen keluar (DO/nota/surat jalan).

## 1. Masalah dan tujuan

**Masalah.** Per 30-06-2026 buku mencatat stok telur utuh 22.021 kg (Rp 383,6 jt, HPP Rp 17.419/kg) — setara ±11–12 hari produksi, tidak masuk akal untuk telur segar tanpa cold storage. Tidak ada hitung fisik, tidak ada recording harian, satuan di Accurate masih dugaan, dan Persediaan Dalam Proses bersaldo negatif. Posisi telur sebenarnya tidak diketahui (register Pending RS-05, RS-04, RS-02).

**Tujuan v1.**
1. Posisi telur per lokasi, per grade, per hari — ditutup setiap hari, bisa dilihat live, dan bisa dipertanggungjawabkan sampai ke listing BS 04A.
2. Outlook: proyeksi produksi dari register flok, rencana jual, posisi proyeksi 4 minggu, harga dan GP, kas 13 minggu, indikasi afkir.
3. Rekonsiliasi ke Accurate bulanan dan rekonstruksi posisi 30-06-2026 untuk Usulan Koreksi.

**Ukuran sukses.**

| Ukuran | Target | Diukur dari |
|---|---|---|
| Lokasi yang menginput sebelum batas jam harian | 100 % | kontrol K1 |
| Hari yang direkonsiliasi dan dikunci | ≤ H+7 | status hari |
| Selisih fisik vs hitungan pada hitung fisik mingguan | < 1 % kg | kontrol K4 |
| Rekon bulanan ke Accurate | setiap selisih dijelaskan atau dikoreksi | kontrol K8 |
| Proyeksi produksi 7 hari vs aktual | MAPE < 5 % sesudah 4 minggu kalibrasi | modul outlook |

## 2. Lingkup

**Masuk v1 (M0–M6):** master data; register flok (populasi, deplesi mingguan); opname; produksi harian; keluar (DO); mutasi antar lokasi; pecah/afkir/konsumsi/sampel; hitung fisik mingguan; koreksi berjenjang; mesin posisi harian; aging FIFO; status hari dan kunci; kontrol K1–K9; dashboard live; outlook (produksi, rencana jual, posisi proyeksi, harga/GP, kas 13 minggu, afkir indikatif); rekon Accurate; ekspor listing BS 04A; rekonstruksi 30-06; importer dari log kertas/sheet.

**Bukan v1:** pakan per flok dan FCR; costing flok dan amortisasi aset biologis (HPP v1 = HPP sementara parameter); P&L mingguan, neraca, dan tutup buku FINAL ala KGR; integrasi tulis ke Accurate; aplikasi native (v1 adalah web yang dipakai dari browser HP).

## 3. Pengguna dan peran

| Peran (`app_role`) | Siapa | Bisa |
|---|---|---|
| `kandang` | Petugas kandang/gudang | Input produksi, pecah/afkir/konsumsi, konfirmasi serah DO, mutasi, hitung fisik, opname (sebagai penghitung) — **hanya untuk lokasi yang ditugaskan** |
| `manager` | Manager kandang (satu per lokasi; satu orang boleh memegang beberapa lokasi) | Approve/kembalikan hari per lokasi; register flok dan deplesi; tanda tangan BA opname |
| `accounting` | Accounting Winata / Group Controller | Rekonsiliasi, kunci hari, koreksi, master data, parameter, pendamping dan tanda tangan BA opname, rekon Accurate, ekspor |
| `marketing` | Marketing | Input DO/nota, pelanggan, harga jual, rencana jual, harga acuan pasar |
| `bod` | Direksi/pemilik | Baca dashboard dan outlook; approve koreksi di atas batas |
| `admin` | Dika | Pengguna, peran, penugasan lokasi; semua hak accounting |

**K1 — Pemisahan tugas ditegakkan di database (RLS), bukan hanya di layar.** Pengguna yang menginput transaksi suatu hari tidak boleh menjadi penyetuju hari yang sama di lokasi yang sama. `kandang` tidak dapat mengubah transaksi pada hari berstatus ≥ `approved`. Tidak ada peran yang dapat mengubah hari `locked` selain lewat `correction`.

**K2 — Login dengan e-mail + kata sandi, allow-list.** Pendaftaran mandiri ditolak oleh trigger. Admin membuat login di aplikasi. Google login tidak ada di v1.

## 4. Master data

| Tabel | Isi | Aturan |
|---|---|---|
| `location` | kode, nama, jenis (`kandang`/`gudang`), aktif | **K3** awal mengikuti yang ada: `SLP` Salopa (kandang), `CKL` Cikaleker (kandang), `TSK` Gudang Tasik (gudang). Bisa ditambah tanpa kode. |
| `house` | lokasi, kode, nama, kapasitas ekor | Salopa 2 kandang (`SLP-1`, `SLP-2`), Cikaleker 1 (`CKL-1`). Q-1. |
| `flock` | kandang, kode, strain, tgl chick-in, populasi awal, status (`grower`/`layer`/`afkir`), tgl mulai produksi, tgl afkir | Umur dihitung dari tgl chick-in. R-30. |
| `flock_depletion` | flok, tanggal, mati, afkir, alasan | Mingguan minimal; harian bila ada. |
| `grade` | kode, nama, urutan, `is_saleable`, aktif | **K4** default: `UB` Utuh Besar, `US` Utuh Sedang, `UK` Utuh Kecil, `RT` Retak, `PC` Pecah. Bisa ditambah/nonaktif. Q-2. |
| `unit_conversion` | grade, berlaku dari, kg/peti, kg/tray, butir/kg, sumber (`opname`/`fisik`/`manual`) | **K5** satuan dasar = kg. Butir diturunkan. Nilai awal dari timbang sampel opname T0; diperbarui tiap hitung fisik. Versi berlaku per tanggal. |
| `customer` | kode, nama, jenis (`bakul`/`agen`/`grup`/`lain`), `is_related_party`, termin | Entitas grup (RM Saung Gunung Jati, Backyard, BJJ, GJP) ditandai berelasi. |
| `parameter` | kunci, nilai, berlaku dari | Lihat §9. |
| `app_user` | e-mail, nama, peran, aktif | + `user_location` (penugasan lokasi untuk `kandang` dan `manager`). |

## 5. Transaksi

Semua transaksi punya `location_id`, `txn_date`, `created_by`, `created_at`, `source` (`app`/`import`), dan masuk `audit_log` (nilai lama/baru, siapa, kapan). Soft delete (`deleted_at`), tidak ada hard delete.

| Transaksi | Tabel | Isi | Diinput oleh |
|---|---|---|---|
| Opname | `opname` + `opname_line` | header: lokasi, tanggal, jam cut-off, DO terakhir sebelum, DO pertama sesudah, penghitung, pendamping, manager, foto; baris: grade, peti, tray, butir sisa, berat sampel (kg per n peti), butir sampel per tray → kg dan butir hasil | `kandang` + `accounting` |
| Produksi | `production` | kandang (house), grade, qty, satuan, kg hasil | `kandang` |
| Keluar | `outbound` + `outbound_line` | nomor DO (unik per lokasi), pelanggan, tanggal, status (`draft`/`dikirim`/`diterima`), harga per kg per grade; baris grade, qty, satuan, kg | `marketing` (dokumen), `kandang` (konfirmasi serah = status `dikirim`) |
| Mutasi | `transfer` | lokasi asal, lokasi tujuan, grade, kg, tgl kirim, tgl terima, status (`in_transit`/`received`) | `kandang` asal (kirim), `kandang` tujuan (terima) |
| Susut | `shrinkage` | grade, kg, jenis (`pecah`/`afkir_telur`/`konsumsi`/`sampel`/`lain`), alasan | `kandang` |
| Hitung fisik | `physical_count` + `physical_count_line` | seperti opname tanpa BA; dibandingkan dengan posisi hitungan | `kandang`, diperiksa `manager` |
| Koreksi | `correction` | lokasi, tanggal efektif, grade, kg (±), alasan, lampiran, status (`draft`/`approved`/`posted`), penyetuju | `accounting`; `bod` menyetujui bila di atas batas |
| Rencana jual | `sales_plan` | pelanggan, tanggal, grade, kg, harga, jenis (`order`/`forecast`) | `marketing` |
| Harga acuan | `market_price` | tanggal, wilayah, harga per kg | `marketing` |
| Rencana kas | `cash_plan` | minggu, kategori, masuk/keluar, Rp | `accounting` |

**R-1 (outbound)** Nomor DO unik per lokasi; nomor loncat atau ganda memicu K3. Bila Winata belum punya penomoran, app menerbitkan `LOK/YYYYMM/NNNN` (Q-3).
**R-2 (transfer)** Kg yang dikirim keluar dari posisi asal pada tgl kirim dan masuk ke tujuan pada tgl terima; selama itu tampil sebagai "di jalan". Lebih dari 1 hari di jalan memicu K5.
**R-3 (production)** Satu baris per kandang per grade per hari; input ulang menimpa dengan audit, bukan menambah.
**R-4 (semua input kuantitas)** Pengguna boleh mengisi kg, peti, tray, atau butir; app menyimpan qty asli + satuan + kg hasil konversi (versi `unit_conversion` yang berlaku pada tanggal itu). Konversi tidak dihitung ulang retroaktif bila versi berubah.
**R-5 (opname/physical_count)** kg hasil = Σ(peti × kg/peti sampel) + Σ(tray × kg/tray) + butir sisa ÷ butir/kg. Sampel ≥ 10 peti per grade bila stok ≥ 10 peti; bila kurang, semua ditimbang. Hasil timbang sampel menjadi versi `unit_conversion` baru (sumber `opname`/`fisik`).

## 6. Mesin posisi

**R-10** Untuk setiap (lokasi, grade, tanggal):

```
closing = opening + production + transfer_in − outbound − transfer_out − shrinkage ± correction
opening(d) = closing(d−1); opening hari pertama = hasil opname T0 (K6)
```

Semua dalam kg, aritmetika desimal (bukan float), dibulatkan 3 desimal saat disimpan.

**K6 — Jangkar posisi adalah opname T0.** Tidak ada posisi sebelum T0 selain lewat rekonstruksi (M6). Hitung fisik mingguan **tidak** mengganti posisi hitungan; selisihnya tampil (K4) dan hanya bisa dibukukan lewat `correction`.

**R-11 (aging FIFO)** Lapisan stok dibentuk per tanggal produksi; keluar/susut mengurangi lapisan tertua lebih dulu; mutasi membawa umur lapisannya. Bucket: 0–3, 4–7, 8–14, >14 hari (parameter). Opname/koreksi positif membentuk lapisan bertanggal hari itu dengan umur yang bisa diisi manual (default 0).
**R-12 (hari stok)** `stok_kg ÷ rata-rata produksi kg 7 hari terakhir` (lokasi `gudang` memakai rata-rata produksi semua kandang).
**R-13 (nilai)** `kg × HPP_sementara` (parameter `hpp_per_kg`, default 17.419). Selalu berlabel "HPP sementara" di UI sampai costing flok ada.
**R-14 (butir)** diturunkan: `kg × butir/kg` versi berlaku; untuk tampilan saja.
**R-15 (position_daily)** hasil R-10–R-14 disimpan di `position_daily` (lokasi, grade, tanggal, komponen, closing, umur per bucket) oleh worker; dibangun ulang dari tanggal yang berubah ke depan. Halaman membaca tabel ini, tidak menghitung sendiri.

## 7. Status hari, alur, dan kontrol

**R-20 (status per lokasi per hari)** `open` → `submitted` (kandang selesai) → `approved` (manager) → `locked` (accounting). `manager` boleh mengembalikan `submitted` → `open` dengan alasan. `accounting` boleh `approved` → `locked`; membuka kunci tidak ada; perubahan sesudah `locked` hanya lewat `correction` yang mengacu ke tanggal itu (efektif ke depan, posisi dibangun ulang dengan jejak).

**R-21 (batas jam)** `parameter.input_deadline` default 20:00 WIB. Lokasi yang belum `submitted` lewat jam itu memicu K1 untuk hari itu.

| Kode | Kontrol | Dihitung di | Akibat |
|---|---|---|---|
| K1 | Lokasi belum `submitted` sampai batas jam | worker, tiap jam | kartu merah di dashboard; daftar lokasi |
| K2 | `closing` < 0 pada (lokasi, grade) | saat submit/approve | hari tidak bisa `approved` sampai dikoreksi |
| K3 | Nomor DO ganda atau loncat (per lokasi) | saat simpan DO; harian | peringatan ke marketing dan accounting |
| K4 | \|fisik − hitungan\| > `tolerance_pct` (1 %) atau > `tolerance_kg` (50) | saat hitung fisik disimpan | hari tidak bisa `locked` tanpa penjelasan di `physical_count.note` |
| K5 | Mutasi `in_transit` > 1 hari | harian | peringatan ke kedua lokasi |
| K6 | Stok umur > 7 hari (bucket 8–14 dan >14) > 0 | harian | peringatan ke marketing |
| K7 | Hari stok > `days_of_stock_alert` (5) | harian | peringatan ke marketing dan BoD |
| K8 | Bulanan: Σ `outbound.kg` dan Rp vs penjualan Accurate; `closing` akhir bulan vs kartu stok Accurate | M5, saat upload Accurate | selisih masuk `reconciliation_item` (= Pending) dan draft Usulan Koreksi |
| K9 | `correction` dengan \|Rp\| > `bod_threshold_rp` (10 jt) atau \|kg\| > `bod_threshold_pct` (2 %) × stok lokasi tanpa `approved_by` berperan `bod` | saat posting | tidak bisa `posted` |

**R-22** Setiap kontrol menyimpan hasilnya di `control_result` (kode, tanggal, lokasi, status `ok`/`warn`/`fail`, detail JSON) agar dashboard tidak menghitung ulang.

## 8. Outlook

**R-30 (register flok dan umur)** umur minggu = ⌊(tanggal − chick_in) ÷ 7⌋. Populasi kini = awal − Σ deplesi. Status `layer` mulai `production_start_date` (default umur 18 minggu, Q-4).
**R-31 (kurva standar)** tabel `hdp_standard` (strain, umur minggu, HDP %, berat telur g). Diisi dari panduan strain (Isa Brown, Lohmann Brown, Hy-Line Brown) sebagai data seed berlabel "standar strain"; Q-5 bila strain Winata lain.
**R-32 (proyeksi produksi)** per flok per hari: `populasi × HDP_standar(umur) × berat_telur(umur) ÷ 1000` kg, dikali faktor kalibrasi flok = `Σ aktual 14 hari ÷ Σ standar 14 hari` (dibatasi 0,6–1,2). Distribusi grade memakai mix aktual 14 hari terakhir kandang itu; sebelum ada aktual, mix default parameter. Sebelum 14 hari data aktual: tampil dengan label "kalibrasi belum cukup".
**R-33 (rencana jual)** `sales_plan` jenis `order` (komitmen) dan `forecast`; forecast default = rata-rata keluar 4 minggu terakhir per hari dalam minggu, bisa ditimpa marketing.
**R-34 (posisi proyeksi)** untuk 28 hari ke depan per lokasi per grade: `closing_proj = closing_hari_ini + Σ produksi_proj − Σ rencana_jual`. Ditandai bila `closing_proj` melewati `days_of_stock_alert` atau negatif (kekurangan pasok terhadap order).
**R-35 (harga dan GP)** harga realisasi tertimbang per grade per hari dari `outbound`; dibanding `market_price`. Pendapatan proyeksi = rencana jual × harga (order: harga order; forecast: harga realisasi 7 hari). GP proyeksi = pendapatan − kg × HPP sementara; berlabel "HPP sementara".
**R-36 (kas 13 minggu)** mingguan: masuk = pendapatan proyeksi × profil penagihan (parameter termin per jenis pelanggan) + `cash_plan` masuk lain; keluar = `cash_plan` (pakan, gaji, obat, listrik, angsuran Mandiri, bunga, pihak berelasi). Saldo awal diisi accounting. Saldo terendah 13 minggu ditandai.
**R-37 (afkir indikatif)** per flok layer: margin harian = produksi_proj kg × harga realisasi − populasi × pakan g/ekor/hari × harga pakan/kg (parameter `feed_g_per_bird`, `feed_price_per_kg`); dibanding `cull_value_per_bird × populasi ÷ sisa hari rencana`. Tampil sebagai indikasi berlabel "indikatif, belum costing flok"; tidak ada aksi di v1.

## 9. Parameter (default v1)

| Kunci | Default | Dipakai |
|---|---|---|
| `input_deadline` | 20:00 | K1 |
| `tolerance_pct` / `tolerance_kg` | 1 % / 50 kg | K4 |
| `transit_days_alert` | 1 | K5 |
| `age_buckets_days` | 3, 7, 14 | R-11, K6 |
| `days_of_stock_alert` | 5 | K7, R-34 |
| `bod_threshold_rp` / `bod_threshold_pct` | 10.000.000 / 2 % | K9 |
| `hpp_per_kg` | 17.419 | R-13, R-35 |
| `production_start_age_weeks` | 18 | R-30 |
| `calibration_window_days` | 14 | R-32 |
| `default_grade_mix` | UB 55 / US 30 / UK 10 / RT 3 / PC 2 (%) | R-32 |
| `feed_g_per_bird`, `feed_price_per_kg`, `cull_value_per_bird` | 115 g, 7.100, 35.000 | R-37 |
| `collection_profile` | bakul 100 % minggu ke-0; agen 50/50 minggu 0/1; grup 0/100 minggu 0/2 | R-36 |

## 10. Rekonsiliasi ke Accurate dan rekonstruksi (M5–M6)

**R-40 (upload Accurate)** accounting mengunggah ekspor Accurate: *Sales by Item Detail* (penjualan per item per tanggal) dan *Inventory Valuation / Kartu Stok* item telur per akhir bulan. Parser memetakan item Accurate → grade lewat `item_map` (kode item, grade, satuan Accurate, faktor ke kg). Item tanpa map → gagal upload dengan daftar item (bukan diam-diam dilewati).
**R-41 (K8)** per bulan: Σ `outbound.kg` per grade vs Σ penjualan Accurate kg; Σ Rp; `closing` 31/30 vs kartu stok. Selisih per grade masuk `reconciliation_item` dengan status `open`/`explained`/`corrected`, penjelasan, dan tautan ke `correction`.
**R-42 (ekspor BS 04A)** CSV/XLSX: per grade kg, HPP sementara, nilai, aging bucket, hari stok — kolom mengikuti sheet "BS 04A Persediaan" bagian B dan C workbook LK Bulanan.
**R-43 (rekonstruksi 30-06-2026)** `closing(30-06) = closing(T0) − Σ produksi(1-Jul..T0) + Σ keluar(1-Jul..T0) + Σ susut(1-Jul..T0)`; produksi dan keluar Juli–T0 dimasukkan lewat importer (R-50) dari recording/DO yang ada. Hasil, selisih terhadap TB 791.313.199 (telur 383.582.877 + 6.209.446), dan batas atas/bawah bila data bolong, disajikan di layar "Rekonstruksi" dan diekspor sebagai draft Usulan Koreksi. Bila recording Juli–T0 tidak ada, layar menampilkan batas atas = produksi 5 hari terakhir Juni × rata-rata produksi, berlabel estimasi.

**R-50 (importer)** CSV dengan kolom tetap (`tanggal, lokasi, kandang, grade, jenis, qty, satuan, nomor_do, pelanggan, catatan`) untuk memuat log kertas/sheet sebelum go-live dan Juli–T0. Validasi per baris; satu baris gagal = seluruh file ditolak dengan daftar galat; `source = import`.

## 11. Layar (ringkas; detail di DESIGN.md)

| Rute | Peran | Isi |
|---|---|---|
| `/hari/[lokasi]/[tanggal]` | kandang | satu layar per hari: produksi per kandang × grade, susut, DO yang perlu konfirmasi serah, mutasi, tombol "Selesai hari ini" |
| `/fisik/[lokasi]` | kandang, manager | hitung fisik dan opname (mode BA) |
| `/approve` | manager | daftar hari `submitted` per lokasi, ringkasan, setujui/kembalikan |
| `/do` | marketing | DO baru, daftar per hari, status serah |
| `/rencana` | marketing | rencana jual, harga acuan |
| `/` (dashboard) | semua; bod baca saja | posisi hari ini per lokasi × grade (kg, btr, Rp), hari stok, aging, produksi vs keluar 30 hari, kartu K1–K7, lokasi belum submit |
| `/outlook` | bod, marketing, manager, accounting | produksi proyeksi 28 hari per flok/kandang, posisi proyeksi per grade, harga dan GP, kas 13 minggu, afkir indikatif |
| `/flok` | manager, accounting | register flok, deplesi, umur, populasi, kurva aktual vs standar |
| `/rekon` | accounting | kunci hari, koreksi, upload Accurate, K8, `reconciliation_item`, ekspor BS 04A |
| `/rekonstruksi` | accounting | R-43 |
| `/master`, `/admin` | accounting, admin | master, parameter, pengguna, penugasan, audit |

**K7 — Mobile-first untuk `kandang` dan `marketing`.** Semua input selesai di layar 390 px tanpa scroll samping; target sentuh ≥ 44 px; angka pakai `inputMode="decimal"`. Dashboard dan outlook harus terbaca di 390 px (kartu bertumpuk) dan 1366 px.
**K8 — Offline-tolerant untuk input harian.** Form `/hari` menyimpan draft di IndexedDB saat sinyal putus dan mengirim saat tersambung; konflik (hari sudah `approved`) ditolak dengan pesan, bukan ditimpa. Tidak ada mode offline untuk layar lain.

## 12. Milestone dan gerbang

| M | Isi | Gerbang (semua T hijau di PGlite + vitest + Playwright lokal) |
|---|---|---|
| M0 | Repo, skema, RLS, login allow-list, master, register flok, parameter, audit | T-01…T-06 |
| M1 | Opname, produksi, DO, mutasi, susut, hitung fisik, mesin posisi, aging, importer | T-10…T-19 |
| M2 | Status hari, approve, kunci, koreksi + K9, K1–K7, dashboard live, offline draft | T-20…T-29 |
| M3 | Outlook: kurva standar, proyeksi produksi, rencana jual, posisi proyeksi, harga/GP | T-30…T-36 |
| M4 | Kas 13 minggu, afkir indikatif | T-40…T-43 |
| M5 | Parser Accurate, K8, `reconciliation_item`, ekspor BS 04A | T-50…T-54 |
| M6 | Rekonstruksi 30-06, draft Usulan Koreksi | T-60…T-62 |

Rincian T di `PLAN.md`. Serah terima ke Claude Code sesudah M6: terapkan ke Supabase **staging**, uji Auth/PostgREST/Storage/RLS lewat API, lalu production + Vercel (checklist di `PLAN.md` §Serah terima).

## 13. Pertanyaan terbuka

| Q | Pertanyaan | Default sampai dijawab |
|---|---|---|
| Q-1 | Jumlah kandang per lokasi dan kapasitas | SLP 2, CKL 1; kapasitas kosong |
| Q-2 | Grade jual yang benar-benar dipakai bakul; satuan transaksi (kg/peti/butir) | K4; input bebas satuan (R-4) |
| Q-3 | DO sudah bernomor urut? Dibuat di Accurate atau manual? | app menerbitkan nomor bila kosong |
| Q-4 | Umur mulai produksi dan strain tiap flok | 18 minggu; strain diisi manager |
| Q-5 | Kurva HDP standar strain Winata | seed Isa Brown/Lohmann/Hy-Line |
| Q-6 | Alur telur: jual langsung dari kandang atau lewat Gudang Tasik | keduanya didukung (R-2) |
| Q-7 | Tanggal opname T0 | — (menentukan hari pertama posisi) |
| Q-8 | Kebijakan SAK EP vs SAK untuk aset biologis | di luar v1; HPP sementara |
| Q-9 | Region Supabase/Vercel | Singapura (`ap-southeast-1` / `sin1`) |
