import { D, Decimal, Numeric } from "./decimal";

export interface DaysOfStockInput {
  closingKg: Numeric;
  productionKg: Numeric[];
}

/**
 * R-12: stok_kg ÷ rata-rata produksi kg 7 hari terakhir.
 * Pemanggil menyiapkan 7 angka produksi (lokasi gudang memakai semua kandang).
 * Mengembalikan null bila rata-rata produksi 0 (tidak ada dasar hitung).
 */
export function daysOfStock(input: DaysOfStockInput): Decimal | null {
  if (input.productionKg.length === 0) return null;
  const total = input.productionKg.reduce((acc: Decimal, v) => acc.plus(D(v)), new Decimal(0));
  const average = total.dividedBy(input.productionKg.length);
  if (average.lessThanOrEqualTo(0)) return null;
  return D(input.closingKg).dividedBy(average);
}

export function formatDaysOfStock(value: Decimal | null, digits = 1): string {
  if (value === null) return "—";
  return value.toDecimalPlaces(digits).toFixed(digits);
}
