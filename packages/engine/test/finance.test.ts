import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCorrectionProposal,
  cash13,
  comparisonToTrialBalance,
  cullIndication,
  D,
  reconstruct,
  type CashPlanItem,
  type RevenueWeek,
} from "../src/index";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../../../fixtures");
const cashInput = JSON.parse(fs.readFileSync(path.join(fixtures, "cash-example", "input.json"), "utf8"));
const cashGolden = JSON.parse(fs.readFileSync(path.join(fixtures, "cash-example", "golden.json"), "utf8"));
const reconInput = JSON.parse(fs.readFileSync(path.join(fixtures, "reconstruct-example", "input.json"), "utf8"));
const reconGolden = JSON.parse(fs.readFileSync(path.join(fixtures, "reconstruct-example", "golden.json"), "utf8"));

describe("T-40 profil penagihan (R-36)", () => {
  it("bakul masuk minggu 0; agen 50/50; grup 0/0/100", () => {
    const result = cash13({
      startWeek: "2026-10-26",
      startBalance: 0,
      revenue: [
        { weekStart: "2026-10-26", customerKind: "bakul", amountRp: 100 },
        { weekStart: "2026-10-26", customerKind: "agen", amountRp: 100 },
        { weekStart: "2026-10-26", customerKind: "grup", amountRp: 100 },
      ],
      cashPlan: [],
      profile: { bakul: [1], agen: [0.5, 0.5], grup: [0, 0, 1], lain: [1] },
      weeks: 4,
    });
    expect(result.weeks[0].collectionIn).toBe("150.00"); // bakul 100 + agen 50
    expect(result.weeks[1].collectionIn).toBe("50.00"); // agen 50
    expect(result.weeks[2].collectionIn).toBe("100.00"); // grup 100
    expect(result.weeks[3].collectionIn).toBe("0.00");
  });

  it("profil persen (55) dinormalisasi menjadi 0,55", () => {
    const result = cash13({
      startWeek: "2026-10-26",
      startBalance: 0,
      revenue: [{ weekStart: "2026-10-26", customerKind: "bakul", amountRp: 1000 }],
      cashPlan: [],
      profile: { bakul: [100] },
      weeks: 1,
    });
    expect(result.weeks[0].collectionIn).toBe("1000.00");
  });
});

describe("T-41 kas 13 minggu dan saldo terendah", () => {
  const result = cash13({
    startWeek: cashInput.startWeek,
    startBalance: cashInput.startBalance,
    revenue: cashInput.revenue as RevenueWeek[],
    cashPlan: cashInput.cashPlan as CashPlanItem[],
    profile: cashInput.profile,
    weeks: 13,
  });

  it("13 minggu, angka sama dengan golden", () => {
    expect(result.weeks).toHaveLength(13);
    cashGolden.weeks.forEach((expected: { weekStart: string; ending: number }, index: number) => {
      expect(result.weeks[index].weekStart).toBe(expected.weekStart);
      expect(Number(result.weeks[index].ending)).toBeCloseTo(expected.ending, 2);
    });
  });

  it("saldo terendah dan minggunya benar", () => {
    expect(result.lowest.weekStart).toBe(cashGolden.lowest.weekStart);
    expect(Number(result.lowest.balance)).toBeCloseTo(cashGolden.lowest.balance, 2);
    expect(cashGolden.lowest.balance).toBeLessThan(0);
  });
});

