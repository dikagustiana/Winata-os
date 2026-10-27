import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asService, createTestDb } from "../../packages/db/test/pglite";
import { processRebuildQueue, rebuildAll, rebuildPositions, rollForward } from "@winata/db";

const SLP = "11111111-1111-1111-1111-111111111101";
const TSK = "11111111-1111-1111-1111-111111111103";
const SLP1 = "22222222-2222-2222-2222-222222222201";
const UB = "33333333-3333-3333-3333-333333333301";

let db: PGlite;
let close: () => Promise<void>;

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function position(locationId: string, date: string) {
  const rows = await q<{
    opening: string;
    production: string;
    transfer_in: string;
    in_transit: string;
    closing: string;
    computed_at: Date | string;
  }>(
    `select opening, production, transfer_in, in_transit, closing, computed_at
       from position_daily where location_id = $1 and grade_id = $2 and date = $3`,
    [locationId, UB, date],
  );
  return rows[0];
}

beforeAll(async () => {
  const test = await createTestDb();
  db = test.db;
  close = test.close;
  await asService(db);
});

afterAll(async () => {
  if (close) await close();
});

describe("T-13 opname T0 menjadi opening hari pertama (K6)", () => {
  it("membaca kg opname sebagai opening 1 Juli 2026", async () => {
    await rebuildAll(db, "2026-10-26");
    const row = await position(SLP, "2026-07-01");
    expect(Number(row.opening)).toBe(2700);
    expect(Number(row.closing)).toBe(2700);
  });

  it("mengubah opname menggeser opening setelah rebuild", async () => {
    await q(
      `update opname_line set kg = 2800
        where opname_id = '77777777-7777-7777-7777-777777777701'
          and grade_id = $1`,
      [UB],
    );
    await rebuildPositions(db, { locationIds: [SLP], fromDate: "2026-07-01", toDate: "2026-10-26" });
    const row = await position(SLP, "2026-07-02");
    expect(Number(row.opening)).toBe(2800);
  });
});

describe("T-15 mutasi: keluar asal pada kirim, masuk tujuan pada terima", () => {
  it("barang di jalan tampil di tujuan, belum menambah posisi", async () => {
    await q(
      `insert into transfer (id, from_location_id, to_location_id, grade_id, kg, sent_date, status)
       values ('bbbbbbbb-0000-0000-0000-000000000001', $1, $2, $3, 50, '2026-10-25', 'in_transit')`,
      [SLP, TSK, UB],
    );
    await rebuildPositions(db, { locationIds: [TSK], fromDate: "2026-10-24", toDate: "2026-10-26" });
    const row = await position(TSK, "2026-10-25");
    expect(Number(row.in_transit)).toBe(50);
    expect(Number(row.transfer_in)).toBe(0);
    const before = await position(TSK, "2026-10-24");
    expect(Number(row.closing) - Number(before.closing)).toBe(0);
  });

  it("setelah diterima, kg masuk pada tanggal terima dan di jalan nol", async () => {
    await q(
      `update transfer set status = 'received', received_date = '2026-10-26'
        where id = 'bbbbbbbb-0000-0000-0000-000000000001'`,
    );
    await rebuildPositions(db, { locationIds: [TSK], fromDate: "2026-10-25", toDate: "2026-10-26" });
    const received = await position(TSK, "2026-10-26");
    const before = await position(TSK, "2026-10-25");
    expect(Number(received.transfer_in)).toBe(50);
    expect(Number(received.in_transit)).toBe(0);
    expect(Number(received.closing) - Number(before.closing)).toBe(50);
  });
});

describe("T-16 rebuild hanya dari tanggal yang berubah + klaim atomik", () => {
  it("mengubah transaksi tanggal d hanya menulis ulang d..hari ini", async () => {
    await rebuildAll(db, "2026-10-26");
    await q(`delete from rebuild_queue`);
    const before = await position(SLP, "2026-10-23");
    const beforeTime = new Date(before.computed_at).getTime();

    await new Promise((resolve) => setTimeout(resolve, 15));
    await q(
      `insert into production (location_id, house_id, date, grade_id, qty, unit, kg)
       values ($1, $2, '2026-10-24', $3, 100, 'kg', 100)`,
      [SLP, SLP1, UB],
    );

    const queue = await q<{ location_id: string; from_date: string }>(
      `select location_id, from_date from rebuild_queue`,
    );
    expect(queue).toContainEqual({ location_id: SLP, from_date: "2026-10-24" });

    const processed = await processRebuildQueue(db, 10);
    expect(processed.some((row) => row.locationId === SLP)).toBe(true);

    const after = await position(SLP, "2026-10-23");
    expect(new Date(after.computed_at).getTime()).toBe(beforeTime);
    const updated = await position(SLP, "2026-10-24");
    expect(Number(updated.production)).toBe(100);
  });

  it("dua klaim tidak pernah membangun lokasi yang sama", async () => {
    await q(`delete from rebuild_queue`);
    await q(`select enqueue_rebuild($1, '2026-10-20')`, [SLP]);
    await q(`select enqueue_rebuild($1, '2026-10-20')`, [TSK]);

    const first = await q<{ location_id: string; from_date: string }>(`select * from claim_rebuild(1)`);
    const second = await q<{ location_id: string; from_date: string }>(`select * from claim_rebuild(1)`);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0].location_id).not.toBe(second[0].location_id);

    const third = await q(`select * from claim_rebuild(1)`);
    expect(third).toHaveLength(0);

    await q(`select mark_rebuild_done($1)`, [first[0].location_id]);
    await q(`select mark_rebuild_done($1)`, [second[0].location_id]);
  });

  it("tepat 7 tanggal: aksi inline memproses antrean tanpa cron", async () => {
    await q(`delete from rebuild_queue`);
    await q(
      `insert into production (location_id, house_id, date, grade_id, qty, unit, kg)
       values ($1, $2, '2026-10-25', $3, 25, 'kg', 25)`,
      [SLP, SLP1, UB],
    );
    const processed = await processRebuildQueue(db, 1);
    expect(processed).toHaveLength(1);
    expect(processed[0].rowsWritten).toBeGreaterThan(0);
  });
});

describe("rollForward: posisi sampai hari ini tanpa transaksi baru", () => {
  it("mengisi hanya tanggal yang hilang, angkanya sama dengan rebuild penuh, lalu idempoten", async () => {
    await q(`delete from position_daily`);
    await rebuildPositions(db, { toDate: "2026-10-26" });
    const full = await q(`select * from position_daily order by location_id, grade_id, date`);

    await q(`delete from position_daily where date > '2026-10-20'`);
    const result = await rollForward(db, "2026-10-26");
    expect(result?.fromDate).toBe("2026-10-21");
    expect(result?.toDate).toBe("2026-10-26");
    const rolled = await q(`select * from position_daily order by location_id, grade_id, date`);
    const strip = (rows: Record<string, unknown>[]) => rows.map(({ id: _i, computed_at: _c, inputs_hash: _h, ...rest }) => rest);
    expect(strip(rolled)).toEqual(strip(full));

    expect(await rollForward(db, "2026-10-26")).toBeNull();
  });

  it("tabel kosong tidak dibangun (bootstrap T0 lewat ?full=1)", async () => {
    await q(`delete from position_daily`);
    expect(await rollForward(db, "2026-10-26")).toBeNull();
    const count = await q<{ n: string }>(`select count(*)::text as n from position_daily`);
    expect(count[0].n).toBe("0");
  });
});
