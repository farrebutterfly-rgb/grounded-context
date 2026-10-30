import { test } from "node:test";
import assert from "node:assert/strict";
import { answerQuestion, indexCorpus } from "../src/answer.ts";
import { Corpus } from "../src/corpus.ts";
import { loadQuestions, runQa, scoreQa } from "../src/eval.ts";
import { ExtractiveAnswerer } from "../src/model/extractive.ts";
import type { Answerer } from "../src/model/types.ts";

const corpus = Corpus.load();
const fixture = (c: Corpus) => {
  const i = indexCorpus(c);
  return new ExtractiveAnswerer((t) => i.idf(t));
};
const ask = async (q: string, c = corpus) => (await answerQuestion(q, c, fixture(c))).answer;

test("labelled set has all four kinds and the expected size", () => {
  const qs = loadQuestions();
  assert.equal(qs.length, 24);
  for (const k of ["supported", "updated", "contradiction", "unsupported"]) assert.ok(qs.some((q) => q.kind === k), k);
});

test("every accepted citation is an exact substring of the cited current section", async () => {
  for (const r of await runQa()) {
    for (const c of r.answer.citations) assert.ok(corpus.section(c.doc_id, c.section_id)!.text.includes(c.quote), `${r.id} ${c.doc_id}#${c.section_id}`);
  }
});

test("labelled set: 22 of 24 pass, and the two known lexical misses are exactly Q09 and Q17", async () => {
  const rs = await runQa();
  const failed = rs.filter((r) => !r.pass).map((r) => r.id);
  // Q09 says "last"/"NDA", Q17 says "new"/"date": words the documents do not use. Lexical retrieval misses them
  // and the answerer abstains instead of guessing. If this list changes, the report must change with it.
  assert.deepEqual(failed, ["Q09", "Q17"]);
  for (const r of rs.filter((x) => x.id === "Q09" || x.id === "Q17")) assert.equal(r.answer.status, "insufficient_evidence");
});

test("updated: the current version wins, the old value is not returned", async () => {
  const a = await ask("What is the monthly fee for office cleaning?");
  assert.equal(a.status, "answered");
  assert.equal(a.answer, "46 500 SEK");
  assert.deepEqual(a.citations.map((c) => `${c.doc_id}#${c.section_id}`), ["CTR-001#4"]);
  const end = await ask("When does the cleaning agreement end?");
  assert.equal(end.answer, "2027-06-30");
  const old = Corpus.load().pin("CTR-001", 1);
  assert.equal((await ask("What is the monthly fee for office cleaning?", old)).answer, "42 000 SEK");
});

test("contradiction: both documents are cited and no value is picked", async () => {
  const a = await ask("What is the hotel cost limit per night?");
  assert.equal(a.status, "conflict");
  assert.deepEqual(a.citations.map((c) => c.doc_id).sort(), ["MEMO-002", "POL-001"]);
  assert.match(a.answer, /1 800 SEK/);
  assert.match(a.answer, /2 200 SEK/);
});

test("two documents that agree are not a conflict; both are cited", async () => {
  const a = await ask("What is the per diem for domestic travel?");
  assert.equal(a.status, "answered");
  assert.equal(a.answer, "290 SEK");
  assert.equal(a.citations.length, 2);
});

test("unsupported: a near miss (window cleaning) and an unknown fact both abstain", async () => {
  for (const q of ["What is the fee for window cleaning?", "Who is the CEO of Skärlunda Städ AB?", "How many vacation days do employees get?"]) {
    const a = await ask(q);
    assert.equal(a.status, "insufficient_evidence", q);
    assert.deepEqual(a.citations, []);
  }
});

test("an answerer citing text that is not in the section is refused even if its value is right", async () => {
  const liar: Answerer = {
    id: "test:liar",
    async answer() {
      return { status: "answered", answer: "24 hours", citations: [{ source: { kind: "doc", doc_id: "POL-003", section_id: "4", version: 1 }, quote: "Incidents must be reported within 24 hours." }] };
    },
  };
  const r = await answerQuestion("Within how many hours must security incidents be reported?", corpus, liar);
  assert.equal(r.answer.status, "insufficient_evidence");
  assert.equal(r.verify.ok, false);
});

test("scoreQa refuses a right value with a disallowed source", () => {
  const q = loadQuestions().find((x) => x.id === "Q03")!;
  const s = scoreQa(q, { status: "answered", answer: "1 150 SEK", citations: [{ doc_id: "INV-2026-0587", section_id: "2", quote: "x" }], dataset_version: "bizdocs-v1" });
  assert.equal(s.pass, false);
  assert.match(s.reasons.join(), /not allowed/);
});
