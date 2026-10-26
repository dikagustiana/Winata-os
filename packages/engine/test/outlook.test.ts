import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildProjection,
  calibrationFactor,
  computeProjection,
  flockAgeAt,
  gradeMix,
  indexHdp,
  standardFor,
  weightedPriceByGradeDate,
  projectedRevenue,
  grossProfit,
  D,
  type ProjectionFlock,
  type HdpRow,
} from "../src/index";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../../../fixtures/outlook-example");
const input = JSON.parse(fs.readFileSync(path.join(dir, "input.json"), "utf8"));
const hdp = JSON.parse(fs.readFileSync(path.join(dir, "hdp.json"), "utf8")) as HdpRow[];
const golden = JSON.parse(fs.readFileSync(path.join(dir, "golden.json"), "utf8"));
const flocks = input.flocks as ProjectionFlock[];
const series = indexHdp(hdp);

const UB = "33333333-3333-3333-3333-333333333301";
const US = "33333333-3333-3333-3333-333333333302";
const UK = "33333333-3333-3333-3333-333333333303";

describe("T-30 umur dan HDP standar 5 flok", () => {
  it("umur minggu sesuai tanggal chick-in", () => {
    const ages = flocks.map((flock) => [flock.code, flockAgeAt(flock, input.startDate)]);
    expect(ages).toEqual([
      ["SLP1-2025-08", 64],
      ["SLP2-2026-06", 16],
      ["CKL1-2025-09", 60],
      ["SLP1-2024-02", 142],
      ["SLP2-2025-02", 89],
    ]);
  });

  it("HDP dan berat telur diambil dari tabel strain (bukan karangan)", () => {
    const isa = standardFor(series, "Isa Brown", 64)!;
    expect(Number(isa.hdpPct)).toBeCloseTo(79.0, 1);
    expect(Number(isa.eggWeightG)).toBeCloseTo(68.34, 1);
    const hyline = standardFor(series, "Hy-Line Brown", 60)!;
    expect(Number(hyline.hdpPct)).toBe(81);
    const lohmann = standardFor(series, "Lohmann Brown", 16);
    expect(lohmann).toBeNull();
  });

  it("flok di luar kurva (umur > 90) tidak diproyeksikan", () => {
    const old = flocks.find((flock) => flock.code === "SLP1-2024-02")!;
    expect(flockAgeAt(old, input.startDate)).toBeGreaterThan(90);
    const result = buildProjection({
      flocks: [old],
      series,
      startDate: input.startDate,
      days: 28,
      actual: input.actualHistory,
      actualGradeKg: input.actualGradeKg,
      defaultMix: input.defaultMix,
    });
    expect(result.cells).toHaveLength(0);
  });
});

describe("T-31 kalibrasi 14 hari dan batas 0,6–1,2", () => {
  it("faktor = Σ aktual ÷ Σ standar, dengan flag bila < 14 hari", () => {
    const fl1 = flocks[0];
    const calibration = calibrationFactor(fl1, "2026-10-26", series, input.actualHistory, 14);
    expect(calibration.days).toBe(14);
    expect(calibration.insufficient).toBe(false);
    expect(calibration.factor.toNumber()).toBeCloseTo(golden.calibrations["fl-1"].factor, 6);

    const short = calibrationFactor(fl1, "2026-10-26", series, input.actualHistory.slice(0, 8), 14);
    expect(short.insufficient).toBe(true);
  });

  it("faktor dibatasi 0,6 dan 1,2", () => {
    const fl1 = flocks[0];
    const tiny = calibrationFactor(
      fl1,
      "2026-10-26",
      series,
      input.actualHistory.map((row: { flockId: string; date: string; kg: number }) =>
        row.flockId === "fl-1" ? { ...row, kg: 1 } : row,
      ),
      14,
    );
    expect(tiny.factor.toString()).toBe("0.6");

    const huge = calibrationFactor(
      fl1,
      "2026-10-26",
      series,
      input.actualHistory.map((row: { flockId: string; date: string; kg: number }) =>
        row.flockId === "fl-1" ? { ...row, kg: 5000 } : row,
      ),
      14,
    );
    expect(huge.factor.toString()).toBe("1.2");
  });

  it("tanpa data aktual: faktor 1 dan label kalibrasi belum cukup", () => {
    const noActual = calibrationFactor(flocks[4], "2026-10-26", series, [], 14);
    expect(noActual.factor.toString()).toBe("1");
    expect(noActual.insufficient).toBe(true);
  });
});

