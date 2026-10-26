/**
 * Membuat fixtures/week-example (transaksi 10 hari, 3 lokasi, 5 grade) dan
 * golden.json. Perhitungan golden di skrip ini SENGAJA terpisah dari engine
 * (tidak mengimpor packages/engine); engine harus mereproduksi golden.
 */
import fs from "node:fs";
import path from "node:path";

type Loc = { id: string; code: string; kind: "kandang" | "gudang" };
type Grade = { id: string; code: string };

const LOCATIONS: Loc[] = [
  { id: "11111111-1111-1111-1111-111111111101", code: "SLP", kind: "kandang" },
  { id: "11111111-1111-1111-1111-111111111102", code: "CKL", kind: "kandang" },
  { id: "11111111-1111-1111-1111-111111111103", code: "TSK", kind: "gudang" },
];
const GRADES: Grade[] = [
  { id: "33333333-3333-3333-3333-333333333301", code: "UB" },
  { id: "33333333-3333-3333-3333-333333333302", code: "US" },
  { id: "33333333-3333-3333-3333-333333333303", code: "UK" },
  { id: "33333333-3333-3333-3333-333333333304", code: "RT" },
  { id: "33333333-3333-3333-3333-333333333305", code: "PC" },
];

const START = "2026-08-01";
const END = "2026-08-10";
const HPP = 17419;
const BUCKETS: [number, number, number] = [3, 7, 14];

const days: string[] = [];
for (let d = 1; d <= 10; d++) days.push(`2026-08-${String(d).padStart(2, "0")}`);

const loc = (code: string) => LOCATIONS.find((l) => l.code === code)!;
const grade = (code: string) => GRADES.find((g) => g.code === code)!;

const opening: Array<{ locationId: string; gradeId: string; kg: number }> = [
  [loc("SLP"), 3000, 1500, 500, 100, 30],
  [loc("CKL"), 1800, 900, 300, 60, 20],
  [loc("TSK"), 1200, 600, 200, 40, 10],
].flatMap(([location, ...kgs]) =>
  (kgs as number[]).map((kg, i) => ({
    locationId: (location as Loc).id,
    gradeId: GRADES[i].id,
    kg,
  })),
);

const dailyProduction: Record<string, number[]> = {
  SLP: [1350, 620, 170, 38, 11],
  CKL: [500, 240, 70, 15, 4],
};

const production: Array<{ locationId: string; gradeId: string; date: string; kg: number }> = [];
for (const day of days) {
  for (const code of ["SLP", "CKL"] as const) {
    dailyProduction[code].forEach((kg, i) => {
      production.push({ locationId: loc(code).id, gradeId: GRADES[i].id, date: day, kg });
    });
  }
}

const outbound: Array<{ locationId: string; gradeId: string; date: string; kg: number }> = [];
const addOut = (code: string, day: string, pairs: Array<[string, number]>) => {
  for (const [g, kg] of pairs) outbound.push({ locationId: loc(code).id, gradeId: grade(g).id, date: day, kg });
};
addOut("SLP", "2026-08-02", [["UB", 1200], ["US", 400]]);
addOut("SLP", "2026-08-04", [["UB", 900], ["US", 350], ["UK", 60]]);
addOut("CKL", "2026-08-06", [["UB", 700], ["US", 250]]);
addOut("TSK", "2026-08-07", [["UB", 800], ["US", 300]]);
addOut("SLP", "2026-08-09", [["UB", 1000], ["US", 450], ["RT", 30]]);
addOut("TSK", "2026-08-10", [["UB", 600], ["UK", 100]]);

const shrinkage: Array<{ locationId: string; gradeId: string; date: string; kg: number }> = [
  { locationId: loc("SLP").id, gradeId: grade("PC").id, date: "2026-08-03", kg: 8 },
  { locationId: loc("CKL").id, gradeId: grade("RT").id, date: "2026-08-05", kg: 12 },
  { locationId: loc("SLP").id, gradeId: grade("UK").id, date: "2026-08-08", kg: 15 },
  { locationId: loc("SLP").id, gradeId: grade("PC").id, date: "2026-08-08", kg: 5 },
  { locationId: loc("TSK").id, gradeId: grade("PC").id, date: "2026-08-10", kg: 4 },
];

const transfer = [
  {
    id: "99999999-9999-9999-9999-999999999901",
    fromLocationId: loc("SLP").id,
    toLocationId: loc("TSK").id,
    gradeId: grade("UB").id,
    kg: 500,
    sentDate: "2026-08-03",
    receivedDate: "2026-08-05",
    status: "received" as const,
  },
  {
    id: "99999999-9999-9999-9999-999999999902",
    fromLocationId: loc("SLP").id,
    toLocationId: loc("TSK").id,
    gradeId: grade("US").id,
    kg: 200,
    sentDate: "2026-08-08",
    receivedDate: null,
    status: "in_transit" as const,
  },
  {
    id: "99999999-9999-9999-9999-999999999903",
    fromLocationId: loc("CKL").id,
    toLocationId: loc("TSK").id,
    gradeId: grade("UK").id,
    kg: 100,
    sentDate: "2026-08-06",
    receivedDate: "2026-08-06",
    status: "received" as const,
  },
];

