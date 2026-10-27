import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, asService, createTestDb, expectError } from "../../packages/db/test/pglite";

/**
 * v1.1 hardening (PRD-v1.1 §4): T-70…T-79. Setiap tes mereproduksi temuan
 * F-1…F-11 lewat jalur langsung (seperti PostgREST), bukan lewat aksi app.
 */

const SLP = "11111111-1111-1111-1111-111111111101";
const CKL = "11111111-1111-1111-1111-111111111102";
const SLP2 = "22222222-2222-2222-2222-222222222202";
const CKL1 = "22222222-2222-2222-2222-222222222203";
const UB = "33333333-3333-3333-3333-333333333301";
const US = "33333333-3333-3333-3333-333333333302";
const RT = "33333333-3333-3333-3333-333333333304";
const BAKUL = "55555555-5555-5555-5555-555555555501";
const OPNAME_CKL = "77777777-7777-7777-7777-777777777702";

const USERS = {
  admin: "44444444-4444-4444-4444-444444444401",
  kandang: "44444444-4444-4444-4444-444444444402",
  manager: "44444444-4444-4444-4444-444444444403",
  accounting: "44444444-4444-4444-4444-444444444404",
  marketing: "44444444-4444-4444-4444-444444444405",
  bod: "44444444-4444-4444-4444-444444444406",
  kandangCkl: "44444444-4444-4444-4444-444444444407",
} as const;

let db: PGlite;
let close: () => Promise<void>;

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function setDay(locationId: string, date: string, status: string) {
  await asService(db);
  await q(`delete from day_status where location_id = $1 and date = $2`, [locationId, date]);
  await q(`insert into day_status (location_id, date, status) values ($1, $2, $3)`, [locationId, date, status]);
}

beforeAll(async () => {
  const test = await createTestDb();
  db = test.db;
  close = test.close;
  await asService(db);
  // Stok besar agar batas % K9 tidak ikut menentukan (hanya batas Rp).
  await q(
    `insert into position_daily (location_id, grade_id, date, opening, closing, value_rp)
     values ($1, $2, '2026-10-18', 0, 1000000, 17419000000)`,
    [SLP, UB],
  );
});

afterAll(async () => {
  if (close) await close();
});

describe("T-70 koreksi hanya berstatus draft saat dibuat (F-1)", () => {
  it("insert status posted/approved oleh accounting ditolak", async () => {
    for (const status of ["posted", "approved"]) {
      await asRole(db, USERS.accounting);
      const message = await expectError(() =>
        db.query(
          `insert into correction (location_id, effective_date, grade_id, kg, amount_rp, reason, status, approved_by, approved_at, posted_at)
           values ($1, '2026-10-19', $2, 3000, 50000000, 'jalan pintas', $3, $4, now(), now())`,
          [SLP, UB, status, USERS.bod],
        ),
      );
      expect(message, status).toMatch(/Status koreksi hanya berubah lewat tombol Setujui/);
    }
    await asService(db);
    expect(await q(`select id from correction where reason = 'jalan pintas'`)).toHaveLength(0);
  });

  it("insert draft dengan approved_by terisi ditolak", async () => {
    await asRole(db, USERS.accounting);
    const message = await expectError(() =>
      db.query(
        `insert into correction (location_id, effective_date, grade_id, kg, amount_rp, reason, status, approved_by)
         values ($1, '2026-10-19', $2, 1, 1000, 'draft palsu', 'draft', $3)`,
        [SLP, UB, USERS.bod],
      ),
    );
    expect(message).toMatch(/Status koreksi hanya berubah lewat tombol Setujui/);
  });

  it("ubah status langsung (tanpa RPC) ditolak", async () => {
    await asRole(db, USERS.accounting);
    const rows = await q<{ id: string }>(
      `insert into correction (location_id, effective_date, grade_id, kg, amount_rp, reason, status)
       values ($1, '2026-10-19', $2, 1, 1000, 'draft sah', 'draft') returning id`,
      [SLP, UB],
    );
    const message = await expectError(() =>
      db.query(`update correction set status = 'posted', posted_at = now() where id = $1`, [rows[0].id]),
    );
    expect(message).toMatch(/Status koreksi hanya berubah lewat tombol Setujui/);
  });
});

