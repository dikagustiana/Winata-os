import { describe, expect, it } from "vitest";
import {
  DEFAULT_COA_INVENTORY_EGG,
  DEFAULT_COA_INVENTORY_VARIANCE,
  averageDailyByGrade,
  buildCorrectionProposal,
  reconstruct,
} from "../src";

const UB = "g-ub";
const US = "g-us";

const base = {
  targetDate: "2026-06-30",
  t0Date: "2026-07-10",
  t0Closing: [
    { gradeId: UB, kg: 1000 },
    { gradeId: US, kg: 500 },
  ],
  production: [
    { gradeId: UB, date: "2026-07-01", kg: 100 },
    { gradeId: US, date: "2026-07-01", kg: 50 },
  ],
  outbound: [
    { gradeId: UB, date: "2026-07-01", kg: 280 },
    { gradeId: US, date: "2026-07-02", kg: 70 },
  ],
  shrinkage: [],
  juneAverageDaily: [
    { gradeId: UB, kg: 100 },
    { gradeId: US, kg: 20 },
  ],
};

describe("T-80 rekonstruksi: batas atas dari keluar, batas bawah dari produksi Juni", () => {
  it("rata-rata keluar harian per grade dihitung dari hari tercatat", () => {
    const average = averageDailyByGrade(base.outbound, 7);
    expect(average.find((row) => row.gradeId === UB)?.kg).toBe("40.000");
    expect(average.find((row) => row.gradeId === US)?.kg).toBe("10.000");
  });

  it("3 hari bolong: atas naik rata-rata keluar × 3, bawah turun rata-rata produksi Juni × 3", () => {
    const outboundAverageDaily = averageDailyByGrade(base.outbound, 7);
    const result = reconstruct({
      ...base,
      outboundAverageDaily,
      missingDays: ["2026-07-04", "2026-07-05", "2026-07-06"],
    });
    const ub = result.rows.find((row) => row.gradeId === UB)!;
    const us = result.rows.find((row) => row.gradeId === US)!;
    // closing = t0 − produksi + keluar
    expect(ub.closing).toBe("1180.000");
    expect(ub.upperKg).toBe("1300.000"); // + 40 × 3
    expect(ub.lowerKg).toBe("880.000"); // − 100 × 3
    expect(us.closing).toBe("520.000");
    expect(us.upperKg).toBe("550.000"); // + 10 × 3
    expect(us.lowerKg).toBe("460.000"); // − 20 × 3
    expect(result.rows.every((row) => row.estimated)).toBe(true);
  });

  it("tanpa hari bolong batas = closing", () => {
    const result = reconstruct({ ...base, outboundAverageDaily: averageDailyByGrade(base.outbound, 7), missingDays: [] });
    for (const row of result.rows) {
      expect(row.upperKg).toBe(row.closing);
      expect(row.lowerKg).toBe(row.closing);
      expect(row.estimated).toBe(false);
    }
  });
});

describe("T-81 usulan koreksi memakai akun dari parameter", () => {
  const rows = [{ gradeCode: "UB", kg: 100 }];

  it("akun parameter dipakai dan dianggap terkonfirmasi", () => {
    const proposal = buildCorrectionProposal({
      rows,
      hppPerKg: 100,
      bookValueRp: 12_000,
      accounts: { inventory: "1-1401 Persediaan Telur", variance: "6-9001 Selisih Persediaan" },
    });
    expect(proposal.accountsConfirmed).toBe(true);
    expect(proposal.entries.map((entry) => entry.account)).toEqual([
      "6-9001 Selisih Persediaan",
      "1-1401 Persediaan Telur",
    ]);
  });

  it("dengan nilai default → accountsConfirmed=false, tanpa akun karangan", () => {
    const proposal = buildCorrectionProposal({
      rows,
      hppPerKg: 100,
      bookValueRp: 12_000,
      accounts: { inventory: DEFAULT_COA_INVENTORY_EGG, variance: DEFAULT_COA_INVENTORY_VARIANCE },
    });
    expect(proposal.accountsConfirmed).toBe(false);
    const accounts = proposal.entries.map((entry) => entry.account).join(" | ");
    expect(accounts).not.toMatch(/5-2100|1-1300/);
    expect(accounts).toContain("<isi dari CoA Winata>");

    const implicit = buildCorrectionProposal({ rows, hppPerKg: 100, bookValueRp: 12_000 });
    expect(implicit.accountsConfirmed).toBe(false);
    expect(implicit.entries.map((entry) => entry.account).join(" | ")).not.toMatch(/5-2100|1-1300/);
  });
});
