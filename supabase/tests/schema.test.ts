import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, asService, createTestDb, expectError } from "../../packages/db/test/pglite";
import { computeFlockState } from "@winata/engine";

let db: PGlite;
let close: () => Promise<void>;

const ADMIN = "44444444-4444-4444-4444-444444444401";
const ACCOUNTING = "44444444-4444-4444-4444-444444444404";

beforeAll(async () => {
  const test = await createTestDb();
  db = test.db;
  close = test.close;
});

afterAll(async () => {
  if (close) await close();
});

describe("T-01 migrasi dari nol", () => {
  it("semua migrasi berjalan dan versi skema 1.1.0", async () => {
    const version = await db.query<{ v: string }>(`select schema_version() as v`);
    expect(version.rows[0].v).toBe("1.1.0");
  });

  it("tabel inti ada", async () => {
    const result = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const names = new Set(result.rows.map((r) => r.table_name));
    for (const table of [
      "app_user", "location", "house", "flock", "flock_depletion", "grade", "unit_conversion",
      "customer", "parameter", "opname", "opname_line", "production", "outbound", "outbound_line",
      "transfer", "shrinkage", "physical_count", "physical_count_line", "correction", "sales_plan",
      "market_price", "cash_plan", "day_status", "rebuild_queue", "position_daily", "projection_daily",
      "control_result", "audit_log", "reconciliation_item", "item_map", "hdp_standard",
    ]) {
      expect(names.has(table), `tabel ${table}`).toBe(true);
    }
  });

  it("seed master lengkap", async () => {
    const counts = await db.query<{ locations: string; houses: string; grades: string; users: string; hdp: string }>(
      `select
        (select count(*) from location)::text as locations,
        (select count(*) from house)::text as houses,
        (select count(*) from grade)::text as grades,
        (select count(*) from app_user)::text as users,
        (select count(*) from hdp_standard)::text as hdp`,
    );
    expect(counts.rows[0].locations).toBe("3");
    expect(counts.rows[0].houses).toBe("3");
    expect(counts.rows[0].grades).toBe("5");
    expect(counts.rows[0].users).toBe("9");
    expect(Number(counts.rows[0].hdp)).toBe(3 * 73);
  });

  it("opname T0 bertanda tangan tiga pihak dan menjadi jangkar", async () => {
    const rows = await db.query<{ n: string; signed: string }>(
      `select count(*)::text as n,
              count(*) filter (where status = 'signed' and signed_counter_at is not null
                and signed_witness_at is not null and signed_manager_at is not null)::text as signed
         from opname`,
    );
    expect(rows.rows[0].n).toBe("3");
    expect(rows.rows[0].signed).toBe("3");
  });
});

describe("T-03 allow-list login (K2)", () => {
  it("pendaftaran mandiri dengan email asing ditolak trigger", async () => {
    const message = await expectError(() =>
      db.query(`insert into auth.users (email) values ('penyusup@example.com')`),
    );
    expect(message).toMatch(/allow-list/);
  });

  it("email yang ada di app_user aktif boleh dibuat", async () => {
    await db.query(`insert into auth.users (email) values ('manager@winata.test') on conflict (email) do nothing`);
    const rows = await db.query(`select count(*)::int as n from auth.users where email = 'manager@winata.test'`);
    expect(rows.rows[0]).toEqual({ n: 1 });
  });

  it("kata sandi lokal disimpan sebagai hash sha256, bukan teks biasa", async () => {
    const rows = await db.query<{ password_hash: string }>(
      `select password_hash from auth.users where email = 'kandang.slp@winata.test'`,
    );
    expect(rows.rows[0].password_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.rows[0].password_hash).not.toContain("winata123");
  });
});

describe("T-04 audit nilai lama/baru", () => {
  it("update grade menghasilkan audit_log dengan old, new, actor", async () => {
    await asRole(db, ACCOUNTING);
    await db.query(`update grade set name = 'Utuh Besar (uji)' where code = 'UB'`);
    await asService(db);

    const audit = await db.query<{ old: Record<string, unknown>; new: Record<string, unknown>; actor: string }>(
      `select old, new, actor from audit_log
        where table_name = 'grade' and action = 'UPDATE'
        order by id desc limit 1`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].old.name).toBe("Utuh Besar");
    expect(audit.rows[0].new.name).toBe("Utuh Besar (uji)");
    expect(audit.rows[0].actor).toBe(ACCOUNTING);

    await asRole(db, ADMIN);
    await db.query(`update grade set name = 'Utuh Besar' where code = 'UB'`);
    await asService(db);
  });
});

