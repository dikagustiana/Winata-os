/**
 * Pemeriksa UI sesuai DESIGN §1 dan ARCHITECTURE §9:
 * 1. Tidak ada kode spesifikasi (K1, R-10, Q-1, T-01) di teks yang dilihat pengguna.
 * 2. Tidak ada placeholder sebagai label, tidak ada window.confirm.
 * 3. Kontras token utama >= 4,5:1.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const UI_DIRS = [path.join(ROOT, "apps", "web", "app"), path.join(ROOT, "apps", "web", "components")];
const CODE_PATTERN = /\b(?:K[1-9]|R-\d+|Q-\d+|T-\d+)\b/;
const ALLOWED_TITLE = /title=\{?/;

const errors: string[] = [];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

for (const dir of UI_DIRS) {
  for (const file of walk(dir)) {
    const relative = path.relative(ROOT, file);
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      if (line.includes("window.confirm(")) {
        errors.push(`${relative}:${index + 1}: window.confirm dilarang; pakai konfirmasi di dalam form.`);
      }
      if (/\bplaceholder\s*=/.test(line) && !line.trim().startsWith("//")) {
        errors.push(`${relative}:${index + 1}: placeholder tidak boleh menggantikan label.`);
      }
      if (ALLOWED_TITLE.test(line)) return;

      const attributeMatches = line.matchAll(
        /\b(sub|empty|successMessage|submitLabel|label|help)="([^"]*)"/g,
      );
      for (const match of attributeMatches) {
        if (CODE_PATTERN.test(match[2])) {
          errors.push(`${relative}:${index + 1}: kode spesifikasi "${match[2]}" terlihat pengguna (${match[1]}).`);
        }
      }

      const textMatches = line.matchAll(/>([^<>{}]+)</g);
      for (const match of textMatches) {
        if (CODE_PATTERN.test(match[1])) {
          errors.push(`${relative}:${index + 1}: kode spesifikasi "${match[1].trim()}" terlihat pengguna.`);
        }
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Kontras token
// ---------------------------------------------------------------------------
const tokensPath = path.join(ROOT, "apps", "web", "app", "tokens.css");
const tokensCss = fs.readFileSync(tokensPath, "utf8");
const token = (name: string): string => {
  const match = tokensCss.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`Token --${name} tidak ditemukan di tokens.css`);
  return match[1];
};

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

const pairs: Array<[string, string, string]> = [
  ["ink", "surface", "--ink pada --surface"],
  ["ink-2", "surface", "--ink-2 pada --surface"],
  ["ink-3", "surface", "--ink-3 pada --surface"],
  ["accent", "surface", "--accent pada --surface"],
  ["approved", "surface", "--approved pada --surface"],
  ["locked", "surface", "--locked pada --surface"],
  ["warn-ink", "warn-weak", "--warn-ink pada --warn-weak"],
  ["fail", "fail-weak", "--fail pada --fail-weak"],
];

for (const [foreground, background, label] of pairs) {
  const ratio = contrast(token(foreground), token(background));
  if (ratio < 4.5) errors.push(`Kontras ${label} = ${ratio.toFixed(2)}:1 (< 4,5:1).`);
}

if (errors.length > 0) {
  console.error("lint-ui gagal:");
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}
console.log("lint-ui: bersih (tanpa kode spesifikasi di UI, tanpa placeholder/window.confirm, kontras token >= 4,5:1).");
