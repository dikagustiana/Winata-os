import type { DataClient, GradeRow } from "@winata/db";
import { resolveConversion, toKg, type ConversionVersion, type Unit } from "@winata/engine";
import type { ConversionRow } from "@winata/db";

export async function loadConversionVersions(client: DataClient, date: string): Promise<ConversionVersion[]> {
  const { data } = await client
    .from("unit_conversion")
    .select("grade_id,valid_from,kg_per_crate,kg_per_tray,eggs_per_kg")
    .lte("valid_from", date)
    .is("deleted_at", null)
    .order("valid_from");
  return (((data as ConversionRow[] | null) ?? [])).map((row) => ({
    gradeId: row.grade_id,
    validFrom: row.valid_from,
    kgPerCrate: row.kg_per_crate,
    kgPerTray: row.kg_per_tray,
    eggsPerKg: row.eggs_per_kg,
  }));
}

export function conversionFor(versions: ConversionVersion[], grade: GradeRow, date: string): ConversionVersion | null {
  return resolveConversion(versions, grade.id, date);
}

export function quantityToKg(
  versions: ConversionVersion[],
  grade: GradeRow,
  date: string,
  qty: string | number,
  unit: Unit,
) {
  const conversion = resolveConversion(versions, grade.id, date);
  return toKg({ qty, unit, gradeId: grade.id, date }, conversion);
}

export function conversionHint(versions: ConversionVersion[], grade: GradeRow, date: string) {
  const conversion = resolveConversion(versions, grade.id, date);
  return {
    kgPerCrate: conversion?.kgPerCrate ? String(conversion.kgPerCrate) : null,
    kgPerTray: conversion?.kgPerTray ? String(conversion.kgPerTray) : null,
    eggsPerKg: conversion?.eggsPerKg ? String(conversion.eggsPerKg) : null,
  };
}

export async function nextDoNumber(client: DataClient, locationId: string, code: string, date: string): Promise<string> {
  const prefix = `${code}/${date.slice(0, 4)}${date.slice(5, 7)}/`;
  const { data } = await client
    .from("outbound")
    .select("do_number")
    .eq("location_id", locationId)
    .like("do_number", `${prefix}%`);
  const numbers = ((data as Array<{ do_number: string }> | null) ?? [])
    .map((row) => Number(row.do_number.slice(prefix.length)))
    .filter((value) => Number.isFinite(value));
  const next = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}
