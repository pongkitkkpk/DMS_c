# Domain Model — the vocabulary and the entities

**Status**: Complete for organisation, identity, scope, the project aggregate and the budget aggregate. Award categories (`D06`–`D12`) are described from their labels only — no workflow was found that uses them.
**Phase**: Phase 0 deliverable 4 of 5 (per `docs/DECISIONS.md` Q23).
**Last updated**: 2026-08-12

---

## What this file is

The **ubiquitous language** for the rebuild: what each thing in this domain is called, what
it actually means, and which of the old system's names are lies. It is the layer between
`schema-current.md` (what is stored) / `business-rules.md` (what happens) and
`schema-target.md` (what we will store instead).

Rule for the rebuild, per Q11: **Thai UI copy, English code identifiers.** Every entity below
gets an English name here and a Thai label; the Thai label is data, not an identifier.

Citations follow the convention of the other Phase 0 files — backend paths from `backend/`,
frontend paths from `frontend/src/views/`, all under
`C:\Users\pongk\OneDrive\เอกสาร\GitHub\Student-activity-system-DMS\`. Values quoted from
the dump were extracted by parsing its `INSERT` statements, not by eye.

---

## The organisation

This is the part the old system models worst and the part everything else hangs off.

### Source

`setCode.json` (`frontend/src/views/setCode.json`) — a single object with one key,
`Divison` (sic), holding `D01`–`D12`.

### The nominal shape vs the real shape

`DECISIONS.md:179` records the taxonomy as `Division → Agency → WorkGroup`. That is true of
some of the file. In fact **`Agency` has four different shapes** depending on the division,
and the seed importer (Q34) has to handle all four:

| Divisions | `Agency` is | Grouping inside it | Campus |
| --- | --- | --- | --- |
| `D01`, `D02`, `D03` | a **list** of named groups | by kind — org units at `A0xx`, student bodies at `A1xx` | absent |
| `D04` | a **list** of named groups | by club group (5 of them) | **a nesting level**: `Bangkok` / `Prachin` / `Rayong` |
| `D05` | a **dict** of agencies | none | absent |
| `D06`–`D12` | a **dict** with a single `A001` | none | absent |

The `A0xx` / `A1xx` split in `D01`–`D03` is not cosmetic — it is the **org unit vs. student
body** distinction, encoded in a number range:

- `D02` group `คณะ/วิทยาลัย` holds `A001`–`A015` — the faculties, each with a `WorkGroup` map
  of its departments.
- `D02` group `สโมสรนักศึกษาคณะ/วิทยาลัย` holds `A101`–`A115` — the **student unions of those
  same faculties**, with no `WorkGroup`.

So `A001` and `A101` are the same institution seen from two sides. The rebuild must model
that as a relationship, not as two unrelated rows, or every faculty appears twice in every
dropdown.

### The five club groups — this is `AgnecyGroupName`

`D04` (`องค์กรนักศึกษา`) contains exactly five groups, and **their names are the values that
appear in `projects.AgnecyGroupName`**:

| Group | Bangkok | Prachin | Rayong |
| --- | ---: | ---: | ---: |
| `องค์กรนักศึกษาส่วนกลาง` | 2 | 2 | 2 |
| `ชมรมฝ่ายวิชาการ` | 5 | 0 | 0 |
| `ชมรมฝ่ายศิลปวัฒนธรรม` | 6 | 4 | 0 |
| `ชมรมฝ่ายอาสาพัฒนาและบำเพ็ญประโยชน์` | 6 | 3 | 0 |
| `ชมรมฝ่ายกีฬา` | 21 | 2 | 0 |

The dump uses three of the five (`ชมรมฝ่ายศิลปวัฒนธรรม` ×16, `องค์กรนักศึกษาส่วนกลาง` ×12,
`ชมรมฝ่ายกีฬา` ×2 across 30 projects). Rayong has zero clubs in every group — a real gap in
the seed data, not a parsing artefact.

**Naming.** `AgnecyGroupName` is misspelled (`Agnecy`) and the same concept is spelled
`agencyGroupName` and `ClubGroup` in `users`. In the rebuild this is one concept:
**`club_group`**, Thai label as above.

### `D06`–`D12` are award categories, not org units — now verified

`DECISIONS.md:296` lists this as an *unverified assumption* ("assumed `D06`–`D12` are project
classifications. Never verified"). Their `name` fields settle it — they are not
classifications of projects either, they are **categories of student award**:

| Code | Name |
| --- | --- |
| `D06` | ผู้นำองค์กรนักศึกษา ระดับมหาวิทยาลัย คณะ/วิทยาลัย |
| `D07` | คณะกรรมการบริหารในองค์กรนักศึกษา / นักศึกษาที่เป็นคณะทำงาน(ดำเนินการอย่างต่อเนื่องและทุ่มเท) |
| `D08` | นักศึกษาที่ดำเนินกิจกรรมในฐานะผู้แทนมหาวิทยาลัย |
| `D09` | นักศึกษาที่มีความประพฤติดีเด่น |
| `D10` | นักศึกษาที่มีผลงานด้านความคิดสร้างสรรค์ และนวัตกรรมดีเด่น |
| `D11` | นักศึกษาที่มีผลงานกิจกรรมนอกหลักสูตรดีเด่น |
| `D12` | นักศึกษาที่มีผลงานด้านกีฬาดีเด่น |

Every one names a *student*, not a unit or a project. **Q35's split is correct and Q35 can be
closed as verified.** They belong in a separate `award_category` table and must never appear
in an org-unit dropdown. No project in the dump references them, and no code path was found
that reads them — so they are seed data for a feature that does not exist yet.

### Campus

Three campuses, represented **three incompatible ways** in live data:

| Representation | Where | Example |
| --- | --- | --- |
| English key | `setCode.json` `D04` nesting, `netprojectbudget.campus` | `Bangkok`, `Prachin`, `Rayong` |
| Thai display string | `users.campus` | `มจพ. กรุงเทพฯ` |
| First letter of the English key | inside `codeclub` | `B` |
| Work group | `setCode.json` `D01/A001/G07`, `G08` | `กลุ่มงานกิจการนักศึกษา มจพ.ปราจีนบุรี` |

`TableAddPersonel.js:86-94` is the converter, mapping the Thai `FAC_NAME_THAI` onto the
English key. It handles exactly three strings and has no fallback, so an unrecognised campus
leaves the default `"Bangkok"` from `:36` in place. Q36 (campus becomes a column) is the right
call; the migration needs this mapping table and a report of anything that does not match.

---

## Identity, roles and scope

### Person vs. account

`users` is not a person table — it is an **(person, role, club, year) enrolment**. The dump
proves it: `karoms` appears three times.

| id | position | clubName | ClubGroup | agencyGroupName | yearly |
| ---: | --- | --- | --- | --- | ---: |
| 23 | `Stuact` | กองกิจการนักศึกษา | ชมรมฝ่ายศิลปวัฒนธรรม | NULL | 2667 |
| 24 | `Stuact` | กองกิจการนักศึกษา | ชมรมฝ่ายศิลปวัฒนธรรม | NULL | 2667 |
| 26 | `AD` | สภานักศึกษา มจพ.กรุงเทพฯ | NULL | องค์กรนักศึกษาส่วนกลาง | 2567 |

**Correction to Q39.** Q39 calls all three "dirty data" and prescribes de-duplication plus a
unique constraint on `id_student`. Rows 23 and 24 are genuinely identical and should collapse.
**Row 26 is not a duplicate** — it is the same person holding a second, different role in a
different club. A blanket unique constraint on `id_student` would delete a real fact. The
model needs `person` (unique by `id_student`) separate from `membership`
(`person × club × role × year`), with the uniqueness on `(id_student, yearly)` at most. Q39
should be revisited before the migration is written.

### Roles

`users.position` is the application role (`DECISIONS.md:92`); `users.account_type`
(`students` | `personel`) is the ICIT identity type and is **not** a role.

| Code | Thai | Scope | Notes |
| --- | --- | --- | --- |
| `SH` | หัวหน้าชมรม / นักศึกษาเจ้าของโครงการ | own club | the proposing role |
| `AD` | อาจารย์ที่ปรึกษา | own club | read-only in v1 (Q5) |
| `Stuact` | เจ้าหน้าที่กองกิจการนักศึกษา | **one club group** | the reviewing role |
| `Admin` | ผู้ดูแลระบบ | global | |

`position === "S"` is tested at `ProjectDocument.js:286` and `:333` and exists in no row. Dead.

### The two scope columns are opposites — do not merge them

`users` carries two columns drawn from the same club-group vocabulary, and in the dump they
are **mutually exclusive**:

- **`agencyGroupName`** — set for `SH` and `AD`, NULL for `Stuact`. It is the group the
  person's **own club belongs to**. `CSD_detail.js:342` copies it onto every project the
  student creates, which is where `projects.AgnecyGroupName` comes from.
- **`ClubGroup`** — set for `Stuact`, NULL for everyone else. It is the group the officer is
  **responsible for**. `ProjectDocument.js:300` tests `storedUser.ClubGroup == AgnecyGroupName`
  to decide whether this officer may act on this project.

Membership and jurisdiction. Same vocabulary, opposite direction. Name them
**`club_group_id`** (on the membership) and **`jurisdiction_club_group_id`** (on the staff
assignment) and the ambiguity disappears. Collapsing them into one column — the obvious
"simplification" — would make every `Stuact` a member of a group they are supposed to oversee.

### `clubName` means two different things

For `SH`/`AD` it is the club (`ชมรมวิทยุสมัครเล่น`, `สภานักศึกษา มจพ.กรุงเทพฯ`) and it is what
lands in `projects.responsible_agency` (`CSD_detail.js:340`). For `Stuact` it is the employing
office (`กองกิจการนักศึกษา`). One column, two meanings, joined by string equality everywhere.

---

## Identifiers

Three codes, built by string concatenation in the browser, each embedding the ones before it.

```text
club_code       = campus[0] + yearly(2) + division(2) + agency(3) + work_group(2)   10 chars
project_number  = club_code + sequence(2)                                           12 chars
```

| Name in DB | Where built | Meaning |
| --- | --- | --- |
| `users.codebooksome` | `TableAddPersonel.js:167` | the club code for a given year |
| `users.codebooksomeoutyear` | `TableAddPersonel.js:168` | same with the literal `"yy"` for the year — a year-agnostic club key |
| `projects.codeclub` | copied from `users.codebooksome` at `CSD_detail.js:341` | the project's club code |
| `projects.project_number` | `ProjectDocument.js:105` | `codeclub + yearly_count` |

Verified against the dump: `B670410100` = `B` + `67` + `04` + `101` + `00` — Bangkok, year 67,
division `D04`, agency `A101` (ชมรมวิทยุสมัครเล่น), work group `00`.

### The width invariant is already broken in live data

`TableAddPersonel.js:167` interpolates the `yearly` state whole, and `:37` initialises it to
`2667` — a **four-digit** value, and a typo for 2567. The two `Stuact` rows in the dump carry
the result:

```text
B26670100101   12 chars, not 10
```

`codebooksomeoutyear` hides the damage (`Byy0100101`, 10 chars) because `"yy"` is always two
characters, which is why the defect survived. A project created under that club code would
produce a **14-character** `project_number` and be silently truncated by `varchar(12)`.

Two conclusions for the rebuild: the year component must be a derived 2-digit rendering of a
stored 4-digit year, never a raw interpolation; and the code must be **composed from foreign
keys at read time**, not stored as a copied string on `projects`. Q18/Q29 already require
server-side generation in a transaction — this adds that the *inputs* must be typed.

### `yearly`

The Buddhist-era academic year, stored inconsistently: `2567` / `2568` (4-digit) in `users`
and `projects`, `2667` in the two broken rows, `"67"` (2-digit) inside every code, and `text`
in the DDL. One entity: **`academic_year`, a 4-digit integer**, with a 2-digit rendering used
only for code assembly.

---

## The project

### The aggregate

One project is a single `projects` row plus one row in each of six child tables, all keyed by
`id_projects` and all read `LIMIT 1` (`studentRoutes.js:1086`–`:1125`). The "child tables" are
therefore **not collections** — they are extra column groups on the same entity, split up
because `projects` ran out of room. There is exactly one `p_budget` row per project holding
382 columns.

| Table | Really is | Becomes (Q13, Q19) |
| --- | --- | --- |
| `projects` (117 cols) | the header + the whole กนศ.04 narrative | `project` + value objects |
| `p_person` (55) | target-audience counts by type | `project_participant` rows |
| `p_timestep` (129) | the schedule + Gantt | `project_activity` rows with real dates |
| `p_budget` (382) | the budget matrix | `budget_line` rows |
| `p_indicator` (25) | indicators | `project_indicator` rows |
| `p_finalperson` / `p_finalbudget` | the same, as actuals for กนศ.06 | the same rows tagged plan vs. actual |
| `p_addfile` | attachments | `project_attachment` |

### The two documents

The domain has **one project with two documents**, not two entities:

- **กนศ.04** — `แบบขออนุมัติเสนอโครงการ`, the proposal. Owns phases 1–3.
- **กนศ.06** — the final report. Owns phases 5–6.

The `p_*` / `p_final*` pairing is exactly the plan/actual split, so "final" in a table name
means *actual*, not *last*. Q13 already requires กนศ.06 to gain line items so plan and actual
are comparable.

### Lifecycle vocabulary

Seven phases (`ProjectDocument.js:172-180`), Thai strings used as keys today, becoming stable
codes with a label map under Q14:

| # | Thai | Proposed code | Owner |
| ---: | --- | --- | --- |
| 1 | ร่างคำขออนุมัติ | `DRAFT_PROPOSAL` | SH |
| 2 | ดำเนินการขออนุมัติ | `PROPOSAL_SUBMITTED` | Stuact / Admin |
| 3 | โครงการอนุมัติ | `PROJECT_APPROVED` | Stuact / Admin |
| 4 | เงินโครงการอนุมัติ | `BUDGET_APPROVED` | SH |
| 5 | ร่างสรุปผลโครงการ | `DRAFT_REPORT` | Stuact / Admin |
| 6 | ดำเนินการสรุปผล | `REPORT_SUBMITTED` | Stuact / Admin |
| 7 | ปิดโครงการ | `CLOSED` | — |

Phase 3 is the **numbering event** — the project acquires its `project_number` on entry
(`business-rules.md` → "Numbering"). Phase 6 is transient: it appears 3× in the transition log
and never as a current phase (`schema-current.md` → "Correction to `DECISIONS.md`").

The four `รอ…` states the frontend also tests appear in zero rows and are dropped (Q40).

---

## Money

### The three amounts and who owns them

| Term | Thai | Grain | Owner |
| --- | --- | --- | --- |
| **allocation** | งบประมาณจัดสรร | agency × campus × year | Admin / Stuact (Q30) |
| **planned amount** (`net_budget`) | งบประมาณที่ตั้งไว้ | one plan line | Stuact |
| **approved amount** (`allow_budget`) | งบประมาณที่อนุมัติ | one project | Stuact / Admin |
| **disbursement** (`numberstudent_receive`) | เงินที่เบิกจ่าย | one payment | Stuact |
| **actual spend** / **refund** (`refundtotal`) | ค่าใช้จ่ายจริง / เงินเหลือจ่าย | กนศ.06 | SH |

### `netprojectbudget` is a plan line per *project*, not per agency-year

`DECISIONS.md:69` and `schema-current.md`'s inventory both describe `netprojectbudget` as
"annual budget **plan lines**". The seven rows in the dump are keyed by project name:

| project_name | responsible_agency | yearly | campus | net_budget | allow_budget |
| --- | --- | ---: | --- | ---: | ---: |
| xik0uoบุรี | องค์การนักศึกษา มจพ.ปราจีนบุรี | 2566 | Prachin | 58,000 | NULL |
| เลือกตั้ง | สภานักศึกษา มจพ.กรุงเทพฯ | 2567 | Bangkok | 258,000 | NULL |
| โครงการ 3 K | สภานักศึกษา มจพ.กรุงเทพฯ | 2567 | Bangkok | 182,000 | 150,100 |
| งานดนตรี music | ชมรมดนตรีสากล | 2567 | Bangkok | 258,000 | NULL |
| งานดนจรีในสวน | ชมรมดนตรีสากล | 2567 | Bangkok | 90,000 | NULL |
| โดนจรี | ชมรมดนตรีสากล | 2567 | Bangkok | 1,000,000 | NULL |
| Ffo9iuuu | ชมรมดนตรีสากล | 2567 | Bangkok | 545,454 | NULL |

Four rows share one agency and year with four different `net_budget` values, so the row cannot
be an agency's annual allocation. **It is one plan line per project**, which is what Q27
("One plan line ↔ one project") already assumes — the "annual" wording elsewhere is loose and
should be corrected. This matters because Q20/Q25 layer (c), the *per-agency yearly ceiling*,
therefore has **no table today at all**: it is genuinely new, not a re-typing of this one.

Whether `net_budget` was *meant* to carry the club's annual figure onto each line is not
resolvable from the data — `258,000` appears against two different agencies, which is
suggestive but not conclusive. Recorded as an open question below.

### What the current system does with these

Nothing coherent: `allow_budget` on `netprojectbudget` is overwritten by two different
endpoints with two different meanings, and `use_budget` is never written by any route
(`business-rules.md` → "Budget"). Treat all budget *rules* as new construction.

---

## Names to retire

Every one of these is carried into the new code only as a migration mapping.

| Old name | Problem | New name |
| --- | --- | --- |
| `AgnecyGroupName` / `agencyGroupName` / `ClubGroup` | one concept, three spellings, two directions | `club_group` + `jurisdiction_club_group` |
| `codeclub` / `codebooksome` | same value, two names | `club_code` |
| `codebooksomeoutyear` | undocumented; means "club code without the year" | `club_code_template` |
| `responsible_agency` | holds a **club name**, not an agency | `club` (FK) |
| `clubName` | club for students, office for staff | split by role |
| `yearly` / `yearly_count` / `yearly_countsketch` | three unrelated things sharing a prefix | `academic_year` / `project_sequence` / `draft_sequence` |
| `p_finalperson` / `p_finalbudget` | "final" means *actual* | `…_actual` |
| `netprojectbudget` | not "net", not annual | `budget_plan_line` |
| `logstudentgetmoney` | | `disbursement` |
| `Divison` | misspelt in the seed file's only top-level key | `division` |
| `is_1basic..is_4basic`, `is_5p2p1_*`, `is_SDGs_*` | positional checkbox banks | reference tables + a join |

---

## Open questions

1. **Does `net_budget` on a plan line mean the project's planned cost or the club's annual
   figure?** The dump supports either reading. Needs a person who used the system. It decides
   whether Q20/Q25 layer (a) compares a project against its own line or against a shared pot.
2. **`D06`–`D12` award categories have no workflow.** Seed them (Q34) but build nothing until
   someone confirms the feature is wanted.
3. **`A0xx` ↔ `A1xx` pairing in `D01`–`D03`** is inferred from the code ranges and the parallel
   name lists, not from a declaration in the file. Verify against one real faculty before the
   seed treats it as a relationship.
4. **Rayong has zero clubs** in all five `D04` groups. Missing data or genuinely no clubs?
5. **Q39 needs revisiting** — see "Person vs. account". A unique constraint on `id_student`
   alone would destroy the `karoms` adviser role.
