# Current Schema — extraction from `usersystem.sql`

**Status**: Complete for structure (DDL, keys, column inventory). Data-profiling is partial — see "Data profile" and "Open questions".
**Phase**: Phase 0 deliverable 1 of 5 (per `docs/DECISIONS.md` Q23).
**Last updated**: 2026-08-12

---

## What this file is

A **straight extraction** of the schema the old system actually runs on. It is descriptive,
not prescriptive: nothing here is a proposal. The target design lives in `schema-target.md`.

Every claim below was produced by reading the dump, not by reasoning about it. Citations are
`usersystem.sql:<line>` and refer to:

```text
C:\Users\pongk\OneDrive\เอกสาร\GitHub\Student-activity-system-DMS\backend\backup\usersystem.sql
```

Frontend citations are relative to
`C:\Users\pongk\OneDrive\เอกสาร\GitHub\Student-activity-system-DMS\frontend\src\views\`.

1,647 lines / 172,673 bytes. MariaDB dump, InnoDB throughout.

---

## Table inventory

15 tables, **843 columns total** (verified by summing the counts below).

| # | Table | Cols | DDL line | PK | AUTO_INCREMENT | Role |
| --- | --- | ---: | ---: | --- | ---: | --- |
| 1 | `historyeditproject` | 8 | 30 | `id_history` | 41 | audit — per-page edit counter |
| 2 | `login` | 4 | 83 | `id` | 2 | login attempt log |
| 3 | `logstatus_project` | 7 | 103 | `id` | 368 | phase-transition log |
| 4 | `logstudentgetmoney` | 9 | 175 | `id` | 279 | money disbursement ledger |
| 5 | `netprojectbudget` | 8 | 206 | `id` | 29 | annual budget **plan lines** |
| 6 | `projects` | **117** | 236 | `id` | 825 | the project header — denormalized |
| 7 | `p_addfile` | 6 | 398 | `id` | 198 | attachments |
| 8 | `p_budget` | **382** | 456 | `id` | 42 | the budget matrix, 1 row/project |
| 9 | `p_finalbudget` | 7 | 868 | `id` (+KEY `id_projects`) | 672 | กนศ.06 budget — **aggregates only** |
| 10 | `p_finalperson` | 55 | 907 | `id` (+KEY `id_projects`) | 682 | กนศ.06 attendance |
| 11 | `p_indicator` | 25 | 1001 | `id` (+KEY `id_projects`) | 108 | indicators / expected results |
| 12 | `p_person` | 55 | 1056 | `id` (+KEY `id_projects`) | 620 | กนศ.04 planned attendance |
| 13 | `p_timestep` | 129 | 1156 | `id` (+KEY `id_projects`) | 404 | timeline + Gantt |
| 14 | `status_project` | 8 | 1323 | `id` | 192 | **current** phase (duplicates `projects.project_phase`) |
| 15 | `users` | 23 | 1412 | `id` | 27 | identity + role + org placement |

**There is not a single FOREIGN KEY in the schema.** The only non-primary indexes are the five
`KEY (id_projects)` entries on `p_finalbudget`, `p_finalperson`, `p_indicator`, `p_person`,
`p_timestep`. Every other relationship — including every join the application performs — is
unindexed and unenforced.

---

## Column inventory by table

Numbered column families are written `name1..N`. Counts are exact.

### `projects` — 117 cols (line 236)

The denormalized project header. Carries กนศ.04 form fields inline.

| Family | × | Type | Notes |
| --- | ---: | --- | --- |
| `id` | 1 | int(11) | surrogate PK |
| `id_student` | 1 | varchar(20) | owner — the *creating* student |
| `project_name` | 1 | varchar(255) | |
| `project_number` | 1 | varchar(12) | the 12-char business key |
| `codeclub` | 1 | varchar(10) | 10-char org prefix of `project_number` |
| `codebooksomeoutyear` | 1 | varchar(20) | `"yy"`-year variant of the code |
| `yearly` | 1 | **int(11)** | Buddhist-era year — *the only numeric year in the schema* |
| `yearly_count` | 1 | varchar(50) | per-club sequence number |
| `yearly_countsketch` | 1 | varchar(50) | draft-side sequence; the join key used by child tables |
| `academic_year` | 1 | varchar(10) | |
| `project_phase` | 1 | text | Thai phase string |
| `responsible_agency` | 1 | varchar(255) | |
| `AgnecyGroupName` | 1 | text | **[sic]** — misspelling of "Agency" is in the schema |
| `advisor_name`, `AgencyAdvisor`, `PhoneAdvisor` | 3 | varchar/text | |
| `objective1..5` | 5 | varchar(255) | |
| `principles_and_reasons1..5` | 5 | text | |
| `location1..5` | 5 | varchar(255) | |
| `project_type1..5` | 5 | varchar(50) | |
| `problem1..3` | 3 | varchar(155) | |
| `result1..3` | 3 | varchar(155) | |
| `person1..3_name` | 3 | varchar(255) | contact persons |
| `person1..3_contact` | 3 | varchar(15) | |
| `start_prepare`, `end_prepare`, `start_event`, `end_event` | 4 | **date** | real dates |
| `thaistart_prepare`, `thaiend_prepare`, `thaistart_event`, `thaiend_event` | 4 | text | **pre-rendered Thai strings of the same dates** |
| `deadline` / `thaideadline` | 2 | varchar(255) / text | same duplication |
| `created_at` | 1 | date | |
| `updated_at` | 1 | timestamp | |
| `net_budget`, `allow_budget`, `use_budget` | 3 | **text** | money as text |
| `is_newproject`, `is_continueproject` | 2 | tinyint(1) | |
| `is_SDGs_1..17` | 17 | tinyint(4) | UN SDG checkbox bank |
| `is_5p1_1..4` | 4 | tinyint(4) | strategy bank |
| `is_5p2p1_1..9` | 9 | tinyint(4) | strategy bank |
| `is_5p2p2_1..6` | 6 | tinyint(4) | strategy bank |
| `is_5p2p3_1..7` | 7 | tinyint(4) | strategy bank |
| `is_1side..is_5side` | 5 | tinyint(1) | |
| `is_1basic..is_4basic` | **4** | tinyint(4) | see discrepancy note below |

> **Discrepancy to reconcile.** `DECISIONS.md:119` records the temp04 checkbox banks as
> `is_1..5side`, `is_1..5basic`, `is_1..4follow`. The database has **`is_1basic..is_4basic`
> (4, not 5)**. `is_*follow` is 4 and lives on `p_indicator`, not `projects`. Whether the
> template really has a 5th `basic` tag must be settled in `template-contract.md`; if it
> does, that tag has no column behind it.

Dates are stored **twice** — once as `date`, once as a pre-formatted Thai string. The Thai
strings exist only to feed the Word template. Under Q19 the derived strings are dropped and
formatted at assembly time.

### `p_budget` — 382 cols (line 456)

One row per project. The entire budget worksheet flattened into columns.

**Scalars (17):** `id`, `id_projects`, `codeclub`, `yearly_countsketch`,
`TypeACount`, `TypeBTCount`, `TypeBNTCount`, `TypeCCount` (rows-used counters),
`listSSA`, `listSSBT`, `listSSBNT`, `listSSC`, `listSSB` (category subtotals),
`listETC`, `listSETC`, `listSAll`, `thailistSAll` (grand total + its Thai spelling).

**Matrix families (365 cols).** Four expense categories with fixed row capacity.

**The naming scheme is `list` + `<modifier>` + `<category>`, and it is fully decoded**
(verified against `CSD_budget.js`, cited below — *not* inferred from the names):

| Modifier | Meaning | Input? |
| --- | --- | --- |
| *(none)* | รายการ — the item description | user |
| `N` | quantity #1 | user |
| `NN` | the **unit label** for quantity #1 (e.g. `คน`) | user |
| `T` | quantity #2 | user |
| `TN` | the **unit label** for quantity #2 (e.g. `ชั่วโมง`) | user |
| `TP` | ราคา — the **unit price** | user |
| `S` | the **computed line total** = `N × T × TP` | **derived, disabled field** |

`listSA` is rendered as a `disabled` input bound to computed state
(`CSD_budget.js:1218-1223`), and the computation is literally
`parseInt(numPeople) * parseInt(numHours) * parseInt(pricePerHour)`
(`CSD_budget.js:551-553` — the parameter names are the source's own).

This resolves what looked like an irregular grid. The per-category variation is **deliberate,
not a bug**:

| Category | Rows | Modifiers present | Per row | Cols |
| --- | ---: | --- | ---: | ---: |
| `A` | 15 | —, `N`, `T`, `TP`, `S` | 5 | 75 |
| `BT` | 20 | —, `N`, `NN`, `T`, `TN`, `TP`, `S` | 7 | 140 |
| `BNT` | 10 | —, `N`, `NN`, `TP`, `S` | 5 | 50 |
| `C` | 20 | —, `N`, `NN`, `TP`, `S` | 5 | 100 |

`75 + 140 + 50 + 100 = 365`; `365 + 17 = 382`. ✓

- **`A` has no unit-label columns** because its two units are **hard-coded in the UI** as
  `คน` (people) and `ชั่วโมง` (hours) — rendered as static `<div>`s, not inputs
  (`CSD_budget.js:1190`, `:1204`). So category A is always *people × hours × rate*.
- **`BNT` and `C` have no `T`/`TN`** because they are single-quantity categories
  (quantity × unit × price).
- **`listTNBT1..20` is not an orphan and not a typo.** It is declared inside the BT block
  (`CSD_budget.js:589`, between `listTBT` at `:588` and `listTPBT` at `:592`) and is the unit
  label for BT's second quantity. Its 20-column width is correct — it is a `BT` family, not a
  `BNT` one.

**Consequence for the target model:** a budget line is
`(description, qty1, unit1, qty2, unit2, unit_price)` with the amount **derived**. Only
`listTP*` is real money input; every `listS*` and every `listSS*` subtotal is a cached
computation and must not be migrated as authoritative.

### `p_timestep` — 129 cols (line 1156)

| Family | × | Type |
| --- | ---: | --- |
| `id`, `id_projects`, `codeclub`, `yearly_countsketch` | 4 | int / varchar |
| `topic_table1..15` | 15 | text |
| `start_duration_table1..15`, `end_duration_table1..15` | 30 | **date** |
| `thaistart_duration_table1..15`, `thaiend_duration_table1..15` | 30 | text |
| `responsibleTable1..15str` | 15 | text |
| `startM1..15`, `endM1..15` | 30 | **text** — Gantt month indices, stored as text |
| `TopictableCount` | 1 | text |
| `is_inyear`, `start_inyear`, `end_inyear`, `startMonth` | 4 | tinyint / text |

Capacity: **15 timeline rows.** `startM`/`endM` are *derived* month numbers that the template
compares numerically (`{#startM1 <= 1 && endM1 >= 1}`) yet stores as `text`. Q19 makes the
real dates authoritative and derives these at render time.

### `p_person` / `p_finalperson` — 55 cols each (lines 1056, 907)

**Structurally identical.** `p_person` = planned attendance (กนศ.04); `p_finalperson` =
actual attendance (กนศ.06).

Five attendee types — `student`, `professor`, `executive`, `expert`, and an `ETC` catch-all:

| Family | × | Type |
| --- | ---: | --- |
| `{student,professor,executive,expert}Type1..5Name` | 20 | varchar(255) |
| `{student,professor,executive,expert}Type1..5Number` | 20 | varchar(255) — **counts as text** |
| `{student,professor,executive,expert}TypeCount` | 4 | text |
| `grandTotal{Student,Professor,Executive,Expert,All}` | 5 | varchar(255) |
| `grandTotalETC` | 1 | **int(11)** — the one numeric total |
| `grandTypeETC` | 1 | text |
| `id`, `id_projects`, `codeclub`, `yearly_countsketch` | 4 | |

Capacity: **5 rows per attendee type.** Totals are stored, not computed — so they can and do
drift from their components.

### `p_indicator` — 25 cols (line 1001)

`expresult1..5`, `quality1..5`, `volume1..5` (text ×15); `is_1follow..is_4follow` (tinyint),
`is_etcfollow`, `etcfollow`; plus `id`, `id_projects`, `codeclub`, `yearly_countsketch`.
Capacity: **5 indicator rows.**

### `p_finalbudget` — 7 cols (line 868)

`id`, `id_projects` (**int**), `listSSA`, `listSSB`, `listSSC` (varchar(255)),
`listSAll` (varchar(255)), `refundtotal` (text).

This is the whole กนศ.06 budget: **four aggregates and a refund**. There are no line items.
Plan-vs-actual comparison at line granularity is impossible against this table — which is
exactly what Q13 changes. Note it carries `listSSB` but **not** `listSSBT`/`listSSBNT`,
so it does not even mirror `p_budget`'s own subtotal set.

### `netprojectbudget` — 8 cols (line 206)

`id` bigint unsigned; `project_name` (text), `responsible_agency` (text), `yearly` (text),
`campus` (text), `net_budget` (text), `allow_budget` (text), `createdAt` (timestamp).

The annual plan line. **It has no `AgnecyGroupName` / club column** — which is the evidence
behind Q31's allocation grain of `(responsible_agency, campus, yearly)`. It links to a
project *by matching `project_name` as a string* (Q27).

### `logstudentgetmoney` — 9 cols (line 175)

`id`, `id_projects` (varchar(12)), `project_name` (text), `yearly` (text),
`namestudent_receive`, `numberstudent_receive`, `namestuact_receive`,
`remainingBudget` (all varchar(255)), `updated_at` (datetime).

`numberstudent_receive` is the **amount disbursed** (e.g. `'300000'`) and
`remainingBudget` is the running balance — stored **with thousands separators**
(`'297,000'`, `'265,000'`). Both are strings. This is the table Q41 proposes to harden into
the append-only ledger.

### `status_project` / `logstatus_project` — 8 / 7 cols (lines 1323, 103)

Same column set (`id`, `id_projects` varchar(12), `project_name`, `codeclub`,
`project_phase`, `updated_at`, `editor_name`); `status_project` adds `createdAt`.
`status_project` is meant to hold the *current* phase, `logstatus_project` the *history* —
but `projects.project_phase` holds the current phase too, so it is stored in two places.
Q15 collapses all of this into one append-only `project_event` log.

### `historyeditproject` — 8 cols (line 30)

`id_history`, `id_projects` (text), `id_student` (text), `codeclub` (text),
`editpage` (text — a **Thai UI page name**, e.g. `'ข้อมูลพื้นฐานโครงการ'`),
`countedit` (text), `edit_at` (date), `edit_time` (timestamp).

Records *that* a page was edited and a running edit count — **not what changed**. `edit_at`
is `'0000-00-00'` in every row; only `edit_time` is real.

### `users` — 23 cols (line 1412)

`id`, `id_student` varchar(100), `name_student`, `prefix`, `email`, `Phone`,
`account_type`, `position`, `department`, `campus`, `clubName`, `ClubGroup`, `WorkGroup`,
`agencyGroupName`, `AgencyAdvisor`, `codedivision`, `codeagency`, `codeworkgroup`,
`codebooksome`, `codebooksomeoutyear`, `yearly` int(11), `LEVEL_DESC`, `STU_STATUS_DESC`.

`account_type` ∈ {`students`, `personel`} is the **ICIT identity type**.
`position` ∈ {`SH`, `Admin`, `Stuact`, `AD`} is the **application role**.
`LEVEL_DESC` / `STU_STATUS_DESC` are passed through from ICIT.
**No password column exists** — consistent with SSO-only authentication.

### `p_addfile` — 6 cols (line 398)

`id`, `id_projects` (**int**), `codeclub`, `yearly_countsketch` (int), `filename`, `filepath`.
`filepath` is stored; Q21 requires it become relative and be served behind authorization.

### `login` — 4 cols (line 83)

`id`, `id_student` varchar(20), `is_success` tinyint(1), `last_login` datetime.
One row in the dump. Kept under Q15.

---

## Cross-cutting defects

Confirmed against the DDL and the data. Items 1–7 restate `DECISIONS.md:72-87`; items 8–11
are **new findings from this extraction**. Items 5–7 were the last three carried over
unverified — they have now been checked against the source and **all three were wrong in
detail**, each understating the problem. The corrections are inline below and the full
tracing is in `business-rules.md`.

1. **Money is text.** `projects.net_budget/allow_budget/use_budget`,
   `netprojectbudget.net_budget/allow_budget`, `logstudentgetmoney.remainingBudget`,
   `p_budget.listSAll` and every `list*` cell, `p_finalbudget.*`, `refundtotal` — all
   `text`/`varchar`. Values in the dump contain **thousands separators** (`'297,000'`,
   `'1,000,000'`), so they are not even parseable as numbers without stripping. Arithmetic
   comparison is impossible in SQL. This is the single hardest blocker to budget enforcement.

   **Root cause identified.** The commas are not a data-entry artifact — the frontend
   *generates* them. `CSD_budget.js:554` computes the line total and immediately calls
   `.toLocaleString("en-US")` on it, then posts the **formatted string** to the API, which
   stores it verbatim. Every derived money value in the database is a display string.
   The migration must strip separators, and must do so knowing the locale is `en-US`
   (comma = thousands, period = decimal), not a Thai locale.

   **Corollary — money is integer-truncated.** The same computation uses `parseInt` on all
   three operands (`CSD_budget.js:552-553`). Any fractional baht a user typed was discarded
   before storage, and a value like `"1,500.75"` would `parseInt` to `1`. Q37's conversion to
   `DECIMAL(12,2)` should therefore expect whole-baht data, and any value with a decimal part
   is a red flag worth reporting rather than silently converting.

2. **`id_projects` has three different types across tables** — worse than the two recorded
   at `DECISIONS.md:78`:
   - `int(11)` — `p_addfile`, `p_finalbudget`, `p_finalperson`, `p_indicator`, `p_person`, `p_timestep`
   - `varchar(12)` — `logstatus_project`, `logstudentgetmoney`, `status_project`
   - `text` — `historyeditproject`, `p_budget`

   It also means **two different things**: in the child tables it is `projects.id` (a row id),
   while `varchar(12)` matches the width of `project_number` (the business key). In the dump's
   data, however, the `varchar(12)` columns hold **row ids** (`'864'`, `'579'`), not 12-char
   codes — so the column type documents an intent the data does not follow.

3. **No unique constraint on `users.id_student`** — the only key is PK `id`.

4. **`netprojectbudget` joins on `project_name` (text).** Renaming a project silently detaches
   its budget line.

5. **Client-supplied scope — verified, and far wider than recorded.** `stuactRoutes.js:7-8`
   does read `AgnecyGroupName` straight from the URL path. But the real finding is that
   `req.user` is **never read for an authorization decision anywhere in the backend** — the
   only two references are `verifyToken` assigning it (`middleware/verifyToken.js:21`) and an
   admin health-check echoing it (`adminRoutes.js:18`). Every scope in every query comes from
   a client-supplied path parameter. See `business-rules.md` → "Authorization" for the route
   inventory and the reason the JWT could not carry a role even if a route wanted one.

6. **Mass assignment — verified, 14 sites, not one.** `UPDATE … SET ?` with `req.body` passed
   whole is the house style for every edit endpoint: `studentRoutes.js:433`, `:451`, `:551`,
   `:567`, `:688`, `:704`, `:729`, `:1474`, `:1507`, `:2531`, `:2570`, `:2639`, `:2692`,
   `:2701`. The `p_person` case recorded in `DECISIONS.md:84` is `studentRoutes.js:451`.
   Because `projects` is one 117-column row, `studentRoutes.js:433` alone lets a client write
   `project_number`, `project_phase`, `allow_budget` and `codeclub` on any project id.

7. **Project number generated client-side — verified, but in a different file, and the
   mechanism is worse than "concurrent submissions collide".** The generator is
   `ProjectDocument.js:89-123`, not `CSD_detail.js`. `CSD_detail.js:369-398` generates the
   *draft* sequence `yearly_countsketch`; the official `yearly_count` and `project_number` are
   issued later, at the approval transition. Both are read-then-write races over an
   unconstrained column. Full mechanism and the resulting duplicate-number defect:
   `business-rules.md` → "Numbering". This also **closes open question 1** below.

8. **NEW — no foreign keys at all, and almost no indexes.** Only 5 secondary indexes exist,
   all `KEY (id_projects)`. `projects.project_number`, `projects.codeclub`, `users.id_student`
   and every log table's `id_projects` are unindexed despite being the application's primary
   lookup paths.

9. **NEW — dangling references.** `projects` contains **30 rows, max `id` = 824**
   (`AUTO_INCREMENT=825`). But `logstatus_project` references `id_projects` values
   **864, 865, 872, 874, 876, 878, 880, 882, 883, 884, 886, 890, 896, 899, 900, 901** — all
   beyond any existing project. `status_project` likewise holds ~63 phase rows for 30
   projects. So the history tables **outlive the projects they describe**, and the dump is
   not internally consistent. The migration must decide explicitly whether to drop orphaned
   log rows or preserve them detached; it cannot assume referential integrity.

10. **NEW — totals are stored, not derived,** in `p_person`/`p_finalperson`
    (`grandTotal*`), `p_budget` (`listSS*`, `listSAll`), and `logstudentgetmoney`
    (`remainingBudget`). Every one of these can drift from its components, and none is
    protected by a constraint.

11. **NEW — every date is stored twice**, once typed and once as a pre-rendered Thai string
    (`projects`: 5 pairs; `p_timestep`: 15 pairs). Presentation is baked into storage.

---

## Data profile

Row counts are from the dump's `INSERT` statements. The dump is **small and clearly a
development snapshot**, not production.

- `projects`: **30 rows**, max `id` 824.
- `netprojectbudget`: 7 rows — and **5 of the 7 have `allow_budget` = NULL**. Only one row
  (`'โครงการ 3 K'`) has both `net_budget` and `allow_budget` populated.
- `logstudentgetmoney`: 7 rows.
- `login`: 1 row.
- `historyeditproject`: 31 rows.

### Correction to `DECISIONS.md` — the phase counts are wrong

`DECISIONS.md:103-105` reports the live phase distribution as
`ร่างคำขออนุมัติ(73) → ดำเนินการขออนุมัติ(22) → โครงการอนุมัติ(14) → เงินโครงการอนุมัติ(13) →
ร่างสรุปผลโครงการ(12) → ดำเนินการสรุปผล(3) → ปิดโครงการ(4)`.

Those numbers are **occurrence counts summed across three tables**, not project counts. They
cannot be project counts — there are only 30 projects. Broken out:

| Phase | `projects` | `status_project` | `logstatus_project` | Sum |
| --- | ---: | ---: | ---: | ---: |
| `ร่างคำขออนุมัติ` | 19 | 54 | 0 | **73** |
| `ดำเนินการขออนุมัติ` | 2 | 2 | 18 | **22** |
| `โครงการอนุมัติ` | 1 | 1 | 12 | **14** |
| `เงินโครงการอนุมัติ` | 2 | 2 | 9 | **13** |
| `ร่างสรุปผลโครงการ` | 3 | 3 | 6 | **12** |
| `ดำเนินการสรุปผล` | 0 | 0 | 3 | **3** |
| `ปิดโครงการ` | 1 | 1 | 2 | **4** |

The sums match the recorded figures exactly, which confirms the arithmetic.

**What this changes and what it does not:**

- **Unchanged — the conclusion of Q40 still holds.** All seven phases are genuinely in use
  (each appears in real rows), and the four `รอ…` states appear **zero** times anywhere.
  Dropping them remains correct.
- **Changed — `ดำเนินการสรุปผล` is a transient state.** It occurs 3× in the transition log
  and **never as a current phase** on any project. It is passed through, not rested in.
- **Changed — the real current-phase distribution** across 30 projects is:
  `ร่างคำขออนุมัติ` 19, `ร่างสรุปผลโครงการ` 3, `ดำเนินการขออนุมัติ` 2,
  `เงินโครงการอนุมัติ` 2, `โครงการอนุมัติ` 1, `ปิดโครงการ` 1, and **2 rows with no phase**.
- **Changed — `status_project` holds 63 phase rows for 30 projects**, so it is not the
  single-current-status table it is named as. Reinforces Q15.

---

## Open questions

Carried forward for the next Phase 0 document to resolve.

**Resolved during this extraction** (kept for the record):

- ~~`p_budget` prefix semantics are undecoded.~~ **Closed** — decoded against
  `CSD_budget.js`; see the `p_budget` section. `list`/`N`/`NN`/`T`/`TN`/`TP` are
  description / qty1 / unit1 / qty2 / unit2 / unit-price, and `S` is the derived line total.
- ~~`listTNBT1..20` is an orphan family of the wrong width.~~ **Closed** — it is BT's
  second unit-label column, correctly 20 wide, declared at `CSD_budget.js:589`.

**Resolved by `template-contract.md`:**

- ~~What are the expense categories `A`/`BT`/`BNT`/`C`?~~ **Closed** — the form names them:
  `A` = `หมวดค่าตอบแทน` (remuneration), `BT`+`BNT` = `หมวดค่าใช้สอย` (operating expenses),
  `C` = `หมวดค่าวัสดุ` (materials). The form prints **three** categories; the database splits
  B in two.
- ~~`p_finalbudget.listSSB` — a subtotal of what?~~ **Closed** — `listSSB = BT + BNT`. It is
  emitted immediately after the BNT block closes. Correspondingly, **`listSSBT` and
  `listSSBNT` appear in neither template and are dead columns.**
- ~~`is_1basic..is_4basic` (4) vs the 5 recorded in `DECISIONS.md:119`.~~ **Closed** — both
  the template and the database have **four**. The decision record is off by one.

**Resolved by `business-rules.md`:**

- ~~`yearly_countsketch` vs `yearly_count`.~~ **Closed** — they are two different sequences
  issued at two different moments. `yearly_countsketch` is the **draft** sequence, assigned to
  every project the instant it is created (`CSD_detail.js:369-398`); `yearly_count` is the
  **official** sequence, assigned only when the project reaches `โครงการอนุมัติ`
  (`ProjectDocument.js:89-123`), and `project_number = codeclub + yearly_count`. The dump
  agrees: all 30 projects carry a `yearly_countsketch`, and exactly the 6 that were approved
  carry a `yearly_count` and a non-empty `project_number`. Child tables join on the draft
  sequence because it is the only one that exists while the กนศ.04 is being filled in.

**Still open:**

1. **Orphaned log rows** (defect 9) — drop or preserve detached? A migration decision.
2. **`listETC` / `listSETC`, `volume2..5`, `quality1..5`** — stored by the UI, printed by
   neither template. Dead data, or an unfinished form? See `template-contract.md`.
3. **`p_budget` capacity exceeds the form's.** `BT` holds 20 rows in the database but the
   template prints only **12**. Today's behaviour is silent truncation. See
   `template-contract.md` → "Arity".
