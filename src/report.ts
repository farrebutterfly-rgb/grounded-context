import { mkdirSync, writeFileSync } from "node:fs";
import { loadDialogue, replay } from "./dialogue.ts";
import { qaSummary, runContext, runQa, type ContextReport, type QaResult } from "./eval.ts";
import { CONFLICT_MARGIN, MIN_COVERAGE, MIN_COVERAGE_TEXT } from "./model/extractive.ts";
import { sessionRecord } from "./session.ts";
import { TOKEN_METHOD } from "./text.ts";
import { DEFAULT_K } from "./answer.ts";

export const DEFAULT_BUDGET = 500;
export const SWEEP = [300, 500, 800, 1200];

export function budgetFromArgs(argv: string[]): number {
  const i = argv.indexOf("--budget");
  const raw = i >= 0 ? argv[i + 1] : process.env.CONTEXT_BUDGET;
  const n = raw === undefined ? DEFAULT_BUDGET : Number(raw);
  if (!Number.isInteger(n) || n < 50) throw new Error(`invalid budget: ${raw}`);
  return n;
}

export interface FullReport {
  session: ReturnType<typeof sessionRecord>;
  config: Record<string, unknown>;
  qa: { summary: ReturnType<typeof qaSummary>; results: QaResult[] };
  context: ContextReport;
  sweep: { budget: number; strategy: string; correct: number; total: number; max_probe_tokens_est: number; probes_over_budget: number }[];
}

export async function buildReport(budget: number): Promise<FullReport> {
  const session = sessionRecord("fixture", { answerer: "fixture:extractive" });
  const qa = await runQa();
  const prepared = await replay(loadDialogue());
  const context = await runContext(budget, prepared);
  const sweep: FullReport["sweep"] = [];
  for (const b of [...new Set([...SWEEP, budget])].sort((x, y) => x - y)) {
    const r = b === budget ? context : await runContext(b, prepared);
    for (const s of r.strategies) sweep.push({ budget: b, strategy: s.strategy, correct: s.correct, total: s.total, max_probe_tokens_est: s.probe_tokens_est.max, probes_over_budget: s.probes_over_budget });
  }
  return {
    session,
    config: {
      budget_tokens_est: budget,
      token_method: TOKEN_METHOD,
      retrieval: `BM25 (k1=1.2, b=0.75) over current document versions, top ${DEFAULT_K} sections`,
      answerer: "fixture:extractive (deterministic, not a language model)",
      thresholds: { min_coverage: MIN_COVERAGE, min_coverage_text: MIN_COVERAGE_TEXT, conflict_margin: CONFLICT_MARGIN },
    },
    qa: { summary: qaSummary(qa), results: qa },
    context,
    sweep,
  };
}

/** JSON whose first line is the session record, so it matches the other evidence files and still parses. */
export function toJson(r: FullReport): string {
  const { session, ...rest } = r;
  return `{"session":${JSON.stringify(session)},\n${JSON.stringify(rest, null, 2).slice(2)}\n`;
}

