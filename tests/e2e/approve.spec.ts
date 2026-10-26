import { expect, test } from "@playwright/test";
import { addDays, card, dateShort, login, todayJakarta, USERS } from "./helpers";

test.describe("T-29 journey A: submit → approve → lock → koreksi", () => {
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "journey desktop");
  });

  test("kandang submit, manager approve, accounting lock, koreksi 8 juta", async ({ page, context }) => {
    const date = addDays(todayJakarta(), -4);

    await login(page, USERS.kandang);
    await page.goto(`/hari/SLP/${date}`);
    await card(page, "Produksi SLP-1").getByRole("textbox", { name: "UB · Utuh Besar" }).fill("60");
    await page.getByRole("button", { name: "Selesai hari ini" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Hari selesai/ }).first()).toBeVisible();

    await context.clearCookies();
    await login(page, USERS.manager);
    await page.goto("/approve");
    const approvalCard = page.locator("section").filter({ hasText: `SLP · ` }).filter({ hasText: dateShort(date) }).first();
    await approvalCard.getByRole("button", { name: "Setujui" }).click();
    await expect(page.getByText("Tidak ada hari yang menunggu persetujuan.")).toBeVisible();

    await context.clearCookies();
    await login(page, USERS.accounting);
    await page.goto("/rekon?tab=kunci");
    const lockRow = page.locator("tr").filter({ hasText: "SLP" }).filter({ hasText: dateShort(date) }).first();
    await lockRow.getByRole("button", { name: "Kunci" }).click();
    await expect(card(page, "Hari terkunci").locator("tr").filter({ hasText: dateShort(date) }).first()).toBeVisible();

    // Kandang tidak bisa mengubah hari terkunci.
    await context.clearCookies();
    await login(page, USERS.kandang);
    await page.goto(`/hari/SLP/${date}`);
    await expect(page.getByText(/Hari ini/).first()).toBeVisible();
    await expect(page.getByText("dikunci", { exact: false }).first()).toBeVisible();
    await expect(card(page, "Produksi SLP-1").getByRole("textbox", { name: "UB · Utuh Besar" })).toBeDisabled();

    // Koreksi 8 juta di hari terkunci (di bawah batas BoD 10 juta dan 2% stok).
    await context.clearCookies();
    await login(page, USERS.accounting);
    await page.goto("/rekon?tab=koreksi");
    const correctionCard = card(page, "Buat koreksi");
    await correctionCard.getByLabel("Lokasi").selectOption({ label: "SLP" });
    await correctionCard.getByLabel("Tanggal efektif").fill(date);
    await correctionCard.getByLabel("Grade").selectOption({ label: "UB" });
    await correctionCard.getByLabel("Kg (±)").fill("2");
    await correctionCard.getByLabel("Rp (±)").fill("8000000");
    await correctionCard.getByLabel("Alasan").fill("koreksi uji e2e");
    await correctionCard.getByRole("button", { name: "Simpan koreksi (draft)" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Koreksi draft dibuat/ }).first()).toBeVisible();

    const correctionRow = page.locator("tbody tr").filter({ hasText: "koreksi uji e2e" }).first();
    await correctionRow.getByRole("button", { name: "Posting" }).click();
    await expect(correctionRow.getByText("Posted")).toBeVisible();

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Posisi telur" })).toBeVisible();
    await expect(page.getByText("HPP sementara").first()).toBeVisible();
  });
});
