import { D, addDays, buildCorrectionProposal, buildBs04a, reconcile, reconstruct } from "@winata/engine";
import type {
  AccurateUploadRow,
  DataClient,
  GradeRow,
  ItemMapRow,
  OpnameLineRow,
  PositionDailyRow,
  ReconciliationItemRow,
  SalesPlanRow,
} from "@winata/db";

export function periodRange(period: string): { start: string; end: string } {
  const [year, month] = period.split("-").map(Number);
  const start = `${period}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start, end: `${period}-${String(lastDay).padStart(2, "0")}` };
}

/** K8/R-41: hitung selisih app vs Accurate per grade lalu simpan reconciliation_item. */
export async function computeAccurateReconciliation(
  client: DataClient,
  period: string,
): Promise<{ items: number; error?: string }> {
  const { start, end } = periodRange(period);
  const grades = ((await client.from("grade").select("id,code,name").eq("active", true).order("sort")).data as GradeRow[]) ?? [];
  const uploads = ((await client
    .from("accurate_upload")
    .select("id,kind,period")
    .eq("period", period)
    .is("deleted_at", null)).data as AccurateUploadRow[]) ?? [];
  const salesUploads = uploads.filter((row) => row.kind === "sales").map((row) => row.id);
  const stockUploads = uploads.filter((row) => row.kind === "stock").sort((a, b) => (a.id < b.id ? 1 : -1)).map((row) => row.id);

  if (salesUploads.length === 0) return { items: 0, error: "Unggah ekspor penjualan Accurate untuk periode ini dulu." };

  const salesLines = ((await client
    .from("accurate_sales_line")
    .select("item_code,kg,amount_rp")
    .in("upload_id", salesUploads)
    .is("deleted_at", null)).data as Array<{ item_code: string; kg: string; amount_rp: string }>) ?? [];
  const itemMaps = ((await client
    .from("item_map")
    .select("accurate_item_code,grade_id,factor_to_kg")
    .is("deleted_at", null)).data as ItemMapRow[]) ?? [];
  const mapByCode = new Map(itemMaps.map((row) => [row.accurate_item_code, row]));

  const accurateSales = salesLines.map((line) => {
    const map = mapByCode.get(line.item_code);
    return {
      gradeId: map?.grade_id ?? "",
      kg: D(line.kg).toFixed(3),
      rp: D(line.amount_rp).toFixed(2),
    };
  }).filter((row) => row.gradeId !== "");

  const outbounds = ((await client
    .from("outbound")
    .select("id,date,status")
    .gte("date", start)
    .lte("date", end)
    .in("status", ["dikirim", "diterima"])
    .is("deleted_at", null)).data as Array<{ id: string; date: string; status: string }>) ?? [];
  const outboundIds = outbounds.map((row) => row.id);
  const outboundLines = outboundIds.length > 0
    ? ((await client
        .from("outbound_line")
        .select("outbound_id,grade_id,kg_doc,kg_delivered,price_per_kg")
        .in("outbound_id", outboundIds)
        .is("deleted_at", null)).data as Array<{
          outbound_id: string;
          grade_id: string;
          kg_doc: string;
          kg_delivered: string | null;
          price_per_kg: string | null;
        }>) ?? []
    : [];
  const outboundById = new Map(outbounds.map((row) => [row.id, row]));
  const appSales = outboundLines.map((line) => {
    const kg = D(line.kg_delivered ?? line.kg_doc);
    const outbound = outboundById.get(line.outbound_id);
    const inPeriod = outbound && outbound.date >= start && outbound.date <= end;
    return {
      gradeId: line.grade_id,
      kg: inPeriod ? kg.toFixed(3) : "0",
      rp: inPeriod ? kg.times(line.price_per_kg ?? 0).toFixed(2) : "0",
    };
  });

  const positions = ((await client
    .from("position_daily")
    .select("grade_id,closing")
    .eq("date", end)).data as PositionDailyRow[]) ?? [];
  const appStock = positions.map((row) => ({ gradeId: row.grade_id, kg: row.closing }));

  let accurateStock: Array<{ gradeId: string; kg: string }> = [];
  if (stockUploads.length > 0) {
    const stockLines = ((await client
      .from("accurate_stock_line")
      .select("item_code,kg")
      .in("upload_id", [stockUploads[0]])
      .is("deleted_at", null)).data as Array<{ item_code: string; kg: string }>) ?? [];
    accurateStock = stockLines
      .map((line) => ({ gradeId: mapByCode.get(line.item_code)?.grade_id ?? "", kg: line.kg }))
      .filter((row) => row.gradeId !== "");
  }

  const items = reconcile({
    period,
    appSales,
    accurateSales,
    appStock,
    accurateStock,
  });

  await client.from("reconciliation_item").delete().eq("period", period);
  if (items.length > 0) {
    const { error } = await client.from("reconciliation_item").insert(
      items.map((item) => ({
        period: item.period,
        grade_id: item.gradeId,
        kind: item.kind,
        app_value: item.appValue,
        accurate_value: item.accurateValue,
        diff: item.diff,
        status: "open",
      })),
    );
    if (error) return { items: 0, error: error.message };
  }

  void grades;
  return { items: items.length };
}

export async function loadReconciliationItems(client: DataClient, period: string): Promise<ReconciliationItemRow[]> {
  return ((await client
    .from("reconciliation_item")
    .select("*")
    .eq("period", period)
    .is("deleted_at", null)
    .order("kind")).data as ReconciliationItemRow[]) ?? [];
}

export interface ReconstructionResult {
  periodDays: number;
  rows: Array<{
    gradeId: string;
    gradeCode: string;
    t0Closing: string;
    production: string;
    outbound: string;
    shrinkage: string;
    correction: string;
    closing: string;
    estimated: boolean;
    lowerKg: string;
    upperKg: string;
  }>;
  totalClosingKg: string;
  totalValueRp: string;
  hasMissing: boolean;
  missingDays: string[];
  lowerKg: string;
  upperKg: string;
  t0Date: string;
  targetDate: string;
  bookValueRp: string;
  diffRp: string;
  diffPct: string;
  proposal: ReturnType<typeof buildCorrectionProposal>;
}

/** R-43: rekonstruksi posisi target (default 30-06-2026) dari opname T0. */
export async function computeReconstruction(
  client: DataClient,
  targetDate: string,
  t0Date: string,
  bookValueRp: string,
  hppPerKg: string,
): Promise<ReconstructionResult | { error: string }> {
  const grades = ((await client.from("grade").select("id,code,name").eq("active", true).order("sort")).data as GradeRow[]) ?? [];
  const opname = ((await client
    .from("opname")
    .select("id,date,status")
    .eq("date", t0Date)
    .eq("status", "signed")
    .is("deleted_at", null)).data as Array<{ id: string; date: string; status: string }>) ?? [];
  if (opname.length === 0) return { error: `Opname T0 bertanda tangan pada ${t0Date} tidak ditemukan.` };
  const opnameIds = opname.map((row) => row.id);
  const opnameLines = ((await client
    .from("opname_line")
    .select("*")
    .in("opname_id", opnameIds)
    .is("deleted_at", null)).data as OpnameLineRow[]) ?? [];
  if (opnameLines.length === 0) return { error: "Opname T0 belum punya baris." };

  const production = ((await client
    .from("production")
    .select("date,grade_id,kg")
    .gte("date", addDays(targetDate, 1))
    .lte("date", t0Date)
    .is("deleted_at", null)).data as Array<{ date: string; grade_id: string; kg: string }>) ?? [];
  const outbound = ((await client
    .from("outbound")
    .select("id,date")
    .gte("date", addDays(targetDate, 1))
    .lte("date", t0Date)
    .in("status", ["dikirim", "diterima"])
    .is("deleted_at", null)).data as Array<{ id: string; date: string }>) ?? [];
  const outboundIds = outbound.map((row) => row.id);
  const outboundLines = outboundIds.length > 0
    ? ((await client
        .from("outbound_line")
        .select("outbound_id,grade_id,kg_doc,kg_delivered")
        .in("outbound_id", outboundIds)
        .is("deleted_at", null)).data as Array<{
          outbound_id: string;
          grade_id: string;
          kg_doc: string;
          kg_delivered: string | null;
        }>) ?? []
    : [];
  const outboundById = new Map(outbound.map((row) => [row.id, row]));
  const shrinkage = ((await client
    .from("shrinkage")
    .select("date,grade_id,kg")
    .gte("date", addDays(targetDate, 1))
    .lte("date", t0Date)
    .is("deleted_at", null)).data as Array<{ date: string; grade_id: string; kg: string }>) ?? [];
  const correction = ((await client
    .from("correction")
    .select("effective_date,grade_id,kg")
    .gte("effective_date", addDays(targetDate, 1))
    .lte("effective_date", t0Date)
    .eq("status", "posted")
    .is("deleted_at", null)).data as Array<{ effective_date: string; grade_id: string; kg: string }>) ?? [];

  const recordedDates = Array.from(new Set(production.map((row) => row.date)));
  const allDays: string[] = [];
  for (let date = addDays(targetDate, 1); date <= t0Date; date = addDays(date, 1)) allDays.push(date);
  const missingDays = allDays.filter((date) => !recordedDates.includes(date));

  const juneAverageDaily = await (async () => {
    const juneRows = ((await client
      .from("production")
      .select("date,grade_id,kg")
      .gte("date", `${targetDate.slice(0, 4)}-06-25`)
      .lte("date", targetDate)
      .is("deleted_at", null)).data as Array<{ date: string; grade_id: string; kg: string }>) ?? [];
    const byGrade = new Map<string, { total: number; days: Set<string> }>();
    for (const row of juneRows) {
      const entry = byGrade.get(row.grade_id) ?? { total: 0, days: new Set<string>() };
      entry.total += Number(row.kg);
      entry.days.add(row.date);
      byGrade.set(row.grade_id, entry);
    }
    return Array.from(byGrade.entries()).map(([gradeId, entry]) => ({
      gradeId,
      kg: entry.days.size > 0 ? entry.total / entry.days.size : 0,
    }));
  })();

  const t0Closing = opnameLines.map((line) => ({
    gradeId: line.grade_id,
    kg: D(line.kg).toFixed(3),
  }));

  const result = reconstruct({
    targetDate,
    t0Date,
    t0Closing,
    production: production.map((row) => ({ gradeId: row.grade_id, date: row.date, kg: row.kg })),
    outbound: outboundLines
      .map((line) => {
        const parent = outboundById.get(line.outbound_id);
        return { gradeId: line.grade_id, date: parent?.date ?? t0Date, kg: line.kg_delivered ?? line.kg_doc };
      })
      .filter((row) => row.date >= addDays(targetDate, 1)),
    shrinkage: shrinkage.map((row) => ({ gradeId: row.grade_id, date: row.date, kg: row.kg })),
    correction: correction.map((row) => ({ gradeId: row.grade_id, date: row.effective_date, kg: row.kg })),
    juneAverageDaily,
    missingDays,
  });

  const gradeById = new Map(grades.map((grade) => [grade.id, grade]));
  const rows = result.rows.map((row) => ({
    ...row,
    gradeCode: gradeById.get(row.gradeId)?.code ?? "—",
  }));
  const totalValueRp = result.totalClosingKg.times(hppPerKg);
  const book = D(bookValueRp);
  const diffRp = totalValueRp.minus(book);
  const proposal = buildCorrectionProposal({
    rows: rows.map((row) => ({ gradeCode: row.gradeCode, kg: row.closing })),
    hppPerKg,
    bookValueRp,
  });
  const lower = rows.reduce((acc, row) => acc.plus(row.lowerKg), D(0));
  const upper = rows.reduce((acc, row) => acc.plus(row.upperKg), D(0));

  return {
    periodDays: result.periodDays,
    rows,
    totalClosingKg: result.totalClosingKg.toFixed(3),
    totalValueRp: totalValueRp.toFixed(2),
    hasMissing: result.hasMissing,
    missingDays: result.missingDays,
    lowerKg: lower.toFixed(3),
    upperKg: upper.toFixed(3),
    t0Date,
    targetDate,
    bookValueRp: book.toFixed(2),
    diffRp: diffRp.toFixed(2),
    diffPct: book.isZero() ? "0" : diffRp.dividedBy(book).toFixed(4),
    proposal,
  };
}

export async function buildBs04aFromDb(
  client: DataClient,
  date: string,
  hppPerKg: string,
): Promise<Array<Record<string, string>>> {
  const positions = ((await client
    .from("position_daily")
    .select("*")
    .eq("date", date)).data as PositionDailyRow[]) ?? [];
  const grades = ((await client.from("grade").select("*").eq("active", true).order("sort")).data as GradeRow[]) ?? [];
  const conversions = ((await client
    .from("unit_conversion")
    .select("grade_id,valid_from,eggs_per_kg")
    .lte("valid_from", date)
    .is("deleted_at", null).order("valid_from")).data as Array<{ grade_id: string; valid_from: string; eggs_per_kg: string | null }>) ?? [];
  const eggsPerKg = new Map<string, string>();
  for (const row of conversions) if (row.eggs_per_kg) eggsPerKg.set(row.grade_id, row.eggs_per_kg);

  const byGrade = new Map<string, { kg: number; b1: number; b2: number; b3: number; b4: number; dos: number | null }>();
  for (const row of positions) {
    const entry = byGrade.get(row.grade_id) ?? { kg: 0, b1: 0, b2: 0, b3: 0, b4: 0, dos: null };
    entry.kg += Number(row.closing);
    entry.b1 += Number(row.age_b1);
    entry.b2 += Number(row.age_b2);
    entry.b3 += Number(row.age_b3);
    entry.b4 += Number(row.age_b4);
    if (row.days_of_stock) entry.dos = Number(row.days_of_stock);
    byGrade.set(row.grade_id, entry);
  }

  const rows = grades
    .filter((grade) => byGrade.has(grade.id))
    .map((grade) => {
      const entry = byGrade.get(grade.id)!;
      const eggs = eggsPerKg.get(grade.id) ? Math.round(entry.kg * Number(eggsPerKg.get(grade.id))) : null;
      return {
        gradeId: grade.id,
        gradeCode: grade.code,
        gradeName: grade.name,
        kg: entry.kg.toFixed(3),
        eggs,
        ageB1: entry.b1.toFixed(3),
        ageB2: entry.b2.toFixed(3),
        ageB3: entry.b3.toFixed(3),
        ageB4: entry.b4.toFixed(3),
        daysOfStock: entry.dos,
      };
    });

  return buildBs04a(rows, hppPerKg) as unknown as Array<Record<string, string>>;
}

export type { SalesPlanRow };
