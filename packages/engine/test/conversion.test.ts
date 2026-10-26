import { describe, expect, it } from "vitest";
import {
  conversionFromSample,
  eggsFromKg,
  opnameLineKg,
  resolveConversion,
  toKg,
  type ConversionVersion,
} from "../src/conversion";

const versions: ConversionVersion[] = [
  { gradeId: "g-ub", validFrom: "2026-07-01", kgPerCrate: 15, kgPerTray: 1.9, eggsPerKg: 16.4 },
  { gradeId: "g-ub", validFrom: "2026-09-01", kgPerCrate: 15.2, kgPerTray: 1.94, eggsPerKg: 16.2 },
];

describe("T-12 konversi satuan (R-4)", () => {
  it("kg, peti, tray, butir memakai versi yang berlaku pada tanggal transaksi", () => {
    expect(toKg({ qty: 10, unit: "kg", gradeId: "g-ub", date: "2026-08-15" }, resolveConversion(versions, "g-ub", "2026-08-15")).toString()).toBe("10");
    expect(toKg({ qty: 10, unit: "peti", gradeId: "g-ub", date: "2026-08-15" }, resolveConversion(versions, "g-ub", "2026-08-15")).toString()).toBe("150");
    expect(toKg({ qty: 10, unit: "tray", gradeId: "g-ub", date: "2026-08-15" }, resolveConversion(versions, "g-ub", "2026-08-15")).toString()).toBe("19");
    expect(toKg({ qty: 164, unit: "btr", gradeId: "g-ub", date: "2026-08-15" }, resolveConversion(versions, "g-ub", "2026-08-15")).toString()).toBe("10");
  });

  it("perubahan versi tidak mengubah transaksi lama (tidak retroaktif)", () => {
    const before = resolveConversion(versions, "g-ub", "2026-08-31")!;
    const after = resolveConversion(versions, "g-ub", "2026-09-01")!;
    expect(before.validFrom).toBe("2026-07-01");
    expect(after.validFrom).toBe("2026-09-01");
    expect(toKg({ qty: 1, unit: "peti", gradeId: "g-ub", date: "2026-08-31" }, before).toString()).toBe("15");
    expect(toKg({ qty: 1, unit: "peti", gradeId: "g-ub", date: "2026-09-01" }, after).toString()).toBe("15.2");
  });

  it("tidak ada versi untuk tanggal sebelum versi pertama → galat jelas", () => {
    expect(resolveConversion(versions, "g-ub", "2026-06-30")).toBeNull();
    expect(() => toKg({ qty: 1, unit: "peti", gradeId: "g-ub", date: "2026-06-30" }, null)).toThrow(/Konversi/);
  });

  it("butir diturunkan dari kg (R-14)", () => {
    expect(eggsFromKg(10, versions[1])).toBe(162);
    expect(eggsFromKg(0, versions[1])).toBe(0);
  });
});

describe("T-13 opname R-5", () => {
  it("kg hasil = Σ(peti × kg/peti sampel) + Σ(tray × kg/tray) + butir sisa ÷ butir/kg", () => {
    const result = opnameLineKg(
      {
        gradeId: "g-ub",
        crates: 10,
        trays: 2,
        looseEggs: 16,
        sampleCrates: 5,
        sampleKg: 76,
        sampleEggsPerTray: 30,
      },
      versions[0],
    );
    // 10 × (76/5) + 2 × (30/16.4) + 16/16.4 = 152 + 3,6585 + 0,9756 = 156,634
    expect(result.kg.toFixed(3)).toBe("156.634");
    expect(result.kgPerCrateSample!.toFixed(3)).toBe("15.200");
  });

  it("bila sampel kurang dari 10 peti tetap boleh, memakai sampel yang ada", () => {
    const result = opnameLineKg(
      { gradeId: "g-ub", crates: 6, trays: 0, looseEggs: 0, sampleCrates: 6, sampleKg: 90, sampleEggsPerTray: null },
      versions[0],
    );
    expect(result.kg.toFixed(3)).toBe("90.000");
  });

  it("fallback ke konversi terakhir bila baris tanpa sampel", () => {
    const result = opnameLineKg(
      { gradeId: "g-ub", crates: 4, trays: 0, looseEggs: 0, sampleCrates: 0, sampleKg: 0, sampleEggsPerTray: null },
      versions[0],
    );
    expect(result.kg.toFixed(3)).toBe("60.000");
  });

  it("sampel opname menjadi versi unit_conversion baru", () => {
    const version = conversionFromSample("g-ub", "2026-08-01", 5, 76, 30, 16.4);
    expect(version.kgPerCrate).toBe("15.200");
    expect(version.kgPerTray).toBe("1.829");
    expect(version.validFrom).toBe("2026-08-01");
  });
});
