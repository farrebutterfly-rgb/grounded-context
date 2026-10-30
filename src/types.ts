/** Where a sentence came from. Documents are sources; dialogue turns are sources only for what the user said. */
export type Source =
  | { kind: "doc"; doc_id: string; section_id: string; version: number }
  | { kind: "turn"; turn: number };

/** One sentence the answerer may quote. `text` is an exact substring of the source it points to. */
export interface Evidence {
  text: string;
  source: Source;
}

/**
 * A unit of context handed to the answerer: a retrieved section, a dialogue turn, or a summary entry.
 * `rendered` is what a model would actually see (and what tokens are estimated on).
 * `label` marks summaries as summaries so they are never mistaken for source text.
 */
export interface ContextItem {
  kind: "section" | "turn" | "summary";
  label: string;
  rendered: string;
  /** Words that describe the item (document title, section heading). Count as matched context, never quoted. */
  context: string;
  evidence: Evidence[];
}

export type Status = "answered" | "insufficient_evidence" | "conflict";

export interface SourcedCitation {
  source: Source;
  quote: string;
}

/** What an answerer proposes. Nothing is accepted until every quote is verified. */
export interface Draft {
  status: Status;
  answer: string;
  citations: SourcedCitation[];
}

/** The public citation shape printed by the CLI and consumed by the eval project. */
export interface Citation {
  doc_id: string;
  section_id: string;
  quote: string;
}

export interface Answer {
  status: Status;
  answer: string;
  citations: Citation[];
  dataset_version: string;
}

export const srcKey = (s: Source) => (s.kind === "doc" ? `${s.doc_id}#${s.section_id}` : `turn:${s.turn}`);
