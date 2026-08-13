# DMS Rebuild — Decision Record

**Status**: Design settled, implementation not started
**Last updated**: 2026-08-12
**Relationship to `DMS_REBUILD_STRATEGY.md`**: that file has been **rewritten** against these docs and is now the build plan — what to build and in what order. This file remains the record of *why*. The section "Why the strategy doc is obsolete" below refers to its **original** version (commit `b8c7d31`) and is kept as the reason the rewrite was needed.

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

> **Correction (2026-08-12, Phase 0).** `netprojectbudget` is **one plan line per project**,
> not an annual allocation — see `domain-model.md` → "Money". The per-agency yearly ceiling
> Q20/Q25 requires does not exist in the current schema in any form.

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

> **Correction (2026-08-12, Phase 0).** Items 5–7 above were recorded from a first pass and
> have now been verified line by line. **All three were understated**, and item 7 named the
> wrong file:
>
> - **5** — the path parameter is real (`stuactRoutes.js:7-8`), but the deeper fact is that
>   `req.user` is never used for an authorization decision *anywhere* in the backend, so every
>   route is scoped by client input. The token also cannot carry a role: `server.js:110` reads
>   `position` off the ICIT response, where it does not exist, so every real account is signed
>   as `role: "user"`.
> - **6** — not one endpoint but **14** `UPDATE … SET ?` sites. On `projects` (117 columns)
>   this exposes `project_number`, `project_phase` and `allow_budget` to any caller.
> - **7** — the generator is `ProjectDocument.js:89-123`, not `CSD_detail.js`. There are two
>   sequences: `CSD_detail.js:369-398` issues the draft `yearly_countsketch` at creation, and
>   `ProjectDocument.js` issues the official `yearly_count` / `project_number` at approval.
>   The collision is worse than a race — the maximum is scoped by `project_name`, so two
>   differently-named projects in one club deterministically receive the same number.
>
> Full tracing: `business-rules.md`. This also closes the `yearly_countsketch` vs
> `yearly_count` question left open in `schema-current.md`.

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

> **Correction (2026-08-12, Phase 0).** Those counts are **occurrences summed across three
> tables** (`projects` + `status_project` + `logstatus_project`), not project counts — the
> dump holds only **30 projects**. The state list and the Q40 decision are unaffected (all 7
> states appear in real rows; the four `รอ…` states appear zero times), but note that
> `ดำเนินการสรุปผล` **never appears as a current phase** — it is transient, seen only in the
> transition log. Full breakdown: `schema-current.md` → "Correction to DECISIONS.md".

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

Render call to port: `studentRoutes.js:1179` —
`doc.render({detail, person, timestep, indicator, budget, user, userSH})`.
temp04 used at `studentRoutes.js:1169`, temp06 at `:1332`.

### Project number format — confirmed against live data

Assembled in `TableAddPersonel.js:162-168` (the club code, stored as `users.codebooksome`,
copied onto `projects.codeclub` at `CSD_detail.js:341`) and completed at
`ProjectDocument.js:105`:

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

### Org taxonomy — `setCode.json`

Division `D01`–`D12` → Agency `A001`…`A421` → WorkGroup `G01`–`G10`.
`D01`–`D05` are org units; **`D06`–`D12` are student award categories**, not agencies
(verified — see the Q35 entry under "Open items").
The `Agency` level has **four different shapes** across the divisions; see
`domain-model.md` → "The organisation".
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
| Q2 | Old code is the **authoritative behavioral spec**, but a rules-**extraction step comes first**. **Narrowed 2026-08-14 by the project owner** — see below. |
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

## How far Q2 reaches — settled by the owner, 2026-08-14

The project owner wrote the original system themselves, and has said plainly that they were
still learning at the time. Their instruction: **anything that looks unsafe or oddly written
may be changed, including variable and identifier names, without asking each time.**

