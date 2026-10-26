import { D, Decimal } from "./decimal";

/** R-37: indikasi afkir — sengaja indikatif, bukan costing flok. */

export interface CullInput {
  population: number;
  productionKgDaily: string | number;
  realizedPricePerKg: string | number;
  feedGPerBird?: number;
  feedPricePerKg?: number;
  cullValuePerBird?: number;
  remainingDays?: number;
}

export interface CullResult {
  marginDailyRp: Decimal;
  feedCostDailyRp: Decimal;
  thresholdRp: Decimal;
  ratio: Decimal | null;
  suggestion: "lanjut" | "tinjau";
}

export function cullIndication(input: CullInput): CullResult {
  const population = input.population;
  const feedG = input.feedGPerBird ?? 115;
  const feedPrice = D(input.feedPricePerKg ?? 7100);
  const cullValue = D(input.cullValuePerBird ?? 35000);
  const remainingDays = Math.max(1, input.remainingDays ?? 28);

  const revenue = D(input.productionKgDaily).times(D(input.realizedPricePerKg));
  const feedCost = new Decimal(population).times(feedG).dividedBy(1000).times(feedPrice);
  const margin = revenue.minus(feedCost);
  const threshold = cullValue.times(population).dividedBy(remainingDays);

  return {
    marginDailyRp: margin,
    feedCostDailyRp: feedCost,
    thresholdRp: threshold,
    ratio: threshold.greaterThan(0) ? margin.dividedBy(threshold) : null,
    suggestion: margin.greaterThan(threshold) ? "lanjut" : "tinjau",
  };
}
