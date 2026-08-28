# Template Contract — กนศ.04 / กนศ.06

**Status**: Complete, and now **generated rather than described**. The field-by-field mapping is
`docs/template-tags.json`, produced from the `.docx` bytes by
`backend/scripts/extract-template-tags.js` (`npm run templates:tags`). The assembler is built
against it and `check-phase4.js` asserts against it, so this contract is checked on every run
rather than remembered. This file remains the prose explanation of *why* the mapping is shaped
as it is.
**Phase**: Phase 0 deliverable 2 of 5 (per `docs/DECISIONS.md` Q23); satisfied by Phase 4.
**Last updated**: 2026-08-14

---

## What this file is

The **contract the assembler must satisfy** (Q4/Q7): the normalized domain model is flattened
into a flat payload that these two Word templates consume. The templates are **not** being
rebuilt — they are government forms and are treated as fixed. This document says exactly what
they demand.

Everything below was extracted mechanically from the `.docx` files (unzip → concatenate
`<w:t>` runs in document order → match `{…}`), not read off the rendered page.

### Sources

**The templates now live in this repo** — `templates/temp04.docx` and
`templates/temp06.docx`, copied byte-for-byte from the old system on 2026-08-12 and verified
by MD5 and by re-extraction. See `templates/README.md` for checksums and provenance. Build
against the in-repo copies; the paths below are the origin, kept for traceability.

| What | In-repo | Origin |
| --- | --- | --- |
| กนศ.04 template | `templates/temp04.docx` | `…\Student-activity-system-DMS\backend\src\templateDoc\temp04.docx` |
| กนศ.06 template | `templates/temp06.docx` | `…\backend\src\templateDoc\temp06.docx` |
| Render call sites | — | `…\backend\src\studentRoutes.js` |

Two superseded files sit beside the originals — `temp04(oldversion).docx`,
`temp06(oldversion).docx`. **They were deliberately not copied**; the live code loads only
`temp04.docx` (`studentRoutes.js:1169`) and `temp06.docx` (`:1332`).

---

## Engine and options

Both call sites are identical in setup:

```js
const expressionParser = require("docxtemplater/expressions.js");   // :1164, :1327
const doc = new Docxtemplater(zip, {
  parser: expressionParser,                                          // :1175, :1338
  paragraphLoop: true,
  linebreaks: true,
});
```

- **`docxtemplater` + its `expressions.js` parser (angular-expressions) is mandatory.**
  temp04 contains **783 expression tags** that the default parser cannot evaluate. Dropping
  this dependency does not degrade the output — it throws. `DECISIONS.md:125-126` already
  flags that the strategy doc's `package.json` omits it.
- `paragraphLoop: true` and `linebreaks: true` must be preserved; the forms rely on both.

---

## Tag inventory

| | temp04 (กนศ.04) | temp06 (กนศ.06) |
| --- | ---: | ---: |
| Extracted text | 76,026 chars | 15,048 chars |
| Raw tag occurrences | 4,160 | 552 |
| **Unique tags** | **1,426** | **242** |
| Unique plain fields `{x}` | **433** | **42** |
| Section opens `{#x}` | 1,739 (782 unique) | 185 (74 unique) |
| — of which simple `{#name}` | 152 unique | 74 unique |
| — of which expressions | **630 unique** | 0 |
| Section closes `{/x}` | 1,797 | 237 |
| Inverted `{^x}` | 58 | 52 |

`DECISIONS.md:123` records temp06 at 241 unique tags; the count here is **242**. A
one-tag difference, not material, but this extraction is the one to trust — it rejoins tags
split across XML runs.

---

## Payload roots

Both templates wrap nearly every field in a `{#root}…{/root}` section. The root names **are**
the payload keys, so the assembler's top-level shape is fixed by the templates.

### temp04 — `studentRoutes.js:1179-1187`

```js
doc.render({
  detail:    result[0],              // projects
  person:    resultp_person[0],      // p_person
  timestep:  resultp_timestep[0],    // p_timestep
  indicator: resultp_indicator[0],   // p_indicator
  budget:    resultp_budget[0],      // p_budget
  user:      resultuser[0],          // users — the adviser/owner
  userSH:    resultuserSH[0],        // users — the student head
});
```

