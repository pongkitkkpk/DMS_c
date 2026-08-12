# Target Schema — the design

**Status**: Complete. Every one of the 843 current columns is accounted for in the coverage map. Four decisions are taken here on assumptions rather than confirmation — listed under "Assumptions taken" and each marked in place.
**Phase**: Phase 0 deliverable 5 of 5 (per `docs/DECISIONS.md` Q23).
**Last updated**: 2026-08-12

---

## What this file is

The schema the rebuild targets, and the reasoning for each departure. It is **prescriptive** —
the opposite of `schema-current.md`. Where a table here replaces one there, the mapping is
given; nothing is dropped without being named as dropped.

Engine: MariaDB / InnoDB, `utf8mb4_unicode_ci`, to match the existing deployment. DDL below is
the design, not the migration script — the migration is Phase 1 work and has its own ordering
problems (see "Migration hazards").

Reading order: this file assumes `domain-model.md` for vocabulary and `business-rules.md` for
why the constraints exist.

### Conventions

- **Surrogate `INT UNSIGNED AUTO_INCREMENT` PK on every table**, named `id` (Q38). Business
  keys get their own `UNIQUE`.
- `snake_case` English identifiers (Q11). Thai is data, never a column name and never a key.
- Every FK is declared and named `fk_<table>_<column>`. `ON DELETE` is explicit everywhere.
- Money is `DECIMAL(12,2)` (Q37). Counts are `INT UNSIGNED`. Years are `SMALLINT UNSIGNED`.
- No column stores a value derivable from another column in the same row, unless it is a
  `GENERATED` column and therefore cannot drift.
- Timestamps: `created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`,
  `updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`.

### Assumptions taken

Recorded so they can be challenged cheaply later. Each is marked **[A*n*]** at its use site.

- **[A1]** Q37 — money becomes `DECIMAL(12,2)`; the migration reports unparseable values
  rather than coercing. *Recommended in `DECISIONS.md`, never explicitly confirmed.*
- **[A2]** Q38 — surrogate `INT` PK everywhere, `project_number` a separate unique business
  key. *Same status.*
- **[A3]** Q41 — the disbursement ledger is built on today's `logstudentgetmoney` rather than a
  parallel structure. *Same status.*
- **[A4]** Q39 is **revised**, not applied as written. `person` and `membership` are separate
  tables and the unique constraint lands on `(person_id, academic_year, club_id, role)`, not on
  `id_student` alone — because the dump's third `karoms` row is a real second role, not a
  duplicate (`domain-model.md` → "Person vs. account"). *This departs from a decision that was
  explicitly recorded; it needs sign-off, and it is the one item here that changes a settled
  answer rather than filling a gap.*

---

## Shape of the design

Five clusters. The dependency direction is strictly downward — nothing below points up.

```text
  organisation      campus · division · agency · club_group · club · work_group
        │                                    · award_category
        ▼
  identity          person · membership · login_attempt
        │
        ▼
  project           project · project_objective · project_rationale · project_location
        │           project_problem · project_activity · project_indicator
        │           project_attendance · project_tag · project_attachment
        │           project_event
        ▼
  money             agency_allocation · budget_plan_line · budget_line · disbursement
        ▼
  reference         phase · tag · tag_set · attendee_type · expense_category
```

---

## 1. Organisation

Seeded from `setCode.json` (Q34), flattened per Q36 and split per Q35. The four shapes that
file uses are resolved here into one tree plus one cross-link.

