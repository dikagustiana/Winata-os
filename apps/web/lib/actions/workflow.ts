"use server";


import { actionContext, done, fail, isActionState, isoDate, optionalText, refresh, text, rebuildLocal } from "./common";
import { parseIdNumber } from "@/lib/format";
import type { ActionState } from "@/lib/action-types";
import { CANCEL_REASON_REQUIRED } from "@/lib/errors";

export async function approveDayAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(["manager", "admin"]);
    if (isActionState(ctx)) return ctx;
    const locationId = text(form, "location_id");
    const date = isoDate(form, "date", "Tanggal")!;
    await rebuildLocal(locationId, date);
    const result = await ctx.client.rpc("approve_day", { p_location: locationId, p_date: date });
    if (result.error) return { error: result.error.message };
    refresh(["/approve", "/rekon", "/"]);
    return done("Hari disetujui.");
  } catch (error) {
    return fail(error);
  }
}

export async function returnDayAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(["manager", "admin"]);
    if (isActionState(ctx)) return ctx;
    const locationId = text(form, "location_id");
    const date = isoDate(form, "date", "Tanggal")!;
    const reason = optionalText(form, "reason") ?? "";
    if (reason.trim().length < 5) return { error: "Alasan pengembalian minimal 5 karakter." };
    const result = await ctx.client.rpc("return_day", { p_location: locationId, p_date: date, p_reason: reason });
    if (result.error) return { error: result.error.message };
    refresh(["/approve", "/hari", "/"]);
    return done("Hari dikembalikan ke kandang.");
  } catch (error) {
    return fail(error);
  }
}

export async function lockDayAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(["accounting", "admin"]);
    if (isActionState(ctx)) return ctx;
    const locationId = text(form, "location_id");
    const date = isoDate(form, "date", "Tanggal")!;
    await rebuildLocal(locationId, date);
    const result = await ctx.client.rpc("lock_day", { p_location: locationId, p_date: date });
    if (result.error) return { error: result.error.message };
    refresh(["/rekon", "/", "/approve"]);
    return done("Hari dikunci.");
  } catch (error) {
    return fail(error);
  }
}

export async function createCorrectionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(["accounting", "admin"]);
    if (isActionState(ctx)) return ctx;
    const locationId = text(form, "location_id");
    const gradeId = text(form, "grade_id");
    const date = isoDate(form, "effective_date", "Tanggal efektif")!;
    const reason = optionalText(form, "reason") ?? "";
    if (!locationId || !gradeId) return { error: "Lokasi dan grade wajib diisi." };
    if (reason.length < 5) return { error: "Alasan koreksi minimal 5 karakter." };
    const kgParsed = parseIdNumber(text(form, "kg") || "0");
    if (!kgParsed.ok) return { error: `Kg: ${kgParsed.error}` };
    const rpParsed = parseIdNumber(text(form, "amount_rp") || "0");
    if (!rpParsed.ok) return { error: `Rp: ${rpParsed.error}` };
    if (kgParsed.value.isZero() && rpParsed.value.isZero()) return { error: "Isi kg atau Rp koreksi." };

    const { error } = await ctx.client.from("correction").insert({
      location_id: locationId,
      effective_date: date,
      grade_id: gradeId,
      kg: kgParsed.value.toFixed(3),
      amount_rp: rpParsed.value.toFixed(2),
      reason,
      attachment_path: optionalText(form, "attachment_path"),
      status: "draft",
      ref: optionalText(form, "ref"),
      created_by: ctx.viewer.id,
    });
    if (error) return { error: error.message };
    refresh(["/rekon", "/"]);
    return done("Koreksi draft dibuat. Posting menunggu persetujuan bila melewati batas BoD.");
  } catch (error) {
    return fail(error);
  }
}

export async function postCorrectionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(["accounting", "admin"]);
    if (isActionState(ctx)) return ctx;
    const id = text(form, "correction_id");
    const result = await ctx.client.rpc("post_correction", { p_correction: id });
    if (result.error) return { error: result.error.message };
    const correction = await ctx.client.from("correction").select("location_id,effective_date").eq("id", id).maybeSingle();
    if (correction.data) await rebuildLocal(correction.data.location_id, correction.data.effective_date);
    refresh(["/rekon", "/", "/approve"]);
    return done("Koreksi diposting dan posisi dibangun ulang.");
  } catch (error) {
    return fail(error);
  }
}

export async function approveCorrectionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(["bod"]);
    if (isActionState(ctx)) return ctx;
    const id = text(form, "correction_id");
    const result = await ctx.client.rpc("approve_correction", { p_correction: id });
    if (result.error) return { error: result.error.message };
    refresh(["/rekon"]);
    return done("Koreksi disetujui BoD; accounting dapat memposting.");
  } catch (error) {
    return fail(error);
  }
}

export async function decideCorrectionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const role = text(form, "role");
  if (role === "bod") return approveCorrectionAction(_prev, form);
  return postCorrectionAction(_prev, form);
}

/** R-63/K11: koreksi dibatalkan (deleted_at + alasan); posted wajib alasan ≥ 10 karakter. */
export async function cancelCorrectionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(["accounting", "admin"]);
    if (isActionState(ctx)) return ctx;
    const id = text(form, "correction_id");
    const reason = optionalText(form, "delete_reason");
    const correction = await ctx.client
      .from("correction")
      .select("id,status,location_id,effective_date")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!correction.data) return { error: "Koreksi tidak ditemukan." };
    if (correction.data.status === "posted" && (reason ?? "").length < 10) return { error: CANCEL_REASON_REQUIRED };
    const { error } = await ctx.client
      .from("correction")
      .update({ deleted_at: new Date().toISOString(), delete_reason: reason })
      .eq("id", id);
    if (error) return { error: error.message };
    if (correction.data.status === "posted") {
      await rebuildLocal(correction.data.location_id, correction.data.effective_date);
    }
    refresh(["/rekon", "/"]);
    return done("Koreksi dibatalkan; data tetap tersimpan dengan jejak.");
  } catch (error) {
    return fail(error);
  }
}
