"use server";

import { D, resolveConversion, toKg, type Unit } from "@winata/engine";
import { parseAccurateSales, parseAccurateStock, parseImportCsv, type ImportRefs } from "@winata/parsers";
import type { AppRole, CustomerRow, GradeRow, HouseRow, ItemMapRow, LocationRow } from "@winata/db";
import {
  actionContext,
  done,
  fail,
  isActionState,
  optionalText,
  refresh,
  text,
} from "./common";
import { loadConversionVersions } from "@/lib/convert";
import { parseIdNumber } from "@/lib/format";
import { getWorkerDb } from "@/lib/cloud-db";
import type { ActionState } from "@/lib/action-types";

const ROLES: AppRole[] = ["accounting", "admin"];

/**
 * Setelah impor massal: proses antrean yang diisi trigger (from_date terkecil
 * per lokasi), lalu proyeksi dan kontrol. Sisa antrean diambil cron.
 */
async function runBulkWorker(): Promise<void> {
  try {
    const { processRebuildQueue, refreshProjection, processControls, todayJakarta } = await import("@winata/db");
    const db = await getWorkerDb();
    await processRebuildQueue(db, 10);
    await refreshProjection(db);
    await processControls(db, todayJakarta());
  } catch (error) {
    console.error("worker bulk gagal", error);
  }
}

