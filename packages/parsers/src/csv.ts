/** CSV RFC 4180 sederhana: kutip ganda, koma di dalam kutipan, CRLF. */

export interface CsvResult {
  rows: string[][];
  errors: string[];
}

export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return semicolons > commas ? ";" : ",";
}

export function parseCsv(text: string, delimiter?: string): CsvResult {
  const input = text.replace(/^\uFEFF/, "");
  const sep = delimiter ?? detectDelimiter(input);
  const rows: string[][] = [];
  const errors: string[] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === sep) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (inQuotes) errors.push("Kutipan ganda tidak ditutup.");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return { rows: rows.filter((r) => r.some((cell) => cell.trim() !== "")), errors };
}

/** Angka gaya Indonesia atau internasional; tidak menebak titik desimal tunggal. */
export function parseFlexibleNumber(value: string): number | null {
  const raw = String(value ?? "").trim().replace(/\s/g, "").replace(/^Rp/i, "");
  if (raw === "") return null;
  const negative = raw.startsWith("(") && raw.endsWith(")");
  const cleaned = raw.replace(/^\(/, "").replace(/\)$/, "");
  if (!/^-?[\d.,]+$/.test(cleaned)) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized: string;

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) normalized = cleaned.replace(/\./g, "").replace(",", ".");
    else normalized = cleaned.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const parts = cleaned.split(",");
    const isThousands = parts.length > 2 || (parts[1]?.length === 3 && parts[0].length <= 3);
    normalized = isThousands ? cleaned.replace(/,/g, "") : cleaned.replace(",", ".");
  } else if (lastDot >= 0) {
    const parts = cleaned.split(".");
    const isThousands = parts.length > 2 || (parts[1]?.length === 3 && parts[0].length <= 3);
    normalized = isThousands ? cleaned.replace(/\./g, "") : cleaned;
  } else {
    normalized = cleaned;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}
