import { D, Decimal, q3 } from "./decimal";
import { addDays, eachDay } from "./dates";

/** R-33: forecast default = rata-rata keluar 4 minggu terakhir per hari dalam minggu. */
export interface HistoryPoint {
  date: string;
  kg: string | number;
}

export interface SalesPlanLine {
  customerId: string;
  kind: "order" | "forecast";
  date: string;
  gradeId: string;
  kg: string | number;
  pricePerKg?: string | number | null;
}

export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function defaultForecast(
  history: HistoryPoint[],
  fromDate: string,
  days: number,
  windowDays = 28,
): Array<{ date: string; kg: string }> {
  const cutoff = addDays(fromDate, -windowDays);
  const bucket = new Map<number, { total: Decimal; days: Set<string> }>();
  for (const row of history) {
    if (row.date < cutoff || row.date >= fromDate) continue;
    const weekday = isoWeekday(row.date);
    const entry = bucket.get(weekday) ?? { total: new Decimal(0), days: new Set<string>() };
    entry.total = entry.total.plus(D(row.kg));
    entry.days.add(row.date);
    bucket.set(weekday, entry);
  }
  const dates = eachDay(fromDate, addDays(fromDate, days - 1));
  return dates.map((date) => {
    const entry = bucket.get(isoWeekday(date));
    if (!entry || entry.days.size === 0) return { date, kg: "0.000" };
    return { date, kg: q3(entry.total.dividedBy(entry.days.size)) };
  });
}

/** R-33: order (komitmen) menimpa forecast pada tanggal+grade yang sama. */
export function mergePlans(plans: SalesPlanLine[]): SalesPlanLine[] {
  const orders = plans.filter((plan) => plan.kind === "order");
  const orderKeys = new Set(orders.map((plan) => `${plan.date}|${plan.gradeId}`));
  const forecasts = plans.filter(
    (plan) => plan.kind === "forecast" && !orderKeys.has(`${plan.date}|${plan.gradeId}`),
  );
  return [...orders, ...forecasts];
}

export function planKgByDate(plans: SalesPlanLine[], kind?: "order" | "forecast"): Map<string, Decimal> {
  const map = new Map<string, Decimal>();
  for (const plan of plans) {
    if (kind && plan.kind !== kind) continue;
    const key = `${plan.date}|${plan.gradeId}`;
    map.set(key, (map.get(key) ?? new Decimal(0)).plus(D(plan.kg)));
  }
  return map;
}
