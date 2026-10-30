# Data provenance

Everything in this folder is synthetic. It was written by hand for this repo on 2026-10-30. Company names, addresses, people and amounts are invented; any resemblance to a real business is coincidental. The only email address uses the reserved `.example` domain (RFC 2606). Dataset version: `bizdocs-v1`.

## Documents (`docs/`)

Ten documents with stable ids, eleven files. File name is `<doc_id>.v<version>.md`. Each file has a small header (`doc_id`, `version`, `type`, `date`, `title`) and sections written as `## <section_id> <heading>`. A citation `CTR-001 §4` means: file `CTR-001.v<current>.md`, the block under `## 4`. Open it with `npm run --silent source -- CTR-001 4`.

| doc_id | Type | What it is | Built-in test |
| --- | --- | --- | --- |
| CTR-001 | contract | Cleaning services agreement. **v1** (2026-01-12) and **v2** (2026-06-15, consolidated with amendment 1) | v2 changes the monthly fee (42 000 to 46 500 SEK) and the end date (2027-01-31 to 2027-06-30) |
| CTR-002 | contract | Parking lease | |
| INV-2026-0412 | invoice | Cleaning invoice, April | Mentions 42 000 SEK as an invoice line, worded differently from the contract |
| INV-2026-0587 | invoice | Parking invoice, April | |
| POL-001 | policy | Travel and expense policy | Contradicts MEMO-002 on hotel limit and receipt deadline |
| MEMO-002 | memo | Finance memo on travel costs | Contradicts POL-001; agrees with it on per diem |
| POL-003 | policy | Information security policy | |
| NDA-004 | contract | Non-disclosure agreement | |
| SLA-005 | contract | IT support service level agreement | Also has a "monthly fee", a distractor for the cleaning fee question |
| MIN-006 | minutes | Facilities meeting minutes | |

Version rule: the highest version of a doc_id is current and replaces earlier versions in full. Older versions stay on disk so stale citations can be recognised as stale.

Neither memo nor policy says which one takes precedence. That is deliberate: the correct output is `conflict`, not a guess.

## Questions (`questions.json`)

24 labelled questions: 14 `supported`, 3 `updated`, 2 `contradiction`, 5 `unsupported`. Each has `expected_status`, `expected_answer` (or null) and `allowed_sources` as `doc_id#section_id`. Labels were written from the documents by hand. The documents and questions were written by the same author in the same session as the retriever, so this is a development set, not a held-out test.

## Dialogue (`dialogue.json`)

22 user turns; the 22 assistant turns are generated at run time against the corpus as it stood at that turn, for 44 turns in total. CTR-001 starts at v1; turn 21 uploads v2. Four user turns state facts that exist only in the conversation (a case number, a date, a cost centre, a contact address). 11 labelled probe questions are asked after the last turn.
