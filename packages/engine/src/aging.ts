import { D, Decimal, Numeric, round3 } from "./decimal";
import { ageDays } from "./dates";

export interface StockLayer {
  date: string;
  kg: Decimal;
}

/**
 * R-11 (aging FIFO): lapisan stok per tanggal produksi. Keluar/susut mengurangi
 * lapisan tertua lebih dulu; mutasi membawa umur lapisan asalnya.
 */
export class StockLedger {
  private layers: StockLayer[] = [];

  constructor(initial: StockLayer[] = []) {
    for (const layer of initial) this.add(layer.date, layer.kg);
  }

  add(date: string, kg: Numeric): void {
    const amount = D(kg);
    if (amount.lessThanOrEqualTo(0)) return;
    let index = this.layers.findIndex((l) => l.date > date);
    if (index === -1) index = this.layers.length;
    this.layers.splice(index, 0, { date, kg: amount });
  }

  /** Menambah lapisan hasil mutasi dengan umur aslinya. */
  addLayers(layers: StockLayer[]): void {
    for (const layer of layers) this.add(layer.date, layer.kg);
  }

  total(): Decimal {
    return this.layers.reduce((acc, l) => acc.plus(l.kg), new Decimal(0));
  }

  layerCount(): number {
    return this.layers.length;
  }

  snapshot(): StockLayer[] {
    return this.layers.map((l) => ({ date: l.date, kg: l.kg }));
  }

  /**
   * Mengurangi stok dari lapisan tertua. Bila diminta lebih besar dari stok,
   * mengembalikan seluruh lapisan yang ada (bukan angka negatif).
   */
  consume(kg: Numeric): StockLayer[] {
    let remaining = D(kg);
    const consumed: StockLayer[] = [];
    if (remaining.lessThanOrEqualTo(0)) return consumed;

    while (remaining.greaterThan(0) && this.layers.length > 0) {
      const oldest = this.layers[0];
      const take = remaining.lessThan(oldest.kg) ? remaining : oldest.kg;
      consumed.push({ date: oldest.date, kg: take });
      oldest.kg = oldest.kg.minus(take);
      remaining = remaining.minus(take);
      if (oldest.kg.isZero()) this.layers.shift();
    }
    return consumed;
  }

  /** Bucket umur: 0–3, 4–7, 8–14, >14 (parameter). */
  buckets(today: string, bucketDays: [number, number, number]): [Decimal, Decimal, Decimal, Decimal] {
    const result = [new Decimal(0), new Decimal(0), new Decimal(0), new Decimal(0)];
    for (const layer of this.layers) {
      const age = Math.max(0, ageDays(layer.date, today));
      const index = age <= bucketDays[0] ? 0 : age <= bucketDays[1] ? 1 : age <= bucketDays[2] ? 2 : 3;
      result[index] = result[index].plus(layer.kg);
    }
    return [round3(result[0]), round3(result[1]), round3(result[2]), round3(result[3])];
  }
}

export function layersTotal(layers: StockLayer[]): Decimal {
  return layers.reduce((acc, l) => acc.plus(l.kg), new Decimal(0));
}
