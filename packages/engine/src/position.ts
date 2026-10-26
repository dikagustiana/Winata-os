import { D, Decimal, Numeric, q2, q3, round3 } from "./decimal";
import { eachDay } from "./dates";
import { StockLedger, StockLayer } from "./aging";
import { daysOfStock } from "./daysOfStock";
import { valuationRp } from "./valuation";

export interface LocationRef {
  id: string;
  code: string;
  kind: "kandang" | "gudang";
}

export interface GradeRef {
  id: string;
  code: string;
}

export interface OpeningLine {
  locationId: string;
  gradeId: string;
  kg: Numeric;
}

export interface ProductionTxn {
  locationId: string;
  gradeId: string;
  date: string;
  kg: Numeric;
}

export interface OutboundTxn {
  locationId: string;
  gradeId: string;
  date: string;
  kg: Numeric;
}

export interface TransferTxn {
  id: string;
  fromLocationId: string;
  toLocationId: string;
  gradeId: string;
  kg: Numeric;
  sentDate: string;
  receivedDate: string | null;
  status: "in_transit" | "received";
}

export interface ShrinkageTxn {
  locationId: string;
  gradeId: string;
  date: string;
  kg: Numeric;
}

export interface CorrectionTxn {
  locationId: string;
  gradeId: string;
  effectiveDate: string;
  kg: Numeric;
  status: "draft" | "approved" | "posted";
}

export interface ComputePositionInput {
  locations: LocationRef[];
  grades: GradeRef[];
  startDate: string;
  endDate: string;
  openingDate: string;
  /** Hanya baris opname T0 (K6). */
  opening: OpeningLine[];
  production: ProductionTxn[];
  outbound: OutboundTxn[];
  transfer: TransferTxn[];
  shrinkage: ShrinkageTxn[];
  correction: CorrectionTxn[];
  hppPerKg: Numeric;
  bucketDays?: [number, number, number];
}

export interface PositionRow {
  locationId: string;
  gradeId: string;
  date: string;
  opening: string;
  production: string;
  transferIn: string;
  outbound: string;
  transferOut: string;
  shrinkage: string;
  correction: string;
  closing: string;
  inTransit: string;
  ageB1: string;
  ageB2: string;
  ageB3: string;
  ageB4: string;
  daysOfStock: string | null;
  valueRp: string;
}

interface Components {
  production: Decimal;
  transferIn: Decimal;
  outbound: Decimal;
  transferOut: Decimal;
  shrinkage: Decimal;
  correction: Decimal;
}

const zeroComponents = (): Components => ({
  production: new Decimal(0),
  transferIn: new Decimal(0),
  outbound: new Decimal(0),
  transferOut: new Decimal(0),
  shrinkage: new Decimal(0),
  correction: new Decimal(0),
});

function key(...parts: string[]): string {
  return parts.join("|");
}

function plusComponent(target: Components, field: keyof Components, value: Numeric): void {
  target[field] = target[field].plus(D(value));
}

/**
 * R-10: mesin posisi per (lokasi, grade, tanggal).
 * closing = opening + production + transfer_in − outbound − transfer_out − shrinkage ± correction
 * opening(d) = closing(d−1); opening hari pertama = hasil opname T0 (K6).
 *
 * Urutan dalam satu hari: opening → produksi → koreksi positif → mutasi keluar
 * (membawa umur lapisan) → mutasi masuk → keluar → susut → koreksi negatif.
 */
