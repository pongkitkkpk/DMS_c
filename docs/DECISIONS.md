# DMS Rebuild — Decision Record

**Status**: Phases 0–6 complete, plus the post-v1 work recorded at the end of this file. All four Phase 0 assumptions (A1–A4) are closed.
**Last updated**: 2026-08-15
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
| Q39 | ~~**One role per user.** The duplicate `karoms` rows are dirty data — de-duplicate during migration, add unique constraint on `id_student`.~~ **Superseded by A4 (2026-08-15): one person may hold several roles.** The unique constraint lands on `(person_id, academic_year, club_id, role)` instead. |

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
17. **A project money has been paid out of cannot be deleted.** The v1 decision was that
    `DELETE FROM project` cascades, and thirteen of the fourteen child tables do; the
    `disbursement` foreign key does not, so the delete answered a 500. Narrowed to a 409
    naming the payments rather than widened to a cascade — **keeps the record that money
    left the university's account** until someone who runs the process says otherwise

The three below were added by the pre-deployment security pass on 2026-08-17. They are
deviations in the same sense as the rest: the old system did none of them.

18. **Guessing a password costs something.** `login_attempt` has recorded every failure
    since migration 001 and nothing ever read the table, so `POST /api/auth/login` — the
    only endpoint reachable without a token — could be called as fast as the network
    allowed. Two sliding budgets now count those rows: a small one per username, and a
    larger one per source address, which is what catches *spraying* (one try each against
    many usernames, tripping no per-username counter). Both refusals expire on their own
    and nothing is ever locked: a lockout that outlives its window would let anyone who
    knows an ICIT username keep its owner out indefinitely, trading one attack for a
    cheaper one. Migration 004 adds the address column. **User-visible**: a person who
    types their password wrong eight times in fifteen minutes is asked to wait, with the
    number of minutes in the message — new behaviour, and the one part of this pass
    somebody may want tuned (`LOGIN_MAX_PER_USERNAME`, `LOGIN_MAX_PER_ADDRESS`)
19. **The mock provider can require a shared password.** The mock accepts any non-empty
    password by design, which is right on a laptop and indefensible on a host with a
    public address, because `fixture.admin` is a username published in the source. A
    production start on the mock is now refused unless the deployment sets both
    `ALLOW_MOCK_AUTH=1` and an 8-character `MOCK_PASSWORD`. This replaces a flat refusal
    that had a perverse effect: since this system is *meant* to end at the mock (Q3, Q17),
    the only way to deploy it was to leave `NODE_ENV` unset, which switched off every
    production check at once to avoid the single one that was in the way. `MOCK_PASSWORD`
    is a door on a demonstration, not authentication — everyone who has it shares it —
    and it is described that way where it is defined
20. **A production start refuses configurations that would leak.** An empty `DB_PASS`, a
    `DB_USER` of `root`, and a plain-http `CORS_ORIGIN` each now stop the process rather
    than being discovered later. Development is untouched: XAMPP ships `root` with no
    password on http, and checks that refuse to start there become checks people switch
    off rather than satisfy
21. **The login screen is told what it is talking to** — `GET /api/auth/mode`, public
    because it is read before anybody can have a token. It replaces a hardcoded fixture
    list rendered behind the client's own `process.env.NODE_ENV`, which was wrong in both
    directions: `npm run build` sets that flag unconditionally, so the demonstration
    accounts disappeared from the deployed demo — the one place somebody arrives without
    knowing what to type — while on a laptop the card always read "รหัสผ่านอะไรก็ได้",
    which stops being true the moment `MOCK_PASSWORD` is set. The roles beside the names
    come from `membership` rather than from a list written next to the usernames, which is
    the same rule as everywhere else: **no screen states a role the database does not**
22. **`GET /api/spending` — one year's money per club and per campus, for officers.** The
    figures are not new: allocated, committed and disbursed are the same three sums
    `allocationService` and `budgetService` already compute, copied rather than re-derived
    so a total here cannot disagree with the club's own screen. What is new is the
    *comparison* — a column of `500,000.00` beside `96,000.00` makes the reader work out
    the ratio and then hold it in their head for the next club. Restricted to ADMIN and
    STUACT by a refusal, not a narrowing (the same rule and wording as
    `nextYearReadiness`): a student and an adviser read their own club's ceiling on the
    allocations screen (Q30), and a cross-club comparison is the view of somebody
    responsible for more than one club. A club is listed for having **an allocation or
    projects**, so a club spending against a ceiling nobody set still appears; clubs with
    neither are counted rather than listed, because 68 rows of zero bury the one row that
    says something. Rolled up three ways — campus, **club group**, club — the levels the
    university is organised by; the middle one is what a STUACT actually holds
    (`membership.jurisdiction_club_group_id`), and `club.club_group_id` is nullable, so
    the sixteen clubs in no group get a bucket that says so rather than being dropped or
    filed somewhere they are not. **Nothing is stored** — every figure is summed on read,
    the same bargain as everywhere else in this system
