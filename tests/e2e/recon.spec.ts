import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { expect, test } from "@playwright/test";
import { card, login, USERS } from "./helpers";

const FIXTURES = path.join(process.cwd(), "fixtures", "accurate-example");

test.describe("T-51/T-54/T-62 Accurate, K8, BS 04A, Usulan Koreksi", () => {
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "journey desktop");
  });

  test("upload ditolak untuk item tanpa map, lalu berhasil setelah dipetakan", async ({ page }, testInfo) => {
    await login(page, USERS.accounting);
    await page.goto("/rekon?tab=accurate&period=2026-09");

    const unknownFile = testInfo.outputPath("unknown.csv");
    fs.writeFileSync(
      unknownFile,
      ["Tanggal,Kode Barang,Nama Barang,Satuan,Kuantitas,Jumlah", "2026-09-10,EGG-UNKNOWN,Telur Baru,kg,10,250000"].join("\n"),
      "utf8",
    );
    const salesCard = card(page, "Unggah penjualan Accurate");
    await salesCard.locator('input[type="file"]').setInputFiles(unknownFile);
    await salesCard.getByRole("button", { name: "Unggah penjualan" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /belum punya pemetaan/ }).first()).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: /EGG-UNKNOWN/ }).first()).toBeVisible();
  });

  test("upload 2 file → K8 tampil → tandai explained → ekspor BS 04A", async ({ page }, testInfo) => {
    await login(page, USERS.accounting);
    await page.goto("/rekon?tab=accurate&period=2026-09");

    const salesCard = card(page, "Unggah penjualan Accurate");
    await salesCard.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "sales.xlsx"));
    await salesCard.getByRole("button", { name: "Unggah penjualan" }).click();
    await expect(page.getByRole("status").filter({ hasText: /baris penjualan Accurate dimuat/ }).first()).toBeVisible();

    const stockCard = card(page, "Unggah persediaan Accurate");
    await stockCard.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "stock.xlsx"));
    await stockCard.getByRole("button", { name: "Unggah persediaan" }).click();
    await expect(page.getByRole("status").filter({ hasText: /baris persediaan Accurate dimuat/ }).first()).toBeVisible();

    await page.getByRole("button", { name: "Hitung rekonsiliasi" }).click();
    await expect(page.getByRole("status").filter({ hasText: /selisih ditemukan/ }).first()).toBeVisible();
    const items = card(page, "Selisih rekonsiliasi").locator("tbody tr");
    await expect(items.first()).toBeVisible();

    const firstRow = items.first();
    await firstRow.locator('select[name="status"]').selectOption("explained");
    await firstRow.locator('input[name="note"]').fill("selisih karena potongan timbangan");
    await firstRow.getByRole("button", { name: "Simpan status" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Status selisih diperbarui/ }).first()).toBeVisible();

    await page.goto("/rekon?tab=ekspor");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Unduh BS 04A" }).click(),
    ]);
    const target = testInfo.outputPath("bs04a.xlsx");
    await download.saveAs(target);
    const workbook = XLSX.read(fs.readFileSync(target), { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const values = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    const flat = values.flat().join(" ");
    expect(flat).toContain("BS 04A PERSEDIAAN TELUR");
    expect(flat).toContain("HPP sementara");
    expect(flat).toContain("Total");
  });

  test("rekonstruksi 30-06 mengekspor draft Usulan Koreksi seimbang dengan RS-05", async ({ page }, testInfo) => {
    await login(page, USERS.accounting);
    await page.goto("/rekonstruksi");
    await expect(page.getByRole("heading", { name: "Rekonstruksi posisi" })).toBeVisible();
    await expect(page.getByText("Draft Usulan Koreksi (Dr/Cr)")).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Unduh draft Usulan Koreksi (XLSX)" }).click(),
    ]);
    const target = testInfo.outputPath("usulan-koreksi.xlsx");
    await download.saveAs(target);
    const workbook = XLSX.read(fs.readFileSync(target), { type: "buffer" });
    expect(workbook.SheetNames).toContain("Usulan Koreksi");
    const sheet = workbook.Sheets["Usulan Koreksi"];
    const flat = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 }).flat().join(" ");
    expect(flat).toContain("RS-05");
    expect(flat).toContain("Seimbang");
    expect(flat).toContain("Persediaan Telur");
  });
});
