# DMS Rebuild — Build Plan

**Status**: Phases 0, 1, 2 and 3 complete. Phase 4 (document assembly) ready to start.
**Supersedes**: the original `DMS_REBUILD_STRATEGY.md` (commit `b8c7d31`), whose five load-bearing premises were each contradicted by the code — see `docs/DECISIONS.md` → "Why the strategy doc is obsolete".
**Last updated**: 2026-08-14

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
| `docs/schema-target.md` | the schema being built — 29 tables, full coverage map |
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
controls, child lists, event log), and the budget panel — figures, the three limits as meters,
both variants' line items, and the disbursement ledger. That covers `DetailBudget`,
`DAddSplitBudget` and `DTableAddBudget` in one screen rather than four.

**Known gap, deliberate:** there is **no allocation screen**. `GET`/`PUT /api/allocations`
exist and are tested, and every allocation read carries `committed`, `remaining` and
`overCommitted` — which is the Q33 dashboard signal — but nothing renders them yet. That
belongs with STUACT's dashboard here in Phase 5.

**Done when:** every screen above works for its roles against the real API, and no screen
relies on `sessionStorage` for an authorization decision.

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

---

## Before Phase 1 starts

Four assumptions in `schema-target.md` need an explicit yes or no. Three are low-risk; one
changes a previously settled answer.

| | What | Risk if wrong |
| --- | --- | --- |
| **A1** | Q37 — money is `DECIMAL(12,2)` | low; no data to convert |
| **A2** | Q38 — surrogate `INT` PKs, `project_number` a separate business key | low |
| **A3** | Q41 — disbursement ledger built on today's `logstudentgetmoney` shape | low |
| **A4** | Q39 **revised** — `person` and `membership` split, so one person may hold several roles | **medium** — cheap to collapse later, expensive to split later |

The stack and the theme are **settled** (see "Stack" above). A1–A3 are proceeding as written —
with no data to migrate the cost of being wrong is a schema edit, not a re-migration. **A4 is
the one still worth a deliberate look**, because reversing it later is the expensive direction.

---

## What is explicitly not in v1

Recorded so the gaps are decisions, not oversights.

- The **review queue** (Q5) — adviser stays a single read-only screen.
- **Award categories** `D06`–`D12` — seeded, no workflow, pending confirmation the feature is
  wanted (`domain-model.md` open question 2).
- **Soft delete** — `DELETE FROM project` cascades.
- **Database-level row security** — scope is an application invariant enforced from the token.
- **i18n** — Thai copy, hardcoded (Q11).