All seven roots appear in the template. Each is a **single object**, not an array — the
`{#…}` sections are used as *scoping blocks*, not loops. This is why the templates are
flat and fixed-arity (Q8) rather than row-driven.

### temp06 — `studentRoutes.js:1361-1370`

```js
doc.render({
  detail, person, Fperson, indicator, Fbudget, user, userSH, persen
});
```

- `Fperson` = `p_finalperson` (actual attendance), `Fbudget` = `p_finalbudget` (actual money).
- **`persen` is not a typo of `person`** — it is เปอร์เซ็นต์, a **percentage** object
  synthesized at render time (`studentRoutes.js:1342-1357`):
  `(final / planned) * 100`, `.toFixed(0) + '%'`, for each of the six `grandTotal*` fields.
  It exists only in the payload; there is no table behind it.
- The กนศ.06 attendance table therefore prints each row **three times side by side** —
  `{#person}X{/person}{#Fperson}X{/Fperson}{#persen}X{/persen}` — as *planned | actual | %*.

---

## The budget grid

This is the largest and most error-prone part of the contract. `schema-current.md` decodes the
column naming; the template confirms it and **names the categories**.

### Category names, from the form's own headings

| DB family | Form heading | Meaning |
| --- | --- | --- |
| `A` | `หมวดค่าตอบแทน` | remuneration |
| `BT` + `BNT` | `หมวดค่าใช้สอย` | operating expenses |
| `C` | `หมวดค่าวัสดุ` | materials / supplies |

**This closes open question 4 in `schema-current.md`.** The form has **three** printed
categories (A, B, C), while the database splits B into `BT` and `BNT`. The subtotal
`{listSSB}` is emitted **after the BNT block ends**, following `{listSBNT10}{/listBNT10}` —
so `listSSB = BT + BNT`, the combined ค่าใช้สอย subtotal. Consequently:

- **`listSSBT` and `listSSBNT` exist in the database but appear in neither template.**
  They are dead columns. Only `listSSA`, `listSSB`, `listSSC` and the grand total
  `listSAll` (plus `thailistSAll`, the Thai spelled-out amount) are printed.

### Row phrasing confirms the modifier decode

The form's own sentence structure, read straight out of the template text:

- **A**: `{listA_n} … {listNA_n} คน … {listTA_n} ชั่วโมง ชั่วโมงละ {listTPA_n} บาท` → `{listSA_n}`
  Units are **printed literally in the form** (คน, ชั่วโมง) — which is why category A has no
  unit-label columns in the database.
- **BT**: `… {listNBT_n} {listNNBT_n} … {listTBT_n} {listTNBT_n} {listTNBT_n}ละ {listTPBT_n} บาท` → `{listSBT_n}`
- **C**: `… {listNC_n} {listNNC_n} {listNNC_n}ละ {listTPC_n}` → `{listSC_n}`

The unit label is emitted **twice** — once as the unit, once in the "…ละ" (per-) phrase.
The assembler must supply the same value to both; it is one domain field.

### Arity — **the template is narrower than the database**

| Family | DB capacity | **Template capacity** | Gap |
| --- | ---: | ---: | --- |
| `A` (ค่าตอบแทน) | 15 | 15 | — |
| **`BT`** | **20** | **12** | **8 rows cannot be printed** |
| `BNT` | 10 | 10 | — |
| `C` (ค่าวัสดุ) | 20 | 20 | — |
| `topic_table` (timeline) | 15 | 15 | — |
| `expresult` (indicators) | 5 | 5 | — |
| `volume` | 5 | **1** | 4 unprintable |
| `quality` | 5 | **0** | never printed |
| `person*Type*` | 5 each | 5 each | — |

All seven `BT` families (`listBT`, `listNBT`, `listNNBT`, `listTBT`, `listTNBT`, `listTPBT`,
`listSBT`) stop at index **12**, contiguously. This is a hard cap, not a gap.

**This is the concrete case Q8 was written for.** A project with 13+ ค่าใช้สอย(taxable) lines
is representable in the database and in the UI, but **silently truncated on the form today**.
Under Q8 the new database stays uncapped and **the assembler must raise a clear error** —
naming the category and the count — rather than dropping rows. This is a real,
currently-shipping data-loss path, and it should be listed among the deliberate deviations.

### Dead budget fields

