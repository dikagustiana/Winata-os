import { D, Decimal } from "./decimal";
import { addDays, startOfWeek } from "./dates";

/** R-36: kas 13 minggu dari rencana jual × profil penagihan + rencana kas. */

export interface RevenueWeek {
  weekStart: string;
  customerKind: string;
  amountRp: string | number;
}

export interface CashPlanItem {
  weekStart: string;
  category: string;
  direction: "in" | "out";
  amountRp: string | number;
}

export interface CashWeek {
  weekStart: string;
  collectionIn: string;
  otherIn: string;
  outflow: string;
  net: string;
  ending: string;
}

export interface Cash13Result {
  weeks: CashWeek[];
  lowest: { weekStart: string; balance: string };
}

/** Profil dari parameter JSON; angka > 1 dianggap persen. */
export function normalizeProfile(profile: Record<string, number[] | string[]>): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const [kind, values] of Object.entries(profile)) {
    const numbers = values.map((value) => Number(value));
    const usePercent = numbers.some((value) => value > 1);
    map.set(
      kind,
      numbers.map((value) => (usePercent ? value / 100 : value)),
    );
  }
  return map;
}

export function cash13(input: {
  startWeek: string;
  startBalance: string | number;
  revenue: RevenueWeek[];
  cashPlan: CashPlanItem[];
  profile: Record<string, number[] | string[]>;
  weeks?: number;
}): Cash13Result {
  const weeks = input.weeks ?? 13;
  const profile = normalizeProfile(input.profile);
  const weekStarts = Array.from({ length: weeks }, (_, index) => addDays(input.startWeek, index * 7));

  const collection = new Map<string, Decimal>();
  for (const revenue of input.revenue) {
    const kindProfile = profile.get(revenue.customerKind) ?? profile.get("lain") ?? [1];
    const revenueIndex = Math.round(
      (new Date(`${startOfWeek(revenue.weekStart)}T00:00:00Z`).getTime() -
        new Date(`${input.startWeek}T00:00:00Z`).getTime()) /
        (7 * 86_400_000),
    );
    if (revenueIndex < 0) continue;
    const amount = D(revenue.amountRp);
    kindProfile.forEach((share, offset) => {
      const target = revenueIndex + offset;
      if (target < 0 || target >= weeks || share <= 0) return;
      const key = weekStarts[target];
      collection.set(key, (collection.get(key) ?? new Decimal(0)).plus(amount.times(share)));
    });
  }

  const otherIn = new Map<string, Decimal>();
  const outflow = new Map<string, Decimal>();
  for (const item of input.cashPlan) {
    const key = startOfWeek(item.weekStart);
    if (!weekStarts.includes(key)) continue;
    if (item.direction === "in") {
      otherIn.set(key, (otherIn.get(key) ?? new Decimal(0)).plus(D(item.amountRp)));
    } else {
      outflow.set(key, (outflow.get(key) ?? new Decimal(0)).plus(D(item.amountRp)));
    }
  }

  let balance = D(input.startBalance);
  let lowest = { weekStart: weekStarts[0], balance: balance.toString() };
  const result: CashWeek[] = [];

  for (const weekStart of weekStarts) {
    const collectionIn = collection.get(weekStart) ?? new Decimal(0);
    const incoming = otherIn.get(weekStart) ?? new Decimal(0);
    const outgoing = outflow.get(weekStart) ?? new Decimal(0);
    const net = collectionIn.plus(incoming).minus(outgoing);
    balance = balance.plus(net);
    if (balance.lessThan(D(lowest.balance))) lowest = { weekStart, balance: balance.toFixed(2) };
    result.push({
      weekStart,
      collectionIn: collectionIn.toFixed(2),
      otherIn: incoming.toFixed(2),
      outflow: outgoing.toFixed(2),
      net: net.toFixed(2),
      ending: balance.toFixed(2),
    });
  }

  return { weeks: result, lowest };
}