23. **A session that ends is handled, and the page you asked for survives it.** Two client
    defects, found 2026-08-17 by opening `/spending` in a browser with no session — which is
    how everybody who is *sent* that link arrives. (a) The token was re-verified on mount
    only, so an expiry mid-tab left every screen drawing the server's
    `กรุณาเข้าสู่ระบบใหม่` as its own red alert while the app bar went on naming the
    signed-in user — the app both insisting you were signed in and telling you to sign in
    again, with no control that did it, and `/projects` holding its loading skeleton so an
    ended session looked like a slow one. A 401 on a **read** now clears the token and takes
    the user to the login screen, which says whether the session expired or was signed out
    of. (b) That redirect discarded the requested URL and the login screen pushed a
    hardcoded `/projects`, so a link to `/spending?year=2566` — a page whose year is in the
    URL *so that it can be sent* — quietly delivered a different page. The destination now
    travels in the router's `state` (not a `?next=` anybody could aim elsewhere) and is
    validated to a single leading slash on the way out. **Writes are deliberately exempt
    from the bounce**: a GET holds nothing the user typed, but a failed save may be a
    project form with an hour of work in it, and navigating away from it would destroy what
    is still on screen. See DMS_REBUILD_STRATEGY.md → "A session that ends while the tab is
    open" for the five reproductions, and "Still open" below for the part not built
24. **A value of the wrong *kind* is refused, not coerced.** Deviation 2 stopped a write from
    reaching a column it should not; this stops one reaching the right column with a value
    the wrong shape. `String()` and `Number()` answer for every input, so `lib/validate.js`
    was accepting three things with a 200 and storing them (verified 2026-08-17):
    `{"content":{"a":1}}` became the literal text `[object Object]` in a numbered box on
    กนศ.04, `{"content":["ก","ข"]}` became one row reading `ก,ข` where the client meant two,
    and `{"headcount":[]}` became a real attendance of **zero** on กนศ.06 — the one nobody
    would ever notice, because a zero is plausible in a column of numbers. A `scalar()` guard
    now admits only strings and numbers, and every validator routes through it. Separately,
    **`VARCHAR(n)` counts characters but `TEXT` counts bytes**: the 65,535 default was
    compared against `String#length`, so 22,000 characters of Thai — 66,000 bytes in
    `utf8mb4` — passed validation and MySQL answered `ER_DATA_TOO_LONG`, a **500**.
    `Buffer.byteLength` is now checked too, and the message says bytes. Nine assertions in
    `check-phase6.js` §13–14; see DMS_REBUILD_STRATEGY.md → "What `String()` will answer for,
    and a file grep could not see"
25. **No source file may contain a raw NUL byte.** Not a behaviour change — a tooling one,
    listed because it hid the audit that found deviation 24. `services/projectService.js`
    used a NUL as a grouping-key separator (correctly: no validated value can contain one)
    but wrote the byte instead of the escape `'\0'`, which made grep, ripgrep and `git diff`
    classify the module as **binary and skip it silently**. Thirty-eight validator call sites
    — every field of every child list on both government forms — were invisible to a sweep
    meant to check them. `check-phase6.js` carried a second one. Both write the escape now,
    and §14 fails if another appears, because this is exactly the defect that hides from the
    tool you would use to look for it

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
  the only one that overturns a settled decision.** *(All four are now confirmed — A1–A3 on
  2026-08-12, A4 on 2026-08-15.)*
- **The orphaned-log-row question is now blocking.** `project_event.project_id` is a hard FK,
  so `logstatus_project`'s 16 references to non-existent projects cannot be migrated as-is.
  Decide: drop them, or create tombstone `project` rows. This was Phase 0's last open question
  and it is now on the migration's critical path.
