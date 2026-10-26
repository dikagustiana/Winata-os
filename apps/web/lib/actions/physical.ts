"use server";

import { D, opnameLineKg, type ConversionVersion } from "@winata/engine";
import type { AppRole, GradeRow, PositionDailyRow } from "@winata/db";
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
import { putObject } from "@/lib/storage";
import type { ActionState } from "@/lib/action-types";
import { getLocalDb } from "@/lib/local-db";
import { isMockAuth } from "@/lib/supabase/server";

const ROLES: AppRole[] = ["kandang", "manager", "accounting", "admin"];

function numberOrNull(form: FormData, name: string): string | null {
  const raw = text(form, name);
  if (raw === "") return null;
  const parsed = parseIdNumber(raw);
  if (!parsed.ok) throw new Error(`${name}: ${parsed.error}`);
  return parsed.value.toFixed(3);
}

async function refreshControls(locationId: string, date: string): Promise<void> {
  if (!isMockAuth()) return;
  const { processControls } = await import("@winata/db");
  const db = await getLocalDb();
  await processControls(db, date);
}

async function writeConversionSample(
  ctx: { client: import("@winata/db").DataClient; viewer: { id: string } },
  grade: GradeRow,
  date: string,
  sampleCrates: string | null,
  sampleKg: string | null,
  sampleEggs: string | null,
  conversion: ConversionVersion | null,
  mode: string,
): Promise<string | null> {
  if (Number(sampleCrates ?? 0) <= 0 || Number(sampleKg ?? 0) <= 0) return null;
  const kgPerCrate = D(sampleKg!).dividedBy(D(sampleCrates!)).toFixed(3);
  const kgPerTray =
    sampleEggs && conversion?.eggsPerKg ? D(sampleEggs).dividedBy(D(conversion.eggsPerKg)).toFixed(3) : null;
  const source = mode === "opname" ? "opname" : "fisik";
  const existing = await ctx.client
    .from("unit_conversion")
    .select("id")
    .eq("grade_id", grade.id)
    .eq("valid_from", date)
    .maybeSingle();
  const payload = {
    kg_per_crate: kgPerCrate,
    kg_per_tray: kgPerTray,
    eggs_per_kg: conversion?.eggsPerKg ? String(conversion.eggsPerKg) : null,
    source,
    note: `sampel ${sampleCrates} peti`,
    updated_at: new Date().toISOString(),
  };
  const { error } = existing.data
    ? await ctx.client.from("unit_conversion").update(payload).eq("id", existing.data.id)
    : await ctx.client.from("unit_conversion").insert({
        ...payload,
        grade_id: grade.id,
        valid_from: date,
        created_by: ctx.viewer.id,
      });
  return error?.message ?? null;
}

/**
 * Hitung fisik (tanpa BA) atau opname (BA) — R-5.
 * Hasil timbang sampel selalu menjadi versi unit_conversion baru.
 */
