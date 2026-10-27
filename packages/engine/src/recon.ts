import { D, Decimal, q2, q3 } from "./decimal";

/** K8/R-41: rekonsiliasi bulanan ke Accurate; R-42: baris BS 04A. */

export interface SalesAmount {
  gradeId: string;
  kg: string | number;
  rp: string | number;
}

export interface ReconInput {
  period: string;
  appSales: SalesAmount[];
  accurateSales: SalesAmount[];
  appStock: Array<{ gradeId: string; kg: string | number }>;
  accurateStock: Array<{ gradeId: string; kg: string | number }>;
}

export interface ReconItem {
  period: string;
  gradeId: string;
  kind: "kg" | "rp" | "stock";
  appValue: string;
  accurateValue: string;
  diff: string;
}

function sumByGrade(rows: SalesAmount[], field: "kg" | "rp"): Map<string, Decimal> {
  const map = new Map<string, Decimal>();
  for (const row of rows) {
    map.set(row.gradeId, (map.get(row.gradeId) ?? new Decimal(0)).plus(D(row[field])));
  }
  return map;
}

function stockByGrade(rows: Array<{ gradeId: string; kg: string | number }>): Map<string, Decimal> {
  const map = new Map<string, Decimal>();
  for (const row of rows) {
    map.set(row.gradeId, (map.get(row.gradeId) ?? new Decimal(0)).plus(D(row.kg)));
  }
  return map;
}

export function reconcile(input: ReconInput): ReconItem[] {
  const grades = new Set<string>([
    ...input.appSales.map((row) => row.gradeId),
    ...input.accurateSales.map((row) => row.gradeId),
    ...input.appStock.map((row) => row.gradeId),
    ...input.accurateStock.map((row) => row.gradeId),
  ]);

  const appKg = sumByGrade(input.appSales, "kg");
  const accKg = sumByGrade(input.accurateSales, "kg");
  const appRp = sumByGrade(input.appSales, "rp");
  const accRp = sumByGrade(input.accurateSales, "rp");
  const appStock = stockByGrade(input.appStock);
  const accStock = stockByGrade(input.accurateStock);

  const items: ReconItem[] = [];
  for (const gradeId of grades) {
    const push = (kind: ReconItem["kind"], appValue: Decimal, accurateValue: Decimal) => {
      const diff = appValue.minus(accurateValue);
      const threshold = kind === "rp" ? new Decimal("0.01") : new Decimal("0.001");
      if (diff.abs().greaterThan(threshold)) {
        items.push({
          period: input.period,
          gradeId,
          kind,
          appValue: q3(appValue),
          accurateValue: q3(accurateValue),
          diff: q3(diff),
        });
      }
    };
    push("kg", appKg.get(gradeId) ?? new Decimal(0), accKg.get(gradeId) ?? new Decimal(0));
    push("rp", appRp.get(gradeId) ?? new Decimal(0), accRp.get(gradeId) ?? new Decimal(0));
    push("stock", appStock.get(gradeId) ?? new Decimal(0), accStock.get(gradeId) ?? new Decimal(0));
  }
  return items;
}

export interface Bs04aInputRow {
  gradeId: string;
  gradeCode: string;
  gradeName: string;
  kg: string | number;
  ageB1: string | number;
  ageB2: string | number;
  ageB3: string | number;
  ageB4: string | number;
  daysOfStock: string | number | null;
  eggs?: string | number | null;
}

export interface Bs04aRow {
  gradeCode: string;
  gradeName: string;
  kg: string;
  eggs: string;
  hppPerKg: string;
  valueRp: string;
  ageB1: string;
  ageB2: string;
  ageB3: string;
  ageB4: string;
  daysOfStock: string;
}

/**
 * Baris ekspor BS 04A bagian B dan C (R-42). Kolom mengikuti
 * docs/reference/bs04a-columns.md; HPP selalu label sementara di UI.
 */
