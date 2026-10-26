# PROMPT — Agen coding (DeepSeek) · Winata Egg Position v1

Salin seluruh blok di bawah ke harness DeepSeek, dengan working directory = root repo yang berisi folder `docs/`. Jalankan satu kali per milestone; ganti `{M}` dengan `M0` … `M6`.

---

```
Kamu adalah agen coding untuk proyek "Winata Egg Position" (PT Winata Mega Agro). Bekerja di repo ini saja.

SUMBER KEBENARAN (baca semuanya dulu, urut):
1. docs/PRD-v1.md        — K = keputusan mengikat, R = aturan, T = tes, Q = pertanyaan terbuka (bangun di belakang parameter default; jangan finalkan)
2. docs/PLAN.md          — milestone, keluaran, dan tes gerbang per milestone; prinsip kerja
3. docs/DESIGN.md        — token, komponen, layar, teks dan format
4. docs/ARCHITECTURE.md  — struktur repo, skema, RLS, lingkungan tes PGlite + mock auth, worker, offline, CI
5. docs/QUESTIONS.md     — pertanyaan yang sudah dicatat (buat bila belum ada)
6. docs/log/*.md         — log milestone sebelumnya (bila ada)

TUGAS SEKARANG: kerjakan milestone {M} sesuai PLAN.md sampai SEMUA tes gerbang milestone itu hijau, lalu berhenti.

ATURAN KERAS
- Jangan melompat ke milestone berikutnya. Jangan mengerjakan ulang milestone yang sudah di-merge kecuali tes gerbangnya merah.
- Branch: {branch}. Commit kecil dengan pesan Bahasa Indonesia yang menyebut R/T yang disentuh (contoh: "engine: aging FIFO (R-11), tes T-11").
- Database hanya lewat file migrasi baru di supabase/migrations/. Jangan mengubah migrasi yang sudah ada di main.
- Tidak ada akses ke Supabase cloud, Vercel, atau internet selain npm registry. Tidak ada kunci di repo; .env.example berisi nama variabel saja.
- Tes database memakai PGlite (@electric-sql/pglite) seperti ARCHITECTURE §5. RLS TIDAK boleh dimatikan untuk membuat tes hijau. Bila RLS tidak dapat dievaluasi di PGlite, catat di docs/QUESTIONS.md dengan bukti (pesan galat, versi), tandai tes terkait "ditunda ke staging", dan lanjutkan.
- Angka: decimal.js di TS, numeric di SQL. Tidak ada float untuk kuantitas atau Rupiah.
- UI Bahasa Indonesia, kode Inggris. Tidak ada kode K/R/T di teks yang dilihat pengguna (boleh di tooltip/title). Tidak ada placeholder sebagai label. Tidak ada window.confirm.
- Setiap klaim "lolos" harus berasal dari perintah yang kamu jalankan di sesi ini dan outputnya kamu tempel di log. Jangan menyatakan lolos dari pembacaan kode.
- Kalau PRD/DESIGN/ARCHITECTURE bertentangan satu sama lain: PRD menang; catat konfliknya di docs/QUESTIONS.md.
- Kalau ada keputusan yang tidak tercakup dokumen: pilih yang paling sederhana yang memenuhi tes, bangun di belakang parameter bila mungkin, dan catat sebagai Q baru dengan default yang kamu pilih. Jangan bertanya ke pemilik di tengah milestone.
- Jangan menambah dependensi di luar daftar ARCHITECTURE §2 tanpa mencatat alasannya di log. xlsx dari npm resmi (0.18.5), bukan cdn.sheetjs.com.
- Jangan mengubah fixture golden yang sudah ada untuk membuat tes hijau; kalau golden salah, buktikan dengan perhitungan manual di log, lalu ubah golden dan tes bersamaan dalam satu commit yang menyebutnya.

URUTAN KERJA
1. Baca keenam sumber. Tulis ringkasan 10 baris tentang apa yang akan dibuat di milestone ini ke docs/log/{M}.md bagian "Rencana" sebelum menulis kode.
2. Kerjakan keluaran milestone sesuai PLAN.md. Mulai dari skema/migrasi dan engine (dengan tes), lalu server action, lalu layar, lalu e2e.
3. Setelah setiap unit selesai jalankan: pnpm typecheck && pnpm test. Jangan menumpuk kesalahan.
4. Di akhir: pnpm typecheck && pnpm test && pnpm e2e && pnpm lint. Semua harus hijau.
5. Tulis docs/log/{M}.md lengkap:
   - Rencana (dari langkah 1)
   - Yang dibuat (per file/folder, singkat)
   - Tes: output ringkas tiap perintah (jumlah tes per paket, durasi), daftar T-nn → hijau/merah/ditunda dengan alasan
   - Keputusan kecil yang diambil dan Q baru (juga ditambahkan ke docs/QUESTIONS.md)
   - Yang belum/tidak dikerjakan dan kenapa
   - Cara menjalankan lokal (perintah persis)
6. Berhenti. Jangan mulai milestone berikutnya.

KETENTUAN KHUSUS PER MILESTONE
- M0: tugas pertama adalah membuktikan RLS dievaluasi di PGlite (set role authenticated + request.jwt.claims; auth.uid() shim). Hasil bukti (query dan output) wajib ada di log sebelum tabel lain dibuat. Buat juga fixtures seed user per peran dengan sufiks @winata.test dan docs/QUESTIONS.md.
- M1: buat fixtures/week-example/ (3 lokasi SLP/CKL/TSK, 5 grade, 10 hari, mutasi di jalan, susut, 1 koreksi) beserta golden.json yang kamu hitung manual di spreadsheet/skrip terpisah dan tempel ringkasannya di log, sebelum engine ditulis. Engine harus mereproduksi golden, bukan golden mengikuti engine.
- M2: jangan menyentuh engine posisi; hanya status, kontrol, dashboard, offline. Dashboard tidak boleh query tabel transaksi (T-27).
- M3: hdp_standard untuk Isa Brown, Lohmann Brown, Hy-Line Brown umur 18–90 minggu diisi dari panduan manajemen strain yang kamu ketahui; beri label "standar strain, seed" di kolom source dan catat sumbernya di docs/reference/hdp-sources.md. Jangan mengarang kurva untuk strain lain.
- M4: profil penagihan dari parameter collection_profile; jangan hardcode.
- M5: fixture Accurate dibuat sintetis dengan kolom standar ekspor Accurate (Sales by Item Detail, Inventory Valuation); beri komentar di fixture bahwa pemilik akan menggantinya dengan ekspor asli. Kolom BS 04A untuk ekspor ada di docs/reference/bs04a-columns.md (bila belum ada, buat dari PRD R-42 dan tandai "perlu konfirmasi pemilik").
- M6: parameter tb_egg_whole_rp=383582877, tb_egg_broken_rp=6209446, tb_hpp_per_kg=17419 sebagai default; mode estimasi bila ada hari tanpa data.

DEFINISI SELESAI untuk {M}: semua T milestone ini hijau atau "ditunda ke staging" dengan bukti; typecheck 0 galat; lint bersih; docs/log/{M}.md lengkap; tidak ada file .env dengan nilai; branch siap PR ke main.
```

---

## Nilai `{branch}` per milestone

| {M} | {branch} |
|---|---|
| M0 | `m0-foundation` |
| M1 | `m1-transactions` |
| M2 | `m2-workflow-dashboard` |
| M3 | `m3-outlook` |
| M4 | `m4-cash-cull` |
| M5 | `m5-accurate-recon` |
| M6 | `m6-reconstruction` |

## Yang dilakukan pemilik di antara milestone

1. Baca `docs/log/{M}.md`: cek daftar T hijau, baca "Keputusan kecil" dan Q baru.
2. Jalankan sendiri `pnpm install && pnpm test` sekali untuk memastikan hasilnya sama di laptop.
3. Jawab Q yang mengubah perilaku (cukup tulis jawabannya di `docs/QUESTIONS.md` kolom "Jawaban"); yang lain biarkan default.
4. Merge PR ke `main`, lalu jalankan prompt untuk milestone berikutnya.
5. Sesudah M6 di-merge: serahkan repo ke Claude Code dengan checklist PLAN.md §Serah terima.
