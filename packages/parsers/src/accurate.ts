import * as XLSX from "xlsx";
import { parseCsv, parseFlexibleNumber } from "./csv";

/** Ekspor Accurate: Sales by Item Detail dan Inventory Valuation. */

export interface AccurateSalesLine {
  rowNumber: number;
  date: string;
  itemCode: string;
  itemName: string;
  qty: number;
  unit: string;
  amountRp: number;
}

export interface AccurateStockLine {
  rowNumber: number;
  itemCode: string;
  itemName: string;
  qty: number;
  unit: string;
  amountRp: number;
}

export interface AccurateParseResult<T> {
  ok: boolean;
  lines: T[];
  errors: string[];
  itemCodes: string[];
}

function normalizeHeader(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findColumn(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const index = headers.indexOf(alias);
    if (index >= 0) return index;
  }
  return -1;
}

function sheetRows(input: Buffer | Uint8Array | string, sheetName?: string): string[][] {
  if (typeof input === "string") {
    return parseCsv(input).rows;
  }
  const workbook = XLSX.read(input, { type: "buffer" });
  const name = sheetName && workbook.SheetNames.includes(sheetName) ? sheetName : workbook.SheetNames[0];
  if (!name) return [];
  const sheet = workbook.Sheets[name];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
  return rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))));
}

