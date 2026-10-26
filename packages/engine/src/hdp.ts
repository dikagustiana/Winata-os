import { D, Decimal } from "./decimal";
import { addDays, diffDays, eachDay } from "./dates";
import { computeFlockState, type FlockDepletion, type FlockStatus } from "./flock";

/** R-30–R-32: kurva standar, kalibrasi, proyeksi produksi per flok. */

export interface HdpRow {
  strain: string;
  ageWeek: number;
  hdpPct: string | number;
  eggWeightG: string | number;
}

export interface ProjectionFlock {
  id: string;
  houseId: string;
  locationId: string;
  code: string;
  strain: string;
  chickInDate: string;
  initialBirds: number;
  status: FlockStatus;
  productionStartDate: string | null;
  cullDate: string | null;
  depletions: FlockDepletion[];
}

export interface ActualDay {
  flockId: string;
  date: string;
  kg: string | number;
}

export interface ProjectionCell {
  flockId: string;
  houseId: string;
  locationId: string;
  gradeId: string;
  date: string;
  kg: string;
  calibrationFactor: string;
  flag: string | null;
}

export interface HdpSeries {
  byKey: Map<string, HdpRow>;
  strains: string[];
}

export function indexHdp(rows: HdpRow[]): HdpSeries {
  const byKey = new Map<string, HdpRow>();
  for (const row of rows) byKey.set(`${row.strain}|${row.ageWeek}`, row);
  return { byKey, strains: Array.from(new Set(rows.map((r) => r.strain))) };
}

export function standardFor(series: HdpSeries, strain: string, ageWeek: number): HdpRow | null {
  return series.byKey.get(`${strain}|${ageWeek}`) ?? null;
}

/** R-32: standar kg/hari untuk satu flok pada satu tanggal (tanpa kalibrasi). */
export function standardDailyKg(
  flock: ProjectionFlock,
  date: string,
  series: HdpSeries,
  startAgeWeeks = 18,
): Decimal {
  const state = computeFlockState(flock, date, startAgeWeeks);
  if (!state.isProducing) return new Decimal(0);
  const row = standardFor(series, flock.strain, state.ageWeeks);
  if (!row) return new Decimal(0);
  return new Decimal(state.population)
    .times(D(row.hdpPct).dividedBy(100))
    .times(D(row.eggWeightG).dividedBy(1000));
}

export interface Calibration {
  factor: Decimal;
  actualKg: Decimal;
  standardKg: Decimal;
  days: number;
  insufficient: boolean;
}

/**
 * R-32: faktor kalibrasi = Σ aktual 14 hari ÷ Σ standar 14 hari, dibatasi 0,6–1,2.
 * Kurang dari `windowDays` hari data aktual → flag kalibrasi belum cukup.
 */
export function calibrationFactor(
  flock: ProjectionFlock,
  date: string,
  series: HdpSeries,
  actual: ActualDay[],
  windowDays = 14,
  startAgeWeeks = 18,
): Calibration {
  const days = eachDay(addDays(date, -(windowDays - 1)), date);
  const actualByDate = new Map(actual.filter((row) => row.flockId === flock.id).map((row) => [row.date, D(row.kg)]));
  let actualKg = new Decimal(0);
  let standardKg = new Decimal(0);
  let observed = 0;
  for (const day of days) {
    const standard = standardDailyKg(flock, day, series, startAgeWeeks);
    standardKg = standardKg.plus(standard);
    if (actualByDate.has(day)) {
      actualKg = actualKg.plus(actualByDate.get(day)!);
      observed += 1;
    }
  }
  const raw = standardKg.greaterThan(0) && observed > 0 ? actualKg.dividedBy(standardKg) : new Decimal(1);
  const factor = raw.lessThan(0.6) ? new Decimal(0.6) : raw.greaterThan(1.2) ? new Decimal(1.2) : raw;
  return {
    factor,
    actualKg,
    standardKg,
    days: observed,
    insufficient: observed < windowDays,
  };
}

