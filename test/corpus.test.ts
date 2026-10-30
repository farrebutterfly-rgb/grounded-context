import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accept, verifyCitations } from "../src/answer.ts";
import { Corpus, parseDoc } from "../src/corpus.ts";
import { sentences, stem } from "../src/text.ts";

const corpus = Corpus.load();

test("ten documents, eleven versions, unique stable ids", () => {
  assert.equal(corpus.docIds().length, 10);
  assert.equal(corpus.allVersions().length, 11);
  assert.equal(corpus.currentVersion("CTR-001"), 2);
  for (const d of corpus.allVersions()) assert.ok(d.sections.length >= 3, d.file);
});

test("section text is exactly what the file contains, so quotes can be checked by hand", () => {
  for (const d of corpus.allVersions()) {
    const raw = readFileSync(d.file, "utf8");
    for (const s of d.sections) for (const line of s.text.split("\n")) assert.ok(raw.includes(line), `${d.file} §${s.section_id}`);
  }
});

test("sentence splitting never changes characters and keeps 99.5 and 2026-0412 whole", () => {
  const t = "The target is 99.5 percent. Invoice 2026-0412 is due. Done?";
  const s = sentences(t);
  assert.deepEqual(s, ["The target is 99.5 percent.", "Invoice 2026-0412 is due.", "Done?"]);
  for (const x of s) assert.ok(t.includes(x));
});

test("stemmer joins the forms the questions use", () => {
  assert.equal(stem("fees"), stem("fee"));
  assert.equal(stem("terminating"), stem("termination"));
  assert.equal(stem("cleaning"), stem("cleans"));
});

test("parser rejects a file without a header or with duplicate sections", () => {
  assert.throws(() => parseDoc("## 1 A\ntext", "x.md"), /missing header/);
  assert.throws(() => parseDoc("---\ndoc_id: X\nversion: 1\ntype: t\ndate: d\ntitle: T\n---\n## 1 A\na\n## 1 B\nb\n", "x.md"), /duplicate section/);
});

const doc = (doc_id: string, section_id: string, version: number) => ({ kind: "doc" as const, doc_id, section_id, version });

test("verifier accepts an exact substring of the current section", () => {
  const v = verifyCitations([{ source: doc("CTR-001", "4", 2), quote: "the monthly fee is 46 500 SEK" }], corpus);
  assert.ok(v.ok, v.problems.join());
});

test("verifier rejects a paraphrase, an unknown section, an unknown document and an empty quote", () => {
  const v = verifyCitations(
    [
      { source: doc("CTR-001", "4", 2), quote: "The monthly fee is 46,500 SEK." },
      { source: doc("CTR-001", "9", 2), quote: "anything" },
      { source: doc("XYZ-999", "1", 1), quote: "anything" },
      { source: doc("CTR-001", "4", 2), quote: "  " },
    ],
    corpus,
  );
  assert.equal(v.problems.length, 4);
  assert.match(v.problems.join("\n"), /quote not found in CTR-001 §4 v2/);
  assert.match(v.problems.join("\n"), /has no section 9/);
  assert.match(v.problems.join("\n"), /unknown document XYZ-999/);
  assert.match(v.problems.join("\n"), /empty quote/);
});

test("a quote from a superseded version is reported as stale, not just missing", () => {
  const v = verifyCitations([{ source: doc("CTR-001", "4", 1), quote: "The monthly fee is 42 000 SEK excluding VAT." }], corpus);
  assert.equal(v.ok, false);
  assert.match(v.problems[0]!, /stale: quote matches CTR-001 §4 v1, current is v2/);
});

test("accept() turns a failed check into insufficient_evidence with no citations", () => {
  const r = accept({ status: "answered", answer: "42 000 SEK", citations: [{ source: doc("CTR-001", "4", 1), quote: "The monthly fee is 42 000 SEK excluding VAT." }] }, corpus);
  assert.equal(r.draft.status, "insufficient_evidence");
  assert.deepEqual(r.draft.citations, []);
  const none = accept({ status: "answered", answer: "x", citations: [] }, corpus);
  assert.match(none.draft.answer, /no citations/);
  const lonely = accept({ status: "conflict", answer: "x", citations: [{ source: doc("POL-001", "2", 1), quote: "The hotel cost limit is 1 800 SEK per night including breakfast." }] }, corpus);
  assert.match(lonely.draft.answer, /at least two citations/);
});