describe("T-32 proyeksi produksi 28 hari", () => {
  const result = buildProjection({
    flocks,
    series,
    startDate: input.startDate,
    days: 28,
    actual: input.actualHistory,
    actualGradeKg: input.actualGradeKg,
    defaultMix: input.defaultMix,
  });

  it("menghasilkan sel yang sama dengan golden hingga 0,01 kg", () => {
    expect(result.cells).toHaveLength(golden.cells.length);
    const byKey = new Map(result.cells.map((cell) => [`${cell.flockId}|${cell.gradeId}|${cell.date}`, cell]));
    for (const expected of golden.cells) {
      const key = `${expected.flockId}|${expected.gradeId}|${expected.date}`;
      const actual = byKey.get(key);
      expect(actual, key).toBeDefined();
      expect(Math.abs(Number(actual!.kg) - Number(expected.kg)), key).toBeLessThanOrEqual(0.01);
      expect(actual!.calibrationFactor).toBe(expected.calibrationFactor);
      expect(actual!.flag).toBe(expected.flag);
    }
  });

  it("flok grower belum produksi (0 sel)", () => {
    expect(result.cells.filter((cell) => cell.flockId === "fl-2")).toHaveLength(0);
  });

  it("tanggal proyeksi dimulai hari ini+1 dan 28 hari", () => {
    const dates = Array.from(new Set(result.cells.map((cell) => cell.date))).sort();
    expect(dates).toHaveLength(28);
    expect(dates[0]).toBe("2026-10-27");
    expect(dates[27]).toBe("2026-11-23");
  });
});

describe("T-33 mix grade aktual 14 hari vs default", () => {
  it("memakai mix aktual kandang bila ada", () => {
    const mix = gradeMix(
      input.actualGradeKg.filter((row: { flockId: string }) => row.flockId === "fl-1"),
      input.defaultMix,
    );
    expect(mix[UB]).toBeCloseTo(8400 / 14000, 4);
    expect(Object.values(mix).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it("memakai default_grade_mix sebelum ada aktual", () => {
    const mix = gradeMix([], input.defaultMix);
    expect(mix).toEqual(input.defaultMix);
  });
});

describe("T-34 posisi proyeksi dan kekurangan pasok", () => {
  it("kekurangan pasok saat order melebihi stok + produksi", () => {
    const rows = computeProjection({
      startDate: "2026-10-27",
      days: 5,
      baseStock: [{ locationId: "L1", gradeId: UB, closing: 1000 }],
      production: [0, 1, 2, 3, 4].map((offset) => ({
        locationId: "L1",
        gradeId: UB,
        date: `2026-10-${String(27 + offset)}`,
        kg: 100,
      })),
      plans: [
        { customerId: "C1", kind: "order", date: "2026-10-30", gradeId: UB, kg: 1500 },
        { customerId: "C2", kind: "forecast", date: "2026-10-28", gradeId: UB, kg: 100 },
      ],
      alertDays: 5,
    });
    expect(rows).toHaveLength(5);
    const day1 = rows.find((row) => row.date === "2026-10-27")!;
    expect(day1.closingProj).toBe("1100.000");
    const day2 = rows.find((row) => row.date === "2026-10-28")!;
    expect(day2.closingProj).toBe("1100.000");
    const day4 = rows.find((row) => row.date === "2026-10-30")!;
    expect(Number(day4.closingProj)).toBe(-200);
    expect(day4.shortage).toBe(true);
    expect(rows.filter((row) => row.shortage)).toHaveLength(2);
  });

  it("menandai posisi di atas ambang hari stok", () => {
    const rows = computeProjection({
      startDate: "2026-10-27",
      days: 3,
      baseStock: [{ locationId: "L1", gradeId: UB, closing: 1000 }],
      production: [{ locationId: "L1", gradeId: UB, date: "2026-10-27", kg: 100 }],
      plans: [],
      alertDays: 5,
    });
    expect(rows[0].overAlert).toBe(true);
  });
});

describe("T-35 harga realisasi tertimbang dan GP proyeksi", () => {
  it("harga tertimbang per grade per hari", () => {
    const prices = weightedPriceByGradeDate([
      { date: "2026-10-20", gradeId: UB, kg: 100, pricePerKg: 26000 },
      { date: "2026-10-20", gradeId: UB, kg: 300, pricePerKg: 27000 },
      { date: "2026-10-20", gradeId: US, kg: 100, pricePerKg: 24000 },
    ]);
    expect(prices.get(`2026-10-20|${UB}`)!.toNumber()).toBe(26750);
    expect(prices.get(`2026-10-20|${US}`)!.toNumber()).toBe(24000);
  });

  it("pendapatan proyeksi memakai harga order atau realisasi 7 hari", () => {
    const fallback = new Map([[US, D(24000)]]);
    const { revenueRp, kg } = projectedRevenue(
      [
        { gradeId: UB, kg: 100, pricePerKg: 26750 },
        { gradeId: US, kg: 50, pricePerKg: null },
      ],
      fallback,
    );
    expect(kg.toString()).toBe("150");
    expect(revenueRp.toNumber()).toBe(26750 * 100 + 24000 * 50);
    expect(grossProfit(revenueRp, kg, D(17419)).toNumber()).toBeCloseTo(2675000 + 1200000 - 150 * 17419, 2);
  });

  it("grade tanpa harga realisasi tidak menghasilkan pendapatan palsu", () => {
    const { revenueRp } = projectedRevenue([{ gradeId: UK, kg: 10, pricePerKg: null }], new Map());
    expect(revenueRp.toString()).toBe("0");
  });
});