```sql
CREATE TABLE campus (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code          VARCHAR(16)  NOT NULL,        -- 'Bangkok' | 'Prachin' | 'Rayong'
  abbreviation  CHAR(1)      NOT NULL,        -- 'B' | 'P' | 'R'  — feeds club_code
  name_th       VARCHAR(255) NOT NULL,        -- 'มจพ. กรุงเทพฯ'
  UNIQUE KEY uq_campus_code (code),
  UNIQUE KEY uq_campus_abbrev (abbreviation)
);

CREATE TABLE division (
  id       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code     CHAR(3)      NOT NULL,             -- 'D01'..'D05'  (D06-D12 are NOT here)
  name_th  VARCHAR(255) NOT NULL,
  UNIQUE KEY uq_division_code (code)
);

CREATE TABLE agency (                          -- an organisational unit
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  division_id  INT UNSIGNED NOT NULL,
  campus_id    INT UNSIGNED NULL,             -- NULL = university-wide
  code         CHAR(4)      NOT NULL,         -- 'A001'
  name_th      VARCHAR(255) NOT NULL,
  UNIQUE KEY uq_agency (division_id, code),
  CONSTRAINT fk_agency_division FOREIGN KEY (division_id) REFERENCES division(id),
  CONSTRAINT fk_agency_campus   FOREIGN KEY (campus_id)   REFERENCES campus(id)
);

CREATE TABLE work_group (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agency_id  INT UNSIGNED NOT NULL,
  code       CHAR(3)      NOT NULL,           -- 'G01'
  name_th    VARCHAR(255) NOT NULL,
  UNIQUE KEY uq_work_group (agency_id, code),
  CONSTRAINT fk_work_group_agency FOREIGN KEY (agency_id) REFERENCES agency(id)
);

CREATE TABLE club_group (                      -- the five D04 groups
  id       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code     VARCHAR(32)  NOT NULL,             -- 'CENTRAL' | 'ACADEMIC' | 'CULTURE' | 'VOLUNTEER' | 'SPORT'
  name_th  VARCHAR(255) NOT NULL,             -- 'ชมรมฝ่ายศิลปวัฒนธรรม'
  UNIQUE KEY uq_club_group_code (code),
  UNIQUE KEY uq_club_group_name (name_th)     -- the migration matches legacy rows on this
);

CREATE TABLE club (                            -- a student club / body — the project owner
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  club_group_id  INT UNSIGNED NOT NULL,
  campus_id      INT UNSIGNED NOT NULL,
  division_id    INT UNSIGNED NOT NULL,
  code           CHAR(4)      NOT NULL,       -- 'A201'
  work_group_code CHAR(2)     NOT NULL DEFAULT '00',
  name_th        VARCHAR(255) NOT NULL,       -- 'ชมรมดนตรีสากล'
  parent_agency_id INT UNSIGNED NULL,         -- the A0xx unit this A1xx body belongs to
  UNIQUE KEY uq_club (division_id, campus_id, code),
  UNIQUE KEY uq_club_name (name_th),          -- legacy joins were by name; keep it unique
  CONSTRAINT fk_club_group   FOREIGN KEY (club_group_id)    REFERENCES club_group(id),
  CONSTRAINT fk_club_campus  FOREIGN KEY (campus_id)        REFERENCES campus(id),
  CONSTRAINT fk_club_division FOREIGN KEY (division_id)     REFERENCES division(id),
  CONSTRAINT fk_club_parent  FOREIGN KEY (parent_agency_id) REFERENCES agency(id)
);

CREATE TABLE award_category (                  -- D06..D12, split out per Q35
  id       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code     CHAR(3)      NOT NULL,             -- 'D06'
  name_th  TEXT         NOT NULL,
  UNIQUE KEY uq_award_category_code (code)
);
```

**`club.parent_agency_id` is the `A0xx` ↔ `A1xx` cross-link** from `domain-model.md` — the
faculty that a faculty student union belongs to. It is nullable because `D04`'s clubs have no
parent unit. This is open question 3 in `domain-model.md`; the column is designed in but the
seed may leave it NULL until the pairing is confirmed.

**`club_code` is not stored.** It is composed at read time from
`campus.abbreviation + year(2) + division.code + club.code + club.work_group_code`. This is the
fix for the truncation defect in `domain-model.md` → "The width invariant is already broken":
a 4-digit year can no longer leak into a 10-character field, because the field does not exist.
The old `codeclub` / `codebooksome` / `codebooksomeoutyear` columns all disappear.

---

## 2. Identity

