/**
 * Menghasilkan supabase/seed/0005_hdp.sql dari titik jangkar kurva standar
 * strain (Isa Brown, Lohmann Brown, Hy-Line Brown), umur 18-90 minggu.
 *
 * Sumber: rentang kurva manajemen strain yang dipublikasikan (lihat
 * docs/reference/hdp-sources.md). Nilai diinterpolasi linear antartitik dan
 * WAJIB dikonfirmasi pemilik (Q-5). Ini data seed berlabel "standar strain, seed".
 */
import fs from "node:fs";
import path from "node:path";

type Anchor = [age: number, hdp: number, eggG: number];

const STRAINS: Record<string, Anchor[]> = {
  "Isa Brown": [
    [18, 20, 50.0], [19, 45, 54.0], [20, 70, 57.0], [21, 85, 59.0], [22, 90, 60.5],
    [23, 93, 61.5], [24, 95, 62.2], [25, 96, 62.8], [26, 96.5, 63.2], [28, 96.5, 63.8],
    [30, 96, 64.4], [35, 94, 65.5], [40, 91.5, 66.3], [45, 88.5, 66.9], [50, 86, 67.4],
    [55, 83.5, 67.8], [60, 81, 68.1], [65, 78.5, 68.4], [70, 76, 68.7], [75, 73.5, 68.9],
    [80, 71, 69.1], [85, 68.5, 69.3], [90, 66, 69.5],
  ],
  "Lohmann Brown": [
    [18, 25, 51.0], [19, 50, 55.0], [20, 72, 58.0], [21, 87, 60.0], [22, 92, 61.5],
    [23, 95, 62.5], [24, 96, 63.2], [25, 97, 63.8], [26, 97, 64.2], [28, 96.5, 64.8],
    [30, 96, 65.4], [35, 94.5, 66.2], [40, 92, 66.9], [45, 89.5, 67.5], [50, 87, 68.0],
    [55, 84, 68.4], [60, 81.5, 68.8], [65, 79, 69.1], [70, 76.5, 69.4], [75, 74, 69.6],
    [80, 71.5, 69.8], [85, 69, 70.0], [90, 66.5, 70.2],
  ],
  "Hy-Line Brown": [
    [18, 22, 50.5], [19, 47, 54.5], [20, 71, 57.5], [21, 86, 59.5], [22, 91, 61.0],
    [23, 94, 62.0], [24, 95.5, 62.8], [25, 96, 63.4], [26, 96.5, 63.9], [28, 96, 64.5],
    [30, 95.5, 65.0], [35, 94, 65.8], [40, 91.5, 66.5], [45, 89, 67.1], [50, 86.5, 67.6],
    [55, 84, 68.0], [60, 81, 68.3], [65, 78.5, 68.6], [70, 76, 68.9], [75, 73.5, 69.1],
    [80, 71, 69.3], [85, 68.5, 69.5], [90, 66, 69.7],
  ],
};

function interpolate(anchors: Anchor[], age: number): [number, number] {
  if (age <= anchors[0][0]) return [anchors[0][1], anchors[0][2]];
  const last = anchors[anchors.length - 1];
  if (age >= last[0]) return [last[1], last[2]];
  for (let i = 1; i < anchors.length; i++) {
    const [a2, h2, w2] = anchors[i];
    const [a1, h1, w1] = anchors[i - 1];
    if (age <= a2) {
      const t = (age - a1) / (a2 - a1);
      return [h1 + (h2 - h1) * t, w1 + (w2 - w1) * t];
    }
  }
  return [last[1], last[2]];
}

const lines: string[] = [
  "-- Seed kurva standar HDP dan berat telur (R-31, Q-5).",
  "-- Dihasilkan scripts/gen-hdp-seed.ts; sumber: docs/reference/hdp-sources.md.",
  "-- Label sumber 'standar strain, seed': perlu konfirmasi pemilik (Q-5).",
  "",
];

for (const [strain, anchors] of Object.entries(STRAINS)) {
  lines.push(`-- ${strain}`);
  for (let age = 18; age <= 90; age++) {
    const [hdp, egg] = interpolate(anchors, age);
    lines.push(
      `insert into hdp_standard (strain, age_week, hdp_pct, egg_weight_g, source) values ` +
        `('${strain}', ${age}, ${hdp.toFixed(1)}, ${egg.toFixed(2)}, 'standar strain, seed') ` +
        `on conflict do nothing;`,
    );
  }
  lines.push("");
}

const out = path.join(process.cwd(), "supabase", "seed", "0005_hdp.sql");
fs.writeFileSync(out, lines.join("\n"), "utf8");
console.log(`Wrote ${out} (${lines.length} baris)`);
