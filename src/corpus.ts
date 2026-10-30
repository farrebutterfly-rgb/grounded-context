import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));
export const DATASET_VERSION = "bizdocs-v1";

export interface Section {
  doc_id: string;
  version: number;
  section_id: string;
  heading: string;
  /** Exact text of the section body as stored in the file (lines joined with "\n"). Quotes are checked against this. */
  text: string;
}

export interface DocVersion {
  doc_id: string;
  version: number;
  type: string;
  date: string;
  title: string;
  file: string;
  sections: Section[];
}

/** Parse one document file: a small "key: value" header between --- lines, then "## <id> <heading>" sections. */
export function parseDoc(raw: string, file: string): DocVersion {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing header`);
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  for (const k of ["doc_id", "version", "type", "date", "title"]) if (!meta[k]) throw new Error(`${file}: header lacks ${k}`);
  const doc: DocVersion = {
    doc_id: meta.doc_id!,
    version: Number(meta.version),
    type: meta.type!,
    date: meta.date!,
    title: meta.title!,
    file,
    sections: [],
  };
  let cur: { id: string; heading: string; lines: string[] } | undefined;
  const flush = () => {
    if (cur) doc.sections.push({ doc_id: doc.doc_id, version: doc.version, section_id: cur.id, heading: cur.heading, text: cur.lines.join("\n").trim() });
  };
  for (const line of m[2]!.split("\n")) {
    const h = line.match(/^## (\S+) (.+)$/);
    if (h) {
      flush();
      cur = { id: h[1]!, heading: h[2]!, lines: [] };
    } else if (cur && line.trim()) cur.lines.push(line.trim());
  }
  flush();
  const ids = doc.sections.map((s) => s.section_id);
  if (new Set(ids).size !== ids.length) throw new Error(`${file}: duplicate section id`);
  return doc;
}

/**
 * All document versions, plus a view of which version is current. Old versions are kept for history
 * and for checking stale citations, but only current versions are searchable.
 */
export class Corpus {
  private readonly versions = new Map<string, DocVersion[]>(); // doc_id -> sorted by version
  private readonly current = new Map<string, number>();

  constructor(docs: DocVersion[], readonly datasetVersion = DATASET_VERSION) {
    for (const d of docs) {
      const list = this.versions.get(d.doc_id) ?? [];
      if (list.some((x) => x.version === d.version)) throw new Error(`duplicate ${d.doc_id} v${d.version}`);
      list.push(d);
      list.sort((a, b) => a.version - b.version);
      this.versions.set(d.doc_id, list);
      this.current.set(d.doc_id, list.at(-1)!.version);
    }
  }

  static load(dir = join(DATA_DIR, "docs")): Corpus {
    const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
    return new Corpus(files.map((f) => parseDoc(readFileSync(join(dir, f), "utf8"), `data/docs/${f}`)));
  }

  /** Make an older version current (used to replay a dialogue from before an upload). */
  pin(docId: string, version: number): this {
    if (!this.get(docId, version)) throw new Error(`no ${docId} v${version}`);
    this.current.set(docId, version);
    return this;
  }

  docIds(): string[] {
    return [...this.versions.keys()].sort();
  }
  currentVersion(docId: string): number | undefined {
    return this.current.get(docId);
  }
  get(docId: string, version?: number): DocVersion | undefined {
    const v = version ?? this.current.get(docId);
    return this.versions.get(docId)?.find((d) => d.version === v);
  }
  allVersions(): DocVersion[] {
    return [...this.versions.values()].flat();
  }
  /** Sections of the current version of every document. */
  currentSections(): Section[] {
    return this.docIds().flatMap((id) => this.get(id)!.sections);
  }
  section(docId: string, sectionId: string, version?: number): Section | undefined {
    return this.get(docId, version)?.sections.find((s) => s.section_id === sectionId);
  }
  title(docId: string): string {
    return this.get(docId)?.title ?? docId;
  }
}