```sql
CREATE TABLE person (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_student   VARCHAR(100) NOT NULL,         -- ICIT username: 's6303051613149' | 'karoms'
  prefix       VARCHAR(64)  NULL,
  full_name_th VARCHAR(255) NOT NULL,
  email        VARCHAR(255) NULL,
  phone        VARCHAR(32)  NULL,
  account_type ENUM('students','personel') NOT NULL,   -- ICIT identity type, NOT a role
  level_desc   VARCHAR(255) NULL,             -- passed through from ICIT
  stu_status_desc VARCHAR(255) NULL,          -- passed through from ICIT
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_person_id_student (id_student)          -- [A4] safe here: one row per human
);

CREATE TABLE membership (                      -- (person, role, club, year) — the old `users`
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  person_id       INT UNSIGNED NOT NULL,
  role            ENUM('SH','AD','STUACT','ADMIN') NOT NULL,
  academic_year   SMALLINT UNSIGNED NOT NULL,  -- 2567 — Buddhist era, 4 digits
  club_id         INT UNSIGNED NULL,           -- SH / AD: the club they belong to
  agency_id       INT UNSIGNED NULL,           -- STUACT: their employing office
  work_group_id   INT UNSIGNED NULL,           -- STUACT: 'กลุ่มงานกิจกรรมนักศึกษา'
  jurisdiction_club_group_id INT UNSIGNED NULL,-- STUACT only: the group they oversee
  advisor_agency  VARCHAR(255) NULL,           -- AD only: legacy `AgencyAdvisor`
  department_th   VARCHAR(255) NULL,           -- students: their faculty
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_membership (person_id, academic_year, club_id, role),   -- [A4]
  KEY ix_membership_scope (role, jurisdiction_club_group_id, academic_year),
  CONSTRAINT fk_membership_person   FOREIGN KEY (person_id)     REFERENCES person(id) ON DELETE CASCADE,
  CONSTRAINT fk_membership_club     FOREIGN KEY (club_id)       REFERENCES club(id),
  CONSTRAINT fk_membership_agency   FOREIGN KEY (agency_id)     REFERENCES agency(id),
  CONSTRAINT fk_membership_wg       FOREIGN KEY (work_group_id) REFERENCES work_group(id),
  CONSTRAINT fk_membership_jurisdiction
      FOREIGN KEY (jurisdiction_club_group_id) REFERENCES club_group(id),
  CONSTRAINT ck_membership_scope CHECK (
      (role IN ('SH','AD')  AND club_id IS NOT NULL AND jurisdiction_club_group_id IS NULL)
   OR (role = 'STUACT'      AND jurisdiction_club_group_id IS NOT NULL)
   OR (role = 'ADMIN')
  )
);

CREATE TABLE login_attempt (                   -- Q15 keeps login logging
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_student  VARCHAR(100) NOT NULL,           -- deliberately NOT an FK: failures have no person
  is_success  TINYINT(1)   NOT NULL,
  attempted_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_login_attempt (id_student, attempted_at)
);
```

`ck_membership_scope` is the constraint that makes `domain-model.md`'s membership/jurisdiction
distinction structural: a `STUACT` cannot be given a club, an `SH` cannot be given a
jurisdiction. The two columns that were mutually exclusive by accident are now mutually
exclusive by declaration.

`role` is `ENUM` rather than a lookup table because the set is closed, tiny, and load-bearing
in `CHECK` constraints. `S` is not in it — it is dead (`business-rules.md`).

**Authorization contract (Q16).** The JWT carries `person_id` and the active `membership.id`
only. Every scoped query resolves the club/group from that membership row server-side. No
handler may read a scope from a path or query parameter. This is the schema-level half of the
fix for `schema-current.md` defect 5.

---

## 3. Project

### The header

```sql
CREATE TABLE project (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  club_id         INT UNSIGNED NOT NULL,
  owner_person_id INT UNSIGNED NOT NULL,       -- the creating student
  advisor_person_id INT UNSIGNED NULL,         -- was matched by name string; now an FK
  academic_year   SMALLINT UNSIGNED NOT NULL,  -- 2567
  academic_term   VARCHAR(10) NULL,            -- legacy `academic_year` varchar(10)

  name            VARCHAR(255) NOT NULL,
  draft_sequence  SMALLINT UNSIGNED NOT NULL,  -- was yearly_countsketch
  project_sequence SMALLINT UNSIGNED NULL,     -- was yearly_count; NULL until PROJECT_APPROVED
  project_number  VARCHAR(16) NULL,            -- 12 chars today; 16 leaves headroom

  phase_id        INT UNSIGNED NOT NULL,
  is_new_project      TINYINT(1) NOT NULL DEFAULT 0,
  is_continue_project TINYINT(1) NOT NULL DEFAULT 0,

  prepare_start_on DATE NULL,
  prepare_end_on   DATE NULL,
  event_start_on   DATE NULL,
  event_end_on     DATE NULL,
  report_due_on    DATE NULL,                  -- was `deadline` varchar(255)

  contact1_name VARCHAR(255) NULL, contact1_phone VARCHAR(32) NULL,
  contact2_name VARCHAR(255) NULL, contact2_phone VARCHAR(32) NULL,
  contact3_name VARCHAR(255) NULL, contact3_phone VARCHAR(32) NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_project_number (project_number),                          -- [A2] Q18/Q29
  UNIQUE KEY uq_project_sequence (club_id, academic_year, project_sequence),
  UNIQUE KEY uq_project_draft    (club_id, academic_year, draft_sequence),
  KEY ix_project_club_phase (club_id, phase_id),
  KEY ix_project_year (academic_year),
  CONSTRAINT fk_project_club    FOREIGN KEY (club_id)   REFERENCES club(id),
  CONSTRAINT fk_project_owner   FOREIGN KEY (owner_person_id)   REFERENCES person(id),
  CONSTRAINT fk_project_advisor FOREIGN KEY (advisor_person_id) REFERENCES person(id),
  CONSTRAINT fk_project_phase   FOREIGN KEY (phase_id) REFERENCES phase(id)
);
```

