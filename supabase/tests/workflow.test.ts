import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, asService, createTestDb, expectError } from "../../packages/db/test/pglite";
import { processRebuildQueue } from "@winata/db";

const SLP = "11111111-1111-1111-1111-111111111101";
const SLP1 = "22222222-2222-2222-2222-222222222201";
const UB = "33333333-3333-3333-3333-333333333301";
const US = "33333333-3333-3333-3333-333333333302";

const USERS = {
  admin: "44444444-4444-4444-4444-444444444401",
  kandang: "44444444-4444-4444-4444-444444444402",
  manager: "44444444-4444-4444-4444-444444444403",
  accounting: "44444444-4444-4444-4444-444444444404",
  marketing: "44444444-4444-4444-4444-444444444405",
  bod: "44444444-4444-4444-4444-444444444406",
} as const;

let db: PGlite;
let close: () => Promise<void>;

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function setDayStatus(date: string, status: string, locationId = SLP) {
  await asService(db);
  await q(`delete from day_status where location_id = $1 and date = $2`, [locationId, date]);
  await q(
    `insert into day_status (location_id, date, status, submitted_by, submitted_at)
     values ($1, $2, $3, $4, case when $3 = 'open' then null else now() end)`,
    [locationId, date, status, USERS.kandang],
  );
}

