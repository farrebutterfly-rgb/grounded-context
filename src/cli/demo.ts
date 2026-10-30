import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { accept, answerQuestion, indexCorpus } from "../answer.ts";
import { Corpus } from "../corpus.ts";
import { ExtractiveAnswerer } from "../model/extractive.ts";
import type { Answerer } from "../model/types.ts";
import { budgetFromArgs, buildReport, writeReport } from "../report.ts";
import { sessionRecord } from "../session.ts";
import type { Answer } from "../types.ts";

const budget = budgetFromArgs(process.argv.slice(2));
const session = sessionRecord("fixture", { answerer: "fixture:extractive", budget_tokens_est: budget });
mkdirSync("evidence", { recursive: true });
const log = `evidence/demo-${session.ts.slice(0, 10)}.jsonl`;
writeFileSync(log, JSON.stringify(session) + "\n");
const record = (scene: string, data: Record<string, unknown>) => appendFileSync(log, JSON.stringify({ type: "scene", scene, ...data }) + "\n");

const corpus = Corpus.load();
const fixture = (c: Corpus): Answerer => {
  const idx = indexCorpus(c);
  return new ExtractiveAnswerer((t) => idx.idf(t));
};
const show = (a: Answer) => {
  console.log(`  [${a.status}] ${a.answer}`);
  for (const c of a.citations) console.log(`    cites ${c.doc_id} §${c.section_id}: "${c.quote}"`);
};

console.log(`grounded-context fixture demo  (no API calls, extractive answerer)  rev=${session.code_rev}  dataset=${session.dataset}\n`);

// 1. Ask, then open the cited source and check the quote is really there.
{
  const q = "What is the total amount due on invoice 2026-0412?";
  console.log(`> 1. question with a citation you can open\n  Q: ${q}`);
  const r = await answerQuestion(q, corpus, fixture(corpus));
  show(r.answer);
  const c = r.answer.citations[0]!;
  const sec = corpus.section(c.doc_id, c.section_id)!;
  console.log(`  open ${corpus.get(c.doc_id)!.file} §${sec.section_id} ${sec.heading}:\n    ${sec.text}`);
  console.log(`  quote is an exact substring of that section: ${sec.text.includes(c.quote)}\n`);
  record("cited-answer", { question: q, answer: r.answer, retrieved: r.retrieved, opened: { file: corpus.get(c.doc_id)!.file, text: sec.text } });
}

// 2. Corrected document: same question before and after version 2 of the contract.
{
  const q = "What is the monthly fee for office cleaning?";
  console.log(`> 2. a later document version changes the amount\n  Q: ${q}`);
  const old = Corpus.load().pin("CTR-001", 1);
  const before = await answerQuestion(q, old, fixture(old));
  console.log(`  with CTR-001 v1 current:`);
  show(before.answer);
  const after = await answerQuestion(q, corpus, fixture(corpus));
  console.log(`  with CTR-001 v2 current:`);
  show(after.answer);
  const stale = accept(before.proposed, corpus);
  console.log(`  replaying the old v1 answer against today's corpus -> [${stale.draft.status}] ${stale.verify.problems.join("; ")}\n`);
  record("updated-document", { question: q, before: before.answer, after: after.answer, old_answer_rechecked: stale });
}

// 3. Two documents that contradict each other.
{
  const q = "What is the hotel cost limit per night?";
  console.log(`> 3. contradicting documents\n  Q: ${q}`);
  const r = await answerQuestion(q, corpus, fixture(corpus));
  show(r.answer);
  console.log("");
  record("contradiction", { question: q, answer: r.answer });
}

// 4. A question the documents do not answer, close to one they do.
{
  const q = "What is the fee for window cleaning?";
  console.log(`> 4. no support (the contract only says window cleaning is not included)\n  Q: ${q}`);
  const r = await answerQuestion(q, corpus, fixture(corpus));
  show(r.answer);
  console.log("");
  record("unsupported", { question: q, answer: r.answer, retrieved: r.retrieved });
}

// 5. An answerer that paraphrases its quote is refused by the verifier.
{
  const q = "How long must passwords be?";
  console.log(`> 5. paraphrased quote is refused\n  Q: ${q}`);
  const paraphraser: Answerer = {
    id: "fixture:paraphraser",
    async answer() {
      return { status: "answered", answer: "14 characters", citations: [{ source: { kind: "doc", doc_id: "POL-003", section_id: "2", version: 1 }, quote: "Passwords need 14 characters or more." }] };
    },
  };
  const r = await answerQuestion(q, corpus, paraphraser);
  show(r.answer);
  console.log("");
  record("paraphrase-rejected", { question: q, proposed: r.proposed, answer: r.answer });
}

// 6. Labelled question set and the three context strategies. Writes evidence/report-*.json and .md.
const report = await buildReport(budget);
const files = writeReport(report);
const s = report.qa.summary;
console.log(`> 6. labelled questions: ${s.pass}/${s.total} pass  (${Object.entries(s.by_kind).map(([k, v]) => `${k} ${v.pass}/${v.total}`).join(", ")})`);
for (const f of s.failed) console.log(`  FAIL ${f.id}: ${f.reasons.join("; ")}`);
console.log(`\n> 7. context strategies, ${report.context.dialogue_turns}-turn dialogue, budget ${budget} tokens (ESTIMATED, chars/4); whole transcript ${report.context.full_transcript_tokens_est}`);
for (const x of report.context.strategies) {
  console.log(`  ${x.strategy.padEnd(22)} correct ${x.correct}/${x.total}  probe ctx mean ${String(x.probe_tokens_est.mean).padStart(4)} max ${String(x.probe_tokens_est.max).padStart(4)}  over budget ${x.probes_over_budget}/${x.total}  ${Object.entries(x.outcomes).map(([k, v]) => `${k}=${v}`).join(" ")}`);
}
record("report", { files, qa: s, context: report.context.strategies });
console.log(`\nlog: ${log}\nreport: ${files.json}, ${files.md}  (code rev ${session.code_rev})`);
