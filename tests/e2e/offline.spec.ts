import { expect, test, type Browser, type Page } from "@playwright/test";
import { addDays, card, dateShort, login, todayJakarta, USERS } from "./helpers";

async function draftExists(page: Page, key: string): Promise<boolean> {
  return page.evaluate(async (storageKey) => {
    return new Promise<boolean>((resolve) => {
      const request = indexedDB.open("winata-drafts", 1);
      request.onerror = () => resolve(false);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("drafts")) {
          resolve(false);
          return;
        }
        const transaction = db.transaction("drafts", "readonly");
        const get = transaction.objectStore("drafts").get(storageKey);
        get.onsuccess = () => resolve(Boolean(get.result));
        get.onerror = () => resolve(false);
      };
    });
  }, key);
}

async function loginInNewContext(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email);
  return { context, page };
}

test.describe("T-28 offline draft (K8)", () => {
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "journey desktop");
  });

  test("draft tersimpan saat offline dan terkirim saat online", async ({ page, context }) => {
    const date = addDays(todayJakarta(), -2);
    await login(page, USERS.kandang);
    await page.goto(`/hari/SLP/${date}`);
    await card(page, "Produksi SLP-1").getByRole("textbox", { name: "UB · Utuh Besar" }).fill("25");

    await context.setOffline(true);
    await page.getByRole("button", { name: "Simpan draft" }).click();
    await expect(page.getByText(/Tidak ada sinyal/).first()).toBeVisible();
    expect(await draftExists(page, `hari:SLP:${date}`)).toBe(true);

    await context.setOffline(false);
    await expect(page.getByRole("status").filter({ hasText: /baris produksi tersimpan/ }).first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Selesai hari ini" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Hari selesai/ }).first()).toBeVisible();
  });

  test("konflik: hari disetujui saat offline, draft tidak ditimpa", async ({ page, context, browser }) => {
    const date = addDays(todayJakarta(), -3);
    await login(page, USERS.kandang);
    await page.goto(`/hari/SLP/${date}`);
    await card(page, "Produksi SLP-1").getByRole("textbox", { name: "UB · Utuh Besar" }).fill("12");
    await context.setOffline(true);
    await page.getByRole("button", { name: "Simpan draft" }).click();
    await expect(page.getByText(/Tidak ada sinyal/).first()).toBeVisible();

    // Pengguna lain menyelesaikan dan menyetujui hari yang sama.
    const second = await loginInNewContext(browser, USERS.kandang);
    await second.page.goto(`/hari/SLP/${date}`);
    await card(second.page, "Produksi SLP-1").getByRole("textbox", { name: "UB · Utuh Besar" }).fill("12");
    await second.page.getByRole("button", { name: "Selesai hari ini" }).click();
    await expect(second.page.getByRole("status").filter({ hasText: /Hari selesai/ }).first()).toBeVisible();

    const manager = await loginInNewContext(browser, USERS.manager);
    await manager.page.goto("/approve");
    const approvalCard = manager.page
      .locator("section")
      .filter({ hasText: "SLP ·" })
      .filter({ hasText: dateShort(date) })
      .first();
    await approvalCard.getByRole("button", { name: "Setujui" }).click();
    await expect(approvalCard).toHaveCount(0);

    await context.setOffline(false);
    await expect(page.getByRole("alert").first()).toBeVisible({ timeout: 30_000 });
    expect(await draftExists(page, `hari:SLP:${date}`)).toBe(true);

    await second.context.close();
    await manager.context.close();
  });
});
