import { D, Decimal } from "./decimal";

/** R-35: harga realisasi tertimbang, pendapatan proyeksi, GP proyeksi. */

export interface PriceLine {
  gradeId: string;
  date: string;
  kg: string | number;
  pricePerKg: string | number;
}

export interface OutboundLineForPrice {
  date: string;
  gradeId: string;
  kg: string | number;
  pricePerKg: string | number | null;
}

export function weightedPriceByGradeDate(lines: OutboundLineForPrice[]): Map<string, Decimal> {
  const accum = new Map<string, { kg: Decimal; rp: Decimal }>();
  for (const line of lines) {
    if (line.pricePerKg === null || line.pricePerKg === undefined) continue;
    const kg = D(line.kg);
    if (kg.lessThanOrEqualTo(0)) continue;
    const key = `${line.date}|${line.gradeId}`;
    const current = accum.get(key) ?? { kg: new Decimal(0), rp: new Decimal(0) };
    current.kg = current.kg.plus(kg);
    current.rp = current.rp.plus(kg.times(D(line.pricePerKg)));
    accum.set(key, current);
  }
  const result = new Map<string, Decimal>();
  for (const [key, value] of accum) {
    if (value.kg.greaterThan(0)) {
      result.set(key, value.rp.dividedBy(value.kg).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
    }
  }
  return result;
}

/** Rata-rata harga realisasi 7 hari terakhir per grade. */
export function realizedPrice7(lines: OutboundLineForPrice[], date: string): Map<string, Decimal> {
  const cutoff = new Date(`${date}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 6);
  const from = cutoff.toISOString().slice(0, 10);
  const filtered = lines.filter((line) => line.date >= from && line.date <= date);
  const accum = new Map<string, { kg: Decimal; rp: Decimal }>();
  for (const line of filtered) {
    if (line.pricePerKg === null || line.pricePerKg === undefined) continue;
    const kg = D(line.kg);
    if (kg.lessThanOrEqualTo(0)) continue;
    const current = accum.get(line.gradeId) ?? { kg: new Decimal(0), rp: new Decimal(0) };
    current.kg = current.kg.plus(kg);
    current.rp = current.rp.plus(kg.times(D(line.pricePerKg)));
    accum.set(line.gradeId, current);
  }
  const result = new Map<string, Decimal>();
  for (const [gradeId, value] of accum) {
    if (value.kg.greaterThan(0)) result.set(gradeId, value.rp.dividedBy(value.kg));
  }
  return result;
}

export interface GpLine {
  gradeId: string;
  kg: string | number;
  revenueRp: string | number;
  gpRp: Decimal;
}

export function projectedRevenue(
  plans: Array<{ gradeId: string; kg: string | number; pricePerKg?: string | number | null }>,
  fallbackPrices: Map<string, Decimal>,
): { revenueRp: Decimal; kg: Decimal } {
  let revenue = new Decimal(0);
  let kg = new Decimal(0);
  for (const plan of plans) {
    const amount = D(plan.kg);
    kg = kg.plus(amount);
    const price = plan.pricePerKg !== null && plan.pricePerKg !== undefined
      ? D(plan.pricePerKg)
      : fallbackPrices.get(plan.gradeId) ?? new Decimal(0);
    revenue = revenue.plus(amount.times(price));
  }
  return { revenueRp: revenue, kg };
}

export function grossProfit(revenueRp: Decimal, kg: Decimal, hppPerKg: Decimal): Decimal {
  return revenueRp.minus(kg.times(hppPerKg));
}
