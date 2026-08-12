# Template Contract — กนศ.04 / กนศ.06

**Status**: Tag inventory and payload contract complete. Field-by-field mapping table not yet written.
**Phase**: Phase 0 deliverable 2 of 5 (per `docs/DECISIONS.md` Q23).
**Last updated**: 2026-08-12

---

## What this file is

The **contract the assembler must satisfy** (Q4/Q7): the normalized domain model is flattened
into a flat payload that these two Word templates consume. The templates are **not** being
rebuilt — they are government forms and are treated as fixed. This document says exactly what
they demand.

Everything below was extracted mechanically from the `.docx` files (unzip → concatenate
`<w:t>` runs in document order → match `{…}`), not read off the rendered page.

**Sources**

| What | Path |
| --- | --- |
| กนศ.04 template | `…\Student-activity-system-DMS\backend\src\templateDoc\temp04.docx` |
| กนศ.06 template | `…\backend\src\templateDoc\temp06.docx` |
| Render call sites | `…\backend\src\studentRoutes.js` |

Two superseded files sit alongside them — `temp04(oldversion).docx`,
`temp06(oldversion).docx`. **Ignore them**; the live code loads only `temp04.docx`
(`studentRoutes.js:1169`) and `temp06.docx` (`:1332`).

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
| `startM_n < endM_n`, `> `, `== ` | 15 each | bar direction guards |
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

3. **`{ grandTypeETC }` is written with inner spaces** in temp06. docxtemplater tolerates it,
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

1. **The full 433-field mapping table is not yet written.** This document establishes the
   shape, counts, arities, and semantics; the per-field
   `template tag → domain path → formatter` table is the remaining work, and is the input to
   the assembler's implementation.
2. **The `&&`/`||` inconsistency in the Gantt** needs a rendered-output check to decide which
   is correct before it is reproduced or fixed.
3. **`listETC`/`listSETC`** — stored and entered, never printed. Confirm intent.
4. **`volume2..5` and `quality1..5`** are captured by the UI and stored on `p_indicator` but
   have no temp04 tags. Same question: dead, or a form that was never finished?
5. **The code-format PDF remains unread** (`DECISIONS.md:271`) — unchanged by this work.