`listETC` and `listSETC` (the "other" budget row) exist in `p_budget` **and in the entry UI**,
but appear in **neither template**. Any amount entered there is stored and never printed —
and, since `listSAll` is computed in the frontend, it may or may not be included in a total
the form does print. Flag for reconciliation before migration.

---

## Checkbox banks

Rendered as conditional sections `{#is_x}…{/is_x}` with `{^is_x}` for the unchecked glyph.

| Bank | temp04 | temp06 | DB source |
| --- | ---: | ---: | --- |
| `is_SDGs_1..17` | 17 | 17 | `projects` |
| `is_5p2p1_1..9`, `is_5p2p2_1..6`, `is_5p2p3_1..7` | 22 | 22 | `projects` |
| `is_5p1_1..4` | 4 | 4 | `projects` |
| `is_1side..is_5side` | 5 | 5 | `projects` |
| `is_1basic..is_4basic` | **4** | **4** | `projects` |
| `is_1follow..is_4follow`, `is_etcfollow` | 4 + 1 | — | `p_indicator` |
| `is_newproject`, `is_continueproject`, `is_inyear` | 3 | — | `projects` / `p_timestep` |

**This closes open question 2 in `schema-current.md`.** `DECISIONS.md:119` records the basic
bank as `is_1..5basic`; both the template and the database have **four**. The record is off
by one — there is no fifth tag and no orphan column. `is_*follow` is 4 and lives on
`p_indicator`, and it appears in temp04 only.

---

## The Gantt chart

temp04 expands a 15-row × 12-month grid **inline**, as 630 unique expression tags. The shapes:

| Expression shape | Count | Purpose |
| --- | ---: | --- |
| `startM_n <= m && endM_n >= m` | 180 | the normal "month m is inside the bar" test |
| `startM_n <= m \|\| endM_n >= m` | 164 | — |
| `startM_n == m && endM_n == m` | 176 | single-month bar |
| `startM_n <= m && endM_n <= m` | 4 | — |
| `startM_n <= m \|\| endM_n <= m` | 12 | — |
| `startM_n == m` | 4 | — |
| `startM_n < endM_n`, and the `>` and `==` variants | 15 each | bar direction guards |
| `topic_table_n !== null` | 15 | row-present guard |
| `thaistart_duration_table_n !== null` | 15 | |
| `responsibleTable_n_str !== null` | 15 | |

**The mix of `&&` and `||` across cells that should be identical is suspicious** — 180 cells
use `&&` where 164 use `||` for the same conceptual test. `||` makes the cell shade far too
often. This is very likely a copy-paste defect in the form and should be checked against a
rendered document before the assembler is trusted to reproduce "correct" output. Do **not**
treat current rendered Gantt charts as a correctness baseline.

Under Q19 `startM`/`endM` are **derived at assembly time** from real dates, so the assembler
must produce integer month indices (currently `text` in `p_timestep`) for these comparisons
to behave. Angular-expressions comparing strings (`"10" <= 9`) is a live source of wrong
output today.

---

## Defects found in the render path

New findings, to be carried into `business-rules.md` and the deviations list.

1. **temp06 references `{#budget}` but the payload has no `budget` key.**
   The template contains
   `{#budget}{listSAll}{/budget} บาท จากเงินเหลือจ่ายกิจกรรมนักศึกษาส่วนกลาง…` —
   the sentence stating the approved project total. The temp06 render
   (`studentRoutes.js:1361-1370`) passes `Fbudget` but **not** `budget`, so the section is
   falsy and **the amount prints blank on every กนศ.06**. Confirmed by tag extraction, not
   inferred. The new assembler must supply both the approved total and the actual total.

2. **`persen` divides unvalidated strings.** `studentRoutes.js:1342-1347` computes
   `final / planned` where both operands are `varchar(255)` columns. If planned attendance is
   `0` the result is `Infinity` → **`"Infinity%"`** on the form; if either is empty or
   non-numeric it is `NaN` → **`"NaN%"`**. There is no guard. The assembler must handle
   zero/absent planned counts explicitly.

3. **The `grandTypeETC` tag is written with inner spaces** — literally `{`, space,
   `grandTypeETC`, space, `}` — in temp06. docxtemplater tolerates it,
   but any hand-rolled tag matching will not — noted so the assembler's field list is built
   from trimmed names.

---

## What the assembler owes

