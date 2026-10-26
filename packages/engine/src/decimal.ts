import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export type Numeric = string | number | Decimal;

export function D(value: Numeric | null | undefined): Decimal {
  if (value === null || value === undefined || value === "") return new Decimal(0);
  return new Decimal(value);
}

/** Bulat 3 desimal saat disimpan (R-10). */
export function round3(value: Decimal): Decimal {
  return value.toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
}

/** Rupiah 2 desimal. */
export function round2(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Angka simpan: string tanpa nol berlebih, 3 desimal. */
export function q3(value: Decimal): string {
  return round3(value).toFixed(3);
}

export function q2(value: Decimal): string {
  return round2(value).toFixed(2);
}

export function sum(values: Decimal[]): Decimal {
  return values.reduce((acc, v) => acc.plus(v), new Decimal(0));
}

export function max0(value: Decimal): Decimal {
  return value.isNegative() ? new Decimal(0) : value;
}

export function minDecimal(a: Decimal, b: Decimal): Decimal {
  return a.lessThan(b) ? a : b;
}

export function isNegative(value: Decimal): boolean {
  return value.lessThan(0);
}
