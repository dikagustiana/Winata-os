# Sumber kurva HDP dan berat telur (Q-5)

Data seed `supabase/seed/0005_hdp.sql` adalah **kurva standar strain, seed**:
titik jangkar diambil dari rentang standar produksi yang dipublikasikan pada
panduan manajemen strain, lalu diinterpolasi linear per minggu umur 18–90.

| Strain | Sumber rentang yang dipakai | Catatan |
|---|---|---|
| Isa Brown | Hendrix Genetics — *Isa Brown Management Guide*, tabel produksi harian & berat telur | HDP puncak ±96 %, berat telur 63–69 g pada 30–90 minggu |
| Lohmann Brown | Lohmann Tierzucht — *Lohmann Brown Classic Management Guide* | HDP puncak ±97 %, berat telur sedikit lebih tinggi |
| Hy-Line Brown | Hy-Line International — *Hy-Line Brown Commercial Management Guide* | HDP puncak ±96 %, berat telur 65–70 g |

Angka yang dipakai adalah titik jangkar, bukan salinan tabel penuh:

| Umur (mgg) | Isa HDP / g | Lohmann HDP / g | Hy-Line HDP / g |
|---|---|---|---|
| 18 | 20 / 50,0 | 25 / 51,0 | 22 / 50,5 |
| 20 | 70 / 57,0 | 72 / 58,0 | 71 / 57,5 |
| 24 | 95 / 62,2 | 96 / 63,2 | 95,5 / 62,8 |
| 30 | 96 / 64,4 | 96 / 65,4 | 95,5 / 65,0 |
| 40 | 91,5 / 66,3 | 92 / 66,9 | 91,5 / 66,5 |
| 50 | 86 / 67,4 | 87 / 68,0 | 86,5 / 67,6 |
| 60 | 81 / 68,1 | 81,5 / 68,8 | 81 / 68,3 |
| 70 | 76 / 68,7 | 76,5 / 69,4 | 76 / 68,9 |
| 80 | 71 / 69,1 | 71,5 / 69,8 | 71 / 69,3 |
| 90 | 66 / 69,5 | 66,5 / 70,2 | 66 / 69,7 |

**Tindakan pemilik (Q-5):** ganti tabel `hdp_standard` dengan kurva resmi strain
yang benar-benar dipakai Winata, lalu jalankan ulang proyeksi. Jangan mengarang
kurva untuk strain lain; `standardFor()` mengembalikan null dan proyeksi 0 bila
strain tidak ada di tabel.
