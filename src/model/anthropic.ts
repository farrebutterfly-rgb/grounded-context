import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { ContextItem, Draft, Source } from "../types.ts";
import type { Answerer } from "./types.ts";

/** Shape the model must return. Same verifier as the fixture applies afterwards. */
export const ModelAnswer = z.object({
  status: z.enum(["answered", "insufficient_evidence", "conflict"]),
  answer: z.string().describe("Short answer. For conflict, state what each source says. For insufficient_evidence, say what is missing."),
  citations: z
    .array(z.object({ doc_id: z.string(), section_id: z.string(), quote: z.string().describe("Copied character for character from the section text.") }))
    .describe("Every claim must be backed by an exact quote from a provided section."),
});

export const SYSTEM = `You answer questions about business documents using ONLY the sections provided.
Rules:
- Cite every claim with doc_id, section_id and a quote copied exactly from that section. Quotes are checked mechanically; a paraphrase is rejected.
- If the sections do not answer the question, return status "insufficient_evidence".
- If two documents give different values for the same thing, return status "conflict" and cite both. Do not pick one.
- Text marked as a summary is not a source. Cite the document section it points to only if that section is provided.`;

export class AnthropicAnswerer implements Answerer {
  readonly id: string;
  private client: Anthropic;

  constructor(private readonly model = process.env.AGENT_MODEL ?? "claude-sonnet-5-5", private readonly maxTokens = 1024) {
    this.id = `anthropic:${model}`;
    this.client = new Anthropic(); // reads ANTHROPIC_API_KEY
  }

  async answer(question: string, items: ContextItem[]): Promise<Draft> {
    const context = items.map((i) => i.rendered).join("\n\n");
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: SYSTEM,
      messages: [{ role: "user", content: `${context}\n\nQuestion: ${question}` }],
      tools: [{ name: "answer", description: "Return the grounded answer.", input_schema: z.toJSONSchema(ModelAnswer) as Anthropic.Tool.InputSchema }],
      tool_choice: { type: "tool", name: "answer" },
    });
    const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const parsed = ModelAnswer.safeParse(block?.input);
    if (!parsed.success) return { status: "insufficient_evidence", answer: `Model output did not match the schema: ${parsed.error.issues.map((i) => i.message).join("; ")}`, citations: [] };
    // Bind each citation to the version that was in context, so the verifier can tell stale from wrong.
    const versionOf = (doc: string, sec: string) =>
      items.flatMap((i) => i.evidence).find((e) => e.source.kind === "doc" && e.source.doc_id === doc && e.source.section_id === sec)?.source;
    return {
      status: parsed.data.status,
      answer: parsed.data.answer,
      citations: parsed.data.citations.map((c) => ({
        source: (versionOf(c.doc_id, c.section_id) as Source | undefined) ?? { kind: "doc", doc_id: c.doc_id, section_id: c.section_id, version: 0 },
        quote: c.quote,
      })),
    };
  }
}
