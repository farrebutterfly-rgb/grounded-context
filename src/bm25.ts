import { terms } from "./text.ts";

/** Okapi BM25 written out by hand. k1 and b are the usual defaults. */
export class Bm25<T> {
  private readonly docs: { item: T; tf: Map<string, number>; len: number }[];
  private readonly df = new Map<string, number>();
  private readonly avgLen: number;

  constructor(items: T[], textOf: (x: T) => string, private readonly k1 = 1.2, private readonly b = 0.75) {
    this.docs = items.map((item) => {
      const ts = terms(textOf(item));
      const tf = new Map<string, number>();
      for (const t of ts) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return { item, tf, len: ts.length };
    });
    this.avgLen = this.docs.reduce((a, d) => a + d.len, 0) / Math.max(1, this.docs.length);
  }

  get size(): number {
    return this.docs.length;
  }

  /** BM25 idf, always positive. A term the index has never seen gets the highest idf. */
  idf(term: string): number {
    const n = this.docs.length;
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  search(query: string, k: number): { item: T; score: number }[] {
    const q = [...new Set(terms(query))];
    const scored = this.docs.map((d) => {
      let score = 0;
      for (const t of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        score += this.idf(t) * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.len) / this.avgLen)));
      }
      return { item: d.item, score };
    });
    return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
  }
}