- ~~**Q39 must be revisited before the migration is written.**~~ **Both halves settled.**
  *Data (2026-08-12):* the three `karoms` rows are mock data and are dropped, not migrated.
  *Modelling (2026-08-15):* the owner confirmed that one person may hold several roles, so
  `person` and `membership` stay separate permanently. This is no longer a provisional design
  kept because collapsing it later would be cheap — it is the rule.
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
   A1–A3 proceeding as written. ~~**A4 is the one still open**~~ — **A4 confirmed 2026-08-15:
   one person may hold several roles. All four assumptions are now closed.**
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
  precedence `ADMIN > STUACT > AD > SH`. That precedence exists because **A4** allows one
  person to hold several memberships in a year — confirmed 2026-08-15, so it is a real code
  path and not a contingency. The client is never left guessing whether it saw all of them.
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
- **Verified, not assumed:** all 55 checks in `check-phase2.js`, covering the full 1 → 7 walk
  by the correct roles, wrong-role 403s, impossible and backwards transitions as 400s,
  mass-assignment rejection naming the offending fields, `'0000-00-00'` rejected, per-group
  ordinals in `project_attendance`, tag de-duplication, and an event log that chains from
  `DRAFT_PROPOSAL` into the project's current phase.
- ~~**Deferred to Phase 3 and marked in code**: the `requires_budget_check` transitions are
  currently allowed and return `budgetCheckPending: true`.~~ **Closed by Phase 3** — those
  transitions now enforce. The walk in `check-phase2.js` states a plan and an approved amount
  before the two money gates, because a project can no longer pass them with no money stated;
  the response field is now `budgetChecked` plus `budgetWarnings`.

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

## Phase 3 close-out (2026-08-14)

Budget enforcement exists. `backend/src/services/budgetService.js` owns the three limits,
`allocationService.js` owns the ceiling they are drawn against, and
`backend/scripts/check-phase3.js` (`npm run check:phase3`) proves each one refuses — 65 checks,
all passing, against a live server.

The build plan's "Done when" list, item by item:

- **Each limit blocks, with a distinct error.** (a) `REQUEST_OVER_PLAN`, (b)
  `DISBURSED_OVER_APPROVED` / `ACTUAL_OVER_APPROVED`, (c) `CLUB_YEAR_OVER_ALLOCATION`, plus
  `APPROVED_AMOUNT_MISSING` and `ALLOCATION_MISSING` for the two ways a limit can be
  unstatable. Every one carries its own Thai sentence naming both numbers and the overage.
- **Concurrent approvals against one allocation cannot both succeed.** Eight simultaneous
  approvals against a ceiling with room for three landed exactly on the ceiling, three times
  running, with no deadlock escaping its retries.
- **No stored total can disagree with its components.** `budget_line.amount` is `GENERATED`
  and rejected if a client states it; every other figure is a `SUM` or a subtraction.

### Decisions taken in Phase 3

- **A budget refusal is 422, not 400.** The request was well formed and the caller was
  entitled to make it — the numbers refused it. The body carries `budgetViolations` with
  *every* violation, not only the first, so a form can mark more than one field.
- **Each flagged gate enforces the limit that first becomes real at it**, and never one that
  is already committed: `PROJECT_APPROVED` → (a); `BUDGET_APPROVED` → (a) and (c);
  `REPORT_SUBMITTED` → (b). Re-checking (c) at `REPORT_SUBMITTED` would let a *lowered*
  allocation block a report, which contradicts Q33.
- **An `approved_amount` is committed the moment it is written**, not at the phase change that
  follows it. Anything else would leave a gap in which a club could approve past its ceiling,
  and would make the write-time and transition-time checks disagree about the same number.
- **Layer (c) is not re-checked on budget-line writes.** A line cannot change any approved
  amount, so re-checking the allocation there could only ever fail for a reason the person
  editing cannot fix — which is the shape of a rule people learn to route around.
- **The "missing" findings are suppressed until money is actually about to be committed.** An
  unset approved amount and an unset ceiling are facts for the whole of drafting, not faults;
  warning about them on every read trains people to ignore the warnings that matter.
- **Q26's "warn on draft submit" is the same evaluation as the block, reported instead of
  enforced.** Every transition response carries `budgetWarnings`, so a problem is visible for
  the whole of the phase in which it can still be fixed. One implementation, not two.
- **Money out blocks immediately** rather than at the next gate. Paying past the approved
  amount is not something to warn about and reconcile later.
- **The `project_budget_status` view is no longer on any request path.** A view cannot be
  locked, and every figure that decides whether a write may commit has to be read
  `FOR UPDATE`, so the service reads the components directly. The view survives in the schema
  as the SQL-level report shape — there is one implementation of these totals, not two.
- **`scope.permits` answers what the screens may draw**, by asking the same assertions the
  writes run rather than restating them. The old frontend restated the rule from
  `storedUser.position` and the two drifted; a predicate derived from the assertion cannot.
- **Money never passes through a float.** `src/lib/money.js` compares and sums in whole
  satang; `check.decimal` refuses a third decimal place rather than rounding it away, and
  refuses a non-number rather than coercing it to 0 (Q37).

