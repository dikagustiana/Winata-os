# DESIGN — Winata Egg Position v1

Desain layar, alur, dan grammar UI. Mengikat untuk agen coding bersama `PRD-v1.md`. Satu grammar untuk semua layar sejak hari pertama (pelajaran KGR: dua generasi stylesheet hidup bersamaan membuat app terlihat tidak profesional).

## 1. Prinsip

1. **Mobile-first untuk yang bekerja di kandang.** `kandang` dan `marketing` memakai HP di tempat yang sinyalnya tidak stabil. Setiap form harian selesai dalam ≤ 2 menit dengan satu tangan: angka besar, satuan jelas, satu layar per hari, tombol utama di bawah dalam jangkauan ibu jari.
2. **Satu layar, satu keputusan.** Dashboard menjawab "berapa telur sekarang dan ada masalah apa"; outlook menjawab "cukup tidak untuk minggu depan dan kas aman tidak". Tidak ada layar yang mencampur input dan laporan.
3. **Angka yang dipertanggungjawabkan kelihatan bedanya.** Setiap angka punya status: *draft* (abu), *disetujui* (biru), *dikunci* (hijau), *estimasi/HPP sementara* (label kuning). Tidak ada angka tanpa status di dashboard.
4. **Kosong ≠ gagal.** "Belum ada data" untuk kosong; "Gagal dimuat (alasan)" untuk galat. Jangan menampilkan 0 untuk data yang belum diisi.
5. **Tanpa kode spesifikasi di UI.** Pengguna tidak melihat "K4" atau "R-11"; mereka melihat "Selisih hitung fisik melebihi 1 %". Kode hanya di `title`/tooltip untuk pemilik.
6. **Aksesibilitas AA.** Kontras ≥ 4,5:1; semua input berlabel (bukan placeholder); hasil simpan diumumkan (`role="status"`); fokus terlihat; dialog menahan fokus.

## 2. Token dan komponen

Token di `apps/web/app/tokens.css` (satu file, dipakai semua halaman):

| Token | Nilai | Pakai |
|---|---|---|
| `--bg` / `--surface` | `#f5f6f4` / `#ffffff` | latar halaman / kartu |
| `--ink` / `--ink-2` / `--ink-3` | `#1b1f1a` / `#3f463d` / `#5f675c` (≥ 4,6:1 di surface) | teks utama / sekunder / muted |
| `--line` | `#d9ddd6` | garis |
| `--accent` | `#2f6b3a` | aksi utama, tautan |
| `--ok` / `--warn` / `--fail` | `#2f6b3a` / `#b5721a` / `#a83232` | status |
| `--draft` / `--approved` / `--locked` | `#8a908a` / `#2b5c8a` / `#2f6b3a` | status hari |
| `--estimate` | `#e9d59a` (latar) + `--ink` | label estimasi / HPP sementara |
| `--radius` | 10 px | kartu, input |
| `--fs-1…5` | 13 / 14 / 16 / 20 / 28 px | teks kecil / tubuh / label input / judul kartu / angka utama |
| `--tap` | 44 px | tinggi minimum tombol dan input di HP |

Komponen (`apps/web/components/ui/`), semuanya server-safe kecuali yang ditandai klien:

- `Shell`: header 1 baris (nama lokasi/peran, tanggal, menu), konten, bottom nav di HP (≤ 760 px) untuk `kandang`/`marketing`: Hari ini · Fisik · DO · Posisi.
- `Card`: judul, angka utama, sub-angka, status chip, tautan "cara hitung" (drawer dengan rumus dan sumber baris).
- `StatusChip`: draft/disetujui/dikunci/estimasi/ok/perhatian/gagal.
- `NumberInput` (klien): `inputMode="decimal"`, pemisah lokal id-ID, satuan di kanan, tombol ± untuk butir/peti, menolak nilai ambigu ("1.500" dibaca 1500; "1,5" dibaca 1,5; tanpa tebakan).
- `UnitPicker`: kg / peti / tray / btr; menampilkan kg hasil konversi secara langsung di bawah input.
- `Table`: kolom pertama sticky, scroll dalam kartu, total di bawah; di HP boleh berubah menjadi daftar kartu.
- `ActionForm` (klien): server action + `role="status"`; konfirmasi dalam form (bukan `window.confirm`).
- `Drawer` (klien): focus trap, `inert` di belakang, tutup dengan Esc.
- `ControlCard`: kode internal di tooltip, teks manusia di depan, daftar lokasi/baris terkait.
- `Sparkline` dan `Bars`: SVG inline, warna dari token, `role="img"` + `aria-label` angka.

## 3. Layar

