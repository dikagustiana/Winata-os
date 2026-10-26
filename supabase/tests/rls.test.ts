import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, asService, createTestDb, expectError } from "../../packages/db/test/pglite";

/**
 * T-02/T-18: matriks RLS 6 peran x tabel inti, dibuktikan per sel.
 * Semua data uji dimasukkan sebagai service (owner), lalu dibaca/ditulis
 * sebagai peran lewat `set role authenticated` + request.jwt.claims.
 */

const SLP = "11111111-1111-1111-1111-111111111101";
const CKL = "11111111-1111-1111-1111-111111111102";
const TSK = "11111111-1111-1111-1111-111111111103";
const SLP1 = "22222222-2222-2222-2222-222222222201";
const CKL1 = "22222222-2222-2222-2222-222222222203";
const UB = "33333333-3333-3333-3333-333333333301";
const US = "33333333-3333-3333-3333-333333333302";
const UK = "33333333-3333-3333-3333-333333333303";
const BAKUL = "55555555-5555-5555-5555-555555555501";

const USERS = {
  admin: "44444444-4444-4444-4444-444444444401",
  kandang: "44444444-4444-4444-4444-444444444402",
  manager: "44444444-4444-4444-4444-444444444403",
  accounting: "44444444-4444-4444-4444-444444444404",
  marketing: "44444444-4444-4444-4444-444444444405",
  bod: "44444444-4444-4444-4444-444444444406",
  kandangCkl: "44444444-4444-4444-4444-444444444407",
} as const;

const OUT_SLP = "aaaaaaaa-0000-0000-0000-000000000010";

let db: PGlite;
let close: () => Promise<void>;

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

beforeAll(async () => {
  const test = await createTestDb();
  db = test.db;
  close = test.close;
  await asService(db);

  await q(
    `insert into production (location_id, house_id, date, grade_id, qty, unit, kg) values
       ($1, $2, '2026-10-20', $3, 100, 'kg', 100),
       ($4, $5, '2026-10-20', $3, 80, 'kg', 80)`,
    [SLP, SLP1, UB, CKL, CKL1],
  );
  await q(
    `insert into outbound (id, location_id, do_number, customer_id, date, status)
     values ($1, $2, 'SLP/2026/10/0100', $3, '2026-10-20', 'draft')`,
    [OUT_SLP, SLP, BAKUL],
  );
  await q(
    `insert into outbound_line (outbound_id, grade_id, qty, unit, kg_doc, price_per_kg)
     values ($1, $2, 100, 'kg', 100, 26000)`,
    [OUT_SLP, UB],
  );
  await q(
    `insert into transfer (from_location_id, to_location_id, grade_id, kg, sent_date, status)
     values ($1, $2, $3, 50, '2026-10-19', 'in_transit')`,
    [SLP, TSK, UB],
  );
  await q(
    `insert into shrinkage (location_id, date, grade_id, kg, kind, reason)
     values ($1, '2026-10-20', $2, 5, 'pecah', 'uji')`,
    [SLP, UK],
  );
  await q(
    `insert into correction (location_id, effective_date, grade_id, kg, amount_rp, reason, status)
     values ($1, '2026-10-20', $2, 100, 1741900, 'uji koreksi', 'draft')`,
    [TSK, UB],
  );
  await q(
    `insert into sales_plan (customer_id, date, grade_id, kg, price_per_kg, kind)
     values ($1, '2026-10-25', $2, 500, 26000, 'order')`,
    [BAKUL, UB],
  );
  await q(
    `insert into cash_plan (week_start, category, direction, amount_rp)
     values ('2026-10-19', 'pakan', 'out', 5000000)`,
  );
  await q(
    `insert into day_status (location_id, date, status, approved_by, approved_at)
     values ($1, '2026-10-21', 'approved', $2, now()), ($1, '2026-10-22', 'locked', $2, now())`,
    [SLP, USERS.accounting],
  );
  await q(
    `insert into position_daily (location_id, grade_id, date, opening, closing, value_rp)
     values ($1, $2, '2026-10-20', 0, 100, 1741900), ($3, $2, '2026-10-20', 0, 80, 1393520)`,
    [SLP, UB, CKL],
  );
  await q(
    `insert into control_result (code, date, location_id, status, detail)
     values ('K7', '2026-10-20', $1, 'warn', '{"days":7}')`,
    [SLP],
  );
  // audit_log terisi lewat trigger saat accounting mengubah grade.
  await asRole(db, USERS.accounting);
  await q(`update grade set name = name where code = 'UB'`);
  await asService(db);
});

