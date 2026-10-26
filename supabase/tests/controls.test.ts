import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asService, createTestDb } from "../../packages/db/test/pglite";
import { processControls } from "@winata/db";

const SLP = "11111111-1111-1111-1111-111111111101";
const UB = "33333333-3333-3333-3333-333333333301";

let db: PGlite;
let close: () => Promise<void>;

beforeAll(async () => {
  const test = await createTestDb();
  db = test.db;
  close = test.close;
  await asService(db);
  await db.query(
    `insert into position_daily (location_id, grade_id, date, opening, closing, age_b3, age_b4, days_of_stock, value_rp)
     values ($1, $2, '2026-10-20', 0, -5, 10, 5, 7.5, -87095)`,
    [SLP, UB],
  );
  await db.query(
    `insert into outbound (location_id, do_number, customer_id, date, status)
     values ($1, 'SLP/2026/10/0001', '55555555-5555-5555-5555-555555555501', '2026-10-20', 'draft'),
            ($1, 'SLP/2026/10/0003', '55555555-5555-5555-5555-555555555501', '2026-10-20', 'draft')`,
    [SLP],
  );
});

afterAll(async () => {
  if (close) await close();
});

describe("T-24 worker menulis control_result (R-22)", () => {
  it("menulis 7 kontrol per lokasi, warn/fail sesuai kondisi", async () => {
    const results = await processControls(db, "2026-10-20");
    expect(results).toHaveLength(21);

    const rows = await db.query<{ code: string; location_id: string; status: string; detail: Record<string, unknown> }>(
      `select code, location_id, status, detail from control_result where date = '2026-10-20'`,
    );
    expect(rows.rows).toHaveLength(21);

    const slp = rows.rows.filter((row) => row.location_id === SLP);
    expect(slp.find((row) => row.code === "K2")!.status).toBe("fail");
    expect(slp.find((row) => row.code === "K3")!.status).toBe("warn");
    expect(slp.find((row) => row.code === "K6")!.status).toBe("warn");
    expect(slp.find((row) => row.code === "K7")!.status).toBe("warn");
    expect(slp.find((row) => row.code === "K1")!.status).toBe("fail"); // tanggal lampau belum submitted
    expect(slp.find((row) => row.code === "K2")!.detail).toMatchObject({ grades: [{ grade: "UB" }] });
  });

  it("menjalankan ulang memperbarui baris yang sama (tidak menggandakan)", async () => {
    await processControls(db, "2026-10-20");
    const rows = await db.query<{ n: string }>(
      `select count(*)::text as n from control_result where date = '2026-10-20'`,
    );
    expect(rows.rows[0].n).toBe("21");
  });

  it("K1 ok bila hari sudah dikunci", async () => {
    await db.query(
      `insert into day_status (location_id, date, status)
       values ($1, '2026-10-20', 'locked')
       on conflict do nothing`,
      [SLP],
    );
    await processControls(db, "2026-10-20");
    const row = await db.query<{ status: string }>(
      `select status from control_result where code = 'K1' and date = '2026-10-20' and location_id = $1`,
      [SLP],
    );
    expect(row.rows[0].status).toBe("ok");
  });
});
