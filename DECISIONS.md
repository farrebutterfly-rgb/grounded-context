# Decisions

**Verify quotes, do not trust them.** A citation is accepted only if its quote is an exact substring of the cited section in the current document version. This is a cheap, mechanical check that catches paraphrase, invented sections and stale versions. It does not check that the answer text follows from the quote; that belongs to the evaluation project (agent-evals).

**Current version only, but keep the old ones.** Retrieval indexes the highest version of each document. Older versions stay loaded so the verifier can say "stale: matches v1, current is v2" instead of a bare "not found". That message is what makes the full-history result in the report readable.

**A newer document beats an old summary in two places.** The summary strategy drops entries bound to a superseded version before packing, and the verifier would reject the stale quote anyway. Two independent guards, each with its own test.

**Summary is extractive and source-bound.** Each summary entry is a verbatim sentence with a pointer (dialogue turn, or `doc_id §section vN`). It is labelled as a summary in the context so it is never mistaken for source text, and when an answer relies on it the underlying source is what gets verified. An abstractive summary would be shorter but could not be checked this way.

**Full history and truncation do no retrieval.** That keeps the three strategies distinct: history only, recent history only, retrieval plus summary. A fourth variant (truncation plus retrieval) would isolate how much the summary adds on top of retrieval; it is not built.

**Conflict is a status, not a tie-break.** When two different documents support different values with similar strength, the answer is `conflict` with both quotes. The memo and the policy do not state precedence, so picking one would be a guess.

**Lexical retrieval first, as the plan says.** BM25 by hand plus a small stemmer. It misses two questions on synonyms ("last", "new"). They stay in the set as visible failures rather than being reworded.

**Deterministic extractive answerer as the fixture model.** It only sees the context it is given, so a strategy that drops a fact fails exactly where it should. Its answers are computed from the documents, nothing is hard-coded. It is not a language model and its scores are not model accuracy.

**Token estimate, labelled.** `ceil(chars/4)` everywhere, named in every report. A real tokenizer or the API's token counting would replace one function (`estimateTokens`).

**Thresholds set on the same data.** Coverage 0.6 (0.75 for free text) and conflict margin 0.1 were chosen while writing the questions. With 24 questions and no held-out split, the pass rate is a regression baseline, not a claim.

**Report is JSON plus markdown, first line a session record.** The JSON's first line holds the session object and the file still parses as JSON; the markdown starts with it as an HTML comment.

**Not done on purpose.** Embeddings, reranking, caching, PDF parsing, real upload, a real tokenizer. Each is a named extension in the plan; none is needed to prove the acceptance criteria.
