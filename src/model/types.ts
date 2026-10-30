import type { ContextItem, Draft } from "../types.ts";

/**
 * Anything that turns a question plus context into a draft answer with citations.
 * Fixture: ExtractiveAnswerer (deterministic, reads the context it is given).
 * Live: AnthropicAnswerer. Both go through the same citation verifier.
 */
export interface Answerer {
  /** Shown in logs and reports so fixture and live runs are never confused. */
  readonly id: string;
  answer(question: string, items: ContextItem[]): Promise<Draft>;
}