describe("T-71 persetujuan BoD gugur saat isi koreksi berubah (F-2)", () => {
  it("approve → ubah Rp → kembali draft → posting ditolak → approve ulang → posted", async () => {
    await asRole(db, USERS.accounting);
    const rows = await q<{ id: string }>(
      `insert into correction (location_id, effective_date, grade_id, kg, amount_rp, reason, status)
       values ($1, '2026-10-19', $2, 1, 11000000, 'selisih opname', 'draft') returning id`,
      [SLP, UB],
    );
    const id = rows[0].id;

    await asRole(db, USERS.bod);
    await db.query(`select approve_correction($1)`, [id]);

    await asRole(db, USERS.accounting);
    await db.query(`update correction set amount_rp = 12000000 where id = $1`, [id]);
    const after = await q<{ status: string; approved_by: string | null; approved_at: string | null }>(
      `select status, approved_by, approved_at from correction where id = $1`,
      [id],
    );
    expect(after[0]).toMatchObject({ status: "draft", approved_by: null, approved_at: null });

    const message = await expectError(() => db.query(`select post_correction($1)`, [id]));
    expect(message).toMatch(/BoD/);

    await asRole(db, USERS.bod);
    await db.query(`select approve_correction($1)`, [id]);
    await asRole(db, USERS.accounting);
    await db.query(`select post_correction($1)`, [id]);
    const posted = await q<{ status: string }>(`select status from correction where id = $1`, [id]);
    expect(posted[0].status).toBe("posted");

    // Koreksi posted immutable.
    const immutable = await expectError(() =>
      db.query(`update correction set kg = 30000 where id = $1`, [id]),
    );
    expect(immutable).toMatch(/sudah diposting/);
  });
});

describe("T-72 jejak aktor tidak bisa dipalsukan (F-3)", () => {
  const date = "2026-10-08";

  it("created_by dipaksa auth.uid(); update created_by ditolak; skenario F-3 ditolak K1", async () => {
    await setDay(SLP, date, "open");
    await asRole(db, USERS.manager);
    const inserted = await q<{ id: string; created_by: string }>(
      `insert into physical_count (location_id, date, note, created_by)
       values ($1, $2, 'hitung atas nama kandang', $3) returning id, created_by`,
      [SLP, date, USERS.kandang],
    );
    expect(inserted[0].created_by).toBe(USERS.manager);

    const message = await expectError(() =>
      db.query(`update physical_count set created_by = $1 where id = $2`, [USERS.kandang, inserted[0].id]),
    );
    expect(message).toMatch(/created_by/);

    await asRole(db, USERS.kandang);
    await db.query(`select submit_day($1, $2)`, [SLP, date]);

    await asRole(db, USERS.manager);
    const k1 = await expectError(() => db.query(`select approve_day($1, $2)`, [SLP, date]));
    expect(k1).toMatch(/pemisahan tugas/);
  });

  it("kolom aktor lain hanya boleh diisi diri sendiri", async () => {
    await setDay(SLP, "2026-10-09", "open");
    await asRole(db, USERS.manager);
    const message = await expectError(() =>
      db.query(
        `insert into physical_count (location_id, date, counted_by) values ($1, '2026-10-09', $2)`,
        [SLP, USERS.kandang],
      ),
    );
    expect(message).toMatch(/aktor|diri sendiri/i);
  });
});