The two `UNIQUE` keys on the sequences are the whole fix for `schema-current.md` defect 7:
**both sequences are scoped `(club_id, academic_year)`, not by project name**, so the
deterministic duplicate described in `business-rules.md` → "Numbering" cannot be inserted, and
the read-then-write race fails loudly instead of silently colliding. Sequences are issued
server-side inside the transaction that needs them (Q18/Q29).

`project_number` stays a stored column rather than a generated one because it is a business
identifier printed on government forms: once issued it must not change if a club is renamed or
recoded. It is written once, at `PROJECT_APPROVED`, and never updated.

Contacts stay as three inline pairs rather than becoming a table. They are a fixed part of the
form, always exactly three, never queried across projects, and never ordered — a child table
would buy nothing and cost a join on every render. This is the one place the denormalized
shape is kept deliberately.

### Narrative lists

`objective1..5`, `principles_and_reasons1..5`, `location1..5`, and the `problem`/`result` pairs
are ordered lists that the form caps and the domain does not (Q8). Four small tables rather
than one polymorphic bag, because each is asked for by name at render time and a `kind` column
would make every query a filter:

```sql
CREATE TABLE project_objective (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id INT UNSIGNED NOT NULL,
  ordinal    SMALLINT UNSIGNED NOT NULL,
  content    TEXT NOT NULL,
  UNIQUE KEY uq_project_objective (project_id, ordinal),
  CONSTRAINT fk_project_objective FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);
-- project_rationale  (was principles_and_reasons1..5)  — identical shape
-- project_location   (was location1..5)                — identical shape
CREATE TABLE project_problem (                 -- was problem1..3 / result1..3, a paired family
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id INT UNSIGNED NOT NULL,
  ordinal    SMALLINT UNSIGNED NOT NULL,
  problem    TEXT NOT NULL,
  resolution TEXT NULL,
  UNIQUE KEY uq_project_problem (project_id, ordinal),
  CONSTRAINT fk_project_problem FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);
```

`project_type1..5` is not narrative — it is a classification, and it joins the tag model below.

### Checkbox banks → tags

`is_SDGs_1..17`, `is_5p1_1..4`, `is_5p2p1_1..9`, `is_5p2p2_1..6`, `is_5p2p3_1..7`,
`is_1side..is_5side`, `is_1basic..is_4basic`, `is_1follow..is_4follow` are **52 boolean columns
encoding membership in 8 closed vocabularies**. One join table replaces all of them, and adding
an 18th SDG becomes a row rather than a migration:

```sql
CREATE TABLE tag_set (
  id      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code    VARCHAR(32)  NOT NULL,              -- 'SDG' | 'STRATEGY_5P1' | 'SIDE' | 'BASIC' | 'FOLLOW' | 'PROJECT_TYPE'
  name_th VARCHAR(255) NOT NULL,
  UNIQUE KEY uq_tag_set_code (code)
);
CREATE TABLE tag (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tag_set_id  INT UNSIGNED NOT NULL,
  ordinal     SMALLINT UNSIGNED NOT NULL,     -- 1..17 for SDG — the template's tag index
  name_th     TEXT NOT NULL,
  UNIQUE KEY uq_tag (tag_set_id, ordinal),
  CONSTRAINT fk_tag_set FOREIGN KEY (tag_set_id) REFERENCES tag_set(id)
);
CREATE TABLE project_tag (
  project_id INT UNSIGNED NOT NULL,
  tag_id     INT UNSIGNED NOT NULL,
  PRIMARY KEY (project_id, tag_id),
  KEY ix_project_tag_tag (tag_id),            -- "which projects hit SDG 4" becomes indexable
  CONSTRAINT fk_project_tag_project FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_tag_tag     FOREIGN KEY (tag_id)     REFERENCES tag(id)
);
```

`tag.ordinal` is load-bearing: it is what the assembler uses to emit `is_SDGs_4` for the
template, so the mapping back to the Word forms stays mechanical. `is_etcfollow` / `etcfollow`
(a free-text "other") stay as a nullable column on `project_indicator` — a tag table cannot hold
free text.

### Schedule, indicators, attendance