export async function importCsvAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(ROLES);
    if (isActionState(ctx)) return ctx;
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Pilih berkas CSV terlebih dahulu." };
    const content = await file.text();

    const locations = ((await ctx.client.from("location").select("id,code,name").is("deleted_at", null)).data as LocationRow[]) ?? [];
    const houses = ((await ctx.client.from("house").select("id,code,location_id").is("deleted_at", null)).data as HouseRow[]) ?? [];
    const grades = ((await ctx.client.from("grade").select("id,code,name").eq("active", true)).data as GradeRow[]) ?? [];
    const customers = ((await ctx.client.from("customer").select("id,code,name").is("deleted_at", null)).data as CustomerRow[]) ?? [];

    const refs: ImportRefs = {
      locations: new Set(locations.map((row) => row.code)),
      houses: new Set(houses.map((row) => row.code)),
      grades: new Set(grades.map((row) => row.code)),
      customers: new Set(customers.map((row) => row.code)),
    };
    const parsed = parseImportCsv(content, refs);
    if (!parsed.ok) {
      const first = parsed.errors.slice(0, 10).map((error) => `Baris ${error.line}: ${error.message}`);
      return { error: `File ditolak. ${parsed.errors.length} galat.\n${first.join("\n")}` };
    }

    const locationByCode = new Map(locations.map((row) => [row.code, row]));
    const houseByCode = new Map(houses.map((row) => [row.code, row]));
    const gradeByCode = new Map(grades.map((row) => [row.code, row]));
    const customerByCode = new Map(customers.map((row) => [row.code, row]));

    // Validasi konversi seluruh baris lebih dulu (all-or-nothing).
    for (const row of parsed.rows) {
      const grade = gradeByCode.get(row.gradeCode)!;
      const versions = await loadConversionVersions(ctx.client, row.date);
      try {
        toKg({ qty: row.qty, unit: row.unit, gradeId: grade.id, date: row.date }, resolveConversion(versions, grade.id, row.date));
      } catch (error) {
        return { error: `Baris ${row.line}: ${(error as Error).message}` };
      }
      if (row.kind === "produksi") {
        const house = houseByCode.get(row.houseCode)!;
        if (house.location_id !== locationByCode.get(row.locationCode)!.id) {
          return { error: `Baris ${row.line}: kandang ${row.houseCode} bukan milik lokasi ${row.locationCode}.` };
        }
      }
    }

    let imported = 0;
    const touched = new Set<string>();
    for (const row of parsed.rows) {
      const location = locationByCode.get(row.locationCode)!;
      const grade = gradeByCode.get(row.gradeCode)!;
      const versions = await loadConversionVersions(ctx.client, row.date);
      const kg = toKg(
        { qty: row.qty, unit: row.unit as Unit, gradeId: grade.id, date: row.date },
        resolveConversion(versions, grade.id, row.date),
      );

      if (row.kind === "produksi") {
        const house = houseByCode.get(row.houseCode)!;
        const existing = await ctx.client
          .from("production")
          .select("id")
          .eq("house_id", house.id)
          .eq("date", row.date)
          .eq("grade_id", grade.id)
          .is("deleted_at", null)
          .maybeSingle();
        const payload = {
          qty: D(row.qty).toFixed(3),
          unit: row.unit,
          kg: kg.toFixed(3),
          source: "import",
          updated_at: new Date().toISOString(),
        };
        const { error } = existing.data
          ? await ctx.client.from("production").update(payload).eq("id", existing.data.id)
          : await ctx.client.from("production").insert({
              ...payload,
              location_id: location.id,
              house_id: house.id,
              date: row.date,
              grade_id: grade.id,
              created_by: ctx.viewer.id,
            });
        if (error) return { error: `Baris ${row.line}: ${error.message}` };
        touched.add(location.id);
      } else if (row.kind === "keluar") {
        const customer = customerByCode.get(row.customerCode)!;
        const existing = await ctx.client
          .from("outbound")
          .select("id")
          .eq("location_id", location.id)
          .eq("do_number", row.doNumber)
          .is("deleted_at", null)
          .maybeSingle();
        let outboundId = existing.data?.id ?? null;
        if (!outboundId) {
          const { data, error } = await ctx.client
            .from("outbound")
            .insert({
              location_id: location.id,
              do_number: row.doNumber,
              customer_id: customer.id,
              date: row.date,
              status: "dikirim",
              delivered_at: `${row.date}T08:00:00+07:00`,
              delivered_by: ctx.viewer.id,
              source: "import",
              note: row.note,
              created_by: ctx.viewer.id,
            })
            .select("id")
            .single();
          if (error) return { error: `Baris ${row.line}: ${error.message}` };
          outboundId = data.id;
        }
        const { error } = await ctx.client.from("outbound_line").insert({
          outbound_id: outboundId,
          grade_id: grade.id,
          qty: D(row.qty).toFixed(3),
          unit: row.unit,
          kg_doc: kg.toFixed(3),
          created_by: ctx.viewer.id,
        });
        if (error) return { error: `Baris ${row.line}: ${error.message}` };
        touched.add(location.id);
      } else if (row.kind === "susut") {
        const { error } = await ctx.client.from("shrinkage").insert({
          location_id: location.id,
          date: row.date,
          grade_id: grade.id,
          kg: kg.toFixed(3),
          kind: "lain",
          reason: row.note || "impor",
          source: "import",
          created_by: ctx.viewer.id,
        });
        if (error) return { error: `Baris ${row.line}: ${error.message}` };
        touched.add(location.id);
      } else if (row.kind === "mutasi_keluar") {
        const destination = locationByCode.get(row.customerCode.toUpperCase())!;
        const { error } = await ctx.client.from("transfer").insert({
          from_location_id: location.id,
          to_location_id: destination.id,
          grade_id: grade.id,
          kg: kg.toFixed(3),
          sent_date: row.date,
          status: "in_transit",
          note: row.note,
          source: "import",
          created_by: ctx.viewer.id,
        });
        if (error) return { error: `Baris ${row.line}: ${error.message}` };
        touched.add(location.id);
        touched.add(destination.id);
      } else if (row.kind === "mutasi_masuk") {
        const source = locationByCode.get(row.customerCode.toUpperCase())!;
        const { error } = await ctx.client.from("transfer").insert({
          from_location_id: source.id,
          to_location_id: location.id,
          grade_id: grade.id,
          kg: kg.toFixed(3),
          sent_date: row.date,
          received_date: row.date,
          status: "received",
          note: row.note,
          source: "import",
          created_by: ctx.viewer.id,
        });
        if (error) return { error: `Baris ${row.line}: ${error.message}` };
        touched.add(location.id);
        touched.add(source.id);
      }
      imported += 1;
    }

    await runBulkWorker();
    refresh(["/rekon", "/", "/approve"]);
    return done(`${imported} baris diimpor (sumber: import) untuk ${touched.size} lokasi.`);
  } catch (error) {
    return fail(error);
  }
}

