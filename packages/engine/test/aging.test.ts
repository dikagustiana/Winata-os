import { describe, expect, it } from "vitest";
import { StockLedger } from "../src/aging";
import { D } from "../src/decimal";

const BUCKETS: [number, number, number] = [3, 7, 14];

describe("T-11 aging FIFO (R-11)", () => {
  it("keluar menghabiskan lapisan tertua lebih dulu", () => {
    const ledger = new StockLedger([
      { date: "2026-08-01", kg: D(100) },
      { date: "2026-08-02", kg: D(80) },
      { date: "2026-08-03", kg: D(60) },
    ]);
    const consumed = ledger.consume(120);
    expect(consumed.map((c) => `${c.date}:${c.kg.toString()}`)).toEqual(["2026-08-01:100", "2026-08-02:20"]);
    expect(ledger.total().toString()).toBe("120");
    expect(ledger.snapshot()[0].date).toBe("2026-08-02");
  });

  it("mutasi membawa umur lapisan asal ke lokasi tujuan", () => {
    const source = new StockLedger([
      { date: "2026-08-01", kg: D(50) },
      { date: "2026-08-05", kg: D(70) },
    ]);
    const carried = source.consume(80);
    const destination = new StockLedger();
    destination.addLayers(carried);
    destination.add("2026-08-09", 10);
    const buckets = destination.buckets("2026-08-10", BUCKETS);
    // 50 kg umur 9 hari (bucket 8-14), 30 kg umur 5 hari (4-7), 10 kg umur 1 hari.
    expect(buckets.map((b) => b.toString())).toEqual(["10", "30", "50", "0"]);
  });

  it("koreksi/opname positif membentuk lapisan bertanggal hari itu", () => {
    const ledger = new StockLedger();
    ledger.add("2026-08-10", 25);
    const buckets = ledger.buckets("2026-08-10", BUCKETS);
    expect(buckets.map((b) => b.toString())).toEqual(["25", "0", "0", "0"]);
  });

  it("batas bucket 0–3, 4–7, 8–14, >14 benar", () => {
    const ledger = new StockLedger([
      { date: "2026-08-10", kg: D(1) },
      { date: "2026-08-07", kg: D(1) },
      { date: "2026-08-06", kg: D(1) },
      { date: "2026-08-02", kg: D(1) },
      { date: "2026-08-01", kg: D(1) },
      { date: "2026-07-26", kg: D(1) },
    ]);
    const buckets = ledger.buckets("2026-08-10", BUCKETS);
    // 0 hari; 3 hari; 4 hari; 8 hari; 9 hari; 15 hari
    expect(buckets.map((b) => b.toString())).toEqual(["2", "1", "2", "1"]);
  });

  it("menjual lebih banyak dari stok tidak membuat lapisan negatif", () => {
    const ledger = new StockLedger([{ date: "2026-08-01", kg: D(10) }]);
    const consumed = ledger.consume(15);
    expect(consumed.reduce((acc, c) => acc.plus(c.kg), D(0)).toString()).toBe("10");
    expect(ledger.total().toString()).toBe("0");
  });

  it("lapisan tetap terurut walau masuk lebih lambat dengan tanggal lama", () => {
    const ledger = new StockLedger();
    ledger.add("2026-08-05", 10);
    ledger.add("2026-08-01", 20);
    ledger.add("2026-08-03", 30);
    expect(ledger.snapshot().map((l) => l.date)).toEqual(["2026-08-01", "2026-08-03", "2026-08-05"]);
    const consumed = ledger.consume(25);
    expect(consumed.map((c) => `${c.date}:${c.kg.toString()}`)).toEqual(["2026-08-01:20", "2026-08-03:5"]);
  });
});