```sql
CREATE TABLE project_activity (                -- was p_timestep's 15 numbered rows
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id  INT UNSIGNED NOT NULL,
  ordinal     SMALLINT UNSIGNED NOT NULL,
  topic       TEXT NOT NULL,
  start_on    DATE NOT NULL,
  end_on      DATE NOT NULL,
  responsible VARCHAR(255) NULL,
  UNIQUE KEY uq_project_activity (project_id, ordinal),
  CONSTRAINT fk_project_activity FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
  CONSTRAINT ck_activity_dates CHECK (end_on >= start_on)
);

CREATE TABLE project_indicator (               -- was p_indicator's 5 numbered rows
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id      INT UNSIGNED NOT NULL,
  ordinal         SMALLINT UNSIGNED NOT NULL,
  expected_result TEXT NULL,
  quality_target  TEXT NULL,
  volume_target   TEXT NULL,
  UNIQUE KEY uq_project_indicator (project_id, ordinal),
  CONSTRAINT fk_project_indicator FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);

CREATE TABLE project_attendance (              -- was p_person + p_finalperson, 110 columns
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id    INT UNSIGNED NOT NULL,
  variant       ENUM('PLANNED','ACTUAL') NOT NULL,   -- กนศ.04 vs กนศ.06
  attendee_type ENUM('STUDENT','PROFESSOR','EXECUTIVE','EXPERT','OTHER') NOT NULL,
  ordinal       SMALLINT UNSIGNED NOT NULL,
  label         VARCHAR(255) NULL,             -- was {type}Type{n}Name
  headcount     INT UNSIGNED NOT NULL DEFAULT 0,     -- was {type}Type{n}Number, stored as text
  UNIQUE KEY uq_project_attendance (project_id, variant, attendee_type, ordinal),
  CONSTRAINT fk_project_attendance FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);
```

**Every `grandTotal*` column is gone** — `SUM(headcount)` replaces five stored totals per
variant. That closes `schema-current.md` defect 10 for attendance. `startM`/`endM` are gone
too: the Gantt month indices are derived from `start_on`/`end_on` at render time (Q19), which
also removes the numeric-comparison-on-`text` hazard the template relies on.

The `thai*` date strings — 5 pairs on `projects`, 15 pairs on `p_timestep` — are **all
dropped**. They are presentation, formatted by the assembler (`schema-current.md` defect 11).

### Attachments and the event log

```sql
CREATE TABLE project_attachment (              -- was p_addfile
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id    INT UNSIGNED NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  storage_path  VARCHAR(512) NOT NULL,         -- RELATIVE to the upload root (Q21)
  byte_size     INT UNSIGNED NULL,
  uploaded_by   INT UNSIGNED NOT NULL,
  uploaded_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_project_attachment (project_id),
  CONSTRAINT fk_attachment_project FOREIGN KEY (project_id)  REFERENCES project(id) ON DELETE CASCADE,
  CONSTRAINT fk_attachment_person  FOREIGN KEY (uploaded_by) REFERENCES person(id)
);

CREATE TABLE project_event (                   -- Q15: replaces status_project +
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, --      logstatus_project + historyeditproject
  project_id   INT UNSIGNED NOT NULL,
  event_type   ENUM('CREATED','PHASE_CHANGED','EDITED','BUDGET_APPROVED',
                    'DISBURSED','ATTACHMENT_ADDED') NOT NULL,
  from_phase_id INT UNSIGNED NULL,
  to_phase_id   INT UNSIGNED NULL,
  edited_section VARCHAR(64) NULL,             -- was historyeditproject.editpage (Thai UI name)
  actor_person_id INT UNSIGNED NOT NULL,
  detail       JSON NULL,
  occurred_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_project_event (project_id, occurred_at),
  CONSTRAINT fk_event_project FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
  CONSTRAINT fk_event_actor   FOREIGN KEY (actor_person_id) REFERENCES person(id),
  CONSTRAINT fk_event_from    FOREIGN KEY (from_phase_id) REFERENCES phase(id),
  CONSTRAINT fk_event_to      FOREIGN KEY (to_phase_id)   REFERENCES phase(id)
);
```

**Append-only, and the only place transition history lives.** `project.phase_id` is the current
phase and the single source of truth; the log records how it got there. Today the same fact
lives in `projects.project_phase` *and* `status_project`, written by two unawaited queries that
can diverge (`business-rules.md`). `edited_section` keeps what `historyeditproject` recorded —
that a page was touched — while `detail JSON` leaves room to record *what* changed, which the
old table never did.

`from_phase_id` makes the log self-validating: a replay that does not chain is detectably
corrupt, which is how `schema-current.md` defect 9 (16 orphaned `logstatus_project` rows) would
have been caught at write time.

### Phases