afterAll(async () => {
  if (close) await close();
});

const READ_EXPECTATIONS: Record<string, Record<string, number>> = {
  location: { admin: 3, accounting: 3, bod: 3, manager: 3, kandang: 3, marketing: 3 },
  grade: { admin: 5, accounting: 5, bod: 5, manager: 5, kandang: 5, marketing: 5 },
  production: { admin: 2, accounting: 2, bod: 2, manager: 2, kandang: 1, marketing: 0 },
  outbound: { admin: 1, accounting: 1, bod: 1, manager: 1, kandang: 1, marketing: 1 },
  transfer: { admin: 1, accounting: 1, bod: 1, manager: 1, kandang: 1, marketing: 0 },
  shrinkage: { admin: 1, accounting: 1, bod: 1, manager: 1, kandang: 1, marketing: 0 },
  correction: { admin: 1, accounting: 1, bod: 1, manager: 0, kandang: 0, marketing: 0 },
  sales_plan: { admin: 1, accounting: 1, bod: 1, manager: 1, kandang: 1, marketing: 1 },
  day_status: { admin: 2, accounting: 2, bod: 2, manager: 2, kandang: 2, marketing: 2 },
  position_daily: { admin: 2, accounting: 2, bod: 2, manager: 2, kandang: 2, marketing: 2 },
  app_user: { admin: 9, accounting: 9, bod: 1, manager: 1, kandang: 1, marketing: 1 },
  cash_plan: { admin: 1, accounting: 1, bod: 1, manager: 0, kandang: 0, marketing: 0 },
};

describe("T-02 matriks RLS baca 6 peran x tabel inti", () => {
  for (const [table, expectations] of Object.entries(READ_EXPECTATIONS)) {
    for (const [role, expected] of Object.entries(expectations)) {
      it(`${role} membaca ${table} = ${expected} baris`, async () => {
        const userId = role === "kandang" ? USERS.kandang : USERS[role as keyof typeof USERS];
        await asRole(db, userId);
        const rows = await q(`select * from ${table}`);
        expect(rows).toHaveLength(expected);
      });
    }
  }

  it("audit_log hanya dibaca accounting/admin", async () => {
    const expected: Record<string, boolean> = {
      admin: true, accounting: true, bod: false, manager: false, kandang: false, marketing: false,
    };
    for (const [role, canRead] of Object.entries(expected)) {
      const userId = role === "kandang" ? USERS.kandang : USERS[role as keyof typeof USERS];
      await asRole(db, userId);
      const rows = await q(`select * from audit_log`);
      if (canRead) expect(rows.length, role).toBeGreaterThan(0);
      else expect(rows.length, role).toBe(0);
    }
  });

  it("kandang lokasi A tidak melihat baris lokasi B (bukti sel)", async () => {
    await asRole(db, USERS.kandangCkl);
    const production = await q<{ location_id: string }>(`select location_id from production`);
    expect(production).toHaveLength(1);
    expect(production[0].location_id).toBe(CKL);
    const outbound = await q(`select * from outbound`);
    expect(outbound).toHaveLength(0);
  });

  it("bod hanya membaca baris app_user dirinya sendiri", async () => {
    await asRole(db, USERS.bod);
    const rows = await q<{ id: string }>("select id from app_user");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(USERS.bod);
  });
});

