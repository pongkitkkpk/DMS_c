# Business Rules — extraction from the running system

**Status**: Complete for the project lifecycle, authorization, numbering and budget flow. Attachments (`p_addfile`) and the edit-history counter are described but not traced end to end.
**Phase**: Phase 0 deliverable 3 of 5 (per `docs/DECISIONS.md` Q23).
**Last updated**: 2026-08-12

---

## What this file is

The rules the old system **actually enforces**, read out of the code — not the rules it was
meant to enforce, and not the rules the new system should have. Where the intended rule and
the implemented rule differ, both are recorded and the difference is called out, because the
rebuild has to decide which one to carry forward.

Citations are `file:line` against:

```text
C:\Users\pongk\OneDrive\เอกสาร\GitHub\Student-activity-system-DMS\
```

Backend paths are given from `backend/`, frontend paths from `frontend/src/views/`.

The headline result: **almost none of the business rules are enforced by the server.** They
are drawn in JSX, and the server writes whatever it is sent. That is the single most
important input to the rebuild, so it is stated first.

---

## How the app is wired (needed to read every citation below)

Three routers are mounted **twice**:

| Mount | Where | Prefix | Body parser applied? |
| --- | --- | --- | --- |
| 1st | `server.js:23-25` | none — root | **No.** `express.json()` is only registered at `server.js:29`, after these three lines. |
| 2nd | `server.js:31` → `routes.js:9-11` | `/admin`, `/student`, `/stuact` | Yes. |

The frontend always calls the **prefixed** mount (e.g. `CSD_detail.js:403` posts to
`${API}/student/project/create/`), which is the one that works. The root mount at
`server.js:23-25` is a duplicate that exposes every `GET` route a second time at an
unprefixed path and would fail any write for want of a parsed body.

A **fourth group of routes is defined inline in `server.js` itself** (`:158-376`) and is not
part of any router. These are registered after `express.json()`, so they work — and **none of
them has `verifyToken`**. The phase machine and the money ledger live in this group. This is
not a subtlety; it is where the lifecycle is written.

| Route | Line | Auth | Used by |
| --- | ---: | --- | --- |
| `GET /getState/:id_projects` | `server.js:158` | **none** | `ProjectDocument.js:65` |
| `PUT /updateState/:id_projects` | `server.js:216` | **none** | `ProjectDocument.js:209` |
| `POST /insertlogState/:id_projects` | `server.js:255` | **none** | `ProjectDocument.js:131`, `:223` |
| `POST /studentgetmoney/:id_projects` | `server.js:282` | **none** | disbursement UI |
| `POST /updateprojectusebudget/:id_projects` | `server.js:311` | **none** | disbursement UI |
| `GET /gethistorystudentgetmoney/:id_projects` | `server.js:360` | **none** | disbursement UI |
| `POST /sendEmail` | `server.js:64` | **none** | `ProjectDocument.js:236` |

`PUT /firstupdateState/:id_projects` exists **twice** — unauthenticated at `server.js:174`
and authenticated at `studentRoutes.js:2669`. The frontend calls the prefixed
`/student/firstupdateState/…` (`ProjectDocument.js:118`), so the `studentRoutes` copy is the
live one and `server.js:174` is dead. The difference matters: only the live copy writes
`project_number` (`studentRoutes.js:2684`). The dead copy would advance a project's phase and
assign it a `yearly_count` **without ever giving it a number**.

---

## Authorization

### Rule as implemented: there is none

`verifyToken` (`middleware/verifyToken.js:3-24`) verifies the JWT signature and assigns
`req.user = decoded` at `:21`. **`req.user` is then never read to make a decision.** Across
`backend/src/` the identifier appears exactly twice: that assignment, and
`adminRoutes.js:18`, which echoes it back in a health-check payload. Every route that is
scoped at all is scoped by a value the client put in the URL.

So the effective rule is: **any valid token grants every capability in the system.** The
token is not even role-bearing (see below), so "admin" is not a thing the server can check.

Representative routes, all `verifyToken` and nothing else:

| Route | Line | What an arbitrary token can do |
| --- | --- | ---: |
| `GET /stuact/stuactallprojects/:AgnecyGroupName` | `stuactRoutes.js:7` | read any club's projects by editing the path |
| `GET /student/users` | `studentRoutes.js:31` | `SELECT * FROM users` — the whole table |
| `GET /admin/allusers` | `adminRoutes.js:107` | same, on the admin router |
| `POST /admin/user/createUser` | `adminRoutes.js:1254` | create a user, including their `position` |
| `DELETE /admin/user/deleteUser/:id` | `adminRoutes.js:1140` | delete any user |
| `DELETE /student/deleteProject/:id_projects` | `studentRoutes.js:59` | cascade-delete any project and its children |
| `GET /student/download04/:id_project` | `studentRoutes.js:1083` | render any project's กนศ.04 |
| `PUT /student/project/edit/:id_project` | `studentRoutes.js:418` | overwrite any project row (see "Mass assignment") |

