/**
 * Fixture M4–M6: kas 13 minggu, rekonstruksi 30-06, ekspor Accurate sintetis.
 * Golden dihitung dengan implementasi naive di script ini (bukan engine).
 */
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

const root = process.cwd();
const G = {
  UB: "33333333-3333-3333-3333-333333333301",
  US: "33333333-3333-3333-3333-333333333302",
  UK: "33333333-3333-3333-3333-333333333303",
  RT: "33333333-3333-3333-3333-333333333304",
  PC: "33333333-3333-3333-3333-333333333305",
};

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const eachDay = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

// ---------------------------------------------------------------------------
// Cash 13 minggu
// ---------------------------------------------------------------------------
const startWeek = "2026-10-26";
const startBalance = 250_000_000;
const years = [1, 2, 3];
const revenue = years.flatMap((week) => [
  { weekStart: addDays(startWeek, week * 7), customerKind: "bakul", amountRp: 300_000_000 },
  { weekStart: addDays(startWeek, week * 7), customerKind: "agen", amountRp: 420_000_000 },
  { weekStart: addDays(startWeek, week * 7), customerKind: "grup", amountRp: 240_000_000 },
]);
const cashPlan = Array.from({ length: 13 }, (_, week) => [
  { weekStart: addDays(startWeek, week * 7), category: "pakan", direction: "out" as const, amountRp: 180_000_000 },
  { weekStart: addDays(startWeek, week * 7), category: "gaji", direction: "out" as const, amountRp: 62_000_000 },
]);
const flatCashPlan = cashPlan.flat();
flatCashPlan.push({ weekStart: addDays(startWeek, 7), category: "angsuran Mandiri", direction: "out", amountRp: 95_000_000 });
flatCashPlan.push({ weekStart: addDays(startWeek, 0), category: "saldo awal lain", direction: "in", amountRp: 10_000_000 });

const profile: Record<string, number[]> = {
  bakul: [1],
  agen: [0.5, 0.5],
  grup: [0, 0, 1],
  lain: [1],
};
// naive cash
{
  let balance = startBalance;
  let lowest = { weekStart: startWeek, balance };
  const weeks = Array.from({ length: 13 }, (_, i) => addDays(startWeek, i * 7));
  const collection = new Map<string, number>();
  for (const row of revenue) {
    const index = Math.round(
      (Date.parse(`${row.weekStart}T00:00:00Z`) - Date.parse(`${startWeek}T00:00:00Z`)) / (7 * 86400000),
    );
    (profile[row.customerKind] ?? [1]).forEach((share, offset) => {
      const target = index + offset;
      if (target < 0 || target >= 13) return;
      const key = weeks[target];
      collection.set(key, (collection.get(key) ?? 0) + row.amountRp * share);
    });
  }
  const result = weeks.map((week) => {
    const collectionIn = collection.get(week) ?? 0;
    const otherIn = flatCashPlan
      .filter((item) => item.direction === "in" && item.weekStart === week)
      .reduce((a, b) => a + b.amountRp, 0);
    const outflow = flatCashPlan
      .filter((item) => item.direction === "out" && item.weekStart === week)
      .reduce((a, b) => a + b.amountRp, 0);
    const net = collectionIn + otherIn - outflow;
    balance += net;
    if (balance < lowest.balance) lowest = { weekStart: week, balance };
    return { weekStart: week, collectionIn, otherIn, outflow, net, ending: balance };
  });
  const dir = path.join(root, "fixtures", "cash-example");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "input.json"),
    JSON.stringify({ startWeek, startBalance, revenue, cashPlan: flatCashPlan, profile, weeks: 13 }, null, 2),
  );
  fs.writeFileSync(path.join(dir, "golden.json"), JSON.stringify({ weeks: result, lowest }, null, 2));
  console.log("cash weeks", result.length, "lowest", lowest);
}

