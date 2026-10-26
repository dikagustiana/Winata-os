import { D, Decimal } from "./decimal";
import { diffDays } from "./dates";

/** Kontrol harian K1–K7 (PRD §7, R-22). Fungsi murni; worker menyimpan hasil. */

export type ControlStatus = "ok" | "warn" | "fail";
export type DayStatus = "open" | "submitted" | "approved" | "locked";

export interface ControlLocation {
  id: string;
  code: string;
}

export interface ControlParams {
  deadline: string;
  tolerancePct: number;
  toleranceKg: number;
  transitDaysAlert: number;
  alertDays: number;
}

export interface ControlContext {
  date: string;
  today: string;
  nowTimeWib: string;
  locations: ControlLocation[];
  dayStatuses: Array<{ locationId: string; status: DayStatus }>;
  positions: Array<{
    locationId: string;
    gradeId: string;
    gradeCode: string;
    closing: string;
    ageB3: string;
    ageB4: string;
    daysOfStock: string | null;
  }>;
  transfers: Array<{
    id: string;
    toLocationId: string;
    sentDate: string;
    receivedDate: string | null;
    status: "in_transit" | "received";
  }>;
  physicalCounts: Array<{
    locationId: string;
    date: string;
    diffKg: string;
    stockKg: string;
    note: string | null;
    gradeCode: string;
  }>;
  outbounds: Array<{ locationId: string; doNumber: string }>;
  params: ControlParams;
}

export interface ControlResult {
  code: string;
  date: string;
  locationId: string;
  status: ControlStatus;
  detail: Record<string, unknown>;
}

function result(
  code: string,
  date: string,
  locationId: string,
  status: ControlStatus,
  detail: Record<string, unknown> = {},
): ControlResult {
  return { code, date, locationId, status, detail };
}

function doSequence(doNumber: string): number | null {
  const match = doNumber.match(/(\d+)\s*$/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function computeControls(context: ControlContext): ControlResult[] {
  const results: ControlResult[] = [];
  const statusByLocation = new Map(context.dayStatuses.map((row) => [row.locationId, row.status]));
  const { date, today, nowTimeWib, params } = context;

  for (const location of context.locations) {
    const positions = context.positions.filter((row) => row.locationId === location.id);

    // K1 — lokasi belum submitted sampai batas jam.
    {
      const status = statusByLocation.get(location.id) ?? "open";
      let controlStatus: ControlStatus = "ok";
      let detail: Record<string, unknown> = { status, deadline: params.deadline };
      if (status === "open") {
        if (date < today) {
          controlStatus = "fail";
          detail = { ...detail, reason: "Hari sudah lewat dan belum diselesaikan" };
        } else if (date === today && nowTimeWib >= params.deadline) {
          controlStatus = "fail";
          detail = { ...detail, reason: `Lewat batas ${params.deadline} WIB` };
        }
      }
      results.push(result("K1", date, location.id, controlStatus, detail));
    }

    // K2 — closing negatif.
    {
      const negative = positions.filter((row) => D(row.closing).lessThan(0));
      results.push(
        result(
          "K2",
          date,
          location.id,
          negative.length > 0 ? "fail" : "ok",
          negative.length > 0
            ? { grades: negative.map((row) => ({ grade: row.gradeCode, closing: row.closing })) }
            : {},
        ),
      );
    }

    // K3 — nomor DO ganda atau loncat.
    {
      const numbers = context.outbounds
        .filter((row) => row.locationId === location.id)
        .map((row) => row.doNumber);
      const counts = new Map<string, number>();
      for (const number of numbers) counts.set(number, (counts.get(number) ?? 0) + 1);
      const duplicates = Array.from(counts.entries()).filter(([, count]) => count > 1).map(([number]) => number);

      const sequences = numbers
        .map(doSequence)
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b);
      const gaps: Array<{ from: number; to: number }> = [];
      for (let index = 1; index < sequences.length; index += 1) {
        if (sequences[index] - sequences[index - 1] > 1) {
          gaps.push({ from: sequences[index - 1], to: sequences[index] });
        }
      }

      const status: ControlStatus = duplicates.length > 0 ? "fail" : gaps.length > 0 ? "warn" : "ok";
      results.push(result("K3", date, location.id, status, { duplicates, gaps }));
    }

    // K4 — selisih hitung fisik melebihi toleransi.
    {
      const counts = context.physicalCounts.filter((row) => row.locationId === location.id);
      let worst: ControlContext["physicalCounts"][number] | null = null;
      let worstPct = 0;
      for (const row of counts) {
        const diff = D(row.diffKg).abs();
        const stock = D(row.stockKg);
        const pct = stock.greaterThan(0) ? diff.dividedBy(stock) : new Decimal(0);
        const exceeds = diff.greaterThan(params.toleranceKg) || pct.greaterThan(params.tolerancePct);
        if (exceeds && (worst === null || diff.greaterThan(D(worst.diffKg).abs()))) {
          worst = row;
          worstPct = pct.toNumber();
        }
      }
      if (!worst) {
        results.push(result("K4", date, location.id, "ok", {}));
      } else {
        const hasNote = Boolean(worst.note && worst.note.trim().length >= 3);
        results.push(
          result("K4", date, location.id, hasNote ? "warn" : "fail", {
            date: worst.date,
            grade: worst.gradeCode,
            diff_kg: worst.diffKg,
            diff_pct: worstPct,
            note: worst.note,
          }),
        );
      }
    }

    // K5 — mutasi lebih dari 1 hari di jalan.
    {
      const late = context.transfers
        .filter((row) => row.toLocationId === location.id && row.status === "in_transit")
        .map((row) => ({
          id: row.id,
          days: Math.max(0, diffDays(row.sentDate, date)),
        }))
        .filter((row) => row.days > params.transitDaysAlert);
      results.push(result("K5", date, location.id, late.length > 0 ? "warn" : "ok", { transfers: late }));
    }

    // K6 — stok umur > 7 hari.
    {
      const older = positions.reduce(
        (acc, row) => acc.plus(D(row.ageB3)).plus(D(row.ageB4)),
        new Decimal(0),
      );
      results.push(
        result("K6", date, location.id, older.greaterThan(0) ? "warn" : "ok", {
          kg_older_than_7: older.toFixed(3),
        }),
      );
    }

    // K7 — hari stok di atas ambang.
    {
      const dos = positions
        .filter((row) => row.daysOfStock !== null)
        .map((row) => D(row.daysOfStock));
      const max = dos.reduce((acc, value) => (value.greaterThan(acc) ? value : acc), new Decimal(0));
      results.push(
        result("K7", date, location.id, max.greaterThan(params.alertDays) ? "warn" : "ok", {
          days_of_stock: max.toFixed(2),
          alert_days: params.alertDays,
        }),
      );
    }
  }

  return results;
}