export function toMarkdown(r: FullReport): string {
  const L: string[] = [];
  const s = r.qa.summary;
  L.push(`<!-- session: ${JSON.stringify(r.session)} -->`);
  L.push(`# Grounding and context report`, "");
  L.push(`Code ${r.session.code_rev}, dataset ${r.session.dataset}, Node ${r.session.node}, mode **${r.session.mode}**. Generated ${r.session.ts}.`, "");
  L.push(`All numbers come from a deterministic extractive answerer, not a language model. They show what the pipeline and the context strategies do with this data. They are not model accuracy. Token counts are **estimates** (${TOKEN_METHOD}). Thresholds were set on this same question set; there is no held-out split.`, "");
  L.push(`## 1. Labelled questions with verified citations`, "");
  L.push(`${s.pass}/${s.total} pass. A pass needs the right status, the expected value, and only allowed sources cited. Every accepted quote is an exact substring of the current section text.`, "");
  L.push(`| Kind | Pass |`, `| --- | --- |`);
  for (const [k, v] of Object.entries(s.by_kind)) L.push(`| ${k} | ${v.pass}/${v.total} |`);
  L.push("");
  if (s.failed.length) {
    L.push(`Failed:`, "");
    for (const f of s.failed) {
      const q = r.qa.results.find((x) => x.id === f.id)!;
      L.push(`- ${f.id} (${q.kind}) "${q.question}": ${f.reasons.join("; ")}. Returned \`${q.answer.status}\`.`);
    }
    L.push("");
  }
  const c = r.context;
  L.push(`## 2. Context strategies on a ${c.dialogue_turns}-turn dialogue`, "");
  L.push(`Budget ${c.budget} tokens (estimated). Whole transcript: ${c.full_transcript_tokens_est} tokens (estimated). ${c.probes.length / c.strategies.length} labelled probe questions asked after the last turn.`, "");
  L.push(`| Strategy | Correct | Outcomes | Probe context mean / max | Probes over budget | Max context at any turn | Turns over budget |`, `| --- | --- | --- | --- | --- | --- | --- |`);
  for (const x of c.strategies) {
    L.push(`| ${x.strategy} | ${x.correct}/${x.total} | ${Object.entries(x.outcomes).map(([k, v]) => `${k} ${v}`).join(", ")} | ${x.probe_tokens_est.mean} / ${x.probe_tokens_est.max} | ${x.probes_over_budget} | ${x.max_turn_context_est} | ${x.turns_over_budget} |`);
  }
  L.push("", `Per probe (outcome; what the answerer proposed before the citation check):`, "");
  const ids = [...new Set(c.probes.map((p) => p.probe))];
  L.push(`| Probe | Kind | ${c.strategies.map((x) => x.strategy).join(" | ")} |`, `| --- | --- | ${c.strategies.map(() => "---").join(" | ")} |`);
  for (const id of ids) {
    const row = c.probes.filter((p) => p.probe === id);
    L.push(`| ${id} | ${row[0]!.kind} | ${row.map((p) => `${p.outcome}: ${p.proposed.replace(/\|/g, "/").slice(0, 60)}`).join(" | ")} |`);
  }
  const stale = c.probes.filter((p) => p.stale_dropped.length && p.strategy === "source_bound_summary");
  if (stale.length) L.push("", `Summary entries dropped as stale before packing (source_bound_summary): ${[...new Set(stale.flatMap((p) => p.stale_dropped))].join("; ")}.`);
  L.push("", `## 3. Budget sweep`, "");
  L.push(`| Budget | ${c.strategies.map((x) => x.strategy).join(" | ")} |`, `| --- | ${c.strategies.map(() => "---").join(" | ")} |`);
  for (const b of [...new Set(r.sweep.map((x) => x.budget))]) {
    const row = r.sweep.filter((x) => x.budget === b);
    L.push(`| ${b} | ${row.map((x) => `${x.correct}/${x.total}, max ${x.max_probe_tokens_est}${x.probes_over_budget ? `, over budget ${x.probes_over_budget}` : ""}`).join(" | ")} |`);
  }
  L.push("", `Outcome legend: correct; abstained (said insufficient_evidence when an answer existed); stale_blocked_by_verifier (proposed the superseded value, the citation check refused it); rejected_by_verifier; wrong.`, "");
  return L.join("\n");
}

export function writeReport(r: FullReport, dir = "evidence"): { json: string; md: string } {
  mkdirSync(dir, { recursive: true });
  const stamp = r.session.ts.slice(0, 10);
  const json = `${dir}/report-${stamp}.json`;
  const md = `${dir}/report-${stamp}.md`;
  writeFileSync(json, toJson(r));
  writeFileSync(md, toMarkdown(r));
  return { json, md };
}