So Q2 governs **what the system does** — the seven-phase machine, the numbering format, the
budget rules, what the government forms must contain. It does **not** make the old code's
*shape* authoritative. Bad names, unsafe patterns, and structures that exist only because of
how the original was written are replaceable on sight.

Two limits remain, and they are not the owner second-guessing the work:

1. **Behavioural deviations are still listed, never silent** (Q22 — the list below). "The code
   reads better now" needs no entry; "the system now refuses something it used to allow" does.
2. **Changes to what a *user of the system* experiences are still worth raising**, because the
   owner knows the process and the university's requirements in a way the code never stated.
   Renaming `AgnecyGroupName` needs no discussion; changing who may approve a project does.

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
11. **The token carries no role.** The old system signed one (`server.js:107`) and never
    checked it; a signed role is also stale the moment a membership changes. Scope is resolved
    from `membership` on every request instead — **fixes a role that was decorative**
12. **A broken identity provider is a 502, not a 401.** The old client could not tell the two
    apart — **stops an SSO outage being reported to students as a wrong password**
13. **Routers are mounted once, and no route is defined outside a router.** Removes the
    duplicate root mount (`server.js:23-25`) and the unauthenticated inline group
    (`server.js:158-376`) by construction, not by remembering to add `verifyToken`
14. **Edit rights exist at all.** The old system let any token edit any project in any phase.
    The rule now enforced is an assumption, written out under "Phase 2 close-out → Editing
    rights" and awaiting confirmation — **fixes unrestricted editing**
15. **An out-of-scope read answers 404, not 403.** A 403 would confirm that a project with
    that id exists in a club the caller may not see — **closes the cross-club leak's last form**
16. **Ordinals are assigned server-side** from array position, never accepted from the client:
    a client-chosen ordinal decides which box a line prints in on a government form
    (`docs/template-contract.md`), so it is not the client's to choose

---

## Open items

- **Academic year boundary — new, opened 2026-08-13 by the auth seam.** Roles are scoped by
  `membership.academic_year`, so resolving a role requires knowing which academic year "now"
  belongs to. The old system stored it per user (`users.yearly`) and initialised it to a
  literal `2667` in one place, so **there is no rule to port**. `src/config.js` derives it as
  "a new Buddhist-era year starts in June" and lets `ACADEMIC_YEAR` override it; the override
  is what development actually uses. **Someone who knows the university calendar should
  confirm the June boundary** — and separately, whether a person's memberships should really
  vanish at the rollover or carry forward until re-enrolled.
- **Editing rights — new, opened 2026-08-13 by Phase 2.** Who may edit a project, and in which
  phases, had no answer in the old system. The rule now implemented is written out under
  "Phase 2 close-out → Editing rights"; it needs confirmation from someone who runs the
  process, and it is cheap to change because it lives in one file.
- **Q37, Q38, Q41** — recommended and not objected to, but never explicitly confirmed. Re-confirm before implementing.
- ~~**Q35** — assumed `D06`–`D12` are project classifications.~~ **Closed by `domain-model.md`.**
  Their `name` fields in `setCode.json` name *students*, not units or projects
  (`ผู้นำองค์กรนักศึกษา…`, `นักศึกษาที่มีความประพฤติดีเด่น`, …). They are **student award
  categories**. The split is correct; they belong in an `award_category` table. No project
  references them and no code path reads them, so they are seed data for a feature that does
  not exist yet — build nothing until someone confirms it is wanted.