```sql
CREATE TABLE phase (
  id       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code     VARCHAR(32) NOT NULL,              -- 'DRAFT_PROPOSAL' ... 'CLOSED'  (Q14)
  ordinal  TINYINT UNSIGNED NOT NULL,         -- 1..7
  name_th  VARCHAR(255) NOT NULL,             -- 'ร่างคำขออนุมัติ'
  UNIQUE KEY uq_phase_code (code),
  UNIQUE KEY uq_phase_ordinal (ordinal)
);

CREATE TABLE phase_transition (               -- the transition table that does not exist today
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  from_phase_id INT UNSIGNED NOT NULL,
  to_phase_id   INT UNSIGNED NOT NULL,
  allowed_role  ENUM('SH','AD','STUACT','ADMIN') NOT NULL,
  requires_budget_check TINYINT(1) NOT NULL DEFAULT 0,   -- Q26 hard-block points
  UNIQUE KEY uq_transition (from_phase_id, to_phase_id, allowed_role),
  CONSTRAINT fk_transition_from FOREIGN KEY (from_phase_id) REFERENCES phase(id),
  CONSTRAINT fk_transition_to   FOREIGN KEY (to_phase_id)   REFERENCES phase(id)
);
```

Seven phases (Q40 drops the four unused `รอ…` states). `phase_transition` is seeded from the
JSX gate table in `business-rules.md` → "Where the rules actually live" — that table is the
specification, and this is where it stops being JSX. `requires_budget_check` is set on the
three transitions Q26 hard-blocks (`PROJECT_APPROVED`, `BUDGET_APPROVED`, `REPORT_SUBMITTED`).

---

## 4. Money

All amounts `DECIMAL(12,2)` **[A1]**. No amount that can be summed from rows is stored.

```sql
CREATE TABLE agency_allocation (               -- NEW — Q20/Q25 layer (c). No table exists today.
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  club_id       INT UNSIGNED NOT NULL,
  campus_id     INT UNSIGNED NOT NULL,
  academic_year SMALLINT UNSIGNED NOT NULL,
  amount        DECIMAL(12,2) NOT NULL,
  created_by    INT UNSIGNED NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_allocation (club_id, campus_id, academic_year),          -- Q31 grain
  CONSTRAINT fk_allocation_club   FOREIGN KEY (club_id)    REFERENCES club(id),
  CONSTRAINT fk_allocation_campus FOREIGN KEY (campus_id)  REFERENCES campus(id),
  CONSTRAINT fk_allocation_person FOREIGN KEY (created_by) REFERENCES person(id),
  CONSTRAINT ck_allocation_positive CHECK (amount >= 0)
);

CREATE TABLE budget_plan_line (                -- was netprojectbudget
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id      INT UNSIGNED NOT NULL,
  planned_amount  DECIMAL(12,2) NOT NULL,      -- was net_budget
  approved_amount DECIMAL(12,2) NULL,          -- was allow_budget; NULL until approval
  approved_by     INT UNSIGNED NULL,
  approved_at     DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_plan_line_project (project_id),                          -- Q27: one ↔ one
  CONSTRAINT fk_plan_line_project FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
  CONSTRAINT fk_plan_line_person  FOREIGN KEY (approved_by) REFERENCES person(id),
  CONSTRAINT ck_plan_amounts CHECK (planned_amount >= 0 AND (approved_amount IS NULL OR approved_amount >= 0))
);

CREATE TABLE budget_line (                     -- was p_budget (382 cols) + p_finalbudget
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id  INT UNSIGNED NOT NULL,
  variant     ENUM('PLANNED','ACTUAL') NOT NULL,           -- Q13: กนศ.06 gains line items
  category    ENUM('A','BT','BNT','C','ETC') NOT NULL,
  ordinal     SMALLINT UNSIGNED NOT NULL,
  description VARCHAR(512) NOT NULL,
  qty1        DECIMAL(10,2) NULL,              -- 'N'
  unit1       VARCHAR(64)   NULL,              -- 'NN' — NULL for A: hard-coded 'คน'
  qty2        DECIMAL(10,2) NULL,              -- 'T'  — NULL for BNT/C: single-quantity
  unit2       VARCHAR(64)   NULL,              -- 'TN' — NULL for A: hard-coded 'ชั่วโมง'
  unit_price  DECIMAL(12,2) NOT NULL,          -- 'TP' — the only real money input
  amount      DECIMAL(12,2) AS (
                 COALESCE(qty1,1) * COALESCE(qty2,1) * unit_price
              ) STORED,                        -- was 'S', a cached client-side computation
  UNIQUE KEY uq_budget_line (project_id, variant, category, ordinal),
  KEY ix_budget_line_project (project_id, variant),
  CONSTRAINT fk_budget_line_project FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
  CONSTRAINT ck_budget_line_positive CHECK (unit_price >= 0)
);

CREATE TABLE disbursement (                    -- was logstudentgetmoney  [A3] Q41
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id       INT UNSIGNED NOT NULL,
  amount           DECIMAL(12,2) NOT NULL,     -- was numberstudent_receive
  received_by_name VARCHAR(255) NOT NULL,      -- was namestudent_receive
  issued_by_name   VARCHAR(255) NOT NULL,      -- was namestuact_receive
  disbursed_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_disbursement_project (project_id, disbursed_at),
  CONSTRAINT fk_disbursement_project FOREIGN KEY (project_id) REFERENCES project(id),
  CONSTRAINT ck_disbursement_positive CHECK (amount > 0)
);
```

