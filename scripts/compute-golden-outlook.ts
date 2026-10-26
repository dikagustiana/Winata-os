/**
 * Fixture outlook-example: 5 flok, kurva HDP dari seed, aktual 14 hari.
 * golden.json dihitung dengan implementasi naive terpisah dari engine.
 */
import fs from "node:fs";
import path from "node:path";
import { createTestDb } from "../packages/db/test/pglite";

type Hdp = { strain: string; ageWeek: number; hdpPct: number; eggWeightG: number };

const START = "2026-10-27";
const DAYS = 28;
const WINDOW = 14;
const SLP = "11111111-1111-1111-1111-111111111101";
const CKL = "11111111-1111-1111-1111-111111111102";
const SLP1 = "22222222-2222-2222-2222-222222222201";
const SLP2 = "22222222-2222-2222-2222-222222222202";
const CKL1 = "22222222-2222-2222-2222-222222222203";
const G = {
  UB: "33333333-3333-3333-3333-333333333301",
  US: "33333333-3333-3333-3333-333333333302",
  UK: "33333333-3333-3333-3333-333333333303",
  RT: "33333333-3333-3333-3333-333333333304",
  PC: "33333333-3333-3333-3333-333333333305",
};

const { db, close } = await createTestDb({ seed: true });
const hdpRows = await db.query<Hdp>(
  `select strain, age_week as "ageWeek", hdp_pct as "hdpPct", egg_weight_g as "eggWeightG"
     from hdp_standard order by strain, age_week`,
);
await close();
const hdp: Hdp[] = hdpRows.rows.map((row) => ({
  strain: row.strain,
  ageWeek: Number(row.ageWeek),
  hdpPct: Number(row.hdpPct),
  eggWeightG: Number(row.eggWeightG),
}));
const hdpKey = (strain: string, age: number) => hdp.find((row) => row.strain === strain && row.ageWeek === age);

const depletions = {
  f1: [
    { date: "2026-09-07", dead: 12, culled: 0 },
    { date: "2026-09-14", dead: 9, culled: 0 },
    { date: "2026-09-21", dead: 7, culled: 25 },
    { date: "2026-09-28", dead: 8, culled: 0 },
    { date: "2026-10-05", dead: 10, culled: 0 },
    { date: "2026-10-12", dead: 6, culled: 0 },
    { date: "2026-10-19", dead: 11, culled: 0 },
  ],
  f3: [
    { date: "2026-09-14", dead: 6, culled: 0 },
    { date: "2026-09-28", dead: 5, culled: 12 },
    { date: "2026-10-12", dead: 4, culled: 0 },
    { date: "2026-10-19", dead: 7, culled: 0 },
  ],
};

const flocks = [
  { id: "fl-1", houseId: SLP1, locationId: SLP, code: "SLP1-2025-08", strain: "Isa Brown", chickInDate: "2025-08-04", initialBirds: 12000, status: "layer", productionStartDate: "2025-12-08", cullDate: null, depletions: depletions.f1 },
  { id: "fl-2", houseId: SLP2, locationId: SLP, code: "SLP2-2026-06", strain: "Lohmann Brown", chickInDate: "2026-07-06", initialBirds: 11000, status: "grower", productionStartDate: "2026-12-01", cullDate: null, depletions: [{ date: "2026-09-07", dead: 4, culled: 0 }, { date: "2026-09-21", dead: 3, culled: 0 }, { date: "2026-10-05", dead: 5, culled: 0 }, { date: "2026-10-19", dead: 2, culled: 0 }] },
  { id: "fl-3", houseId: CKL1, locationId: CKL, code: "CKL1-2025-09", strain: "Hy-Line Brown", chickInDate: "2025-09-01", initialBirds: 9000, status: "layer", productionStartDate: "2026-01-05", cullDate: null, depletions: depletions.f3 },
  { id: "fl-4", houseId: SLP1, locationId: SLP, code: "SLP1-2024-02", strain: "Lohmann Brown", chickInDate: "2024-02-01", initialBirds: 8000, status: "afkir", productionStartDate: "2024-06-01", cullDate: "2026-09-30", depletions: [] },
  { id: "fl-5", houseId: SLP2, locationId: SLP, code: "SLP2-2025-02", strain: "Isa Brown", chickInDate: "2025-02-10", initialBirds: 10000, status: "layer", productionStartDate: "2025-06-15", cullDate: null, depletions: [] },
];

const actualHistory: Array<{ flockId: string; date: string; kg: number }> = [];
for (let i = 1; i <= 14; i += 1) {
  const day = `2026-10-${String(i + 12).padStart(2, "0")}`;
  actualHistory.push({ flockId: "fl-1", date: day, kg: 700 + ((i * 13) % 40) });
  actualHistory.push({ flockId: "fl-3", date: day, kg: 500 + ((i * 7) % 25) });
  actualHistory.push({ flockId: "fl-2", date: day, kg: 0 });
}

