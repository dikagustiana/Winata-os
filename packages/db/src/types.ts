/* Tipe domain yang dipakai aplikasi dan worker. Kolom numeric dari Postgres
 * dapat datang sebagai string; pembacaan selalu lewat Decimal di engine. */

export type AppRole = "kandang" | "manager" | "accounting" | "marketing" | "bod" | "admin";

export const APP_ROLES: AppRole[] = ["kandang", "manager", "accounting", "marketing", "bod", "admin"];

export interface ViewerClaims {
  userId: string;
  email: string;
}

export interface QueryError {
  message: string;
  code?: string;
}

export interface QueryResult<T> {
  data: T | null;
  error: QueryError | null;
}

/**
 * Permukaan klien data yang dipakai aplikasi. Implementasi lokal (PGlite)
 * dan cloud (supabase-js) sama-sama memenuhinya; penggantian shim -> asli
 * hanya di lib/supabase, sesuai ARCHITECTURE §5.
 */
export interface DataClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
  rpc<T = Record<string, unknown>>(
    fn: string,
    args?: Record<string, unknown>,
  ): Promise<QueryResult<T | T[]>>;
}

export interface LocationRow {
  id: string;
  code: string;
  name: string;
  kind: "kandang" | "gudang";
  active: boolean;
}

export interface HouseRow {
  id: string;
  location_id: string;
  code: string;
  name: string;
  capacity_birds: number | null;
  active: boolean;
}

export interface GradeRow {
  id: string;
  code: string;
  name: string;
  sort: number;
  is_saleable: boolean;
  active: boolean;
}

export interface FlockRow {
  id: string;
  house_id: string;
  code: string;
  strain: string;
  chick_in_date: string;
  initial_birds: number;
  status: "grower" | "layer" | "afkir";
  production_start_date: string | null;
  cull_date: string | null;
}

export interface DepletionRow {
  id: string;
  flock_id: string;
  date: string;
  dead: number;
  culled: number;
  reason: string | null;
}

export interface Viewer {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  locations: LocationRow[];
  locationIds: string[];
}

export interface ParameterRow {
  key: string;
  value: unknown;
  valid_from: string;
}

export interface DayStatusRow {
  id: string;
  location_id: string;
  date: string;
  status: "open" | "submitted" | "approved" | "locked";
  submitted_at: string | null;
  approved_at: string | null;
  locked_at: string | null;
  return_reason: string | null;
}

export interface PositionDailyRow {
  location_id: string;
  grade_id: string;
  date: string;
  opening: string;
  production: string;
  transfer_in: string;
  outbound: string;
  transfer_out: string;
  shrinkage: string;
  correction: string;
  closing: string;
  in_transit: string;
  age_b1: string;
  age_b2: string;
  age_b3: string;
  age_b4: string;
  days_of_stock: string | null;
  value_rp: string;
}

export interface ControlResultRow {
  code: string;
  date: string;
  location_id: string;
  status: "ok" | "warn" | "fail";
  detail: Record<string, unknown>;
}

export interface CorrectionRow {
  id: string;
  location_id: string;
  effective_date: string;
  grade_id: string;
  kg: string;
  amount_rp: string;
  reason: string;
  status: "draft" | "approved" | "posted";
  approved_by: string | null;
  ref: string | null;
}

export interface OutboundRow {
  id: string;
  location_id: string;
  do_number: string;
  customer_id: string;
  date: string;
  status: "draft" | "dikirim" | "diterima";
  note: string | null;
}

export interface OutboundLineRow {
  id: string;
  outbound_id: string;
  grade_id: string;
  qty: string;
  unit: string;
  kg_doc: string;
  kg_delivered: string | null;
  price_per_kg: string | null;
}

export interface CustomerRow {
  id: string;
  code: string;
  name: string;
  kind: "bakul" | "agen" | "grup" | "lain";
  is_related_party: boolean;
  payment_terms_days: number;
}

export interface ConversionRow {
  id: string;
  grade_id: string;
  valid_from: string;
  kg_per_crate: string | null;
  kg_per_tray: string | null;
  eggs_per_kg: string | null;
  source: "opname" | "fisik" | "manual";
}

export interface ProfileRow {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  active: boolean;
}

export interface UserLocationRow {
  user_id: string;
  location_id: string;
}

export interface OpnameRow {
  id: string;
  location_id: string;
  date: string;
  cutoff_time: string | null;
  last_do_before: string | null;
  first_do_after: string | null;
  counter_id: string | null;
  witness_id: string | null;
  manager_id: string | null;
  signed_counter_at: string | null;
  signed_witness_at: string | null;
  signed_manager_at: string | null;
  photo_note: string | null;
  status: "draft" | "signed";
  note: string | null;
}

export interface OpnameLineRow {
  id: string;
  opname_id: string;
  grade_id: string;
  crates: string;
  trays: string;
  loose_eggs: number;
  sample_crates: string;
  sample_kg: string;
  sample_eggs_per_tray: string | null;
  kg: string;
  eggs: number;
}

export interface PhysicalCountRow {
  id: string;
  location_id: string;
  date: string;
  note: string | null;
  counted_by: string | null;
  checked_by: string | null;
  status: "draft" | "checked";
  created_at: string;
}

export interface PhysicalCountLineRow {
  id: string;
  physical_count_id: string;
  grade_id: string;
  crates: string;
  trays: string;
  loose_eggs: number;
  sample_crates: string;
  sample_kg: string;
  sample_eggs_per_tray: string | null;
  kg: string;
  eggs: number;
  computed_kg: string | null;
  diff_kg: string | null;
}
export interface SalesPlanRow {
  id: string;
  customer_id: string;
  date: string;
  grade_id: string;
  kg: string;
  price_per_kg: string | null;
  kind: "order" | "forecast";
  note: string | null;
}

export interface MarketPriceRow {
  id: string;
  date: string;
  region: string;
  price_per_kg: string;
  note: string | null;
}

export interface CashPlanRow {
  id: string;
  week_start: string;
  category: string;
  direction: "in" | "out";
  amount_rp: string;
  note: string | null;
}

export interface CashBalanceRow {
  id: string;
  as_of: string;
  amount_rp: string;
}

export interface ProjectionDailyRow {
  id: string;
  house_id: string;
  flock_id: string | null;
  grade_id: string;
  date: string;
  kg_proj: string;
  calibration_factor: string | null;
  flag: string | null;
}
export interface ItemMapRow {
  id: string;
  accurate_item_code: string;
  grade_id: string;
  accurate_unit: string;
  factor_to_kg: string;
}

export interface AccurateUploadRow {
  id: string;
  kind: "sales" | "stock";
  period: string;
  file_path: string | null;
  rows: number;
  status: string;
  created_at?: string;
}

export interface ReconciliationItemRow {
  id: string;
  period: string;
  grade_id: string | null;
  kind: "kg" | "rp" | "stock";
  app_value: string;
  accurate_value: string;
  diff: string;
  status: "open" | "explained" | "corrected";
  note: string | null;
  correction_id: string | null;
}