`budget_line.amount` is a **`GENERATED … STORED`** column, which is the structural answer to
`schema-current.md` defect 10: the line total is stored (so it is indexable and summable) but
cannot drift, because the database computes it. `COALESCE(qty*, 1)` encodes the per-category
shape recorded in `schema-current.md` — category `A` is `people × hours × rate`, `BNT` and `C`
are `qty × price`.

**`remainingBudget` is deleted, not converted.** It was a running balance stored per row with
thousands separators. Remaining is a subtraction over committed rows (Q28):

```sql
CREATE VIEW project_budget_status AS
SELECT p.id AS project_id,
       pl.planned_amount,
       pl.approved_amount,
       COALESCE((SELECT SUM(amount) FROM budget_line b
                  WHERE b.project_id = p.id AND b.variant = 'PLANNED'), 0) AS requested_total,
       COALESCE((SELECT SUM(amount) FROM budget_line b
                  WHERE b.project_id = p.id AND b.variant = 'ACTUAL'), 0)  AS actual_total,
       COALESCE((SELECT SUM(amount) FROM disbursement d
                  WHERE d.project_id = p.id), 0)                           AS disbursed_total,
       pl.approved_amount
         - COALESCE((SELECT SUM(amount) FROM disbursement d
                      WHERE d.project_id = p.id), 0)                       AS remaining
FROM project p
LEFT JOIN budget_plan_line pl ON pl.project_id = p.id;
```

`refundtotal` likewise disappears: it is `approved_amount - actual_total`.

**The three enforcement layers (Q20/Q25/Q32)** read as three comparisons against this view,
each with its own error message:

| Layer | Rule | Enforced at |
| --- | --- | --- |
| (a) plan | `requested_total ≤ planned_amount` | warn on draft submit, block at `PROJECT_APPROVED` |
| (b) commitment | `disbursed_total ≤ approved_amount`, and `actual_total ≤ approved_amount` | block at `BUDGET_APPROVED` / `REPORT_SUBMITTED` |
| (c) allocation | `Σ approved_amount over the club-year ≤ agency_allocation.amount` | block at `PROJECT_APPROVED` |

Layer (c) cannot be a `CHECK` — it spans rows — so it is a `SELECT … FOR UPDATE` on the
allocation row inside the approving transaction (Q28). Lowering an allocation below committed
spend stays **allowed with a warning** (Q33), which is why it is not a constraint.

---

## 5. Coverage map

Every current table, and where its 843 columns go. Nothing is dropped silently.

| Current table | Cols | Target | Notes |
| --- | ---: | --- | --- |
| `projects` | 117 | `project` + `project_objective` / `_rationale` / `_location` / `_problem` + `project_tag` + `budget_plan_line` | 52 checkbox cols → tags; 11 `thai*` cols dropped; 3 money cols → `budget_plan_line` |
| `p_budget` | 382 | `budget_line` (PLANNED) | 365 matrix cols → rows; 13 subtotal/total cols → derived |
| `p_timestep` | 129 | `project_activity` | 30 `thai*` + 30 `startM`/`endM` dropped (derived) |
| `p_person` | 55 | `project_attendance` (PLANNED) | 6 `grandTotal*` → `SUM()` |
| `p_finalperson` | 55 | `project_attendance` (ACTUAL) | same |
| `p_indicator` | 25 | `project_indicator` + `project_tag` (`FOLLOW` set) | |
| `users` | 23 | `person` + `membership` | 3 `code*` cols dropped — club code is composed |
| `logstudentgetmoney` | 9 | `disbursement` | `remainingBudget` dropped (derived) |
| `netprojectbudget` | 8 | `budget_plan_line` | `project_name` string join → FK (Q27) |
| `historyeditproject` | 8 | `project_event` (`EDITED`) | `countedit` dropped — it is `COUNT(*)` |
| `status_project` | 8 | `project.phase_id` | the duplicate current-status is removed (Q15) |
| `logstatus_project` | 7 | `project_event` (`PHASE_CHANGED`) | |
| `p_finalbudget` | 7 | `budget_line` (ACTUAL) | 4 aggregates → derived; `refundtotal` → derived |
| `p_addfile` | 6 | `project_attachment` | `filepath` becomes relative (Q21) |
| `login` | 4 | `login_attempt` | |
| **Total** | **843** | **29 tables** | |