describe("T-05 register flok: umur, populasi, status", () => {
  it("3 kasus grower, layer, afkir dari seed", async () => {
    const flocks = await db.query<{
      code: string;
      chick_in_date: string;
      initial_birds: number;
      status: "grower" | "layer" | "afkir";
      production_start_date: string | null;
      cull_date: string | null;
    }>(`select code, chick_in_date, initial_birds, status, production_start_date, cull_date from flock order by code`);

    const depletions = await db.query<{ flock_id: string; date: string; dead: number; culled: number }>(
      `select flock_id, date, dead, culled from flock_depletion`,
    );
    const flockRows = await db.query<{ id: string; code: string }>(`select id, code from flock`);
    const idByCode = new Map(flockRows.rows.map((r) => [r.code, r.id]));

    const date = "2026-10-26";
    const byCode = new Map(flocks.rows.map((f) => [f.code, f]));

    const grower = byCode.get("SLP2-2026-06")!;
    const growerState = computeFlockState(
      {
        id: idByCode.get(grower.code)!,
        code: grower.code,
        strain: "Lohmann Brown",
        chickInDate: grower.chick_in_date,
        initialBirds: grower.initial_birds,
        status: grower.status,
        productionStartDate: grower.production_start_date,
        cullDate: grower.cull_date,
        depletions: depletions.rows.filter((d) => d.flock_id === idByCode.get(grower.code)),
      },
      date,
    );
    // chick-in 6 Jul 2026 -> 26 Okt 2026 = 112 hari = 16 minggu
    expect(growerState.ageWeeks).toBe(16);
    expect(growerState.population).toBe(11000 - (4 + 3 + 5 + 2));
    expect(growerState.status).toBe("grower");
    expect(growerState.isProducing).toBe(false);
    expect(growerState.productionStartDate).toBe("2026-11-09");

    const layer = byCode.get("SLP1-2025-08")!;
    const layerState = computeFlockState(
      {
        id: idByCode.get(layer.code)!,
        code: layer.code,
        strain: "Isa Brown",
        chickInDate: layer.chick_in_date,
        initialBirds: layer.initial_birds,
        status: layer.status,
        productionStartDate: layer.production_start_date,
        cullDate: layer.cull_date,
        depletions: depletions.rows.filter((d) => d.flock_id === idByCode.get(layer.code)),
      },
      date,
    );
    expect(layerState.ageWeeks).toBe(64);
    expect(layerState.population).toBe(12000 - (12 + 9 + 7 + 25 + 8 + 10 + 6 + 11));
    expect(layerState.status).toBe("layer");
    expect(layerState.isProducing).toBe(true);

    const afkirState = computeFlockState(
      {
        id: "x",
        code: "AFKIR-UJI",
        strain: "Isa Brown",
        chickInDate: "2024-01-01",
        initialBirds: 5000,
        status: "afkir",
        productionStartDate: "2024-05-01",
        cullDate: "2026-10-01",
        depletions: [{ date: "2026-09-01", dead: 100, culled: 0 }],
      },
      date,
    );
    expect(afkirState.status).toBe("afkir");
    expect(afkirState.isProducing).toBe(false);
    expect(afkirState.population).toBe(4900);
  });
});

describe("Batasan transaksi", () => {
  it("nomor DO ganda ditolak unique(location_id, do_number)", async () => {
    await db.query(
      `insert into outbound (id, location_id, do_number, customer_id, date, status, delivered_at)
       values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111101',
               'SLP/2026/10/0001', '55555555-5555-5555-5555-555555555501', '2026-10-20', 'draft', null)`,
    );
    const message = await expectError(() =>
      db.query(
        `insert into outbound (location_id, do_number, customer_id, date, status)
         values ('11111111-1111-1111-1111-111111111101', 'SLP/2026/10/0001',
                 '55555555-5555-5555-5555-555555555501', '2026-10-21', 'draft')`,
      ),
    );
    expect(message).toMatch(/duplicate|unique/i);
  });

  it("satu baris produksi per kandang per grade per hari (R-3)", async () => {
    await db.query(
      `insert into production (location_id, house_id, date, grade_id, qty, unit, kg)
       values ('11111111-1111-1111-1111-111111111101', '22222222-2222-2222-2222-222222222201',
               '2026-10-20', '33333333-3333-3333-3333-333333333301', 100, 'kg', 100)`,
    );
    const message = await expectError(() =>
      db.query(
        `insert into production (location_id, house_id, date, grade_id, qty, unit, kg)
         values ('11111111-1111-1111-1111-111111111101', '22222222-2222-2222-2222-222222222201',
                 '2026-10-20', '33333333-3333-3333-3333-333333333301', 50, 'kg', 50)`,
      ),
    );
    expect(message).toMatch(/duplicate|unique/i);
  });

  it("mutasi received tanpa tanggal terima ditolak", async () => {
    const message = await expectError(() =>
      db.query(
        `insert into transfer (from_location_id, to_location_id, grade_id, kg, sent_date, status)
         values ('11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111103',
                 '33333333-3333-3333-3333-333333333301', 10, '2026-10-20', 'received')`,
      ),
    );
    expect(message).toMatch(/transfer_received_check|check/i);
  });

  it("perubahan transaksi mengantre rebuild dengan from_date minimum", async () => {
    await asService(db);
    await db.query(`delete from rebuild_queue`);
    await db.query(
      `update production set kg = 110, qty = 110
        where date = '2026-10-20' and house_id = '22222222-2222-2222-2222-222222222201'
          and grade_id = '33333333-3333-3333-3333-333333333301'`,
    );
    const queue = await db.query<{ location_id: string; from_date: string; status: string }>(
      `select location_id, from_date, status from rebuild_queue`,
    );
    expect(queue.rows).toHaveLength(1);
    expect(queue.rows[0]).toMatchObject({
      location_id: "11111111-1111-1111-1111-111111111101",
      from_date: "2026-10-20",
      status: "queued",
    });
  });
});
