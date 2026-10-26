import { D, Decimal, Numeric, q2 } from "./decimal";

/** R-13: nilai = kg × HPP sementara. Selalu berlabel "HPP sementara" di UI. */
export function valuationRp(kg: Numeric, hppPerKg: Numeric): Decimal {
  return D(kg).times(D(hppPerKg));
}

export function valuationStored(kg: Numeric, hppPerKg: Numeric): string {
  return q2(valuationRp(kg, hppPerKg));
}
