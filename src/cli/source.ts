import { Corpus } from "../corpus.ts";

/** Open a cited section: `npm run --silent source -- CTR-001 4 [version]`. Prints the exact stored text. */
const [docId, sectionId, ver] = process.argv.slice(2);
if (!docId || !sectionId) {
  console.error("usage: npm run --silent source -- <doc_id> <section_id> [version]");
  process.exit(2);
}
const corpus = Corpus.load();
const doc = corpus.get(docId, ver ? Number(ver) : undefined);
const sec = doc?.sections.find((s) => s.section_id === sectionId);
if (!doc || !sec) {
  console.error(`not found: ${docId} §${sectionId}${ver ? ` v${ver}` : ""}`);
  process.exit(1);
}
const cur = corpus.currentVersion(docId);
console.log(`${doc.file}  ${doc.doc_id} v${doc.version}${doc.version === cur ? " (current)" : ` (superseded, current is v${cur})`}  ${doc.title}, ${doc.date}`);
console.log(`§${sec.section_id} ${sec.heading}`);
console.log(sec.text);