`stuactRoutes.js:11` has a second problem independent of the path parameter. The predicate is

```sql
WHERE (AgnecyGroupName = ? OR responsible_agency = 'กองกิจการนักศึกษา')
```

The `OR` is unconditional, so **every project owned by กองกิจการนักศึกษา is returned to every
caller regardless of what club name was asked for.** Narrowing the parameter does not narrow
the result.

### Why the token could not carry a role even if a route checked it

There are two token issuers and they disagree:

- `server.js:107-114` signs `{ username, role: response.message.position || "user" }`.
- `src/login.js:178` signs the ICIT `userInfo` object **verbatim**, with no `role` added.

`server.js` is the endpoint the frontend uses (`POST /api/authen`), and it reads `position`
off the ICIT response. But `position` is an **application** concept stored in the local
`users` table (`DECISIONS.md:92`) — ICIT returns identity, not the app role. So `position` is
absent from the ICIT payload and the ternary falls through to the literal `"user"` for every
real account. The local-admin fallback (`src/login.js:139-148`) is the only path that ever
produces `role: "admin"`.

**Consequence for the rebuild:** the role must be resolved by a server-side lookup against
`users` after SSO, not read out of the identity provider's response. This is a design
constraint, not an optional improvement.

### Where the rules actually live: `sessionStorage`

The role gate is JSX. `ProjectDocument.js:28-29` reads the user from
`sessionStorage.getItem("user")`, and every transition control is rendered conditionally on
`storedUser.position`:

| Phase (step) | Control | Gate | Line |
| --- | --- | --- | ---: |
| 1 `ร่างคำขออนุมัติ` | เสนอพิจารณา | `position ∈ {S, SH}` | `:286` |
| 2 `ดำเนินการขออนุมัติ` | ยืนยัน | `position ∈ {Admin, AD}` or (`Stuact` and `ClubGroup == AgnecyGroupName`) | `:300` |
| 3 `โครงการอนุมัติ` | โครงการอนุมัติ | `position == Admin` or scoped `Stuact` | `:316` |
| 4 `เงินโครงการอนุมัติ` | ส่งร่างสรุปผลโครงการ | `position ∈ {S, SH}` | `:333` |
| 5 `ร่างสรุปผลโครงการ` | ดำเนินการสรุปผล | `position == Admin` or scoped `Stuact` | `:348` |
| 6 `ดำเนินการสรุปผล` | ปิดโครงการ | `position == Admin` or scoped `Stuact` | `:364` |

Two things to carry forward and one to drop:

- **Carry forward — this table is the intended authorization model.** It is the only written
  statement of who may advance what, and it is coherent: students push the two drafting
  states forward, staff approve. Re-implement it server-side.
- **Carry forward — `Stuact` is club-scoped** (`storedUser.ClubGroup == AgnecyGroupName`)
  while `Admin` is global. That distinction is real and is lost everywhere else.
- **Drop — `position === "S"`.** It appears at `:286` and `:333` but the database's only
  values are `SH | Admin | Stuact | AD` (`DECISIONS.md:92`). Dead branch.

Because the corresponding endpoints are unauthenticated (`server.js:216`, `:255`), editing
`sessionStorage` — or skipping the browser entirely — bypasses all six rows of that table.

### Mass assignment

Every edit endpoint passes `req.body` whole into `UPDATE … SET ?`:

`studentRoutes.js:433` (`projects`), `:451` (`p_person`), `:551` (`p_timestep`), `:567`
(`p_indicator`), `:688` (`p_finalperson`), `:704` (`p_indicator`), `:729` (`p_finalbudget`),
`:1474`, `:1507` (`projects`), `:2531` (`p_timestep`), `:2570` (`p_budget`), `:2639`
(`p_indicator`), `:2692` (`status_project`), `:2701` (`projects`) — 14 sites.

`studentRoutes.js:418-444` is the worst of them because `projects` is a single 117-column
row: one `PUT /student/project/edit/:id_project` can set `project_number`, `project_phase`,
`allow_budget`, `codeclub` and `id_student` on **any** project id. The handler's only
contribution of its own is `updatedData.updated_at = new Date()` (`:430`) and a no-op date
round-trip at `:419-427` (`addDays(date, 0)`).

