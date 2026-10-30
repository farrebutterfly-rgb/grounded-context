import { test } from "node:test";
import assert from "node:assert/strict";
import { accept, indexCorpus } from "../src/answer.ts";
import { Corpus } from "../src/corpus.ts";
import { loadDialogue, replay, turnText, type Turn } from "../src/dialogue.ts";
import { pack, sourceBoundSummary, STRATEGIES } from "../src/context/strategies.ts";
import { runContext } from "../src/eval.ts";
import { ExtractiveAnswerer } from "../src/model/extractive.ts";

const d = loadDialogue();
const prepared = await replay(d);
const { turns, corpus } = prepared;

test("the dialogue is long (40+ turns) and the upload event made CTR-001 v2 current", () => {
  assert.ok(turns.length >= 40, String(turns.length));
  assert.equal(corpus.currentVersion("CTR-001"), 2);
  const early = turns.find((t) => t.turn === 4)!;
  assert.equal(early.citations?.[0]?.source.kind === "doc" && early.citations[0].source.version, 1, "turn 4 was answered from v1");
});

for (const budget of [300, 500, 800, 1200]) {
  test(`truncation and source-bound summary stay inside a ${budget}-token budget at every turn and probe`, () => {
    for (const s of ["truncation", "source_bound_summary"] as const) {
      for (let i = 0; i < turns.length; i++) {
        if (turns[i]!.role !== "user") continue;
        const c = pack(s, turns[i]!.text, turns.slice(0, i), corpus, { budget });
        assert.ok(c.tokens <= budget, `${s} turn ${turns[i]!.turn}: ${c.tokens} > ${budget}`);
      }
      for (const p of d.probes) assert.ok(pack(s, p.question, turns, corpus, { budget }).tokens <= budget);
    }
  });
}

test("full history is reported as over budget rather than silently cut", () => {
  const c = pack("full_history", "q", turns, corpus, { budget: 500 });
  assert.equal(c.items.length, turns.length);
  assert.equal(c.overBudget, true);
});

test("a newer document version wins over an old summary", async () => {
  // History: the fee was answered from v1 and is old enough to be summarised.
  const t4 = turns.find((t) => t.turn === 4)!;
  const history: Turn[] = [turns[0]!, turns[1]!, turns[2]!, t4];
  const filler: Turn[] = Array.from({ length: 30 }, (_, i) => ({ turn: 100 + i, role: (i % 2 ? "assistant" : "user") as Turn["role"], text: "Thanks, noted." }));
  const all = [...history, ...filler];
  const q = "What is the monthly fee for office cleaning?";
  const ctx = sourceBoundSummary(q, all, corpus, { budget: 800, recentShare: 0.1 });
  assert.ok(ctx.staleDropped.some((s) => s.includes("CTR-001 §4 v1")), ctx.staleDropped.join());
  assert.ok(!ctx.items.some((i) => i.kind === "summary" && i.rendered.includes("42 000")), "stale summary entry must not be packed");
  const a = new ExtractiveAnswerer((t) => indexCorpus(corpus).idf(t));
  const { draft } = accept(await a.answer(q, ctx.items), corpus, turnText(all));
  assert.equal(draft.status, "answered");
  assert.equal(draft.answer, "46 500 SEK");
  assert.deepEqual(draft.citations.map((c) => c.source), [{ kind: "doc", doc_id: "CTR-001", section_id: "4", version: 2 }]);
});

test("even if a stale summary entry reached the answerer, the verifier would block it", async () => {
  const t4 = turns.find((t) => t.turn === 4)!;
  const a = new ExtractiveAnswerer((t) => indexCorpus(corpus).idf(t));
  const ctx = pack("full_history", "What is the monthly fee for office cleaning?", [t4], corpus, { budget: 500 });
  const proposed = await a.answer("What is the monthly fee for office cleaning?", ctx.items);
  assert.equal(proposed.answer, "42 000 SEK");
  const { draft, verify } = accept(proposed, corpus);
  assert.equal(draft.status, "insufficient_evidence");
  assert.match(verify.problems[0]!, /stale/);
});

test("report shows every strategy, including the worse ones, with outcomes and estimated tokens", async () => {
  const r = await runContext(500, prepared);
  assert.deepEqual(r.strategies.map((s) => s.strategy), STRATEGIES);
  const by = Object.fromEntries(r.strategies.map((s) => [s.strategy, s]));
  assert.equal(by.full_history!.outcomes.stale_blocked_by_verifier, 2);
  assert.ok(by.full_history!.probes_over_budget > 0);
  assert.ok(by.truncation!.correct < by.source_bound_summary!.correct, "truncation is worse here and the report must say so");
  assert.equal(by.source_bound_summary!.probes_over_budget, 0);
  for (const p of r.probes.filter((x) => x.strategy === "source_bound_summary" && x.kind === "updated_doc_fact")) assert.equal(p.outcome, "correct");
  assert.ok(r.probes.every((p) => typeof p.tokens_est === "number"));
});

test("user facts are answered from dialogue turns and verified against the transcript", async () => {
  const r = await runContext(1200, prepared);
  const p = r.probes.find((x) => x.strategy === "full_history" && x.probe === "D01")!;
  assert.equal(p.outcome, "correct");
  assert.deepEqual(p.sources, ["turn:5"]);
});
