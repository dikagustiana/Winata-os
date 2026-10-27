import type { Queryable } from "./queryable";
import { computeControls, type ControlContext, type ControlResult } from "@winata/engine";
import { getParameter, todayJakarta } from "./rebuild";

function nowWibTime(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

export async function buildControlContext(db: Queryable, date: string): Promise<ControlContext> {
  const locations = await db.query<{ id: string; code: string }>(
    `select id, code from location where active and deleted_at is null order by code`,
  );
  const statuses = await db.query<{ location_id: string; status: ControlContext["dayStatuses"][number]["status"] }>(
    `select location_id, status from day_status where date = $1 and deleted_at is null`,
    [date],
  );
  const positions = await db.query<{
    locationId: string;
    gradeId: string;
    gradeCode: string;
    closing: string;
    ageB3: string;
    ageB4: string;
    daysOfStock: string | null;
  }>(
    `select p.location_id as "locationId", p.grade_id as "gradeId", g.code as "gradeCode",
            p.closing, p.age_b3 as "ageB3", p.age_b4 as "ageB4", p.days_of_stock as "daysOfStock"
       from position_daily p
       join grade g on g.id = p.grade_id
      where p.date = $1`,
    [date],
  );
  const transfers = await db.query<ControlContext["transfers"][number]>(
    `select id, to_location_id as "toLocationId", sent_date as "sentDate",
            received_date as "receivedDate", status
       from transfer
      where deleted_at is null and status = 'in_transit'`,
  );
  const physicalCounts = await db.query<{
    locationId: string;
    date: string;
    diffKg: string;
    stockKg: string;
    note: string | null;
    gradeCode: string;
  }>(
    `select pc.location_id as "locationId", pc.date, coalesce(l.diff_kg, 0) as "diffKg",
            g.code as "gradeCode", pc.note,
            coalesce(l.computed_kg, 0) as "stockKg"
       from physical_count pc
       join physical_count_line l on l.physical_count_id = pc.id and l.deleted_at is null
       join grade g on g.id = l.grade_id
      where pc.deleted_at is null and pc.date between $1::date - 7 and $1`,
    [date],
  );
  const outbounds = await db.query<{ locationId: string; doNumber: string }>(
    `select location_id as "locationId", do_number as "doNumber"
       from outbound
      where deleted_at is null and date between $1::date - 60 and $1`,
    [date],
  );

  const deadline = await getParameter<string>(db, "input_deadline", "20:00");
  const tolerancePct = Number(await getParameter<number | string>(db, "tolerance_pct", 0.01));
  const toleranceKg = Number(await getParameter<number | string>(db, "tolerance_kg", 50));
  const transitDaysAlert = Number(await getParameter<number | string>(db, "transit_days_alert", 1));
  const alertDays = Number(await getParameter<number | string>(db, "days_of_stock_alert", 5));

  return {
    date,
    today: todayJakarta(),
    nowTimeWib: nowWibTime(),
    locations: locations.rows,
    dayStatuses: statuses.rows.map((row) => ({ locationId: row.location_id, status: row.status })),
    positions: positions.rows,
    transfers: transfers.rows,
    physicalCounts: physicalCounts.rows,
    outbounds: outbounds.rows,
    params: {
      deadline: typeof deadline === "string" ? deadline : "20:00",
      tolerancePct,
      toleranceKg,
      transitDaysAlert,
      alertDays,
    },
  };
}

export async function processControls(db: Queryable, date?: string): Promise<ControlResult[]> {
  const target = date ?? todayJakarta();
  const context = await buildControlContext(db, target);
  const results = computeControls(context);

  for (const row of results) {
    await db.query(
      `insert into control_result (code, date, location_id, status, detail, computed_at)
       values ($1, $2, $3, $4, $5::jsonb, now())
       on conflict (code, date, location_id) do update
         set status = excluded.status,
             detail = excluded.detail,
             computed_at = now()`,
      [row.code, target, row.locationId, row.status, JSON.stringify(row.detail)],
    );
  }
  return results;
}