Two endpoints do the opposite and destructure explicitly — `firstupdateState`
(`studentRoutes.js:2671`) and `updateusebudget` (`adminRoutes.js:1661`). They are the
exception.

---

## The project lifecycle

### States

Seven, ordered, defined in the frontend at `ProjectDocument.js:172-180`:

```text
1 ร่างคำขออนุมัติ → 2 ดำเนินการขออนุมัติ → 3 โครงการอนุมัติ → 4 เงินโครงการอนุมัติ
  → 5 ร่างสรุปผลโครงการ → 6 ดำเนินการสรุปผล → 7 ปิดโครงการ
```

Mapped onto the two government forms: 1–3 are the กนศ.04 proposal, 4 is disbursement, 5–6 are
the กนศ.06 final report, 7 is closed.

The current phase is read from `status_project`, not from `projects`
(`server.js:158-172`, via `ProjectDocument.js:64-70`) — even though `projects.project_phase`
also exists and is written by the same transitions. Two sources of truth for one fact.

### Transitions

The state index is derived, not stored as a transition: `ProjectDocument.js:181-182` looks the
current phase up in the array and sets `currentStepProject = index + 1`;
`:185-196` then sets `project_phase` — the value that will be **written** — to
`stepNames[currentStepProject - 1]` from a second array that starts one element later. The
next state is therefore always "the one after the current one". **There is no transition
table and no guard: the machine cannot branch, cannot reject, and cannot skip.**

`handleNextStep` (`:198-255`) is the generic transition and fires four calls, none awaited and
none coordinated:

1. `PUT /updateState/:id` — writes `status_project` **and** `projects.project_phase`
   (`server.js:234-251`).
2. `POST /insertlogState/:id` — appends to `logstatus_project` (`server.js:270-278`).
3. `POST /sendEmail` — notification (see below).
4. `Swal.fire("สำเร็จ!")` — success is announced immediately, before any response arrives
   (`:248`).

`server.js:216-253` never calls `res.send()`. The two `db.query` callbacks only `console.error`
on failure. So the request hangs until the client times out, **and a failed phase write is
reported to the user as a success.** The frontend cannot detect it: its `.then` at `:215`
does nothing and its `.catch` at `:220` only logs.

The same pattern holds for `insertlogState` (`server.js:255-280`, no response) and
`firstupdateState` (`studentRoutes.js:2669-2709`, no response). Since `updateState` and
`insertlogState` are two independent unawaited writes, **`status_project` and
`logstatus_project` can diverge** — which is consistent with defect 9 in `schema-current.md`,
where `logstatus_project` references 16 project ids that no longer exist.

`handlePrevStep` (`:257-259`) decrements local state only. It writes nothing. There is no
implemented rejection or send-back path.

### Notifications are not implemented

`POST /sendEmail` (`server.js:64-83`) hardcodes `to: "s6303051613149@email.kmutnb.ac.th"`
(`:71`) and ignores the caller's recipient. It authenticates against `smtp.ethereal.email`
(`:53-61`) — a disposable capture service that delivers nothing. The caller and the handler
also disagree on the payload: `ProjectDocument.js:236-240` sends `{email, subject, message}`
while the handler reads `{to, subject, text, html}` (`:66`), so even the body would arrive
empty. Treat email notification as a **requirement, not an existing feature.**

---

## Numbering

Two sequences, issued at two different moments, both computed in the browser. This is the
answer to `schema-current.md` open question 1.

### `codeclub` — the club code (10 chars)

Assembled at `TableAddPersonel.js:162-168` when a user record is created:

```text
campus.substring(0,1)              "Bangkok" → "B"     1
+ yearly                           "67"                2
+ codedivision.replace(/\D/g,"")   "D04" → "04"        2
+ codeagency.replace(/\D/g,"")     "A101" → "101"      3
+ codeworkgroup.replace(/\D/g,"")  "G01" → "01"        2
                                                    = 10
```

`:168` also builds `codebooksomeoutyear`, the same string with the year replaced by the
literal `"yy"` — a year-agnostic club key. Note `codeclub` **embeds the academic year**, so
every sequence keyed on `codeclub` restarts each year for free.

### `yearly_countsketch` — the draft sequence, at creation

