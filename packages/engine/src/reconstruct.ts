import { D, Decimal } from "./decimal";
import { addDays, diffDays, eachDay } from "./dates";

/**
 * R-43: rekonstruksi posisi 30-06-2026.
 * closing(target) = closing(T0) − Σ produksi(1-Jul..T0) + Σ keluar(1-Jul..T0)
 *                   + Σ susut(1-Jul..T0) − Σ koreksi posted
 */

export interface GradeFlow {
  gradeId: string;
  date: string;
  kg: string | number;
}

export interface ReconstructInput {
  targetDate: string;
  t0Date: string;
  t0Closing: Array<{ gradeId: string; kg: string | number }>;
  production: GradeFlow[];
  outbound: GradeFlow[];
  shrinkage: GradeFlow[];
  correction?: GradeFlow[];
  /** Rata-rata produksi harian 5 hari terakhir Juni per grade, untuk estimasi. */
  juneAverageDaily?: Array<{ gradeId: string; kg: string | number }>;
  /** Tanggal tanpa recording (string ISO). */
  missingDays?: string[];
}

export interface ReconstructRow {
  gradeId: string;
  t0Closing: string;
  production: string;
  outbound: string;
  shrinkage: string;
  correction: string;
  closing: string;
  estimated: boolean;
  lowerKg: string;
  upperKg: string;
}

export interface ReconstructResult {
  rows: ReconstructRow[];
  totalClosingKg: Decimal;
  hasMissing: boolean;
  missingDays: string[];
  periodDays: number;
}

export function reconstruct(input: ReconstructInput): ReconstructResult {
  const gradeIds = Array.from(new Set(input.t0Closing.map((row) => row.gradeId)));
  const missingDays = input.missingDays ?? [];
  const hasMissing = missingDays.length > 0;
  const periodDays = Math.max(1, diffDays(input.targetDate, input.t0Date));

  const rows: ReconstructRow[] = gradeIds.map((gradeId) => {
    const t0 = input.t0Closing
      .filter((row) => row.gradeId === gradeId)
      .reduce((acc, row) => acc.plus(D(row.kg)), new Decimal(0));
    const production = input.production
      .filter((row) => row.gradeId === gradeId)
      .reduce((acc, row) => acc.plus(D(row.kg)), new Decimal(0));
    const outbound = input.outbound
      .filter((row) => row.gradeId === gradeId)
      .reduce((acc, row) => acc.plus(D(row.kg)), new Decimal(0));
    const shrinkage = input.shrinkage
      .filter((row) => row.gradeId === gradeId)
      .reduce((acc, row) => acc.plus(D(row.kg)), new Decimal(0));
    const correction = (input.correction ?? [])
      .filter((row) => row.gradeId === gradeId)
      .reduce((acc, row) => acc.plus(D(row.kg)), new Decimal(0));

    const closing = t0.minus(production).plus(outbound).plus(shrinkage).minus(correction);

    let lower = closing;
    let upper = closing;
    if (hasMissing) {
      const estimatePerDay = input.juneAverageDaily?.find((row) => row.gradeId === gradeId)?.kg ?? 0;
      const estimate = D(estimatePerDay).times(missingDays.length);
      // Produksi yang tidak tercatat membuat closing lebih tinggi; estimasi yang
      // lebih tinggi membuat closing lebih rendah.
      upper = closing;
      lower = closing.minus(estimate);
    }

    return {
      gradeId,
      t0Closing: t0.toFixed(3),
      production: production.toFixed(3),
      outbound: outbound.toFixed(3),
      shrinkage: shrinkage.toFixed(3),
      correction: correction.toFixed(3),
      closing: closing.toFixed(3),
      estimated: hasMissing,
      lowerKg: lower.toFixed(3),
      upperKg: upper.toFixed(3),
    };
  });

  const totalClosingKg = rows.reduce((acc, row) => acc.plus(D(row.closing)), new Decimal(0));
  return {
    rows,
    totalClosingKg,
    hasMissing,
    missingDays,
    periodDays,
  };
}

/** Daftar hari 1 Juli..T0 yang tidak punya baris recording. */
export function findMissingDays(
  t0Date: string,
  recordedDates: string[],
  fromDate = `${t0Date.slice(0, 4)}-07-01`,
): string[] {
  const recorded = new Set(recordedDates);
  return eachDay(fromDate, t0Date).filter((day) => !recorded.has(day));
}

export function comparisonToTrialBalance(
  totalClosingKg: Decimal,
  hppPerKg: Decimal,
  trialBalanceRp: Decimal,
): { valueRp: Decimal; diffRp: Decimal; diffPct: Decimal } {
  const valueRp = totalClosingKg.times(hppPerKg);
  const diffRp = valueRp.minus(trialBalanceRp);
  return {
    valueRp,
    diffRp,
    diffPct: trialBalanceRp.isZero() ? new Decimal(0) : diffRp.dividedBy(trialBalanceRp),
  };
}

export function reconstructBounds(rows: ReconstructRow[]): { lowerKg: Decimal; upperKg: Decimal } {
  return {
    lowerKg: rows.reduce((acc, row) => acc.plus(D(row.lowerKg)), new Decimal(0)),
    upperKg: rows.reduce((acc, row) => acc.plus(D(row.upperKg)), new Decimal(0)),
  };
}

export function t0DateFromTarget(targetDate: string, offsetDays = 1): string {
  return addDays(targetDate, offsetDays);
}
