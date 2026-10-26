"use server";

import { D, resolveConversion, toKg, type Unit } from "@winata/engine";
import type { AppRole, GradeRow, LocationRow } from "@winata/db";
import {
  actionContext,
  done,
  fail,
  isActionState,
  isoDate,
  moneyString,
  optionalText,
  refresh,
  text,
  rebuildLocal,
} from "./common";
import { loadConversionVersions, nextDoNumber } from "@/lib/convert";
import { parseIdNumber } from "@/lib/format";
import type { ActionState } from "@/lib/action-types";

const DOC_ROLES: AppRole[] = ["marketing", "accounting", "admin"];
const HANDOVER_ROLES: AppRole[] = ["kandang", "accounting", "admin"];

export async function createOutboundAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(DOC_ROLES);
    if (isActionState(ctx)) return ctx;
    const locationId = text(form, "location_id");
    const customerId = text(form, "customer_id");
    const date = isoDate(form, "date", "Tanggal DO")!;
    if (!locationId || !customerId) return { error: "Lokasi dan pelanggan wajib diisi." };

    const location = ((await ctx.client
      .from("location")
      .select("id,code")
      .eq("id", locationId)
      .maybeSingle()).data as LocationRow | null);
    if (!location) return { error: "Lokasi tidak ditemukan." };

    let doNumber = text(form, "do_number");
    if (!doNumber) doNumber = await nextDoNumber(ctx.client, locationId, location.code, date);

    const grades = ((await ctx.client.from("grade").select("id,code").eq("active", true).order("sort")).data as GradeRow[]) ?? [];
    const versions = await loadConversionVersions(ctx.client, date);

    const lines: Array<{ grade_id: string; qty: string; unit: Unit; kg_doc: string; price_per_kg: string | null }> = [];
    for (const grade of grades) {
      const qtyRaw = text(form, `qty_${grade.id}`);
      if (qtyRaw === "") continue;
      const parsed = parseIdNumber(qtyRaw);
      if (!parsed.ok) return { error: `${grade.code}: ${parsed.error}` };
      if (parsed.value.lessThanOrEqualTo(0)) continue;
      const unit = (text(form, `unit_${grade.id}`) || "kg") as Unit;
      const kg = toKg({ qty: parsed.value.toFixed(3), unit, gradeId: grade.id, date }, resolveConversion(versions, grade.id, date));
      const price = moneyString(form, `price_${grade.id}`, `Harga ${grade.code}`, false);
      lines.push({ grade_id: grade.id, qty: parsed.value.toFixed(3), unit, kg_doc: kg.toFixed(3), price_per_kg: price });
    }
    if (lines.length === 0) return { error: "Isi minimal satu baris grade." };
    if (lines.some((line) => line.price_per_kg === null)) return { error: "Harga per kg wajib di setiap baris." };

    const { data: outbound, error } = await ctx.client
      .from("outbound")
      .insert({
        location_id: locationId,
        do_number: doNumber,
        customer_id: customerId,
        date,
        status: "draft",
        note: optionalText(form, "note"),
        created_by: ctx.viewer.id,
      })
      .select("id")
      .single();
    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        return { error: `Nomor DO ${doNumber} sudah dipakai di lokasi ini.` };
      }
      return { error: error.message };
    }

    const { error: lineError } = await ctx.client.from("outbound_line").insert(
      lines.map((line) => ({ ...line, outbound_id: outbound.id, created_by: ctx.viewer.id })),
    );
    if (lineError) {
      return { error: `DO dibuat tetapi baris gagal disimpan: ${lineError.message}` };
    }

    refresh(["/do", "/hari", "/"]);
    return done(`DO ${doNumber} dibuat (draft). Kandang akan mengonfirmasi serah.`);
  } catch (error) {
    return fail(error);
  }
}

export async function confirmHandoverAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(HANDOVER_ROLES);
    if (isActionState(ctx)) return ctx;
    const outboundId = text(form, "outbound_id");
    const outbound = await ctx.client
      .from("outbound")
      .select("id,location_id,date,status,do_number")
      .eq("id", outboundId)
      .maybeSingle();
    if (!outbound.data) return { error: "DO tidak ditemukan." };
    if (outbound.data.status !== "draft") return { error: "DO ini sudah diserahkan." };

    const lines = await ctx.client.from("outbound_line").select("id,kg_doc").eq("outbound_id", outboundId).is("deleted_at", null);
    for (const line of (lines.data as Array<{ id: string; kg_doc: string }>) ?? []) {
      const raw = text(form, `kg_${line.id}`);
      let kg = D(line.kg_doc);
      if (raw !== "") {
        const parsed = parseIdNumber(raw);
        if (!parsed.ok) return { error: parsed.error };
        kg = parsed.value;
      }
      if (kg.lessThan(0)) return { error: "Kg serah tidak boleh negatif." };
      const doc = D(line.kg_doc);
      if (doc.greaterThan(0) && kg.minus(doc).abs().dividedBy(doc).greaterThan(0.02)) {
        // Selisih > 2% tetap dicatat; K3 memberi tanda di kontrol.
      }
      const { error } = await ctx.client
        .from("outbound_line")
        .update({ kg_delivered: kg.toFixed(3), updated_at: new Date().toISOString() })
        .eq("id", line.id);
      if (error) return { error: error.message };
    }

    const { error } = await ctx.client
      .from("outbound")
      .update({
        status: "dikirim",
        delivered_at: new Date().toISOString(),
        delivered_by: ctx.viewer.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", outboundId);
    if (error) return { error: error.message };

    await rebuildLocal(outbound.data.location_id, outbound.data.date);
    refresh(["/hari", "/do", "/", "/approve"]);
    return done(`DO ${outbound.data.do_number} diserahkan; posisi berkurang.`);
  } catch (error) {
    return fail(error);
  }
}

export async function markReceivedAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(HANDOVER_ROLES);
    if (isActionState(ctx)) return ctx;
    const outboundId = text(form, "outbound_id");
    const outbound = await ctx.client.from("outbound").select("id,location_id,date").eq("id", outboundId).maybeSingle();
    if (!outbound.data) return { error: "DO tidak ditemukan." };
    const { error } = await ctx.client
      .from("outbound")
      .update({ status: "diterima", updated_at: new Date().toISOString() })
      .eq("id", outboundId);
    if (error) return { error: error.message };
    refresh(["/do", "/"]);
    return done("DO ditandai diterima pelanggan.");
  } catch (error) {
    return fail(error);
  }
}