const actualGradeKg = [
  { flockId: "fl-1", gradeId: G.UB, kg: 8_400 },
  { flockId: "fl-1", gradeId: G.US, gradeCode: "US", kg: 3_900 },
  { flockId: "fl-1", gradeId: G.UK, kg: 1_100 },
  { flockId: "fl-1", gradeId: G.RT, kg: 350 },
  { flockId: "fl-1", gradeId: G.PC, kg: 250 },
  { flockId: "fl-3", gradeId: G.UB, kg: 5_500 },
  { flockId: "fl-3", gradeId: G.US, gradeCode: "US", kg: 3_000 },
  { flockId: "fl-3", gradeId: G.UK, kg: 900 },
  { flockId: "fl-3", gradeId: G.RT, kg: 300 },
  { flockId: "fl-3", gradeId: G.PC, kg: 300 },
];

const defaultMix = { [G.UB]: 0.55, [G.US]: 0.3, [G.UK]: 0.1, [G.RT]: 0.03, [G.PC]: 0.02 };

// --- naive computation ----------------------------------------------------
const dayDiff = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const eachDay = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

const population = (flock: (typeof flocks)[number], date: string) =>
  flock.initialBirds - flock.depletions.filter((d) => d.date <= date).reduce((a, d) => a + d.dead + d.culled, 0);

const standardKg = (flock: (typeof flocks)[number], date: string) => {
  const ageWeeks = Math.floor(Math.max(0, dayDiff(flock.chickInDate, date)) / 7);
  const start = flock.productionStartDate ?? addDays(flock.chickInDate, 18 * 7);
  if (flock.cullDate && flock.cullDate <= date) return 0;
  if (date < start) return 0;
  const row = hdpKey(flock.strain, ageWeeks);
  if (!row) return 0;
  return (population(flock, date) * (row.hdpPct / 100) * row.eggWeightG) / 1000;
};

const calibrations: Record<string, { factor: number; days: number }> = {};
for (const flock of flocks) {
  const days = eachDay("2026-10-13", "2026-10-26");
  let actual = 0;
  let standard = 0;
  let observed = 0;
  for (const day of days) {
    standard += standardKg(flock, day);
    const row = actualHistory.find((a) => a.flockId === flock.id && a.date === day);
    if (row) {
      actual += row.kg;
      observed += 1;
    } else if (flock.status !== "grower" && day >= "2026-10-13") {
      // 14 hari data aktual lengkap untuk flok layer (0 bila tidak ada baris).
    }
  }
  const raw = observed === 0 ? 1 : standard > 0 ? actual / standard : 1;
  calibrations[flock.id] = { factor: Math.min(1.2, Math.max(0.6, raw)), days: observed };
}

const mixes: Record<string, Record<string, number>> = {};
for (const flock of flocks) {
  const rows = actualGradeKg.filter((row) => row.flockId === flock.id);
  const total = rows.reduce((a, r) => a + r.kg, 0);
  if (total <= 0) {
    mixes[flock.id] = defaultMix;
  } else {
    mixes[flock.id] = Object.fromEntries(rows.map((r) => [r.gradeId, r.kg / total]));
  }
}

const cells: Array<Record<string, string | number | null>> = [];
for (const flock of flocks) {
  for (const date of eachDay(START, addDays(START, DAYS - 1))) {
    const kg = standardKg(flock, date) * calibrations[flock.id].factor;
    if (kg <= 0) continue;
    for (const [gradeId, share] of Object.entries(mixes[flock.id])) {
      cells.push({
        flockId: flock.id,
        houseId: flock.houseId,
        locationId: flock.locationId,
        gradeId,
        date,
        kg: Math.round(kg * share * 1000) / 1000,
        calibrationFactor: calibrations[flock.id].factor.toFixed(4),
        flag: calibrations[flock.id].days < WINDOW ? "insufficient_calibration" : null,
      });
    }
  }
}

const dir = path.join(process.cwd(), "fixtures", "outlook-example");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(
  path.join(dir, "input.json"),
  JSON.stringify({
    note: "Fixture outlook sintetis; HDP dari supabase/seed/0005_hdp.sql.",
    startDate: START,
    days: DAYS,
    windowDays: WINDOW,
    flocks,
    actualHistory,
    actualGradeKg,
    defaultMix,
    grades: Object.entries(G).map(([code, id]) => ({ id, code })),
  }, null, 2),
);
fs.writeFileSync(path.join(dir, "hdp.json"), JSON.stringify(hdp, null, 2));
fs.writeFileSync(
  path.join(dir, "golden.json"),
  JSON.stringify({
    note: "Dihitung scripts/compute-golden-outlook.ts (implementasi naive di luar engine).",
    cells,
    calibrations,
    spotChecks: {
      "fl-1 factor": calibrations["fl-1"].factor,
      "fl-2 cells": cells.filter((c) => c.flockId === "fl-2").length,
      "first fl-1 cell": cells.find((c) => c.flockId === "fl-1"),
    },
  }, null, 2),
);
console.log("cells", cells.length);
console.log("calibrations", calibrations);
console.log("first", cells[0]);
