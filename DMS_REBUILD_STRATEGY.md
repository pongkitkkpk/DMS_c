# DMS Rebuild — Build Plan

**Status**: Phases 0–6 complete, plus the five post-v1 features at the end of this file
(2026-08-15) — per-year allocations, the year summary, granting and revoking roles, the
officer's menu, and next-year readiness. v1 is feature-complete against the old system's
screens, with one item deliberately not built (email — see Phase 6). **This is a demonstration
system**: the ICIT integration is out of scope by the owner's decision and `AUTH_PROVIDER=mock`
is where it is meant to stop.
**Supersedes**: the original `DMS_REBUILD_STRATEGY.md` (commit `b8c7d31`), whose five load-bearing premises were each contradicted by the code — see `docs/DECISIONS.md` → "Why the strategy doc is obsolete".
**Last updated**: 2026-08-15

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

**A decision made rather than asked, and worth revisiting if it is wrong:**
STUACT may not grant `STUACT` or `ADMIN`. The owner settled the *jurisdiction*
question, not which roles; this is the conservative reading. The reasoning is
that a STUACT who can appoint another STUACT can reach any jurisdiction in two
steps, which would make the scope check decorative. If officers are in practice
expected to appoint their own successors, this is one line in `GRANTABLE_ROLES`.

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
