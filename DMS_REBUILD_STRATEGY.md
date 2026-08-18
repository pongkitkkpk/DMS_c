# DMS Rebuild — Build Plan

**Status**: Phases 0–6 complete, plus the five post-v1 features at the end of this file
(2026-08-15) — per-year allocations, the year summary, granting and revoking roles, the
officer's menu, and next-year readiness. v1 is feature-complete against the old system's
screens, with one item deliberately not built (email — see Phase 6). **This is a demonstration
system**: the ICIT integration is out of scope by the owner's decision and `AUTH_PROVIDER=mock`
is where it is meant to stop.
**Supersedes**: the original `DMS_REBUILD_STRATEGY.md` (commit `b8c7d31`), whose five load-bearing premises were each contradicted by the code — see `docs/DECISIONS.md` → "Why the strategy doc is obsolete".
**Last updated**: 2026-08-18

---

## How to use this file

This is the **executable spec** Q1 asked for: what to build, in what order, and how to know
each step is finished. It is not a set of copy-paste prompts, and it does not restate the
research — every phase points into the Phase 0 documents instead.

**Read these first. They are the specification; this file is only the ordering.**

| Document | What it settles |
| --- | --- |
| `docs/DECISIONS.md` | every decision (Q1–Q41), the deliberate-deviations list, open items |
| `docs/schema-current.md` | what the old database actually contains — 15 tables, 843 columns, 11 defects |
| `docs/business-rules.md` | what the old system actually enforces, with `file:line` |
| `docs/domain-model.md` | the vocabulary and the entities |
| `docs/schema-target.md` | the schema — 31 tables across two migrations, full coverage map |
| `docs/template-contract.md` | the Word forms' 1,426 + 241 tags and their arity |

Two standing rules from the decision record govern every phase:

- **Q2 — the old code is the behavioural spec.** When this plan and the old system disagree
  about *behaviour*, the old system wins unless the difference is on the deviations list.
- **Q22 — security and correctness defects are fixed and listed, never fixed silently.** The
  list is in `DECISIONS.md` → "Deliberate deviations from old behavior". Anything added to it
  during the build gets added there, not here.

---

## What changed since the original strategy doc

| Original claim | Reality |
| --- | --- |
| 3 tables | **15 tables, 843 columns** → 29 in the target |
| `POST /auth/login` with bcrypt | **ICIT SSO**; no password store anywhere |
| Flat 4-state status | **7-state Thai phase machine** |
| One generic `template.docx` | **two government forms**; temp04 has 1,426 tags |
| 5 phases, ~6 hours | 6 phases, **weeks** |
| "Migrate the existing data" | **there is no data** — the dump is entirely mock (2026-08-12) |

The last line is the newest and the largest: Phase 1 creates and seeds a schema rather than
migrating one. The extraction work is not wasted — it is the behavioural spec and the
assembler's field map — but the riskiest workstream is gone.

---

## Stack — decided 2026-08-12

**Keep the old stack.** The original strategy doc's TypeScript / Vite / Zustand proposal is
dropped. Rebuilding on the stack the old system already uses keeps the port 1:1 — the old
frontend is the behavioural spec (Q9), and matching its libraries means screens can be read
across directly rather than re-derived.

| Layer | Choice | From |
| --- | --- | --- |
| Language | **JavaScript** (no TypeScript) | old `frontend/package.json` |
| Frontend | React 18 + **CRA** (`react-scripts` 5) | same |
| UI | **Bootstrap 4.6** + `reactstrap` 8 + `react-bootstrap` 2 + `sass` | same |
| Routing | **React Router v5** | same |
| State | React context (`AuthContext`) — no Zustand | same |
| Alerts / HTTP | `sweetalert2`, `axios` | same |
| Backend | Node + **Express 4** | old `backend/package.json` |
| DB driver | `mysql2` | ⚠️ see note |
| Auth | `jsonwebtoken` | same |
| Docs | `docxtemplater` + `pizzip` + **`angular-expressions`** | same — required, the templates embed JS expressions |
| Uploads / mail / API docs | `multer`, `nodemailer`, `swagger-jsdoc` + `swagger-ui-express` | same |
| Database | MariaDB / MySQL | `schema-target.md` uses `GENERATED … STORED` |
| Layout | `backend/` + `frontend/` in `DMS_c` | mirrors the old repo (Q10) |

> **One substitution, stated rather than silent (Q22).** The old backend uses `mysql@2.18`,
> which is unmaintained and cannot negotiate MySQL 8's default authentication. `mysql2` is the
> drop-in successor with the same callback API plus promises. Nothing else changes.

**Visual theme — settled 2026-08-14 by the owner.** The accent is **`#AC3520`**, KMUTNB's own
colour, on warmed neutral greys, with IBM Plex Sans Thai. Stock Bootstrap 4 was explicitly
rejected as an end state: the owner asked for a modern look. **Still no dark mode.**

The original doc's role-based palette (Admin blue, Student green, Adviser amber, STUACT
purple) is **not** carried forward — role is not a mood, and colouring the whole UI by who is
looking makes screenshots and documentation ambiguous.

Everything lives in `frontend/src/theme.css`; components reference `var(--c-*)` and never a
literal colour. Two rules hold there: the accent is for **actions**, never for status (a red
status pill reads as an error), and error red is deeper and cooler than the brand red.

---

## Phase 1 — Foundation

**Goal:** a running skeleton with the real schema, real seed data, and an auth seam — nothing
domain-specific yet.

**Build:**

1. Repo scaffold (Q10): `backend/` and `frontend/`, mirroring the old layout so the port is
   file-for-file.
2. The 29 tables from `docs/schema-target.md`, as ordered migrations. FKs and `CHECK`
   constraints are part of the schema, not a later pass.
3. Seed the reference data:
   - `campus`, `division`, `agency`, `work_group`, `club_group`, `club`, `award_category`
     from `frontend/src/views/setCode.json` (Q34). The importer must handle **all four shapes**
     that file uses — see `domain-model.md` → "The organisation".
   - Fix the known taxonomy typos during seed and **log every correction** (Q36).
   - `phase` (7 rows, Q40) and `phase_transition`, seeded from the gate table in
     `business-rules.md` → "Where the rules actually live".
   - `tag_set` / `tag` for the 8 checkbox vocabularies.
4. `AuthProvider` interface with `AUTH_PROVIDER=mock|icit` (Q3, Q17). Mock returns ICIT's real
   response shape. **The role comes from a `membership` lookup, never from the provider** —
   see `business-rules.md` → "Why the token could not carry a role".
5. Fixture data: one user per role with a realistic club and year (Q17), plus enough projects
   to put at least one in each of the seven phases.

**Done when:** the schema applies from empty, the seed runs idempotently, `GET /me` returns a
role resolved from the database, and every FK in `schema-target.md` exists. No project
endpoints yet.

> **Phase 1 is complete (2026-08-13).** All four conditions verified. The auth seam's shape,
> what was tested, and the one part that could not be tested (`icit.js` — no API access) are
> written up in `docs/DECISIONS.md` → "Phase 1 close-out". Two things Phase 2 inherits:
> `req.actor` (person + memberships + primary role, resolved per request by
> `src/middleware/requireAuth.js`) is what routes authorize from — never a path parameter —
> and roles are scoped by academic year, which is now an open item in the same file.

**Watch for:** Rayong has zero clubs in `setCode.json` (`domain-model.md` open question 4) —
the seed should report that rather than silently produce an empty campus.

---

## Phase 2 — Projects and the lifecycle

**Goal:** create, read, edit and advance a project, with the rules enforced on the server.

**Build:**

1. Project CRUD against the normalized tables. **Explicit field allow-lists on every write** —
   this replaces the 14 `UPDATE … SET ?` sites listed in `business-rules.md` (deviation 2).
2. **Scope from the token, never from a path parameter** (Q16, deviation 1). Every list and
   fetch resolves the club or club-group from the caller's `membership`.
3. Server-side numbering (Q18/Q29, deviation 3): `draft_sequence` at creation,
   `project_sequence` + `project_number` at `PROJECT_APPROVED`, both issued inside the
   transaction that needs them, both `UNIQUE (club_id, academic_year)`.
4. The phase machine as a real transition table with guards, replacing "the next element of
   the array". Every transition writes `project_event` in the **same transaction** as the
   phase change (Q15, Q28).
5. Every handler responds. Six of the old ones never called `res.send()`
   (`business-rules.md` → "Transitions"); the UI announced success regardless.

**Done when:** a project can be walked 1 → 7 by the correct roles and cannot be walked by the
wrong ones; a wrong-role or wrong-scope attempt returns 403 from the server with the frontend
disabled; two projects in one club-year cannot receive the same number; and the event log
replays into the current phase.

> **Phase 2 is complete (2026-08-13).** All four conditions verified by
> `backend/scripts/check-phase2.js` (`npm run check:phase2`) — 55 checks against a live
> server. Details, and the one rule that is a judgement call rather than a port, are in
> `docs/DECISIONS.md` → "Phase 2 close-out". Wrong **scope** answers 404 rather than the 403
> written above — deliberately, so a refusal cannot confirm that another club's project
> exists. The `requires_budget_check` transitions now enforce; the walk in `check-phase2.js`
> states a plan and an approved amount before the two money gates because of it.

---

## Phase 3 — Budget

**Goal:** the enforcement that has never existed. This is a subsystem, not a feature.

**Build:**

1. `budget_line` write paths for both variants, with `amount` left to the `GENERATED` column.
2. `agency_allocation` entry for Admin and STUACT (Q30); Adviser and Student read-only.
3. The three checks (Q20/Q25/Q32), each with its own message:
   - (a) `requested_total ≤ planned_amount`
   - (b) `disbursed_total ≤ approved_amount` and `actual_total ≤ approved_amount`
   - (c) `Σ approved_amount over the club-year ≤ agency_allocation.amount`
4. **Warn** on draft submit; **hard-block** at the three transitions flagged
   `requires_budget_check`; **re-check on every budget write**, not only on transitions (Q26).
5. Layer (c) takes `SELECT … FOR UPDATE` on the allocation row inside the approving
   transaction (Q28). Lowering an allocation below committed spend stays allowed, loudly (Q33).
6. `disbursement` is append-only. `remaining` is a subtraction over the view, never a column.

**Done when:** each of the three limits can be demonstrated to block, with distinct errors;
concurrent approvals against one allocation cannot both succeed; and no stored total exists
that could disagree with its components.

> **Phase 3 is complete (2026-08-14).** All three conditions verified by
> `backend/scripts/check-phase3.js` (`npm run check:phase3`) — 65 checks against a live
> server, plus a separate stress run of eight simultaneous approvals against a ceiling with
> room for three, which landed exactly on the ceiling every time.
>
> `src/services/budgetService.js` owns the limits and says in its header which gate enforces
> which; `allocationService.js` owns the ceiling. A refusal answers **422** with
> `budgetViolations` — every violation, not just the first. Decisions taken along the way,
> including the two that are judgement calls rather than ports, are in `docs/DECISIONS.md` →
> "Phase 3 close-out".
>
> Two notes for Phase 4. The `project_budget_status` view is **no longer on any request
> path** — a view cannot be locked, so the service reads the components directly; the view is
> still the right shape for the assembler's SQL-level reads. And `budget_line` now carries
> both variants for every project, which is the plan-versus-actual pairing กนศ.06 needs.

---

## Phase 4 — Document assembly

**Goal:** produce กนศ.04 and กนศ.06 that a government office would accept.

**Build:**

1. The assembler: domain objects → the flat ~433-field payload the templates expect (Q4/Q7).
   `docs/template-contract.md` is the field map. The templates themselves are **untouched**.
2. Derive at render time everything the old schema stored: Thai date strings (41 columns),
   Gantt `startM`/`endM` indices (30 columns), and every subtotal.
3. **Arity validation** (Q8): error clearly when a project exceeds what a form can print
   rather than truncating. The known live case is `BT` — 20 rows stored, 12 printed.
4. Fix the three render-path defects in `template-contract.md` → "Defects found in the render
   path": the missing `budget` key that blanks the approved total on every กนศ.06, the
   unguarded division that emits `Infinity%` / `NaN%`, and the malformed `grandTypeETC` tag.
5. Downloads are authorized and phase-checked. The old routes had neither
   (`business-rules.md` → "Document generation").

**Done when:** both forms render fully populated from a fixture project, every tag in the
contract is either filled or deliberately blank, and an over-capacity project produces an
error naming the category and the limit.

**Watch for:** `angular-expressions` must be installed — the templates embed JS. Its absence
was the original strategy doc's most concrete omission.

