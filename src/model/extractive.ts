import { terms } from "../text.ts";
import { expectation, extractValue, norm } from "../values.ts";
import type { ContextItem, Draft, Evidence, SourcedCitation } from "../types.ts";
import type { Answerer } from "./types.ts";

/** Share of the question's idf mass a sentence (plus its item's title/heading) must cover. */
export const MIN_COVERAGE = 0.6;
/** Text answers have no typed value to check, so they need stronger lexical support. */
export const MIN_COVERAGE_TEXT = 0.75;
/** Two documents within this coverage distance with different values are reported as a conflict. */
export const CONFLICT_MARGIN = 0.1;

export interface Candidate {
  ev: Evidence;
  coverage: number;
  value?: string;
  rank: number;
}

/**
 * Fixture answerer. Deterministic and extractive: it scores every sentence in the context it was
 * handed, picks the best supported one, and quotes it verbatim. It never sees the labels and never
 * looks outside the context, so a strategy that drops a fact makes it fail, as it should.
 * This proves the pipeline and the guards. It says nothing about how well a real model reads.
 */
export class ExtractiveAnswerer implements Answerer {
  readonly id = "fixture:extractive";
  constructor(private readonly idf: (term: string) => number) {}

  candidates(question: string, items: ContextItem[]): Candidate[] {
    const exp = expectation(question);
    // Words that only name the kind of answer ("date") are satisfied by finding a value of that kind.
    const typeWords = new Set(exp.kind === "date" ? terms("date dates") : []);
    const q = [...new Set(terms(question))].filter((t) => !typeWords.has(t));
    const mass = q.reduce((a, t) => a + this.idf(t), 0) || 1;
    const out: Candidate[] = [];
    const seen = new Set<string>();
    items.forEach((item, rank) => {
      const ctx = new Set(terms(item.context));
      for (const ev of item.evidence) {
        if (ev.text.trim().endsWith("?")) continue; // a question is not evidence
        const key = JSON.stringify(ev);
        if (seen.has(key)) continue;
        seen.add(key);
        const have = new Set([...terms(ev.text), ...ctx]);
        const coverage = q.reduce((a, t) => a + (have.has(t) ? this.idf(t) : 0), 0) / mass;
        const value = extractValue(ev.text, exp);
        if (exp.kind !== "text" && !value) continue;
        out.push({ ev, coverage, value, rank });
      }
    });
    return out.sort((a, b) => b.coverage - a.coverage || a.rank - b.rank);
  }

  async answer(question: string, items: ContextItem[]): Promise<Draft> {
    const exp = expectation(question);
    const min = exp.kind === "text" ? MIN_COVERAGE_TEXT : MIN_COVERAGE;
    const cands = this.candidates(question, items).filter((c) => c.coverage >= min);
    const best = cands[0];
    if (!best) return { status: "insufficient_evidence", answer: "No passage in the provided context supports an answer.", citations: [] };

    const cite = (c: Candidate): SourcedCitation => ({ source: c.ev.source, quote: c.ev.text });
    const docOf = (c: Candidate) => (c.ev.source.kind === "doc" ? c.ev.source.doc_id : undefined);
    const near = cands.filter((c) => c !== best && c.coverage >= best.coverage - CONFLICT_MARGIN && docOf(c) && docOf(c) !== docOf(best));

    if (best.value !== undefined) {
      const disagree = near.filter((c) => norm(c.value!) !== norm(best.value!));
      if (disagree.length > 0) {
        const all = [best, ...disagree];
        const parts = all.map((c) => `${label(c)} says ${c.value}`);
        return { status: "conflict", answer: `The sources disagree: ${parts.join("; ")}.`, citations: dedupe(all.map(cite)) };
      }
      const agree = near.filter((c) => norm(c.value!) === norm(best.value!));
      return { status: "answered", answer: best.value, citations: dedupe([best, ...agree].map(cite)) };
    }
    return { status: "answered", answer: best.ev.text, citations: [cite(best)] };
  }
}

function label(c: Candidate): string {
  const s = c.ev.source;
  return s.kind === "doc" ? `${s.doc_id} §${s.section_id}` : `turn ${s.turn}`;
}

function dedupe(cs: SourcedCitation[]): SourcedCitation[] {
  const seen = new Set<string>();
  return cs.filter((c) => {
    const k = JSON.stringify(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
