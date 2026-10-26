import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computePosition, type ComputePositionInput, type PositionRow } from "../src/index";
import { D } from "../src/decimal";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(here, "../../../fixtures/week-example");

const transactions = JSON.parse(fs.readFileSync(path.join(fixtureDir, "transactions.json"), "utf8")) as Record<string, unknown>;
const golden = JSON.parse(fs.readFileSync(path.join(fixtureDir, "golden.json"), "utf8")) as {
  rows: Array<Record<string, number | string | null>>;
  hppPerKg: number;
  bucketDays: [number, number, number];
};

function input(): ComputePositionInput {
  return {
    locations: transactions.locations as ComputePositionInput["locations"],
    grades: transactions.grades as ComputePositionInput["grades"],
    startDate: transactions.startDate as string,
    endDate: transactions.endDate as string,
    openingDate: transactions.openingDate as string,
    opening: transactions.opening as ComputePositionInput["opening"],
    production: transactions.production as ComputePositionInput["production"],
    outbound: transactions.outbound as ComputePositionInput["outbound"],
    transfer: transactions.transfer as ComputePositionInput["transfer"],
    shrinkage: transactions.shrinkage as ComputePositionInput["shrinkage"],
    correction: transactions.correction as ComputePositionInput["correction"],
    hppPerKg: golden.hppPerKg,
    bucketDays: golden.bucketDays,
  };
}

const NUMERIC_FIELDS: Array<keyof PositionRow> = [
  "opening", "production", "transferIn", "outbound", "transferOut",
  "shrinkage", "correction", "closing", "inTransit", "ageB1", "ageB2", "ageB3", "ageB4", "valueRp",
];

describe("T-10 golden posisi 10 hari x 3 lokasi x 5 grade", () => {
  const rows = computePosition(input());

  it("jumlah baris = 150 (10 hari x 3 lokasi x 5 grade)", () => {
    expect(rows).toHaveLength(150);
    expect(golden.rows).toHaveLength(150);
  });

  it("setiap komponen dan closing sama dengan golden hingga 0,001", () => {
    const byKey = new Map(rows.map((r) => [`${r.locationId}|${r.gradeId}|${r.date}`, r]));
    for (const expected of golden.rows) {
      const key = `${expected.locationId}|${expected.gradeId}|${expected.date}`;
      const actual = byKey.get(key);
      expect(actual, `baris ${key} tidak ada`).toBeDefined();
      for (const field of NUMERIC_FIELDS) {
        const expectedValue = expected[field as string];
        const actualValue = actual![field];
        if (expectedValue === null) {
          expect(actualValue, `${key} ${field}`).toBeNull();
          continue;
        }
        expect(
          D(actualValue as string).minus(D(expectedValue as number)).abs().toNumber(),
          `${key} ${field}: aktual ${actualValue} vs golden ${expectedValue}`,
        ).toBeLessThanOrEqual(0.001);
      }
      if (expected.daysOfStock === null) {
        expect(actual!.daysOfStock).toBeNull();
      } else {
        expect(
          D(actual!.daysOfStock!).minus(D(expected.daysOfStock as number)).abs().toNumber(),
          `${key} daysOfStock`,
        ).toBeLessThanOrEqual(0.001);
      }
    }
  });

  it("spot check manual: SLP UB 2 Agu closing 4.500 (3.000 + 1.350 − 1.200)", () => {
    const row = rows.find((r) => r.locationId.endsWith("101") && r.gradeId.endsWith("301") && r.date === "2026-08-02");
    expect(row!.closing).toBe("4500.000");
    expect(row!.opening).toBe("4350.000");
  });

  it("spot check manual: SLP UB 10 Agu closing 12.900", () => {
    const row = rows.find((r) => r.locationId.endsWith("101") && r.gradeId.endsWith("301") && r.date === "2026-08-10");
    expect(row!.closing).toBe("12900.000");
  });

  it("spot check manual: TSK UB 5 Agu menerima 500 kg, closing 1.700", () => {
    const row = rows.find((r) => r.locationId.endsWith("103") && r.gradeId.endsWith("301") && r.date === "2026-08-05");
    expect(row!.transferIn).toBe("500.000");
    expect(row!.closing).toBe("1700.000");
  });

  it("spot check manual: TSK UB 10 Agu closing 450 kg, bucket 4–7 = 150, 8–14 = 300 (umur ikut mutasi)", () => {
    const row = rows.find((r) => r.locationId.endsWith("103") && r.gradeId.endsWith("301") && r.date === "2026-08-10");
    expect(row!.closing).toBe("450.000");
    expect(row!.ageB2).toBe("150.000");
    expect(row!.ageB3).toBe("300.000");
    expect(row!.ageB1).toBe("0.000");
    expect(row!.ageB4).toBe("0.000");
  });

  it("mutasi belum diterima tampil sebagai 'di jalan' pada tujuan (R-2)", () => {
    const rows08 = rows.filter((r) => r.locationId.endsWith("103") && r.gradeId.endsWith("302"));
    const inTransit = rows08.filter((r) => D(r.inTransit).greaterThan(0));
    expect(inTransit.map((r) => r.date)).toEqual(["2026-08-08", "2026-08-09", "2026-08-10"]);
    expect(inTransit.every((r) => r.inTransit === "200.000")).toBe(true);
  });

  it("koreksi draft tidak memengaruhi posisi; hanya posted (R-10)", () => {
    const us = rows.find((r) => r.locationId.endsWith("103") && r.gradeId.endsWith("302") && r.date === "2026-08-06");
    expect(us!.correction).toBe("0.000");
    const ub = rows.find((r) => r.locationId.endsWith("103") && r.gradeId.endsWith("301") && r.date === "2026-08-06");
    expect(ub!.correction).toBe("150.000");
  });

  it("identitas R-10 berlaku untuk setiap baris", () => {
    const byKey = new Map(rows.map((r) => [`${r.locationId}|${r.gradeId}|${r.date}`, r]));
    for (const row of rows) {
      const expected = D(row.opening)
        .plus(D(row.production))
        .plus(D(row.transferIn))
        .minus(D(row.outbound))
        .minus(D(row.transferOut))
        .minus(D(row.shrinkage))
        .plus(D(row.correction));
      expect(D(row.closing).minus(expected).abs().toNumber(), `${row.date} ${row.locationId} ${row.gradeId}`).toBeLessThan(0.0005);
      if (row.date !== "2026-08-01") {
        const previousDate = new Date(`${row.date}T00:00:00Z`);
        previousDate.setUTCDate(previousDate.getUTCDate() - 1);
        const prev = byKey.get(`${row.locationId}|${row.gradeId}|${previousDate.toISOString().slice(0, 10)}`);
        expect(prev!.closing, `opening ${row.date}`).toBe(row.opening);
      }
    }
  });

  it("aging konsisten dengan closing bila stok tidak negatif", () => {
    for (const row of rows) {
      const bucketTotal = D(row.ageB1).plus(row.ageB2).plus(row.ageB3).plus(row.ageB4);
      if (D(row.closing).greaterThanOrEqualTo(0)) {
        expect(bucketTotal.minus(row.closing).abs().toNumber(), `${row.date} aging`).toBeLessThan(0.0015);
      }
    }
  });
});