export function buildBs04a(rows: Bs04aInputRow[], hppPerKg: string | number): Bs04aRow[] {
  const hpp = D(hppPerKg);
  return rows.map((row) => ({
    gradeCode: row.gradeCode,
    gradeName: row.gradeName,
    kg: q3(D(row.kg)),
    eggs: String(row.eggs ?? ""),
    hppPerKg: q2(hpp),
    valueRp: q2(D(row.kg).times(hpp)),
    ageB1: q3(D(row.ageB1)),
    ageB2: q3(D(row.ageB2)),
    ageB3: q3(D(row.ageB3)),
    ageB4: q3(D(row.ageB4)),
    daysOfStock: row.daysOfStock === null ? "" : D(row.daysOfStock).toFixed(2),
  }));
}

export interface CorrectionEntry {
  account: string;
  memo: string;
  debit: string;
  credit: string;
}

export interface CorrectionProposal {
  entries: CorrectionEntry[];
  /** false selama akun masih nilai default parameter (belum dikonfirmasi CoA). */
  accountsConfirmed: boolean;
  totalDebit: string;
  totalCredit: string;
  diffRp: string;
  balanced: boolean;
}

/** Nilai default parameter akun (R-71); diganti pemilik dengan CoA Winata. */
export const DEFAULT_COA_INVENTORY_EGG = "<isi dari CoA Winata> Persediaan Telur";
export const DEFAULT_COA_INVENTORY_VARIANCE = "<isi dari CoA Winata> Selisih Persediaan (Pending RS-05)";

/** Akun dianggap terkonfirmasi bila terisi dan bukan placeholder default. */
export function isAccountConfirmed(account: string | null | undefined): boolean {
  const value = (account ?? "").trim();
  return value !== "" && !value.startsWith("<isi");
}

/**
 * R-43/T-62: draft Usulan Koreksi seimbang (Dr = Cr) dengan referensi RS-05.
 * R-71: akun dari parameter coa_inventory_egg / coa_inventory_variance.
 * Bila nilai buku (TB) lebih besar dari hasil rekonstruksi, persediaan dikreditkan.
 */
export function buildCorrectionProposal(input: {
  rows: Array<{ gradeCode: string; kg: string | number; valueRp?: string | number }>;
  hppPerKg: string | number;
  bookValueRp: string | number;
  reference?: string;
  accounts?: { inventory?: string | null; variance?: string | null };
}): CorrectionProposal {
  const reference = input.reference ?? "RS-05";
  const inventoryAccount = input.accounts?.inventory?.trim() || DEFAULT_COA_INVENTORY_EGG;
  const varianceAccount = input.accounts?.variance?.trim() || DEFAULT_COA_INVENTORY_VARIANCE;
  const hpp = D(input.hppPerKg);
  const physicalValue = input.rows.reduce(
    (acc, row) => acc.plus(row.valueRp !== undefined ? D(row.valueRp) : D(row.kg).times(hpp)),
    new Decimal(0),
  );
  const book = D(input.bookValueRp);
  const diff = book.minus(physicalValue); // positif: buku lebih tinggi
  const amount = diff.abs().toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  const entries: CorrectionEntry[] = [];
  if (amount.greaterThan(0)) {
    if (diff.greaterThan(0)) {
      entries.push({ account: varianceAccount, memo: reference, debit: amount.toFixed(2), credit: "0.00" });
      entries.push({ account: inventoryAccount, memo: reference, debit: "0.00", credit: amount.toFixed(2) });
    } else {
      entries.push({ account: inventoryAccount, memo: reference, debit: amount.toFixed(2), credit: "0.00" });
      entries.push({ account: varianceAccount, memo: reference, debit: "0.00", credit: amount.toFixed(2) });
    }
  }

  const totalDebit = entries.reduce((acc, entry) => acc.plus(D(entry.debit)), new Decimal(0));
  const totalCredit = entries.reduce((acc, entry) => acc.plus(D(entry.credit)), new Decimal(0));
  return {
    entries,
    accountsConfirmed: isAccountConfirmed(inventoryAccount) && isAccountConfirmed(varianceAccount),
    totalDebit: totalDebit.toFixed(2),
    totalCredit: totalCredit.toFixed(2),
    diffRp: diff.toFixed(2),
    balanced: totalDebit.equals(totalCredit),
  };
}
