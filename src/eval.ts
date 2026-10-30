import { readFileSync } from "node:fs";
import { join } from "node:path";
import { accept, answerQuestion, indexCorpus } from "./answer.ts";
import { Corpus, DATA_DIR } from "./corpus.ts";
import { loadDialogue, replay, turnText, type Probe, type Turn } from "./dialogue.ts";
import { pack, STRATEGIES, type StrategyName } from "./context/strategies.ts";
import { ExtractiveAnswerer } from "./model/extractive.ts";
import type { Answerer } from "./model/types.ts";
import { norm } from "./values.ts";
import { srcKey, type Answer, type Status } from "./types.ts";

export interface LabelledQuestion {
  id: string;
  kind: "supported" | "updated" | "contradiction" | "unsupported";
  question: string;
  expected_status: Status;
  expected_answer: string | null;
  stale_answer?: string;
  allowed_sources: string[];
}

export function loadQuestions(file = join(DATA_DIR, "questions.json")): LabelledQuestion[] {
  return (JSON.parse(readFileSync(file, "utf8")) as { questions: LabelledQuestion[] }).questions;
}

export interface QaResult {
  id: string;
  kind: string;
  question: string;
  pass: boolean;
  reasons: string[];
  answer: Answer;
}

/** Score one answer against its label: status, value, and that every citation is an allowed source. */
export function scoreQa(q: LabelledQuestion, a: Answer): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (a.status !== q.expected_status) reasons.push(`status ${a.status}, expected ${q.expected_status}`);
  if (q.expected_answer && !norm(a.answer).includes(norm(q.expected_answer))) reasons.push(`answer lacks "${q.expected_answer}"`);
  const allowed = new Set(q.allowed_sources);
  for (const c of a.citations) if (!allowed.has(`${c.doc_id}#${c.section_id}`)) reasons.push(`citation ${c.doc_id}#${c.section_id} not allowed`);
  if (q.expected_status === "conflict") {
    const cited = new Set(a.citations.map((c) => `${c.doc_id}#${c.section_id}`));
    for (const s of q.allowed_sources) if (!cited.has(s)) reasons.push(`conflict does not cite ${s}`);
  }
  return { pass: reasons.length === 0, reasons };
}

export async function runQa(corpus = Corpus.load(), answerer?: Answerer): Promise<QaResult[]> {
  const a = answerer ?? new ExtractiveAnswerer((t) => indexCorpus(corpus).idf(t));
  const out: QaResult[] = [];
  for (const q of loadQuestions()) {
    const r = await answerQuestion(q.question, corpus, a);
    out.push({ id: q.id, kind: q.kind, question: q.question, ...scoreQa(q, r.answer), answer: r.answer });
  }
  return out;
}

export function qaSummary(rs: QaResult[]) {
  const byKind: Record<string, { pass: number; total: number }> = {};
  for (const r of rs) {
    const k = (byKind[r.kind] ??= { pass: 0, total: 0 });
    k.total++;
    if (r.pass) k.pass++;
  }
  return { pass: rs.filter((r) => r.pass).length, total: rs.length, by_kind: byKind, failed: rs.filter((r) => !r.pass).map((r) => ({ id: r.id, reasons: r.reasons })) };
}

// ---------------------------------------------------------------- context comparison

export type Outcome = "correct" | "stale_blocked_by_verifier" | "stale_accepted" | "rejected_by_verifier" | "abstained" | "wrong";

export interface ProbeRun {
  probe: string;
  kind: string;
  strategy: StrategyName;
  outcome: Outcome;
  status: Status;
  answer: string;
  /** What the answerer proposed before verification. Shows what a strategy WOULD have said. */
  proposed: string;
  sources: string[];
  evidence_from: string[];
  verify_problems: string[];
  tokens_est: number;
  over_budget: boolean;
  stale_dropped: string[];
}

