import { readFileSync } from "node:fs";
import { join } from "node:path";
import { answerQuestion, indexCorpus } from "./answer.ts";
import { Corpus, DATA_DIR } from "./corpus.ts";
import { ExtractiveAnswerer } from "./model/extractive.ts";
import type { Answerer } from "./model/types.ts";
import { sentences } from "./text.ts";
import type { ContextItem, SourcedCitation, Status } from "./types.ts";

export interface DialogueFile {
  dataset_version: string;
  initial_versions: Record<string, number>;
  user_turns: { turn: number; text: string; event?: { load: string; version: number } }[];
  probes: Probe[];
}

export interface Probe {
  id: string;
  kind: string;
  question: string;
  expected_status: Status;
  expected_answer: string | null;
  stale_answer?: string;
  /** "turn:5", "CTR-001#4", "A#1|B#2" for conflicts, or null. */
  expected_source: string | null;
}

export interface Turn {
  turn: number;
  role: "user" | "assistant";
  text: string;
  /** Assistant turns only: the quotes it showed, bound to the document version current at that turn. */
  citations?: SourcedCitation[];
}

export function loadDialogue(file = join(DATA_DIR, "dialogue.json")): DialogueFile {
  return JSON.parse(readFileSync(file, "utf8")) as DialogueFile;
}

/**
 * Replay the dialogue. Assistant turns are produced by the answerer against the corpus as it stood at
 * that moment: CTR-001 starts pinned to v1 and the upload event at turn 21 makes v2 current.
 * Returns the transcript and the corpus in its final state.
 */
export async function replay(d: DialogueFile, answererFor: (c: Corpus) => Answerer = (c) => new ExtractiveAnswerer((t) => indexCorpus(c).idf(t))): Promise<{ turns: Turn[]; corpus: Corpus }> {
  const corpus = Corpus.load();
  for (const [doc, v] of Object.entries(d.initial_versions)) corpus.pin(doc, v);
  const turns: Turn[] = [];
  for (const u of d.user_turns) {
    turns.push({ turn: u.turn, role: "user", text: u.text });
    const at = u.turn + 1;
    if (u.event) {
      corpus.pin(u.event.load, u.event.version);
      turns.push({ turn: at, role: "assistant", text: `Loaded ${u.event.load} version ${u.event.version} (${corpus.title(u.event.load)}). It is now the current version.` });
    } else if (u.text.trim().endsWith("?")) {
      const r = await answerQuestion(u.text, corpus, answererFor(corpus));
      const cites = r.answer.status === "insufficient_evidence" ? [] : r.proposed.citations;
      const shown = cites.map((c) => (c.source.kind === "doc" ? ` [${c.source.doc_id} §${c.source.section_id} v${c.source.version}: "${c.quote}"]` : "")).join("");
      turns.push({ turn: at, role: "assistant", text: `${r.answer.answer}${shown}`, citations: cites });
    } else {
      turns.push({ turn: at, role: "assistant", text: "Noted." });
    }
  }
  return { turns, corpus };
}

export function turnText(turns: Turn[]): Map<number, string> {
  return new Map(turns.map((t) => [t.turn, t.text]));
}

/** A dialogue turn as context. User sentences are quotable (source: the turn); assistant turns carry the quotes they showed. */
export function turnItem(t: Turn, corpus: Corpus): ContextItem {
  if (t.role === "user") {
    return {
      kind: "turn",
      label: `turn ${t.turn} (user)`,
      rendered: `[turn ${t.turn} user] ${t.text}`,
      context: "",
      evidence: sentences(t.text).map((text) => ({ text, source: { kind: "turn", turn: t.turn } })),
    };
  }
  const cites = t.citations ?? [];
  return {
    kind: "turn",
    label: `turn ${t.turn} (assistant)`,
    rendered: `[turn ${t.turn} assistant] ${t.text}`,
    context: cites.map((c) => (c.source.kind === "doc" ? `${corpus.get(c.source.doc_id, c.source.version)?.title ?? ""} ${corpus.section(c.source.doc_id, c.source.section_id, c.source.version)?.heading ?? ""}` : "")).join(" "),
    evidence: cites.map((c) => ({ text: c.quote, source: c.source })),
  };
}