export async function uploadAccurateAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(ROLES);
    if (isActionState(ctx)) return ctx;
    const kind = text(form, "kind") === "stock" ? "stock" : "sales";
    const period = text(form, "period");
    if (!/^\d{4}-\d{2}$/.test(period)) return { error: "Periode harus format YYYY-MM." };
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Pilih berkas ekspor Accurate." };
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = kind === "sales" ? parseAccurateSales(buffer) : parseAccurateStock(buffer);
    if (!parsed.ok) return { error: parsed.errors.slice(0, 8).join("\n") };

    const itemMaps = ((await ctx.client
      .from("item_map")
      .select("id,accurate_item_code,grade_id,accurate_unit,factor_to_kg")
      .is("deleted_at", null)).data as ItemMapRow[]) ?? [];
    const mapByCode = new Map(itemMaps.map((row) => [row.accurate_item_code, row]));
    const missing = parsed.itemCodes.filter((code) => !mapByCode.has(code));
    if (missing.length > 0) {
      return {
        error: `Upload ditolak: ${missing.length} item belum punya pemetaan grade:\n${missing.join(", ")}\nTambahkan item_map lalu unggah ulang.`,
      };
    }

    // Unggahan ulang periode yang sama menggantikan data sebelumnya.
    await ctx.client.from("accurate_upload").delete().eq("kind", kind).eq("period", period);
    const { data: upload, error } = await ctx.client
      .from("accurate_upload")
      .insert({
        kind,
        period,
        file_path: `uploads/${period}-${kind}.xlsx`,
        rows: parsed.lines.length,
        status: "parsed",
        created_by: ctx.viewer.id,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };

    if (kind === "sales") {
      const { error: lineError } = await ctx.client.from("accurate_sales_line").insert(
        parsed.lines.map((line) => {
          const map = mapByCode.get(line.itemCode)!;
          return {
            upload_id: upload.id,
            date: (line as unknown as { date: string }).date,
            item_code: line.itemCode,
            item_name: line.itemName,
            qty: D(line.qty).toFixed(3),
            unit: line.unit,
            amount_rp: D(line.amountRp).toFixed(2),
            kg: D(line.qty).times(map.factor_to_kg).toFixed(3),
            created_by: ctx.viewer.id,
          };
        }),
      );
      if (lineError) return { error: lineError.message };
    } else {
      const { error: lineError } = await ctx.client.from("accurate_stock_line").insert(
        parsed.lines.map((line) => {
          const map = mapByCode.get(line.itemCode)!;
          return {
            upload_id: upload.id,
            item_code: line.itemCode,
            item_name: line.itemName,
            qty: D(line.qty).toFixed(3),
            unit: line.unit,
            kg: D(line.qty).times(map.factor_to_kg).toFixed(3),
            amount_rp: D(line.amountRp).toFixed(2),
            created_by: ctx.viewer.id,
          };
        }),
      );
      if (lineError) return { error: lineError.message };
    }

    refresh(["/rekon"]);
    return done(`${parsed.lines.length} baris ${kind === "sales" ? "penjualan" : "persediaan"} Accurate dimuat untuk ${period}.`);
  } catch (error) {
    return fail(error);
  }
}

export async function updateReconItemAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(ROLES);
    if (isActionState(ctx)) return ctx;
    const id = text(form, "item_id");
    const status = text(form, "status");
    const note = optionalText(form, "note");
    if (!["open", "explained", "corrected"].includes(status)) return { error: "Status tidak dikenal." };
    const { error } = await ctx.client
      .from("reconciliation_item")
      .update({ status, note, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { error: error.message };
    refresh(["/rekon"]);
    return done("Status selisih diperbarui.");
  } catch (error) {
    return fail(error);
  }
}

export async function saveItemMapAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(ROLES);
    if (isActionState(ctx)) return ctx;
    const code = text(form, "accurate_item_code");
    const gradeId = text(form, "grade_id");
    const unit = text(form, "accurate_unit") || "kg";
    const factor = parseIdNumber(text(form, "factor_to_kg") || "1");
    if (!code || !gradeId) return { error: "Kode item dan grade wajib diisi." };
    if (!factor.ok || factor.value.lessThanOrEqualTo(0)) return { error: "Faktor harus lebih dari 0." };
    const existing = await ctx.client
      .from("item_map")
      .select("id")
      .eq("accurate_item_code", code)
      .is("deleted_at", null)
      .maybeSingle();
    const payload = { accurate_item_code: code, grade_id: gradeId, accurate_unit: unit, factor_to_kg: factor.value.toFixed(6) };
    const { error } = existing.data
      ? await ctx.client.from("item_map").update(payload).eq("id", existing.data.id)
      : await ctx.client.from("item_map").insert({ ...payload, created_by: ctx.viewer.id });
    if (error) return { error: error.message };
    refresh(["/rekon", "/master"]);
    return done("Pemetaan item tersimpan.");
  } catch (error) {
    return fail(error);
  }
}

export async function saveReconciliationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(ROLES);
    if (isActionState(ctx)) return ctx;
    const period = text(form, "period");
    if (!/^\d{4}-\d{2}$/.test(period)) return { error: "Periode harus YYYY-MM." };
    const { computeAccurateReconciliation } = await import("@/lib/recon");
    const result = await computeAccurateReconciliation(ctx.client, period);
    if (result.error) return { error: result.error };
    refresh(["/rekon"]);
    return done(`${result.items} selisih ditemukan untuk ${period}.`);
  } catch (error) {
    return fail(error);
  }
}