describe("T-42 afkir indikatif", () => {
  const base = {
    realizedPricePerKg: 26000,
    feedGPerBird: 115,
    feedPricePerKg: 7100,
    cullValuePerBird: 35000,
    remainingDays: 28,
  };

  it("margin harian = produksi × harga − pakan", () => {
    const result = cullIndication({ population: 10000, productionKgDaily: 700, ...base });
    expect(result.feedCostDailyRp.toNumber()).toBe(8_165_000);
    expect(result.marginDailyRp.toNumber()).toBe(18_200_000 - 8_165_000);
    expect(result.thresholdRp.toNumber()).toBe(12_500_000);
    expect(result.suggestion).toBe("tinjau");
  });

  it("lanjut bila margin di atas ambang, tinjau bila di bawah", () => {
    const high = cullIndication({ population: 10000, productionKgDaily: 1000, ...base });
    expect(high.suggestion).toBe("lanjut");
    const low = cullIndication({ population: 10000, productionKgDaily: 300, ...base });
    expect(low.suggestion).toBe("tinjau");
  });

  it("3 flok menghasilkan nilai berbeda sesuai populasi", () => {
    const results = [9000, 10000, 11000].map((population) =>
      cullIndication({ population, productionKgDaily: 850, ...base }),
    );
    expect(results[0].thresholdRp.toNumber()).toBe((35000 * 9000) / 28);
    expect(results[2].thresholdRp.toNumber()).toBe((35000 * 11000) / 28);
    expect(new Set(results.map((r) => r.suggestion)).size).toBeGreaterThanOrEqual(1);
  });
});

describe("T-60 rekonstruksi 30-06-2026 (R-43)", () => {
  const result = reconstruct(reconInput);

  it("closing sama dengan golden hingga 0,001 kg", () => {
    expect(result.rows).toHaveLength(5);
    for (const expected of reconGolden.rows) {
      const actual = result.rows.find((row) => row.gradeId === expected.gradeId)!;
      expect(Number(actual.closing)).toBeCloseTo(expected.closing, 3);
      expect(Number(actual.production)).toBeCloseTo(expected.production, 3);
      expect(Number(actual.outbound)).toBeCloseTo(expected.outbound, 3);
      expect(actual.estimated).toBe(false);
    }
    expect(Number(result.totalClosingKg)).toBeCloseTo(reconGolden.totalClosingKg, 3);
  });

  it("mode estimasi: hari tanpa data memberi batas atas/bawah dan label", () => {
    const estimated = reconstruct({
      ...reconInput,
      missingDays: [reconGolden.missingDay],
    });
    expect(estimated.hasMissing).toBe(true);
    expect(estimated.rows.every((row) => row.estimated)).toBe(true);
    for (const expected of reconGolden.missingRows) {
      const actual = estimated.rows.find((row) => row.gradeId === expected.gradeId)!;
      expect(Number(actual.upperKg)).toBeCloseTo(expected.closing, 3);
      expect(Number(actual.lowerKg)).toBeCloseTo(expected.lowerKg, 3);
      expect(Number(actual.lowerKg)).toBeLessThanOrEqual(Number(actual.upperKg));
    }
  });
});

describe("T-61 selisih vs TB dan usulan koreksi (T-62)", () => {
  it("nilai kg × HPP sementara dan selisih vs TB dihitung", () => {
    const comparison = comparisonToTrialBalance(D(reconGolden.totalClosingKg), D(17419), D(389792323));
    expect(comparison.valueRp.toNumber()).toBeCloseTo(reconGolden.totalClosingKg * 17419, 2);
    expect(comparison.diffRp.toNumber()).toBeCloseTo(reconGolden.totalClosingKg * 17419 - 389792323, 2);
  });

  it("draft Usulan Koreksi seimbang dan menyebut RS-05", () => {
    const proposal = buildCorrectionProposal({
      rows: reconGolden.rows.map((row: { gradeId: string; closing: number }) => ({
        gradeCode: row.gradeId,
        kg: row.closing,
      })),
      hppPerKg: 17419,
      bookValueRp: 389792323,
    });
    expect(proposal.balanced).toBe(true);
    expect(proposal.totalDebit).toBe(proposal.totalCredit);
    expect(proposal.entries.length).toBe(2);
    expect(proposal.entries.every((entry) => entry.memo.includes("RS-05"))).toBe(true);
  });

  it("tanpa selisih tidak ada baris Dr/Cr", () => {
    const proposal = buildCorrectionProposal({
      rows: [{ gradeCode: "UB", kg: 100 }],
      hppPerKg: 100,
      bookValueRp: 10_000,
    });
    expect(proposal.entries).toHaveLength(0);
    expect(proposal.balanced).toBe(true);
  });
});
