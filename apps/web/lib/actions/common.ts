import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { AppRole, DataClient, Viewer } from "@winata/db";
import { getWorkerDb } from "@/lib/cloud-db";
import { isMockAuth } from "@/lib/mock-mode";
import { requireViewer } from "@/lib/session";
import { parseIdNumber, requireNumber } from "@/lib/format";
import { viewerClient } from "@/lib/data";
import type { ActionState } from "@/lib/action-types";

export interface ActionContext {
  viewer: Viewer;
  client: DataClient;
}

/** Semua aksi memakai klien pengguna sehingga RLS tetap berlaku. */
export async function actionContext(roles?: AppRole[]): Promise<ActionContext | ActionState> {
  const viewer = await requireViewer();
  if (roles && !roles.includes(viewer.role)) {
    return { error: "Peran Anda tidak berhak melakukan tindakan ini." };
  }
  const client = await viewerClient(viewer);
  return { viewer, client };
}

export function isActionState(value: ActionContext | ActionState): value is ActionState {
  return "error" in value && typeof (value as ActionState).error === "string" && !("viewer" in value);
}

export function text(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

export function optionalText(form: FormData, name: string): string | null {
  const value = text(form, name);
  return value === "" ? null : value;
}

export function integer(form: FormData, name: string, label: string, fallback = 0): number {
  const raw = text(form, name);
  if (raw === "") return fallback;
  const parsed = parseIdNumber(raw);
  if (!parsed.ok) throw new Error(`${label}: ${parsed.error}`);
  if (!parsed.value.isInteger()) throw new Error(`${label} harus bilangan bulat.`);
  return parsed.value.toNumber();
}

export function decimalString(form: FormData, name: string, label: string, required = true): string | null {
  const raw = text(form, name);
  if (raw === "") {
    if (required) throw new Error(`${label} wajib diisi.`);
    return null;
  }
  const parsed = parseIdNumber(raw);
  if (!parsed.ok) throw new Error(`${label}: ${parsed.error}`);
  return parsed.value.toFixed(3);
}

export function moneyString(form: FormData, name: string, label: string, required = false): string | null {
  const raw = text(form, name);
  if (raw === "") {
    if (required) throw new Error(`${label} wajib diisi.`);
    return null;
  }
  const parsed = parseIdNumber(raw);
  if (!parsed.ok) throw new Error(`${label}: ${parsed.error}`);
  return parsed.value.toFixed(2);
}

export function isoDate(form: FormData, name: string, label: string, required = true): string | null {
  const value = text(form, name);
  if (value === "") {
    if (required) throw new Error(`${label} wajib diisi.`);
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
    throw new Error(`${label} bukan tanggal yang sah.`);
  }
  return value;
}

export function checkbox(form: FormData, name: string): boolean {
  return form.get(name) === "on" || form.get(name) === "true" || form.get(name) === "1";
}

export function fail(error: unknown): ActionState {
  const message = error instanceof Error ? error.message : String(error);
  return { error: message };
}

export function done(message: string): ActionState {
  return { ok: true, message };
}

/** Batas rebuild inline di aksi (R-74); lebih lama diserahkan ke antrean + cron. */
export const INLINE_REBUILD_MAX_DAYS = 7;

/**
 * Worker inline setelah perubahan (R-74): bangun ulang posisi lokasi dari
 * tanggal yang berubah (cloud: bila ≤ 7 hari ke belakang), lalu proyeksi dan kontrol.
 * Lokal memakai PGlite, cloud memakai pg (Queryable yang sama). Galat worker
 * tidak menggagalkan aksi: data sudah tersimpan dan antrean (trigger) menjamin
 * cron membangun ulang.
 */
export async function rebuildLocal(locationId: string, fromDate: string): Promise<void> {
  try {
    const { diffDays } = await import("@winata/engine");
    const { rebuildPositions, processControls, refreshProjection, todayJakarta } = await import("@winata/db");
    const today = todayJakarta();
    // Lokal (mock) tidak punya cron: selalu inline seperti v1.
    if (!isMockAuth() && diffDays(fromDate, today) > INLINE_REBUILD_MAX_DAYS) return;
    const db = await getWorkerDb();
    await rebuildPositions(db, { locationIds: [locationId], fromDate });
    await refreshProjection(db);
    await processControls(db, fromDate);
    if (today !== fromDate) await processControls(db, today);
  } catch (error) {
    console.error("rebuild inline gagal", error);
  }
}

export function refresh(paths: string[]): void {
  for (const path of paths) revalidatePath(path);
}

export function requireNumberField(form: FormData, name: string, label: string) {
  return requireNumber(text(form, name), label);
}

export function backTo(path: string): never {
  redirect(path);
}
