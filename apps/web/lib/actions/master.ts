"use server";

import { z } from "zod";
import {
  actionContext,
  checkbox,
  decimalString,
  done,
  fail,
  integer,
  isActionState,
  optionalText,
  refresh,
  text,
  isoDate,
} from "./common";
import type { ActionState } from "@/lib/action-types";

const ROLES = ["accounting", "admin"] as const;

const locationSchema = z.object({
  code: z.string().min(2).max(10).regex(/^[A-Z0-9-]+$/, "Kode lokasi huruf besar/angka."),
  name: z.string().min(2),
  kind: z.enum(["kandang", "gudang"]),
});

export async function saveLocationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext([...ROLES]);
    if (isActionState(ctx)) return ctx;
    const parsed = locationSchema.safeParse({ code: text(form, "code").toUpperCase(), name: text(form, "name"), kind: text(form, "kind") });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const id = optionalText(form, "id");
    const payload = {
      ...parsed.data,
      active: checkbox(form, "active"),
      updated_at: new Date().toISOString(),
    };
    const { error } = id
      ? await ctx.client.from("location").update(payload).eq("id", id)
      : await ctx.client.from("location").insert({ ...payload, created_by: ctx.viewer.id });
    if (error) return { error: error.message };
    refresh(["/master", "/"]);
    return done("Lokasi tersimpan.");
  } catch (error) {
    return fail(error);
  }
}

export async function saveHouseAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext([...ROLES]);
    if (isActionState(ctx)) return ctx;
    const id = optionalText(form, "id");
    const payload = {
      location_id: text(form, "location_id"),
      code: text(form, "code").toUpperCase(),
      name: text(form, "name"),
      capacity_birds: text(form, "capacity_birds") ? integer(form, "capacity_birds", "Kapasitas") : null,
      active: checkbox(form, "active"),
      updated_at: new Date().toISOString(),
    };
    if (!payload.code || !payload.name || !payload.location_id) return { error: "Lokasi, kode, dan nama wajib diisi." };
    const { error } = id
      ? await ctx.client.from("house").update(payload).eq("id", id)
      : await ctx.client.from("house").insert({ ...payload, created_by: ctx.viewer.id });
    if (error) return { error: error.message };
    refresh(["/master", "/flok"]);
    return done("Kandang tersimpan.");
  } catch (error) {
    return fail(error);
  }
}

export async function saveGradeAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext([...ROLES]);
    if (isActionState(ctx)) return ctx;
    const id = optionalText(form, "id");
    const payload = {
      code: text(form, "code").toUpperCase(),
      name: text(form, "name"),
      sort: integer(form, "sort", "Urutan", 1),
      is_saleable: checkbox(form, "is_saleable"),
      active: checkbox(form, "active"),
      updated_at: new Date().toISOString(),
    };
    if (!payload.code || !payload.name) return { error: "Kode dan nama grade wajib diisi." };
    const { error } = id
      ? await ctx.client.from("grade").update(payload).eq("id", id)
      : await ctx.client.from("grade").insert({ ...payload, created_by: ctx.viewer.id });
    if (error) return { error: error.message };
    refresh(["/master", "/"]);
    return done("Grade tersimpan.");
  } catch (error) {
    return fail(error);
  }
}

export async function saveConversionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext([...ROLES]);
    if (isActionState(ctx)) return ctx;
    const payload = {
      grade_id: text(form, "grade_id"),
      valid_from: isoDate(form, "valid_from", "Berlaku dari")!,
      kg_per_crate: decimalString(form, "kg_per_crate", "Kg per peti", false),
      kg_per_tray: decimalString(form, "kg_per_tray", "Kg per tray", false),
      eggs_per_kg: decimalString(form, "eggs_per_kg", "Butir per kg", false),
      source: text(form, "source") || "manual",
    };
    if (!payload.grade_id) return { error: "Grade wajib dipilih." };
    if (!payload.kg_per_crate && !payload.kg_per_tray && !payload.eggs_per_kg) {
      return { error: "Isi minimal satu nilai konversi." };
    }
    const existing = await ctx.client
      .from("unit_conversion")
      .select("id")
      .eq("grade_id", payload.grade_id)
      .eq("valid_from", payload.valid_from)
      .maybeSingle();
    const { error } = existing.data
      ? await ctx.client.from("unit_conversion").update(payload).eq("id", existing.data.id)
      : await ctx.client.from("unit_conversion").insert({ ...payload, created_by: ctx.viewer.id });
    if (error) return { error: error.message };
    refresh(["/master", "/hari", "/fisik"]);
    return done("Konversi tersimpan (versi per tanggal).");
  } catch (error) {
    return fail(error);
  }
}

export async function saveCustomerAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext([...ROLES, "marketing"]);
    if (isActionState(ctx)) return ctx;
    const id = optionalText(form, "id");
    const payload = {
      code: text(form, "code").toUpperCase(),
      name: text(form, "name"),
      kind: text(form, "kind") || "lain",
      is_related_party: checkbox(form, "is_related_party"),
      payment_terms_days: integer(form, "payment_terms_days", "Termin", 0),
      updated_at: new Date().toISOString(),
    };
    if (!payload.code || !payload.name) return { error: "Kode dan nama pelanggan wajib diisi." };
    const { error } = id
      ? await ctx.client.from("customer").update(payload).eq("id", id)
      : await ctx.client.from("customer").insert({ ...payload, created_by: ctx.viewer.id });
    if (error) return { error: error.message };
    refresh(["/master", "/do", "/rencana", "/outlook"]);
    return done("Pelanggan tersimpan.");
  } catch (error) {
    return fail(error);
  }
}

export async function saveParameterAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext([...ROLES]);
    if (isActionState(ctx)) return ctx;
    const key = text(form, "key");
    const rawValue = text(form, "value");
    const validFrom = isoDate(form, "valid_from", "Berlaku dari")!;
    if (!key) return { error: "Kunci parameter wajib diisi." };
    let value: unknown;
    try {
      value = JSON.parse(rawValue);
    } catch {
      return { error: "Nilai harus JSON yang sah (contoh: 5, \"20:00\", atau [3,7,14])." };
    }
    const existing = await ctx.client
      .from("parameter")
      .select("id")
      .eq("key", key)
      .eq("valid_from", validFrom)
      .maybeSingle();
    const payload = { key, value, valid_from: validFrom, note: optionalText(form, "note") };
    const { error } = existing.data
      ? await ctx.client.from("parameter").update(payload).eq("id", existing.data.id)
      : await ctx.client.from("parameter").insert({ ...payload, created_by: ctx.viewer.id });
    if (error) return { error: error.message };
    refresh(["/master", "/admin", "/"]);
    return done("Parameter tersimpan.");
  } catch (error) {
    return fail(error);
  }
}