// ---------------------------------------------------------------------------
// Rekonstruksi 30-06-2026
// ---------------------------------------------------------------------------
{
  const targetDate = "2026-06-30";
  const t0Date = "2026-07-21";
  const t0Closing = [
    { gradeId: G.UB, kg: 20000 },
    { gradeId: G.US, kg: 8000 },
    { gradeId: G.UK, kg: 2000 },
    { gradeId: G.RT, kg: 300 },
    { gradeId: G.PC, kg: 100 },
  ];
  const production: Array<{ gradeId: string; date: string; kg: number }> = [];
  const outbound: Array<{ gradeId: string; date: string; kg: number }> = [];
  const shrinkage: Array<{ gradeId: string; date: string; kg: number }> = [];
  const days = eachDay("2026-07-01", "2026-07-20");
  days.forEach((date, index) => {
    if (index % 2 === 0) production.push({ gradeId: G.UB, date, kg: 1350 });
    if (index % 3 === 0) production.push({ gradeId: G.US, date, kg: 620 });
    if (index % 5 === 0) production.push({ gradeId: G.UK, date, kg: 170 });
    if (index === 2) outbound.push({ gradeId: G.UB, date, kg: 1200 });
    if (index === 6) outbound.push({ gradeId: G.US, date, kg: 400 });
    if (index === 9) shrinkage.push({ gradeId: G.RT, date, kg: 5 });
    if (index === 4) production.push({ gradeId: G.RT, date, kg: 38 });
  });

  const naive = (rows: typeof production) => {
    const map = new Map<string, number>();
    for (const row of rows) map.set(row.gradeId, (map.get(row.gradeId) ?? 0) + row.kg);
    return map;
  };
  const prod = naive(production);
  const out = naive(outbound);
  const shrink = naive(shrinkage);
  const rows = t0Closing.map((row) => {
    const closing = row.kg - (prod.get(row.gradeId) ?? 0) + (out.get(row.gradeId) ?? 0) + (shrink.get(row.gradeId) ?? 0);
    return { gradeId: row.gradeId, t0Closing: row.kg, production: prod.get(row.gradeId) ?? 0, outbound: out.get(row.gradeId) ?? 0, shrinkage: shrink.get(row.gradeId) ?? 0, closing };
  });

  const missingDay = "2026-07-10";
  const missingRows = rows.map((row) => ({
    ...row,
    lowerKg: row.closing - (row.gradeId === G.UB ? 1350 : row.gradeId === G.US ? 620 : row.gradeId === G.UK ? 170 : 0),
  }));

  const dir = path.join(root, "fixtures", "reconstruct-example");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "input.json"),
    JSON.stringify({ targetDate, t0Date, t0Closing, production, outbound, shrinkage, juneAverageDaily: [{ gradeId: G.UB, kg: 1350 }, { gradeId: G.US, kg: 620 }, { gradeId: G.UK, kg: 170 }], missingDays: [] }, null, 2),
  );
  fs.writeFileSync(
    path.join(dir, "golden.json"),
    JSON.stringify({ rows, totalClosingKg: rows.reduce((a, b) => a + b.closing, 0), missingDay, missingRows }, null, 2),
  );
  console.log("reconstruct rows", rows.length, "total", rows.reduce((a, b) => a + b.closing, 0));
}

// ---------------------------------------------------------------------------
// Accurate sintetis (Sales by Item Detail + Inventory Valuation)
// ---------------------------------------------------------------------------
{
  const dir = path.join(root, "fixtures", "accurate-example");
  fs.mkdirSync(dir, { recursive: true });

  const sales = [
    ["Tanggal", "No. Faktur", "Pelanggan", "Kode Barang", "Nama Barang", "Satuan", "Kuantitas", "Harga", "Jumlah"],
    ["2026-09-03", "SI.2026.09.001", "Bakul Ciawi", "EGG-UB", "Telur Utuh Besar", "kg", 1200, 26000, 31200000],
    ["2026-09-03", "SI.2026.09.001", "Bakul Ciawi", "EGG-US", "Telur Utuh Sedang", "kg", 400, 24000, 9600000],
    ["2026-09-10", "SI.2026.09.002", "Agen Tasik", "EGG-UB", "Telur Utuh Besar", "kg", 900, 26200, 23580000],
    ["2026-09-18", "SI.2026.09.003", "RM Saung Gunung Jati", "EGG-UK", "Telur Utuh Kecil", "kg", 300, 21000, 6300000],
    ["2026-09-25", "SI.2026.09.004", "Bakul Singaparna", "EGG-RT", "Telur Retak", "kg", 150, 15000, 2250000],
    ["2026-09-29", "SI.2026.09.005", "Agen Tasik", "EGG-PC", "Telur Pecah", "kg", 81, 9000, 729000],
  ];
  const stock = [
    ["Kode Barang", "Nama Barang", "Satuan", "Kuantitas", "Nilai"],
    ["EGG-UB", "Telur Utuh Besar", "kg", 2700, 47031300],
    ["EGG-US", "Telur Utuh Sedang", "kg", 1314, 22890000],
    ["EGG-UK", "Telur Utuh Kecil", "kg", 345, 6000000],
    ["EGG-RT", "Telur Retak", "kg", 120, 2090000],
    ["EGG-PC", "Telur Pecah", "kg", 42, 731000],
  ];

  const salesBook = XLSX.utils.book_new();
  const salesSheet = XLSX.utils.aoa_to_sheet(sales);
  XLSX.utils.book_append_sheet(salesBook, salesSheet, "Sales by Item Detail");
  XLSX.writeFile(salesBook, path.join(dir, "sales.xlsx"));

  const stockBook = XLSX.utils.book_new();
  const stockSheet = XLSX.utils.aoa_to_sheet(stock);
  XLSX.utils.book_append_sheet(stockBook, stockSheet, "Inventory Valuation");
  XLSX.writeFile(stockBook, path.join(dir, "stock.xlsx"));

  fs.writeFileSync(
    path.join(dir, "golden.json"),
    JSON.stringify(
      {
        note: "Fixture sintetis mengikuti kolom ekspor Accurate. Pemilik mengganti dengan ekspor asli.",
        sales: {
          rows: sales.length - 1,
          totalKg: 3031,
          totalRp: 31200000 + 9600000 + 23580000 + 6300000 + 2250000 + 729000,
          itemCodes: ["EGG-UB", "EGG-US", "EGG-UK", "EGG-RT", "EGG-PC"],
        },
        stock: { rows: stock.length - 1, totalKg: 4521, totalRp: 47031300 + 22890000 + 6000000 + 2090000 + 731000 },
        itemMap: [
          { code: "EGG-UB", grade: G.UB },
          { code: "EGG-US", grade: G.US },
          { code: "EGG-UK", grade: G.UK },
          { code: "EGG-RT", grade: G.RT },
          { code: "EGG-PC", grade: G.PC },
        ],
      },
      null,
      2,
    ),
  );
  console.log("accurate fixtures written");
}
