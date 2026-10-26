import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../../packages/db/test/pglite";

/**
 * T-27 (versi statis): dashboard hanya boleh membaca position_daily,
 * control_result, day_status, dan master. Halaman tidak boleh query tabel
 * transaksi. Uji runtime dengan spy klien tidak dipakai karena halaman adalah
 * React Server Component; lihat docs/log/M2.md.
 */
describe("T-27 dashboard tidak membaca tabel transaksi", () => {
  const source = fs.readFileSync(path.join(ROOT, "apps", "web", "app", "(app)", "page.tsx"), "utf8");

  it("membaca position_daily dan control_result", () => {
    expect(source).toContain('.from("position_daily")');
    expect(source).toContain('.from("control_result")');
  });

  it("tidak membaca production/outbound/transfer/shrinkage/opname", () => {
    for (const table of ["production", "outbound", "outbound_line", "transfer", "shrinkage", "opname", "physical_count", "correction"]) {
      expect(source, `dashboard membaca tabel ${table}`).not.toContain(`.from("${table}")`);
    }
  });
});