export function computePosition(input: ComputePositionInput): PositionRow[] {
  const bucketDays = input.bucketDays ?? [3, 7, 14];
  const days = eachDay(input.startDate, input.endDate);
  if (days.length === 0) return [];

  const combos: Array<{ location: LocationRef; grade: GradeRef }> = [];
  for (const location of input.locations) {
    for (const grade of input.grades) {
      combos.push({ location, grade });
    }
  }

  const events = new Map<string, Components>();
  const getComponents = (locationId: string, gradeId: string, date: string): Components => {
    const k = key(locationId, gradeId, date);
    let existing = events.get(k);
    if (!existing) {
      existing = zeroComponents();
      events.set(k, existing);
    }
    return existing;
  };

  for (const p of input.production) plusComponent(getComponents(p.locationId, p.gradeId, p.date), "production", p.kg);
  for (const o of input.outbound) plusComponent(getComponents(o.locationId, o.gradeId, o.date), "outbound", o.kg);
  for (const s of input.shrinkage) plusComponent(getComponents(s.locationId, s.gradeId, s.date), "shrinkage", s.kg);
  for (const c of input.correction) {
    if (c.status !== "posted") continue;
    plusComponent(getComponents(c.locationId, c.gradeId, c.effectiveDate), "correction", c.kg);
  }
  for (const t of input.transfer) {
    plusComponent(getComponents(t.fromLocationId, t.gradeId, t.sentDate), "transferOut", t.kg);
    if (t.receivedDate) {
      plusComponent(getComponents(t.toLocationId, t.gradeId, t.receivedDate), "transferIn", t.kg);
    }
  }

  // "Di jalan": barang sudah keluar dari asal tetapi belum masuk tujuan.
  const inTransit = new Map<string, Decimal>();
  for (const t of input.transfer) {
    const start = t.sentDate;
    const endExclusive = t.receivedDate ?? null;
    for (const day of days) {
      if (day < start) continue;
      if (endExclusive && day >= endExclusive) continue;
      const k = key(t.toLocationId, t.gradeId, day);
      inTransit.set(k, (inTransit.get(k) ?? new Decimal(0)).plus(D(t.kg)));
    }
  }

  const openingByCombo = new Map<string, Decimal>();
  for (const line of input.opening) {
    const k = key(line.locationId, line.gradeId);
    openingByCombo.set(k, (openingByCombo.get(k) ?? new Decimal(0)).plus(D(line.kg)));
  }

  const ledgers = new Map<string, StockLedger>();
  const getLedger = (locationId: string, gradeId: string): StockLedger => {
    const k = key(locationId, gradeId);
    let ledger = ledgers.get(k);
    if (!ledger) {
      ledger = new StockLedger();
      ledgers.set(k, ledger);
    }
    return ledger;
  };

  const transfersBySent = new Map<string, TransferTxn[]>();
  const transfersByReceived = new Map<string, TransferTxn[]>();
  for (const t of input.transfer) {
    const sent = transfersBySent.get(t.sentDate) ?? [];
    sent.push(t);
    transfersBySent.set(t.sentDate, sent);
    if (t.receivedDate) {
      const received = transfersByReceived.get(t.receivedDate) ?? [];
      received.push(t);
      transfersByReceived.set(t.receivedDate, received);
    }
  }
  const transferLayers = new Map<string, StockLayer[]>();

  const previousClosing = new Map<string, Decimal>();
  const rows: PositionRow[] = [];

  for (const [index, day] of days.entries()) {
    // 1. Opening hari pertama = opname T0.
    if (index === 0) {
      for (const { location, grade } of combos) {
        const amount = openingByCombo.get(key(location.id, grade.id)) ?? new Decimal(0);
        getLedger(location.id, grade.id).add(input.openingDate, amount);
      }
    }

    // 2. Produksi + koreksi positif membentuk lapisan hari ini.
    for (const { location, grade } of combos) {
      const components = getComponents(location.id, grade.id, day);
      if (components.production.greaterThan(0)) {
        getLedger(location.id, grade.id).add(day, components.production);
      }
      if (components.correction.greaterThan(0)) {
        getLedger(location.id, grade.id).add(day, components.correction);
      }
    }

    // 3. Mutasi keluar: konsumsi FIFO dan simpan komposisi umur.
    for (const t of transfersBySent.get(day) ?? []) {
      const consumed = getLedger(t.fromLocationId, t.gradeId).consume(t.kg);
      transferLayers.set(t.id, consumed);
    }

    // 4. Mutasi masuk: lapisan membawa umur asal.
    for (const t of transfersByReceived.get(day) ?? []) {
      const carried = transferLayers.get(t.id);
      const ledger = getLedger(t.toLocationId, t.gradeId);
      if (carried && carried.length > 0) {
        ledger.addLayers(carried);
        const carriedKg = carried.reduce((acc, l) => acc.plus(l.kg), new Decimal(0));
        const shortfall = D(t.kg).minus(carriedKg);
        if (shortfall.greaterThan(0)) ledger.add(t.sentDate, shortfall);
      } else {
        ledger.add(t.sentDate, t.kg);
      }
    }

    // 5. Keluar, susut, koreksi negatif mengurangi lapisan tertua.
    for (const { location, grade } of combos) {
      const components = getComponents(location.id, grade.id, day);
      const ledger = getLedger(location.id, grade.id);
      if (components.outbound.greaterThan(0)) ledger.consume(components.outbound);
      if (components.shrinkage.greaterThan(0)) ledger.consume(components.shrinkage);
      if (components.correction.lessThan(0)) ledger.consume(components.correction.abs());
    }

    // 6. Hitung baris posisi.
    for (const { location, grade } of combos) {
      const comboKey = key(location.id, grade.id);
      const components = getComponents(location.id, grade.id, day);
      const opening =
        index === 0
          ? openingByCombo.get(comboKey) ?? new Decimal(0)
          : previousClosing.get(comboKey) ?? new Decimal(0);
      const closing = opening
        .plus(components.production)
        .plus(components.transferIn)
        .minus(components.outbound)
        .minus(components.transferOut)
        .minus(components.shrinkage)
        .plus(components.correction);

      previousClosing.set(comboKey, round3(closing));

      const buckets = getLedger(location.id, grade.id).buckets(day, bucketDays);
      rows.push({
        locationId: location.id,
        gradeId: grade.id,
        date: day,
        opening: q3(opening),
        production: q3(components.production),
        transferIn: q3(components.transferIn),
        outbound: q3(components.outbound),
        transferOut: q3(components.transferOut),
        shrinkage: q3(components.shrinkage),
        correction: q3(components.correction),
        closing: q3(closing),
        inTransit: q3(inTransit.get(key(location.id, grade.id, day)) ?? new Decimal(0)),
        ageB1: q3(buckets[0]),
        ageB2: q3(buckets[1]),
        ageB3: q3(buckets[2]),
        ageB4: q3(buckets[3]),
        daysOfStock: null,
        valueRp: q2(valuationRp(closing, input.hppPerKg)),
      });
    }
  }

  // R-12 hari stok: 7 hari terakhir per lokasi; gudang memakai semua kandang.
  const kandangIds = input.locations.filter((l) => l.kind === "kandang").map((l) => l.id);
  const locationById = new Map(input.locations.map((l) => [l.id, l]));
  const rowByKey = new Map(rows.map((r) => [key(r.locationId, r.gradeId, r.date), r]));

  for (const row of rows) {
    const location = locationById.get(row.locationId);
    if (!location) continue;
    const productionValues: Decimal[] = [];
    const startWindow = days[Math.max(0, days.indexOf(row.date) - 6)];
    for (const day of eachDay(startWindow, row.date)) {
      if (location.kind === "gudang") {
        let total = new Decimal(0);
        for (const kandangId of kandangIds) {
          const candidate = rowByKey.get(key(kandangId, row.gradeId, day));
          if (candidate) total = total.plus(D(candidate.production));
        }
        productionValues.push(total);
      } else {
        const candidate = rowByKey.get(key(row.locationId, row.gradeId, day));
        productionValues.push(candidate ? D(candidate.production) : new Decimal(0));
      }
    }
    const value = daysOfStock({ closingKg: row.closing, productionKg: productionValues });
    row.daysOfStock = value === null ? null : value.toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed(3);
  }

  return rows;
}

/** Total per bucket dari baris (untuk dashboard). */
export function sumBuckets(rows: PositionRow[]): { b1: string; b2: string; b3: string; b4: string } {
  const totals = rows.reduce(
    (acc, row) => {
      acc.b1 = acc.b1.plus(D(row.ageB1));
      acc.b2 = acc.b2.plus(D(row.ageB2));
      acc.b3 = acc.b3.plus(D(row.ageB3));
      acc.b4 = acc.b4.plus(D(row.ageB4));
      return acc;
    },
    { b1: new Decimal(0), b2: new Decimal(0), b3: new Decimal(0), b4: new Decimal(0) },
  );
  return { b1: q3(totals.b1), b2: q3(totals.b2), b3: q3(totals.b3), b4: q3(totals.b4) };
}