`CSD_detail.js:369-398`. The browser fetches
`GET /student/project/getcodeclub/:codeclub`, whose SQL is
`SELECT * FROM projects WHERE codeclub = ? ORDER BY id DESC LIMIT 1`
(`studentRoutes.js:394`) — the single most recent project of that club. It reads that row's
`yearly_countsketch`, `parseInt`s it, adds 1, `padStart(2,"0")`s it (`:377-385`) and posts it
as the new project's `yearly_countsketch` (`CSD_detail.js:412`). If the club has no projects
yet, it posts `"01"` (`:395`).

`project_number` is posted at the same time (`:406`) as the **empty string** — its untouched
initial state from `:35`. The commented-out line at `:386-387` records the intent
(`// setProjectNumber หลังกรอกครบทุกหน้าเรียบร้อยแล้ว`).

The same block also guesses the new row's primary key: `newProjectId = response.data[0].id`
then `setIdProjects(newProjectId + 1)` (`:388-391`) — **the client predicts the next
`AUTO_INCREMENT` value** and uses it to link the child rows it is about to create. Any
concurrent insert, or any gap from a deleted row, attaches the children to the wrong project.
The dump has such gaps (ids 766 and 774–806 are missing).

### `yearly_count` and `project_number` — the official number, at approval

`ProjectDocument.js:89-123`, reached from the step-2 `ยืนยัน` button (`:303`). The browser
fetches `GET /student/project/getNameProjectYearly/:project_name/:codeclub/:yearly`
(`studentRoutes.js:229-247`), whose SQL is

```sql
SELECT * FROM projects WHERE project_name = ? AND codeclub = ? AND yearly = ?
```

then takes the maximum `yearly_count` over that result (`:95-101`), adds one, pads to two
digits (`:103`), and forms `project_number = codeclub + newYearlyCount` (`:105`) — 12 chars,
matching the column width. It is sent to `PUT /student/firstupdateState/:id`
(`:118-123`), which writes `project_number`, `project_phase` and `yearly_count` to `projects`
(`studentRoutes.js:2683-2688`).

**The scope of that maximum is the defect.** It includes `project_name = ?`, so the sequence
is per *project name*, not per club. Two differently-named projects in the same club and year
each compute a maximum over their own name-group, each get `01`, and each build the same
`project_number`. This is deterministic, not a race — and `project_number` has **no unique
index** (`schema-current.md` defect 8), so both rows persist.

On top of that it is a read-then-write race in the ordinary way: two approvals of same-named
projects read the same maximum before either writes.

The dump cannot be used to reconstruct which of these actually fired — it holds 6 numbered
projects whose `yearly_count` values (`12, 01, 02, 05, 03, 01`) are not reproducible from the
current code, and the id gaps show rows were deleted. What the dump does confirm is the
two-stage design: all 30 projects carry a `yearly_countsketch`, and exactly the 6 that reached
approval or beyond carry a `yearly_count` and a non-empty `project_number`.

**For the rebuild:** both sequences must be issued by the database inside the transaction that
needs them, scoped to `(codeclub, yearly)`, with a unique index on `project_number`.

---

## Budget

### The three amounts

| Column | Table | Intended meaning |
| --- | --- | --- |
| `net_budget` | `netprojectbudget`, `projects` | the annual allocation for a club |
| `allow_budget` | `netprojectbudget`, `projects` | the amount approved for a project |
| `use_budget` | `projects` | the amount actually disbursed |

All are `text` or `varchar` and all hold `en-US`-formatted display strings with thousands
separators, because the frontend formats before posting (`CSD_budget.js:552-554`; see
`schema-current.md` defect 1). **No arithmetic comparison of a budget against a limit is
possible anywhere in the current system**, which is why no such check exists.

### The one place a budget is written on approval

`ProjectDocument.js:93` reads `allow_budget` off the **project** row returned by
`getNameProjectYearly`, and `:145-147` writes it to
`PUT /admin/updateusebudget/:project_name` → `adminRoutes.js:1658-1674`:

```sql
UPDATE netprojectbudget SET allow_budget = ? WHERE project_name = ?
```

Three defects in three lines:

1. **It joins on `project_name`** (`schema-current.md` defect 4). `netprojectbudget` rows are
   *club annual plan lines*, and matching them to a project by name is the reason 5 of the
   dump's 7 rows have `allow_budget` = NULL.
2. **It overwrites rather than accumulates.** A club's plan line is replaced by one project's
   amount, so a second approved project in the same club erases the first one's contribution.
   The route is named `updateusebudget` but writes `allow_budget` — the name records what it
   was meant to do.
3. **It never responds on success** (`:1670` logs instead of sending), so the client hangs
   here too.

### Disbursement

