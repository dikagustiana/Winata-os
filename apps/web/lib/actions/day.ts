"use server";

import { D, resolveConversion, toKg, type Unit } from "@winata/engine";
import type { GradeRow, HouseRow } from "@winata/db";
import {
  actionContext,
  done,
  fail,
  isActionState,
  isoDate,
  optionalText,
  refresh,
  text,
  rebuildLocal,
} from "./common";
import { loadConversionVersions } from "@/lib/convert";
import { parseIdNumber } from "@/lib/format";
import type { ActionState } from "@/lib/action-types";
import type { AppRole } from "@winata/db";

const DAY_ROLES: AppRole[] = ["kandang", "accounting", "admin"];

export async function saveDayAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(DAY_ROLES);
    if (isActionState(ctx)) return ctx;
    const locationId = text(form, "location_id");
    const date = isoDate(form, "date", "Tanggal")!;
    const intent = text(form, "intent") || "save";
    if (!locationId) return { error: "Lokasi tidak dikenal." };

    const grades = ((await ctx.client.from("grade").select("id,code").eq("active", true).order("sort")).data as GradeRow[]) ?? [];
    const houses = ((await ctx.client.from("house").select("id,code,location_id").eq("location_id", locationId).eq("active", true)).data as HouseRow[]) ?? [];
    const versions = await loadConversionVersions(ctx.client, date);

    let saved = 0;
    for (const house of houses) {
      for (const grade of grades) {
        const qtyRaw = text(form, `qty_${house.id}_${grade.id}`);
        const unit = (text(form, `unit_${house.id}_${grade.id}`) || "kg") as Unit;
        const existing = await ctx.client
          .from("production")
          .select("id,kg")
          .eq("house_id", house.id)
          .eq("date", date)
          .eq("grade_id", grade.id)
          .is("deleted_at", null)
          .maybeSingle();

        if (qtyRaw === "") continue;
        const parsed = parseIdNumber(qtyRaw);
        if (!parsed.ok) return { error: `${house.code} ${grade.code}: ${parsed.error}` };

        if (parsed.value.lessThanOrEqualTo(0)) {
          if (existing.data) {
            const { error } = await ctx.client
              .from("production")
              .update({ qty: "0", kg: "0", deleted_at: new Date().toISOString() })
              .eq("id", existing.data.id);
            if (error) return { error: error.message };
            saved += 1;
          }
          continue;
        }

        const kg = toKg({ qty: parsed.value.toFixed(3), unit, gradeId: grade.id, date }, resolveConversion(versions, grade.id, date));
        const payload = { qty: parsed.value.toFixed(3), unit, kg: kg.toFixed(3), updated_at: new Date().toISOString() };
        const { error } = existing.data
          ? await ctx.client.from("production").update(payload).eq("id", existing.data.id)
          : await ctx.client.from("production").insert({
              ...payload,
              location_id: locationId,
              house_id: house.id,
              date,
              grade_id: grade.id,
              created_by: ctx.viewer.id,
            });
        if (error) return { error: error.message };
        saved += 1;
      }
    }

    await rebuildLocal(locationId, date);

    if (intent === "submit") {
      const result = await ctx.client.rpc("submit_day", { p_location: locationId, p_date: date });
      if (result.error) {
        refresh(["/", "/approve"]);
        return { error: result.error.message, conflict: true };
      }
      refresh(["/", "/approve", "/rekon"]);
      return done("Hari selesai. Menunggu persetujuan manager.");
    }

    refresh(["/", "/approve", `/hari`]);
    return done(saved > 0 ? `${saved} baris produksi tersimpan.` : "Tidak ada perubahan produksi.");
  } catch (error) {
    return fail(error);
  }
}