### 3.1 `/hari/[lokasi]/[tanggal]` — Hari kandang (`kandang`)

Urutan vertikal, satu layar:

1. **Header**: "Salopa · Sel 28 Okt" + chip status hari. Panah ke hari sebelumnya (hanya baca bila sudah `approved`).
2. **Produksi** — satu blok per kandang (`SLP-1`, `SLP-2`). Baris per grade: `UnitPicker` + `NumberInput`; kg hasil tampil kecil di bawah. Default satuan = satuan terakhir yang dipakai user.
3. **Susut** — tombol "+ Susut": jenis (pecah/afkir telur/konsumsi/sampel/lain), grade, qty, alasan.
4. **DO menunggu serah** — daftar DO lokasi ini berstatus `draft` dari marketing: nomor, pelanggan, kg per grade; tombol "Sudah diserahkan" → `dikirim`. Bila kg yang diserahkan berbeda, kandang mengisi kg aktual; DO tercatat dua angka (dokumen vs serah) dan K3 memberi tanda.
5. **Mutasi** — "+ Kirim ke lokasi lain" (tujuan, grade, kg) dan daftar "Menunggu diterima" bila lokasi ini tujuan.
6. **Ringkasan hari** — stok awal → +produksi −keluar −susut ±mutasi → stok akhir per grade (kg, btr). Angka negatif ditandai merah (K2 akan memblokir approve).
7. **Tombol utama** (sticky bawah): "Simpan draft" (selalu) dan "Selesai hari ini" (→ `submitted`; konfirmasi dalam form).

Offline: ikon awan di header (tersambung / tersimpan di HP / mengirim). Draft tersimpan otomatis tiap perubahan.

### 3.2 `/fisik/[lokasi]` — Hitung fisik dan opname (`kandang`, `manager`, `accounting`)

- **Mode hitung fisik** (mingguan): per grade: peti, tray, butir sisa; sampel timbang (n peti, total kg) dan butir per tray sampel. Hasil kg otomatis. Perbandingan dengan posisi hitungan hari ini: selisih kg dan %, warna sesuai toleransi; kolom "Penjelasan" wajib bila melewati.
- **Mode opname (BA)**: sama + header cut-off (jam, DO terakhir sebelum, DO pertama sesudah), foto (kamera HP, ≥ 1 per grade), tiga tanda tangan berurutan: penghitung (`kandang`), pendamping (`accounting`), manager (`manager`) — masing-masing login sendiri atau tanda tangan di layar dengan nama dan waktu tercatat. BA terkunci sesudah tanda tangan ketiga; PDF BA dapat diunduh.

### 3.3 `/do` dan `/rencana` — Marketing

- **DO baru**: lokasi asal, pelanggan (cari), tanggal, nomor (otomatis bila parameter), baris grade × qty × satuan × harga/kg. Simpan → `draft` → tampil di layar kandang untuk serah.
- **Daftar DO** per hari: status (draft/dikirim/diterima), kg dokumen vs kg serah, peringatan nomor loncat.
- **Rencana jual**: grid pelanggan × 14 hari ke depan, isi kg dan harga; baris `forecast` (abu, bisa ditimpa) vs `order` (hitam).
- **Harga acuan**: input harian per wilayah; grafik 30 hari harga realisasi vs acuan.

### 3.4 `/approve` — Manager

Daftar lokasi yang dipegang × hari `submitted`: ringkasan per hari (produksi, keluar, susut, stok akhir, kontrol K2/K3 hari itu), tombol "Setujui" / "Kembalikan" (alasan wajib). Juga tab **Flok**: register dan deplesi mingguan.

### 3.5 `/` — Dashboard live (semua; `bod` baca saja)

Tata letak 1366 px: 3 kolom; 390 px: satu kolom bertumpuk dengan urutan yang sama.

1. **Baris status** (atas): tanggal/jam pembaruan; chip per lokasi: *belum isi* (merah, K1) / *draft* / *disetujui* / *dikunci*.
2. **Kartu posisi** (angka utama): total kg telur utuh jual (UB+US+UK), btr, nilai Rp jt (label "HPP sementara"); Δ vs kemarin. Di bawahnya tabel lokasi × grade (kg), total baris/kolom, "di jalan" sebagai baris sendiri.
3. **Kartu hari stok**: angka utama hari stok total; per lokasi; ambang 5 hari (K7) sebagai garis.
4. **Kartu umur stok**: batang 4 bucket (0–3, 4–7, 8–14, >14) kg; kg >7 hari ditandai (K6).
5. **Kartu produksi vs keluar 30 hari**: dua garis + batang susut; angka hari ini.
6. **Kartu kontrol**: daftar K1–K7 yang `warn/fail` hari ini dalam bahasa manusia, dengan lokasi dan tautan ke layar yang memperbaikinya. Bila semua ok: "Tidak ada perhatian hari ini".
7. **Kartu hitung fisik terakhir**: tanggal, selisih kg/%, status penjelasan.

