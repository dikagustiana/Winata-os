import Decimal from "decimal.js";
import { formatTanggalId } from "@winata/engine";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

const idFormatter = (digits: number) =>
  new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

export function fmtKg(value: string | number | Decimal | null | undefined, digits = 1): string {
  if (value === null || value === undefined || value === "") return "—";
  return idFormatter(digits).format(new Decimal(value).toNumber());
}

export function fmtNumber(value: string | number | Decimal | null | undefined, digits = 0): string {
  if (value === null || value === undefined || value === "") return "—";
  return idFormatter(digits).format(new Decimal(value).toNumber());
}

export function fmtEggs(value: string | number | Decimal | null | undefined): string {
  return fmtNumber(value, 0);
}

export function fmtRp(value: string | number | Decimal | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return `Rp ${idFormatter(0).format(new Decimal(value).toNumber())}`;
}

export function fmtRpJt(value: string | number | Decimal | null | undefined, digits = 1): string {
  if (value === null || value === undefined || value === "") return "—";
  const millions = new Decimal(value).dividedBy(1_000_000);
  return `Rp ${idFormatter(digits).format(millions.toNumber())} jt`;
}

export function fmtPct(value: string | number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || value === "") return "—";
  return `${idFormatter(digits).format(new Decimal(value).times(100).toNumber())} %`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return formatTanggalId(iso.slice(0, 10));
}

export function fmtDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
    hour12: false,
  }).format(date);
}

export function fmtTime(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 5);
}

export type ParseResult =
  | { ok: true; value: Decimal; raw: string }
  | { ok: false; error: string };

/**
 * Membaca angka ketikan pengguna tanpa menebak (DESIGN §2 NumberInput):
 * "1.500" = seribu lima ratus; "1,5" = satu setengah; "10.5" ambigu → ditolak.
 */
export function parseIdNumber(input: string | null | undefined): ParseResult {
  const raw = (input ?? "").trim();
  if (raw === "") return { ok: false, error: "Angka belum diisi." };
  const cleaned = raw.replace(/\s/g, "").replace(/\u2212/g, "-");
  if (!/^-?[\d.,]+$/.test(cleaned)) {
    return { ok: false, error: `"${raw}" bukan angka yang bisa dibaca.` };
  }
  if (cleaned.includes(",")) {
    if ((cleaned.match(/,/g) ?? []).length > 1) {
      return { ok: false, error: `"${raw}" punya lebih dari satu koma.` };
    }
    const [intPart, decPart] = cleaned.split(",");
    if (decPart === "" || decPart.includes(".")) {
      return { ok: false, error: `"${raw}" ditulis dengan pemisah yang campur. Gunakan 1.500,5.` };
    }
    const intClean = intPart.replace(/\./g, "");
    if (!/^-?\d*$/.test(intClean)) {
      return { ok: false, error: `"${raw}" bukan angka yang bisa dibaca.` };
    }
    return { ok: true, value: new Decimal(`${intClean === "" || intClean === "-" ? "0" : intClean}.${decPart}`), raw };
  }
  if (cleaned.includes(".")) {
    if (/^-?\d{1,3}(\.\d{3})+$/.test(cleaned)) {
      return { ok: true, value: new Decimal(cleaned.replace(/\./g, "")), raw };
    }
    return {
      ok: false,
      error: `"${raw}" ambigu. Titik ribuan harus 3 digit (1.500) atau pakai koma desimal (1,5).`,
    };
  }
  if (!/^-?\d+$/.test(cleaned)) {
    return { ok: false, error: `"${raw}" bukan angka yang bisa dibaca.` };
  }
  return { ok: true, value: new Decimal(cleaned), raw };
}

export function requireNumber(input: string | null | undefined, label: string): Decimal {
  const parsed = parseIdNumber(input);
  if (!parsed.ok) throw new Error(`${label}: ${parsed.error}`);
  return parsed.value;
}

export function qty(parsed: ParseResult): Decimal {
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

export function dayLabel(iso: string): string {
  return fmtDate(iso);
}

export function statusHariLabel(status: "open" | "submitted" | "approved" | "locked"): string {
  return { open: "Belum isi", submitted: "Draft", approved: "Disetujui", locked: "Dikunci" }[status];
}

export function percent(part: number | string, total: number | string): Decimal {
  const totalDecimal = new Decimal(total);
  if (totalDecimal.isZero()) return new Decimal(0);
  return new Decimal(part).dividedBy(totalDecimal);
}
