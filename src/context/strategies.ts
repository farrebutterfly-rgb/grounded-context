import { DEFAULT_K, retrieve, sectionItem } from "../answer.ts";
import type { Corpus } from "../corpus.ts";
import { turnItem, type Turn } from "../dialogue.ts";
import { estimateTokens, sentences } from "../text.ts";
import type { ContextItem, Evidence } from "../types.ts";

export type StrategyName = "full_history" | "truncation" | "source_bound_summary";
export const STRATEGIES: StrategyName[] = ["full_history", "truncation", "source_bound_summary"];

export interface PackedContext {
  strategy: StrategyName;
  /** In priority order: the answerer prefers earlier items on ties. */
  items: ContextItem[];
  /** Estimated tokens of question + items. See TOKEN_METHOD. */
  tokens: number;
  budget: number;
  overBudget: boolean;
  /** Summary entries dropped because the document they point to has a newer version. */
  staleDropped: string[];
  notes: string[];
}

export interface PackOptions {
  budget: number;
  /** Share of the budget the summary strategy keeps for recent turns verbatim. */
  recentShare?: number;
  k?: number;
}

const tok = (i: ContextItem) => estimateTokens(i.rendered) + 1; // +1 for the separator

/** Strategy 1: everything, newest first. Ignores the budget and reports when it is exceeded. */
export function fullHistory(question: string, turns: Turn[], corpus: Corpus, o: PackOptions): PackedContext {
  const items = [...turns].reverse().map((t) => turnItem(t, corpus));
  return finish("full_history", question, items, o.budget, [], []);
}

/** Strategy 2: as many of the most recent turns as fit the budget. No retrieval, no summary. */
export function truncation(question: string, turns: Turn[], corpus: Corpus, o: PackOptions): PackedContext {
  let used = estimateTokens(question);
  const items: ContextItem[] = [];
  for (const t of [...turns].reverse()) {
    const it = turnItem(t, corpus);
    if (used + tok(it) > o.budget) break;
    items.push(it);
    used += tok(it);
  }
  return finish("truncation", question, items, o.budget, [], [`kept ${items.length} of ${turns.length} turns`]);
}

/** Does a user sentence state something worth keeping: a number, a date, an id or an address? */
const FACTUAL = /\d|@|\b[A-Z]{2,}-\d+/;

export interface SummaryEntry {
  fromTurn: number;
  ev: Evidence;
}

/**
 * Source-bound summary of older turns. Extractive on purpose: every entry is a verbatim sentence and
 * keeps a pointer to where it came from (a dialogue turn, or a document section AND version).
 * Small talk and questions are dropped.
 */
export function summarise(turns: Turn[]): SummaryEntry[] {
  const out: SummaryEntry[] = [];
  for (const t of turns) {
    if (t.role === "user") {
      for (const s of sentences(t.text)) if (!s.endsWith("?") && FACTUAL.test(s)) out.push({ fromTurn: t.turn, ev: { text: s, source: { kind: "turn", turn: t.turn } } });
    } else {
      for (const c of t.citations ?? []) out.push({ fromTurn: t.turn, ev: { text: c.quote, source: c.source } });
    }
  }
  return out;
}

export function summaryItem(e: SummaryEntry, corpus: Corpus): ContextItem {
  const s = e.ev.source;
  const bound = s.kind === "doc" ? `${s.doc_id} §${s.section_id} v${s.version}` : `turn ${s.turn}`;
  const context = s.kind === "doc" ? `${corpus.get(s.doc_id, s.version)?.title ?? ""} ${corpus.section(s.doc_id, s.section_id, s.version)?.heading ?? ""}` : "";
  return { kind: "summary", label: `summary of turn ${e.fromTurn}, bound to ${bound}`, rendered: `[summary of turn ${e.fromTurn}, bound to ${bound}] "${e.ev.text}"`, context, evidence: [e.ev] };
}

/**
 * Strategy 3: fresh retrieval from the CURRENT documents, then the source-bound summary of older
 * turns, then recent turns verbatim, all inside the budget. A summary entry bound to a document
 * version that is no longer current is dropped before packing, so a newer document always beats
 * an old summary.
 */
export function sourceBoundSummary(question: string, turns: Turn[], corpus: Corpus, o: PackOptions): PackedContext {
  const budget = o.budget;
  const recentBudget = Math.floor(budget * (o.recentShare ?? 0.3));
  let used = estimateTokens(question);

  // Recent window, chosen first so we know which turns the summary must cover.
  const recent: ContextItem[] = [];
  let recentUsed = 0;
  let cut = turns.length;
  for (let i = turns.length - 1; i >= 0; i--) {
    const it = turnItem(turns[i]!, corpus);
    if (recentUsed + tok(it) > recentBudget) break;
    recent.push(it);
    recentUsed += tok(it);
    cut = i;
  }

  const staleDropped: string[] = [];
  const entries = summarise(turns.slice(0, cut)).filter((e) => {
    const s = e.ev.source;
    if (s.kind === "doc" && (corpus.currentVersion(s.doc_id) ?? 0) > s.version) {
      staleDropped.push(`turn ${e.fromTurn}: ${s.doc_id} §${s.section_id} v${s.version} (current v${corpus.currentVersion(s.doc_id)})`);
      return false;
    }
    return true;
  });

  const items: ContextItem[] = [];
  const add = (it: ContextItem) => {
    if (used + tok(it) > budget) return false;
    items.push(it);
    used += tok(it);
    return true;
  };
  for (const h of retrieve(corpus, question, o.k ?? DEFAULT_K)) add(sectionItem(corpus, h.section));
  for (const e of [...entries].reverse()) add(summaryItem(e, corpus));
  for (const it of recent) add(it);
  const notes = [`${entries.length} summary entries from turns 1-${turns[cut - 1]?.turn ?? 0}`, `${recent.length} recent turns verbatim`];
  return finish("source_bound_summary", question, items, budget, staleDropped, notes);
}

function finish(strategy: StrategyName, question: string, items: ContextItem[], budget: number, staleDropped: string[], notes: string[]): PackedContext {
  const tokens = estimateTokens(question) + items.reduce((a, i) => a + tok(i), 0);
  return { strategy, items, tokens, budget, overBudget: tokens > budget, staleDropped, notes };
}

export function pack(name: StrategyName, question: string, turns: Turn[], corpus: Corpus, o: PackOptions): PackedContext {
  if (name === "full_history") return fullHistory(question, turns, corpus, o);
  if (name === "truncation") return truncation(question, turns, corpus, o);
  return sourceBoundSummary(question, turns, corpus, o);
}