The same REPEATABLE-READ trap that cost a day in Phase 2's numbering applies to every one of
these checks, and is handled the same way: lock a single existing row first to serialize
(the allocation, or the project), then read the aggregate `FOR UPDATE` so it sees what the
previous holder committed rather than the snapshot taken before the wait. Lock order is
**allocation → project → club** everywhere, including inside `performTransition`, which takes
the allocation lock before the project row precisely so an approval racing a transition queues
instead of meeting it head-on.

### New deviations from old behavior

Added to the numbered list above, all required by Q22:

17. **A budget line's total is computed by the database and refused from the client.** The old
    frontend called `.toLocaleString("en-US")` on its own arithmetic and posted the result.
18. **Disbursements are append-only, and "remaining" is a subtraction over them.** The old
    `logstudentgetmoney` stored `remainingBudget` per row and let the client compute it.
19. **Approving money and recording a disbursement are Admin/STUACT only, and only from the
    phase at which each becomes meaningful.** The old routes were unauthenticated.
20. **A club with no allocation cannot have money approved against it.** New: there was no
    allocation, so there was nothing to refuse against.

## Phase 4 close-out (2026-08-14)

Both government forms render. `backend/src/documents/` holds the assembler, the derivations,
the arity guard and the renderer; `backend/scripts/check-phase4.js` (`npm run check:phase4`)
proves the build plan's three conditions — 64 checks, all passing.

- **Both forms render fully populated from a fixture project.** No tag survives unrendered, and
  neither document contains `undefined`, `null`, `NaN` or `Infinity` — all four of which the
  old renders could and did print.
- **Every tag in the contract is filled or deliberately blank.** Asserted key by key against
  `docs/template-tags.json`, in both directions: every contract tag has a payload key, and no
  payload key is `undefined` or `null`. The one deliberate omission is named in the script.
- **An over-capacity project errors, naming the category and the limit.** 13 ค่าใช้สอย lines
  against a 12-row form is a 422 saying so, not a document missing its thirteenth line.

### The mapping was extracted, not written

`docs/template-contract.md` closed by naming what it had not done: the 433-field mapping table.
Phase 4 does it mechanically instead — `scripts/extract-template-tags.js` rejoins tags split
across XML runs, classifies them, and **walks each template's section stack to record which
payload root every field is read from**.

That last part is the load-bearing one. A field placed under the wrong root renders **blank,
with no error**, and that is exactly what defect 1 is: temp06 asks for `{#budget}{listSAll}`
and the old render passed `Fbudget` but not `budget`, so the approved amount has printed blank
on every กนศ.06 ever produced. A mapping guessed from field names would have reproduced it.

The arity limits are read from the same generated file rather than typed in, so replacing a
template and re-running the extraction moves them with it. A number copied by hand would not
move, and would be wrong in the silent way the guard exists to prevent.

### Decisions taken in Phase 4

- **The phase gate on downloads is an assumption, not a port** — see below.
- **A form that cannot hold the project is refused, not truncated** (Q8). This is a real
  refusal with real consequences: a project with an `ETC` budget line cannot produce กนศ.04 at
  all, because the form has no box for that category and printing a grand total that includes
  it would put a wrong number on a signed document.
- **`quality_target` is stored and deliberately not printed.** It has no tag in either form.
  The database stays the uncapped side; nothing is lost, and it is listed rather than silently
  dropped.
- **Thai renderings are computed here, not by the host's ICU.** The old frontend used
  `toLocaleDateString('th-TH', …)`; a Node built with `small-icu` answers that in English,
  silently, on a government form. The month names and the Buddhist-era offset are in
  `documents/thai.js`.
- **The spelled-out amount covers the whole range the schema permits.** The old
  `ArabicNumberToText` returned the *string* `"ข้อมูลนำเข้าเกินขอบเขตที่ตั้งไว้"` above
  9,999,999.9999 — an error message rendered into a form field, with nothing to notice it.
- **`persen` divides guardedly.** A percentage of zero planned attendees is `—`, not
  `Infinity%`; zero-and-zero is `—` rather than `0%`, because `0%` asserts a comparison that
  was never made.
- **The Gantt defect is quantified and left alone.** temp04 contains two month grids over the
  same values, one correct and one using `||` where it means `&&`. It cannot be fixed from the
  payload, and the templates are fixed inputs — so it is documented with its exact size and
  raised, not silently reproduced as if intended. See `template-contract.md`, open item 2.

### New deviations from old behavior

21. **A document download is authorized and phase-checked.** The old `gennerateDoc` route sat
    in the unauthenticated inline group and rendered any project id it was given.