`POST /studentgetmoney/:id_projects` (`server.js:282-308`, unauthenticated) appends a row to
`logstudentgetmoney` with the client's `numberstudent_receive` and `remainingBudget`. It does
not compute `remainingBudget` — the client supplies it. The abandoned intent is visible at
`:297` as a comment: `// const use_budget = numberstudent_receive+(old in database )`.

`POST /updateprojectusebudget/:id_projects` (`server.js:311-355`, unauthenticated) is the only
code in the system that derives money from its components:

```sql
SELECT SUM(numberstudent_receive) AS totalReceived
  FROM logstudentgetmoney WHERE id_projects = ? AND project_name = ? AND yearly = ?
```

It then writes that sum to **`allow_budget`** in both `projects` (`:333`) and
`netprojectbudget` (`:342`) — the *approved* amount, not `use_budget`, which is the column
that means "disbursed". The local variable is even named `allow_budget` (`:328`). So the sum
of disbursements overwrites the approval, and `projects.use_budget` is never written by any
route. Combined with the previous section, `netprojectbudget.allow_budget` is written by two
endpoints with two different meanings.

**There is no rule anywhere that a project's budget must not exceed its club's allocation.**
The rebuild will be introducing that rule, not restoring it — with the caveat that it cannot
be applied to migrated data until the money columns are numeric.

---

## Document generation

`GET /student/download04/:id_project` (`studentRoutes.js:1083`) and `download06`
(`:1246`). Both are `verifyToken` only: **no phase check and no ownership check.** A กนศ.04
can be rendered for a project still in `ร่างคำขออนุมัติ`, by anyone.

The handler assembles the render context from six nested queries, each
`WHERE id_projects = ? ORDER BY … LIMIT 1` (`:1086`, `:1096`, `:1105`, `:1113`, `:1124`) plus
two `users` lookups: the adviser, matched by **`name_student` string equality**
(`:1135-1136`), and the club head, matched by `clubName` + `yearly` + `position = 'SH'`
(`:1144-1151`). Both name-based joins fail silently to an empty result, which renders an
empty field rather than an error.

The render call is `doc.render({detail, person, timestep, indicator, budget, user, userSH})`
at `:1179`, on a `Docxtemplater` constructed with `parser: expressionParser` at `:1174-1178`
(the angular-expressions dependency `DECISIONS.md:132` flags as missing from the strategy
doc's `package.json`). Tag inventory and arity are in `template-contract.md`.

The only guard in the whole handler is `if (resultp_person.length > 0)` (`:1095`) — a
document is refused if the project has no `p_person` row, and produced otherwise.

Three further defects in the render path itself — a missing `budget` key that blanks the
approved total on every กนศ.06, an unguarded division that prints `Infinity%` / `NaN%`, and a
malformed tag name — were found during the template extraction and are carried here by
reference rather than restated: `template-contract.md` → "Defects found in the render path".

---

## Summary — what the rebuild must add rather than port

Every item below is a rule the system is *supposed* to have and does not.

1. **Server-side authorization.** Resolve the role from `users` after SSO; scope every query
   by the authenticated principal, never by a path parameter. The gate table under
   "Where the rules actually live" is the specification.
2. **A real transition table** with guards and an explicit rejection path, applied in the
   server, replacing "the next element of the array".
3. **One source of truth for the current phase.** Today `projects.project_phase` and
   `status_project` are written separately and read inconsistently.
4. **Transactions.** Phase change, log append, numbering and budget update are currently four
   unawaited fire-and-forget writes that can partially fail in silence.
5. **Responses.** Six handlers never call `res.send()`; the UI reports success unconditionally.
   Nothing can be trusted to have happened.
6. **Database-issued numbering**, scoped `(codeclub, yearly)`, with a unique index on
   `project_number`, and server-issued primary keys instead of the client's `id + 1` guess.
7. **Numeric money and a budget ceiling.** Neither the type nor the rule exists today.
8. **Working notifications.** The current implementation sends nothing, to a hardcoded
   address, from a disposable mailbox.
9. **Explicit field allow-lists** on all 14 `SET ?` endpoints.

---

## Not yet traced

- `p_addfile` — upload, storage path and retrieval (Q21 requires relative paths served behind
  authorization). The table and the `filepath` column are described in `schema-current.md`.
- `historyeditproject` — written by `POST /student/project/edit/history/:id_project`
  (`studentRoutes.js:742`) and read at `:798`. It is a per-page edit counter; the semantics of
  its columns are not decoded.
- `login` (the table) — one row in the dump; no route observed writing it.
