import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const env = { ...process.env, ANTHROPIC_API_KEY: "" };

async function answer(q: string) {
  const { stdout } = await run("npm", ["run", "--silent", "answer", "--", "--json", q], { env });
  const lines = stdout.trim().split("\n");
  assert.equal(lines.length, 1, "exactly one line of output");
  return JSON.parse(lines[0]!) as Record<string, unknown>;
}

test("answer CLI prints one JSON object with the documented shape", async () => {
  const a = await answer("What is the rent per parking space per month?");
  assert.deepEqual(Object.keys(a).sort(), ["answer", "citations", "dataset_version", "status"]);
  assert.equal(a.status, "answered");
  assert.equal(a.dataset_version, "bizdocs-v1");
  const cites = a.citations as { doc_id: string; section_id: string; quote: string }[];
  assert.deepEqual(Object.keys(cites[0]!).sort(), ["doc_id", "quote", "section_id"]);
  assert.equal(cites[0]!.doc_id, "CTR-002");
});

test("answer CLI returns conflict and insufficient_evidence as normal results", async () => {
  assert.equal((await answer("What is the hotel cost limit per night?")).status, "conflict");
  const none = await answer("What is the monthly rent for the office premises?");
  assert.equal(none.status, "insufficient_evidence");
  assert.deepEqual(none.citations, []);
});

test("live mode without a key exits 2 with a clear message and no API call", async () => {
  await assert.rejects(run("npm", ["run", "--silent", "answer", "--", "--live", "--json", "x"], { env }), (e: { code: number; stderr: string }) => {
    assert.equal(e.code, 2);
    assert.match(e.stderr, /ANTHROPIC_API_KEY is not set/);
    return true;
  });
});