async function dayRow(date: string, locationId = SLP) {
  const rows = await q<{ status: string }>(
    `select status from day_status where location_id = $1 and date = $2`,
    [locationId, date],
  );
  return rows[0]?.status ?? "open";
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

describe("T-20 transisi status (R-20)", () => {
  it("alur sah: open → submitted → approved → locked", async () => {
    const date = "2026-10-01";
    await setDayStatus(date, "open");

    await asRole(db, USERS.kandang);
    await db.query(`select submit_day($1, $2)`, [SLP, date]);
    expect(await dayRow(date)).toBe("submitted");

    await asRole(db, USERS.manager);
    await db.query(`select approve_day($1, $2)`, [SLP, date]);
    expect(await dayRow(date)).toBe("approved");

    await asRole(db, USERS.accounting);
    await db.query(`select lock_day($1, $2)`, [SLP, date]);
    expect(await dayRow(date)).toBe("locked");
  });

  it("manager boleh mengembalikan submitted → open dengan alasan", async () => {
    const date = "2026-10-02";
    await setDayStatus(date, "submitted");
    await asRole(db, USERS.manager);
    await db.query(`select return_day($1, $2, $3)`, [SLP, date, "produksi belum lengkap"]);
    expect(await dayRow(date)).toBe("open");
    const rows = await q<{ return_reason: string }>(
      `select return_reason from day_status where location_id = $1 and date = $2`,
      [SLP, date],
    );
    expect(rows[0].return_reason).toBe("produksi belum lengkap");
  });

  it("pengembalian tanpa alasan ditolak", async () => {
    const date = "2026-10-03";
    await setDayStatus(date, "submitted");
    await asRole(db, USERS.manager);
    const message = await expectError(() =>
      db.query(`select return_day($1, $2, $3)`, [SLP, date, "  "]),
    );
    expect(message).toMatch(/Alasan/);
  });

  it("submit matriks 4 status × 6 peran", async () => {
    const statuses = ["open", "submitted", "approved", "locked"];
    const roles = Object.entries(USERS);
    const allowed: Record<string, string[]> = {
      open: ["kandang", "accounting", "admin"],
      submitted: ["kandang", "accounting", "admin"],
      approved: [],
      locked: [],
    };
    let offset = 1;
    for (const status of statuses) {
      const date = `2026-09-${String(offset).padStart(2, "0")}`;
      offset += 1;
      for (const [role, userId] of roles) {
        await setDayStatus(date, status);
        const expectOk = allowed[status].includes(role);
        let message: string | null = null;
        try {
          await asRole(db, userId);
          await db.query(`select submit_day($1, $2)`, [SLP, date]);
        } catch (error) {
          message = (error as Error).message;
        }
        if (expectOk) {
          expect(message, `${role} submit ${status}`).toBeNull();
          expect(await dayRow(date)).toBe(status === "open" ? "submitted" : status);
        } else {
          expect(message, `${role} submit ${status}`).toMatch(/tidak|Peran|status/i);
        }
      }
    }
  });

  it("approve matriks 4 status × 6 peran", async () => {
    const statuses = ["open", "submitted", "approved", "locked"];
    const roles = Object.entries(USERS);
    const allowed: Record<string, string[]> = {
      open: [],
      submitted: ["manager", "admin"],
      approved: [],
      locked: [],
    };
    let offset = 5;
    for (const status of statuses) {
      const date = `2026-09-${String(offset).padStart(2, "0")}`;
      offset += 1;
      for (const [role, userId] of roles) {
        await setDayStatus(date, status);
        const expectOk = allowed[status].includes(role);
        let message: string | null = null;
        try {
          await asRole(db, userId);
          await db.query(`select approve_day($1, $2)`, [SLP, date]);
        } catch (error) {
          message = (error as Error).message;
        }
        if (expectOk) {
          expect(message, `${role} approve ${status}`).toBeNull();
        } else {
          expect(message, `${role} approve ${status}`).toMatch(/tidak|Hanya|status|submitted/i);
        }
      }
    }
  });

  it("lock matriks: hanya accounting/admin pada approved", async () => {
    const statuses = ["open", "submitted", "approved", "locked"];
    const roles = Object.entries(USERS);
    let offset = 9;
    for (const status of statuses) {
      const date = `2026-09-${String(offset).padStart(2, "0")}`;
      offset += 1;
      for (const [role, userId] of roles) {
        await setDayStatus(date, status);
        const expectOk = status === "approved" && (role === "accounting" || role === "admin");
        let message: string | null = null;
        try {
          await asRole(db, userId);
          await db.query(`select lock_day($1, $2)`, [SLP, date]);
        } catch (error) {
          message = (error as Error).message;
        }
        if (expectOk) expect(message, `${role} lock ${status}`).toBeNull();
        else expect(message, `${role} lock ${status}`).not.toBeNull();
      }
    }
  });

  it("return matriks: hanya manager/admin pada submitted", async () => {
    const roles = Object.entries(USERS);
    const date = "2026-09-13";
    for (const [role, userId] of roles) {
      await setDayStatus(date, "submitted");
      const expectOk = role === "manager" || role === "admin";
      let message: string | null = null;
      try {
        await asRole(db, userId);
        await db.query(`select return_day($1, $2, $3)`, [SLP, date, "perbaiki angka"]);
      } catch (error) {
        message = (error as Error).message;
      }
      if (expectOk) expect(message, `${role} return`).toBeNull();
      else expect(message, `${role} return`).not.toBeNull();
    }
  });
});

describe("T-21 K1 pemisahan tugas", () => {
  it("manager yang menginput produksi tidak bisa menyetujui hari itu", async () => {
    const date = "2026-10-04";
    await setDayStatus(date, "open");
    await asService(db);
    await q(
      `insert into production (location_id, house_id, date, grade_id, qty, unit, kg, created_by)
       values ($1, $2, $3, $4, 10, 'kg', 10, $5)`,
      [SLP, SLP1, date, US, USERS.manager],
    );
    await asRole(db, USERS.kandang);
    await db.query(`select submit_day($1, $2)`, [SLP, date]);

    await asRole(db, USERS.manager);
    const message = await expectError(() => db.query(`select approve_day($1, $2)`, [SLP, date]));
    expect(message).toMatch(/pemisahan tugas/i);
    expect(await dayRow(date)).toBe("submitted");

    // Manager lain (admin) tetap bisa menyetujui.
    await asRole(db, USERS.admin);
    await db.query(`select approve_day($1, $2)`, [SLP, date]);
    expect(await dayRow(date)).toBe("approved");
  });
});

describe("T-22 hari terkunci hanya berubah lewat koreksi", () => {
  it("koreksi pada hari locked diterima, posisi dibangun ulang, jejak audit ada", async () => {
    const date = "2026-10-05";
    await setDayStatus(date, "locked");

    await asRole(db, USERS.accounting);
    const inserted = await q<{ id: string }>(
      `insert into correction (location_id, effective_date, grade_id, kg, amount_rp, reason, status)
       values ($1, $2, $3, 7, 121933, 'koreksi susut', 'draft') returning id`,
      [SLP, date, UB],
    );
    await db.query(`select post_correction($1)`, [inserted[0].id]);

    const updated = await q<{ status: string }>(`select status from correction where id = $1`, [inserted[0].id]);
    expect(updated[0].status).toBe("posted");

    await asService(db);
    const processed = await processRebuildQueue(db, 10);
    expect(processed.length).toBeGreaterThan(0);

    const position = await q<{ correction: string; closing: string }>(
      `select correction, closing from position_daily
        where location_id = $1 and grade_id = $2 and date = $3`,
      [SLP, UB, date],
    );
    expect(position).toHaveLength(1);
    expect(Number(position[0].correction)).toBe(7);
    // opening T0 SLP UB 2700 + 7
    expect(Number(position[0].closing)).toBe(2707);

    const audit = await q(
      `select action from audit_log where table_name = 'correction' and row_id = $1 order by id`,
      [inserted[0].id],
    );
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });
});

describe("T-23 K9 batas BoD", () => {
  beforeAll(async () => {
    await asService(db);
    await q(`delete from position_daily`);
    await q(
      `insert into position_daily (location_id, grade_id, date, opening, closing, value_rp)
       values ($1, $2, '2026-10-18', 0, 1000000, 17419000000)`,
      [SLP, UB],
    );
  });

  async function createCorrection(kg: number, amount: number): Promise<string> {
    await asRole(db, USERS.accounting);
    const rows = await q<{ id: string }>(
      `insert into correction (location_id, effective_date, grade_id, kg, amount_rp, reason, status)
       values ($1, '2026-10-19', $2, $3, $4, 'uji K9', 'draft') returning id`,
      [SLP, UB, kg, amount],
    );
    return rows[0].id;
  }

  it("Rp 8 juta di bawah batas berhasil diposting", async () => {
    const id = await createCorrection(1, 8_000_000);
    await asRole(db, USERS.accounting);
    await db.query(`select post_correction($1)`, [id]);
    expect((await q<{ status: string }>(`select status from correction where id = $1`, [id]))[0].status).toBe("posted");
  });

  it("Rp 12 juta tanpa BoD gagal diposting", async () => {
    const id = await createCorrection(1, 12_000_000);
    await asRole(db, USERS.accounting);
    const message = await expectError(() => db.query(`select post_correction($1)`, [id]));
    expect(message).toMatch(/BoD/);
    expect((await q<{ status: string }>(`select status from correction where id = $1`, [id]))[0].status).toBe("draft");
  });

  it("2,5 % stok lokasi tanpa BoD gagal diposting", async () => {
    const id = await createCorrection(26_000, 1_000_000);
    await asRole(db, USERS.accounting);
    const message = await expectError(() => db.query(`select post_correction($1)`, [id]));
    expect(message).toMatch(/BoD/);
  });

  it("koreksi Rp 12 juta berhasil setelah disetujui BoD", async () => {
    const id = await createCorrection(1, 12_000_000);
    await asRole(db, USERS.bod);
    await db.query(`select approve_correction($1)`, [id]);
    await asRole(db, USERS.accounting);
    await db.query(`select post_correction($1)`, [id]);
    expect((await q<{ status: string }>(`select status from correction where id = $1`, [id]))[0].status).toBe("posted");
  });

  it("BoD tidak bisa memposting sendiri", async () => {
    const id = await createCorrection(1, 1_000_000);
    await asRole(db, USERS.bod);
    const message = await expectError(() => db.query(`select post_correction($1)`, [id]));
    expect(message).toMatch(/accounting/i);
  });
});

describe("T-25 K2 stok negatif memblokir approve", () => {
  it("closing negatif tidak bisa disetujui sampai diperbaiki", async () => {
    const date = "2026-10-06";
    await setDayStatus(date, "submitted");
    await asService(db);
    await q(
      `insert into position_daily (location_id, grade_id, date, opening, closing, value_rp)
       values ($1, $2, $3, 0, -5, -87095)
       on conflict (location_id, grade_id, date) do update set closing = -5`,
      [SLP, UB, date],
    );

    await asRole(db, USERS.manager);
    const message = await expectError(() => db.query(`select approve_day($1, $2)`, [SLP, date]));
    expect(message).toMatch(/negatif/i);

    await asService(db);
    await q(
      `update position_daily set closing = 5 where location_id = $1 and grade_id = $2 and date = $3`,
      [SLP, UB, date],
    );
    await asRole(db, USERS.manager);
    await db.query(`select approve_day($1, $2)`, [SLP, date]);
    expect(await dayRow(date)).toBe("approved");
  });
});

describe("T-26 K4 selisih fisik memblokir lock tanpa penjelasan", () => {
  async function seedPhysicalCount(note: string | null) {
    await asService(db);
    await q(`delete from physical_count where location_id = $1 and date = '2026-10-07'`, [SLP]);
    const header = await q<{ id: string }>(
      `insert into physical_count (location_id, date, note)
       values ($1, '2026-10-07', $2) returning id`,
      [SLP, note],
    );
    await q(
      `insert into physical_count_line (physical_count_id, grade_id, kg, computed_kg, diff_kg)
       values ($1, $2, 900, 1000, -100)`,
      [header[0].id, UB],
    );
  }

  it("tanpa catatan, lock ditolak", async () => {
    const date = "2026-10-07";
    await setDayStatus(date, "approved");
    await seedPhysicalCount(null);
    await asRole(db, USERS.accounting);
    const message = await expectError(() => db.query(`select lock_day($1, $2)`, [SLP, date]));
    expect(message).toMatch(/penjelasan/i);
    expect(await dayRow(date)).toBe("approved");
  });

  it("dengan catatan, lock berhasil", async () => {
    const date = "2026-10-07";
    await setDayStatus(date, "approved");
    await seedPhysicalCount("selisih karena telur pecah saat bongkar");
    await asRole(db, USERS.accounting);
    await db.query(`select lock_day($1, $2)`, [SLP, date]);
    expect(await dayRow(date)).toBe("locked");
  });
});
