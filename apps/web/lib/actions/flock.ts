"use server";

import { actionContext, done, fail, integer, isActionState, isoDate, optionalText, refresh, text } from "./common";
import type { ActionState } from "@/lib/action-types";
import type { AppRole } from "@winata/db";

const ROLES: AppRole[] = ["manager", "accounting", "admin"];

export async function saveFlockAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(ROLES);
    if (isActionState(ctx)) return ctx;
    const id = optionalText(form, "id");
    const houseId = text(form, "house_id");
    if (!houseId) return { error: "Kandang wajib dipilih." };
    const payload = {
      house_id: houseId,
      code: text(form, "code").toUpperCase(),
      strain: text(form, "strain"),
      chick_in_date: isoDate(form, "chick_in_date", "Tanggal chick-in")!,
      initial_birds: integer(form, "initial_birds", "Populasi awal"),
      status: text(form, "status") || "grower",
      production_start_date: isoDate(form, "production_start_date", "Tanggal mulai produksi", false),
      cull_date: isoDate(form, "cull_date", "Tanggal afkir", false),
      note: optionalText(form, "note"),
      updated_at: new Date().toISOString(),
    };
    if (!payload.code || !payload.strain) return { error: "Kode dan strain wajib diisi." };
    if (payload.initial_birds <= 0) return { error: "Populasi awal harus lebih dari 0." };
    const { error } = id
      ? await ctx.client.from("flock").update(payload).eq("id", id)
      : await ctx.client.from("flock").insert({ ...payload, created_by: ctx.viewer.id });
    if (error) return { error: error.message };
    refresh(["/flok", "/outlook", "/"]);
    return done("Flok tersimpan.");
  } catch (error) {
    return fail(error);
  }
}

export async function saveDepletionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(ROLES);
    if (isActionState(ctx)) return ctx;
    const flockId = text(form, "flock_id");
    const date = isoDate(form, "date", "Tanggal deplesi")!;
    const dead = integer(form, "dead", "Mati", 0);
    const culled = integer(form, "culled", "Afkir", 0);
    if (!flockId) return { error: "Flok wajib dipilih." };
    if (dead < 0 || culled < 0) return { error: "Jumlah tidak boleh negatif." };
    if (dead + culled === 0) return { error: "Isi jumlah mati atau afkir." };

    const existing = await ctx.client
      .from("flock_depletion")
      .select("id,dead,culled")
      .eq("flock_id", flockId)
      .eq("date", date)
      .is("deleted_at", null)
      .maybeSingle();

    if (existing.data) {
      const { error } = await ctx.client
        .from("flock_depletion")
        .update({ dead: Number(existing.data.dead) + dead, culled: Number(existing.data.culled) + culled, reason: optionalText(form, "reason"), updated_at: new Date().toISOString() })
        .eq("id", existing.data.id);
      if (error) return { error: error.message };
    } else {
      const { error } = await ctx.client.from("flock_depletion").insert({
        flock_id: flockId,
        date,
        dead,
        culled,
        reason: optionalText(form, "reason"),
        created_by: ctx.viewer.id,
      });
      if (error) return { error: error.message };
    }
    refresh(["/flok", "/outlook"]);
    return done("Deplesi tersimpan.");
  } catch (error) {
    return fail(error);
  }
}
