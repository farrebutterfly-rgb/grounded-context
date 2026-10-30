# grounded-context

Question answering over a small set of business documents where every answer carries citations `{doc_id, section_id, quote}` and no answer is accepted until each quote has been found, character for character, in the current version of the cited section. On top of that, a 44-turn dialogue is used to compare three ways of packing context into a fixed token budget: full history, simple truncation, and fresh retrieval plus a source-bound summary. The report keeps the losing strategies in it.

## Quick start

Node 22 or later.

```bash
make install     # npm ci, pinned versions
make demo        # fixture demo, no API key, no cost; writes evidence/
make test        # 31 tests
make eval        # report only; BUDGET=800 make eval to change the token budget
```

Ask your own question, or open a cited section:

```bash
npm run --silent answer -- "When is invoice 2026-0587 due?"
npm run --silent source -- INV-2026-0587 3
```

Live run against a real model (costs money, needs a key; never run in this repo so far):

```bash
export ANTHROPIC_API_KEY=...
make live Q="What is the hotel cost limit per night?"
```

## Reusable CLI (for the eval project)

```bash
npm run --silent answer -- --json "<question>"
```

prints exactly one line, one JSON object:

```json
{"status":"answered","answer":"1 150 SEK","citations":[{"doc_id":"CTR-002","section_id":"3","quote":"The rent is 1 150 SEK per parking space per month excluding VAT."}],"dataset_version":"bizdocs-v1"}
```

| Field | Meaning |
| --- | --- |
| `status` | `answered`, `insufficient_evidence` or `conflict`. The last two are normal results, exit code 0. |
| `answer` | The value (`46 500 SEK`, `2026-04-30`), a quoted sentence for text questions, or an explanation for the other statuses. |
| `citations` | Verified quotes. Empty for `insufficient_evidence`. At least two for `conflict`. |
| `dataset_version` | `bizdocs-v1`. Changes whenever `data/` changes. |

Fixture mode (deterministic, no network) is the default. `--live` switches to the Anthropic API and exits 2 with a message if `ANTHROPIC_API_KEY` is missing. `--k N` changes how many sections are retrieved (default 4). Usage errors exit 2.

## What the demo shows

Excerpt of `make demo` (full log and report in `evidence/`):

```
> 1. question with a citation you can open
  Q: What is the total amount due on invoice 2026-0412?
  [answered] 52 500 SEK
    cites INV-2026-0412 §3: "Total amount due: 52 500 SEK."
  open data/docs/INV-2026-0412.v1.md §3 Total:
    Total amount due: 52 500 SEK. Due date: 2026-06-03.
  quote is an exact substring of that section: true

> 2. a later document version changes the amount
  with CTR-001 v1 current:
  [answered] 42 000 SEK
  with CTR-001 v2 current:
  [answered] 46 500 SEK
    cites CTR-001 §4: "Following amendment 1, the monthly fee is 46 500 SEK excluding VAT from 2026-07-01."
  replaying the old v1 answer against today's corpus -> [insufficient_evidence] stale: quote matches CTR-001 §4 v1, current is v2

> 3. contradicting documents
  [conflict] The sources disagree: MEMO-002 §2 says 2 200 SEK; POL-001 §2 says 1 800 SEK.

> 4. no support (the contract only says window cleaning is not included)
  [insufficient_evidence] No passage in the provided context supports an answer.

> 5. paraphrased quote is refused
  [insufficient_evidence] Answer withheld: citation check failed (quote not found in POL-003 §2 v1).

> 6. labelled questions: 22/24 pass  (supported 13/14, updated 2/3, contradiction 2/2, unsupported 5/5)
  FAIL Q09: status insufficient_evidence, expected answered; answer lacks "5 years"
  FAIL Q17: status insufficient_evidence, expected answered; answer lacks "2026-07-01"

> 7. context strategies, 44-turn dialogue, budget 500 tokens (ESTIMATED, chars/4); whole transcript 940
  full_history           correct 9/11  probe ctx mean  951 max  955  over budget 11/11  correct=9 stale_blocked_by_verifier=2
  truncation             correct 3/11  probe ctx mean  478 max  482  over budget 0/11  abstained=8 correct=3
  source_bound_summary   correct 9/11  probe ctx mean  497 max  500  over budget 0/11  abstained=2 correct=9
```

