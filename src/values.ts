/**
 * What kind of value a question asks for, and how to pull that value out of a sentence.
 * Rules are explicit so a reviewer can see why the fixture answerer said what it said.
 */
export type AnswerKind = "amount" | "date" | "quantity" | "percent" | "text";

const UNITS = ["parking spaces", "spaces", "characters", "hours", "days", "months", "years"];

export interface Expectation {
  kind: AnswerKind;
  /** For quantities: the unit named in the question ("hours" in "within how many hours"), if any. */
  unit?: string;
}

export function expectation(question: string): Expectation {
  const q = question.toLowerCase();
  if (/\b(percent|percentage|availability target|uptime)\b/.test(q)) return { kind: "percent" };
  if (/^(when|on which date|from which date|what date|which date)\b/.test(q) || /\bdue date\b/.test(q)) return { kind: "date" };
  if (/\bhow (many|long)\b|\bnotice period\b|\bresponse time\b|\bduration\b/.test(q)) {
    const unit = UNITS.find((u) => q.includes(u));
    return { kind: "quantity", unit };
  }
  if (/\b(fee|rent|cost(?! centre)|limit|amount|price|deposit|total|per diem|sek)\b/.test(q)) return { kind: "amount" };
  return { kind: "text" };
}

const RE = {
  amount: /\b\d{1,3}(?: \d{3})*(?:[.,]\d+)? SEK\b/g,
  date: /\b\d{4}-\d{2}-\d{2}\b/g,
  percent: /\b\d+(?:\.\d+)? percent\b/g,
  quantity: new RegExp(`\\b\\d+(?:\\.\\d+)? (?:${UNITS.join("|")})\\b`, "g"),
};

/** The first value of the expected kind in the sentence, or undefined. Text questions return the sentence itself. */
export function extractValue(sentence: string, exp: Expectation): string | undefined {
  if (exp.kind === "text") return undefined;
  const found = sentence.match(RE[exp.kind]) ?? [];
  if (exp.kind === "quantity" && exp.unit) return found.find((v) => v.endsWith(exp.unit!) || (exp.unit === "spaces" && v.endsWith("parking spaces")));
  return found[0];
}

/** Normalise for comparing answers: lowercase, collapse whitespace. */
export function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
