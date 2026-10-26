import { parseCsv } from "./csv";

/** R-50: kolom tetap importer log kertas/sheet. */
export const IMPORT_COLUMNS = [
  "tanggal",
  "lokasi",
  "kandang",
  "grade",
  "jenis",
  "qty",
  "satuan",
  "nomor_do",
  "pelanggan",
  "catatan",
] as const;

export type ImportKind = "produksi" | "keluar" | "susut" | "mutasi_keluar" | "mutasi_masuk";
export type ImportUnit = "kg" | "peti" | "tray" | "btr";

const KINDS: ImportKind[] = ["produksi", "keluar", "susut", "mutasi_keluar", "mutasi_masuk"];
const UNITS: ImportUnit[] = ["kg", "peti", "tray", "btr"];

export interface ImportRow {
  line: number;
  date: string;
  locationCode: string;
  houseCode: string;
  gradeCode: string;
  kind: ImportKind;
  qty: string;
  unit: ImportUnit;
  doNumber: string;
  customerCode: string;
  note: string;
}

export interface ImportIssue {
  line: number;
  message: string;
}

export interface ImportParseResult {
  ok: boolean;
  rows: ImportRow[];
  errors: ImportIssue[];
}

export interface ImportRefs {
  locations: Set<string>;
  houses: Set<string>;
  grades: Set<string>;
  customers: Set<string>;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Validasi sintaks file. Satu baris salah = seluruh file ditolak (R-50). */
export function parseImportCsv(text: string, refs?: ImportRefs): ImportParseResult {
  const parsed = parseCsv(text);
  const errors: ImportIssue[] = parsed.errors.map((message) => ({ line: 0, message }));
  if (parsed.rows.length === 0) {
    return { ok: false, rows: [], errors: [...errors, { line: 0, message: "File kosong." }] };
  }

  const header = parsed.rows[0].map((cell) => cell.trim().toLowerCase());
  const headerMatches =
    header.length === IMPORT_COLUMNS.length &&
    IMPORT_COLUMNS.every((column, index) => header[index] === column);
  if (!headerMatches) {
    return {
      ok: false,
      rows: [],
      errors: [
        {
          line: 1,
          message: `Header harus tepat: ${IMPORT_COLUMNS.join(", ")}. Ditemukan: ${header.join(", ")}.`,
        },
      ],
    };
  }

  const rows: ImportRow[] = [];
  for (let index = 1; index < parsed.rows.length; index += 1) {
    const cells = parsed.rows[index];
    const line = index + 1;
    const column = (position: number) => (cells[position] ?? "").trim();
    const row: ImportRow = {
      line,
      date: column(0),
      locationCode: column(1).toUpperCase(),
      houseCode: column(2).toUpperCase(),
      gradeCode: column(3).toUpperCase(),
      kind: column(4).toLowerCase() as ImportKind,
      qty: column(5),
      unit: column(6).toLowerCase() as ImportUnit,
      doNumber: column(7),
      customerCode: column(8),
      note: column(9),
    };

    if (!isIsoDate(row.date)) errors.push({ line, message: `Tanggal "${row.date}" bukan YYYY-MM-DD yang sah.` });
    if (!KINDS.includes(row.kind)) {
      errors.push({ line, message: `Jenis "${row.kind}" tidak dikenal (produksi/keluar/susut/mutasi_keluar/mutasi_masuk).` });
    }
    if (!UNITS.includes(row.unit)) {
      errors.push({ line, message: `Satuan "${row.unit}" tidak dikenal (kg/peti/tray/btr).` });
    }
    if (!row.locationCode) errors.push({ line, message: "Lokasi wajib diisi." });
    if (!row.gradeCode) errors.push({ line, message: "Grade wajib diisi." });
    const qty = Number(row.qty.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(qty) || qty <= 0) errors.push({ line, message: `Qty "${row.qty}" harus angka > 0.` });
    if (row.kind === "produksi" && !row.houseCode) errors.push({ line, message: "Kandang wajib untuk produksi." });
    if (row.kind === "keluar" && !row.doNumber) errors.push({ line, message: "Nomor DO wajib untuk keluar." });
    if ((row.kind === "keluar" || row.kind === "mutasi_keluar" || row.kind === "mutasi_masuk") && !row.customerCode) {
      errors.push({
        line,
        message:
          row.kind === "keluar"
            ? "Pelanggan wajib untuk keluar."
            : "Pelanggan berisi kode lokasi lawan untuk mutasi.",
      });
    }

    if (refs) {
      if (row.locationCode && !refs.locations.has(row.locationCode)) {
        errors.push({ line, message: `Lokasi "${row.locationCode}" tidak ada.` });
      }
      if (row.houseCode && !refs.houses.has(row.houseCode)) {
        errors.push({ line, message: `Kandang "${row.houseCode}" tidak ada.` });
      }
      if (row.gradeCode && !refs.grades.has(row.gradeCode)) {
        errors.push({ line, message: `Grade "${row.gradeCode}" tidak ada.` });
      }
      if (row.kind === "keluar" && row.customerCode && !refs.customers.has(row.customerCode)) {
        errors.push({ line, message: `Pelanggan "${row.customerCode}" tidak ada.` });
      }
      if ((row.kind === "mutasi_keluar" || row.kind === "mutasi_masuk") && row.customerCode) {
        if (!refs.locations.has(row.customerCode.toUpperCase())) {
          errors.push({ line, message: `Lokasi lawan "${row.customerCode}" tidak ada.` });
        }
      }
    }

    rows.push(row);
  }

  return { ok: errors.length === 0, rows: errors.length === 0 ? rows : [], errors };
}