How to read part 7. Full history scores 9/11 but needs almost twice the budget, and on the two updated facts it proposed the old contract values from turn 4 and 8; only the citation check stopped them. Truncation stays inside the budget and forgets nearly everything. Source-bound summary stays inside the budget and gets the updated facts right, but at 500 tokens it has no room left for two of the user's own facts. At 800 tokens it gets 11/11 with a maximum of 781 tokens; the budget sweep is in `evidence/report-*.md`.

The two failing questions are lexical misses, kept in on purpose: Q09 asks how long the NDA obligations "last" and Q17 asks when the "new" fee applies, words the documents do not use. The answerer abstains instead of guessing. Embeddings or query rewriting are the obvious next step and are not built.

## How it works

```
question
   |
   v
 BM25 over CURRENT document versions (title + heading + text), top k sections
   |                                          dialogue mode: a context strategy packs
   v                                          turns / summary / sections into the budget
 context items  ------------------------------------------------+
   |  each sentence keeps its source: doc_id, section_id, version, or dialogue turn
   v
 Answerer.answer(question, items)           fixture: ExtractiveAnswerer
   |                                        live:    AnthropicAnswerer (forced tool call, zod schema)
   v
 draft {status, answer, citations[{source, quote}]}
   |
   v
 accept(): every quote must be an exact substring of the cited section in its CURRENT version
   - quote only found in an older version  -> "stale", rejected
   - paraphrase, unknown section, empty    -> rejected
   - answered without citations, conflict with fewer than two -> rejected
   rejected drafts become insufficient_evidence; nothing unverified is returned
   |
   v
 {status, answer, citations[{doc_id, section_id, quote}], dataset_version}
```

The fixture answerer scores each sentence by how much of the question's idf weight it covers (title and heading count as context), keeps only sentences that contain a value of the asked-for kind (amount, date, quantity, percent), and needs coverage of at least 0.6 (0.75 for free-text answers). Two different documents within 0.1 of each other with different values are a `conflict`; with the same value, both are cited.

Context strategies, all given the same probe questions after turn 44:

| Strategy | What goes into the context | Budget |
| --- | --- | --- |
| `full_history` | Every turn, newest first. No retrieval. | Ignored, reported when exceeded |
| `truncation` | Most recent turns that fit. No retrieval, no summary. | Held |
| `source_bound_summary` | Fresh retrieval from current documents, then one verbatim entry per older user fact or shown quote, each bound to its turn or to `doc_id §section vN`, then recent turns. Entries bound to a superseded version are dropped before packing. | Held |

| File | Role |
| --- | --- |
| `src/corpus.ts` | Parses `data/docs`, tracks versions, current view, `pin()` for replaying the past. |
| `src/bm25.ts` | BM25 by hand. |
| `src/text.ts` | Tokens, a tiny stemmer, sentence splitting that never alters characters, the token estimate. |
| `src/values.ts` | What kind of value a question asks for, and extracting it. |
| `src/answer.ts` | Retrieval, the citation verifier, `accept()`, `answerQuestion()`. |
| `src/model/extractive.ts` | Deterministic fixture answerer. |
| `src/model/anthropic.ts` | Live answerer, same interface, same verifier. |
| `src/dialogue.ts` | Replays the 44-turn dialogue, including the mid-dialogue upload of CTR-001 v2. |
| `src/context/strategies.ts` | The three strategies and the source-bound summary. |
| `src/eval.ts`, `src/report.ts` | Scoring, outcomes, budget sweep, JSON and markdown report. |
| `src/cli/` | `answer` (reusable CLI), `source`, `demo`, `eval`. |
| `data/` | Documents, labelled questions, dialogue. See [data/README.md](data/README.md). |

## What this proves and what it does not

- It proves that citations are mechanically checked against current source text, that a superseded document version cannot win through an old answer or an old summary, that conflicts and missing support come out as their own statuses, and that two of the three strategies hold a configured budget at every turn.
- Every number comes from a deterministic extractive answerer. It is not model accuracy and says nothing about how a real model reads. `make live` exists and has not been run (see [ACCEPTANCE.md](ACCEPTANCE.md)).
- Token counts are estimates (`ceil(chars/4)`), not tokenizer output.
- 24 questions and 11 probes written by the same author as the retriever, thresholds set on the same data. This is a development set, not a benchmark.
- Lexical retrieval only. No embeddings, reranking or caching. No document upload pipeline beyond loading files; "upload" in the dialogue is a version switch.

Design trade-offs are in [DECISIONS.md](DECISIONS.md).

Built with AI assistance (Claude); every change is reviewed and run locally.