export async function savePhysicalCountAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(ROLES);
    if (isActionState(ctx)) return ctx;
    const locationId = text(form, "location_id");
    const date = isoDate(form, "date", "Tanggal hitung")!;
    const mode = text(form, "mode") || "fisik";
    const note = optionalText(form, "note");
    if (!locationId) return { error: "Lokasi wajib diisi." };

    const grades = ((await ctx.client.from("grade").select("id,code,name,sort").eq("active", true).order("sort")).data as GradeRow[]) ?? [];
    const versions = await loadConversionVersions(ctx.client, date);
    const positions = ((await ctx.client
      .from("position_daily")
      .select("grade_id,closing")
      .eq("location_id", locationId)
      .eq("date", date)).data as PositionDailyRow[]) ?? [];
    const positionByGrade = new Map(positions.map((row) => [row.grade_id, row.closing]));

    if (mode === "opname") {
      const existing = await ctx.client
        .from("opname")
        .select("*")
        .eq("location_id", locationId)
        .eq("date", date)
        .is("deleted_at", null)
        .maybeSingle();
      if (existing.data?.status === "signed") {
        return { error: "BA opname yang sudah ditandatangani tidak bisa diubah." };
      }
      let headerId = existing.data?.id ?? null;
      const headerPayload = {
        cutoff_time: optionalText(form, "cutoff_time"),
        last_do_before: optionalText(form, "last_do_before"),
        first_do_after: optionalText(form, "first_do_after"),
        note,
        counter_id: ctx.viewer.role === "kandang" ? ctx.viewer.id : existing.data?.counter_id ?? null,
        updated_at: new Date().toISOString(),
      };
      if (headerId) {
        const { error } = await ctx.client.from("opname").update(headerPayload).eq("id", headerId);
        if (error) return { error: error.message };
      } else {
        const { data, error } = await ctx.client
          .from("opname")
          .insert({ ...headerPayload, location_id: locationId, date, status: "draft", created_by: ctx.viewer.id })
          .select("id")
          .single();
        if (error) return { error: error.message };
        headerId = data.id;
      }

      let saved = 0;
      for (const grade of grades) {
        const crates = numberOrNull(form, `crates_${grade.id}`);
        const trays = numberOrNull(form, `trays_${grade.id}`);
        const loose = numberOrNull(form, `loose_${grade.id}`);
        const sampleCrates = numberOrNull(form, `sample_crates_${grade.id}`);
        const sampleKg = numberOrNull(form, `sample_kg_${grade.id}`);
        const sampleEggs = numberOrNull(form, `sample_eggs_${grade.id}`);
        if (crates === null && trays === null && loose === null && sampleCrates === null && sampleKg === null) continue;
        const conversion = versions.find((version) => version.gradeId === grade.id && version.validFrom <= date) ?? null;
        const result = opnameLineKg(
          {
            gradeId: grade.id,
            crates: crates ?? 0,
            trays: trays ?? 0,
            looseEggs: loose ?? 0,
            sampleCrates: sampleCrates ?? 0,
            sampleKg: sampleKg ?? 0,
            sampleEggsPerTray: sampleEggs,
            fallback: conversion,
          },
          conversion,
        );
        const linePayload = {
          crates: crates ?? "0",
          trays: trays ?? "0",
          loose_eggs: Number(loose ?? 0),
          sample_crates: sampleCrates ?? "0",
          sample_kg: sampleKg ?? "0",
          sample_eggs_per_tray: sampleEggs,
          kg: result.kg.toFixed(3),
          eggs: result.eggs,
          updated_at: new Date().toISOString(),
        };
        const line = await ctx.client
          .from("opname_line")
          .select("id")
          .eq("opname_id", headerId)
          .eq("grade_id", grade.id)
          .is("deleted_at", null)
          .maybeSingle();
        const { error } = line.data
          ? await ctx.client.from("opname_line").update(linePayload).eq("id", line.data.id)
          : await ctx.client.from("opname_line").insert({
              ...linePayload,
              opname_id: headerId,
              grade_id: grade.id,
              created_by: ctx.viewer.id,
            });
        if (error) return { error: error.message };
        const versionError = await writeConversionSample(ctx, grade, date, sampleCrates, sampleKg, sampleEggs, conversion, mode);
        if (versionError) return { error: versionError };
        saved += 1;
      }

      await rebuildLocal(locationId, date);
      await refreshControls(locationId, date);
      refresh(["/fisik", "/", "/rekon"]);
      return done(`${saved} baris opname tersimpan. Tanda tangan tiga pihak belum lengkap.`);
    }

    // Mode hitung fisik mingguan (K4): selisih dibanding posisi.
    const existing = await ctx.client
      .from("physical_count")
      .select("id,status")
      .eq("location_id", locationId)
      .eq("date", date)
      .is("deleted_at", null)
      .maybeSingle();
    let headerId: string | null = existing.data?.id ?? null;
    const headerPayload = { note, counted_by: ctx.viewer.id, updated_at: new Date().toISOString() };
    if (headerId) {
      const { error } = await ctx.client.from("physical_count").update(headerPayload).eq("id", headerId);
      if (error) return { error: error.message };
    } else {
      const { data, error } = await ctx.client
        .from("physical_count")
        .insert({ ...headerPayload, location_id: locationId, date, created_by: ctx.viewer.id })
        .select("id")
        .single();
      if (error) return { error: error.message };
      headerId = data.id;
    }

    let saved = 0;
    for (const grade of grades) {
      const crates = numberOrNull(form, `crates_${grade.id}`);
      const trays = numberOrNull(form, `trays_${grade.id}`);
      const loose = numberOrNull(form, `loose_${grade.id}`);
      const sampleCrates = numberOrNull(form, `sample_crates_${grade.id}`);
      const sampleKg = numberOrNull(form, `sample_kg_${grade.id}`);
      const sampleEggs = numberOrNull(form, `sample_eggs_${grade.id}`);
      if (crates === null && trays === null && loose === null && sampleCrates === null && sampleKg === null) continue;
      const conversion = versions.find((version) => version.gradeId === grade.id && version.validFrom <= date) ?? null;
      const result = opnameLineKg(
        {
          gradeId: grade.id,
          crates: crates ?? 0,
          trays: trays ?? 0,
          looseEggs: loose ?? 0,
          sampleCrates: sampleCrates ?? 0,
          sampleKg: sampleKg ?? 0,
          sampleEggsPerTray: sampleEggs,
          fallback: conversion,
        },
        conversion,
      );
      const computed = positionByGrade.get(grade.id) ?? null;
      const diff = computed === null ? null : result.kg.minus(D(computed));
      const linePayload = {
        crates: crates ?? "0",
        trays: trays ?? "0",
        loose_eggs: Number(loose ?? 0),
        sample_crates: sampleCrates ?? "0",
        sample_kg: sampleKg ?? "0",
        sample_eggs_per_tray: sampleEggs,
        kg: result.kg.toFixed(3),
        eggs: result.eggs,
        computed_kg: computed,
        diff_kg: diff === null ? null : diff.toFixed(3),
        updated_at: new Date().toISOString(),
      };
      const line = await ctx.client
        .from("physical_count_line")
        .select("id")
        .eq("physical_count_id", headerId)
        .eq("grade_id", grade.id)
        .is("deleted_at", null)
        .maybeSingle();
      const { error } = line.data
        ? await ctx.client.from("physical_count_line").update(linePayload).eq("id", line.data.id)
        : await ctx.client.from("physical_count_line").insert({
            ...linePayload,
            physical_count_id: headerId,
            grade_id: grade.id,
            created_by: ctx.viewer.id,
          });
      if (error) return { error: error.message };
      const versionError = await writeConversionSample(ctx, grade, date, sampleCrates, sampleKg, sampleEggs, conversion, mode);
      if (versionError) return { error: versionError };
      saved += 1;
    }

    await refreshControls(locationId, date);
    refresh(["/fisik", "/", "/rekon", "/approve"]);
    return done(`${saved} baris hitung fisik tersimpan.`);
  } catch (error) {
    return fail(error);
  }
}

