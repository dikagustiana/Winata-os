import { D, Decimal, Numeric, q3, round3 } from "./decimal";

/** R-4: satuan input kuantitas. */
export type Unit = "kg" | "peti" | "tray" | "btr";

export interface ConversionVersion {
  gradeId: string;
  validFrom: string;
  kgPerCrate: Numeric | null;
  kgPerTray: Numeric | null;
  eggsPerKg: Numeric | null;
}

export interface Quantity {
  qty: Numeric;
  unit: Unit;
  gradeId: string;
  date: string;
}

export function resolveConversion(
  versions: ConversionVersion[],
  gradeId: string,
  date: string,
): ConversionVersion | null {
  const applicable = versions
    .filter((v) => v.gradeId === gradeId && v.validFrom <= date)
    .sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));
  return applicable[0] ?? null;
}

/**
 * R-4: konversi qty + satuan ke kg memakai versi unit_conversion yang berlaku
 * pada tanggal transaksi. Tidak pernah dihitung ulang retroaktif.
 */
export function toKg(quantity: Quantity, conversion: ConversionVersion | null): Decimal {
  const qty = D(quantity.qty);
  if (quantity.unit === "kg") return round3(qty);
  if (!conversion) throw new Error(`Konversi untuk grade ${quantity.gradeId} pada ${quantity.date} tidak ada`);
  switch (quantity.unit) {
    case "peti": {
      if (conversion.kgPerCrate === null) throw new Error("kg per peti belum diisi");
      return round3(qty.times(D(conversion.kgPerCrate)));
    }
    case "tray": {
      if (conversion.kgPerTray === null) throw new Error("kg per tray belum diisi");
      return round3(qty.times(D(conversion.kgPerTray)));
    }
    case "btr": {
      if (conversion.eggsPerKg === null) throw new Error("butir per kg belum diisi");
      return round3(qty.dividedBy(D(conversion.eggsPerKg)));
    }
  }
}

/** R-14: butir diturunkan dari kg untuk tampilan. */
export function eggsFromKg(kg: Numeric, conversion: ConversionVersion | null): number {
  if (!conversion || conversion.eggsPerKg === null) return 0;
  return Math.round(D(kg).times(D(conversion.eggsPerKg)).toNumber());
}

export interface OpnameLineInput {
  gradeId: string;
  crates: Numeric;
  trays: Numeric;
  looseEggs: Numeric;
  sampleCrates: Numeric;
  sampleKg: Numeric;
  sampleEggsPerTray: Numeric | null;
  /** Dipakai bila baris tidak punya sampel (mis. impor BA lama). */
  fallback?: ConversionVersion | null;
}

export interface OpnameLineResult {
  kg: Decimal;
  eggs: number;
  kgPerCrateSample: Decimal | null;
  kgPerTraySample: Decimal | null;
}

/**
 * R-5: kg hasil = Σ(peti × kg/peti sampel) + Σ(tray × kg/tray) + butir sisa ÷ butir/kg.
 * Sampel: n peti ditimbang total kg; butir per tray sampel. Bila `sampleCrates`
 * kosong, dipakai nilai konversi terakhir sebagai fallback.
 */
export function opnameLineKg(line: OpnameLineInput, conversion: ConversionVersion | null): OpnameLineResult {
  const crates = D(line.crates);
  const trays = D(line.trays);
  const loose = D(line.looseEggs);
  const sampleCrates = D(line.sampleCrates);
  const sampleKg = D(line.sampleKg);

  const fallbackKgPerCrate = line.fallback?.kgPerCrate ?? conversion?.kgPerCrate ?? null;
  const fallbackKgPerTray = line.fallback?.kgPerTray ?? conversion?.kgPerTray ?? null;
  const eggsPerKg = line.fallback?.eggsPerKg ?? conversion?.eggsPerKg ?? null;

  let kgPerCrateSample: Decimal | null = null;
  if (sampleCrates.greaterThan(0) && sampleKg.greaterThan(0)) {
    kgPerCrateSample = sampleKg.dividedBy(sampleCrates);
  }
  const kgPerCrate = kgPerCrateSample ?? (fallbackKgPerCrate === null ? null : D(fallbackKgPerCrate));

  let kgPerTray: Decimal | null = null;
  if (line.sampleEggsPerTray !== null && eggsPerKg !== null) {
    kgPerTray = D(line.sampleEggsPerTray).dividedBy(D(eggsPerKg));
  } else if (fallbackKgPerTray !== null) {
    kgPerTray = D(fallbackKgPerTray);
  }

  if (crates.greaterThan(0) && kgPerCrate === null) {
    throw new Error(`kg per peti grade ${line.gradeId} belum ada (sampel maupun konversi)`);
  }
  if (trays.greaterThan(0) && kgPerTray === null) {
    throw new Error(`kg per tray grade ${line.gradeId} belum ada`);
  }
  if (loose.greaterThan(0) && eggsPerKg === null) {
    throw new Error(`butir per kg grade ${line.gradeId} belum ada`);
  }

  let kg = crates.times(kgPerCrate ?? 0).plus(trays.times(kgPerTray ?? 0));
  if (loose.greaterThan(0) && eggsPerKg !== null) {
    kg = kg.plus(loose.dividedBy(D(eggsPerKg)));
  }
  kg = round3(kg);

  const eggs = eggsPerKg === null ? 0 : Math.round(kg.times(D(eggsPerKg)).toNumber());

  return { kg, eggs, kgPerCrateSample, kgPerTraySample: kgPerTray };
}

/** Nilai sampel yang harus disimpan sebagai versi unit_conversion baru. */
export function conversionFromSample(
  gradeId: string,
  validFrom: string,
  sampleCrates: Numeric,
  sampleKg: Numeric,
  sampleEggsPerTray: Numeric | null,
  eggsPerKg: Numeric | null,
): ConversionVersion {
  const crates = D(sampleCrates);
  const kgPerCrate = crates.greaterThan(0) ? D(sampleKg).dividedBy(crates) : null;
  const kgPerTray =
    sampleEggsPerTray !== null && eggsPerKg !== null
      ? D(sampleEggsPerTray).dividedBy(D(eggsPerKg))
      : null;
  return {
    gradeId,
    validFrom,
    kgPerCrate: kgPerCrate === null ? null : q3(kgPerCrate),
    kgPerTray: kgPerTray === null ? null : q3(kgPerTray),
    eggsPerKg,
  };
}

export function unitLabel(unit: Unit): string {
  return { kg: "kg", peti: "peti", tray: "tray", btr: "btr" }[unit];
}