**Deliberately dropped or replaced by a derived value**, with the reason. Counts are exact and
were taken from `schema-current.md`'s column inventory, not estimated:

| Dropped / derived | Count | Why |
| --- | ---: | --- |
| `thai*` pre-rendered dates — `projects` 5, `p_timestep` 30 | 35 | presentation; formatted by the assembler (defect 11) |
| `startM1..15` / `endM1..15` Gantt indices | 30 | derived from real dates (Q19) |
| `is_*` checkbox banks — `projects` 52, `p_indicator` 4 | 56 | replaced by `project_tag` |
| `listS{A,BT,BNT,C}` line totals — 15+20+10+20 | 65 | become the `GENERATED` `budget_line.amount` |
| `p_budget` subtotals + grand totals + `thailistSAll` | 8 | derived; `listSSBT`/`listSSBNT` are in neither template |
| `Type{A,BT,BNT,C}Count` rows-used counters | 4 | `COUNT(*)` |
| `grandTotal*` + `*TypeCount` on `p_person` / `p_finalperson` | 20 | `SUM()` / `COUNT()`; they drift today (defect 10) |
| `p_finalbudget` aggregates + `refundtotal` | 5 | derived from `budget_line` (ACTUAL) |
| `codeclub` (×10), `codebooksome` (×1), `codebooksomeoutyear` (×2) | 13 | composed from FKs; the stored copy is what broke the width invariant |
| `yearly_countsketch` on the 6 child tables | 6 | children key on `project_id` |
| `remainingBudget`, `countedit` | 2 | running balance and edit count are both aggregates |

`codeclub` alone is copied onto **10 of the 15 tables** — `projects`, all six project children,
both status tables and `historyeditproject`. None of the copies is indexed and none is
constrained, so a club recode today would have to be applied ten times by hand. That is the
clearest single illustration of why the club code becomes a composition rather than a column.

---

## Migration hazards

Ordered by how much they can cost if missed. Detail in Phase 1.

1. **Money strings.** Strip `,`, parse as `en-US`, and **report** anything unparseable rather
   than coercing to 0 **[A1]**. Any value with a decimal part is a red flag — the old client
   `parseInt`-ed everything, so real data should be whole baht (`schema-current.md` defect 1).
2. **Orphaned log rows.** `logstatus_project` references 16 project ids that do not exist
   (defect 9). `project_event.project_id` is a hard FK, so these **cannot** be migrated as-is.
   This is `schema-current.md`'s remaining open question and it must be answered before the
   migration runs: drop them, or create tombstone `project` rows.
3. **Name-based joins become FKs.** `netprojectbudget.project_name`,
   `projects.advisor_name` → `users.name_student`, `responsible_agency` → `clubName`. Each will
   have unmatched rows. Every one needs a reconciliation report, not a silent NULL.
4. **The `karoms` rows** — collapse 23/24, keep 26 as a second membership **[A4]**.
5. **The 12-character `codebooksome`.** Two rows carry `B26670100101` from a 4-digit year. The
   migration must parse the year as 2 *or* 4 digits and normalise to 4
   (`domain-model.md` → "The width invariant is already broken").
6. **`yearly` = 2667** on those same rows — out of range for `SMALLINT` sanity checks and
   almost certainly 2567. Report, do not guess.
7. **`historyeditproject.edit_at` is `'0000-00-00'` in every row.** Use `edit_time`.
8. **Phase strings → codes.** Exact-match the seven Thai strings (Q14); anything unmatched is
   an error, not a default.

---

## What this schema does not do

Stated so the gaps are decisions rather than oversights.

- **No soft delete.** `DELETE FROM project` cascades. If projects must be recoverable, that is
  a change to make now, not after the migration.
- **No row-level multi-tenancy.** Scope is enforced in the application from the JWT's
  membership (Q16), not by the database. A DB-level policy would be stronger; MariaDB has no
  native RLS, so this stays an application invariant.
- **`award_category` has no workflow.** Seeded and otherwise inert until someone confirms the
  feature (`domain-model.md` open question 2).
- **No approval-chain modelling.** `phase_transition` records who *may* act, not a queue of
  who *must*. The review queue is explicitly out of v1 scope (Q5).
- **Template arity is not a constraint.** `budget_line` and `project_activity` are uncapped by
  design (Q8); the assembler errors when a project exceeds what the form can print. The known
  live case is `BT` — 20 rows stored, 12 printed (`template-contract.md`).
