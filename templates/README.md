# Word templates (กนศ.04 / กนศ.06)

These are the **two government forms the system fills in**. They are treated as **fixed
inputs**, not as things to redesign — see `docs/DECISIONS.md` Q4/Q7. The new build normalizes
the data model and puts an **assembler** in front of these files; the files themselves are
copied here byte-for-byte and are not to be edited.

What each one demands — every tag, arity, and payload root — is documented in
`docs/template-contract.md`.

## Contents

| File | Form | Size | MD5 |
| --- | --- | ---: | --- |
| `temp04.docx` | กนศ.04 — project proposal | 165,109 B | `caa8d2634d7fbe2e3b05147c7870ce3e` |
| `temp06.docx` | กนศ.06 — final report | 83,393 B | `1686cc9b8f930fe798697967d13bfc0b` |

## Provenance

Copied 2026-08-12 from the old system:

```text
C:\Users\pongk\OneDrive\เอกสาร\GitHub\Student-activity-system-DMS\backend\src\templateDoc\
```

Verified byte-identical to the originals (MD5 above) and verified to parse identically —
temp04 yields 4,160 tag occurrences / 1,426 unique, temp06 yields 552 / 242, matching the
originals exactly.

**Only the live templates were copied.** The source directory also holds
`temp04(oldversion).docx` and `temp06(oldversion).docx`, which the old backend never loads —
it reads `temp04.docx` at `studentRoutes.js:1169` and `temp06.docx` at `:1332`. If the
superseded versions are ever needed for comparison they are still in the path above.

## Do not edit

The tag inventory in `docs/template-contract.md` was extracted from these exact bytes. Editing
a template silently invalidates that contract and the assembler built against it. If a form
genuinely changes:

1. Replace the file and record the new MD5 here.
2. Re-run the extraction and update `docs/template-contract.md`.
3. Re-check the arity table — the assembler's validation limits come from it.

## Known defects in these files

Carried from `docs/template-contract.md`; they are defects **in the forms as shipped**, not
in the new code:

- **temp04 truncates budgets.** The ค่าใช้สอย (`BT`) block prints only **12** rows where the
  database stores 20.
- **temp06 prints a blank approved total.** It contains `{#budget}{listSAll}{/budget}`, but
  the old render call never passes a `budget` key.
- **temp04's Gantt mixes `&&` and `||`** across cells that should test identically, so its
  current output is not a correctness baseline.