22. **A project that exceeds a form's capacity is refused.** The old system printed 12 of 20
    ค่าใช้สอย rows and said nothing — a live data-loss path on a signed document.
23. **The Gantt's year header is filled.** `is_inyear`/`start_inyear`/`end_inyear` were
    initialised and posted unchanged by the old frontend, so they have always printed blank;
    they are now derived from the activity dates.
24. **กนศ.06 states the approved total.** It has printed blank on every such form ever
    produced, because the payload lacked the key the template reads it from.
25. **Percentages, dates and amounts print as blanks or dashes when they are unknown**, rather
    than as `undefined`, `null`, `NaN%`, `Infinity%` or `1 มกราคม 2513`.
26. **Uploads are not statically served.** The old upload directory was an `express.static`
    mount, so a guessable filename returned any project's file to anyone —
    **closes a second cross-club leak** with the same shape as deviation 1.
27. **An uploaded file's name is a label, never a path**, and what may be uploaded is an
    allow-list. Downloads are always `octet-stream` + `attachment` + `nosniff`, so an uploaded
    `.html` or `.svg` cannot execute in the application's origin.

#### The download phase gate — an assumption, not a port

The old system had no rule: any project, at any phase, to anybody. Something had to be chosen,
and `src/routes/documents.js` implements this:

- **กนศ.04** from `PROPOSAL_SUBMITTED` onward — it is the approval request, and before that
  the numbers are still being drafted, so a document that looks official should not circulate.
- **กนศ.06** from `DRAFT_REPORT` onward — it reports what actually happened, and produced any
  earlier it is a form full of zeroes that reads as a project which spent nothing.

**This needs a yes or no from someone who runs the process**, and it is the one part of Phase 4
that is a judgement call rather than a port. The likeliest correction is whether a student
should be able to print กนศ.04 while still drafting, to review it on paper before submitting.

## Phase 6 close-out (2026-08-14) — hardening

`backend/scripts/check-phase6.js` (`npm run check:phase6`) — 53 checks. The build plan's five
items, with one deliberately not built.

### 1. Structure — verified rather than remembered

The old `server.js` mounted every router twice and held seven unauthenticated handlers inline.
Deviation 13 says that is fixed *by construction*; the run now asserts it: no route defined on
the app except the health probe, every router mounted once under `/api`, and no
`express.static` anywhere.

### 2. Attachments (Q21, deviation 8)

**There is no static mount.** That is the whole of it. The old system exposed its upload
directory as static files, so a guessable filename returned somebody else's document with no
token, no scope check and no record — the same family of leak as deviation 1. Every byte now
leaves through a handler that has already run `loadProject`, which narrows the id by the
caller's membership and answers 404 rather than 403.

Four rules, each closing a way the old arrangement went wrong:

- **The client's filename is never a path.** It is kept as a label — repaired, basename-only —
  and the name on disk is generated. `../../../../evil.pdf` is inert rather than clever, and
  the run proves it twice: over HTTP, and by calling the service directly with a name no
  client stack has sanitised, because "the browser strips it" is not a property to rely on.
- **Stored paths are relative and resolved under one root**, with the root resolved once in
  `config` so the write and the read cannot disagree about where it is.
- **Nothing is served inline.** Every download is `application/octet-stream` + `attachment` +
  `nosniff`, whatever was uploaded, so an uploaded `.html` or `.svg` cannot run as script in
  the application's own origin.
- **An allow-list, not a deny-list.** Every deny-list of dangerous extensions has been shorter
  than the set of dangerous extensions.

**A real bug found here:** multer reads the multipart `filename=` header as latin1, so
`เอกสารแนบ.pdf` arrived as `à¹à¸­à¸...`. In a system whose users name files in Thai that is
every attachment's name, wrong, everywhere. `repairMultipartFilename` reinterprets the bytes,
guarded — ASCII untouched, invalid UTF-8 left alone.

### 3. Email notification — deliberately not built

The build plan says to treat it as a new requirement rather than a port, and the owner has
since said this system is **a demo**. A notification path with no mail server behind it is
worse than none: it either fails on every transition or silently does nothing, and both teach
people to ignore it. So nothing imports a mailer, and the acceptance run asserts that — the
absence is checked, so it cannot drift into a half-present feature.

### 4. Indexes

Asserted for the columns the real queries filter on — `project.club_id` and `phase_id`,
`membership.club_id`, and the project foreign keys on `project_event`, `budget_line` and
`project_attachment` — plus an `EXPLAIN` showing the STUACT scope query does not table-scan
`project`. The old schema had five secondary indexes in total.

### 5. The deviations list