Pembaruan: polling 60 dtk (atau Realtime). Semua kartu membaca `position_daily` dan `control_result`.

### 3.6 `/outlook` — Outlook (bod, marketing, manager, accounting)

Tab:
1. **Produksi 28 hari**: per kandang/flok garis proyeksi vs aktual 14 hari terakhir; faktor kalibrasi; label "kalibrasi belum cukup" bila < 14 hari data; tabel umur, populasi, HDP aktual vs standar.
2. **Posisi proyeksi**: per grade, 28 hari: stok proyeksi (area), order (batang hitam), forecast (batang abu); tanda merah bila kekurangan pasok, kuning bila > hari stok ambang.
3. **Harga & GP**: harga realisasi tertimbang vs acuan 30 hari; pendapatan dan GP proyeksi 4 minggu (label HPP sementara).
4. **Kas 13 minggu**: tabel minggu × kategori, saldo akhir per minggu, saldo terendah ditandai; sumber: rencana jual × profil penagihan + rencana kas.
5. **Afkir (indikatif)**: per flok layer: umur, populasi, HDP aktual, margin harian, ambang afkir, indikasi "lanjut / tinjau" — selalu berlabel indikatif.

### 3.7 `/rekon` — Accounting

Tab: **Kunci hari** (lokasi × hari `approved`, kontrol K4, tombol Kunci) · **Koreksi** (daftar, buat, K9 dengan status menunggu BoD) · **Accurate** (upload, hasil K8, `reconciliation_item` dengan status) · **Kas** (saldo awal, rencana) · **Import** (CSV R-50 dengan pratinjau dan galat per baris) · **Ekspor** (BS 04A XLSX).

### 3.8 `/rekonstruksi` — Accounting

Form tanggal target (default 30-06-2026) dan T0; tabel per grade: closing T0, −produksi, +keluar, +susut, = closing target, kg × HPP, vs TB, selisih; label estimasi dan batas atas/bawah bila ada hari tanpa data; tombol "Ekspor draft Usulan Koreksi".

### 3.9 `/flok`, `/master`, `/admin`

Tabel CRUD sederhana dengan `Table` + `ActionForm`; audit per baris lewat drawer "Riwayat".

## 4. Alur utama

```
Marketing buat DO (draft) ──► Kandang serah DO (dikirim) ──► posisi berkurang
Kandang isi produksi/susut/mutasi ──► "Selesai hari ini" (submitted)
Manager setujui (approved) ──► Accounting kunci (locked)
Mingguan: Kandang hitung fisik ──► selisih vs hitungan ──► penjelasan ──► (koreksi oleh accounting bila perlu; > batas → BoD)
Bulanan: Accounting upload Accurate ──► K8 ──► reconciliation_item ──► koreksi / ekspor BS 04A
```

## 5. Teks dan format

- Tanggal: "Sel 28 Okt 2026"; jam 24 jam WIB.
- Kg: 1 desimal di kartu, 3 di tabel detail. Butir: bulat. Rp: "Rp 383,6 jt" di kartu; penuh di tabel.
- Label status hari: *Belum isi · Draft · Disetujui · Dikunci*.
- Label estimasi selalu berbentuk chip kuning dengan teks "HPP sementara" / "Estimasi" / "Kalibrasi belum cukup" / "Indikatif".
- Pesan galat menyebut apa yang harus dilakukan ("Stok UB Salopa akan negatif −12,0 kg. Periksa produksi atau DO.").

## 6. Prosedur opname T0 (untuk dicetak sebagai BA kertas bila app belum siap)

Kolom BA kertas = `opname` + `opname_line`:

Header: Lokasi · Tanggal · Jam cut-off · No. DO terakhir sebelum · No. DO pertama sesudah · Penghitung · Pendamping accounting · Manager.
Baris per grade: Peti · Tray · Butir sisa · Sampel: n peti ditimbang, total kg · Butir per tray sampel · (kg dan butir hasil dihitung saat impor).
Tanda tangan tiga pihak dengan nama dan jam. Foto tumpukan per grade.

Langkah: H−1 tetapkan jam dan tim; marketing menahan DO sejak jam cut-off → catat DO terakhir → hitung per grade, timbang sampel ≥ 10 peti/grade → BA ditandatangani → catat DO pertama sesudah → accounting bandingkan dengan Accurate tanggal yang sama → selisih ke Pending (RS-05).
