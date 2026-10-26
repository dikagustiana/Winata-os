# DESIGN v1.1 — Hardening & Cloud (adendum)

`DESIGN.md` tetap mengikat: token, komponen, layar, grammar tidak berubah. v1.1 hanya menambah teks dan tiga perubahan kecil perilaku layar. Tidak ada layar baru.

## 1. Prinsip tambahan

1. **Aturan yang pindah ke database tetap terbaca manusia di layar.** Setiap penolakan baru (R-60…R-69) punya pesan Bahasa Indonesia yang menyebut apa yang harus dilakukan; kode SQLSTATE tidak pernah tampil. Pemetaan di `apps/web/lib/errors.ts` (buat bila belum ada): pola pesan dari `raise exception` → teks UI; fallback "Perubahan ditolak oleh aturan data. (detail)".
2. **Tidak ada tombol yang menjanjikan hapus permanen.** Label "Hapus" diganti "Batalkan" (transaksi) / "Nonaktifkan" (master). Baris yang dibatalkan tidak tampil di daftar default; tautan kecil "Tampilkan yang dibatalkan" di bawah tabel untuk accounting/admin.
3. **Status yang bergantung pada tindakan pemilik tampil sebagai chip kuning**, bukan disembunyikan: "Akun belum dikonfirmasi" (R-71), "Nilai buku belum dikonfirmasi" (Q-21), "Unggah foto belum aktif" bila `SUPABASE_SERVICE_ROLE_KEY` kosong di cloud.

## 2. Teks baru (pakai persis)

| Situasi | Teks |
|---|---|
| Insert koreksi bukan draft / ubah status langsung | "Status koreksi hanya berubah lewat tombol Setujui (BoD) dan Posting (Accounting)." |
| Isi koreksi diubah sesudah disetujui BoD | Banner info di form koreksi: "Isi koreksi berubah. Persetujuan BoD gugur; minta persetujuan ulang sebelum posting." |
| Hapus permanen ditolak | "Data tidak dihapus permanen. Gunakan Batalkan; data tetap tersimpan dengan jejak." |
| Batalkan opname sudah tanda tangan / koreksi posted tanpa alasan | "Alasan pembatalan wajib diisi (minimal 10 karakter). Posisi akan dibangun ulang dari tanggal ini." |
| Batalkan DO di hari dikunci | "DO di hari yang sudah dikunci tidak bisa dibatalkan. Buat koreksi lewat Accounting." |
| Marketing menandai dikirim | "Serah DO dikonfirmasi oleh petugas kandang di layar Hari. Marketing hanya membuat dan menerima DO." |
| Kandang menulis di hari disetujui/dikunci (termasuk hitung fisik, opname, terima mutasi) | "Hari {tanggal} di {lokasi} sudah {disetujui/dikunci}. Minta manager mengembalikan hari ini bila perlu diubah." |
| K4 (OR, per grade) | "Selisih hitung fisik {grade} {±x,x kg} ({y,y %}) melebihi toleransi ({tolerance_kg} kg atau {tolerance_pct} %). Isi penjelasan minimal 10 karakter di hitung fisik tanggal {tanggal}." |
| Login mock tanpa password | "Akun belum punya kata sandi. Minta admin mengatur kata sandi." |
| Cloud tanpa service-role key (buat akun / unggah) | "Fitur ini menunggu konfigurasi server (kunci layanan Supabase). Hubungi admin." |
| Rekonstruksi, akun default | Chip kuning "Akun belum dikonfirmasi" di atas tabel jurnal + tooltip "Isi parameter coa_inventory_egg dan coa_inventory_variance di Admin → Parameter." |
| Rekonstruksi, hari bolong | Dua baris di bawah total: "Batas bawah (estimasi) {kg}" dan "Batas atas (estimasi) {kg}" dengan chip "Estimasi" dan tooltip rumus R-70 |

## 3. Perubahan layar (kecil)

### 3.1 `/rekon` tab Koreksi
- Kolom status menampilkan chip: draft (abu) · disetujui BoD (biru) · diposting (hijau) · dibatalkan (abu coret).
- Tombol "Posting" nonaktif dengan tooltip bila di atas batas dan belum disetujui BoD (hitung dari parameter di server; teks: "Melebihi batas BoD (Rp 10 jt / 2 % stok). Menunggu persetujuan BoD.").
- Form edit koreksi `approved` menampilkan banner §2.

### 3.2 Daftar DO (`/do`), Hari (`/hari`), Fisik (`/fisik`), Master
- "Hapus" → "Batalkan"/"Nonaktifkan" dengan konfirmasi dalam form (bukan `window.confirm`) dan kolom alasan bila diperlukan (R-63).
- Untuk marketing, tombol "Sudah diserahkan" tidak ada; yang ada "Tandai diterima" untuk DO `dikirim`.

### 3.3 `/admin` pengguna
- Urutan pembuatan akun mengikuti R-64; pesan sukses: "Pengguna {email} dibuat dan bisa login." Bila Auth gagal: "Akun login gagal dibuat; data pengguna dibatalkan. ({alasan})".
- Baris chip kuning "Unggah foto belum aktif" di header admin bila cloud tanpa service-role key.

### 3.4 `/rekonstruksi`
- Tabel jurnal memakai akun dari parameter; chip "Akun belum dikonfirmasi" bila default; baris batas atas/bawah (R-70).

## 4. Lint UI
`scripts/lint-ui.ts` ditambah: tidak ada label tombol "Hapus" di `apps/web/app` (kecuali `/admin` → "Nonaktifkan"); tidak ada teks "5-2100"/"1-1300".