Spot-checked end to end rather than read: scope cannot be widened by a query parameter (1),
mass assignment is refused (2), the token carries no role (11), out of scope is 404 (15), and
attachment downloads are authorized (8, asserted above).

## Phase 5 close-out (2026-08-14)

The screens exist. `backend/scripts/check-phase5.js` (`npm run check:phase5`) — 48 checks —
plus a browser pass over the running app.

Every screen in the old feature inventory is covered, several by one screen where the old
system had four: the create/edit form absorbs `NewProjectDocument` and both `TableAdd/List*`
screens, and the budget panel absorbs `DetailBudget`, `DAddSplitBudget` and `DTableAddBudget`.

### The authorization half is the half that is provable

"No screen relies on `sessionStorage` for an authorization decision" is not shown by reading
the JSX — it is shown by making each screen's requests as each role and checking the server
refuses the right ones. That is what the acceptance run does. The client's part is that every
control is drawn from a `permissions` object the server computed by asking **the same
assertions its writes run** (`scope.permits`), so there is one rule rather than a rule and a
copy of it that drift. The old frontend held the copy in `storedUser.position`, and the
endpoints behind it checked nothing at all.

### Decisions taken in Phase 5

- **The advisor is a picker, not a text box.** `GET /reference/advisors` returns exactly the
  `AD` memberships `assertAdvisorIsValid` will accept, so the form cannot offer a person the
  save will reject — and cannot name one who does not exist, which is what 12 of the old
  system's 30 projects did.
- **Form limits are served, not compiled in.** `GET /reference/limits` reads them from
  `documents/arity.js`, which reads them from the generated template extraction. A constant in
  the client would be one template change away from telling a student they may enter five when
  the form holds three. It warns while typing; the download still refuses independently.
- **A new project opens with one row in each list.** Eight cards reading "ยังไม่มีรายการ" is
  eight clicks before any typing and reads as a broken form. Blank rows are dropped on save.
- **The profile is read-only, and for two different reasons.** Identity is ICIT's — a field
  editable here is one the next login silently overwrites. The role is not editable because it
  is not stored anywhere editable: it is resolved from `membership` per request (deviation 11).
- **The dashboard is where Q33 is loud.** Lowering an allocation below committed spend stays
  allowed; the bargain was that it is surfaced, and this is the surface — a banner, a red
  remaining figure, and clubs with no ceiling listed alongside those that have one, because a
  missing ceiling is not a blank space but the thing that will block the club's next approval.

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

~~**No palette has been chosen.**~~ **Settled 2026-08-14** — the accent is `#AC3520` on warmed
neutrals, in IBM Plex Sans Thai. Every colour is a `--c-*` custom property in
`src/theme.css` and no component hard-codes one. See the build plan, "Visual theme".

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
- ~~**Still to decide**: **A4** — whether `person` and `membership` stay split.~~ **Closed
  2026-08-15**: they stay split, because one person may hold several roles. Everything built
  so far already assumed this, so nothing had to change.

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

---

## Post-v1 work (2026-08-15)

Everything in this section was built after the six phases closed. The reasoning
and the measurements live in `DMS_REBUILD_STRATEGY.md`; what is recorded here is
the decisions themselves, so this file stays the place a decision can be looked
up.

### Answered by the owner

| | Question | Answer |
| --- | --- | --- |
| **A4** | Do `person` and `membership` stay split? | **Yes — one person may hold several roles.** Closes the last of the four Phase 0 assumptions. Q39's original "one role per user" is superseded. |
| | Where does the current academic year come from? | ~~`ACADEMIC_YEAR` in `.env`, for now.~~ **Settled later the same day: a row in `academic_year_setting`, changed by an Admin from the dashboard, and refused if the target year has no Admin of its own.** Auto-rollover was rejected — it would move the system at midnight with nobody deciding, and lock it if the year was unprepared. Once a year, not once a term. |
| | May an allocation be written into a past year? | **Yes, but warned clearly** — the Q33 bargain applied to the year instead of the amount. |
| | May a role be granted into a past year? | **No.** Next year yes. Deliberately *not* the same answer as the allocation question: correcting a past figure leaves something to compare against, backdating authority does not. |
| | May a STUACT grant roles outside its own jurisdiction? | **No.** |
| | Revoke: keep the row or delete it? | **Delete it, and log the change separately** (`membership_event`, migration 002). |

### Decided in the work, and open to revision

