/** Tokenising, stemming and sentence splitting. Deliberately small and deterministic. */

const STOP = new Set(
  ("a an and are as at be by can do does for from get has have how i in is it its many may me much must my " +
    "of on or our per so that the their them then there this to under us we what when where which who will with " +
    "within your you all any each every not been being was were should would could please let").split(" "),
);

/** Very small suffix stripper. Enough to match fee/fees, end/ends, clean/cleaning, terminate/termination. */
export function stem(w: string): string {
  for (const suf of ["ing", "ion", "ies", "ed", "es", "s", "e"]) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      const base = w.slice(0, -suf.length);
      return suf === "ies" ? base + "y" : base;
    }
  }
  return w;
}

/** Lowercased word tokens, numbers kept (they carry meaning: "priority 1", "0412"). */
export function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Content terms: stopwords removed, stemmed. */
export function terms(text: string): string[] {
  return words(text).filter((w) => !STOP.has(w)).map(stem);
}

/**
 * Split into sentences without changing a single character, so every sentence is an exact
 * substring of its source. Splits after ". ", "? " or "! " (a full stop followed by a space).
 * "99.5" and "2026-0412" survive because no space follows the dot.
 */
export function sentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    let start = 0;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if ((c === "." || c === "?" || c === "!") && (i === line.length - 1 || line[i + 1] === " ")) {
        const s = line.slice(start, i + 1).trim();
        if (s) out.push(s);
        start = i + 1;
      }
    }
    const rest = line.slice(start).trim();
    if (rest) out.push(rest);
  }
  return out;
}

/**
 * Token ESTIMATE, not a tokenizer: ceil(characters / 4). Every report labels it as such.
 * Swap in a real tokenizer (or the API's count_tokens) to get measured numbers.
 */
export const TOKEN_METHOD = "estimate: ceil(chars/4), no tokenizer";
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
