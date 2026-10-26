import { expect, test } from "@playwright/test";
import { addDays, card, login, todayJakarta, USERS } from "./helpers";

test.describe("T-36/T-43 outlook, rencana jual, kas 13 minggu", () => {
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "journey desktop");
  });

  test("order 5 hari ke depan menimbulkan kekurangan pasok; kas 13 minggu tampil", async ({ page, context }) => {
    const today = todayJakarta();
    const orderDate = addDays(today, 4);

    await login(page, USERS.marketing);
    await page.goto("/rencana");
    const planCard = card(page, "Tambah rencana");
    await planCard.getByLabel("Pelanggan").selectOption({ index: 1 });
    await planCard.getByLabel("Grade").selectOption({ label: "UB" });
    await planCard.getByLabel("Tanggal").fill(orderDate);
    await planCard.getByLabel("Jenis").selectOption({ label: "Order (komitmen)" });
    await planCard.getByLabel("Kg", { exact: true }).fill("100000");
    await planCard.getByLabel("Harga per kg").fill("26000");
    await planCard.getByRole("button", { name: "Simpan rencana" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Order tersimpan/ }).first()).toBeVisible();

    await page.goto("/outlook?tab=posisi");
    await expect(page.getByRole("heading", { name: "Outlook" })).toBeVisible();
    await expect(page.getByText("kekurangan").first()).toBeVisible();

    await context.clearCookies();
    await login(page, USERS.accounting);
    await page.goto("/rekon?tab=kas");

    const balanceCard = card(page, "Saldo awal kas");
    await balanceCard.getByLabel("Saldo awal Rp").fill("100000000");
    await balanceCard.getByRole("button", { name: "Simpan saldo" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Saldo awal kas tersimpan/ }).first()).toBeVisible();

    const cashCard = card(page, "Rencana kas");
    const monday = (() => {
      const date = new Date(`${today}T00:00:00Z`);
      const day = date.getUTCDay();
      date.setUTCDate(date.getUTCDate() + (day === 0 ? -6 : 1 - day));
      return date.toISOString().slice(0, 10);
    })();
    for (const [category, amount] of [
      ["pakan", "180000000"],
      ["gaji", "62000000"],
      ["listrik", "15000000"],
    ] as const) {
      await cashCard.getByLabel("Minggu (Senin)").fill(monday);
      await cashCard.getByLabel("Kategori").fill(category);
      await cashCard.getByLabel("Arah").selectOption({ label: "Keluar" });
      await cashCard.getByLabel("Jumlah Rp").fill(amount);
      await cashCard.getByRole("button", { name: "Tambah rencana" }).click();
      await expect(page.getByRole("status").filter({ hasText: /Rencana kas tersimpan/ }).first()).toBeVisible();
    }

    await page.goto("/outlook?tab=kas");
    await expect(page.getByText("Saldo terendah 13 minggu")).toBeVisible();
    const rows = card(page, "Kas 13 minggu").locator("tbody tr");
    await expect(rows).toHaveCount(13);
    await expect(page.getByText("Baris tebal = saldo terendah")).toBeVisible();
  });
});