Restating the contract as requirements (Q4/Q7/Q8):

1. Emit **8 payload roots** across the two forms — `detail`, `person`, `Fperson`, `persen`,
   `timestep`, `indicator`, `budget`, `Fbudget`, `user`, `userSH` — each a **flat object**,
   using exactly these key names.
2. Emit **433 distinct field names** for temp04 and 42 for temp06, at the fixed arities in
   the table above.
3. Supply **derived values the templates expect but the domain model will not store**:
   `listS*` line totals, `listSS*` subtotals, `listSAll`, `thailistSAll` (Thai spelled-out
   amount), `grandTotal*`, all `thai*` date strings, `startM`/`endM` month indices, and the
   whole `persen` object.
4. **Validate arity before rendering** and fail loudly with the category and count when a
   project exceeds a form's capacity — never truncate. The BT-12-vs-20 gap makes this a real
   path, not a theoretical one.
5. Keep `expressionParser`, `paragraphLoop`, and `linebreaks`.

---

## Open items

1. ~~**The full 433-field mapping table is not yet written.**~~ **Closed by Phase 4.** It is
   `docs/template-tags.json`, and it is *generated*, not written: the extractor walks each
   template's section stack and records which payload root every field and every section is
   read from. That last part matters more than the field list — a field placed under the wrong
   root renders **blank, with no error**, which is precisely how defect 1 below survived. The
   ownership table is what turns "the assembler supplies 433 fields" into something a test can
   check, and `check-phase4.js` checks it both ways: every contract tag has a key, and no key
   is `undefined` or `null`.

2. **The `&&`/`||` inconsistency in the Gantt** — **quantified, not fixed.** The extraction
   shows temp04 contains **two** full 15×12 month grids over the same `startM`/`endM` values:
   180 cells testing `startM_n <= m && endM_n >= m`, and **176 testing the same months with
   `||`**. The `||` grid shades every column from the first month the bar touches to the end of
   the year, so it is wrong for any activity shorter than the whole year.

   This is **not fixable from the payload** — both grids read the same two numbers — and
   `templates/README.md` says the files are not to be edited. So the assembler supplies correct
   integer month indices, the `&&` grid is right, and the `||` grid over-shades exactly as it
   does today. **Fixing it means editing temp04, which is the owner's call**, not the
   assembler's. Its current output remains not a correctness baseline.

3. ~~**`listETC`/`listSETC`** — stored and entered, never printed.~~ **Closed by Phase 4, in
   the direction Q8 requires.** The category has a printable capacity of **zero**, so a project
   carrying an `ETC` budget line is *refused* with "แบบฟอร์มไม่มีช่องสำหรับหมวดนี้เลย" rather than
   printing a grand total that does not match the rows above it. If the intent is that ETC
   money should print, the form needs a box for it; until then, refusing is the only option
   that does not put a wrong total on a document somebody signs.

4. ~~**`volume2..5` and `quality1..5`**~~ **Answered by the extraction.** `volume` has exactly
   **one** tag and `quality` has **none** — confirmed against the bytes, not inferred.
   `volume1` is supplied; `quality_target` is stored and deliberately not emitted, and is
   listed as such. Whether the form was meant to hold more is still a question for the owner,
   but the database is the uncapped side and loses nothing.

5. ~~**The code-format PDF remains unread**~~ **Read and verified 2026-08-28** — see `DECISIONS.md`,
   "Open items" → the code-format PDF entry. It confirms the 12-digit layout digit for digit and
   surfaces no rule this document's format contract needs to account for; it is about project
   *numbering*, a separate concern from the form's tag inventory.

## Found during Phase 4

- **`Fbudget.refundtotal`** is a temp06 field this document did not list. It is the amount to
  be returned — approved minus actual — and it is now supplied as a subtraction over rows.
- **`expresult1..5` is read from `detail` on temp04 and from `indicator` on temp06.** The same
  domain values under two different roots in the two forms; both are supplied. This is the
  clearest illustration of why ownership had to be extracted rather than inferred from names.
- **`is_inyear` / `start_inyear` / `end_inyear` were never set by the old system.** They are
  initialised to `false`/`""` in `CSD_timestep.js:399-401` and posted unchanged, so the Gantt's
  year header has always printed blank. The assembler now derives them from the activity dates
  — deviation 36.
