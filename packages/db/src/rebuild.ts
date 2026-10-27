import { createHash } from "node:crypto";
import type { Queryable } from "./queryable";
import {
  D,
  addDays,
  computePosition,
  type ComputePositionInput,
  type CorrectionTxn,
  type OutboundTxn,
  type PositionRow,
  type ProductionTxn,
  type ShrinkageTxn,
  type TransferTxn,
} from "@winata/engine";

export function todayJakarta(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function parseParameter(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

export async function getParameter<T = unknown>(db: Queryable, key: string, fallback?: T): Promise<T> {
  const result = await db.query<{ value: unknown }>(
    `select value from parameter
      where key = $1 and deleted_at is null and valid_from <= current_date
      order by valid_from desc limit 1`,
    [key],
  );
  if (result.rows.length === 0) return fallback as T;
  return parseParameter(result.rows[0].value) as T;
}

export interface RebuildOptions {
  /** Batasi lokasi yang ditulis; perhitungan tetap dari jangkar agar aging tepat. */
  locationIds?: string[];
  /** Tanggal pertama yang ditulis ulang (inklusif). Default: jangkar T0. */
  fromDate?: string;
  /** Default: hari ini (Asia/Jakarta). */
  toDate?: string;
  /** Paksa hitung ulang dari jangkar untuk lokasi tanpa opname. */
  anchorDate?: string;
}

export interface RebuildResult {
  locations: number;
  fromDate: string;
  toDate: string;
  rowsWritten: number;
}

interface DataBundle {
  input: ComputePositionInput;
  anchorDate: string;
}

async function loadData(db: Queryable, toDate: string, anchorOverride?: string): Promise<DataBundle> {
  const locationsResult = await db.query<{ id: string; code: string; kind: "kandang" | "gudang" }>(
    `select id, code, kind from location where active and deleted_at is null order by code`,
  );
  const gradesResult = await db.query<{ id: string; code: string }>(
    `select id, code from grade where active and deleted_at is null order by sort, code`,
  );
  const locations = locationsResult.rows;
  const grades = gradesResult.rows;

  const opnameRows = await db.query<{ location_id: string; date: string; grade_id: string; kg: string }>(
    `select o.location_id, o.date, ol.grade_id, ol.kg
       from opname o
       join opname_line ol on ol.opname_id = o.id
      where o.status = 'signed' and o.deleted_at is null and ol.deleted_at is null
      order by o.location_id, o.date asc`,
  );

  const anchorByLocation = new Map<string, string>();
  for (const row of opnameRows.rows) {
    if (!anchorByLocation.has(row.location_id)) anchorByLocation.set(row.location_id, row.date);
  }
  const parameterAnchor = anchorOverride ?? (await getParameter<string>(db, "opname_t0_date", toDate));
  const knownAnchors = Array.from(anchorByLocation.values());
  const anchorDate = knownAnchors.length > 0
    ? knownAnchors.reduce((min, d) => (d < min ? d : min))
    : parameterAnchor;

  const opening = opnameRows.rows
    .filter((r) => anchorByLocation.get(r.location_id) === r.date)
    .map((r) => ({ locationId: r.location_id, gradeId: r.grade_id, kg: r.kg }));

  const productionResult = await db.query<ProductionTxn>(
    `select location_id as "locationId", grade_id as "gradeId", date, sum(kg) as kg
       from production
      where deleted_at is null and date between $1 and $2
      group by location_id, grade_id, date`,
    [anchorDate, toDate],
  );

  const outboundResult = await db.query<OutboundTxn>(
    `select o.location_id as "locationId", ol.grade_id as "gradeId", o.date,
            sum(coalesce(ol.kg_delivered, ol.kg_doc)) as kg
       from outbound o
       join outbound_line ol on ol.outbound_id = o.id
      where o.deleted_at is null and ol.deleted_at is null
        and o.status in ('dikirim','diterima')
        and o.date between $1 and $2
      group by o.location_id, ol.grade_id, o.date`,
    [anchorDate, toDate],
  );

  const transferResult = await db.query<Omit<TransferTxn, "kg"> & { kg: string }>(
    `select id, from_location_id as "fromLocationId", to_location_id as "toLocationId",
            grade_id as "gradeId", kg, sent_date as "sentDate",
            received_date as "receivedDate", status
       from transfer
      where deleted_at is null and sent_date between $1 and $2`,
    [anchorDate, toDate],
  );

  const shrinkageResult = await db.query<ShrinkageTxn>(
    `select location_id as "locationId", grade_id as "gradeId", date, sum(kg) as kg
       from shrinkage
      where deleted_at is null and date between $1 and $2
      group by location_id, grade_id, date`,
    [anchorDate, toDate],
  );

  const correctionResult = await db.query<CorrectionTxn>(
    `select location_id as "locationId", grade_id as "gradeId",
            effective_date as "effectiveDate", kg, status
       from correction
      where deleted_at is null and status = 'posted'
        and effective_date between $1 and $2`,
    [anchorDate, toDate],
  );

  const hpp = await getParameter<number | string>(db, "hpp_per_kg", 17419);
  const buckets = await getParameter<number[]>(db, "age_buckets_days", [3, 7, 14]);

  return {
    anchorDate,
    input: {
      locations,
      grades,
      startDate: anchorDate,
      endDate: toDate,
      openingDate: anchorDate,
      opening,
      production: productionResult.rows,
      outbound: outboundResult.rows,
      transfer: (transferResult.rows as Array<Omit<TransferTxn, "kg"> & { kg: string }>).map((t) => ({
        ...t,
        kg: t.kg,
      })) as TransferTxn[],
      shrinkage: shrinkageResult.rows,
      correction: correctionResult.rows,
      hppPerKg: hpp,
      bucketDays: Array.isArray(buckets) && buckets.length === 3
        ? [Number(buckets[0]), Number(buckets[1]), Number(buckets[2])]
        : [3, 7, 14],
    },
  };
}

function hashInputs(input: ComputePositionInput): string {
  return createHash("sha256")
    .update(JSON.stringify({
      s: input.startDate,
      e: input.endDate,
      o: input.opening,
      p: input.production,
      ob: input.outbound,
      t: input.transfer,
      sh: input.shrinkage,
      c: input.correction,
      h: input.hppPerKg,
    }))
    .digest("hex")
    .slice(0, 32);
}

async function writeRows(db: Queryable, rows: PositionRow[], hash: string): Promise<number> {
  if (rows.length === 0) return 0;
  const chunkSize = 150;
  let written = 0;
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const values = [
        row.locationId, row.gradeId, row.date, row.opening, row.production, row.transferIn,
        row.outbound, row.transferOut, row.shrinkage, row.correction, row.closing, row.inTransit,
        row.ageB1, row.ageB2, row.ageB3, row.ageB4, row.daysOfStock, row.valueRp, hash,
      ];
      const placeholders = values.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await db.query(
      `insert into position_daily
        (location_id, grade_id, date, opening, production, transfer_in, outbound, transfer_out,
         shrinkage, correction, closing, in_transit, age_b1, age_b2, age_b3, age_b4,
         days_of_stock, value_rp, inputs_hash)
       values ${tuples.join(", ")}
       on conflict (location_id, grade_id, date) do update set
         opening = excluded.opening,
         production = excluded.production,
         transfer_in = excluded.transfer_in,
         outbound = excluded.outbound,
         transfer_out = excluded.transfer_out,
         shrinkage = excluded.shrinkage,
         correction = excluded.correction,
         closing = excluded.closing,
         in_transit = excluded.in_transit,
         age_b1 = excluded.age_b1,
         age_b2 = excluded.age_b2,
         age_b3 = excluded.age_b3,
         age_b4 = excluded.age_b4,
         days_of_stock = excluded.days_of_stock,
         value_rp = excluded.value_rp,
         computed_at = now(),
         inputs_hash = excluded.inputs_hash`,
      params,
    );
    written += chunk.length;
  }
  return written;
}

/**
 * R-15: membangun ulang position_daily. Perhitungan selalu dimulai dari jangkar
 * agar FIFO/aging tepat; hanya tanggal >= fromDate yang ditulis (R-15/R-16).
 */
export async function rebuildPositions(db: Queryable, options: RebuildOptions = {}): Promise<RebuildResult> {
  const toDate = options.toDate ?? todayJakarta();
  const { input, anchorDate } = await loadData(db, toDate, options.anchorDate);
  const fromDate = options.fromDate ?? anchorDate;
  const rows = computePosition(input);

  const locationFilter = options.locationIds ? new Set(options.locationIds) : null;
  const filtered = rows.filter(
    (row) =>
      row.date >= fromDate &&
      row.date <= toDate &&
      (locationFilter === null || locationFilter.has(row.locationId)),
  );

  const hash = hashInputs(input);
  const written = await writeRows(db, filtered, hash);
  return {
    locations: locationFilter?.size ?? input.locations.length,
    fromDate,
    toDate,
    rowsWritten: written,
  };
}

/** Bangun ulang seluruh lokasi (dipakai saat inisialisasi DB lokal). */
export async function rebuildAll(db: Queryable, toDate?: string): Promise<RebuildResult> {
  const result = await db.query<{ count: string }>(
    `select count(*)::text as count from position_daily`,
  );
  const fromDate = result.rows[0]?.count === "0" ? undefined : todayJakarta();
  return rebuildPositions(db, { fromDate, toDate });
}

/**
 * Isi position_daily sampai hari ini walau tidak ada transaksi baru: aging dan
 * hari stok berubah tiap hari, dan kontrol membaca posisi hari ini. Antrean hanya
 * terisi oleh transaksi, jadi hari tanpa input tidak pernah dibangun tanpa ini.
 * Tabel kosong = bangun penuh dari jangkar T0.
 */
export async function rollForward(db: Queryable, today = todayJakarta()): Promise<RebuildResult | null> {
  const result = await db.query<{ last: string | null }>(`select max(date)::text as last from position_daily`);
  const last = result.rows[0]?.last ?? null;
  if (last === null) return rebuildPositions(db, { toDate: today });
  if (last >= today) return null;
  return rebuildPositions(db, { fromDate: addDays(last, 1), toDate: today });
}

export interface ProcessedRebuild {
  locationId: string;
  fromDate: string;
  rowsWritten: number;
}

/**
 * Worker: klaim antrean secara atomik, bangun ulang per lokasi, tandai selesai.
 * Dua pemanggil bersamaan tidak membangun lokasi yang sama (claim_rebuild).
 * Berjalan di PGlite (lokal/tes) dan pg cloud lewat Queryable (K17).
 */
export async function processRebuildQueue(db: Queryable, limit = 5): Promise<ProcessedRebuild[]> {
  const claimed = await db.query<{ location_id: string; from_date: string; generation: string | number }>(
    `select location_id, from_date, generation from claim_rebuild($1)`,
    [limit],
  );
  const processed: ProcessedRebuild[] = [];
  for (const row of claimed.rows) {
    const result = await rebuildPositions(db, {
      locationIds: [row.location_id],
      fromDate: row.from_date,
    });
    // R-65: hanya 'done' bila tidak ada enqueue baru selama rebuild berjalan;
    // selain itu baris kembali 'queued' dengan from_date terkecil.
    await db.query(`select mark_rebuild_done($1::uuid, $2::bigint)`, [row.location_id, String(row.generation)]);
    processed.push({ locationId: row.location_id, fromDate: row.from_date, rowsWritten: result.rowsWritten });
  }
  return processed;
}

/** Untuk tes/aksi: antre lalu langsung proses (inline <= 7 tanggal). */
export async function rebuildLocationFrom(db: Queryable, locationId: string, fromDate: string): Promise<RebuildResult> {
  await db.query(`select enqueue_rebuild($1, $2)`, [locationId, fromDate]);
  return rebuildPositions(db, { locationIds: [locationId], fromDate });
}

export function closingFor(rows: PositionRow[], locationId: string, gradeId: string, date: string): string {
  const row = rows.find((r) => r.locationId === locationId && r.gradeId === gradeId && r.date === date);
  return row ? row.closing : D(0).toFixed(3);
}