describe("T-73 tidak ada hard delete; batalkan dengan jejak (F-4)", () => {
  const roles = ["admin", "kandang", "manager", "accounting", "marketing", "bod"] as const;
  const tables = [
    "production", "shrinkage", "outbound", "outbound_line", "transfer", "physical_count", "opname", "correction",
    "location", "grade", "customer", "parameter",
  ];

  it("delete oleh 6 peran pada 8 tabel transaksi + 4 master ditolak", async () => {
    for (const role of roles) {
      for (const table of tables) {
        await asRole(db, USERS[role]);
        const message = await expectError(() => db.query(`delete from ${table} where id is null`));
        expect(message, `${role} delete ${table}`).toMatch(/permission denied/i);
      }
    }
  });

  it("marketing tidak bisa membatalkan DO di hari locked", async () => {
    await setDay(SLP, "2026-10-12", "locked");
    await asService(db);
    const rows = await q<{ id: string }>(
      `insert into outbound (location_id, do_number, customer_id, date, status)
       values ($1, 'SLP/202610/9001', $2, '2026-10-12', 'draft') returning id`,
      [SLP, BAKUL],
    );
    await asRole(db, USERS.marketing);
    let rejected = false;
    try {
      const updated = await q(
        `update outbound set deleted_at = now(), delete_reason = 'salah pelanggan' where id = $1 returning id`,
        [rows[0].id],
      );
      rejected = updated.length === 0;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
    await asService(db);
    const still = await q<{ deleted_at: string | null }>(`select deleted_at from outbound where id = $1`, [rows[0].id]);
    expect(still[0].deleted_at).toBeNull();
  });

  it("opname signed: batal tanpa alasan ditolak, dengan alasan diterima dan mengantre rebuild", async () => {
    await asService(db);
    await q(`delete from rebuild_queue`);
    await asRole(db, USERS.accounting);
    const message = await expectError(() =>
      db.query(`update opname set deleted_at = now() where id = $1`, [OPNAME_CKL]),
    );
    expect(message).toMatch(/Alasan pembatalan wajib diisi/);

    const updated = await q(
      `update opname set deleted_at = now(), delete_reason = 'BA dihitung ulang karena salah grade' where id = $1 returning id`,
      [OPNAME_CKL],
    );
    expect(updated).toHaveLength(1);

    await asService(db);
    const queue = await q<{ from_date: string }>(`select from_date from rebuild_queue where location_id = $1`, [CKL]);
    expect(queue[0]?.from_date).toBe("2026-07-01");

    await asRole(db, USERS.accounting);
    const revive = await expectError(() =>
      db.query(`update opname set deleted_at = null where id = $1`, [OPNAME_CKL]),
    );
    expect(revive).toMatch(/dibatalkan/);
  });
});

describe("T-74 akun Auth tertaut ke app_user yang sudah ada (F-5)", () => {
  const TEMP = "44444444-4444-4444-4444-4444444444aa";

  it("insert auth.users dengan e-mail sama menyamakan id dan FK ikut", async () => {
    await asService(db);
    await q(`insert into app_user (id, email, name, role) values ($1, 'baru@winata.test', 'Baru', 'kandang')`, [TEMP]);
    await q(`insert into user_location (user_id, location_id) values ($1, $2)`, [TEMP, CKL]);
    await q(`delete from day_status where location_id = $1 and date = '2026-09-20'`, [CKL]);
    await q(
      `insert into day_status (location_id, date, status, submitted_by, submitted_at)
       values ($1, '2026-09-20', 'submitted', $2, now())`,
      [CKL, TEMP],
    );

    const auth = await q<{ id: string }>(`insert into auth.users (email) values ('baru@winata.test') returning id`);
    const authId = auth[0].id;
    expect(authId).not.toBe(TEMP);

    const user = await q<{ id: string }>(`select id from app_user where email = 'baru@winata.test'`);
    expect(user[0].id).toBe(authId);
    const assignment = await q<{ user_id: string }>(`select user_id from user_location where location_id = $1 and user_id = $2`, [CKL, authId]);
    expect(assignment).toHaveLength(1);
    const day = await q<{ submitted_by: string }>(
      `select submitted_by from day_status where location_id = $1 and date = '2026-09-20'`,
      [CKL],
    );
    expect(day[0].submitted_by).toBe(authId);
  });

  it("create_login membuat login dengan id = app_user.id", async () => {
    await asService(db);
    await q(`insert into app_user (email, name, role) values ('login.baru@winata.test', 'Login Baru', 'bod')`);
    const created = await q<{ id: string }>(`select create_login('login.baru@winata.test', 'rahasia-panjang') as id`);
    const user = await q<{ id: string }>(`select id from app_user where email = 'login.baru@winata.test'`);
    const auth = await q<{ id: string }>(`select id from auth.users where email = 'login.baru@winata.test'`);
    expect(created[0].id).toBe(user[0].id);
    expect(auth[0].id).toBe(user[0].id);
  });

  it("e-mail di luar allow-list tetap ditolak", async () => {
    await asService(db);
    const message = await expectError(() => db.query(`insert into auth.users (email) values ('asing@example.com')`));
    expect(message).toMatch(/allow-list/);
  });
});

describe("T-75 antrean rebuild bergenerasi (F-6)", () => {
  it("enqueue saat running menaikkan generation; mark dengan generation lama kembali queued", async () => {
    await asService(db);
    await q(`delete from rebuild_queue`);
    await q(`select enqueue_rebuild($1, '2026-10-10')`, [SLP]);
    const claimed = await q<{ location_id: string; from_date: string; generation: string | number }>(
      `select * from claim_rebuild(1)`,
    );
    expect(claimed).toHaveLength(1);
    const generation = Number(claimed[0].generation);

    await q(`select enqueue_rebuild($1, '2026-10-05')`, [SLP]);
    const running = await q<{ status: string; from_date: string; generation: string | number }>(
      `select status, from_date, generation from rebuild_queue where location_id = $1`,
      [SLP],
    );
    expect(running[0].status).toBe("running");
    expect(running[0].from_date).toBe("2026-10-05");
    expect(Number(running[0].generation)).toBeGreaterThan(generation);

    await q(`select mark_rebuild_done($1, $2)`, [SLP, generation]);
    const requeued = await q<{ status: string; from_date: string }>(
      `select status, from_date from rebuild_queue where location_id = $1`,
      [SLP],
    );
    expect(requeued[0]).toMatchObject({ status: "queued", from_date: "2026-10-05" });

    const again = await q<{ generation: string | number }>(`select * from claim_rebuild(1)`);
    await q(`select mark_rebuild_done($1, $2)`, [SLP, Number(again[0].generation)]);
    const finished = await q<{ status: string }>(`select status from rebuild_queue where location_id = $1`, [SLP]);
    expect(finished[0].status).toBe("done");
  });
});

describe("T-76 trigger antre memakai nilai lama dan baru (F-11)", () => {
  it("tanggal dimundurkan/dimajukan dan lokasi diubah mengantre rentang lama", async () => {
    await asService(db);
    const rows = await q<{ id: string }>(
      `insert into production (location_id, house_id, date, grade_id, qty, unit, kg)
       values ($1, $2, '2026-10-10', $3, 10, 'kg', 10) returning id`,
      [SLP, SLP2, RT],
    );
    const id = rows[0].id;

    await q(`delete from rebuild_queue`);
    await q(`update production set date = '2026-10-08' where id = $1`, [id]);
    let queue = await q<{ location_id: string; from_date: string }>(`select location_id, from_date from rebuild_queue`);
    expect(queue).toContainEqual({ location_id: SLP, from_date: "2026-10-08" });

    await q(`delete from rebuild_queue`);
    await q(`update production set date = '2026-10-12' where id = $1`, [id]);
    queue = await q(`select location_id, from_date from rebuild_queue`);
    expect(queue).toContainEqual({ location_id: SLP, from_date: "2026-10-08" });

    await q(`delete from rebuild_queue`);
    await q(`update production set location_id = $1, house_id = $2 where id = $3`, [CKL, CKL1, id]);
    queue = await q(`select location_id, from_date from rebuild_queue order by location_id`);
    expect(queue.map((row) => row.location_id).sort()).toEqual([SLP, CKL].sort());
  });
});

describe("T-77 K4 OR per grade, catatan minimal 10 karakter (F-8)", () => {
  async function seedCount(date: string, kg: number, computed: number, note: string | null) {
    await setDay(SLP, date, "approved");
    await asService(db);
    await q(`delete from physical_count where location_id = $1 and date = $2`, [SLP, date]);
    const header = await q<{ id: string }>(
      `insert into physical_count (location_id, date, note) values ($1, $2, $3) returning id`,
      [SLP, date, note],
    );
    await q(
      `insert into physical_count_line (physical_count_id, grade_id, kg, computed_kg, diff_kg)
       values ($1, $2, $3, $4, $5)`,
      [header[0].id, US, kg, computed, kg - computed],
    );
    return header[0].id;
  }

  it("40 kg dari stok grade 100 kg tanpa catatan ditolak", async () => {
    await seedCount("2026-08-01", 60, 100, null);
    await asRole(db, USERS.accounting);
    const message = await expectError(() => db.query(`select lock_day($1, '2026-08-01')`, [SLP]));
    expect(message).toMatch(/melebihi toleransi/);
  });

  it("0,5 kg dari 100 kg lolos", async () => {
    await seedCount("2026-08-12", 99.5, 100, null);
    await asRole(db, USERS.accounting);
    await db.query(`select lock_day($1, '2026-08-12')`, [SLP]);
  });

  it("60 kg dari 10.000 kg (0,6 %) ditolak karena > 50 kg", async () => {
    await seedCount("2026-08-23", 9940, 10000, null);
    await asRole(db, USERS.accounting);
    const message = await expectError(() => db.query(`select lock_day($1, '2026-08-23')`, [SLP]));
    expect(message).toMatch(/melebihi toleransi/);
  });

  it("catatan 9 karakter ditolak, 10 karakter lolos", async () => {
    const id = await seedCount("2026-09-03", 9940, 10000, "123456789");
    await asRole(db, USERS.accounting);
    const message = await expectError(() => db.query(`select lock_day($1, '2026-09-03')`, [SLP]));
    expect(message).toMatch(/minimal 10 karakter/);
    await asService(db);
    await q(`update physical_count set note = '1234567890' where id = $1`, [id]);
    await asRole(db, USERS.accounting);
    await db.query(`select lock_day($1, '2026-09-03')`, [SLP]);
  });
});

describe("T-78 konfirmasi serah hanya oleh kandang (F-9)", () => {
  it("marketing tidak bisa menandai dikirim; kandang lokasi sendiri bisa; marketing menerima", async () => {
    await setDay(SLP, "2026-10-15", "open");
    await asService(db);
    const rows = await q<{ id: string }>(
      `insert into outbound (location_id, do_number, customer_id, date, status)
       values ($1, 'SLP/202610/9101', $2, '2026-10-15', 'draft') returning id`,
      [SLP, BAKUL],
    );
    const id = rows[0].id;

    await asRole(db, USERS.marketing);
    const message = await expectError(() =>
      db.query(
        `update outbound set status = 'dikirim', delivered_at = now(), delivered_by = $1 where id = $2`,
        [USERS.marketing, id],
      ),
    );
    expect(message).toMatch(/Serah DO dikonfirmasi oleh petugas kandang/);

    await asRole(db, USERS.kandangCkl);
    const other = await q(
      `update outbound set status = 'dikirim', delivered_at = now(), delivered_by = $1 where id = $2 returning id`,
      [USERS.kandangCkl, id],
    );
    expect(other).toHaveLength(0);

    await asRole(db, USERS.kandang);
    const spoof = await expectError(() =>
      db.query(
        `update outbound set status = 'dikirim', delivered_at = now(), delivered_by = $1 where id = $2`,
        [USERS.manager, id],
      ),
    );
    expect(spoof).toMatch(/aktor|diri sendiri/i);
    const own = await q(
      `update outbound set status = 'dikirim', delivered_at = now(), delivered_by = $1 where id = $2 returning id`,
      [USERS.kandang, id],
    );
    expect(own).toHaveLength(1);

    await asRole(db, USERS.marketing);
    await db.query(`update outbound set status = 'diterima' where id = $1`, [id]);
    const back = await expectError(() => db.query(`update outbound set status = 'draft' where id = $1`, [id]));
    expect(back).toMatch(/Serah DO dikonfirmasi oleh petugas kandang/);

    await asService(db);
    const final = await q<{ status: string; delivered_by: string }>(`select status, delivered_by from outbound where id = $1`, [id]);
    expect(final[0]).toMatchObject({ status: "diterima", delivered_by: USERS.kandang });
  });
});

describe("T-79 hari disetujui/dikunci menolak tulis kandang (F-10)", () => {
  it("hitung fisik di hari locked/approved ditolak", async () => {
    await setDay(SLP, "2026-10-16", "locked");
    await setDay(SLP, "2026-10-17", "approved");
    for (const date of ["2026-10-16", "2026-10-17"]) {
      await asRole(db, USERS.kandang);
      const message = await expectError(() =>
        db.query(`insert into physical_count (location_id, date, note) values ($1, $2, 'uji')`, [SLP, date]),
      );
      expect(message, date).toMatch(/row-level security|policy/i);
    }
  });

  it("opname: insert di hari approved dan memindah ke hari locked ditolak", async () => {
    await asRole(db, USERS.kandang);
    const insert = await expectError(() =>
      db.query(`insert into opname (location_id, date, status) values ($1, '2026-10-17', 'draft')`, [SLP]),
    );
    expect(insert).toMatch(/row-level security|policy/i);

    await setDay(SLP, "2026-10-14", "open");
    await asRole(db, USERS.kandang);
    const rows = await q<{ id: string }>(
      `insert into opname (location_id, date, status) values ($1, '2026-10-14', 'draft') returning id`,
      [SLP],
    );
    const move = await expectError(() =>
      db.query(`update opname set date = '2026-10-16' where id = $1`, [rows[0].id]),
    );
    expect(move).toMatch(/row-level security|policy/i);
  });

  it("terima mutasi ke lokasi tujuan di hari locked ditolak", async () => {
    await setDay(SLP, "2026-10-13", "open");
    await asService(db);
    const rows = await q<{ id: string }>(
      `insert into transfer (from_location_id, to_location_id, grade_id, kg, sent_date, status)
       values ($1, $2, $3, 25, '2026-10-13', 'in_transit') returning id`,
      [CKL, SLP, UB],
    );
    await asRole(db, USERS.kandang);
    const message = await expectError(() =>
      db.query(`update transfer set status = 'received', received_date = '2026-10-16' where id = $1`, [rows[0].id]),
    );
    expect(message).toMatch(/row-level security|policy/i);

    const ok = await q(
      `update transfer set status = 'received', received_date = '2026-10-13' where id = $1 returning id`,
      [rows[0].id],
    );
    expect(ok).toHaveLength(1);
  });
});
