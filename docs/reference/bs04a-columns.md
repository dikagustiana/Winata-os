# Kolom ekspor BS 04A Persediaan (R-42)

Kolom di bawah dipakai `apps/web/app/api/export/bs04a/route.ts` dan
`packages/engine/src/recon.ts#buildBs04a`. Urutan mengikuti sheet
**"BS 04A Persediaan" bagian B (rincian per grade) dan C (nilai)** pada workbook
LK Bulanan. **Perlu konfirmasi pemilik**: bila kolom workbook asli berbeda,
ubah `buildBs04a` + test T-53 bersamaan.

| # | Kolom | Isi | Sumber |
|---|---|---|---|
| 1 | No | nomor urut | — |
| 2 | Kode | kode grade (`UB`, `US`, …) | `grade.code` |
| 3 | Grade | nama grade | `grade.name` |
| 4 | Kg | stok akhir kg | `position_daily.closing` |
| 5 | Butir | butir diturunkan | `kg × unit_conversion.eggs_per_kg` |
| 6 | HPP sementara /kg | parameter `hpp_per_kg` | `parameter` |
| 7 | Nilai Rp | kg × HPP sementara | dihitung |
| 8 | 0–3 hari (kg) | aging bucket 1 | `position_daily.age_b1` |
| 9 | 4–7 hari (kg) | aging bucket 2 | `position_daily.age_b2` |
| 10 | 8–14 hari (kg) | aging bucket 3 | `position_daily.age_b3` |
| 11 | >14 hari (kg) | aging bucket 4 | `position_daily.age_b4` |
| 12 | Hari stok | stok ÷ rata-rata produksi 7 hari | `position_daily.days_of_stock` |

Catatan:

- Semua angka kg 3 desimal pada file; UI menampilkan 1 desimal di kartu.
- HPP selalu berlabel **HPP sementara**; costing flok belum ada di v1 (Q-8).
- Baris total menjumlahkan kg dan nilai Rp; butir dan aging tidak dijumlah lintas
  baris di footer (subtotal aging ada di kolom masing-masing).
