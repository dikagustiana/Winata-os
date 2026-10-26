import { D, Decimal } from "./decimal";
import { addDays, eachDay } from "./dates";
import type { SalesPlanLine } from "./salesPlan";

/** R-34: posisi proyeksi 28 hari per lokasi per grade. */

export interface BaseStock {
  locationId: string;
  gradeId: string;
  closing: string | number;
}

export interface ProjectedProduction {
  locationId: string;
  gradeId: string;
  date: string;
  kg: string | number;
}

export interface ProjectionOptions {
  startDate: string;
  days: number;
  baseStock: BaseStock[];
  production: ProjectedProduction[];
  plans: SalesPlanLine[];
  alertDays: number;
}

export interface ProjectionRow {
  locationId: string;
  gradeId: string;
  date: string;
  opening: string;
  production: string;
  salesOrder: string;
  salesForecast: string;
  closingProj: string;
  shortage: boolean;
  overAlert: boolean;
}

/**
 * Penjualan dialokasikan ke lokasi secara proporsional terhadap stok awal grade
 * (parameter `sales_plan_location_allocation`, default proporsional; Q-6).
 */
export function computeProjection(options: ProjectionOptions): ProjectionRow[] {
  const dates = eachDay(options.startDate, addDays(options.startDate, options.days - 1));
  const locationIds = Array.from(new Set(options.baseStock.map((row) => row.locationId)));
  const gradeIds = Array.from(new Set(options.baseStock.map((row) => row.gradeId)));
  const rows: ProjectionRow[] = [];

  for (const gradeId of gradeIds) {
    const stockForGrade = options.baseStock.filter((row) => row.gradeId === gradeId);
    const totalStock = stockForGrade.reduce((acc, row) => acc.plus(D(row.closing)), new Decimal(0));
    const weightByLocation = new Map<string, Decimal>();
    for (const locationId of locationIds) {
      const closing = stockForGrade.find((row) => row.locationId === locationId)?.closing ?? 0;
      weightByLocation.set(
        locationId,
        totalStock.greaterThan(0)
          ? D(closing).dividedBy(totalStock)
          : new Decimal(1).dividedBy(Math.max(locationIds.length, 1)),
      );
    }

    const plansForGrade = options.plans.filter((plan) => plan.gradeId === gradeId);
    const productionForGrade = options.production.filter((row) => row.gradeId === gradeId);

    for (const locationId of locationIds) {
      let closing = D(stockForGrade.find((row) => row.locationId === locationId)?.closing ?? 0);
      const weight = weightByLocation.get(locationId) ?? new Decimal(0);
      for (const date of dates) {
        const opening = closing;
        const production = productionForGrade
          .filter((row) => row.locationId === locationId && row.date === date)
          .reduce((acc, row) => acc.plus(D(row.kg)), new Decimal(0));
        const order = plansForGrade
          .filter((plan) => plan.kind === "order" && plan.date === date)
          .reduce((acc, plan) => acc.plus(D(plan.kg)), new Decimal(0))
          .times(weight);
        const forecast = plansForGrade
          .filter((plan) => plan.kind === "forecast" && plan.date === date)
          .reduce((acc, plan) => acc.plus(D(plan.kg)), new Decimal(0))
          .times(weight);
        closing = opening.plus(production).minus(order).minus(forecast);

        // Produksi proyeksi rata-rata untuk ambang hari stok.
        const projectedProduction = productionForGrade.filter(
          (row) => row.locationId === locationId && row.date <= date,
        );
        const averageProduction = projectedProduction.length > 0
          ? projectedProduction
              .reduce((acc, row) => acc.plus(D(row.kg)), new Decimal(0))
              .dividedBy(projectedProduction.length)
          : new Decimal(0);

        rows.push({
          locationId,
          gradeId,
          date,
          opening: opening.toFixed(3),
          production: production.toFixed(3),
          salesOrder: order.toFixed(3),
          salesForecast: forecast.toFixed(3),
          closingProj: closing.toFixed(3),
          shortage: closing.lessThan(0),
          overAlert:
            averageProduction.greaterThan(0) &&
            closing.dividedBy(averageProduction).greaterThan(options.alertDays),
        });
      }
    }
  }

  return rows;
}
