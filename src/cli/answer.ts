import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { answerQuestion, DEFAULT_K, indexCorpus } from "../answer.ts";
import { Corpus } from "../corpus.ts";
import { ExtractiveAnswerer } from "../model/extractive.ts";
import type { Answerer } from "../model/types.ts";
import { sessionRecord } from "../session.ts";

/**
 * Reusable CLI. `npm run --silent answer -- --json "<question>"` prints exactly one JSON object:
 * { status, answer, citations: [{ doc_id, section_id, quote }], dataset_version }
 * Fixture mode (deterministic, no API) by default; --live uses the Anthropic API and needs a key.
 */
const args = process.argv.slice(2);
const json = args.includes("--json");
const live = args.includes("--live");
const kIdx = args.indexOf("--k");
const k = kIdx >= 0 ? Number(args[kIdx + 1]) : DEFAULT_K;
const question = args.filter((a, i) => !a.startsWith("--") && !(kIdx >= 0 && i === kIdx + 1)).join(" ").trim();

if (!question) {
  console.error('usage: npm run --silent answer -- [--json] [--live] [--k N] "<question>"');
  process.exit(2);
}
if (live && !process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set. Live runs call the real API and cost money; fixture mode (the default) does not.");
  process.exit(2);
}

const corpus = Corpus.load();
let answerer: Answerer;
if (live) {
  const { AnthropicAnswerer } = await import("../model/anthropic.ts");
  answerer = new AnthropicAnswerer();
} else {
  const index = indexCorpus(corpus);
  answerer = new ExtractiveAnswerer((t) => index.idf(t));
}

const r = await answerQuestion(question, corpus, answerer, k);

if (live) {
  mkdirSync("evidence", { recursive: true });
  const file = `evidence/live-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
  writeFileSync(file, JSON.stringify(sessionRecord("live", { model: answerer.id })) + "\n");
  appendFileSync(file, JSON.stringify({ type: "answer", question, ...r }) + "\n");
}

if (json) {
  process.stdout.write(JSON.stringify(r.answer) + "\n");
} else {
  const a = r.answer;
  console.log(`[${a.status}] ${a.answer}`);
  for (const c of a.citations) console.log(`  ${c.doc_id} §${c.section_id}: "${c.quote}"\n    open: npm run --silent source -- ${c.doc_id} ${c.section_id}`);
  if (!r.verify.ok) console.log(`  verifier: ${r.verify.problems.join("; ")}`);
  console.log(`  (${answerer.id}, dataset ${a.dataset_version}, retrieved ${r.retrieved.map((h) => h.key).join(", ")})`);
}
