import { expect, test } from "@playwright/test";
import { USERS, dateShort, expectNoHorizontalScroll, login, todayJakarta } from "./helpers";

const MENUS: Array<{ role: keyof typeof USERS; items: string[]; forbidden: string; allowed: string }> = [
  { role: "kandang", items: ["Hari ini", "Hitung fisik"], forbidden: "/master", allowed: "/hari" },
  { role: "manager", items: ["Persetujuan", "Flok", "Outlook"], forbidden: "/admin", allowed: "/approve" },
  { role: "accounting", items: ["Rekon & kunci", "Flok", "Outlook", "Master"], forbidden: "/admin", allowed: "/master" },
  { role: "marketing", items: ["DO", "Rencana jual", "Outlook"], forbidden: "/master", allowed: "/do" },
  { role: "bod", items: ["Outlook"], forbidden: "/master", allowed: "/outlook" },
  { role: "admin", items: ["Master", "Admin"], forbidden: "/fisik/TIDAKADA", allowed: "/admin" },
];

const NAMES: Record<keyof typeof USERS, string> = {
  kandang: "Rahmat",
  manager: "Yayan",
  accounting: "Neng",
  marketing: "Iwan",
  bod: "BoD",
  admin: "Dika",
};

test.describe("T-06 login, menu per peran, 404 rute terlarang", () => {
  for (const entry of MENUS) {
    test(`${entry.role} melihat menu yang benar dan 404 di rute terlarang`, async ({ page, isMobile }) => {
      await login(page, USERS[entry.role]);
      await expect(page.getByRole("heading", { level: 1, name: "Posisi telur" })).toBeVisible();
      await expect(page.getByText(NAMES[entry.role], { exact: false }).first()).toBeVisible();

      if (!isMobile) {
        for (const item of entry.items) {
          await expect(page.getByRole("navigation", { name: "Menu utama" }).getByRole("link", { name: item })).toBeVisible();
        }
      } else {
        await expect(page.getByRole("navigation", { name: "Menu bawah" })).toBeVisible();
      }

      await page.goto(entry.allowed);
      await expect(page.locator("h1")).toBeVisible();

      await page.goto(entry.forbidden);
      await expect(page.getByText("Halaman tidak tersedia")).toBeVisible();
      await expect(page.getByRole("link", { name: "Kembali ke dashboard" })).toBeVisible();
    });
  }

  test("kata sandi salah ditolak", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(USERS.kandang);
    await page.getByLabel("Kata sandi").fill("salah-sekali");
    await page.getByRole("button", { name: "Masuk" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /salah/i })).toBeVisible();
  });

  test("e-mail di luar allow-list ditolak", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill("penyusup@example.com");
    await page.getByLabel("Kata sandi").fill("apa-saja-123");
    await page.getByRole("button", { name: "Masuk" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /salah/i })).toBeVisible();
  });
});

test.describe("T-06 tata letak 390 dan 1366 px tanpa scroll samping", () => {
  test("dashboard dan layar M0", async ({ page, isMobile }) => {
    const email = isMobile ? USERS.accounting : USERS.admin;
    await login(page, email);
    await expectNoHorizontalScroll(page);

    const routes = isMobile ? ["/", "/master", "/flok", "/rekon"] : ["/", "/master", "/flok", "/rekon", "/admin", "/outlook"];
    for (const route of routes) {
      await page.goto(route);
      await expect(page.locator("h1")).toBeVisible();
      await expectNoHorizontalScroll(page);
    }
  });
});

test.describe("Tanggal hari ini", () => {
  test("dashboard memakai tanggal WIB", async ({ page }) => {
    await login(page, USERS.kandang);
    // Tanggal WIB hari ini (bukan tanggal tetap, agar tes tidak kedaluwarsa).
    const today = todayJakarta();
    await expect(page.getByText(`${dateShort(today)} ${today.slice(0, 4)}`).first()).toBeVisible();
  });
});