- ~~**A STUACT may not grant `STUACT` or `ADMIN`.**~~ **Revised 2026-08-15 by the
  owner: a STUACT may appoint another STUACT — but only into its own
  jurisdiction.** That last clause is not decoration. A STUACT able to appoint an
  officer into *another* group would reach that group in two steps, and every
  individual scope check would still pass while the boundary as a whole leaked.
  Appointing a colleague beside you extends nobody's reach, which is the
  difference between sharing a job and escalating. `ADMIN` remains ADMIN-only.
- **The last-`ADMIN` guard in `revokeMembership` is unreachable today** and says
  so in the code. Only an ADMIN may revoke an ADMIN, and nobody may revoke their
  own membership, so one always survives. Kept against the day the second rule
  is relaxed.
- **Next-year readiness is reported as state, never as a deadline.** Nagging in
  June would mean trusting the June boundary, which is still open below; a
  reminder built on that guess would be wrong once a year.

### Defects found in this work and fixed

Not deviations from the old system — these were introduced here, and are listed
because Q22's habit of never fixing something silently is worth keeping whatever
the code's age.

- `GET /memberships/:id/impact` checked the caller's role but not their scope,
  so an officer could learn another jurisdiction's project count through a
  membership id. Deviation 1's shape, reached by a different route.
- `GET /people` returned an `email` no screen used, and passed `%`/`_` into
  `LIKE` unescaped, so `q=%%%` matched everyone and defeated the search's
  three-character minimum.
- The dashboard's allocation card listed every club in scope — 69 rows for an
  Admin, 89% of the page — which was correct until `/allocations` existed and
  duplication afterwards.
- `/history` offered "กำหนดวงเงิน" to roles that may only read one (Q30).

### The lockout (found 2026-08-15, mitigated)

Three decisions recorded above combine into a way to stop the system dead, and
it is worth stating in the decision record because no single decision is wrong:
a role belongs to one academic year (A4 / Q39), the token carries no role
(deviation 11), and the `.env` admin fallback supplies identity only. Therefore
**moving `ACADEMIC_YEAR` to a year nobody was prepared for leaves every account
at `role: null`, the Admin included, and granting a role requires an Admin.**
Verified against a running server, not reasoned about.

Mitigated by `npm run grant:admin`, a console-only recovery that writes the same
`membership_event` an API grant writes and cannot invent a person. Full
reasoning in `DMS_REBUILD_STRATEGY.md` → "The lockout, and the way back".

**Consequence for the open item below:** the academic-year boundary is no longer
only a correctness question. Editing that one `.env` line at the wrong moment is
the single action that can lock the system, which is an argument for moving the
year somewhere an officer sets deliberately — and for the readiness banner that
warns before the moment arrives.

### The lockout had a third way in: boot order — closed (2026-08-16)

Moving the year into the database closed the `.env`-edit route, and
`setAcademicYear`'s guard made the deliberate route impossible. **A third route
was open and needed no decision by anybody: start the API before MariaDB.**

`academicYearService.load()` treated "the database says there is no row" and
"the database could not be answered" as the same outcome, and cached the
date-derived year for both. The first is right — a fresh install has no row. The
second put the running system into a year it may never have prepared, and
**cached it for the life of the process**. MariaDB then comes up a second later,
`/api/health` goes back to `ok`, and every account resolves to `role: null`
because no membership exists in the guessed year. Nothing looks broken. On this
machine, where XAMPP's MySQL is started by hand, it is the likeliest of the
three routes rather than the most obscure.

The fix keeps `unresolved` as a state of its own: nothing is cached, and
`retryUntilResolved()` asks every five seconds until the database answers, so
the system heals when MariaDB arrives instead of waiting to be restarted.
`/api/health` reports `academicYearResolved` and answers 503 while the year is a
guess — a reachable database is not on its own a healthy system. Rehearsed the
way it was found: API up first, health `degraded`, MariaDB started, health `ok`
at **2567** with `academic year: resolved to 2567 (database) — requests before
now were served against 2569` in the log.

Three assertions in `check-phase6.js`, the last two driven in-process by
stubbing `pool.query` — the state machine is what is under test, and a check
suite must not take the database down to prove a point.

### Separation of duties across roles — closed (2026-08-16)

**The owner's clarification closed it: `SH` is หัวหน้าชมรม, which is a student.**
`domain-model.md` had always said so and no rule had ever read `account_type`,
so nothing stopped an officer being made a club head — the one combination by
which a single person could hold `SH` (opens projects) and `STUACT` (approves
their money) and approve their own request. `createMembership` now refuses `SH`
for a `personel` account, which closes it by encoding something already true
rather than by inventing a separation-of-duties rule.

Only `SH` is constrained. Whether `AD`/`STUACT` must be `personel` is equally
plausible and was not asked, so it is not assumed.

