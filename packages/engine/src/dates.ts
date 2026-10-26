/** Utilitas tanggal ISO (YYYY-MM-DD) tanpa dependensi zona waktu. */

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseIsoDate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

export function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parseIsoDate(value).getTime());
}

export function addDays(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

export function diffDays(from: string, to: string): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / 86_400_000);
}

export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard < 5000) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return days;
}

export function ageDays(fromDate: string, atDate: string): number {
  return diffDays(fromDate, atDate);
}

/** Senin dari minggu berjalan (untuk kas mingguan). */
export function startOfWeek(iso: string): string {
  const date = parseIsoDate(iso);
  const day = date.getUTCDay(); // 0 = Minggu
  const delta = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + delta);
  return toIsoDate(date);
}

export function formatTanggalId(iso: string): string {
  const date = parseIsoDate(iso);
  const days = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
  const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return `${days[date.getUTCDay()]} ${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