export async function saveShrinkageAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(DAY_ROLES);
    if (isActionState(ctx)) return ctx;
    const locationId = text(form, "location_id");
    const date = isoDate(form, "date", "Tanggal")!;
    const gradeId = text(form, "grade_id");
    const kind = text(form, "kind");
    const reason = optionalText(form, "reason");
    if (!locationId || !gradeId) return { error: "Lokasi dan grade wajib diisi." };
    if (!["pecah", "afkir_telur", "konsumsi", "sampel", "lain"].includes(kind)) return { error: "Jenis susut tidak dikenal." };
    const parsed = parseIdNumber(text(form, "qty"));
    if (!parsed.ok || parsed.value.lessThanOrEqualTo(0)) return { error: parsed.ok ? "Qty harus lebih dari 0." : parsed.error };
    const unit = (text(form, "unit") || "kg") as Unit;
    const versions = await loadConversionVersions(ctx.client, date);
    const grade = ((await ctx.client.from("grade").select("id,code").eq("id", gradeId).maybeSingle()).data as GradeRow | null);
    if (!grade) return { error: "Grade tidak ditemukan." };
    const kg = toKg({ qty: parsed.value.toFixed(3), unit, gradeId, date }, resolveConversion(versions, gradeId, date));

    const { error } = await ctx.client.from("shrinkage").insert({
      location_id: locationId,
      date,
      grade_id: gradeId,
      kg: kg.toFixed(3),
      kind,
      reason,
      created_by: ctx.viewer.id,
    });
    if (error) return { error: error.message };
    await rebuildLocal(locationId, date);
    refresh(["/", "/approve", "/hari"]);
    return done(`Susut ${kg.toFixed(1)} kg tersimpan.`);
  } catch (error) {
    return fail(error);
  }
}

export async function sendTransferAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(DAY_ROLES);
    if (isActionState(ctx)) return ctx;
    const fromId = text(form, "from_location_id");
    const toId = text(form, "to_location_id");
    const gradeId = text(form, "grade_id");
    const date = isoDate(form, "sent_date", "Tanggal kirim")!;
    const note = optionalText(form, "note");
    if (!fromId || !toId || !gradeId) return { error: "Lokasi asal, tujuan, dan grade wajib diisi." };
    if (fromId === toId) return { error: "Lokasi asal dan tujuan tidak boleh sama." };
    const parsed = parseIdNumber(text(form, "qty"));
    if (!parsed.ok || parsed.value.lessThanOrEqualTo(0)) return { error: parsed.ok ? "Qty harus lebih dari 0." : parsed.error };
    const unit = (text(form, "unit") || "kg") as Unit;
    const versions = await loadConversionVersions(ctx.client, date);
    const kg = toKg({ qty: parsed.value.toFixed(3), unit, gradeId, date }, resolveConversion(versions, gradeId, date));

    const { error } = await ctx.client.from("transfer").insert({
      from_location_id: fromId,
      to_location_id: toId,
      grade_id: gradeId,
      kg: kg.toFixed(3),
      sent_date: date,
      status: "in_transit",
      note,
      created_by: ctx.viewer.id,
    });
    if (error) return { error: error.message };
    await rebuildLocal(fromId, date);
    await rebuildLocal(toId, date);
    refresh(["/", "/hari", "/approve"]);
    return done(`Mutasi ${kg.toFixed(1)} kg dikirim; tampil "di jalan" sampai diterima.`);
  } catch (error) {
    return fail(error);
  }
}

export async function receiveTransferAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(DAY_ROLES);
    if (isActionState(ctx)) return ctx;
    const transferId = text(form, "transfer_id");
    const receivedDate = isoDate(form, "received_date", "Tanggal terima")!;
    const transfer = await ctx.client
      .from("transfer")
      .select("id,from_location_id,to_location_id,sent_date")
      .eq("id", transferId)
      .maybeSingle();
    if (!transfer.data) return { error: "Mutasi tidak ditemukan." };
    if (receivedDate < transfer.data.sent_date) return { error: "Tanggal terima tidak boleh sebelum tanggal kirim." };
    const { error } = await ctx.client
      .from("transfer")
      .update({ status: "received", received_date: receivedDate, updated_at: new Date().toISOString() })
      .eq("id", transferId);
    if (error) return { error: error.message };
    await rebuildLocal(transfer.data.to_location_id, transfer.data.sent_date);
    await rebuildLocal(transfer.data.from_location_id, transfer.data.sent_date);
    refresh(["/", "/hari", "/approve"]);
    return done("Mutasi diterima.");
  } catch (error) {
    return fail(error);
  }
}

/** Dipakai halaman approve/lock untuk memastikan posisi terbaru sebelum kontrol K2/K4. */
export async function ensurePositions(locationId: string, date: string): Promise<void> {
  await rebuildLocal(locationId, date);
}

export async function assertPositive(value: string, message: string): Promise<string> {
  return D(value).greaterThan(0) ? value : message;
}