const correction = [
  {
    locationId: loc("TSK").id,
    gradeId: grade("UB").id,
    effectiveDate: "2026-08-06",
    kg: 150,
    status: "posted" as const,
  },
  {
    locationId: loc("TSK").id,
    gradeId: grade("US").id,
    effectiveDate: "2026-08-06",
    kg: 999,
    status: "draft" as const,
  },
];

// ---------------------------------------------------------------------------
// Perhitungan golden (terpisah dari engine).
// ---------------------------------------------------------------------------
type Layer = { date: string; kg: number };
type Combo = { locId: string; gradeId: string; ledger: Layer[] };

const combos: Combo[] = LOCATIONS.flatMap((l) =>
  GRADES.map((g) => ({ locId: l.id, gradeId: g.id, ledger: [] as Layer[] })),
);
const comboMap = new Map(combos.map((c) => [`${c.locId}|${c.gradeId}`, c]));

function addLayer(c: Combo, date: string, kg: number) {
  if (kg <= 0) return;
  c.ledger.push({ date, kg });
  c.ledger.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function consume(c: Combo, kg: number): Layer[] {
  let remaining = kg;
  const out: Layer[] = [];
  while (remaining > 1e-9 && c.ledger.length > 0) {
    const oldest = c.ledger[0];
    const take = Math.min(remaining, oldest.kg);
    out.push({ date: oldest.date, kg: take });
    oldest.kg -= take;
    remaining -= take;
    if (oldest.kg <= 1e-9) c.ledger.shift();
  }
  return out;
}


function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);
}

function buckets(c: Combo, today: string): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (const layer of c.ledger) {
    const age = Math.max(0, dayDiff(layer.date, today));
    const idx = age <= BUCKETS[0] ? 0 : age <= BUCKETS[1] ? 1 : age <= BUCKETS[2] ? 2 : 3;
    out[idx] += layer.kg;
  }
  return out;
}

const prev: Record<string, number> = {};
const transferLayers = new Map<string, Layer[]>();
const rows: Array<Record<string, string | null>> = [];
const byKey = new Map<string, Record<string, string | null>>();
const productionValues = new Map<string, number>();

for (const [dayIndex, day] of days.entries()) {
  if (dayIndex === 0) {
    for (const line of opening) {
      const c = comboMap.get(`${line.locationId}|${line.gradeId}`)!;
      addLayer(c, START, line.kg);
    }
  }
  for (const p of production.filter((p) => p.date === day)) {
    const c = comboMap.get(`${p.locationId}|${p.gradeId}`)!;
    addLayer(c, day, p.kg);
    productionValues.set(`${p.locationId}|${p.gradeId}|${day}`, p.kg);
  }
  for (const corr of correction.filter((c) => c.effectiveDate === day && c.status === "posted")) {
    if (corr.kg > 0) addLayer(comboMap.get(`${corr.locationId}|${corr.gradeId}`)!, day, corr.kg);
  }
  for (const t of transfer.filter((t) => t.sentDate === day)) {
    const c = comboMap.get(`${t.fromLocationId}|${t.gradeId}`)!;
    transferLayers.set(t.id, consume(c, t.kg));
  }
  for (const t of transfer.filter((t) => t.receivedDate === day)) {
    const c = comboMap.get(`${t.toLocationId}|${t.gradeId}`)!;
    const carried = transferLayers.get(t.id) ?? [];
    const carriedKg = carried.reduce((a, l) => a + l.kg, 0);
    for (const layer of carried) addLayer(c, layer.date, layer.kg);
    if (t.kg - carriedKg > 1e-9) addLayer(c, t.sentDate, t.kg - carriedKg);
  }
  for (const o of outbound.filter((o) => o.date === day)) {
    consume(comboMap.get(`${o.locationId}|${o.gradeId}`)!, o.kg);
  }
  for (const s of shrinkage.filter((s) => s.date === day)) {
    consume(comboMap.get(`${s.locationId}|${s.gradeId}`)!, s.kg);
  }
  for (const corr of correction.filter((c) => c.effectiveDate === day && c.status === "posted" && c.kg < 0)) {
    consume(comboMap.get(`${corr.locationId}|${corr.gradeId}`)!, Math.abs(corr.kg));
  }

  for (const c of combos) {
    const k = `${c.locId}|${c.gradeId}`;
    const prod = production.find((p) => p.locationId === c.locId && p.gradeId === c.gradeId && p.date === day)?.kg ?? 0;
    const out = outbound.filter((o) => o.locationId === c.locId && o.gradeId === c.gradeId && o.date === day).reduce((a, o) => a + o.kg, 0);
    const shrink = shrinkage.filter((s) => s.locationId === c.locId && s.gradeId === c.gradeId && s.date === day).reduce((a, s) => a + s.kg, 0);
    const tIn = transfer.filter((t) => t.toLocationId === c.locId && t.gradeId === c.gradeId && t.receivedDate === day).reduce((a, t) => a + t.kg, 0);
    const tOut = transfer.filter((t) => t.fromLocationId === c.locId && t.gradeId === c.gradeId && t.sentDate === day).reduce((a, t) => a + t.kg, 0);
    const corr = correction.filter((x) => x.locationId === c.locId && x.gradeId === c.gradeId && x.effectiveDate === day && x.status === "posted").reduce((a, x) => a + x.kg, 0);
    const open = dayIndex === 0 ? opening.filter((o) => o.locationId === c.locId && o.gradeId === c.gradeId).reduce((a, o) => a + o.kg, 0) : prev[k] ?? 0;
    const closing = open + prod + tIn - out - tOut - shrink + corr;
    prev[k] = closing;
    const b = buckets(c, day);
    const transit = transfer
      .filter((t) => t.toLocationId === c.locId && t.gradeId === c.gradeId && t.sentDate <= day && (!t.receivedDate || day < t.receivedDate))
      .reduce((a, t) => a + t.kg, 0);
    const row = {
      locationId: c.locId,
      gradeId: c.gradeId,
      date: day,
      opening: open,
      production: prod,
      transferIn: tIn,
      outbound: out,
      transferOut: tOut,
      shrinkage: shrink,
      correction: corr,
      closing,
      inTransit: transit,
      ageB1: b[0],
      ageB2: b[1],
      ageB3: b[2],
      ageB4: b[3],
      daysOfStock: null as number | null,
      valueRp: Math.round(closing * HPP * 100) / 100,
    };
    rows.push(row);
    byKey.set(`${c.locId}|${c.gradeId}|${day}`, row);
  }
}

