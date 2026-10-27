/**
 * DESIGN-v1.1 §1.1/§2: penolakan dari database tampil sebagai teks Bahasa
 * Indonesia yang menyebut tindakan berikutnya; kode SQLSTATE tidak tampil.
 * Pesan dari `raise exception` di migrasi sudah berbahasa Indonesia dan
 * diteruskan apa adanya; pesan teknis Postgres/PostgREST dipetakan di sini.
 */

export const HARD_DELETE_DENIED = "Data tidak dihapus permanen. Gunakan Batalkan; data tetap tersimpan dengan jejak.";
export const CORRECTION_STATUS_ONLY_RPC =
  "Status koreksi hanya berubah lewat tombol Setujui (BoD) dan Posting (Accounting).";
export const CORRECTION_APPROVAL_DROPPED =
  "Isi koreksi berubah. Persetujuan BoD gugur; minta persetujuan ulang sebelum posting.";
export const CANCEL_REASON_REQUIRED =
  "Alasan pembatalan wajib diisi (minimal 10 karakter). Posisi akan dibangun ulang dari tanggal ini.";
export const DO_LOCKED_CANNOT_CANCEL = "DO di hari yang sudah dikunci tidak bisa dibatalkan. Buat koreksi lewat Accounting.";
export const MARKETING_HANDOVER_DENIED =
  "Serah DO dikonfirmasi oleh petugas kandang di layar Hari. Marketing hanya membuat dan menerima DO.";
export const BOD_LIMIT_WAITING = "Melebihi batas BoD (Rp 10 jt / 2 % stok). Menunggu persetujuan BoD.";
export const GENERIC_REJECTED = "Perubahan ditolak oleh aturan data.";

/** "Hari {tanggal} di {lokasi} sudah {disetujui/dikunci}. …" (DESIGN-v1.1 §2). */
export function dayClosedMessage(dateLabel: string, locationLabel: string, status: string): string {
  const word = status === "locked" ? "dikunci" : "disetujui";
  return `Hari ${dateLabel} di ${locationLabel} sudah ${word}. Minta manager mengembalikan hari ini bila perlu diubah.`;
}

const TECHNICAL = /violates|relation|column|syntax|function|constraint|null value|invalid input|operator|PGRST|JWT|42\d{3}|23\d{3}/i;

export function translateDbError(message: string | null | undefined): string {
  const text = (message ?? "").trim();
  if (text === "") return GENERIC_REJECTED;
  if (/permission denied for (table|relation)/i.test(text)) return HARD_DELETE_DENIED;
  if (/row-level security|violates row-level/i.test(text)) {
    return `${GENERIC_REJECTED} Status hari, lokasi penugasan, atau peran Anda tidak mengizinkan perubahan ini.`;
  }
  if (/duplicate key|unique constraint/i.test(text)) return "Data yang sama sudah ada. Periksa isian lalu simpan ulang.";
  if (TECHNICAL.test(text)) return `${GENERIC_REJECTED} (${text})`;
  return text;
}
