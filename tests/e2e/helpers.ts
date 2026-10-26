import { expect, type Page } from "@playwright/test";

export const PASSWORD = "winata123";

export const USERS = {
  kandang: "kandang.slp@winata.test",
  kandangCkl: "kandang.ckl@winata.test",
  manager: "manager@winata.test",
  accounting: "accounting@winata.test",
  marketing: "marketing@winata.test",
  bod: "bod@winata.test",
  admin: "dika.g.irawan@gmail.com",
} as const;

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Kata sandi").fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL("http://127.0.0.1:3100/");
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: "Keluar" }).click();
  await page.waitForURL("**/login");
}

export function todayJakarta(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const MONTHS = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];

export function dateShort(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(2);
}

export function card(page: Page, label: string) {
  return page.locator(`section[aria-label="${label}"]`);
}

export async function expectMessage(page: Page, pattern: RegExp) {
  await expect(page.getByRole("status").filter({ hasText: pattern }).first()).toBeVisible({ timeout: 20_000 });
}

export async function expectError(page: Page, pattern: RegExp) {
  await expect(page.getByRole("alert").filter({ hasText: pattern }).first()).toBeVisible({ timeout: 20_000 });
}
