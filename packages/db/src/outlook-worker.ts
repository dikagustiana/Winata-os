import type { PGlite } from "@electric-sql/pglite";
import {
  addDays,
  buildProjection,
  indexHdp,
  type ActualDay,
  type GradeMix,
  type HdpRow,
  type ProjectionFlock,
} from "@winata/engine";
import { getParameter, todayJakarta } from "./rebuild";

interface FlockRecord {
  id: string;
  house_id: string;
  code: string;
  strain: string;
  chick_in_date: string;
  initial_birds: number;
  status: "grower" | "layer" | "afkir";
  production_start_date: string | null;
  cull_date: string | null;
}

/**
 * R-32: proyeksi produksi 28 hari disimpan di projection_daily oleh worker,
 * supaya halaman outlook tidak menghitung sendiri (R-15).
 */
export async function refreshProjection(db: PGlite, startDate?: string, days = 28): Promise<number> {
  const start = startDate ?? addDays(todayJakarta(), 1);
  const end = addDays(start, days - 1);

  const houses = await db.query<{ id: string; location_id: string; code: string }>(
    `select id, location_id, code from house where active and deleted_at is null`,
  );
  const flocks = await db.query<FlockRecord>(
    `select id, house_id, code, strain, chick_in_date, initial_birds, status,
            production_start_date, cull_date
       from flock
      where deleted_at is null and status <> 'afkir'
      order by house_id, chick_in_date desc`,
  );
  const currentByHouse = new Map<string, FlockRecord>();
  for (const flock of flocks.rows) {
    if (!currentByHouse.has(flock.house_id)) currentByHouse.set(flock.house_id, flock);
  }
  const depletions = await db.query<{ flock_id: string; date: string; dead: number; culled: number }>(
    `select flock_id, date, dead, culled from flock_depletion where deleted_at is null`,
  );
  const hdp = await db.query<{ strain: string; age_week: number; hdp_pct: string; egg_weight_g: string }>(
    `select strain, age_week, hdp_pct, egg_weight_g from hdp_standard where deleted_at is null`,
  );
  const grades = await db.query<{ id: string; code: string }>(
    `select id, code from grade where active and deleted_at is null order by sort`,
  );
  const gradeByCode = new Map(grades.rows.map((grade) => [grade.code, grade.id]));

  const actualStart = addDays(start, -14);
  const actualProduction = await db.query<{ house_id: string; date: string; kg: string }>(
    `select house_id, date, sum(kg) as kg from production
      where deleted_at is null and date between $1 and $2
      group by house_id, date`,
    [actualStart, addDays(start, -1)],
  );
  const actualGrade = await db.query<{ house_id: string; grade_id: string; kg: string }>(
    `select house_id, grade_id, sum(kg) as kg from production
      where deleted_at is null and date between $1 and $2
      group by house_id, grade_id`,
    [actualStart, addDays(start, -1)],
  );

  const defaultMixRaw = await getParameter<Record<string, number>>(db, "default_grade_mix", {
    UB: 55,
    US: 30,
    UK: 10,
    RT: 3,
    PC: 2,
  });
  const defaultMix: GradeMix = {};
  for (const [code, pct] of Object.entries(defaultMixRaw)) {
    const gradeId = gradeByCode.get(code);
    if (gradeId) defaultMix[gradeId] = Number(pct) / 100;
  }
  const windowDays = Number(await getParameter<number | string>(db, "calibration_window_days", 14));
  const startAgeWeeks = Number(await getParameter<number | string>(db, "production_start_age_weeks", 18));

  const projectionFlocks: ProjectionFlock[] = [];
  for (const house of houses.rows) {
    const flock = currentByHouse.get(house.id);
    if (!flock) continue;
    projectionFlocks.push({
      id: flock.id,
      houseId: house.id,
      locationId: house.location_id,
      code: flock.code,
      strain: flock.strain,
      chickInDate: flock.chick_in_date,
      initialBirds: flock.initial_birds,
      status: flock.status,
      productionStartDate: flock.production_start_date,
      cullDate: flock.cull_date,
      depletions: depletions.rows
        .filter((row) => row.flock_id === flock.id)
        .map((row) => ({ date: row.date, dead: row.dead, culled: row.culled })),
    });
  }

  const actual: ActualDay[] = [];
  for (const house of houses.rows) {
    const flock = currentByHouse.get(house.id);
    if (!flock) continue;
    for (const row of actualProduction.rows.filter((item) => item.house_id === house.id)) {
      actual.push({ flockId: flock.id, date: row.date, kg: row.kg });
    }
  }

  const actualGradeKg: Array<{ flockId: string; gradeId: string; kg: string | number }> = [];
  for (const house of houses.rows) {
    const flock = currentByHouse.get(house.id);
    if (!flock) continue;
    for (const row of actualGrade.rows.filter((item) => item.house_id === house.id)) {
      actualGradeKg.push({ flockId: flock.id, gradeId: row.grade_id, kg: row.kg });
    }
  }

  const hdpRows: HdpRow[] = hdp.rows.map((row) => ({
    strain: row.strain,
    ageWeek: Number(row.age_week),
    hdpPct: row.hdp_pct,
    eggWeightG: row.egg_weight_g,
  }));

  const { cells } = buildProjection({
    flocks: projectionFlocks,
    series: indexHdp(hdpRows),
    startDate: start,
    days,
    actual,
    actualGradeKg,
    defaultMix,
    startAgeWeeks,
    windowDays,
  });

  await db.query(`delete from projection_daily where date between $1 and $2`, [start, end]);
  if (cells.length > 0) {
    const params: unknown[] = [];
    const tuples = cells.map((cell) => {
      const values = [
        cell.houseId,
        cell.flockId,
        cell.gradeId,
        cell.date,
        cell.kg,
        cell.calibrationFactor,
        cell.flag,
      ];
      const placeholders = values.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")}, now())`;
    });
    await db.query(
      `insert into projection_daily
        (house_id, flock_id, grade_id, date, kg_proj, calibration_factor, flag, computed_at)
       values ${tuples.join(", ")}`,
      params,
    );
  }
  return cells.length;
}
