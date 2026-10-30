import { execSync } from "node:child_process";
import { DATASET_VERSION } from "./corpus.ts";

export function codeRev(): string {
  try {
    const rev = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const dirty = execSync("git status --porcelain -- src data", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return dirty ? `${rev}+dirty` : rev;
  } catch {
    return "uncommitted";
  }
}

/** First line of every evidence file. */
export function sessionRecord(mode: "fixture" | "live", extra: Record<string, unknown> = {}) {
  return { type: "session", ts: new Date().toISOString(), code_rev: codeRev(), dataset: DATASET_VERSION, node: process.version, mode, ...extra };
}