async function insertProduction(roleUserId: string, locationId: string, houseId: string, date: string, gradeId: string) {
  await asRole(db, roleUserId);
  return expectError(() =>
    db.query(
      `insert into production (location_id, house_id, date, grade_id, qty, unit, kg)
       values ($1, $2, $3, $4, 10, 'kg', 10)`,
      [locationId, houseId, date, gradeId],
    ),
  );
}

describe("T-18 RLS tulis transaksi", () => {
  it("kandang boleh menulis produksi lokasinya pada hari open", async () => {
    await asRole(db, USERS.kandang);
    await db.query(
      `insert into production (location_id, house_id, date, grade_id, qty, unit, kg)
       values ($1, $2, '2026-10-20', $3, 10, 'kg', 10)`,
      [SLP, SLP1, US],
    );
    expect(await q(`select * from production where grade_id = $1`, [US])).toHaveLength(1);
  });

  it("kandang DITOLAK menulis produksi lokasi lain", async () => {
    const message = await insertProduction(USERS.kandang, CKL, CKL1, "2026-10-20", UK);
    expect(message).toMatch(/row-level security|policy/i);
  });

  it("kandang DITOLAK menulis pada hari approved dan locked (R-20/K1)", async () => {
    const approved = await insertProduction(USERS.kandang, SLP, SLP1, "2026-10-21", UK);
    expect(approved).toMatch(/row-level security|policy/i);
    const locked = await insertProduction(USERS.kandang, SLP, SLP1, "2026-10-22", UK);
    expect(locked).toMatch(/row-level security|policy/i);
  });

  it("accounting boleh menulis hari approved, DITOLAK pada hari locked", async () => {
    await asRole(db, USERS.accounting);
    await db.query(
      `insert into production (location_id, house_id, date, grade_id, qty, unit, kg)
       values ($1, $2, '2026-10-21', $3, 7, 'kg', 7)`,
      [SLP, SLP1, UK],
    );
    const message = await insertProduction(USERS.accounting, SLP, SLP1, "2026-10-22", UK);
    expect(message).toMatch(/row-level security|policy/i);
  });

  it("marketing, manager, dan bod DITOLAK menulis produksi", async () => {
    for (const userId of [USERS.marketing, USERS.manager, USERS.bod]) {
      const message = await insertProduction(userId, SLP, SLP1, "2026-10-20", "33333333-3333-3333-3333-333333333304");
      expect(message, userId).toMatch(/row-level security|policy/i);
    }
  });

  it("marketing boleh membuat DO, bod tidak", async () => {
    await asRole(db, USERS.marketing);
    await db.query(
      `insert into outbound (location_id, do_number, customer_id, date, status)
       values ($1, 'TSK/2026/10/0101', $2, '2026-10-20', 'draft')`,
      [TSK, BAKUL],
    );
    const count = await q(`select * from outbound where do_number = 'TSK/2026/10/0101'`);
    expect(count).toHaveLength(1);

    await asRole(db, USERS.bod);
    const message = await expectError(() =>
      db.query(
        `insert into outbound (location_id, do_number, customer_id, date, status)
         values ($1, 'TSK/2026/10/0102', $2, '2026-10-20', 'draft')`,
        [TSK, BAKUL],
      ),
    );
    expect(message).toMatch(/row-level security|policy/i);
  });

  it("kandang hanya boleh mengubah status serah DO, bukan pelanggan/nomor", async () => {
    await asRole(db, USERS.kandang);
    const updated = await q(
      `update outbound set status = 'dikirim', delivered_at = now(), delivered_by = $1
        where id = $2 returning id`,
      [USERS.kandang, OUT_SLP],
    );
    expect(updated).toHaveLength(1);

    const message = await expectError(() =>
      db.query(`update outbound set do_number = 'SLP/2026/10/9999' where id = $1`, [OUT_SLP]),
    );
    expect(message).toMatch(/tidak boleh diubah|42501/);

    await asRole(db, USERS.kandangCkl);
    const nothing = await q(`update outbound set status = 'diterima' where id = $1 returning id`, [OUT_SLP]);
    expect(nothing).toHaveLength(0);
  });

  it("hanya accounting/admin yang boleh membuat koreksi; bod tidak", async () => {
    await asRole(db, USERS.accounting);
    await db.query(
      `insert into correction (location_id, effective_date, grade_id, kg, amount_rp, reason, status)
       values ($1, '2026-10-20', $2, 2, 34838, 'uji accounting', 'draft')`,
      [TSK, UK],
    );

    for (const userId of [USERS.bod, USERS.manager, USERS.kandang]) {
      await asRole(db, userId);
      const message = await expectError(() =>
        db.query(
          `insert into correction (location_id, effective_date, grade_id, kg, amount_rp, reason, status)
           values ($1, '2026-10-20', $2, 1, 17419, 'ditolak', 'draft')`,
          [TSK, UK],
        ),
      );
      expect(message, userId).toMatch(/row-level security|policy/i);
    }
  });

  it("bod DITOLAK mengubah approval koreksi langsung (hanya lewat RPC nanti)", async () => {
    await asRole(db, USERS.bod);
    const rows = await q(`select id from correction where status = 'draft'`);
    expect(rows.length).toBeGreaterThan(0);
    const updated = await q(
      `update correction set approved_by = $1, status = 'approved' where id = $2 returning id`,
      [USERS.bod, rows[0].id],
    );
    expect(updated).toHaveLength(0);
  });

  it("kandang tidak boleh mengubah master grade; accounting boleh", async () => {
    await asRole(db, USERS.kandang);
    const denied = await q(`update grade set name = 'X' where code = 'UB' returning id`);
    expect(denied).toHaveLength(0);

    await asRole(db, USERS.accounting);
    const allowed = await q(`update grade set name = 'Utuh Besar' where code = 'UB' returning id`);
    expect(allowed).toHaveLength(1);
  });

  it("manager boleh mengelola flok kandangnya, marketing tidak", async () => {
    await asRole(db, USERS.manager);
    await db.query(
      `insert into flock (house_id, code, strain, chick_in_date, initial_birds, status, production_start_date)
       values ($1, 'UJI-MGR-01', 'Isa Brown', '2026-01-01', 1000, 'layer', '2026-05-01')`,
      [CKL1],
    );
    expect(await q(`select * from flock where code = 'UJI-MGR-01'`)).toHaveLength(1);

    await asRole(db, USERS.marketing);
    const message = await expectError(() =>
      db.query(
        `insert into flock (house_id, code, strain, chick_in_date, initial_birds, status)
         values ($1, 'UJI-MKT-01', 'Isa Brown', '2026-01-01', 1000, 'grower')`,
        [CKL1],
      ),
    );
    expect(message).toMatch(/row-level security|policy/i);
  });

  it("audit_log tidak bisa ditulis langsung oleh peran aplikasi", async () => {
    await asRole(db, USERS.accounting);
    const message = await expectError(() =>
      db.query(
        `insert into audit_log (table_name, action) values ('grade', 'INSERT')`,
      ),
    );
    expect(message).toMatch(/row-level security|policy/i);
  });

  it("marketing tidak bisa menulis kas; accounting bisa", async () => {
    await asRole(db, USERS.marketing);
    const denied = await expectError(() =>
      db.query(
        `insert into cash_plan (week_start, category, direction, amount_rp)
         values ('2026-10-26', 'gaji', 'out', 1000000)`,
      ),
    );
    expect(denied).toMatch(/row-level security|policy/i);

    await asRole(db, USERS.accounting);
    await db.query(
      `insert into cash_plan (week_start, category, direction, amount_rp)
       values ('2026-10-26', 'gaji', 'out', 1000000)`,
    );
    expect(await q(`select * from cash_plan where week_start = '2026-10-26'`)).toHaveLength(1);
  });
});
