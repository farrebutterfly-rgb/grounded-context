# Acceptance

Checked 2026-10-30 on Node 22.23.4, Linux. Fixture runs only. "Not run" means not run, not passed.

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Citations point to existing text sections and can be checked by hand | Passed | Every accepted quote is checked as an exact substring of the current section (`verifyCitations`). Tests `every accepted citation is an exact substring...`, `section text is exactly what the file contains...`, `verifier rejects a paraphrase...`. Open any citation with `npm run --silent source -- <doc_id> <section_id>`. Demo scene 1. |
| 2 | A changed amount or date in a later document is not overridden by an old summary | Passed | Test `a newer document version wins over an old summary` (stale summary entry dropped, answer 46 500 SEK cites CTR-001 §4 v2); test `even if a stale summary entry reached the answerer, the verifier would block it`; probes D05, D06 in the report; demo scene 2. |
| 3 | Missing support and contradicting documents have their own test cases | Passed | 5 `unsupported` and 2 `contradiction` questions in `data/questions.json`, all pass; probes D10, D11; tests `contradiction: both documents are cited...`, `unsupported: a near miss...`, `two documents that agree are not a conflict`. |
| 4 | A long test dialogue keeps the context budget and is followed by labelled fact questions | Passed for `truncation` and `source_bound_summary` at budgets 300, 500, 800 and 1200, checked at every user turn and every probe. `full_history` exceeds the budget by design and is reported as over budget. | 44 turns, 11 labelled probes (`data/dialogue.json`). Tests `truncation and source-bound summary stay inside a N-token budget...`, `full history is reported as over budget`. |
| 5 | The report shows quality and token use per strategy, even when a strategy is worse | Passed | `evidence/report-<date>.json` and `.md`: correct/total, outcome counts, mean and max context tokens (estimated), probes and turns over budget, per-probe table, budget sweep. Truncation (3/11 at 500) stays in. Test `report shows every strategy, including the worse ones`. |
| 6 | Live model run | **Not run.** No API key in the build environment. | `make live` writes `evidence/live-*.jsonl`. Without a key it exits 2 (test `live mode without a key exits 2`). |

Labelled question set: 22/24 pass in fixture mode. Q09 and Q17 fail (lexical vocabulary mismatch, the answerer abstains). They are reported, not hidden, and a test pins the list so a change is visible.

Extra checks beyond the plan: paraphrased quote refused (demo scene 5, test), conflict with one citation refused, answered with no citation refused, agreeing documents cited together instead of flagged, CLI JSON contract (test `answer CLI prints one JSON object with the documented shape`).

## Open gaps

- No live model run, so nothing here measures a real model.
- Token counts are estimates (chars/4). No tokenizer.
- No held-out split; thresholds were set on the same questions.
- No embeddings; two vocabulary-mismatch questions fail.
