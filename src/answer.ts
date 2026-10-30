import { Bm25 } from "./bm25.ts";
import type { Corpus, Section } from "./corpus.ts";
import { sentences } from "./text.ts";
import type { Answerer } from "./model/types.ts";
import type { Answer, Citation, ContextItem, Draft, SourcedCitation } from "./types.ts";

export const DEFAULT_K = 4;

/** Index over the CURRENT version of every document. Title and heading are indexed with the body. */
export function indexCorpus(corpus: Corpus): Bm25<Section> {
  return new Bm25(corpus.currentSections(), (s) => `${corpus.title(s.doc_id)} ${s.heading} ${s.text}`);
}

export function sectionItem(corpus: Corpus, s: Section): ContextItem {
  const title = corpus.get(s.doc_id, s.version)?.title ?? s.doc_id;
  return {
    kind: "section",
    label: `${s.doc_id} §${s.section_id} (v${s.version})`,
    rendered: `[source ${s.doc_id} §${s.section_id} v${s.version} | ${title} | ${s.heading}]\n${s.text}`,
    context: `${title} ${s.heading}`,
    evidence: sentences(s.text).map((text) => ({ text, source: { kind: "doc", doc_id: s.doc_id, section_id: s.section_id, version: s.version } })),
  };
}

export function retrieve(corpus: Corpus, question: string, k = DEFAULT_K, index = indexCorpus(corpus)): { section: Section; score: number }[] {
  return index.search(question, k).map((r) => ({ section: r.item, score: r.score }));
}

export interface VerifyResult {
  ok: boolean;
  problems: string[];
}

/**
 * The gate every answer passes. A citation is accepted only if the cited section exists in the CURRENT
 * version of the document and the quote is an exact, non-empty substring of that section's text.
 * A quote that only matches an older version is reported as stale. Turn citations are checked
 * against the dialogue the same way.
 */
export function verifyCitations(cs: SourcedCitation[], corpus: Corpus, turns?: Map<number, string>): VerifyResult {
  const problems: string[] = [];
  for (const c of cs) {
    const q = c.quote;
    if (!q || !q.trim()) {
      problems.push("empty quote");
      continue;
    }
    if (c.source.kind === "turn") {
      const t = turns?.get(c.source.turn);
      if (t === undefined) problems.push(`turn ${c.source.turn} does not exist`);
      else if (!t.includes(q)) problems.push(`quote not found in turn ${c.source.turn}`);
      continue;
    }
    const { doc_id, section_id } = c.source;
    const cur = corpus.currentVersion(doc_id);
    if (cur === undefined) {
      problems.push(`unknown document ${doc_id}`);
      continue;
    }
    const sec = corpus.section(doc_id, section_id);
    if (sec && sec.text.includes(q)) continue;
    const old = corpus.allVersions().find((d) => d.doc_id === doc_id && d.version < cur && d.sections.some((s) => s.section_id === section_id && s.text.includes(q)));
    if (old) problems.push(`stale: quote matches ${doc_id} §${section_id} v${old.version}, current is v${cur}`);
    else if (!sec) problems.push(`${doc_id} has no section ${section_id}`);
    else problems.push(`quote not found in ${doc_id} §${section_id} v${cur}`);
  }
  return { ok: problems.length === 0, problems };
}

/** Turn a draft into an accepted answer, or into insufficient_evidence when its citations do not hold. */
export function accept(draft: Draft, corpus: Corpus, turns?: Map<number, string>): { draft: Draft; verify: VerifyResult } {
  if (draft.status === "insufficient_evidence") return { draft: { ...draft, citations: [] }, verify: { ok: true, problems: [] } };
  const problems: string[] = [];
  if (draft.citations.length === 0) problems.push("answer has no citations");
  if (draft.status === "conflict" && draft.citations.length < 2) problems.push("conflict needs at least two citations");
  const v = verifyCitations(draft.citations, corpus, turns);
  problems.push(...v.problems);
  if (problems.length === 0) return { draft, verify: v };
  return {
    draft: { status: "insufficient_evidence", answer: `Answer withheld: citation check failed (${problems.join("; ")}).`, citations: [] },
    verify: { ok: false, problems },
  };
}

export function publicCitations(cs: SourcedCitation[]): Citation[] {
  return cs.flatMap((c) => (c.source.kind === "doc" ? [{ doc_id: c.source.doc_id, section_id: c.source.section_id, quote: c.quote }] : []));
}

export interface AnswerTrace {
  answer: Answer;
  retrieved: { key: string; score: number }[];
  proposed: Draft;
  verify: VerifyResult;
}

/** Retrieve, ask the answerer, verify, return the public answer shape. */
export async function answerQuestion(question: string, corpus: Corpus, answerer: Answerer, k = DEFAULT_K): Promise<AnswerTrace> {
  const hits = retrieve(corpus, question, k);
  const items = hits.map((h) => sectionItem(corpus, h.section));
  const proposed = await answerer.answer(question, items);
  const { draft, verify } = accept(proposed, corpus);
  return {
    answer: { status: draft.status, answer: draft.answer, citations: publicCitations(draft.citations), dataset_version: corpus.datasetVersion },
    retrieved: hits.map((h) => ({ key: `${h.section.doc_id}#${h.section.section_id}`, score: Number(h.score.toFixed(3)) })),
    proposed,
    verify,
  };
}