> **Phase 4 is complete (2026-08-14).** All three conditions verified by
> `backend/scripts/check-phase4.js` (`npm run check:phase4`) — 64 checks, half in-process
> because the contract check compares payload keys against the extracted inventory, half over
> HTTP for the download path and its gates.
>
> The 433-field mapping the contract said was never written is now **generated**:
> `npm run templates:tags` produces `docs/template-tags.json` from the `.docx` bytes, including
> which payload root each field is read from — the thing that cannot be guessed from names, and
> the thing whose absence let กนศ.06's approved total print blank for years. The arity limits
> are read from that file, so replacing a template moves them.
>
> The templates are **byte-identical** to the originals and the acceptance run asserts their
> MD5s. The one defect that could not be fixed from the payload — temp04's second Gantt grid
> testing `||` where it means `&&` — is quantified in `docs/template-contract.md`, open item 2,
> and needs a decision about editing the form itself.

---

## Phase 5 — Frontend

**Goal:** parity with the old screens, in the new stack.

The old frontend is the behavioural spec (Q9). Its real screen list — not the original doc's
invented component list — is in `DECISIONS.md` → "Old frontend screens":

`AllProject`, `Dashboard`, `ProjectDocument`, `NewProjectDocument`, `DetailBudget`
(+ Admin/Student variants), `DAddSplitBudget`, `DTableAddBudget`, `TableAdd/ListStudent`,
`TableAdd/ListPersonel`, `Login`, `UserProfile`, `ArrowProgressBar`.

**Build:** three roles to parity first — Student, STUACT, Admin. Adviser is one read-only
screen (Q5); the **review queue is new scope and is out of v1**.

Thai UI copy, English identifiers, no i18n framework (Q11).

~~**Theming: stop and ask before choosing any palette.**~~ Settled — see "Visual theme" above.

**Already built, out of order:** login, the project list, one project (phase strip, transition
controls, child lists, event log), the budget panel — figures, the three limits as meters, both
variants' line items, and the disbursement ledger — and the document card, which offers both
forms and shows the server's own reason when one cannot be produced. That covers
`DetailBudget`, `DAddSplitBudget` and `DTableAddBudget` in one screen rather than four, and
replaces the old download buttons.

~~**Known gap, deliberate:** there is no allocation screen.~~ **Closed** — it is the dashboard.

**Done when:** every screen above works for its roles against the real API, and no screen
relies on `sessionStorage` for an authorization decision.

> **Phase 5 is complete (2026-08-14).** `backend/scripts/check-phase5.js`
> (`npm run check:phase5`) — 48 checks, plus a browser pass over the real app.
>
> The screen list is covered: `Login`, `AllProject` (the list), `ProjectDocument` (the project),
> `NewProjectDocument` **and** the `TableAdd/List*` screens (one create/edit form),
> `DetailBudget` + `DAddSplitBudget` + `DTableAddBudget` (the budget panel), `Dashboard`,
> `UserProfile`, `ArrowProgressBar` (the phase stepper). The review queue stays out of v1 (Q5).
>
> **The second half of "done when" is the half a script can prove**, and it is proved the only
> way that means anything: by making the requests each screen makes, as each role, and checking
> the server refuses the ones it should. A screen that hides a button proves nothing. Every
> control on every screen is drawn from a `permissions` object the server computed by asking
> the same assertions its writes run (`scope.permits`), so the client cannot offer an action the
> server would refuse or hide one it would allow.
>
> Three defects came out of the browser pass that the compiler and the API tests both passed:
> a create form that opened with eight empty lists and no row to type in, a wrapping label that
> broke its grid row, and a column of accent-red buttons on the least urgent action on the
> dashboard. That is the third browser pass in a row to find something, and the reason to keep
> doing them.

---

## Phase 6 — Hardening

1. Remove the double router mount and the inline `server.js` route group — the seven
   unauthenticated handlers at `server.js:158-376` have no equivalent in the new API and must
   not be recreated by accident.
2. Attachment serving behind authorization, relative paths only (Q21).
3. Real email notification. The old one hardcoded a recipient and used a disposable mailbox;
   treat it as a new requirement, not a port (`business-rules.md` → "Notifications").
4. Indexes and an `EXPLAIN` pass. The old schema had five secondary indexes total.
5. Re-read `DECISIONS.md` → "Deliberate deviations" and confirm each is both done and listed.

> **Phase 6 is complete (2026-08-14)** — `npm run check:phase6`, 53 checks — **except item 3,
> which is deliberately not built.** This is a demo with no mail server, and a notification
> path that either fails on every transition or silently does nothing is worse than one that
> visibly does not exist. Nothing imports a mailer, and the run asserts that, so the absence
> cannot drift into a half-present feature.
>
> Item 1 is now checked rather than remembered: no `express.static` anywhere, no route on the
> app but the health probe, every router mounted once.
>
> Item 2 is the substance. **There is no static mount** — the old system had one over its
> upload directory, which made a guessable filename anyone's document. The client's filename is
> a label and never a path, stored paths are relative and resolved under a root fixed once in
> `config`, the allowed types are an allow-list, and every download is
> `octet-stream` + `attachment` + `nosniff` so an uploaded `.html` cannot run in this origin.
> A real bug surfaced here: multer reads the multipart filename as latin1, so Thai filenames
> arrived mangled — repaired, with the repair guarded and tested.

---

## Before Phase 1 starts

Four assumptions in `schema-target.md` need an explicit yes or no. Three are low-risk; one
changes a previously settled answer.

| | What | Risk if wrong |
| --- | --- | --- |
| **A1** | Q37 — money is `DECIMAL(12,2)` | low; no data to convert |
| **A2** | Q38 — surrogate `INT` PKs, `project_number` a separate business key | low |
| **A3** | Q41 — disbursement ledger built on today's `logstudentgetmoney` shape | low |
| **A4** | Q39 **revised** — `person` and `membership` split, so one person may hold several roles | **settled 2026-08-15** — confirmed by the owner; no longer an assumption |

The stack and the theme are **settled** (see "Stack" above). A1–A3 proceeded as written — with
no data to migrate the cost of being wrong is a schema edit, not a re-migration. ~~**A4 is the
one still worth a deliberate look**~~ — **A4 is now confirmed (2026-08-15): one person may hold
several roles, so the split is permanent.** All four assumptions are closed; nothing in this
section is still waiting on an answer.

---

## What is explicitly not in v1

Recorded so the gaps are decisions, not oversights.

- The **review queue** (Q5) — adviser stays a single read-only screen.
- **Award categories** `D06`–`D12` — seeded, no workflow, pending confirmation the feature is
  wanted (`domain-model.md` open question 2).
- **Soft delete** — `DELETE FROM project` cascades.
- **Database-level row security** — scope is an application invariant enforced from the token.
- **i18n** — Thai copy, hardcoded (Q11).

---

## Requested and parked (2026-08-15)

Four things the owner asked for, to be built later rather than now. Written down
with what the code already does for each, so picking them up does not start with
re-reading the codebase.

**All four are built (2026-08-15), in the order 2 → 3 → 4 → 1** — the menu last,
so it was drawn around screens that existed. `check:all` went from 285 to 332.

**What these four opened up:**

1. ~~**Revoking a role.**~~ **Built 2026-08-15** — see item 4.
2. **Where the academic year comes from** — still `ACADEMIC_YEAR` in `.env`, by
   the owner's decision, and now the largest thing in this list that is a
   deliberate hold rather than an oversight. See item 2.
3. **Whether STUACT may appoint another STUACT.** Currently no; the reasoning is
   under item 4 and it is one line to change.
4. ~~**Nothing reminds anyone to set up a new year.**~~ **Built 2026-08-15.**
   `GET /readiness` (`historyService.nextYearReadiness`) reports next year's
   state in the caller's scope — how many clubs have a ceiling, a student head
   and an adviser — and the dashboard shows it to ADMIN and STUACT until all
   three are complete.

   **Deliberately state, not a deadline.** Nagging in June would mean trusting
   the June boundary, which is still the unconfirmed guess in the open
   questions; a reminder built on a guess about when the year turns is a
   reminder that is wrong once a year. This reports what is prepared and lets
   the reader decide whether it is early. It also means (2) can stay parked
   without the reminder being wrong.

   The counts are per club, not per person: what matters is whether each club
   has somebody who can act, not how many people hold cards. The dashboard
   fetch is `.catch(() => null)` — a banner that cannot be computed must not
   take the dashboard down with it.

### 1. The officer's screen needs a menu — **built 2026-08-15**

The nav was two links — ภาพรวม and โครงการ — which was enough while every role had
the same two screens. Built last on purpose, and that paid: the menu was drawn
around three screens that existed rather than three that were imagined.

Five entries, in the order a year is worked through — ภาพรวม, โครงการ,
วงเงินจัดสรร, สรุปรายปี, สิทธิ์ — from a `NAV` table in `App.js`.

