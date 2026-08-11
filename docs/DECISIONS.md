# DMS Rebuild — Decision Record

**Status**: Design settled, implementation not started
**Last updated**: 2026-08-12
**Supersedes**: `DMS_REBUILD_STRATEGY.md` (kept for reference, but its premises are wrong — see "Why the strategy doc is obsolete")

---

## How to use this file

This is the durable record of a design session that stress-tested `DMS_REBUILD_STRATEGY.md`
against the real codebase. **Read this before touching `DMS_REBUILD_STRATEGY.md`** — that
document was written from an inaccurate analysis and every one of its core premises turned
out to be false.

If you are an agent resuming this work with no prior context: read this file top to bottom,
then read the source material listed below. Do not trust the old strategy document, and do
not trust the old repo's `README.md`.

---

## Source material (absolute paths)

| What | Path |
| --- | --- |
| **Canonical old system** (backend + frontend + git history) | `C:\Users\pongk\OneDrive\เอกสาร\GitHub\Student-activity-system-DMS` |
| **Database dump** (15 tables, sample data) | `…\Student-activity-system-DMS\backend\backup\usersystem.sql` |
| Old backend routes | `…\Student-activity-system-DMS\backend\src\` |
| Word templates (กนศ.04 / กนศ.06) | `…\backend\src\templateDoc\temp04.docx`, `temp06.docx` |
| Org taxonomy source (seed data) | `…\Student-activity-system-DMS\frontend\src\views\setcode.json` |
| Thesis / design docs, ER diagrams | `C:\Users\pongk\OneDrive\เดสก์ท็อป\งาน Dev\Dev KMUTNB\DMS_Fullversion\` |
| Original table design notes | `…\DMS_Fullversion\paper old ver\Table *.txt`, `TABLE login.txt` |
| Project code format spec (PDF, unread — no PDF renderer available) | `…\paper old ver\เอกสารกำหนดรหัสโครงการกิจกรรมนักศึกษา.pdf` |
| **New build target** | `C:\Users\pongk\OneDrive\เดสก์ท็อป\งาน Dev\Dev KMUTNB\DMS_c` (currently only docs) |

Duplicates that are **not** separate systems — ignore them, they are copies:
`Desktop\New folder\` = a copy of `backend/src`; `งาน Dev\ribbon_flowers\dms_stuact_frontend` = a copy of `frontend/`.

---

## Why the strategy doc is obsolete

`DMS_REBUILD_STRATEGY.md` describes a 5-phase, ~6-hour rebuild from copy-paste prompts. Its
five load-bearing premises are each contradicted by the code:

| Strategy doc claims | Reality |
| --- | --- |
| 3 tables (`projects`, `budget`, `users`) | **15 tables, ~843 columns** |
| `POST /auth/login` with email + password + bcrypt | **ICIT SSO** + `.env` admin fallback; no password store |
| Flat status: Draft / In Review / Approved / Executing | **Multi-state Thai phase machine** (7 live states) |
| One generic `template.docx` | **Two government forms**, temp04 has **1,426 tags** |
| ~6 hours total | **Weeks.** See "Effort" below. |

---

## Facts established (verified against source)

### Schema shape — `usersystem.sql`

| Table | Columns | Notes |
| --- | --- | --- |
| `projects` | 117 | denormalized: `objective1..5`, `person1_name`… |
| `p_budget` | **382** | the budget matrix, one row per project |
| `p_timestep` | 129 | timeline, numbered columns |
| `p_person` / `p_finalperson` | 55 / 55 | `executiveType1Name`, `executiveType1Number`… |
| `p_indicator` | 25 | |
| `users` | 23 | |
| `logstudentgetmoney` | 9 | money disbursement ledger |
| `netprojectbudget` | 8 | annual budget **plan lines** |
| `historyeditproject`, `logstatus_project`, `status_project`, `login`, `p_addfile`, `p_finalbudget` | 4–8 | audit / support |

**Critical defects found in the existing schema:**

1. **Money is stored as `text` / `varchar(255)`** — `net_budget`, `allow_budget`,
   `remainingBudget`, `listSAll`, `refundtotal`. `yearly` is `text` too. Strict budget
   enforcement is impossible on string columns. This is why the redesign is required, not optional.
2. **`id_projects` means two different things** — `varchar(12)` (the project *number*) in
   `status_project` and `logstudentgetmoney`, but `int(11)` (a row id) in `p_finalbudget`.
3. **No unique constraint on `users.id_student`** — `karoms` appears 3× (ids 23, 24, 26).
4. **`netprojectbudget` joins on `project_name` as a string** — rename a project and it
   detaches from its own budget line.
5. **Client-supplied scope** — `stuactRoutes.js` takes `AgnecyGroupName` from the URL path,
   so any user can read any club's projects by editing the URL. **Cross-club data leak.**
6. **Mass assignment** — `UPDATE p_person SET ? WHERE id_projects = ?` passes the request
   body straight into SET; a client can write any column.
7. **Project number generated client-side** — `CSD_detail.js` SELECTs the latest project,
   computes `yearly_count + 1`, and posts it. Concurrent submissions collide.

### Roles

- `users.account_type` = `students` | `personel` — the **ICIT identity type** (mirrors ICIT scopes `student,personel`). Not the app role.
- `users.position` = `SH` | `Admin` | `Stuact` | `AD` — **this is the application role.**
  (SH = student, AD = adviser.)

### Auth — `backend/src/login.js`

Authenticates against **ICIT SSO** (`ICIT_AUTHENTICATION`, bearer token, `scopes: "student,personel"`),
signing the returned `userInfo` into a JWT. Plus a local admin fallback via `ADMIN_USERNAME` /
`ADMIN_PASSWORD` in `.env`. There is no password store and no bcrypt anywhere.

### Phase machine — live values from the dump

7 states in use:
`ร่างคำขออนุมัติ`(73) → `ดำเนินการขออนุมัติ`(22) → `โครงการอนุมัติ`(14) →
`เงินโครงการอนุมัติ`(13) → `ร่างสรุปผลโครงการ`(12) → `ดำเนินการสรุปผล`(3) → `ปิดโครงการ`(4)

The frontend also checks `รออนุมัติโครงการ`, `รออนุมัติ`, `รอเงินโครงการอนุมัติ`,
`รอสรุปผลโครงการ` — **zero rows each. Decision: dropped (Q40).**

Maps onto the two-document lifecycle: states 1–3 = กนศ.04 proposal, 4 = disbursement,
5–6 = กนศ.06 final report, 7 = closed.

### Word templates

`temp04.docx`: **1,426 unique tags** — 433 plain fields, ~780 section tags. Not loop-shaped;
**flat and fixed-arity**:

- `objective1..5`, `principles_and_reasons1..5`, `location1..5`, `project_type1..5`, `expresult1..5`, `topic_table1..5`, `problem1..3`
- checkbox banks: `is_SDGs_1..17`, `is_5p2p1_1..9`, `is_5p2p3_1..7`, `is_5p2p2_1..6`, `is_5p1_1..4`, `is_1..5side`, `is_1..5basic`, `is_1..4follow`
- Gantt expanded inline: `{#startM1 <= 1 && endM1 >= 1}` ×12 months per row
- budget matrix: ~22 tag families — `list{S,N,NN,T,TP}{A,C,BT,BNT}`; category row counts A=15, BT=20, BNT=10, C=20, plus `ETC`; subtotals `listSSA`/`listSSBT`/`listSSBNT`/`listSSC`; grand total `listSAll`

`temp06.docx`: 241 tags, reuses the SDG and `5p2*` banks.

**Requires `expressionParser` (angular-expressions)** — the templates embed JS expressions.
The strategy doc's `package.json` omits it.

Render call to port: `studentRoutes.js:~1174` —
`doc.render({detail, person, timestep, indicator, budget, user, userSH})`.
temp04 used at `studentRoutes.js:1169`, temp06 at `:1332`.

### Project number format — confirmed against live data

Assembled in `TableAddPersonel.js:160-166` and `CSD_detail.js`:

```
campus.substring(0,1)              // "Bangkok" → "B"      1 char
+ yearly                           // "67"                  2
+ codedivision.replace(/\D/g,"")   // "D04" → "04"          2
+ codeagency.replace(/\D/g,"")     // "A101" → "101"        3
+ codeworkgroup.replace(/\D/g,"")  // "G01" → "01"          2
                                   // = codeclub,          10 chars
+ yearly_count.padStart(2,"0")     //                       2
                                   // = project_number,    12 chars  (matches VARCHAR(12))
```

Verified: `B670410100` = `B` + `67` + `04` + `101` + `00`.
A `codebooksomeoutyear` variant substitutes `"yy"` for the year.

### Org taxonomy — `setcode.json`

Division `D01`–`D12` → Agency `A001`…`A421` → WorkGroup `G01`–`G10`.
`D01`–`D05` are org units; **`D06`–`D12` are student award categories**, not agencies.
Campus appears three inconsistent ways: nested inside `D04` (Bangkok/Prachin/Rayong), as a
separate column, and encoded as workgroups (`D01/A001/G07`, `G08`).
Known data typos: `วิศวกรรมเตมี`→`เคมี`, `เทคโนโลยรสารสนเทศ`, `ปราจียนบุรี`→`ปราจีนบุรี`,
`ฝรั่งเศษ`→`ฝรั่งเศส`, and `G09: "ภาควิชา(ในเอกสารซ้ำ)"` is a placeholder.

### Old frontend screens (the real feature inventory)

`AllProject`, `Dashboard`, `ProjectDocument`, `NewProjectDocument`, `DetailBudget`
(+ Admin/Student variants), `DAddSplitBudget`, `DTableAddBudget`, `TableAdd/ListStudent`,
`TableAdd/ListPersonel`, `Login`, `UserProfile`, `ArrowProgressBar`.
Layouts: Admin, Student, Adviser, Stuact, Guest.
Stack: CRA + Bootstrap 4/reactstrap + React Router **v5** + `AuthContext` + sweetalert2.

---

## Decisions

### Process

| # | Decision |
| --- | --- |
| Q1 | Convert to an **executable spec** for Claude Code. Strip the copy-paste-prompt framing. |
| Q2 | Old code is the **authoritative behavioral spec**, but a rules-**extraction step comes first**. |
| Q22 | Security defects are **fixed and listed** as deliberate deviations — never fixed silently. |
| Q23 | Phase 0 produces `docs/`: `domain-model.md`, `schema-current.md`, `schema-target.md`, `business-rules.md` (with `file:line` citations), `template-contract.md`. Then rewrite the strategy doc against them. |

### Auth & identity

| # | Decision |
| --- | --- |
| Q3 | **Mock auth first** (no ICIT API access yet), behind an env-swappable seam. |
| Q17 | `AuthProvider` interface; `AUTH_PROVIDER=mock\|icit`. Mock returns ICIT's real shape (`userInfo` + `studentInfo`). Provider supplies **identity only**; **role comes from `users.position`**. `.env` admin backdoor kept but gated to non-production. Mock seeds one user per role with realistic `codeclub`/`yearly`. |

### Data model

| # | Decision |
| --- | --- |
| Q4 / Q7 | Schema **redesigned and normalized**; templates untouched; a dedicated **assembler** flattens domain objects into the ~433-field template payload. Keep `expressionParser`. |
| Q8 | Arity caps are **template limits, not domain limits** — DB uncapped, assembler validates and errors clearly when a project exceeds what the form can hold. |
| Q13 | `p_budget`'s 382 columns → **`budget_line` rows**; subtotals computed, not stored. กนศ.06 **gains line items** (it currently stores only aggregates) so plan-vs-actual comparison is possible. |
| Q19 | Same normalization for personnel / timeline / indicators. **Store real dates; derive the Gantt's `startM`/`endM`.** Drop the stub-insert-then-bulk-update pattern. |
| Q34 | `setcode.json` **seeds `division`/`agency`/`work_group`/`club` tables**, served from the API. Keep the JSON in-repo as the seed source. |
| Q35 | **Split** `D06`–`D12` (award categories) from `D01`–`D05` (org units). |
| Q36 | **Campus becomes a column** on every org unit; flatten `D04`'s nesting; fix taxonomy typos during seed and log them. |
| Q37 | Money columns → **`DECIMAL(12,2)`**. Migration **reports every unparseable value** rather than coercing to 0. *(recommended; not explicitly confirmed)* |
| Q38 | **Surrogate `int` PK everywhere** for joins; `project_number` as a separate unique business key. *(recommended; not explicitly confirmed)* |

### Lifecycle

| # | Decision |
| --- | --- |
| Q6 | **กนศ.04 → กนศ.06 duality is in v1**; the data model carries both from day one. |
| Q14 | Thai phase strings → **stable codes with a Thai label map**, data migrated. |
| Q40 | **Drop the four unused `รอ…` states.** The machine has **7 states**. |
| Q15 | One **append-only `project_event` log** replaces `historyeditproject` + `logstatus_project` + `status_project`'s duplicate current-status. Keep login logging. |

### Budget enforcement

| # | Decision |
| --- | --- |
| Q20 / Q25 | **Strict enforcement**, three layers: (a) project request ≤ its plan line's `allow_budget`; (b) final spend ≤ approved, with `refundtotal`; (c) **new per-agency yearly allocation ceiling**. |
| Q27 | Replace the `project_name` string join with a **real FK**. One plan line ↔ one project. |
| Q26 | **Warn** on draft submit; **hard-block** at `โครงการอนุมัติ`, `เงินโครงการอนุมัติ`, `ดำเนินการสรุปผล`; **re-check on every budget write**, not only on transitions. Reject edits that would push an approved project over. |
| Q28 | Check and commit **in one transaction**; approved amounts written as **immutable ledger rows** so "remaining" is a sum over committed rows. |
| Q41 | Build that ledger on the existing **`logstudentgetmoney`** rather than a parallel structure. Add FK, convert `remainingBudget` to DECIMAL, make it append-only. *(recommended; not explicitly confirmed)* |
| Q30 | **Admin and STUACT** both enter allocations. Adviser/Student read-only. |
| Q31 | Allocation grain: **`(responsible_agency, campus, yearly)`**. (Confirmed by the dump — `netprojectbudget` has no `AgnecyGroupName`.) |
| Q32 | **Two separate checks** — plan-level and commitment-level — with distinct error messages. |
| Q33 | Lowering an allocation below committed spend is **allowed with a loud warning**, surfaced on the STUACT dashboard. Not rejected. |

### Identifiers

| # | Decision |
| --- | --- |
| Q18 / Q29 | Format as confirmed above. **Generated server-side inside a transaction**, unique constraint on `(codeclub, yearly, yearly_count)` so collisions fail loudly. |

### Access control

| # | Decision |
| --- | --- |
| Q16 | **Scope comes from the JWT, never from URL params.** Fixes the cross-club leak. |
| Q21 | Attachments stay on local disk, served **only through an authorization check**; store relative paths. |
| Q39 | **One role per user.** The duplicate `karoms` rows are dirty data — de-duplicate during migration, add unique constraint on `id_student`. |

### Frontend & scope

| # | Decision |
| --- | --- |
| Q5 | Adviser-as-viewer is existing parity (one screen). The **review queue is new scope**, split out — rebuild the three existing roles to parity first. |
| Q9 | The old frontend is the **behavioral spec**; rebuild fresh in the new stack. Its real screens replace Phase 2's invented component list. |
| Q11 | **Thai UI copy**, English code identifiers, **no i18n framework** in v1. |
| Q10 | **Monorepo in `DMS_c`**; `git init` before Phase 1 writes a single file. |

---

## Deliberate deviations from old behavior

Required by Q22 — each is an intentional departure, not a porting bug:

1. Club scope from token, not URL — **fixes a cross-club data leak**
2. No mass assignment (`UPDATE … SET ?`) — **fixes arbitrary column writes**
3. Project number generated server-side in a transaction — **fixes duplicate codes**
4. Plan-line FK replaces `project_name` string matching
5. Budget enforcement added (did not exist before)
6. Phase codes replace Thai string keys; four unused `รอ…` states dropped
7. Taxonomy typos corrected during seed
8. Attachment downloads authorized
9. One role per user; duplicate user rows de-duplicated
10. Money columns converted from text to `DECIMAL(12,2)`

---

## Open items

- **Q37, Q38, Q41** — recommended and not objected to, but never explicitly confirmed. Re-confirm before implementing.
- **Q35** — assumed `D06`–`D12` are project classifications. Never verified against a workflow; only the codes were visible.
- **Agency allocation has no historical data.** Allocations start empty; staff enter the first year by hand.
- **The code-format PDF was never read** (`เอกสารกำหนดรหัสโครงการกิจกรรมนักศึกษา.pdf`) — no PDF renderer on this machine. The format was derived from code and verified against live data instead, so this is low-risk, but the PDF may document rules the code doesn't implement.

---

## Effort

**The strategy doc's ~6 hour estimate is dead.** Phase 0 extraction is real work on its own;
the assembler is ~433 field mappings; the migration moves live data out of denormalized
columns across 843 columns; budget enforcement is a subsystem that does not exist yet; the
frontend is ~20 screens. Plan in **weeks**.

---

## Next steps

1. `git init` in `DMS_c` (Q10) — before any code is written.
2. Phase 0: produce the five `docs/` files (Q23). `schema-current.md` is now a straight
   **extraction** from `usersystem.sql`, not a reconstruction.
3. Re-confirm the open items above.
4. Rewrite `DMS_REBUILD_STRATEGY.md` against the extracted docs.
5. Only then start building.