/**
 * R-32: proyeksi per flok per hari = populasi × HDP × berat telur ÷ 1000 × faktor.
 * `forecastDate` = tanggal proyeksi (boleh masa depan).
 */
export function projectFlockDailyKg(
  flock: ProjectionFlock,
  date: string,
  series: HdpSeries,
  factor: Decimal,
  startAgeWeeks = 18,
): Decimal {
  return standardDailyKg(flock, date, series, startAgeWeeks).times(factor);
}

export interface GradeMix {
  [gradeId: string]: number;
}

/** R-32: mix grade aktual 14 hari kandang; sebelum ada aktual → default_grade_mix. */
export function gradeMix(
  actual: Array<{ gradeId: string; kg: string | number }>,
  defaultMix: GradeMix,
): GradeMix {
  const totals = new Map<string, Decimal>();
  let sum = new Decimal(0);
  for (const row of actual) {
    const kg = D(row.kg);
    if (kg.lessThanOrEqualTo(0)) continue;
    totals.set(row.gradeId, (totals.get(row.gradeId) ?? new Decimal(0)).plus(kg));
    sum = sum.plus(kg);
  }
  if (sum.lessThanOrEqualTo(0)) return defaultMix;
  const mix: GradeMix = {};
  for (const [gradeId, kg] of totals) mix[gradeId] = kg.dividedBy(sum).toNumber();
  return mix;
}

export function splitByMix(kg: Decimal, mix: GradeMix): Array<{ gradeId: string; kg: string }> {
  return Object.entries(mix).map(([gradeId, share]) => ({
    gradeId,
    kg: kg.times(share).toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed(3),
  }));
}

/**
 * Proyeksi 28 hari (R-32) untuk semua flok layer, dipecah per grade.
 * `actual` dipakai untuk kalibrasi dan mix grade.
 */
export function buildProjection(input: {
  flocks: ProjectionFlock[];
  series: HdpSeries;
  startDate: string;
  days: number;
  actual: ActualDay[];
  actualGradeKg: Array<{ flockId: string; gradeId: string; kg: string | number; date?: string }>;
  defaultMix: GradeMix;
  startAgeWeeks?: number;
  windowDays?: number;
}): { cells: ProjectionCell[]; calibrations: Map<string, Calibration> } {
  const cells: ProjectionCell[] = [];
  const calibrations = new Map<string, Calibration>();
  const dates = eachDay(input.startDate, addDays(input.startDate, input.days - 1));

  for (const flock of input.flocks) {
    const calibration = calibrationFactor(
      flock,
      addDays(input.startDate, -1),
      input.series,
      input.actual,
      input.windowDays ?? 14,
      input.startAgeWeeks ?? 18,
    );
    calibrations.set(flock.id, calibration);
    const mix = gradeMix(
      input.actualGradeKg.filter((row) => row.flockId === flock.id),
      input.defaultMix,
    );
    const flag = calibration.insufficient ? "insufficient_calibration" : null;

    for (const date of dates) {
      const kg = projectFlockDailyKg(flock, date, input.series, calibration.factor, input.startAgeWeeks ?? 18);
      if (kg.lessThanOrEqualTo(0)) continue;
      for (const part of splitByMix(kg, mix)) {
        cells.push({
          flockId: flock.id,
          houseId: flock.houseId,
          locationId: flock.locationId,
          gradeId: part.gradeId,
          date,
          kg: part.kg,
          calibrationFactor: calibration.factor.toDecimalPlaces(4).toFixed(4),
          flag,
        });
      }
    }
  }

  return { cells, calibrations };
}

/** Umur flok pada tanggal, untuk tabel outlook. */
export function flockAgeAt(flock: ProjectionFlock, date: string): number {
  return Math.floor(diffDays(flock.chickInDate, date) / 7);
}
