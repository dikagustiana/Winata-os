import { describe, expect, it } from "vitest";
import { computeControls, type ControlContext, type ControlResult } from "../src/controls";

const SLP = "11111111-1111-1111-1111-111111111101";
const CKL = "11111111-1111-1111-1111-111111111102";

function base(overrides: Partial<ControlContext> = {}): ControlContext {
  return {
    date: "2026-10-20",
    today: "2026-10-20",
    nowTimeWib: "19:00",
    locations: [
      { id: SLP, code: "SLP" },
      { id: CKL, code: "CKL" },
    ],
    dayStatuses: [
      { locationId: SLP, status: "submitted" },
      { locationId: CKL, status: "approved" },
    ],
    positions: [
      { locationId: SLP, gradeId: "g1", gradeCode: "UB", closing: "1000", ageB3: "0", ageB4: "0", daysOfStock: "2" },
      { locationId: CKL, gradeId: "g1", gradeCode: "UB", closing: "800", ageB3: "0", ageB4: "0", daysOfStock: "3" },
    ],
    transfers: [],
    physicalCounts: [],
    outbounds: [
      { locationId: SLP, doNumber: "SLP/2026/10/0001" },
      { locationId: SLP, doNumber: "SLP/2026/10/0002" },
    ],
    params: { deadline: "20:00", tolerancePct: 0.01, toleranceKg: 50, transitDaysAlert: 1, alertDays: 5 },
    ...overrides,
  };
}

function pick(results: ControlResult[], code: string, locationId = SLP): ControlResult {
  return results.find((row) => row.code === code && row.locationId === locationId)!;
}

describe("T-24 kontrol K1–K7 punya kasus ok dan warn/fail", () => {
  it("menghasilkan 7 kontrol per lokasi", () => {
    const results = computeControls(base());
    expect(results).toHaveLength(14);
    expect(new Set(results.map((row) => row.code))).toEqual(new Set(["K1", "K2", "K3", "K4", "K5", "K6", "K7"]));
  });

  it("K1: ok bila submitted sebelum batas; fail bila lewat batas", () => {
    expect(pick(computeControls(base()), "K1").status).toBe("ok");
    const late = computeControls(
      base({ nowTimeWib: "21:05", dayStatuses: [{ locationId: SLP, status: "open" }] }),
    );
    expect(pick(late, "K1").status).toBe("fail");
    const overdue = computeControls(base({ dayStatuses: [{ locationId: SLP, status: "open" }], today: "2026-10-21" }));
    expect(pick(overdue, "K1").status).toBe("fail");
  });

  it("K2: closing negatif fail", () => {
    const results = computeControls(
      base({
        positions: [
          { locationId: SLP, gradeId: "g1", gradeCode: "UB", closing: "-5", ageB3: "0", ageB4: "0", daysOfStock: null },
        ],
      }),
    );
    expect(pick(results, "K2").status).toBe("fail");
    expect(pick(results, "K2").detail).toMatchObject({ grades: [{ grade: "UB", closing: "-5" }] });
  });

  it("K3: nomor loncat warn, nomor ganda fail", () => {
    const gap = computeControls(
      base({ outbounds: [{ locationId: SLP, doNumber: "SLP/2026/10/0001" }, { locationId: SLP, doNumber: "SLP/2026/10/0004" }] }),
    );
    expect(pick(gap, "K3").status).toBe("warn");

    const duplicate = computeControls(
      base({ outbounds: [{ locationId: SLP, doNumber: "SLP/2026/10/0001" }, { locationId: SLP, doNumber: "SLP/2026/10/0001" }] }),
    );
    expect(pick(duplicate, "K3").status).toBe("fail");
  });

  it("K4: selisih di luar toleransi fail tanpa catatan, warn dengan catatan", () => {
    const noNote = computeControls(
      base({
        physicalCounts: [
          { locationId: SLP, date: "2026-10-20", diffKg: "-100", stockKg: "1000", note: null, gradeCode: "UB" },
        ],
      }),
    );
    expect(pick(noNote, "K4").status).toBe("fail");

    const withNote = computeControls(
      base({
        physicalCounts: [
          { locationId: SLP, date: "2026-10-20", diffKg: "-100", stockKg: "1000", note: "pecah saat bongkar", gradeCode: "UB" },
        ],
      }),
    );
    expect(pick(withNote, "K4").status).toBe("warn");

    const within = computeControls(
      base({
        physicalCounts: [
          { locationId: SLP, date: "2026-10-20", diffKg: "-10", stockKg: "1000", note: null, gradeCode: "UB" },
        ],
      }),
    );
    expect(pick(within, "K4").status).toBe("ok");
  });

  it("K5: mutasi lebih dari 1 hari di jalan warn", () => {
    const results = computeControls(
      base({
        transfers: [
          { id: "t1", toLocationId: SLP, sentDate: "2026-10-17", receivedDate: null, status: "in_transit" },
          { id: "t2", toLocationId: CKL, sentDate: "2026-10-20", receivedDate: null, status: "in_transit" },
        ],
      }),
    );
    expect(pick(results, "K5").status).toBe("warn");
    expect(pick(results, "K5").detail).toMatchObject({ transfers: [{ id: "t1", days: 3 }] });
    expect(pick(results, "K5", CKL).status).toBe("ok");
  });

  it("K6: stok umur > 7 hari warn", () => {
    const results = computeControls(
      base({
        positions: [
          { locationId: SLP, gradeId: "g1", gradeCode: "UB", closing: "1000", ageB3: "120", ageB4: "30", daysOfStock: "2" },
        ],
      }),
    );
    expect(pick(results, "K6").status).toBe("warn");
    expect(pick(results, "K6").detail).toMatchObject({ kg_older_than_7: "150.000" });
  });

  it("K7: hari stok di atas ambang warn", () => {
    const results = computeControls(
      base({
        positions: [
          { locationId: SLP, gradeId: "g1", gradeCode: "UB", closing: "1000", ageB3: "0", ageB4: "0", daysOfStock: "9.5" },
        ],
      }),
    );
    expect(pick(results, "K7").status).toBe("warn");
    expect(pick(results, "K7").detail).toMatchObject({ days_of_stock: "9.50", alert_days: 5 });
  });

  it("semua kontrol ok pada kondisi bersih", () => {
    const results = computeControls(
      base({
        physicalCounts: [
          { locationId: SLP, date: "2026-10-20", diffKg: "5", stockKg: "1000", note: null, gradeCode: "UB" },
        ],
      }),
    );
    const nonOk = results.filter((row) => row.status !== "ok");
    expect(nonOk).toEqual([]);
  });
});