export async function signOpnameAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(["kandang", "accounting", "manager", "admin"]);
    if (isActionState(ctx)) return ctx;
    const locationId = text(form, "location_id");
    const date = isoDate(form, "date", "Tanggal opname")!;
    const header = await ctx.client
      .from("opname")
      .select("*")
      .eq("location_id", locationId)
      .eq("date", date)
      .is("deleted_at", null)
      .maybeSingle();
    if (!header.data) return { error: "BA opname belum dibuat." };
    const row = header.data;
    if (row.status === "signed") return { error: "BA sudah terkunci setelah tanda tangan ketiga." };

    const now = new Date().toISOString();
    if (ctx.viewer.role === "kandang") {
      if (row.signed_counter_at) return { error: "Penghitung sudah menandatangani." };
      const { error } = await ctx.client
        .from("opname")
        .update({ signed_counter_at: now, counter_id: ctx.viewer.id })
        .eq("id", row.id);
      if (error) return { error: error.message };
    } else if (ctx.viewer.role === "accounting" || ctx.viewer.role === "admin") {
      if (!row.signed_counter_at) return { error: "Penghitung harus menandatangani lebih dulu." };
      if (row.signed_witness_at) return { error: "Pendamping sudah menandatangani." };
      const { error } = await ctx.client
        .from("opname")
        .update({ signed_witness_at: now, witness_id: ctx.viewer.id })
        .eq("id", row.id);
      if (error) return { error: error.message };
    } else if (ctx.viewer.role === "manager") {
      if (!row.signed_counter_at || !row.signed_witness_at) {
        return { error: "Penghitung dan pendamping harus menandatangani lebih dulu." };
      }
      if (row.signed_manager_at) return { error: "Manager sudah menandatangani." };
      const { error } = await ctx.client
        .from("opname")
        .update({ signed_manager_at: now, manager_id: ctx.viewer.id, status: "signed" })
        .eq("id", row.id);
      if (error) return { error: error.message };
      await rebuildLocal(locationId, date);
    }

    await refreshControls(locationId, date);
    refresh(["/fisik", "/", "/rekon"]);
    return done("Tanda tangan tercatat.");
  } catch (error) {
    return fail(error);
  }
}

export async function markCheckedAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(["manager", "accounting", "admin"]);
    if (isActionState(ctx)) return ctx;
    const id = text(form, "physical_count_id");
    const { error } = await ctx.client
      .from("physical_count")
      .update({ checked_by: ctx.viewer.id, status: "checked", updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { error: error.message };
    refresh(["/fisik", "/rekon"]);
    return done("Hitung fisik ditandai diperiksa.");
  } catch (error) {
    return fail(error);
  }
}

export async function uploadBaPhotoAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(["kandang", "accounting", "manager", "admin"]);
    if (isActionState(ctx)) return ctx;
    const locationId = text(form, "location_id");
    const date = isoDate(form, "date", "Tanggal opname")!;
    const file = form.get("photo");
    if (!(file instanceof File) || file.size === 0) return { error: "Pilih foto BA terlebih dahulu." };
    if (file.size > 8 * 1024 * 1024) return { error: "Foto maksimal 8 MB." };
    const buffer = Buffer.from(await file.arrayBuffer());
    const uploaded = await putObject("ba-photos", `${date}-${locationId}-${file.name}`, buffer, file.type || "image/jpeg");
    const header = await ctx.client
      .from("opname")
      .select("id,photo_note")
      .eq("location_id", locationId)
      .eq("date", date)
      .maybeSingle();
    if (!header.data) return { error: "Simpan BA opname dulu sebelum mengunggah foto." };
    const note = header.data.photo_note ? `${header.data.photo_note};${uploaded.path}` : uploaded.path;
    const { error } = await ctx.client.from("opname").update({ photo_note: note }).eq("id", header.data.id);
    if (error) return { error: error.message };
    refresh(["/fisik"]);
    return done("Foto BA tersimpan.");
  } catch (error) {
    return fail(error);
  }
}