// Hari stok: rata-rata produksi 7 hari terakhir (gudang: semua kandang).
const kandangIds = LOCATIONS.filter((l) => l.kind === "kandang").map((l) => l.id);
for (const row of rows) {
  const locId = row.locationId as string;
  const gradeId = row.gradeId as string;
  const day = row.date as string;
  const idx = days.indexOf(day);
  const windowDays = days.slice(Math.max(0, idx - 6), idx + 1);
  const values = windowDays.map((d) => {
    if (LOCATIONS.find((l) => l.id === locId)!.kind === "gudang") {
      return kandangIds.reduce((a, kid) => a + (productionValues.get(`${kid}|${gradeId}|${d}`) ?? 0), 0);
    }
    return productionValues.get(`${locId}|${gradeId}|${d}`) ?? 0;
  });
  const avg = values.reduce((a, v) => a + v, 0) / values.length;
  row.daysOfStock = avg > 0 ? Number(((row.closing as number) / avg).toFixed(3)) : null;
}

// Spot check manual (dicetak agar bisa ditempel di log).
const rowKeyByCode = (locCode: string, gradeCode: string, day: string) =>
  `${loc(locCode).id}|${grade(gradeCode).id}|${day}`;
const spot = [
  rowKeyByCode("SLP", "UB", "2026-08-02"),
  rowKeyByCode("SLP", "UB", "2026-08-10"),
  rowKeyByCode("TSK", "UB", "2026-08-07"),
  rowKeyByCode("TSK", "UB", "2026-08-10"),
];
const spotOut = spot.map((k) => ({ key: k, ...byKey.get(k)! }));
const tskUbDay10 = byKey.get(rowKeyByCode("TSK", "UB", "2026-08-10"))!;

const fixtureDir = path.join(process.cwd(), "fixtures", "week-example");
fs.mkdirSync(fixtureDir, { recursive: true });

const transactions = {
  startDate: START,
  endDate: END,
  openingDate: START,
  hppPerKg: HPP,
  bucketDays: BUCKETS,
  locations: LOCATIONS,
  grades: GRADES,
  opening,
  production,
  outbound,
  transfer,
  shrinkage,
  correction,
};

fs.writeFileSync(path.join(fixtureDir, "transactions.json"), JSON.stringify(transactions, null, 2));
fs.writeFileSync(
  path.join(fixtureDir, "golden.json"),
  JSON.stringify(
    {
      note: "Dihitung scripts/compute-golden.ts (implementasi terpisah dari engine). Jangan diubah untuk membuat tes hijau.",
      hppPerKg: HPP,
      bucketDays: BUCKETS,
      rows,
      spotChecks: {
        "SLP|UB|2026-08-02": { closing: 4500, opening: 4350, production: 1350, outbound: 1200 },
        "SLP|UB|2026-08-10": { closing: 12900 },
        "TSK|UB|2026-08-05": { closing: 1700, transferIn: 500 },
        "TSK|UB|2026-08-07": { closing: 1050, outbound: 800 },
        "TSK|UB|2026-08-10": { closing: 450, ageB2: 150, ageB3: 300 },
      },
    },
    null,
    2,
  ),
);

console.log(`rows=${rows.length}`);
console.log(JSON.stringify(spotOut, null, 2));
console.log("TSK UB 08-10", JSON.stringify(tskUbDay10, null, 2));