function outcomeOf(p: Probe, proposed: { status: Status; answer: string }, final: { status: Status; answer: string }, sources: string[]): Outcome {
  const proposedStale = !!p.stale_answer && norm(proposed.answer).includes(norm(p.stale_answer));
  if (proposedStale) return final.status === "answered" ? "stale_accepted" : "stale_blocked_by_verifier";
  if (proposed.status !== "insufficient_evidence" && final.status === "insufficient_evidence") return "rejected_by_verifier";
  if (final.status !== p.expected_status) return final.status === "insufficient_evidence" ? "abstained" : "wrong";
  if (p.expected_status === "answered") {
    const okValue = !!p.expected_answer && norm(final.answer).includes(norm(p.expected_answer));
    const okSource = !p.expected_source || sources.includes(p.expected_source);
    return okValue && okSource ? "correct" : "wrong";
  }
  if (p.expected_status === "conflict") return (p.expected_source ?? "").split("|").every((s) => sources.includes(s)) ? "correct" : "wrong";
  return "correct";
}

export async function runProbe(p: Probe, strategy: StrategyName, turns: Turn[], corpus: Corpus, answerer: Answerer, budget: number): Promise<ProbeRun> {
  const ctx = pack(strategy, p.question, turns, corpus, { budget });
  const proposed = await answerer.answer(p.question, ctx.items);
  const { draft, verify } = accept(proposed, corpus, turnText(turns));
  const sources = draft.citations.map((c) => srcKey(c.source));
  const fromKinds = proposed.citations.map((c) => {
    const it = ctx.items.find((i) => i.evidence.some((e) => e.text === c.quote && srcKey(e.source) === srcKey(c.source)));
    return it ? it.kind : "unknown";
  });
  return {
    probe: p.id,
    kind: p.kind,
    strategy,
    outcome: outcomeOf(p, proposed, draft, sources),
    status: draft.status,
    answer: draft.answer,
    proposed: `${proposed.status}: ${proposed.answer}`,
    sources,
    evidence_from: [...new Set(fromKinds)],
    verify_problems: verify.problems,
    tokens_est: ctx.tokens,
    over_budget: ctx.overBudget,
    stale_dropped: ctx.staleDropped,
  };
}

export interface StrategySummary {
  strategy: StrategyName;
  correct: number;
  total: number;
  outcomes: Record<string, number>;
  probe_tokens_est: { mean: number; max: number };
  probes_over_budget: number;
  /** Largest context packed at any user turn during the replay, not only at probes. */
  max_turn_context_est: number;
  turns_over_budget: number;
}

export interface ContextReport {
  budget: number;
  dialogue_turns: number;
  full_transcript_tokens_est: number;
  strategies: StrategySummary[];
  probes: ProbeRun[];
}

export async function runContext(budget: number, prepared?: { turns: Turn[]; corpus: Corpus }): Promise<ContextReport> {
  const d = loadDialogue();
  const { turns, corpus } = prepared ?? (await replay(d));
  const answerer = new ExtractiveAnswerer((t) => indexCorpus(corpus).idf(t));
  const probes: ProbeRun[] = [];
  const strategies: StrategySummary[] = [];
  for (const s of STRATEGIES) {
    const runs: ProbeRun[] = [];
    for (const p of d.probes) runs.push(await runProbe(p, s, turns, corpus, answerer, budget));
    probes.push(...runs);
    // Context size at every user turn of the replay, built from the history before it.
    // Uses the final corpus for retrieval: sizes only, no answers are scored here.
    let maxTurn = 0;
    let over = 0;
    for (let i = 0; i < turns.length; i++) {
      if (turns[i]!.role !== "user") continue;
      const c = pack(s, turns[i]!.text, turns.slice(0, i), corpus, { budget });
      maxTurn = Math.max(maxTurn, c.tokens);
      if (c.overBudget) over++;
    }
    const outcomes: Record<string, number> = {};
    for (const r of runs) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
    const toks = runs.map((r) => r.tokens_est);
    strategies.push({
      strategy: s,
      correct: outcomes.correct ?? 0,
      total: runs.length,
      outcomes,
      probe_tokens_est: { mean: Math.round(toks.reduce((a, b) => a + b, 0) / toks.length), max: Math.max(...toks) },
      probes_over_budget: runs.filter((r) => r.over_budget).length,
      max_turn_context_est: maxTurn,
      turns_over_budget: over,
    });
  }
  const full = pack("full_history", "", turns, corpus, { budget }).tokens;
  return { budget, dialogue_turns: turns.length, full_transcript_tokens_est: full, strategies, probes };
}