- **The entire dump is mock data (confirmed 2026-08-12). There is no data migration.** This
  removes a whole workstream: `schema-target.md`'s "Migration hazards" section no longer
  describes work to be done, and the orphaned-log-row and unknown-actor blockers above are
  **closed** — nothing is being carried across. Phase 1 becomes *create schema + seed*, not
  *migrate*. Three things do **not** change:
  1. The extraction was still necessary — the old code is the behavioural spec (Q2), and the
     843-column inventory is what the template assembler is written against.
  2. The **input validation** those hazards implied is still required, because the bugs that
     produced the bad values are live in the code being replaced (money as formatted strings,
     `TableAddPersonel.js:37`'s 4-digit year, `'0000-00-00'` dates).
  3. The seed still needs realistic fixtures — one user per role (Q17), the `setCode.json`
     taxonomy (Q34), and enough projects to exercise all seven phases.
- **Effort estimate revises downward.** "Plan in weeks" was partly driven by moving live data
  out of 843 denormalized columns. That is gone. The assembler (~433 field mappings), budget
  enforcement, and ~20 screens are unchanged and still dominate.
- **Phase 0 is complete.** All five `docs/` files exist. Before Phase 1 starts, four
  assumptions in `schema-target.md` need an explicit yes: **A1** = Q37 (money → `DECIMAL(12,2)`),
  **A2** = Q38 (surrogate PKs), **A3** = Q41 (ledger built on `logstudentgetmoney`), and
  **A4** = the Q39 revision below. A1–A3 were already "recommended, not objected to"; **A4 is
  the only one that overturns a settled decision.**
- **The orphaned-log-row question is now blocking.** `project_event.project_id` is a hard FK,
  so `logstatus_project`'s 16 references to non-existent projects cannot be migrated as-is.
  Decide: drop them, or create tombstone `project` rows. This was Phase 0's last open question
  and it is now on the migration's critical path.
- ~~**Q39 must be revisited before the migration is written.**~~ **Data half settled
  (2026-08-12): the three `karoms` rows are mock data and are dropped, not migrated.** The
  modelling half is kept as designed — `person` and `membership` stay separate, so one person
  may hold several memberships. Deleting the evidence does not answer whether that happens in
  reality, and collapsing the two tables later is cheap while splitting them later is not.
  **Consequence to plan for:** those were the dump's only `personel` rows, so the migrated
  dataset has **no `Stuact` and no `AD` user**, and 12 of 30 projects lose their adviser link.
  Seed replacement staff. See `domain-model.md` → "What dropping `karoms` costs".
- **Unknown actors in the logs — a second blocker of the same shape as the orphaned rows.**
  Sweeping the references before deleting `karoms` turned up **six editors named in the logs
  who do not exist in `users`** (`rathaniny` ×8, `s6516021620016` ×3, `phollakritw` ×3,
  `s6503051624076`, `s6603051613057`, plus `'admin'` ×10 and one NULL).
  `project_event.actor_person_id` is a `NOT NULL` FK, so this needs the same decision as the
  orphaned log rows: drop, placeholder, or relax the FK.
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

1. ~~`git init` in `DMS_c` (Q10)~~ — **done**, commit `b8c7d31`.
2. Phase 0: produce the five `docs/` files (Q23). `schema-current.md` is now a straight
   **extraction** from `usersystem.sql`, not a reconstruction.
   - [x] `schema-current.md` — **done**. Also corrected the phase counts above and closed
         the `p_budget` column-naming question (see below).
   - [x] `template-contract.md` — **done**. Named the budget categories, closed three of
         `schema-current.md`'s open questions, and found the BT arity gap below.
   - [x] `business-rules.md` — **done**. Verified defects 5–7 above (all three were
         understated; see the correction), closed the `yearly_countsketch` / `yearly_count`
         question, and found the unauthenticated `server.js` route group below.
   - [x] `domain-model.md` — **done**. Verified Q35, corrected the `netprojectbudget` grain,
         and found that Q39 would destroy a real role (see below).
   - [x] `schema-target.md` — **done**. 29 tables; every one of the 843 current columns is
         mapped or named as dropped. Takes four assumptions (**A1–A4**) that need sign-off.
3. ~~Rewrite `DMS_REBUILD_STRATEGY.md` against the extracted docs.~~ — **done**. It is now a
   6-phase build plan that points into the Phase 0 docs instead of restating them.
4. ~~Re-confirm the open items — A1–A4 and the stack table.~~ **Settled 2026-08-12**: stack =
   the old stack (see the build plan); theme = standard Bootstrap 4, **no dark mode**;
   A1–A3 proceeding as written. **A4 is the one still open** — see below.
5. **Phase 1 — in progress.**
   - [x] Repo scaffold: `backend/` (`frontend/` not started).
   - [x] Schema — `backend/src/db/migrations/001_initial_schema.sql`. 30 tables, 1 view,
         42 FKs. **Verified applied against MariaDB 10.4.**
   - [x] Migration runner (`npm run db:migrate`, `--fresh`) and seed
         (`npm run db:seed`, `--no-fixtures`, `--force`). Both run green.
   - [x] Organisation seed from `setCode.json`, all four shapes, corrections logged.
   - [x] Reference seed: 7 phases, 11 transitions, 8 tag sets / 56 tags.
   - [x] Fixtures: one person per role, one project per phase.
   - [x] **The `AuthProvider` seam** (Q3/Q17) — **done, verified end to end.**
         `AUTH_PROVIDER=mock|icit` (`src/auth/providers/`); both providers return ICIT's
         response shape and share one normalizer (`src/auth/identity.js`), so the mock
         exercises the real mapping. `POST /api/auth/login` and `GET /me` both answer with the
         role resolved from `membership` — the token carries `sub` + `uid` and no role at all.
   - [x] **Phase 1 is complete.** Schema applies from empty, seed re-runs, `GET /me` returns a
         database-resolved role, every FK exists.
6. **Phase 2 — complete (2026-08-13).** Project CRUD, scope, server-side numbering and the
   phase machine. See "Phase 2 close-out" below. Reproduce with
   `npm run db:reset`, `npm run dev`, `npm run check:phase2` — 54 checks, all passing.

### Phase 1 close-out (2026-08-13) — what the auth seam actually does

- **Layout.** `server.js` (listen) → `src/app.js` (the app) → `src/routes/auth.js`.
  Supporting: `src/config.js`, `src/auth/{identity,tokens}.js`,
  `src/auth/providers/{index,mock,icit}.js`, `src/services/identityService.js`,
  `src/middleware/requireAuth.js`, `src/lib/httpError.js`.
- **The contract is two lines.** `authenticate(username, password)` returns the provider's own
  payload, `null` for a bad credential, and **throws** when the provider itself is broken. The
  route turns those into 200 / 401 / 502, so a failing SSO is never reported to a student as a
  wrong password. No implementation may return a role.
- **Identity and role are separated in code, not just in prose.** `upsertPerson` writes only
  `person` columns (named, never `SET ?`); role comes from `loadMemberships(person, year)`.
  Authenticating successfully while holding no membership is a supported state: `role: null`,
  permitted nothing. Verified by logging in against a year with no memberships.
- **`GET /me` returns `memberships[]` plus a primary `membership`/`role`**, picked by
  precedence `ADMIN > STUACT > AD > SH`. That precedence exists only because **A4** allows one
  person to hold several memberships in a year; if A4 collapses, every list is length 1 and it
  becomes a no-op. The client is never left guessing whether it saw all of them.
- **The local admin fallback is kept and defanged.** It supplies identity only, so
  `ADMIN_USERNAME` must hold a real `membership` to be able to do anything — the backdoor
  cannot mint privileges that are not in the database. `config.assertValid()` refuses to boot
  if it is set in production, or if `AUTH_PROVIDER=mock` is, or if `JWT_SECRET` is missing or
  under 32 characters.
- **Verified, not assumed:** forged-secret, expired, malformed and absent tokens all 401; a
  valid token for a deleted person 401s; repeated logins upsert rather than duplicate;
  `login_attempt` records both outcomes (Q15); all four fixture roles resolve with the right
  club / jurisdiction scope.
- **Untested by construction: `src/auth/providers/icit.js`.** There is still no ICIT access
  (Q3), and the old `src/login.js` is no longer on disk, so both the request shape and the
  field names in `src/auth/identity.js` are reconstructed from this file and
  `schema-current.md`. They are **unverified** and marked as such in both files. The mapping is
  confined to one function so correcting it is a single edit.

### Phase 2 close-out (2026-08-13)

- **Layout.** `src/routes/projects.js` and `src/routes/reference.js` over
  `src/services/{projectService,phaseService,scope}.js`, with `src/lib/validate.js` for field
  allow-lists. `backend/scripts/check-phase2.js` is the acceptance run.
- **Scope is a SQL fragment, not a filter.** `scope.visibilityClause` is applied inside the
  query, so a caller cannot page past their scope and the database never assembles rows they
  may not see. ADMIN sees all; STUACT sees its `jurisdiction_club_group_id`; SH and AD see
  their own club; no membership sees nothing.
- **Out of scope answers 404, not 403.** A 403 would confirm that a project with that id
  exists in another club, which is the cross-club leak in a smaller form. Genuine
  in-scope permission failures are still 403 and name who may act.
- **The fixtures gained a second club** (`fixture.otherstudent`, ชมรมฟุตบอล, a different club
  group). With a single club there is no request that *should* be refused, so scope could be
  asserted but not demonstrated. Now it is seeded.
- **Numbering needs two things, and it took a concurrency test to find the second.** Ten
  simultaneous creates in one club-year first produced deadlocks, then — after a club-row lock
  was added — duplicate-key errors. The cause of the second is that InnoDB's REPEATABLE READ
  fixes a transaction's snapshot at its *first* read, which happens before it starts waiting
  for the lock, so a plain `SELECT MAX(...)` after the wait still cannot see the row the
  previous holder just committed. Both the club-row lock (serializes) and `FOR UPDATE` on the
  aggregate (forces a current read) are required. Ten concurrent creates and ten concurrent
  approvals now issue ten distinct sequences and ten distinct project numbers. Written up in
  `src/services/projectService.js` → `lockClubForNumbering`.
- **Contention is a 409, not a 500.** `transaction(fn, { retries })` retries transient errors,
  and anything that outlives its retries is reported as "try again", because that is what it
  is. Double-advancing one project also 409s: the transition re-reads the row under its lock
  and refuses if the phase moved since the read that authorized the request.
- **Verified, not assumed:** all 54 checks in `check-phase2.js`, covering the full 1 → 7 walk
  by the correct roles, wrong-role 403s, impossible and backwards transitions as 400s,
  mass-assignment rejection naming the offending fields, `'0000-00-00'` rejected, per-group
  ordinals in `project_attendance`, tag de-duplication, and an event log that chains from
  `DRAFT_PROPOSAL` into the project's current phase.
- **Deferred to Phase 3 and marked in code**: the `requires_budget_check` transitions are
  currently allowed. `phaseService.js` carries the hook and the response returns
  `budgetCheckPending: true`, rather than silently implying a limit is being enforced.

#### Editing rights — an assumption, not a port

The old system had no edit rule at all: every edit endpoint accepted any token for any project
in any phase. Something had to be chosen, and `src/services/scope.js` implements the
conservative reading of the gate table in `business-rules.md`:

- nothing is editable once `CLOSED`;
- `SH` may edit their own club's project only in `DRAFT_PROPOSAL` or `DRAFT_REPORT`;
- `STUACT` and `ADMIN` may edit anything in scope, in any phase before `CLOSED`;
- `AD` may not edit at all (Q5 — the adviser is a viewer in v1);
- deleting is narrower than editing: an owner may delete their own unsubmitted draft, and
  otherwise only `ADMIN`, because delete cascades to every child table.

**This needs a yes or no from someone who runs the process.** It is the one part of Phase 2
that is a judgement call rather than a port, and the likeliest correction is whether STUACT
should be able to edit a student's content at all, as opposed to only advancing it.

### Frontend first slice (2026-08-13) — deliberately out of order

`frontend/` now runs: CRA + React 18 + Bootstrap 4.6 + reactstrap + React Router v5, the stack
the build plan settled on. It is **not** Phase 5 — it is three screens (login, project list,
one project with its phase strip, transition buttons, child lists and event log) built to
answer "can I start the whole thing and watch it work". Phase 5 still comes after Phases 3
and 4, because the remaining screens are budget screens and document downloads.

Two disciplines it establishes early, both from `business-rules.md`:

- **The role never comes from the browser.** The token sits in `sessionStorage` because it
  must sit somewhere; the role and the available transitions are read from `GET /me` and
  `GET /projects/:id`. The old frontend rendered every transition control from
  `storedUser.position` against endpoints that checked nothing.
- **Success is announced only after the server answers**, replacing the old screen's four
  unawaited calls and immediate `Swal.fire("สำเร็จ!")`.

**No palette has been chosen.** `src/theme.css` holds every colour as a `--dms-*` custom
property, all stock Bootstrap or neutral, so a real theme is one file's worth of edits when
the owner decides. See the build plan, Phase 5, "Theming".

### Resume notes (2026-08-13)

- **Local dev database**: MariaDB via XAMPP (`C:\xampp\mysql\bin`). Start it from the XAMPP
  control panel. Database `dms`. Rebuild any time with `cd backend && npm run db:reset`.
- **Running the API**: `cd backend && npm run dev`. It prints the provider, the academic year
  and the CORS origin at startup. `GET /api/health` reports database reachability.
- **`ACADEMIC_YEAR=2567` is now required in `.env`** and is in `.env.example`. Roles are scoped
  by academic year, and the fixtures seed 2567; without the override the derived year is 2569
  and every fixture login resolves to `role: null`. See the open item below.
- **`backend/.env`** exists locally with a generated `JWT_SECRET`. Gitignored — a fresh
  clone copies `.env.example` and generates its own.
- **Verified, not assumed**: the membership CHECK, both project-sequence unique keys, the
  disbursement sign check, event FKs, and that `budget_line.amount` cannot be forced. The
  pool sets `STRICT_ALL_TABLES` on connect because XAMPP does not.
- **Still to decide**: **A4** — whether `person` and `membership` stay split. Everything
  built so far assumes they do; collapsing them later is cheap, splitting later is not.

### Phase 0 findings that change the picture

From `schema-current.md`:

- **`p_budget`'s 382 columns are fully decoded.** A budget line is
  `(description, qty1, unit1, qty2, unit2, unit_price)`; every `list S*`/`listSS*` value is a
  **derived** total, not input. This makes Q13's normalization concrete — and means the
  stored totals must be recomputed on migration, not carried over.
- **Money's comma formatting comes from the frontend**, which calls
  `.toLocaleString("en-US")` before posting, and `parseInt`s its operands. Data is whole-baht
  display strings. Directly affects Q37.
- **There are no foreign keys anywhere**, and the history tables contain **dangling
  references** to projects that no longer exist. The migration cannot assume referential
  integrity — a decision is needed on orphaned log rows.

From `template-contract.md`:

- **Q8 has a live victim.** `p_budget` stores **20** `BT` (ค่าใช้สอย) rows but temp04 prints
  only **12** — all seven BT tag families stop at index 12. The current system **silently
  truncates**. This belongs on the deliberate-deviations list: the assembler must error, not
  drop rows.
- **The budget categories are named by the form**: `A` = ค่าตอบแทน, `BT`+`BNT` = ค่าใช้สอย,
  `C` = ค่าวัสดุ. The form prints three categories; the DB splits B in two. `listSSBT` and
  `listSSBNT` are dead columns — the form only ever prints the combined `listSSB`.
- **`DECISIONS.md:119` is off by one**: the checkbox bank is `is_1..4basic`, not `is_1..5basic`.
- **A shipping bug in กนศ.06**: temp06 renders `{#budget}{listSAll}{/budget}` — the approved
  project total — but the render payload never passes a `budget` key, so **that amount prints
  blank on every final report**. Also, the attendance-percentage object `persen` divides
  unvalidated strings and can emit `"Infinity%"` or `"NaN%"`.
- **Do not treat current rendered Gantt charts as a correctness baseline** — the form mixes
  `&&` and `||` across cells that should test identically.

From `business-rules.md`:

- **A whole group of routes has no authentication at all.** `server.js:158-376` defines seven
  handlers inline, outside every router, and none carries `verifyToken` — including
  `PUT /updateState`, `POST /insertlogState`, `POST /studentgetmoney` and
  `POST /updateprojectusebudget`. **The phase machine and the money ledger are writable with
  no token.** This changes the security picture from "authorization is broken" to
  "authentication is absent on the endpoints that matter".
- **Six handlers never call `res.send()`**, so the browser hangs and the UI announces success
  regardless (`ProjectDocument.js:248` fires its success alert before any response arrives).
  No phase change or budget write in the current system can be trusted to have happened.
- **The role gate is JSX over `sessionStorage`.** `ProjectDocument.js:286-364` is the only
  written statement of who may advance which phase — worth porting as the specification, and
  worthless as an enforcement mechanism. Note it also distinguishes club-scoped `Stuact` from
  global `Admin`, a distinction the backend does not have.
- **`netprojectbudget.allow_budget` is written by two endpoints with two different meanings**
  (`adminRoutes.js:1663` overwrites it with one project's approved amount, keyed on
  `project_name`; `server.js:342` overwrites it with the sum of disbursements). `use_budget`
  is never written at all. There is no budget-ceiling check anywhere — Q37's rule is new work,
  not a restoration.
- **Email notification does not exist.** `server.js:64-83` hardcodes the recipient and sends
  through `smtp.ethereal.email`, a disposable capture service. Treat as a requirement.

From `domain-model.md`:

- **`setCode.json`'s `Agency` has four different shapes**, not one. `D01`–`D03` are a list of
  named groups split by code range (`A0xx` = org unit, `A1xx` = the student body of that same
  unit); `D04` is a list of five club groups each nested by campus; `D05` and `D06`–`D12` are
  plain dicts. Q34's seed importer has to handle all four, and the `A0xx`/`A1xx` pairing is a
  **relationship**, not two unrelated rows — otherwise every faculty appears twice in every
  dropdown.
- **`AgnecyGroupName` is the `D04` group name** — five values, of which the dump uses three.
  This is the layer `Stuact` is scoped to.
- **`users.agencyGroupName` and `users.ClubGroup` are opposites, not duplicates.** The first
  is the group the person's own club belongs to (set for `SH`/`AD`); the second is the group a
  `Stuact` officer has jurisdiction over. They are mutually exclusive in the dump. Merging
  them — the obvious cleanup — would make every officer a member of the group they oversee.
- **The club-code width invariant is already broken in live data.** `TableAddPersonel.js:167`
  interpolates a 4-digit `yearly` (initialised to `2667` at `:37`), so two rows carry a
  **12-character** `codebooksome` (`B26670100101`) instead of 10. A project under that club
  would produce a 14-char `project_number` and be silently truncated by `varchar(12)`.
  Reinforces Q18/Q29 and adds: the year must be a derived 2-digit rendering of a typed
  4-digit year, and `codeclub` must be composed from FKs, not copied as a string.
- **`netprojectbudget` is one plan line per *project*, not an annual agency allocation.** Four
  dump rows share one agency and year with four different `net_budget` values. Q27 already
  assumes this; the "annual" wording elsewhere in this file is loose. **Consequence: the
  per-agency yearly ceiling in Q20/Q25 layer (c) has no table today at all** — it is new
  construction, not a re-typing of this one.