<details><summary>The question as originally raised</summary>

A4 lets one person hold several memberships, and a STUACT may grant club roles
inside its own jurisdiction — including to itself. So one person can hold `SH`
(which creates projects) and `STUACT` (which approves their money) and approve
their own request. `assertCanApproveBudget` says that is "the thing this exists
to prevent", which is now true of the role and not of the person.

Left as it is deliberately: whether the university enforces separation of duties
is a process question, not a code one, and an ADMIN could always do the same.
Needs an explicit answer before it is either enforced or written off.

</details>

### กนศ.04 calls every organisation a ชมรม — closed (2026-08-16)

**The owner's rule: องค์การนักศึกษา and สโมสร are led by a นายก, everything else
by a ประธาน**, with the organisation's own name supplying the rest. 18 นายก and
51 ประธาน across the 69 real names. Both templates were edited on their
instruction — `scripts/patch-head-title.js` — because the wrong word was in the
form and no data-side change could reach it. `assembler.js` computes it as
`clubHeadTitle`.

<details><summary>The finding as originally recorded</summary>

temp04's signature block is the literal `ประธานชมรม` followed by the club name.
47 of 69 club names already begin with "ชมรม", so the word doubles; the other 22
are สภานักศึกษา, สโมสร or สมาคมศิษย์เก่า and are not ชมรม at all. **temp06 has the
same signatory as `นายก/ประธาน` and renders correctly from identical data**, which
is why this reads as a mistake in temp04 rather than a convention.

Untouched: the templates are government artefacts and changing one is the
university's decision. Reproduce with `npm run forms:read`. See
DMS_REBUILD_STRATEGY.md → "Reading the forms" for the two possible fixes.

</details>

### Two more wrong literals in the government forms — open (2026-08-17)

Found by rendering a project filled to every printable capacity
(`npm run forms:review`). Both are the same shape as the ประธานชมรม defect: the
wrong word is *in the template*, so no data-side change can reach it, and each
is proved by the same document contradicting itself.

- **กนศ.04 §19 doubles บาทถ้วน.** The covering letter has `({thailistSAll})` and
  reads correctly; §19 has `({thailistSAll} บาทถ้วน)`. `bahtText` cannot be
  changed to suit, because it would then break the correct one — and for a
  satang amount the literal is not merely doubled but wrong.
- **กนศ.06 §10 labels the ผู้ทรงคุณวุฒิ row "นักศึกษาเข้าร่วมโครงการ"**, the same
  literal as the row above it, while its tags are `{grandTotalExpert}`. The
  numbers are right and the name over them is not.

Both are one-run template edits of the kind `scripts/patch-head-title.js`
already performed, and both are the university's call. Not changed.

### Deleting a project money has left — refused, and why not cascaded (2026-08-17)

`disbursement` is the only one of the fourteen foreign keys referencing
`project` whose definition omits `ON DELETE`; the other thirteen say `CASCADE`.
`DELETE /projects/:id` therefore answered a bare **500** for any project with a
payment against it.

Made a **409** naming the payments rather than a cascade. "Soft delete — DELETE
FROM project cascades" is the recorded v1 decision, and this is a deliberate
narrowing of it: a disbursement records money leaving the university's account,
and whether an Admin may erase that by deleting the project is a process
question. Refusing destroys nothing while the answer is outstanding; cascading
would be irreversible and is a one-line migration whenever the answer arrives.

### Still open

The two items in "Open items" above that this work did not close remain open:
the **academic year boundary** (June is still a guess, and now also a lockout
risk) and, newly, whether a STUACT may appoint another STUACT. Everything else
on the post-v1 list is built.

### Re-authenticating without leaving the page — open (2026-08-17)

Deviation 23 stops a 401 on a *read* from leaving the user on a dead screen, and
deliberately leaves writes alone, because bouncing away from a half-filled
project form would destroy what is on it. That means a session which expires
while somebody is filling in กนศ.04 still costs them the form: they get the
save dialog and the page intact, they can copy the text out, and the first thing
they click afterwards takes them to the login screen.

What would actually save the work is signing in **over** the page — a dialog
that takes a username and password, replaces the token, and lets the pending
save be retried with the form still mounted. Two things it would have to get
right: the page stays visible behind a blocking dialog, and **the person who
signs in must be the same person**, or a colleague finishes someone else's draft
under their own name.

Not built. It changes what a user of the system experiences rather than how the
code reads, which is the line the owner drew on 2026-08-14 (see "How far Q2
reaches"), so it is theirs to call. Nothing about the current behaviour is wrong
— it is the pre-existing behaviour of the write path, kept on purpose.