**Only `/roles` is role-filtered**, and by the same two roles the server
enforces. Allocations and the year summary are readable by everybody in scope
(Q30 — a student may see their own club's ceiling, they simply cannot set it),
so hiding them would have made the nav claim a restriction the API does not
have. A person holding no membership sees every entry and finds every list
empty, which is the honest answer.

**The layout work was the real content of this item, and it took measuring to
get right.** Five Thai labels next to a long brand, a name, a scope line and a
sign-out button do not fit on one row, and two rounds of guessing made it worse
before the numbers settled it:

| | width |
| --- | ---: |
| brand (mark, name, year) | 286 |
| nav, five entries | 400 |
| user chip | 276 |
| sign-out | 118 |
| gaps + padding | 112 |
| **needed** | **1192** |
| **`.app-bar__inner` max-width** | **1140** |

Short by 52px, and — the decisive part — `max-width` means **a wider screen
never helps**, so the media query that hid the brand's name below 1100px could
not have worked at any size. On one row, something had to be permanently
deleted: the app's own name, or the meaning of the nav labels.

So the nav gets its own row. Every label stays whole, the top row has room to
spare, and the bar aligns exactly with the content column below it. The cost is
about 40px of vertical chrome, which is the cheaper thing to spend.

Two real bugs found on the way, both introduced by the earlier guesses:

- `min-width: 0` on `.app-brand` plus `white-space: nowrap` and no `overflow`.
  Text that cannot wrap and is not clipped does not stay in its box — the brand
  name was painted straight across the first nav link.
- `.app-brand__mark` had a 32px width but no `flex: none`, so as a flex child it
  was squeezed narrower than it was tall and the มจพ inside it clipped.

The rule now: nothing in the bar shrinks, and every `nowrap` is paired with an
`overflow`.

### 2. Allocations are per academic year, and each year is set fresh — **built 2026-08-15**

**The data model already did this.** `agency_allocation` carries `academic_year`,
`allocationService.listAllocations` accepted a `year` filter, and the money rules
already sum approvals per (club, academic year) — budget layer (c). So this was a
screen gap, not a schema change, and that is how it was closed.

What was built:

- **`/allocations`** (`frontend/src/pages/AllocationsPage.js`) — one year at a
  time, chosen in the page head and carried in the URL so a year can be
  bookmarked. The edit writes to the *selected* year, not the ambient
  `session.academicYear`, which is the whole point of the screen. Viewing a year
  that is not the current one says so in a notice rather than doing it quietly.
- **`listAllocations` now answers with `years`** — a range to *offer*, not an
  inventory of what exists. It unions the years in scope with the current year
  and **the year after it**. Without that last part a fresh year is unreachable
  until it has been funded and cannot be funded until it is reachable, so next
  year could never be set up in advance — found by opening the page, not by any
  test. Ten assertions in `check-phase3.js` cover it.
- **The latent bug below is fixed.** The dashboard now passes
  `{ year: session.academicYear }` and names the year in the card title, with a
  "ดูรายปี →" link to the new page.

> ~~**There is a latent bug waiting here.**~~ **Fixed 2026-08-15.** The dashboard
> called `api.allocations()` with no year, and the query orders by
> `academic_year DESC` and returns *every* year the actor may see. With only 2567
> seeded it looked correct; the moment a second year existed the table grew a
> second row per club, indistinguishable because the table has no year column.
> The fix pins the dashboard to one year rather than adding the column — a card
> titled "ปีการศึกษา 2567" that shows exactly that year is clearer than a mixed
> table that explains itself per row, and the year-by-year view now has a page of
> its own.

**Where the year comes from — settled 2026-08-15: `ACADEMIC_YEAR` in `.env`
stays, for now.** The owner's call. It is still the guess recorded in the open
questions — that the academic year turns over in June — and a year that must be
"set fresh" each year is a poor fit for an environment variable someone has to
remember to edit. But `config.academicYear` is what `requireAuth` resolves every
membership against, so getting it wrong gives *every* user `role: null`, and that
is a change to make deliberately rather than as a side effect of building a
screen. Revisit it as its own piece of work, not inside item 3.

**Past years may be written — settled 2026-08-15: allowed, but warned clearly.**
Also the owner's call, and the same bargain Q33 strikes over the amount, applied
to the year: correcting a figure is legitimate, doing it quietly is not. So the
server stays permissive (`assertCanEnterAllocation` checks *who* and *which
club*; nothing checks *which year*), and the loudness is on the screen:

- viewing a past year raises a `notice--warn` banner naming it, distinct from the
  plain informational banner for planning next year;
- and the edit itself asks a second time before opening the amount, because by
  the time an officer has scrolled to a club and clicked, the page banner is off
  screen.

Note that this is deliberately *not* the same answer as item 4's year question.
Rewriting a number that projects were judged against is recoverable and visible;
granting a role in a past year hands out authority. Decide that one separately.

### 3. A page summarising previous years — **built 2026-08-15**

It did follow directly from item 2, and the figures did already exist. What was
built:

- **`GET /api/history`** (`backend/src/services/historyService.js`,
  `routes/history.js`) — one row per academic year: allocated, committed,
  remaining, how many clubs were funded, how many are over their ceiling, and
  the project count per phase. Read-only, scoped by the same two clauses the
  single-year screens use, and every figure summed on read so a year's summary
  cannot drift from the rows under it.
- **`/history`** (`frontend/src/pages/HistoryPage.js`) — two tables, money and
  phase distribution. They are both per year but read at different widths (four
  numbers down a column against seven across a row), so interleaving them makes
  both harder to read.
- A year in either table links to the screen that owns it. Nothing on the page
  can be edited.

Two details worth keeping:

- **The over-committed count is per club, not per year.** A group whose total
  allocation covers its total approvals can still contain a club that has
  overspent, and rolling that comparison up to the year would hide exactly what
  Q33 exists to keep visible. So the year reports both.
- **A year qualifies on either side** — it has allocations, or it has projects,
  or it is the current year. Requiring both would drop the two states that
  matter most at the edges of a year: money set aside before any project exists,
  and projects created before the ceiling is set, which is the state that blocks
  their first approval.

**Also fixed on the way through:** `listProjects` had always accepted a `year`
filter and no screen had ever sent one, so the summary's link to a year's
projects would have quietly listed every year. `ProjectsPage` now honours
`?year=`, names it, and offers a way out — there is no selector for it, because
it is a filter you arrive with rather than one you would go looking for. Both
URL filters now survive each other.

Twelve assertions in `check-phase5.js`. The valuable ones cross-check the
summary against the single-year screens: the two read different tables, so
agreement is evidence rather than tautology.

### 4. A page for adding roles, usable by ADMIN and STUACT — **built 2026-08-15**

The biggest of the four, and the one that touches decisions already made.

`membership` is what grants a role, and A4 in this document deliberately split
`person` from `membership` so one person can hold several roles across years —
that split is what makes this page buildable at all, and it is now confirmed
rather than provisional (2026-08-15), so the form must let one person accumulate
roles rather than treating a second one as replacing the first. But roles are currently
*seeded*, never created through the API, so this needs new write endpoints, and
those endpoints hand out authority. Two things to decide before building:

- ~~**Can STUACT create a role outside its own jurisdiction group?**~~
  **Settled 2026-08-15: no, only inside its own.** So the scope rules that guard
  projects now guard membership writes too (`scope.assertCanGrantRole`).
- ~~**Can a role be granted for a past or future academic year?**~~
  **Settled 2026-08-15: next year yes, a year that has closed no.** Preparing
  next year is planning; backdating a role hands someone authority over projects
  that were already decided, and unlike a corrected allocation there is no
  figure to compare afterwards. Note this is deliberately *not* the same answer
  as the allocations screen got for the same-shaped question.

**What was built**

- **`scope.assertCanGrantRole` + `GRANTABLE_ROLES`** — ADMIN may grant anything;
  STUACT may grant `SH` and `AD`, and only inside its own jurisdiction.
- **`membershipService.js`** — list (per year, scoped), search people, create.
- **`routes/memberships.js`** (`GET/POST /api/memberships`, `GET /api/people`)
  and **`GET /api/reference/club-groups`** for the jurisdiction selector.
- **`/roles`** (`frontend/src/pages/RolesPage.js`). `grantableRoles` and
  `grantableYears` come from the server, so the form cannot offer a choice the
  server will refuse, and the confirmation names person, role, scope and year in
  full before writing.
- `HttpError.conflict` (409), so granting the same role twice is a refusal
  rather than a silent success.

~~**A decision made rather than asked:** STUACT may not grant `STUACT`.~~
**Revised 2026-08-15 — the owner's answer: a STUACT may appoint another STUACT.**

It was not one line in `GRANTABLE_ROLES`, and the reason is the escalation the
original note worried about. A `STUACT` membership carries a *jurisdiction* and
no club, while `assertCanGrantRole` only knew how to check a club — so the naive
change would have refused every such grant with a message about clubs. Worse, a
version that "fixed" that by skipping the check would have let an officer appoint
a colleague into **another** group, reaching it in two steps while every
individual call still passed.

So the rule the owner already set is applied to this role too: **a STUACT may
appoint another STUACT into its own jurisdiction and no other.** Appointing a
colleague beside you extends nobody's reach. `ADMIN` is still ADMIN-only.

One consequence worth knowing: the self-revoke guard is now the rule that stops
a STUACT removing its own membership. It used to be stopped one step earlier by
the role check, so widening what an officer may hand out also widened what that
guard has to catch — `check-phase5` records the change.

**Revoking — added 2026-08-15**

The row is deleted and the record kept in a new `membership_event` table
(migration `002`). The owner chose this over a `revoked_at` column, and the
reasoning holds up: a soft-delete would put `revoked_at IS NULL` on the
conscience of every read across the twenty files that touch `membership`, and
one missed filter is a revoked person still holding their role. Deleting cannot
fail that way.

What made it safe was already true and had not been noticed: **nothing in the
schema references `membership`.** Every other table points at `person`, so a
project's owner, an event's actor and an approval's approver all outlive the
membership that authorised them. And because `requireAuth` re-reads memberships
every request, access ends on the person's next click rather than at token
expiry.

Three refusals, in `revokeMembership`:

1. only roles the actor could have granted — the same rule as creating one;
2. never the membership you are acting under (another officer removes you);
3. never the last `ADMIN` of a year — **unreachable today**, and labelled as
   such in the code, because (1) and (2) already guarantee one survives. It is
   kept because "let an officer stand themselves down" is a reasonable-sounding
   future request, and this is the only thing between that change and a system
   with no ADMIN that nobody could ever grant a role in again.

`GET /memberships/events` reads the log back, scoped like the memberships are,
and the roles screen shows it. A record nobody can read is a record nobody
trusts, so it shipped in the same change rather than being left for later.

One consequence worth knowing: revoking an `AD` does not touch
`project.advisor_person_id` — that is a `person` reference and stays valid — but
`assertAdvisorIsValid` re-checks the adviser's membership on every save, so
those projects cannot be edited until a different adviser is named.
`GET /memberships/:id/impact` returns the count and the confirmation dialog says
it, because nothing about a button labelled "ถอน" would suggest it.

**One thing it deliberately cannot do**

- **Create a person.** Identity belongs to ICIT: `person` rows are written on
  login and nowhere else (`identityService`). So a recipient is searched for,
  not typed in — they sign in once holding nothing, which is a supported state,
  and then they can be found. `GET /people` is a search with a three-character
  minimum rather than a listing, because an endpoint answering "everyone" would
  be a directory export available to any officer.

Twenty-three assertions in `check-phase5.js`, most of them refusals — this is
the only endpoint that creates authority rather than spending it.

---

## Browser pass 5 (2026-08-15)

Every screen in every role after the eight changes above. Two defects, both
invisible to 363 passing checks and to a clean build, and both created by this
session's own work rather than inherited.

1. **An Admin's dashboard was 6.3 screens tall, 89% of it one table.** The
   allocation card listed every club in scope with a button each — 69 rows for
   an Admin, 68 of them repeating "ยังไม่ได้กำหนดวงเงิน" and pushing the phase
   counts, the over-committed warning and the readiness banner off the top of a
   page called ภาพรวม. That listing was right when the card was the only route
   to an allocation; `/allocations` made it duplication. The fact is kept as one
   counted line with a link, and the page is back to a single screen.

2. **`/history` offered "กำหนดวงเงิน →" to advisers and students**, who may read
   a ceiling and never set one (Q30). It sent them to a page with every control
   hidden and "อ่านอย่างเดียว" in the header — an invitation to do something the
   system had already decided they may not. The label now follows the role.

Checked and not a defect: the project detail, the project list and the forms all
render correctly under the two-row bar; an Admin sees no scope line in the page
head, which is right, since Admin has neither a club nor a group; the year picker
offers next year to read-only roles, which is honest rather than misleading —
they get an empty table and a plain reason.

**Method note.** Signing in through the form was flaky all session and cost many
retries; posting to `/api/auth/login` and putting the token straight into
`sessionStorage.dms.token` is reliable and much faster for a sweep like this.

---

## Security review of the session's new surface (2026-08-15)

Eight endpoints were added quickly in one session, two of them creating or
describing authority, so the new surface was audited on its own terms rather
than trusted because the checks were green.

**Structure — clean.** Every router but `auth` carries a blanket
`router.use(requireAuth)`, and `auth` authenticates `/me` per route while
`/auth/login` is public by design. No SQL in the new services interpolates user
input: every `${…}` reaching a query is a server-built fragment (`visibility.sql`,
allow-listed column lists, `FOR UPDATE`), and values go through placeholders.

**Two real findings, both fixed.**

1. **`GET /memberships/:id/impact` checked the caller's role but not their
   scope.** A STUACT could ask about any membership id — another jurisdiction's,
   or the Admin's — and for a foreign `AD` would have been told how many
   projects that club has. Deviation 1 reached through a membership id instead
   of a club id. It now runs `assertCanGrantRole` against the target, so it
   refuses in exactly the cases revoking it would, and an unknown id is 404
   rather than an indistinguishable `{projects: 0}`.

2. **`GET /people` leaked what it did not need.** It returned `email`, which no
   screen used, from a name search across every human who has ever signed in;
   dropped. And the search term's `%` and `_` were passed into `LIKE`
   unescaped — parameterised, so not an injection, but `q=%%%` matched everyone
   and made the three-character minimum meaningless. Escaped now, so the
   endpoint is the search it claims to be rather than the listing it refuses to
   be.

**Indexes — measured, and deliberately not added.** `agency_allocation` is now
filtered by `academic_year` alone, which `uq_allocation` cannot serve as a range
because `club_id` leads it. The table grows by one row per funded club per year
— 69 clubs institution-wide, so a few hundred rows after a decade — and a scan
of that is not worth a migration. Recorded because it was checked, not because
it needs doing. `membership_event`'s own indexes cover both the per-person and
the newest-first reads.

---

## Year-rollover rehearsal (2026-08-15)

The five post-v1 features exist so a year can be prepared before it starts.
Nobody had ever run a year that was. This does, and it found something nothing
else could have.

**Method — no file is edited.** `dotenv` does not overwrite variables already in
the environment, so the server can be moved to another year for one process:

```
# prepare next year through the API, as an officer would — allocation + roles
ACADEMIC_YEAR=2568 npm start          # in place of `npm start`
```

Then sign in as each fixture and look. Do not run `check:all` during a
rehearsal: it reseeds between suites and will erase the prepared year.

**What held.** All four prepared roles resolved in the new year, and
`fixture.otherstudent` — whose club was not prepared — came back `role: null`,
which is the "known and permitted nothing" state working as designed rather
than an error. Numbering restarted: the first project of the new year is draft 1.
The readiness banner moved itself on to 2569. The allocations screen, the roles
screen and the money rules all followed the year without being told.

**What did not.** The dashboard's phase tiles were not year-scoped. The page
header said 2568, the allocation card said 2568, and the tiles counted **eight
projects across two years, of which one was 2568's** — the same defect fixed for
allocations earlier the same day, still present for projects and invisible until
a year actually turned. A year's overview that quietly includes every previous
year is worse than no overview, because it looks like an answer. Fixed, and the
tiles now carry the year into the list they open, so the list shows the number
the tile promised.

**Worth repeating** before any real rollover, and worth repeating for 2569 once
2568 has data in it — the interesting cases are the ones where both years are
non-empty.

---

## The lockout, and the way back (2026-08-15)

A second rollover rehearsal — this time into a year *nothing* had been prepared
for — found the most serious thing in this file. It is not a bug in any one
place. It is three decisions, each right on its own, meeting one weak point.

- A role is a `membership`, and a membership belongs to one academic year.
- The token carries no role: `requireAuth` resolves it per request against
  `config.academicYear` (deviation 11 — a signed role goes stale).
- The `.env` admin fallback supplies **identity only** and cannot mint a role,
  which is what defanged the old system's backdoor.

The weak point is that `ACADEMIC_YEAR` is a value a person edits. **Move it to a
year nobody was prepared for and every account resolves to `role: null` —
including the Admin — and granting a role requires an Admin.** Proven, not
reasoned: with a server on an unprepared year, `POST /memberships` and
`PUT /allocations` answer 403 for every fixture account, and the fallback cannot
help by design.

**The way back:** `npm run grant:admin -- --user <id_student> --year <year>`.
Not a backdoor — it needs shell access and the database credentials, and anyone
holding those could already write the row by hand. What it adds is doing it
correctly: it refuses to invent a person (identity stays ICIT's), refuses to
grant twice, and writes the same `membership_event` an API grant writes, so a
console grant is exactly as visible as one made on a screen. Its signature in
the log is `person_id = actor_person_id` — the recipient as its own actor, which
is the honest description, since nobody in the system authorised it.

Seven assertions in `check-phase6.js` exercise it end to end rather than
asserting the file exists.

**This also raises the stakes on the parked `ACADEMIC_YEAR` question** (item 2
above). It is not only awkward that the year lives in `.env`; editing that one
line at the wrong moment is the single action that can lock the system, and the
readiness banner is what stands between an institution and that mistake.

---

## The academic year moved into the database (2026-08-15)

The owner's call, taken once the lockout above made the stakes clear: the year
is a row an Admin changes from a screen, not a line in `.env`.

**Auto-rollover was rejected, and the lockout is why.** Deriving the year from
the date would move the system into a new year at midnight with nobody
deciding — and if that year had not been prepared, the system would lock itself
while everyone was asleep. The June boundary is also still an unconfirmed guess.
Manual is not merely more controllable here; automatic is actively dangerous.

**The guard is the point of the whole change.** `setAcademicYear` refuses to
enter a year with no `ADMIN` membership, because on arrival nobody could grant
one. That single refusal turns the lockout from a documented hazard into an
impossible one — through the supported path. `npm run grant:admin` remains for a
database that got into that state some other way.

Everything else about readiness stays a warning rather than a refusal: a year
may legitimately open with clubs still unfunded; it may not open with nobody
able to fund them.

**Three sources, in order** (`academicYearService`): `ACADEMIC_YEAR` in the
environment wins and makes the screen read-only — that is the rehearsal and
break-glass path, and `.env.example` says so; then the `academic_year_setting`
row; then the date, reached only before the row exists.

**Once a year, not once a term.** Roles and allocations are per year;
`project.academic_term` carries the term separately. Rolling per term would
halve every club's ceiling mid-year.

**A rename that came out of it.** `config.academicYear` is no longer the truth
and is now `config.fallbackAcademicYear`. The rename was not tidiness — a check
script kept reading it and compared a date-derived 2569 against a system sitting
at 2567. A value that stops being authoritative should stop being named as if it
is.

**Also fixed on the way:** `db:seed` did not clear `membership_event` or
`academic_year_setting`, so a re-seed left rows pointing at deleted people.
Invisible while every run went through `migrate --fresh`, which drops the tables
outright.

Thirteen assertions in `check-phase6.js`, including that the move reaches
`/api/health` and `/api/me` and not merely the settings endpoint — this is the
one value every request resolves a membership against.

---

## Probing the widened authorization surface (2026-08-16)

Both of the last two changes touched the core of authorization — the academic
year moved into `requireAuth`'s resolution path, and `assertCanGrantRole` gained
a role — so the new surface was probed adversarially rather than trusted.

**Escalation to `ADMIN` is closed on every route tried.** A STUACT granting
itself `ADMIN` directly, with a club attached, or for next year: 403, 400, 403.

**One real defect, created by the widening itself.** A STUACT could appoint a
fellow officer and then never see them: `listMemberships` filtered to
`club_id IS NOT NULL`, which was right when club roles were all it could grant.
The result was a **write-only grant** — you can create a colleague you cannot
list and cannot revoke — which is worse than not being allowed to grant at all.
What an officer may list is now exactly what it may hand out: the club roles in
its jurisdiction, plus that jurisdiction's officers.

**One small trim.** `GET /academic-year` returned who last moved the year, and
when, to anybody signed in — including a person holding no membership. Which
year you are in is on every screen already; who moved it is operational detail
for the people who could move it, so it is officers-only now.

### An open question this raises, for the owner

**A STUACT may grant itself `SH` of a club in its own jurisdiction** — allowed
today, and A4 explicitly permits one person to hold several roles. But `SH`
creates projects and `STUACT` approves their money, so one person holding both
can approve their own request. `assertCanApproveBudget`'s comment says
"approving one's own request is the thing this exists to prevent", and with
multi-role memberships that is now only true of the *role*, not of the *person*.

Not changed, because it is a policy question rather than a bug: separation of
duties may or may not be something this university enforces, and an ADMIN could
always do the same. Worth an explicit yes or no.

---

## The roles screen was quietly degrading the forms (2026-08-16)

The government forms are what this system exists to produce, and they had not
been looked at once while the roles screen was built. They should have been.

`assembler.js` prints `AgencyAdvisor` on กนศ.04 from the adviser's
`membership.advisor_agency`. The seed always set it. **The roles screen never
asked for it**, so every adviser appointed through the new page — the only way
an adviser can be appointed now — produced a document with an empty box where
the fixtures produced a filled one. Nothing failed, nothing warned, and 394
checks passed: the field simply came out blank on a form destined for a
government office.

Now required, in the service rather than only in the form, and collected on the
screen when the role is `AD`. Required rather than defaulted because nobody but
the appointing officer knows the answer, and a plausible-looking wrong agency on
a submitted form is worse than a refusal at the moment of granting.

**What this says about the rest of the work.** Every feature built today was
verified against the API and the screens, and this one was correct at both
layers while being wrong at the layer that matters most. Two things the
assembler had already got right are worth noting as the counter-example: the
adviser's agency is read through a correlated subquery scoped to `role = 'AD'`,
this club and this year — written that way *because* one person may hold several
memberships, before A4 was even confirmed — so the multi-role work of this
session did not disturb it.

Worth a pass of its own before release: generate both forms from a project whose
people were all appointed through the screens rather than seeded, and read them.

---

## Reading the forms (2026-08-16)

`npm run forms:read -- --project <id> [--as <username>]` renders a project's
กนศ.04 and กนศ.06 and prints them as text. It exists because until now nothing
could look at the system's actual output without opening Word — and the previous
entry in this file is a defect that survived 397 checks precisely because every
check asserted the API and the screens and none of them read the document.

It is crude on purpose: it strips the XML rather than laying out the page, so
words break where Word split a run mid-word ("นั กศึกษา" is the template's own
boundary, not a defect). What it is good for is whether a field arrived, and
what the sentence around it reads like.

**First run, on a project whose people were all appointed through the screens
rather than seeded.** The adviser's agency now prints — "ภาควิชา/กอง/หน่วยงาน
คณะวิศวกรรมศาสตร์" — where before the fix it would have been blank. The money
round-trips: 50,000 approved, 48,000 spent, 2,000 returned, all computed.

### A defect in กนศ.04's signature block — for the owner to decide

The two forms label the same signatory differently, and only one of them reads
correctly:

| Form | Template literal | Renders as |
| --- | --- | --- |
| กนศ.06 | `นายก/ประธาน` | นายก/ประธาน**ชมรมมุสลิม** ✓ |
| กนศ.04 | `ประธานชมรม` | ประธานชมรม**ชมรมมุสลิม** ✗ |

It affects **every club, in one of two ways**: 47 of 69 club names already begin
with "ชมรม", so the word doubles; the other 22 are not ชมรม at all — สภานักศึกษา,
สโมสร, สมาคมศิษย์เก่า — and กนศ.04 calls each of them a ชมรม.

That กนศ.06 gets it right with the same data is the strongest evidence this is a
mistake in temp04 rather than a convention worth preserving.

**Changed 2026-08-16, on the owner's instruction.** The rule they gave:
องค์การนักศึกษา and สโมสร are led by a **นายก**; everything else — ชมรม,
สภานักศึกษา, สมาคม — by a **ประธาน**. The organisation's own name supplies the
rest, so the title is only ever the first word. Applied to the 69 real names
that is 18 นายก and 51 ประธาน, and every one now reads correctly.

The templates had to be edited: the wrong word was *in the form*, not in the
value, so no data-side change could reach it. `scripts/patch-head-title.js`
replaced it with a `{clubHeadTitle}` tag and stays in the repository as the only
readable record of what changed inside two binary files. `assembler.js` computes
the word.

Three things that went wrong doing it, all caught by looking rather than by a
test:

- The first pass replaced runs by searching for their text, and blanked a `/`
  somewhere else entirely in a 2,000-run document. Runs are addressed by index
  now, with their expected contents asserted before anything is written.
- `pizzip.generate` stores uncompressed by default, which turned a 165 KB
  government template into a 4 MB one. `compression: 'DEFLATE'` restores it.
- **There were four signature blocks, not two.** Only the ones searched for got
  patched; a third went on printing `นายก/ประธานชมรมพุทธศาสน์` until the rendered
  form was read again. They are found now by listing every run containing นายก or
  ประธาน and keeping those followed by `{#userSH}` — the structure, not the
  wording. The three runs naming real office-holders in the approval chain are
  left alone by the same test.

And one that only the rendered document could show: `clubHeadTitle` was first
put inside the `userSH` block, but the tag sits *outside* `{#userSH}` in both
templates, so every signature line rendered as a bare club name.

`check-phase4` asserted the templates were byte-identical to the originals, and
that check did its job — it failed. Its hashes are updated to the post-edit ones
with a note saying why, and three assertions now pin the behaviour the edit was
for.

**The original position, for the record.** These are government forms and
editing one is the university's call, not this rebuild's. Two ways to fix it when the answer comes: change
temp04's literal to `นายก/ประธาน` so it matches temp06 — one word, fixes all 69 —
or strip a leading "ชมรม" in the assembler, which fixes 47 and leaves the other
22 mislabelled. The first is correct; the second avoids touching the artefact.

### Read through, and correct — worth recording as much as the defect

The rest of both forms was read rather than skimmed, including the branch a
single test project never reaches.

- **Section 11 is not missing.** กนศ.04 numbers 10 → 12 for an ordinary project
  because 11 sits inside `{#is_continueproject}`. A second project created as a
  continuation renders it, with both of its problems paired against both of
  their resolutions, correctly numbered. Nearly filed as a defect until the
  template was read.
- **The checkboxes tick the right box.** In the continuing project the runs are
  `SYM:F0A8` (empty) before "โครงการใหม่" and `SYM:F0FE` (ticked) before
  "โครงการต่อเนื่อง" — Wingdings, and the right way round. `assembler.js` emits
  every flag as an explicit `true`/`false` rather than omitting the false ones,
  which is why an unticked box is unticked rather than absent.
- **The money is arithmetic, not storage.** 50,000 approved, 48,000 spent,
  2,000 returned on กนศ.06, each computed on render.
- **Dates and attendance** carry through in Thai with Buddhist years.

Two things this pass could not check and a person still should: whether the
tick marks land in the *visually* correct cell of a table, and how the page
breaks. Reading XML establishes that a value arrived, not that it looks right on
paper.

---

## The lockout's third way in: boot order (2026-08-16)

Found by starting the API before MariaDB — not by looking for it. The session
opened with `npm start` against a database that was not running, and every one
of 400 checks failed for the same reason: the system was sitting in **2569**,
a year nothing was prepared for, so every fixture account resolved to
`role: null`.

That is the lockout of 2026-08-15, arriving by a route neither mitigation
covers. The `.env` edit was closed by moving the year into the database. The
deliberate move was closed by `setAcademicYear`'s guard. **Boot order needs no
decision by anybody**, and on a machine where XAMPP's MySQL is started by hand
it is the likeliest route of the three.

**The cause is one conflated case.** `load()` had three sources and four
outcomes. "The database says there is no row" — a fresh install — and "the
database could not be answered" both fell to the date, and both cached it *for
the life of the process*. The first is correct. The second means MariaDB comes
up a second later, `/api/health` returns to `ok`, and the system goes on
resolving memberships against a guess with nothing to say so.

**`unresolved` is now a state of its own.** Nothing is cached, and
`retryUntilResolved()` asks every five seconds until the database answers, so
the system heals when MariaDB arrives rather than waiting for someone to work
out that the API needs restarting. The startup banner says the year is a guess,
in Thai, next to the line that already says the database is down. `/api/health`
carries `academicYearResolved` and answers **503 while the year is a guess** —
a reachable database is not on its own a healthy system, and health is what a
person checks after starting MySQL.

**Rehearsed in the order that found it.** API up with MariaDB down:
`{"status":"degraded","database":"ECONNREFUSED"}`. MariaDB started, nothing else
touched: `{"status":"ok","academicYear":2567,"academicYearResolved":true}`, and
in the log `academic year: resolved to 2567 (database) — requests before now
were served against 2569`. Before the change the same sequence left the server
on 2569 until it was restarted.

Three assertions in `check-phase6.js` (403 total). The last two drive the state
machine in-process by stubbing `pool.query`, because a check suite proving what
happens when the database is down must not achieve that by taking it down.

**What this says about the rest of the work.** The year has now been the root of
three separate defects — the dashboard counting every year, the `.env` lockout,
and this. Every one was found by *running* the system in a state nobody had run
it in, and none by a test. The pattern worth keeping is the rehearsal.

---

## A project filled to every capacity (2026-08-17)

`npm run forms:review` builds one project that fills **every fixed-arity family
to its limit** — 5 objectives, 15 activities, 57 budget rows across all four
printable categories, both attendance variants in all five attendee types, one
tick in each of the 8 checkbox vocabularies — walks it to CLOSED through the
real endpoints as the real roles, and writes both `.docx` files to
`generated/forms/`.

It exists because the two questions left open by "Reading the forms" — whether
the tick marks land in the visually correct cell, and where the pages break —
are questions about the page, and the fixture project cannot ask them. A table
that fits at three rows and overflows at fifteen looks perfect until somebody's
real project has fifteen. The capacities are read from `docs/template-tags.json`,
the same inventory `arity.js` enforces against, so replacing a template moves
them.

**`forms:read` now prints the checkboxes.** A `<w:sym/>` carries its glyph in an
attribute, so stripping tags stripped the tick as well and every option printed
identically whether or not it had been chosen — on a form that is mostly
checkboxes. They render as `[x]` and `[ ]` now, and the first read confirmed the
box-then-label order is right in all eight vocabularies and that
`11. ลักษณะโครงการ[ ]โครงการใหม่[x] โครงการต่อเนื่อง` ticks the correct one.

**What the full form showed.** Section 11 renders with all three problems paired
against their resolutions. The money round-trips: 131,640 requested, 118,476
approved, 100,705 spent, 19,622 returned, and กนศ.06's three category subtotals
add up to the spend. Fifteen activity rows each shade a different month of the
Gantt.

### Two more literals in the forms, for the owner — same shape as ประธานชมรม

Both are wrong words *in the templates*, unreachable from any data-side change,
and both are proved by the same document contradicting itself.

| Where | Prints | Should be |
| --- | --- | --- |
| กนศ.04 §19 | `(หนึ่งแสน…บาทถ้วน บาทถ้วน)` | one บาทถ้วน |
| กนศ.06 §10 row 4 | `- นักศึกษาเข้าร่วมโครงการ` | ผู้ทรงคุณวุฒิ / วิทยากร |

1. **The doubled บาทถ้วน.** temp04 uses `{thailistSAll}` twice: the covering
   letter has `({thailistSAll})` and prints correctly, and §19 has
   `({thailistSAll} บาทถ้วน)` — so the same value reads right on page 1 and
   doubles on page 12 of one document. `bahtText` cannot fix it: dropping the
   suffix would break the correct one. For a satang amount it is worse than
   doubled — "…สามสิบสี่สตางค์ บาทถ้วน" says "exactly" after the satang.
2. **The mislabelled row.** temp06's attendee table has five rows; the fourth is
   labelled "- นักศึกษาเข้าร่วมโครงการ", the same literal as the third, but its
   tags are `{grandTotalExpert}`. So the ผู้ทรงคุณวุฒิ headcount is printed under
   the students' name, twice on the same page, and the total below is correct
   while the rows do not explain it. The data is right; the label is not.

Both are one-run edits of the kind `scripts/patch-head-title.js` already did,
and both are the university's call, not this rebuild's. Recorded, not changed.

### And one defect the run found in the system rather than the form

`disbursement` is the only one of the fourteen foreign keys pointing at
`project` whose definition never said `ON DELETE`; the other thirteen all say
`CASCADE`. So `DELETE /projects/:id` hit the constraint for exactly the projects
money had been paid out of and answered a bare **500** with
"เกิดข้อผิดพลาดภายในระบบ" on screen and the constraint name in the log.

Now a **409** naming the payments and why they stop it. Refused rather than
cascaded on purpose: a disbursement records that money left the university's
account, and whether an Admin may erase that is a question for whoever runs the
process. Refusing is the answer that destroys nothing while it waits; if the
answer comes back "cascade", it is a one-line migration. Four assertions in
`check-phase3.js`, including that a project no money has left still deletes.

---

## Browser pass 6 (2026-08-17)

Every screen in both a student's and an Admin's session, after the day's
backend work. Four findings, none of which any of the 409 checks could have
seen, because all four are about what a person reads on the page.

**1. Every timestamp was seven hours late.** The pool declared
`timezone: 'Z'` — the database's DATETIMEs are UTC — and they are not: MariaDB
here runs on the system timezone and `NOW()` writes Thai wall-clock. A row
written at 00:03 arrived as the instant `2026-08-17T00:03:18.000Z` and the
timeline rendered it as **07:03**. The one card whose entire job is to say when
something happened was the one saying it wrongly.

`dateStrings: true` stops the driver claiming a timezone the column does not
have. Dates now leave as `'2024-06-01'` and `'2026-08-17 00:03:18'`, and the
frontend reads the parts rather than asking `Date` to guess an offset — which it
was also doing for date-only values, where the guess is UTC midnight and can
land on the day before. `timezone` is `'local'` now and only governs writing a
JS `Date`, which makes the seed agree with `NOW()` in the same tables.

Five date sites in three shapes, one of them numeric (`17/8/2569` beside
`1 มิ.ย. 2567`), now share `calendarDate` and `dateTime` in `ui.js`. Two
assertions in `check-phase2` pin the wire shape.

**2. The attendance card could not be read.** It printed
`นักศึกษาผู้เข้าร่วม · STUDENT 100 คน` and, three lines later,
`นักศึกษาผู้เข้าร่วม · STUDENT 92 คน` — the same students planned and counted,
with nothing to say which was which, on the one screen where the comparison is
the point. กนศ.06 prints them as two columns and computes the percentage
between them; the screen should not be harder to read than the form it feeds.
Split by variant, with the Thai word for the type instead of the enum.

**3. The allocations screen said the same sentence 68 times.** In a year nobody
has prepared, 68 of 69 clubs are unfunded and each row carried the full
"ยังไม่ได้กำหนดวงเงินของปี 2567 — อนุมัติเงินโครงการของชมรมนี้ไม่ได้จนกว่าจะกำหนด".
Said once above the block now, with an em dash per row, so the club names — what
the reader is actually scanning for — are what stands out.

**4. An adviser's agency was write-only.** It is required when the role is
granted and printed on กนศ.04, and after that it appeared on no screen. The
roles table shows it under the scope now, so the value on a government form can
be checked without rendering the form.

**What held.** The readiness banner offers the year-change button only when the
target year already has an Admin, and says which piece is missing when it does
not — the lockout guard, correct on the screen as well as in the service. The
project form states each family's printable capacity next to the rows and warns
when a list is over it. The phase stepper, the scope rules (a student sees 7
projects, the Admin 8), the money meters and both document buttons all read
correctly. The only console output in the whole pass is reactstrap's
`defaultProps` deprecation warning.

---

## Security pass before deployment (2026-08-17)

A read of the whole system against the question "what does putting this on a
host with a public address expose". Most of it held: no SQL is assembled from
request strings, every router sits behind `requireAuth`, attachments leave only
through a handler that has already narrowed the project by membership, the token
carries no role, and `.env` has never been committed. Five things did not.

**The login endpoint had no cost.** `login_attempt` has recorded every failure
since migration 001 and nothing has ever read the table — a log nobody consults
does not slow an attacker down, and `POST /api/auth/login` is the only endpoint
reachable without a token. Two sliding budgets now count those rows: a small one
per username, and a larger one per source address, which is the one that catches
spraying — one attempt each against many usernames trips no per-username
counter, and the accounts are ICIT usernames, which are guessable by
construction. Migration 004 adds the address column.

Neither budget locks anything. A lockout that outlives its window is a denial of
service against a named person: anyone who knows an ICIT username could keep its
owner out indefinitely, which trades one attack for a cheaper one. Every refusal
expires on its own, the username budget clears on a success, and a database that
cannot answer fails **open** — a blip that locked every account out at once
would be worse than the attack, and login needs the database anyway.

**The mock accepts any password**, which is right on a laptop and indefensible
on a public host: `fixture.admin` is a username written in the source. The flat
production refusal made this worse rather than better — since the system is
*meant* to end at the mock, the only way to deploy was to leave `NODE_ENV`
unset, which switches off every production check at once to dodge the single one
in the way. It is now an opt-in that costs `ALLOW_MOCK_AUTH=1` and an
8-character `MOCK_PASSWORD`. That is a door on a demonstration, not
authentication, and it is described that way where it is defined.

**Three configurations that would leak now stop the process**: an empty
`DB_PASS`, a `DB_USER` of `root`, and a plain-http `CORS_ORIGIN` in production.
Development is untouched, because a check that refuses to start on XAMPP's
defaults is a check people delete rather than satisfy.

**Every response carries `nosniff`, `DENY`, `default-src 'none'` and no
referrer**, and no longer names the server. The JWT algorithm is named on both
signing and verifying instead of being read from the token's own header.

**`nodemailer` — eight advisories, imported by nothing** — and two unused
swagger packages are gone. The backend audits clean. The frontend's 28 findings
are all inside `react-scripts`, which is build-time only and reaches no browser.

Sections 10, 10b, 11 and 12 of `check-phase6.js` hold all of it, including the
production refusals, which are asserted by loading `config` in child processes
because this suite's own configuration is fixed at first require.

### Browser pass 7 — the login screen

The fixture directory was hardcoded and rendered behind
`process.env.NODE_ENV !== 'production'`. That flag describes how the *bundle*
was built, and `npm run build` always sets it — so the accounts vanished from
the deployed demo, the one place somebody arrives not knowing what to type,
while on a laptop the card always claimed "รหัสผ่านอะไรก็ได้", which
`MOCK_PASSWORD` makes false. `GET /api/auth/mode` knows both facts and now
supplies them, with the roles read out of `membership` rather than written down
beside the usernames.

Three findings once it was on screen, none of which a check could have seen:

1. **The card header wrapped into two ragged columns.** `card-x__head` is a flex
   row, so the hint added under the title became a second column rather than a
   second line. Both lines now sit in one flex child.
2. **Two accounts read identically.** `สมชาย` and `สมปอง` are both `SH` and the
   pill said `หัวหน้านักศึกษา` twice — on a card whose whole purpose is choosing
   between them, and where the second exists precisely to demonstrate that it
   cannot see the first one's club. The scope is printed under the name now:
   ชมรมพุทธศาสน์ against ชมรมฟุตบอล.
3. **A `<div>` nested inside a `<span>` inside the `<button>`** — invalid
   nesting that React renders anyway, because it builds the DOM through its own
   API rather than the HTML parser. Replaced with two block `<span>`s, and the
   row given an explicit `aria-label` reading "สมชาย นักศึกษา ·
   หัวหน้านักศึกษา · ชมรมพุทธศาสน์" rather than the run-on that assembling a
   name from three separate elements produces.

   **A correction to how this was first written up.** The finding was recorded
   as "Chrome computed no accessible name at all", on the strength of the
   browser tool's accessibility read. That tool does not implement the
   accessible-name algorithm: on the same login screen it reported the password
   field's name as its placeholder `••••••••`, when the field carries a proper
   `<Label for="password">` — and an explicit label sits above `placeholder` in
   every version of that algorithm. So the tool reports a heuristic label, and
   what it says about a control with element children is not evidence about what
   Chrome computes. The invalid nesting was real and is fixed; the claim that
   the directory was silent to screen readers was not established and should not
   be read as fact.

Verified end to end in both modes: with `MOCK_PASSWORD` set the click fills the
username and leaves the password alone, a wrong password is refused with
"ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", and the right one reaches `/projects` as
ADMIN with all eight projects. Console output is reactstrap's `defaultProps`
warning and nothing else.

### Browser pass 8 — every control that repeats itself

The login card's naming problem prompted a sweep of the same kind across every
screen, as ADMIN. What it turned up is not the one the login page was first
credited with. Six places print **the same control label several times over**,
with the thing being acted on in a different cell or a different element:

| Screen | Repeated | Distinguished by |
| --- | --- | --- |
| วงเงินจัดสรร | 9 × `กำหนด`, 1 × `แก้ไข` | the club, in the row's first cell |
| สิทธิ์ | 4 × `ถอน` | whose role is being taken away |
| ภาพรวม | one `แก้ไข` per club | the club, in the row's first cell |
| โครงการ (รายโครงการ) | 2 × `ดาวน์โหลด` | กนศ.04 against กนศ.06 |
| สรุปรายปี | 2 × `2567` | one goes to allocations, one to projects |
| ภาพรวม | 7 phase tiles | a bare count over a pill |

`ถอน` is the sharp one: four identical buttons, each removing a different
person's access, told apart only by a cell the reader has already passed. Each
now carries an `aria-label` naming its object — "ถอนสิทธิ์ อาจารย์ที่ปรึกษา ของ
สมหญิง ที่ปรึกษา" — as does every other row above. The visible text is
unchanged; these are labels for the reader who cannot see the row.

The app bar's two composite links are named the same way, for the same reason a
phase tile is: their contents are three separate elements, and any name
assembled from them is a run-on. "หน้าแรก · ระบบจัดการโครงการกิจกรรมนักศึกษา"
and "บัญชีของฉัน · ผู้ดูแล ระบบ · ADMIN".

**What this pass did not establish.** Several controls the browser tool reported
as nameless are correctly labelled in the markup — the two checkboxes on the
project form are wrapped in `<label>`, and all six coordinator fields carry
`<Label for>` with distinct text ("ผู้ประสานงานคนที่ 1"). The tool reports
placeholders in preference to associated labels, so it is not the
accessible-name algorithm and cannot be used to claim a control is unnamed.
Those were left alone. Only the repeated-label cases, which are visible in the
DOM without any tool, were treated as findings.

---

## The spending summary (2026-08-17)

Asked for by the owner: a page for the officers — STUACT and ADMIN — showing
money used against money budgeted, per club and per campus, as charts rather
than another table.

**Nothing on it is a new number.** Allocated, committed and disbursed are the
three sums `allocationService` and `budgetService` already compute, and the
definitions are copied from them rather than re-derived, so a figure here cannot
disagree with the club's own screen. What did not exist was the *comparison*: a
column of `500,000.00` beside `96,000.00` makes the reader work out the ratio,
then hold it while they read the next club. That is a job for a picture.

`GET /api/spending` refuses anyone who is not ADMIN or STUACT rather than
narrowing their scope — the same rule and the same wording as
`nextYearReadiness`. A student and an adviser read their own ceiling on the
allocations screen (Q30); a cross-club comparison is the view of somebody
responsible for more than one club. STUACT still sees its jurisdiction only,
which the scope clause applies in the query, so the page needs no role logic of
its own beyond being reachable.

Three narrow queries, not one wide one. `budget_plan_line` is one row per
project but `disbursement` is many, and joining both at once multiplies the plan
lines by the payments — `committed` inflates and nothing says so.

### The chart

The `dataviz` skill's procedure, in order. The form first: three figures that
**nest** — disbursed inside committed inside allocated — so a stacked bar, not
three grouped bars that would draw them as rivals and treble the height for no
information. Every row is on one shared scale, which is the entire point:
comparing rows is the question.

Colour last, and computed rather than picked. The three states are *ordinal*,
not categorical — the order is the meaning — so one hue in three steps, darker
the further the money has travelled. The hue is the brand's; the steps
(`#7c2412`, `#bd5138`, `#df9280`) pass the ordinal checks in the skill's
validator: monotone lightness, adjacent ΔL ≥ 0.06, single hue at 1° spread, and
a light end still at 2.45:1 on white, so the palest step is a mark and not a
tint of the page. Over-commitment is not a fourth step: it is the reserved
danger token, and because that red is a near neighbour of the ramp's darkest
step it never travels alone — it carries a hatch, a rule marking where the
allocation ended, and the words "เกินวงเงิน".

### Three things the render caught that the API did not

1. **The over-committed bar was too long.** The committed band was measured from
   zero and the overrun added on top, so a club with 96,000 committed against
   70,000 allocated drew a bar 122,000 long — the 26,000 counted once inside the
   band and again outside it. Every band is now clipped to the ceiling and the
   widths sum to exactly the allocation, or to exactly the committed total when
   that is larger.
2. **The tooltip quoted the drawing, not the figures.** It reported "อนุมัติแล้ว
   ยังไม่จ่าย 10,000" for a club with 36,000 promised and unpaid, because 10,000
   is where that *band* stops. Widths and figures are now separate fields on the
   same object, and the label, the tooltip and the table all read the figures.
3. **The axis vanished below 640px.** The axis rides the row grid so its ticks
   line up with the bars without a second copy of the column widths — but the
   narrow-viewport rule renamed the grid areas underneath it and its two spacer
   cells were auto-placed, squeezing the axis itself to zero width. The whole
   scale disappeared, silently, on a phone.

### The middle level, added after the first pass

Campus and club were what was asked for; the level between them was missing, and
it is the one a STUACT is actually responsible for —
`membership.jurisdiction_club_group_id` is a club group. For an ADMIN looking at
69 clubs across five groups, "which group is behind" is the question that comes
between "which campus" and "which club".

`club.club_group_id` is nullable and sixteen clubs use it: only D04's ชมรม sit
in a group, while D02's fifteen สโมสร and D03's สมาคม do not. That is more clubs
than any group but one holds, so they get a bucket named
"ไม่สังกัดกลุ่มชมรม" — dropping them or filing them under a group they are not
in would both be lies about where the money went.

A STUACT holds exactly one group, so its group chart would be a single bar
restating the headline figure above it. `MoneyMeter` now declines any chart of
fewer than two rows and the page omits the card entirely, which is the same rule
the skill states for a stat tile: one value is not a bar chart. The table still
carries the figures, so nothing is hidden — only the drawing that would have
said nothing.

Twenty assertions in `check-phase3.js` hold the API half, including that the
summary's totals equal the allocation rows added up, that clubs roll into their
campus exactly, that a club is listed for an allocation **or** for projects, and
that a student and an adviser get 403. 451 passed, 0 failed.

---

## A session that ends while the tab is open (2026-08-17)

Found by opening `/spending` in a browser with no session, which is how anybody
receiving a link to it arrives. Two defects, one underneath the other, both in
the client's session layer.

### The token expires and the app says two contradictory things

`JWT_EXPIRES_IN` is two hours; a tab left open outlives it. `AuthContext`
re-verified the token **on mount only**, so nothing noticed. The next click sent
a request with a dead token, the server answered its 401 —
`กรุณาเข้าสู่ระบบใหม่`, "please sign in again" — and `messageOf` handed that
sentence to the page, which drew it as its own red alert. Reproduced by replacing
the last six characters of `sessionStorage['dms.token']` and clicking a nav
entry:

- the app bar went on naming the signed-in user, their club and their role, so
  the app simultaneously insisted you were signed in and told you to sign in
  again — with no control on the page that did it;
- `/dashboard` was an empty page with one alert on it; **`/projects` was worse,
  keeping its `กำลังโหลด…` skeleton**, so an ended session was indistinguishable
  from a slow one, indefinitely;
- every nav entry produced the same thing, so nothing the reader could try was
  the thing that worked. The only ways out were the sign-out button — which the
  message gives nobody a reason to press — and a reload.

Now a 401 is handled where it is known rather than where it surfaces: a response
interceptor in `api.js` drops the token and raises `dms:session-lost`, and
`AuthContext` — the one owner of session state — clears the session, which sends
`RequireAuth` to the login screen. The screen says which of the two things
happened, because "you are back at the login page" explains nothing:
`เซสชันหมดอายุแล้ว` after an expiry, and nothing at all after a deliberate
sign-out.

### The link you were sent is discarded

`RequireAuth` redirected to a bare `/login`, and `LoginPage` pushed a hardcoded
`/projects` on success. So `/spending?year=2566` — a page whose year lives in the
URL *precisely so it can be sent to somebody* — delivered the project list to
anybody not already signed in. A link that silently substitutes a different page
looks like a link that worked.

The redirect now carries `pathname + search` in the router's `state`, and the
login screen returns there. Three details:

- **`state`, not `?next=`.** Only this app can write router state; a query
  parameter is writable by whoever sends the URL. It is still validated on the
  way out — one leading slash and no more — so neither `//elsewhere.example` (a
  protocol-relative URL that leaves the site) nor an absolute one can be pushed
  onto our history.
- **`replace`, not `push`.** Nobody wants the back button to return them to a
  login screen they were sent to by an expiry they did not ask for.
- **Not carried after a deliberate sign-out.** Signing out is a handover, and the
  next person to use the browser did not ask for the page the last one was
  reading. Verified: after the sign-out button, `window.history.state` holds no
  `from` and the next sign-in lands on `/projects`.

### Two things the interceptor must not do, and why

**`/auth/*` is exempt.** `POST /auth/login` answers **401 for a wrong password**
(`routes/auth.js`), which is a message for the form from somebody who has no
session to lose. Treated as session loss it would wipe the state of whoever was
signed in when a second person mistyped a password on the same browser, and would
swallow the sentence the form exists to show. Verified by restarting the API with
`MOCK_PASSWORD` set — the one configuration in which the mock provider can refuse
a password at all — and submitting a wrong one: the reply was 401, the screen
showed `ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง` and nothing else.

**Only reads bounce.** A GET that comes back 401 holds nothing the user typed, so
leaving the page costs them nothing. A failed **write** may be a project form
with an hour of work in it, and navigating away would destroy what is still on
screen — the fix's own regression, and the reason `error.config.method` is
checked. Writes keep exactly the behaviour they had: the action's own dialog, the
page untouched. Verified on `/projects/1/edit` — typed a name, killed the token,
pressed `บันทึกการแก้ไข`: the dialog said `บันทึกไม่สำเร็จ ·
กรุณาเข้าสู่ระบบใหม่`, the typed name and every other field were still there
afterwards, and the button returned to `บันทึกการแก้ไข` rather than sticking on
`กำลังบันทึก…`. The session is still over; the *next read* — any nav click, any
reload — makes the trip to the login screen, which is the user's choice to make
rather than ours.

**Still open, for the owner.** What would actually save that work is
re-authenticating *without* leaving the page: a sign-in dialog over the form,
keeping its state, and a check that the person who signs in is the same person —
otherwise a colleague finishes someone else's draft under their own name. That
changes what a user of the system experiences rather than how the code reads, so
it is recorded rather than decided here.

### One adjacent thing fixed, one adjacent thing left alone

`AuthContext` cleared the stored token whenever the mount-time `GET /me` failed
**for any reason**, including a request that never arrived. Restarting the API
therefore signed everybody out. Only an answer from the server says a token is
bad, so only `err.response` clears it now; a network failure leaves it in place
to work on the next reload, and the login screen's own connection message —
which names both the API and the page's origin — is what the reader sees
meanwhile.

Left alone: the `Switch`'s closing `<Redirect to="/projects" />`, which answers
every unknown URL with the project list. It is the same shape of problem — a
broken link that looks like it worked — but a 404 screen is a new screen, and
nobody asked for one.

### A note on the alert colour

The expiry notice is a `secondary` alert, themed in `theme.css` alongside
`alert-danger`. A session that timed out is not something the reader did wrong,
and stock Bootstrap's yellow `alert-warning` would say it was. Neutral ground and
a grey rule: red stays for errors and the accent stays for actions, per the rule
at the top of that file.

455 assertions still pass (464 after the validation pass below). None of them
cover this — every check is an HTTP assertion against the API, and all five
defects above are in the browser, which is why they survived six phases and eight
browser passes.

---

## What `String()` will answer for, and a file grep could not see (2026-08-17)

Started as an audit of one thing — that every `check.text({ max })` matches its
column's width, since a mismatch turns a named 400 into a 500 — and the audit's
first result was that the audit could not be run.

### A grep that silently skipped the largest write path

`grep -rn "check\."` over `backend/src` listed every call site except one:
`Binary file backend/src/services/projectService.js matches`. The file is
ordinary UTF-8 JavaScript apart from **one raw NUL byte**, on the line that
builds a grouping key:

```js
const key = spec.groupBy.map((column) => row[column]).join('\0');
```

The escape had been typed as the byte itself. NUL is the right separator — no
validated value can contain one, so two groups cannot collide into one key the
way a comma would let them — but written raw it makes grep, ripgrep and `git
diff` classify the module as binary and skip it without saying so. Thirty-eight
validator call sites, including every field of every child list on both
government forms, were invisible to the sweep that was meant to check them.

A repo-wide scan found exactly one more, in `check-phase6.js` itself
(`config.mockPassword || '<NUL>never'`, a sentinel so `''.includes('')` cannot
make that assertion vacuously true). Both now write `'\0'`, both files are text
again, and **section 14 of `check-phase6.js` fails if any backend source file
ever carries a raw NUL again** — because this is precisely the defect that hides
from the tool you would use to look for it.

### Then the audit itself, which came out clean, and one that did not

Every explicit `max` does match its column: `VARCHAR(10)` ↔ 10,
`VARCHAR(32)` ↔ 32, `VARCHAR(255)` ↔ 255, and every unbounded `check.text()`
sits on a `TEXT` column. But **`VARCHAR(n)` counts characters and `TEXT` counts
bytes**, and the default `max` of 65535 was being compared against
`String#length`. Thai costs three bytes per character in `utf8mb4`, so:

```
22,000 Thai characters = 66,000 bytes
  → under a 65,535-character check
  → over the column, ER_DATA_TOO_LONG, errno 1406
  → HTTP 500 "เกิดข้อผิดพลาดภายในระบบ"
```

Reproduced against `PUT /api/projects/1/sections/rationales`. `check.text` now
measures `Buffer.byteLength` as well, on every call rather than only the
unbounded ones — for a `VARCHAR(255)` column 255 characters cannot exceed 1,020
bytes, so the test is inert there and costs one comparison. The message names
**bytes**, because telling somebody they exceeded 65,535 characters when they
typed 22,000 sends them hunting a bug that is not there.

### Three things the validators had a confident answer for

`String()` and `Number()` are total functions: they return something for every
input, including the wrong kind of thing. Each of these answered **200**, stored
the value, and would have printed it:

| Sent | Stored | Why it matters |
| --- | --- | --- |
| `{"content": {"a": 1}}` | `[object Object]` | printed verbatim in a numbered box on กนศ.04 |
| `{"content": ["ก","ข"]}` | `ก,ข` | two list items fused into one row; the form has five boxes and this fills one |
| `{"headcount": []}` | `0` | `Number([])` is `0`, so a headcount nobody gave becomes a real attendance of zero on กนศ.06 |

The third is the one that would never be noticed: a zero is a plausible number
in a column of numbers, and the report totals it without complaint.

A `scalar()` guard now refuses anything that is not a string or a number before
`String`/`Number` is allowed near it, and every validator routes through it —
`text`, `integer`, `decimal`, `date`, `oneOf`. Strings *and* numbers both pass,
because a phone number arriving as a JSON number is a reasonable client and each
validator narrows it afterwards; the refusal names the field and what arrived
(`content: ต้องเป็นข้อความหรือตัวเลข ไม่ใช่ รายการ`).

This is the same rule as deviation 2, applied one level further down. That
deviation stopped a write from *reaching a column it should not*; this stops a
write from reaching the right column with a value the wrong shape.

### Why none of it was caught before

All four are write paths with valid tokens, correct scope, allowed fields and the
right phase — everything the 455 existing assertions check. What none of them
sent was a *wrong-typed* value, because the client never does: the frontend
builds these bodies from typed inputs. Every one of these takes a client that is
merely wrong, or a request made by hand.

Nine assertions in `check-phase6.js` sections 13 and 14 hold all of it, including
two that would catch the fix going too far — a normal Thai rationale still saves,
and a phone number sent as a JSON number is still accepted. **464 passed, 0
failed.**

---

## The record kept everything except a deletion (2026-08-18)

Browser pass 9, on the one card no earlier pass had opened: **ไฟล์แนบ**. It only
renders for somebody who may edit the project, and passes 6 and 8 swept the
system as an Admin looking at other clubs' work, so nobody had attached a file
through the screen. Four findings, one of which is about what the system
remembers rather than what it shows.

### Deleting an attachment left no trace

`project_event` is append-only and every other action writes to it — created,
edited, phase changed, budget approved, disbursed, file attached.
`DELETE /projects/:id/attachments/:id` wrote nothing. Reproduced by attaching a
file as `fixture.student` and deleting it: the card went from three files to
two, and the ประวัติ card beside it still read **7 รายการ** with three
`แนบไฟล์` entries, one of them for a file that no longer existed.

That is the wrong way round. Of everything a person can do to a project, the one
that destroys something is the one whose record matters most — a minute of an
approving meeting, or the quotation a disbursement was based on, could be
attached and taken away again and the project would read as though it had never
been there. And the deletion is the only event that cannot be reconstructed
afterwards: the row holding the filename goes with it.

Migration 005 adds `ATTACHMENT_REMOVED`, and `attachmentService.remove` writes
it **in the same transaction as the delete**, carrying the name and size in
`detail` because after the commit that is the only place the name still exists.
The file is unlinked after the transaction, and only if the DELETE matched a
row — two callers holding the same row was already possible, and only the one
that removed anything should say so.

### The filename was on the wire and never on the screen

`detail` has been returned by `GET /projects/:id/events` since the endpoint was
written, and nothing ever read it. The timeline printed `แนบไฟล์` three times
over with nothing to tell the three files apart — which matters more now that
deletions are recorded, since `ลบไฟล์แนบ` without a name says only that
*something* went. Both now read `แนบไฟล์ · รายงานการประชุม.pdf`.

Writing that assertion found the reason nobody had: **MariaDB's `JSON` is
`LONGTEXT` with a `CHECK`, not a native type**, so `mysql2` returns the column as
a *string*. A first version of the timeline change read `detail.originalName` off
a string and rendered nothing at all, silently. `loadEvents` parses it once now,
and one assertion pins the wire shape so a driver or engine change cannot quietly
turn it back into text.

### Three cards that could not tell "failed" from "empty"

The attachments card's load was `.catch(() => setData(null))`, and `null` is also
its loading state — so a failed read left the **skeleton up forever**. Proved by
failing that one request in the browser while the rest of the page succeeded: the
card sat between a fully-rendered project and a working timeline, animating, with
no message and no way out but a reload. It is deviation 23's defect one level
down: an ended request and a slow one looking identical, indefinitely.

Two more of the same shape, found by sweeping for `catch(() => set`:

| Where | On failure it said | Why that is worse than a skeleton |
| --- | --- | --- |
| `DocumentsCard` | `setDocuments([])` → a card saying the project has no documents | every project has both forms; there is no such state |
| `RolesPage` search | `setResults([])` → "ไม่พบผู้ใช้ — ผู้รับสิทธิ์ต้องเคยเข้าสู่ระบบอย่างน้อยหนึ่งครั้ง" | a confident claim **about a person**, from a request that never arrived |

The roles one is the sharpest: an officer trying to grant a role reads that the
person has never signed in, which is a fact about them, and gives up. All three
now distinguish *could not load* from *there is nothing*, with a `LoadFailed`
card that offers a retry — `secondary`, not `danger`, because the reader did
nothing wrong, and an outline button rather than a `btn-link`, since this theme
draws link buttons in the muted text colour and the one control on the card
would have been the one thing that did not look pressable. Verified by failing
the request, seeing the message, re-enabling it and pressing ลองใหม่: the card
fills in place.

Left alone, and why: `ProjectsPage` answers a failed `GET /phases` by dropping
the phase filter chips — a convenience disappearing, not a false statement — and
`DashboardPage` hides the year-readiness banner, which withholds a control
rather than inventing one. Both are silent, both degrade toward doing less; a
card apiece would be more noise than they are worth.

### Every download and delete button said the same thing

Three files, three buttons reading `ดาวน์โหลด`, three reading `ลบไฟล์แนบ` — the
file each acts on being in a different element. This is exactly browser pass 8's
finding, on the one screen that pass could not reach, and `DocumentsCard` two
cards above already names its two buttons after the forms. Each button now names
its file. The visible text is unchanged.

**What held.** The refusal for a disallowed type reads correctly and names both
the extension and the whole allow-list (`.exe` sent past the `accept` filter, as
a determined user would). Thai filenames survive the round trip on screen and in
the record. The delete confirmation names the file it is about. The upload
appears in the timeline without a reload now, because the card tells the page
when it has written something the record cares about.

Six new assertions in `check-phase6.js` §2 — the deletion is recorded, names the
file, names who and when, does not replace the upload event, arrives as an object
rather than JSON text, and a second delete records nothing. **470 passed, 0
failed.**

### One thing this session did not fix, in the machine rather than the code

MariaDB would not start: `Can't open and lock privilege tables: Incorrect file
format 'db'`. One of the 24 Aria tables in the `mysql` schema —
`data/mysql/db.MAD` — holds **error-log text from 2025-09-26** where its rows
should be, including `InnoDB: Page … log sequence number … is in the future`.
Restored from XAMPP's own `mysql/backup` copy (the damaged files are kept), which
resets database-level grants to the shipped defaults; nothing here uses them, and
the `dms` schema itself is untouched. Worth knowing about, because the same disk
event that wrote a log into a table file was already reporting InnoDB damage a
year ago.

---

## Two wrong words on a government form, and a day that does not exist (2026-08-18)

An audit of what the forms *derive* rather than store — the Thai spelled-out
amount, the dates, the percentages — followed by one of `validate.js`, since the
last pass through that file had checked text widths and value *shapes* but not
what `Number()` and the calendar will agree to.

### `เอ็ด` where the number says `หนึ่ง`

`bahtText` spells the amount printed in words on กนศ.04, in the covering letter
and again at §19. `เอ็ด` replaces `หนึ่ง` in the units place only when something
non-zero comes before it — สิบเอ็ด, หนึ่งร้อยเอ็ด, หนึ่งล้านเอ็ด — and the test
for "something before it" was `length > 1` **on the digit string**. Every group
is zero-padded: satang to two digits, each `ล้าน` group to six. So `'01'` was a
two-character string whose value is one:

```
0.01        → เอ็ดสตางค์            should be หนึ่งสตางค์
1.01        → หนึ่งบาทเอ็ดสตางค์      should be หนึ่งบาทหนึ่งสตางค์
1,000,000.01 → หนึ่งล้านบาทเอ็ดสตางค์  should be …หนึ่งสตางค์
```

The flag is now carried as a fact about the number rather than the string, and
across the group boundary as well — so `1,000,001` is still `หนึ่งล้านเอ็ดบาท`,
which is the case the string test got right by accident.

Second, `0.00` printed **ศูนย์บาท** with no `ถ้วน`. Every other whole-baht amount
has it, and on a form `ถ้วน` is the word that says no satang were dropped; a
receipt for nothing still reads ศูนย์บาทถ้วน. Both are one-line fixes in
`thai.js` and neither is reachable from the old system's code, which refused
anything above 9,999,999 outright.

Why the four existing assertions missed it: they check 19,200 · 21 · 12.34 ·
12,000,000 — an amount with satang, but never satang **ending in one**, and never
zero. Five new ones in `check-phase4.js` cover both, plus the two cases that
would catch the fix going too far (สิบเอ็ดสตางค์ and ยี่สิบเอ็ดสตางค์ keep
their เอ็ด).

### The 31st of February was a 500

`check.date` tested `/^\d{4}-\d{2}-\d{2}$/` and `Date.parse`. Both accept
`2024-02-31`: JavaScript rolls it forward to the 2nd of March. MySQL rolls
nothing forward — strict mode answers `ER_TRUNCATED_WRONG_VALUE` — so

```
PATCH /api/projects/1  {"prepareStartOn":"2024-02-31"}   → 500 เกิดข้อผิดพลาดภายในระบบ
                       {"prepareStartOn":"2023-02-29"}   → 500
                       {"prepareStartOn":"2024-02-29"}   → 200
```

which is precisely the failure this file exists to turn into a named 400, and
the same shape as the `TEXT`-bytes defect found on 2026-08-17. The date now
round-trips through `Date.UTC` and is compared back, so the calendar answers
rather than the parser: the leap day saves, the 29th in a non-leap year does
not, and the message names the day it refused.

Reachable from the browser only through a client without a native date picker,
and from the API by anybody — which is the same standing as every other
validator here.

### A headcount written in hexadecimal

`check.integer` was `Number(value)` guarded by `Number.isInteger`. Both of these
pass that guard:

```
"0x10" → 16      "1e3" → 1000
```

A headcount of `"0x10"` would have been stored as 16 and printed as 16 on
กนศ.06 — deviation 24's shape exactly, a confident answer to input nobody meant.
Digits (with an optional decimal part) are required now, so `"12.0"` is still
twelve — a number input can hand that back, and refusing it would have been the
fix overshooting.

Six assertions in `check-phase6.js` §13. **481 passed, 0 failed.**

### And a defect in the record itself

`docs/DECISIONS.md` had **two numbering systems**. The master list under
"Deliberate deviations from old behavior" is the one every code comment cites
(`deviation 1`, `2`, `8`, `11`, `16`, `23`, `24` — all of which still resolve
correctly). But each phase close-out also carried a "New deviations from old
behavior" sub-list saying "added to the numbered list above", and they never
were: they continued the count as it stood when that phase ended, so items
17–27 exist twice with different meanings. By this session **deviation 17**
named the budget-line rule in one place and the delete-refusal in another.

The close-out text is the fuller statement of each, so it stays where it is and
is renumbered 30–40, with one-line entries added to the master list pointing at
it. Q22 requires the deviations to be listed; a list with two meanings for the
same number is the failure mode that requirement exists to prevent.

---

## The frontend had no tests at all (2026-08-18)

Every defect in browser passes 6 through 9 — the seven-hour timestamps, the
unreadable attendance card, the endless skeleton, the roles screen's confident
"ไม่พบผู้ใช้", six sets of identically-named buttons — was found by a person
opening a page and reading it. None of the 481 assertions could have caught any
of them, because every one of those is an HTTP assertion about what the API
answers, and every one of these is about what the page does with the answer.

That is the whole gap, and it is why the same shape of defect kept reappearing
on screens the previous pass had not reached.

`@testing-library/react` and jest (already inside `react-scripts`), and **26
tests in four files**, each pinning something a browser pass had to find by
hand:

| File | What it holds |
| --- | --- |
| `ui.test.js` | the Buddhist year, the day surviving without a UTC guess, `00:03` not rendering as `07:03`, money keeping both satang digits, and `—` rather than `0.00` for a value nobody set |
| `AttachmentsCard.test.js` | a failed list says so and retries in place; every download and delete button names its file; deleting asks first and a "no" deletes nothing; a refusal shows the server's own sentence |
| `DocumentsCard.test.js` | a failed read never renders as "this project has no forms"; each button names its form; a phase-blocked form is disabled and says why |
| `ProjectPage.timeline.test.js` | the record names the file that was deleted, tells three uploads apart, prints nothing for an `EDITED` detail that has no name in it, and survives a `detail` that arrives as JSON text |

**Checked that they can fail.** Putting the two attachment defects back into the
working copy — the swallowed `catch` and the fixed `aria-label` — turned 7 of
the 10 tests in that file red, including the three about deleting, which fail
because the button naming the file is how the test reaches it. Restored
afterwards; the point of the exercise is that a test which cannot fail is not
evidence of anything.

`npm run test:once` in `frontend/` runs them without a watcher and without the
API: every one mocks `../api`, so nothing here depends on a database being up.

**What this does not cover.** Nothing renders `ProjectFormPage`, the biggest
screen in the system, and nothing exercises a real network — these are unit
tests of components against stated doubles, not an end-to-end run. Browser
passes are still how a screen gets read for the first time; what changed is that
what they find can now be written down somewhere that runs again.

---

## Browser pass 10: two presses of a failing button, two projects (2026-08-18)

The project form is the largest screen in the system and the only one no pass
had opened on its own terms. Reading `save()` before opening it showed why that
mattered: creating a project is **nine requests** — `POST /projects` for the core
row, then eight `PUT …/sections/*` — and only the first of them makes the
project exist.

### What a failure after the first request looked like

Reproduced by pasting 22,000 Thai characters into หลักการและเหตุผล, which is
66,000 bytes and over the column (the defect found on 2026-08-17, now a named
400):

1. `POST /projects` → **201**. The project exists, with a draft number.
2. `PUT …/sections/rationales` → **400**, naming the bytes.
3. The dialog says **บันทึกไม่สำเร็จ**, the page stays on `/projects/new`, and
   everything typed is still on screen — which is right.

But the page went on believing it was creating something. Pressing save again
posted a *second* project. Two presses of a button that both reported failure
left **ร่างที่ 8 and ร่างที่ 9**, identical, both half-empty, both consuming a
draft number that the club's numbering will never reuse. Nothing on the screen
said either existed; "บันทึกไม่สำเร็จ" reads as *nothing happened*, and for the
core row it was false.

### The fix, and the two things it deliberately does not do

The page now remembers what it created and updates that project on every later
attempt. The failure dialog names the draft:

> โครงการถูกสร้างไว้แล้วเป็น "ร่างที่ 10" — แก้ตรงนี้แล้วกดบันทึกอีกครั้ง
> ระบบจะบันทึกทับร่างเดิม ไม่สร้างใหม่

and the button stops saying สร้างโครงการ, because the next press no longer
creates anything.

- **It does not navigate to `/projects/:id/edit`.** That would remount the page
  against the server's copy and discard everything typed since — the work the
  retry exists to save.
- **It does not roll the create back.** A half-filled draft the author can see
  and finish is better than a delete that also has to be got right on a
  connection that has just proved unreliable, and worse: the failure is usually
  *in* one of the lists, so the core row is the part that succeeded.

The id is held in state rather than in the URL for the same reason, and
`created` is read from a local variable inside the failing attempt's own `catch`
— React state has not updated yet at that point, so the first failure, the one
that matters most, would have shown no footer at all.

Verified in the browser end to end: two failures now leave exactly one draft
(ร่างที่ 10), and correcting the rationale and pressing again completes that same
project rather than a third one.

Five tests in `ProjectFormPage.save.test.js`, four of which fail against the
page as it was — the fifth is the pre-existing "no name, no request" guard,
which passed both before and after and is there to show the others are not
passing by accident. **31 frontend tests, 481 API assertions, 0 failures.**

## Browser pass 11: allocations, history, profile (2026-08-18)

The three screens no earlier numbered pass had opened directly: `/allocations`,
`/history`, `/profile`. Read `AllocationsPage.js`/`HistoryPage.js`/`ProfilePage.js`
first — each already carries the reasoning for its own edge cases in comments
(Q30's read/write split, Q33's warn-not-block on a lowered ceiling, the
past-year/future-year distinction) — then opened each as STUACT and SH to check
the reasoning against what actually renders.

Both roles came back clean:

- STUACT sees all ten clubs in its jurisdiction (one funded, nine not, each
  reachable), the ปีการศึกษา picker and the แก้ไข/กำหนด dialog both open
  correctly with the current amount pre-filled, and cancelling leaves the
  figure untouched.
- SH and AD each see exactly their own club's row, read-only, no
  `กำหนด`/`แก้ไข` controls and no fetch of the full club list — matching
  `mayAllocate` gating client-side API calls, not just the buttons.
- `/history`'s two tables link out correctly (`ปีการศึกษา` → `/allocations?year=`,
  the phase matrix → `/projects?year=`) and its totals match the row on
  `/allocations` for the same year.
- `/profile` renders the right `ROLE_SUMMARY` sentence for STUACT and AD (the
  advisor's card also names `advisor_agency`) and leaves the identity fields
  correctly uneditable.

No defect found on any of the three screens across four roles. The browser
session's `type`/`navigate` actions failed on a transient tool-side outage
(unrelated to the app) partway through, so Q33's "lower below committed"
warning was confirmed via the API acceptance script that session instead of a
click-through — the outage cleared in the next session and the same flow was
then walked end to end: lowering ชมรมพุทธศาสน์'s ceiling to ฿50,000 against
฿96,000 already approved produced the exact warning text
`allocationService.js` builds, the danger banner named the club, the row
turned red with "เกินวงเงิน", and restoring the ceiling to ฿500,000 cleared
both. **31 frontend tests, 481 API assertions, 0 failures**, both suites
re-run clean against a freshly reseeded database.

ADMIN checked out clean too: `/allocations` lists all 69 clubs system-wide
(none of the three club-scoped roles get that), `/history`'s totals still
matched, and `/profile` correctly shows an em dash for club/agency (ADMIN
belongs to neither) with the right `ROLE_SUMMARY` line. Extended the pass to
`/roles`, ADMIN's other screen: granted SH to a second person on
ชมรมพุทธศาสน์ (confirming a club is not capped at one head — nothing in
`membershipService.js` claims it is), watched the confirmation dialog, the
new row, and the history table's "ให้" entry all agree, then revoked it and
watched the "ถอน" entry land beside it. The one pre-existing `ถอน`-less row —
สมปอง ต่างชมรม already holding SH on a different club (ชมรมฟุตบอล) — is
leftover fixture data from an earlier session's scope-refusal testing, not
something this pass created, and was left alone.

## The second coordinator's name, filed under the first (2026-08-19)

Found reading `ProjectFormPage.js`'s edit-load next to `presentProject` in
`projectService.js`, not in the browser — the browser session was still
without working `type`/`navigate` when this was found, so this one was
confirmed with the API acceptance script and a frontend component test
instead of a click-through.

`presentProject` answers a project's three coordinator boxes as `contacts:
[1,2,3].map(...).filter(c => c.name || c.phone)` — a blank box is dropped
rather than sent as an empty entry, so a project with box 1 blank and box 2
filled in answers with a **one-element** array. `ProjectFormPage.js` read it
back by position, `contacts[0]`/`[1]`/`[2]`, so that one element — box 2's
coordinator — loaded into the "ผู้ประสานงานคนที่ 1" field on the edit screen,
and saving again would have written it there for good, silently promoting
coordinator 2 into coordinator 1's box.

Fixed by carrying `slot` (1/2/3) on each entry instead of relying on array
position, and having the edit-load look up `contactAt(1|2|3)` by that field.
`ProjectPage.js`'s read-only display was already position-blind — it maps
`name`/`phone` and joins, never indexes — so it needed no change.

Confirmed the bug reproduces and the fix holds two ways: `check:phase2.js` now
PATCHes a fixture project to clear contact 1 and fill contact 2, then asserts
the GET answers a one-element array whose entry carries `slot: 2`; a new
`ProjectFormPage.edit.test.js` renders the edit form against that same shape
and asserts "ผู้ประสานงานคนที่ 2" holds the name, not "คนที่ 1" — checked by
temporarily reverting the frontend fix and watching the new test fail before
restoring it. The backend dev server does not autoreload (`node server.js`,
no nodemon), which hid the fix from `check:all` for one run until restarted —
worth remembering next time a code change to a running route doesn't seem to
take.

**32 frontend tests, 483 API assertions, 0 failures.**

**Confirmed live in the browser, 2026-08-19**, once typing/navigation were
working again: opened `/projects/1/edit` as SH (draft phase, so it is the one
project that is still editable), cleared คนที่ 1 and filled in คนที่ 2 through
the real form, saved, and reloaded the edit page fresh from the server —
คนที่ 1 came back empty and คนที่ 2 held what had actually been typed, not
swapped. Restored the original coordinator afterward. The mocked test proved
the logic against a stated double; this proved the same fix against the
actual API response shape end to end.

## Dashboard and spending summary, three roles (2026-08-19)

Read `DashboardPage.js` and `SpendingPage.js` first, then opened both as
STUACT, ADMIN, and SH. All three clean:

- STUACT's phase tiles, budget card, and the readiness banner for 2568 (its
  jurisdiction's 10 clubs, 0 funded/headed/advised) all matched what the
  underlying pages already show; `/spending`'s totals matched the allocations
  card for the same year.
- SH sees no readiness banner (not fetched — `mayAllocate` gates the request,
  not just the render), no `สรุปการใช้เงิน` link, "อ่านอย่างเดียว" instead of
  "แก้ไขได้", and no unfunded-club summary row (its `clubs` list is never
  fetched, so there is nothing to count).
- ADMIN's readiness banner showed a live `เปลี่ยนเป็นปี 2568` button, which
  looked at first like it shouldn't be there — `setAcademicYear` requires the
  *target* year to already have an Admin, and no fixture seeds one for 2568.
  Reading `check-phase6.js` explained it: its year-rollover test grants
  `fixture.admin` an ADMIN membership for `yr + 1` to test this exact gate,
  moves the system forward, then back, but never revokes that membership —
  so it persists as leftover state after any `check:all` run and the banner
  is correctly reporting it. Not a defect; not clicked, since doing so for
  real (outside that test's own move-back) would advance the whole dev
  system to 2568 for real.

## Requested and parked (2026-08-19)

**Dashboard needs an Excel export of its summary.** Owner asked for this
while reviewing `/dashboard` — the phase-status tiles and the
allocation/spending table should be downloadable as an Excel file, not just
read on screen. Not designed or built yet; parked here so it isn't lost.
Whoever picks it up next should decide: export the whole page's data in one
file or one sheet per card, and whether it is scoped the same way the page
already is (a club sees its own row, STUACT its jurisdiction, ADMIN
everything) — which it should be, since anything else would leak scope the
screen itself refuses to.
