import { diffDays } from "./dates";

export type FlockStatus = "grower" | "layer" | "afkir";

export interface FlockDepletion {
  date: string;
  dead: number;
  culled: number;
}

export interface FlockInput {
  id: string;
  code: string;
  strain: string;
  chickInDate: string;
  initialBirds: number;
  status: FlockStatus;
  productionStartDate: string | null;
  cullDate: string | null;
  depletions: FlockDepletion[];
}

export interface FlockState {
  ageWeeks: number;
  ageDays: number;
  population: number;
  depleted: number;
  isProducing: boolean;
  status: FlockStatus;
  productionStartDate: string;
}

/** R-30: umur minggu = ⌊(tanggal − chick_in) ÷ 7⌋. */
export function flockAgeWeeks(chickInDate: string, date: string): number {
  const days = diffDays(chickInDate, date);
  if (days < 0) return 0;
  return Math.floor(days / 7);
}

/** R-30: populasi kini = awal − Σ deplesi sampai tanggal. */
export function flockPopulation(
  initialBirds: number,
  depletions: FlockDepletion[],
  date: string,
): number {
  const depleted = depletions
    .filter((d) => d.date <= date)
    .reduce((acc, d) => acc + Number(d.dead) + Number(d.culled), 0);
  return Math.max(0, initialBirds - depleted);
}

/** R-30/Q-4: mulai bertelur pada production_start_date atau umur default 18 minggu. */
export function defaultProductionStart(chickInDate: string, startAgeWeeks = 18): string {
  const date = new Date(`${chickInDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + startAgeWeeks * 7);
  return date.toISOString().slice(0, 10);
}

export function computeFlockState(flock: FlockInput, date: string, startAgeWeeks = 18): FlockState {
  const start = flock.productionStartDate ?? defaultProductionStart(flock.chickInDate, startAgeWeeks);
  const population = flockPopulation(flock.initialBirds, flock.depletions, date);
  let status: FlockStatus = flock.status;
  if (flock.cullDate && flock.cullDate <= date) status = "afkir";
  else if (date < start) status = "grower";
  else status = flock.status === "afkir" ? "afkir" : "layer";

  return {
    ageWeeks: flockAgeWeeks(flock.chickInDate, date),
    ageDays: Math.max(0, diffDays(flock.chickInDate, date)),
    population,
    depleted: flock.initialBirds - population,
    isProducing: status === "layer" && date >= start,
    status,
    productionStartDate: start,
  };
}
