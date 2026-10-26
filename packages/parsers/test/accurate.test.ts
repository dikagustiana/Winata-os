import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAccurateSales, parseAccurateStock } from "../src/index";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../../../fixtures/accurate-example");
const golden = JSON.parse(fs.readFileSync(path.join(dir, "golden.json"), "utf8"));
const salesBuffer = fs.readFileSync(path.join(dir, "sales.xlsx"));
const stockBuffer = fs.readFileSync(path.join(dir, "stock.xlsx"));

describe("T-50 parser ekspor Accurate (sintetis)", () => {
  it("Sales by Item Detail: jumlah baris dan Σ kg/Rp sama", () => {
    const result = parseAccurateSales(salesBuffer);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.lines).toHaveLength(golden.sales.rows);
    expect(result.lines.reduce((acc, line) => acc + line.qty, 0)).toBe(golden.sales.totalKg);
    expect(result.lines.reduce((acc, line) => acc + line.amountRp, 0)).toBe(golden.sales.totalRp);
    expect(result.itemCodes).toEqual([...golden.sales.itemCodes].sort());
  });

  it("Inventory Valuation: jumlah baris dan Σ kg/Rp sama", () => {
    const result = parseAccurateStock(stockBuffer);
    expect(result.errors).toEqual([]);
    expect(result.lines).toHaveLength(golden.stock.rows);
    expect(result.lines.reduce((acc, line) => acc + line.qty, 0)).toBe(golden.stock.totalKg);
    expect(result.lines.reduce((acc, line) => acc + line.amountRp, 0)).toBe(golden.stock.totalRp);
  });

  it("kolom yang hilang menolak file dengan pesan jelas", () => {
    const csv = "Tanggal;Kode Barang;Satuan\n2026-09-01;EGG-UB;kg";
    const result = parseAccurateSales(csv);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/Kolom wajib/);
  });

  it("urutan kolom berbeda tetap terbaca (header-based)", () => {
    const csv = [
      "Kode Barang,Nama Barang,Satuan,Kuantitas,Nilai",
      "EGG-UB,Telur Utuh Besar,kg,10,174190",
    ].join("\n");
    const result = parseAccurateStock(csv);
    expect(result.ok).toBe(true);
    expect(result.lines[0]).toMatchObject({ itemCode: "EGG-UB", qty: 10, amountRp: 174190 });
  });
});
