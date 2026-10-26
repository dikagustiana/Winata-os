import { expect, test } from "@playwright/test";
import { addDays, card, login, todayJakarta, USERS } from "./helpers";

test.describe("T-19 journey H: hari kandang", () => {
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "journey desktop");
  });

  test("marketing buat DO, kandang isi produksi, susut, serah DO, mutasi, selesai hari", async ({ page, context }) => {
    const date = addDays(todayJakarta(), -1);

    // 1. Marketing membuat DO draft untuk SLP.
    await login(page, USERS.marketing);
    await page.goto("/do");
    const doCard = card(page, "DO baru");
    await doCard.getByLabel("Lokasi asal").selectOption({ label: "SLP · Salopa" });
    await doCard.getByLabel("Pelanggan").selectOption({ index: 1 });
    await doCard.getByLabel("Tanggal").fill(date);
    await doCard.getByRole("textbox", { name: "UB · Utuh Besar" }).fill("50");
    await doCard.getByLabel("Harga/kg UB").fill("26000");
    await doCard.getByRole("button", { name: "Simpan DO (draft)" }).click();
    await expect(page.getByRole("status").filter({ hasText: /DO .* dibuat/ }).first()).toBeVisible();

    // 2. Kandang membuka hari.
    await context.clearCookies();
    await login(page, USERS.kandang);
    await page.goto(`/hari/SLP/${date}`);

    // 3. Produksi 3 grade di SLP-1.
    const slp1 = card(page, "Produksi SLP-1");
    await slp1.getByRole("textbox", { name: "UB · Utuh Besar" }).fill("100");
    await slp1.getByRole("textbox", { name: "US · Utuh Sedang" }).fill("40");
    await slp1.getByRole("textbox", { name: "UK · Utuh Kecil" }).fill("10");
    await page.getByRole("button", { name: "Simpan draft" }).click();
    await expect(page.getByRole("status").filter({ hasText: /baris produksi tersimpan/ }).first()).toBeVisible();

    // 4. Susut pecah.
    const susut = card(page, "Susut, pecah, sampel");
    await susut.getByLabel("Grade").selectOption({ label: "PC" });
    await susut.getByLabel("Jenis").selectOption({ label: "Pecah" });
    await susut.getByRole("textbox", { name: "Jumlah" }).fill("2");
    await susut.getByRole("button", { name: "Tambah susut" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Susut .* tersimpan/ }).first()).toBeVisible();

    // 5. Konfirmasi serah DO.
    const doSection = card(page, "DO & serah");
    await doSection.getByRole("button", { name: "Sudah diserahkan" }).first().click();
    await expect(doSection.getByText("Dikirim").first()).toBeVisible();

    // 6. Mutasi ke TSK.
    const mutasi = card(page, "Mutasi keluar");
    await mutasi.getByLabel("Tujuan").selectOption({ label: "TSK · Gudang Tasik" });
    await mutasi.getByLabel("Grade").selectOption({ label: "UB" });
    await mutasi.getByRole("textbox", { name: "Jumlah" }).fill("10");
    await mutasi.getByRole("button", { name: "Kirim mutasi" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Mutasi .*dikirim/ }).first()).toBeVisible();

    // 7. Ringkasan hari berubah sesuai angka.
    await page.reload();
    const summary = card(page, "Ringkasan hari per grade");
    const ubRow = summary.locator("tbody tr").filter({ hasText: "UB" }).first();
    await expect(ubRow).toContainText("100,0");

    // 8. Selesai hari.
    await page.getByRole("button", { name: "Selesai hari ini" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Hari selesai/ }).first()).toBeVisible();
    await expect(page.getByText("Menunggu persetujuan manager")).toBeVisible();

    // 9. Dashboard memperlihatkan posisi.
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Posisi telur" })).toBeVisible();
    await expect(page.getByText("Posisi per lokasi dan grade")).toBeVisible();
  });
});
