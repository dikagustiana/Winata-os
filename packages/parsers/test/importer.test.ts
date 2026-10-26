import { describe, expect, it } from "vitest";
import { IMPORT_COLUMNS, parseCsv, parseImportCsv } from "../src/index";

const HEADER = IMPORT_COLUMNS.join(",");

function row(overrides: Record<string, string> = {}): string {
  const values: Record<string, string> = {
    tanggal: "2026-10-20",
    lokasi: "SLP",
    kandang: "SLP-1",
    grade: "UB",
    jenis: "produksi",
    qty: "100",
    satuan: "kg",
    nomor_do: "",
    pelanggan: "",
    catatan: "",
    ...overrides,
  };
  return IMPORT_COLUMNS.map((column) => values[column]).join(",");
}

const refs = {
  locations: new Set(["SLP", "CKL", "TSK"]),
  houses: new Set(["SLP-1", "SLP-2", "CKL-1"]),
  grades: new Set(["UB", "US", "UK", "RT", "PC"]),
  customers: new Set(["BKL-01", "AGN-01"]),
};

describe("T-17 importer R-50", () => {
  it("file 100 baris valid dimuat dengan sumber import", () => {
    const csv = [HEADER, ...Array.from({ length: 100 }, (_, i) => row({ tanggal: `2026-10-${String((i % 20) + 1).padStart(2, "0")}` }))].join("\n");
    const result = parseImportCsv(csv, refs);
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(100);
    expect(result.rows[0]).toMatchObject({ line: 2, date: "2026-10-01", locationCode: "SLP" });
    expect(result.rows[99].line).toBe(101);
  });

  it("satu baris salah menolak seluruh file dengan nomor baris dan alasan", () => {
    const rows = [HEADER, row(), row({ qty: "abc" }), row()];
    const result = parseImportCsv(rows.join("\n"), refs);
    expect(result.ok).toBe(false);
    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(3);
    expect(result.errors[0].message).toMatch(/Qty/);
  });

  it("header yang salah ditolak dengan daftar kolom yang benar", () => {
    const result = parseImportCsv(`tanggal,lokasi,grade\n2026-10-20,SLP,UB`);
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toMatch(/Header harus tepat/);
  });

  it("referensi lokasi/grade/pelanggan yang tidak ada ditolak", () => {
    const rows = [HEADER, row({ lokasi: "XXX", grade: "ZZ" }), row({ jenis: "keluar", nomor_do: "DO-1", pelanggan: "NOPE" })];
    const result = parseImportCsv(rows.join("\n"), refs);
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.message).join(" ")).toMatch(/Lokasi "XXX" tidak ada/);
    expect(result.errors.map((error) => error.message).join(" ")).toMatch(/Grade "ZZ" tidak ada/);
    expect(result.errors.map((error) => error.message).join(" ")).toMatch(/Pelanggan "NOPE" tidak ada/);
  });

  it("keluar wajib nomor DO; mutasi memakai pelanggan sebagai lokasi lawan", () => {
    const missingDo = parseImportCsv([HEADER, row({ jenis: "keluar", pelanggan: "BKL-01" })].join("\n"), refs);
    expect(missingDo.ok).toBe(false);
    expect(missingDo.errors[0].message).toMatch(/Nomor DO/);

    const mutasi = parseImportCsv(
      [HEADER, row({ jenis: "mutasi_keluar", pelanggan: "TSK", catatan: "kirim" })].join("\n"),
      refs,
    );
    expect(mutasi.ok).toBe(true);
  });

  it("CSV ber-kutip dan pemisah titik koma dibaca benar", () => {
    const csv = [IMPORT_COLUMNS.join(";"), "2026-10-20;SLP;SLP-1;UB;produksi;100;kg;;;"].join("\n");
    const parsed = parseCsv(csv);
    expect(parsed.rows[1]).toHaveLength(10);
    const result = parseImportCsv(csv, refs);
    expect(result.ok, `${JSON.stringify(result.errors)} | ${JSON.stringify(csv)}`).toBe(true);
  });
});
