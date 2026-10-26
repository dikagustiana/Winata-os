import type {
  ConversionRow,
  CustomerRow,
  DataClient,
  GradeRow,
  LocationRow,
  ParameterRow,
  Viewer,
} from "@winata/db";
import { getUserClient } from "./supabase/server";

export async function viewerClient(viewer: Viewer): Promise<DataClient> {
  return getUserClient({ userId: viewer.id, email: viewer.email });
}

export async function loadGrades(client: DataClient): Promise<GradeRow[]> {
  const { data, error } = await client
    .from("grade")
    .select("id,code,name,sort,is_saleable,active")
    .eq("active", true)
    .is("deleted_at", null)
    .order("sort");
  if (error) throw new Error(`Gagal memuat grade: ${error.message}`);
  return (data as GradeRow[] | null) ?? [];
}

export async function loadLocations(client: DataClient, viewer: Viewer): Promise<LocationRow[]> {
  const { data, error } = await client
    .from("location")
    .select("id,code,name,kind,active")
    .eq("active", true)
    .is("deleted_at", null)
    .order("code");
  if (error) throw new Error(`Gagal memuat lokasi: ${error.message}`);
  const rows = (data as LocationRow[] | null) ?? [];
  if (viewer.role === "kandang" || viewer.role === "manager") {
    return rows.filter((row) => viewer.locationIds.includes(row.id));
  }
  return rows;
}

export async function loadVisibleLocations(client: DataClient): Promise<LocationRow[]> {
  const { data } = await client
    .from("location")
    .select("id,code,name,kind,active")
    .eq("active", true)
    .is("deleted_at", null)
    .order("code");
  return (data as LocationRow[] | null) ?? [];
}

export async function loadParameters(client: DataClient, date: string): Promise<Map<string, unknown>> {
  const { data, error } = await client
    .from("parameter")
    .select("key,value,valid_from")
    .lte("valid_from", date)
    .is("deleted_at", null)
    .order("valid_from");
  if (error) throw new Error(`Gagal memuat parameter: ${error.message}`);
  const map = new Map<string, unknown>();
  for (const row of (data as ParameterRow[] | null) ?? []) {
    map.set(row.key, row.value);
  }
  return map;
}

export function param<T>(map: Map<string, unknown>, key: string, fallback: T): T {
  const value = map.get(key);
  return (value === undefined || value === null ? fallback : value) as T;
}

export function paramNumber(map: Map<string, unknown>, key: string, fallback: number): number {
  const value = map.get(key);
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function loadConversions(client: DataClient, date: string): Promise<Map<string, ConversionRow>> {
  const { data, error } = await client
    .from("unit_conversion")
    .select("id,grade_id,valid_from,kg_per_crate,kg_per_tray,eggs_per_kg,source")
    .lte("valid_from", date)
    .is("deleted_at", null)
    .order("valid_from");
  if (error) throw new Error(`Gagal memuat konversi: ${error.message}`);
  const map = new Map<string, ConversionRow>();
  for (const row of (data as ConversionRow[] | null) ?? []) {
    map.set(row.grade_id, row); // urut naik: versi terakhir menang
  }
  return map;
}

export async function loadCustomers(client: DataClient): Promise<CustomerRow[]> {
  const { data } = await client
    .from("customer")
    .select("id,code,name,kind,is_related_party,payment_terms_days")
    .is("deleted_at", null)
    .order("name");
  return (data as CustomerRow[] | null) ?? [];
}

export async function loadDayStatuses(
  client: DataClient,
  date: string,
): Promise<Map<string, { status: "open" | "submitted" | "approved" | "locked"; return_reason: string | null }>> {
  const { data } = await client
    .from("day_status")
    .select("location_id,date,status,return_reason")
    .eq("date", date);
  const map = new Map<string, { status: "open" | "submitted" | "approved" | "locked"; return_reason: string | null }>();
  for (const row of (data as Array<{ location_id: string; status: "open" | "submitted" | "approved" | "locked"; return_reason: string | null }> | null) ?? []) {
    map.set(row.location_id, { status: row.status, return_reason: row.return_reason });
  }
  return map;
}

export function byId<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

export function byCode<T extends { code: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.code, row]));
}