function excelDate(value: string): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const serial = Number(raw);
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    const parsed = XLSX.SSF.parse_date_code(serial);
    if (parsed) {
      const month = String(parsed.m).padStart(2, "0");
      const day = String(parsed.d).padStart(2, "0");
      return `${parsed.y}-${month}-${day}`;
    }
  }
  const match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (match) {
    const day = match[1].padStart(2, "0");
    const month = match[2].padStart(2, "0");
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${month}-${day}`;
  }
  return null;
}

function extractHeaders(rows: string[][]): { headers: string[]; headerIndex: number } | null {
  for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
    const headers = rows[index].map(normalizeHeader);
    if (headers.filter(Boolean).length >= 3) return { headers, headerIndex: index };
  }
  return null;
}

const SALES_ALIASES = {
  date: ["tanggal", "tgl", "date", "tanggal transaksi"],
  itemCode: ["kode barang", "kode item", "item code", "kode", "item"],
  itemName: ["nama barang", "nama item", "item name", "nama"],
  qty: ["kuantitas", "qty", "quantity", "jumlah qty"],
  unit: ["satuan", "unit", "uom"],
  amount: ["jumlah", "total", "amount", "nilai", "jumlah rp", "total rp"],
  price: ["harga", "price", "harga satuan"],
};

const STOCK_ALIASES = {
  itemCode: ["kode barang", "kode item", "item code", "kode", "item"],
  itemName: ["nama barang", "nama item", "item name", "nama"],
  qty: ["kuantitas", "qty", "quantity", "saldo", "jumlah"],
  unit: ["satuan", "unit", "uom"],
  amount: ["nilai", "value", "nilai persediaan", "amount", "total", "saldo nilai"],
};

export function parseAccurateSales(input: Buffer | Uint8Array | string): AccurateParseResult<AccurateSalesLine> {
  const rows = sheetRows(input);
  const meta = extractHeaders(rows);
  if (!meta) return { ok: false, lines: [], errors: ["Header tidak ditemukan."], itemCodes: [] };

  const { headers, headerIndex } = meta;
  const columns = {
    date: findColumn(headers, SALES_ALIASES.date),
    itemCode: findColumn(headers, SALES_ALIASES.itemCode),
    itemName: findColumn(headers, SALES_ALIASES.itemName),
    qty: findColumn(headers, SALES_ALIASES.qty),
    unit: findColumn(headers, SALES_ALIASES.unit),
    amount: findColumn(headers, SALES_ALIASES.amount),
  };
  const missing = Object.entries(columns)
    .filter(([key, index]) => index < 0 && key !== "itemName" && key !== "unit")
    .map(([key]) => key);
  if (missing.length > 0) {
    return {
      ok: false,
      lines: [],
      errors: [`Kolom wajib tidak ditemukan: ${missing.join(", ")}. Header: ${headers.join(", ")}`],
      itemCodes: [],
    };
  }

  const lines: AccurateSalesLine[] = [];
  const errors: string[] = [];
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const itemCode = String(row[columns.itemCode] ?? "").trim();
    if (!itemCode) continue;
    const date = excelDate(row[columns.date]);
    const qty = parseFlexibleNumber(String(row[columns.qty] ?? ""));
    const amount = parseFlexibleNumber(String(row[columns.amount] ?? ""));
    if (!date) {
      errors.push(`Baris ${index + 1}: tanggal tidak sah (${row[columns.date] ?? ""}).`);
      continue;
    }
    if (qty === null) {
      errors.push(`Baris ${index + 1}: kuantitas tidak sah (${row[columns.qty] ?? ""}).`);
      continue;
    }
    if (amount === null) {
      errors.push(`Baris ${index + 1}: jumlah Rp tidak sah (${row[columns.amount] ?? ""}).`);
      continue;
    }
    lines.push({
      rowNumber: index + 1,
      date,
      itemCode,
      itemName: columns.itemName >= 0 ? String(row[columns.itemName] ?? "").trim() : "",
      qty,
      unit: columns.unit >= 0 ? String(row[columns.unit] ?? "").trim() : "",
      amountRp: amount,
    });
  }

  if (lines.length === 0 && errors.length === 0) errors.push("Tidak ada baris penjualan yang terbaca.");
  return {
    ok: errors.length === 0,
    lines,
    errors,
    itemCodes: Array.from(new Set(lines.map((line) => line.itemCode))).sort(),
  };
}

export function parseAccurateStock(input: Buffer | Uint8Array | string): AccurateParseResult<AccurateStockLine> {
  const rows = sheetRows(input);
  const meta = extractHeaders(rows);
  if (!meta) return { ok: false, lines: [], errors: ["Header tidak ditemukan."], itemCodes: [] };

  const { headers, headerIndex } = meta;
  const columns = {
    itemCode: findColumn(headers, STOCK_ALIASES.itemCode),
    itemName: findColumn(headers, STOCK_ALIASES.itemName),
    qty: findColumn(headers, STOCK_ALIASES.qty),
    unit: findColumn(headers, STOCK_ALIASES.unit),
    amount: findColumn(headers, STOCK_ALIASES.amount),
  };
  const missing = Object.entries(columns)
    .filter(([key, index]) => index < 0 && key !== "itemName" && key !== "unit")
    .map(([key]) => key);
  if (missing.length > 0) {
    return {
      ok: false,
      lines: [],
      errors: [`Kolom wajib tidak ditemukan: ${missing.join(", ")}. Header: ${headers.join(", ")}`],
      itemCodes: [],
    };
  }

  const lines: AccurateStockLine[] = [];
  const errors: string[] = [];
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const itemCode = String(row[columns.itemCode] ?? "").trim();
    if (!itemCode) continue;
    const qty = parseFlexibleNumber(String(row[columns.qty] ?? ""));
    const amount = parseFlexibleNumber(String(row[columns.amount] ?? ""));
    if (qty === null) {
      errors.push(`Baris ${index + 1}: kuantitas tidak sah (${row[columns.qty] ?? ""}).`);
      continue;
    }
    if (amount === null) {
      errors.push(`Baris ${index + 1}: nilai tidak sah (${row[columns.amount] ?? ""}).`);
      continue;
    }
    lines.push({
      rowNumber: index + 1,
      itemCode,
      itemName: columns.itemName >= 0 ? String(row[columns.itemName] ?? "").trim() : "",
      qty,
      unit: columns.unit >= 0 ? String(row[columns.unit] ?? "").trim() : "",
      amountRp: amount,
    });
  }

  if (lines.length === 0 && errors.length === 0) errors.push("Tidak ada baris persediaan yang terbaca.");
  return {
    ok: errors.length === 0,
    lines,
    errors,
    itemCodes: Array.from(new Set(lines.map((line) => line.itemCode))).sort(),
  };
}
