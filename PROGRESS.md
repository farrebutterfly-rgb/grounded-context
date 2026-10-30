# Progress

## 2026-10-30, session 1

Done: ten synthetic documents (eleven versions), 24 labelled questions, 44-turn dialogue with 11 probes, BM25 retrieval, citation verifier with stale-version detection, extractive fixture answerer, Anthropic live answerer (not run), three context strategies, JSON and markdown report with budget sweep, reusable `answer --json` CLI, 31 tests, docs.

Results (fixture, estimated tokens): labelled questions 22/24. At a 500-token budget: full history 9/11 over budget on every probe, truncation 3/11, source-bound summary 9/11 inside budget; 11/11 at 800.

Not done: live run (needs `ANTHROPIC_API_KEY`), embeddings for the two vocabulary misses, a real tokenizer.

Next: explain the verifier flow in your own words (where does a stale quote get caught, and why twice?), then a live run, then wire `answer --json` into agent-evals.
