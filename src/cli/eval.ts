import { budgetFromArgs, buildReport, toMarkdown, writeReport } from "../report.ts";

/** `npm run eval -- --budget 800`: labelled questions plus the context comparison, written to evidence/. */
const report = await buildReport(budgetFromArgs(process.argv.slice(2)));
const files = writeReport(report);
console.log(toMarkdown(report));
console.log(`written: ${files.json}, ${files.md}`);
