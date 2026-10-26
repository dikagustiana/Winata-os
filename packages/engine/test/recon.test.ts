import { describe, expect, it } from "vitest";
import { buildBs04a, reconcile } from "../src/index";

const UB = "g-ub";
const US = "g-us";
const PC = "g-pc";

describe("T-52 K8 rekonsiliasi per grade", () => {
  it("selisih kg, Rp, dan stok masuk item; nol selisih tidak membuat item", () => {
    const items = reconcile({
      period: "2026-09",
      appSales: [
        { gradeId: UB, kg: 1000, rp: 26_000_000 },
        { gradeId: US, kg: 500, rp: 12_000_000 },
      ],
      accurateSales: [
        { gradeId: UB, kg: 1000, rp: 26_000_000 },
        { gradeId: US, kg: 480, rp: 11_520_000 },
      ],
      appStock: [
        { gradeId: UB, kg: 2700 },
        { gradeId: US, kg: 1314 },
      ],
      accurateStock: [
        { gradeId: UB, kg: 2700 },
        { gradeId: US, kg: 1300 },
      ],
    });

    const usKg = items.find((item) => item.gradeId === US && item.kind === "kg")!;
    expect(usKg.appValue).toBe("500.000");
    expect(usKg.accurateValue).toBe("480.000");
    expect(usKg.diff).toBe("20.000");

    const usRp = items.find((item) => item.gradeId === US && item.kind === "rp")!;
    expect(usRp.diff).toBe("480000.000");

    const usStock = items.find((item) => item.gradeId === US && item.kind === "stock")!;
    expect(usStock.diff).toBe("14.000");

    expect(items.filter((item) => item.gradeId === UB)).toHaveLength(0);
  });

  it("grade yang hanya ada di satu sisi tetap dibandingkan", () => {
    const items = reconcile({
      period: "2026-09",
      appSales: [{ gradeId: PC, kg: 81, rp: 729_000 }],
      accurateSales: [],
      appStock: [],
      accurateStock: [],
    });
    expect(items.map((item) => item.kind).sort()).toEqual(["kg", "rp"]);
    expect(items[0].diff).toBe("81.000");
  });
});

describe("T-53 ekspor BS 04A", () => {
  it("kolom dan subtotal sesuai bagian B/C", () => {
    const rows = buildBs04a(
      [
        {
          gradeId: UB,
          gradeCode: "UB",
          gradeName: "Utuh Besar",
          kg: 2700,
          ageB1: 100,
          ageB2: 200,
          ageB3: 1000,
          ageB4: 1400,
          daysOfStock: 3.2,
          eggs: 44280,
        },
        {
          gradeId: US,
          gradeCode: "US",
          gradeName: "Utuh Sedang",
          kg: 1314,
          ageB1: 14,
          ageB2: 300,
          ageB3: 500,
          ageB4: 500,
          daysOfStock: 2.5,
          eggs: 21944,
        },
      ],
      17419,
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      gradeCode: "UB",
      kg: "2700.000",
      hppPerKg: "17419.00",
      valueRp: "47031300.00",
      daysOfStock: "3.20",
      ageB3: "1000.000",
    });
    const totalKg = rows.reduce((acc, row) => acc + Number(row.kg), 0);
    const totalRp = rows.reduce((acc, row) => acc + Number(row.valueRp), 0);
    expect(totalKg).toBe(4014);
    expect(totalRp).toBeCloseTo(4014 * 17419, 2);
  });
});
