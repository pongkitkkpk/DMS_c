-- 001_initial_schema.sql
-- The target schema from docs/schema-target.md. 29 tables + 1 view.
--
-- Ordered so that every FK's parent exists before its child. Nothing here is a
-- migration of old data: the previous database was entirely mock (DECISIONS.md,
-- 2026-08-12), so this creates from empty and is seeded separately.

-- ---------------------------------------------------------------------------
-- 1. Organisation
-- ---------------------------------------------------------------------------

CREATE TABLE `campus` (
  `id`           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `code`         VARCHAR(16)  NOT NULL,   -- 'Bangkok' | 'Prachin' | 'Rayong'
  `abbreviation` CHAR(1)      NOT NULL,   -- 'B' | 'P' | 'R' — first char of club_code
  `name_th`      VARCHAR(255) NOT NULL,   -- 'มจพ. กรุงเทพฯ'
  UNIQUE KEY `uq_campus_code`   (`code`),
  UNIQUE KEY `uq_campus_abbrev` (`abbreviation`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `division` (
  `id`      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `code`    CHAR(3)      NOT NULL,        -- 'D01'..'D05'; D06-D12 live in award_category
  `name_th` VARCHAR(255) NOT NULL,
  UNIQUE KEY `uq_division_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `agency` (
  `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `division_id` INT UNSIGNED NOT NULL,
  `campus_id`   INT UNSIGNED NULL,        -- NULL = university-wide
  `code`        CHAR(4)      NOT NULL,    -- 'A001'
  `name_th`     VARCHAR(255) NOT NULL,
  UNIQUE KEY `uq_agency` (`division_id`, `code`, `campus_id`),
  KEY `ix_agency_division` (`division_id`),
  CONSTRAINT `fk_agency_division` FOREIGN KEY (`division_id`) REFERENCES `division`(`id`),
  CONSTRAINT `fk_agency_campus`   FOREIGN KEY (`campus_id`)   REFERENCES `campus`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `work_group` (
  `id`        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `agency_id` INT UNSIGNED NOT NULL,
  `code`      CHAR(3)      NOT NULL,      -- 'G01'
  `name_th`   VARCHAR(255) NOT NULL,
  UNIQUE KEY `uq_work_group` (`agency_id`, `code`),
  CONSTRAINT `fk_work_group_agency` FOREIGN KEY (`agency_id`) REFERENCES `agency`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The five D04 groups. Their names are the values the old schema stored in
-- projects.AgnecyGroupName / users.agencyGroupName / users.ClubGroup.
CREATE TABLE `club_group` (
  `id`      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `code`    VARCHAR(32)  NOT NULL,        -- 'CENTRAL' | 'ACADEMIC' | 'CULTURE' | 'VOLUNTEER' | 'SPORT'
  `name_th` VARCHAR(255) NOT NULL,        -- 'ชมรมฝ่ายศิลปวัฒนธรรม'
  UNIQUE KEY `uq_club_group_code` (`code`),
  UNIQUE KEY `uq_club_group_name` (`name_th`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `club` (
  `id`               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  -- NULL for the 16 non-D04 student bodies (D02's 15 สโมสร, D03's 1 สมาคม):
  -- only D04 clubs belong to one of the five club groups.
  `club_group_id`    INT UNSIGNED NULL,
  `campus_id`        INT UNSIGNED NOT NULL,
  `division_id`      INT UNSIGNED NOT NULL,
  `code`             CHAR(4)      NOT NULL,               -- 'A201'
  `work_group_code`  CHAR(2)      NOT NULL DEFAULT '00',  -- numeric part only
  `name_th`          VARCHAR(255) NOT NULL,               -- 'ชมรมดนตรีสากล'
  `parent_agency_id` INT UNSIGNED NULL,                   -- the A0xx unit an A1xx body belongs to
  UNIQUE KEY `uq_club` (`division_id`, `campus_id`, `code`),
  -- Scoped by campus, NOT globally unique: 'ชมรมพุทธศาสน์' exists on both the
  -- Bangkok (A201) and Prachin (A233) campuses, in the same club group.
  UNIQUE KEY `uq_club_name` (`name_th`, `campus_id`),
  KEY `ix_club_group` (`club_group_id`),
  CONSTRAINT `fk_club_group`    FOREIGN KEY (`club_group_id`)    REFERENCES `club_group`(`id`),
  CONSTRAINT `fk_club_campus`   FOREIGN KEY (`campus_id`)        REFERENCES `campus`(`id`),
  CONSTRAINT `fk_club_division` FOREIGN KEY (`division_id`)      REFERENCES `division`(`id`),
  CONSTRAINT `fk_club_parent`   FOREIGN KEY (`parent_agency_id`) REFERENCES `agency`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- D06..D12. Split out per Q35: these name STUDENTS, not units or projects.
-- Seeded but inert — no workflow reads them yet.
CREATE TABLE `award_category` (
  `id`      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `code`    CHAR(3) NOT NULL,             -- 'D06'
  `name_th` TEXT    NOT NULL,
  UNIQUE KEY `uq_award_category_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2. Identity
-- ---------------------------------------------------------------------------

CREATE TABLE `person` (
  `id`              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `id_student`      VARCHAR(100) NOT NULL,   -- ICIT username
  `prefix`          VARCHAR(64)  NULL,
  `full_name_th`    VARCHAR(255) NOT NULL,
  `email`           VARCHAR(255) NULL,
  `phone`           VARCHAR(32)  NULL,
  `account_type`    ENUM('students','personel') NOT NULL,  -- ICIT identity type, NOT a role
  `level_desc`      VARCHAR(255) NULL,
  `stu_status_desc` VARCHAR(255) NULL,
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_person_id_student` (`id_student`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The old `users` table was really a (person, role, club, year) enrolment.
-- A4: one person may hold several memberships.
CREATE TABLE `membership` (
  `id`                         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `person_id`                  INT UNSIGNED NOT NULL,
  `role`                       ENUM('SH','AD','STUACT','ADMIN') NOT NULL,
  `academic_year`              SMALLINT UNSIGNED NOT NULL,   -- 2567, Buddhist era
  `club_id`                    INT UNSIGNED NULL,            -- SH/AD: the club they belong to
  `agency_id`                  INT UNSIGNED NULL,            -- STUACT: employing office
  `work_group_id`              INT UNSIGNED NULL,
  `jurisdiction_club_group_id` INT UNSIGNED NULL,            -- STUACT only: the group they oversee
  `advisor_agency`             VARCHAR(255) NULL,            -- AD only
  `department_th`              VARCHAR(255) NULL,
  `created_at`                 DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_membership` (`person_id`, `academic_year`, `club_id`, `role`),
  KEY `ix_membership_scope` (`role`, `jurisdiction_club_group_id`, `academic_year`),
  KEY `ix_membership_club`  (`club_id`, `academic_year`),
  CONSTRAINT `fk_membership_person` FOREIGN KEY (`person_id`)     REFERENCES `person`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_membership_club`   FOREIGN KEY (`club_id`)       REFERENCES `club`(`id`),
  CONSTRAINT `fk_membership_agency` FOREIGN KEY (`agency_id`)     REFERENCES `agency`(`id`),
  CONSTRAINT `fk_membership_wg`     FOREIGN KEY (`work_group_id`) REFERENCES `work_group`(`id`),
  CONSTRAINT `fk_membership_jurisdiction`
      FOREIGN KEY (`jurisdiction_club_group_id`) REFERENCES `club_group`(`id`),
  -- Makes the membership/jurisdiction distinction structural: a STUACT cannot hold
  -- a club, an SH/AD cannot hold a jurisdiction.
  CONSTRAINT `ck_membership_scope` CHECK (
       (`role` IN ('SH','AD') AND `club_id` IS NOT NULL AND `jurisdiction_club_group_id` IS NULL)
    OR (`role` = 'STUACT'     AND `jurisdiction_club_group_id` IS NOT NULL AND `club_id` IS NULL)
    OR (`role` = 'ADMIN')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Deliberately NOT an FK to person: a failed attempt may name nobody.
CREATE TABLE `login_attempt` (
  `id`           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `id_student`   VARCHAR(100) NOT NULL,
  `is_success`   TINYINT(1)   NOT NULL,
  `attempted_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `ix_login_attempt` (`id_student`, `attempted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3. Reference — phases and tags
-- ---------------------------------------------------------------------------

CREATE TABLE `phase` (
  `id`      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `code`    VARCHAR(32)      NOT NULL,   -- 'DRAFT_PROPOSAL'..'CLOSED' (Q14)
  `ordinal` TINYINT UNSIGNED NOT NULL,   -- 1..7
  `name_th` VARCHAR(255)     NOT NULL,
  UNIQUE KEY `uq_phase_code`    (`code`),
  UNIQUE KEY `uq_phase_ordinal` (`ordinal`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The transition table the old system did not have. Seeded from the JSX gate
-- table in business-rules.md — that table is the specification.
CREATE TABLE `phase_transition` (
  `id`                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `from_phase_id`         INT UNSIGNED NOT NULL,
  `to_phase_id`           INT UNSIGNED NOT NULL,
  `allowed_role`          ENUM('SH','AD','STUACT','ADMIN') NOT NULL,
  `requires_budget_check` TINYINT(1) NOT NULL DEFAULT 0,   -- Q26 hard-block points
  UNIQUE KEY `uq_transition` (`from_phase_id`, `to_phase_id`, `allowed_role`),
  CONSTRAINT `fk_transition_from` FOREIGN KEY (`from_phase_id`) REFERENCES `phase`(`id`),
  CONSTRAINT `fk_transition_to`   FOREIGN KEY (`to_phase_id`)   REFERENCES `phase`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8 closed vocabularies, 56 tags total, replacing 56 is_* boolean columns.
-- project_type is NOT one of them — it is free text (SD_detail2.js:496), so it
-- is a narrative list like objectives.
CREATE TABLE `tag_set` (
  `id`      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `code`    VARCHAR(32)  NOT NULL,   -- 'SDG'|'P5_1'|'P5_2_1'|'P5_2_2'|'P5_2_3'|'SIDE'|'BASIC'|'FOLLOW'
  `name_th` VARCHAR(255) NOT NULL,
  UNIQUE KEY `uq_tag_set_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- `ordinal` is load-bearing: it is what the assembler uses to emit is_SDGs_4 etc.
CREATE TABLE `tag` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `tag_set_id` INT UNSIGNED NOT NULL,
  `ordinal`    SMALLINT UNSIGNED NOT NULL,
  `name_th`    TEXT NOT NULL,
  UNIQUE KEY `uq_tag` (`tag_set_id`, `ordinal`),
  CONSTRAINT `fk_tag_set` FOREIGN KEY (`tag_set_id`) REFERENCES `tag_set`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4. Project
-- ---------------------------------------------------------------------------

CREATE TABLE `project` (
  `id`                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `club_id`             INT UNSIGNED NOT NULL,
  `owner_person_id`     INT UNSIGNED NOT NULL,
  `advisor_person_id`   INT UNSIGNED NULL,
  `academic_year`       SMALLINT UNSIGNED NOT NULL,
  `academic_term`       VARCHAR(10) NULL,

  `name`                VARCHAR(255) NOT NULL,
  `draft_sequence`      SMALLINT UNSIGNED NOT NULL,   -- was yearly_countsketch
  `project_sequence`    SMALLINT UNSIGNED NULL,       -- was yearly_count; NULL until approval
  `project_number`      VARCHAR(16) NULL,             -- 12 chars today, headroom to 16

  `phase_id`            INT UNSIGNED NOT NULL,
  `is_new_project`      TINYINT(1) NOT NULL DEFAULT 0,
  `is_continue_project` TINYINT(1) NOT NULL DEFAULT 0,

  `prepare_start_on`    DATE NULL,
  `prepare_end_on`      DATE NULL,
  `event_start_on`      DATE NULL,
  `event_end_on`        DATE NULL,
  `report_due_on`       DATE NULL,

  `contact1_name` VARCHAR(255) NULL, `contact1_phone` VARCHAR(32) NULL,
  `contact2_name` VARCHAR(255) NULL, `contact2_phone` VARCHAR(32) NULL,
  `contact3_name` VARCHAR(255) NULL, `contact3_phone` VARCHAR(32) NULL,

  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- These three keys are the fix for the duplicate-project_number defect: both
  -- sequences are scoped by (club, year), so the old name-scoped maximum cannot
  -- be expressed and a concurrent issue fails loudly instead of colliding.
  UNIQUE KEY `uq_project_number`   (`project_number`),
  UNIQUE KEY `uq_project_sequence` (`club_id`, `academic_year`, `project_sequence`),
  UNIQUE KEY `uq_project_draft`    (`club_id`, `academic_year`, `draft_sequence`),
  KEY `ix_project_club_phase` (`club_id`, `phase_id`),
  KEY `ix_project_year`       (`academic_year`),
  CONSTRAINT `fk_project_club`    FOREIGN KEY (`club_id`)           REFERENCES `club`(`id`),
  CONSTRAINT `fk_project_owner`   FOREIGN KEY (`owner_person_id`)   REFERENCES `person`(`id`),
  CONSTRAINT `fk_project_advisor` FOREIGN KEY (`advisor_person_id`) REFERENCES `person`(`id`),
  CONSTRAINT `fk_project_phase`   FOREIGN KEY (`phase_id`)          REFERENCES `phase`(`id`),
  CONSTRAINT `ck_project_dates` CHECK (
       (`prepare_end_on` IS NULL OR `prepare_start_on` IS NULL OR `prepare_end_on` >= `prepare_start_on`)
   AND (`event_end_on`   IS NULL OR `event_start_on`   IS NULL OR `event_end_on`   >= `event_start_on`)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ordered narrative lists. Uncapped by design (Q8) — the form's arity is the
-- assembler's problem, not the database's.
CREATE TABLE `project_objective` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `project_id` INT UNSIGNED NOT NULL,
  `ordinal`    SMALLINT UNSIGNED NOT NULL,
  `content`    TEXT NOT NULL,
  UNIQUE KEY `uq_project_objective` (`project_id`, `ordinal`),
  CONSTRAINT `fk_project_objective` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `project_rationale` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `project_id` INT UNSIGNED NOT NULL,
  `ordinal`    SMALLINT UNSIGNED NOT NULL,
  `content`    TEXT NOT NULL,
  UNIQUE KEY `uq_project_rationale` (`project_id`, `ordinal`),
  CONSTRAINT `fk_project_rationale` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `project_location` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `project_id` INT UNSIGNED NOT NULL,
  `ordinal`    SMALLINT UNSIGNED NOT NULL,
  `content`    TEXT NOT NULL,
  UNIQUE KEY `uq_project_location` (`project_id`, `ordinal`),
  CONSTRAINT `fk_project_location` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- was project_type1..5. Free text, not a vocabulary — the old UI bound these to
-- plain text inputs (SD_detail2.js:496), so they are a list, not tags.
CREATE TABLE `project_type` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `project_id` INT UNSIGNED NOT NULL,
  `ordinal`    SMALLINT UNSIGNED NOT NULL,
  `content`    VARCHAR(255) NOT NULL,
  UNIQUE KEY `uq_project_type` (`project_id`, `ordinal`),
  CONSTRAINT `fk_project_type` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- was problem1..3 / result1..3 — a paired family, so one table with two columns
CREATE TABLE `project_problem` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `project_id` INT UNSIGNED NOT NULL,
  `ordinal`    SMALLINT UNSIGNED NOT NULL,
  `problem`    TEXT NOT NULL,
  `resolution` TEXT NULL,
  UNIQUE KEY `uq_project_problem` (`project_id`, `ordinal`),
  CONSTRAINT `fk_project_problem` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- was p_timestep's 15 numbered rows. Real dates only — the Gantt's startM/endM
-- month indices are derived at render time (Q19).
CREATE TABLE `project_activity` (
  `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `project_id`  INT UNSIGNED NOT NULL,
  `ordinal`     SMALLINT UNSIGNED NOT NULL,
  `topic`       TEXT NOT NULL,
  `start_on`    DATE NOT NULL,
  `end_on`      DATE NOT NULL,
  `responsible` VARCHAR(255) NULL,
  UNIQUE KEY `uq_project_activity` (`project_id`, `ordinal`),
  CONSTRAINT `fk_project_activity` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
  CONSTRAINT `ck_activity_dates` CHECK (`end_on` >= `start_on`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `project_indicator` (
  `id`              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `project_id`      INT UNSIGNED NOT NULL,
  `ordinal`         SMALLINT UNSIGNED NOT NULL,
  `expected_result` TEXT NULL,
  `quality_target`  TEXT NULL,
  `volume_target`   TEXT NULL,
  `etc_follow`      TEXT NULL,   -- free-text "other"; a tag table cannot hold this
  UNIQUE KEY `uq_project_indicator` (`project_id`, `ordinal`),
  CONSTRAINT `fk_project_indicator` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- was p_person + p_finalperson (110 columns). Every grandTotal* is gone: totals
-- are SUM(headcount).
CREATE TABLE `project_attendance` (
  `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `project_id`    INT UNSIGNED NOT NULL,
  `variant`       ENUM('PLANNED','ACTUAL') NOT NULL,    -- กนศ.04 vs กนศ.06
  `attendee_type` ENUM('STUDENT','PROFESSOR','EXECUTIVE','EXPERT','OTHER') NOT NULL,
  `ordinal`       SMALLINT UNSIGNED NOT NULL,
  `label`         VARCHAR(255) NULL,
  `headcount`     INT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY `uq_project_attendance` (`project_id`, `variant`, `attendee_type`, `ordinal`),
  CONSTRAINT `fk_project_attendance` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- replaces 56 is_* boolean columns
CREATE TABLE `project_tag` (
  `project_id` INT UNSIGNED NOT NULL,
  `tag_id`     INT UNSIGNED NOT NULL,
  PRIMARY KEY (`project_id`, `tag_id`),
  KEY `ix_project_tag_tag` (`tag_id`),
  CONSTRAINT `fk_project_tag_project` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_project_tag_tag`     FOREIGN KEY (`tag_id`)     REFERENCES `tag`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `project_attachment` (
  `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `project_id`    INT UNSIGNED NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `storage_path`  VARCHAR(512) NOT NULL,   -- RELATIVE to UPLOAD_ROOT (Q21)
  `byte_size`     INT UNSIGNED NULL,
  `uploaded_by`   INT UNSIGNED NOT NULL,
  `uploaded_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `ix_project_attachment` (`project_id`),
  CONSTRAINT `fk_attachment_project` FOREIGN KEY (`project_id`)  REFERENCES `project`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_attachment_person`  FOREIGN KEY (`uploaded_by`) REFERENCES `person`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Q15: replaces status_project + logstatus_project + historyeditproject.
-- Append-only. project.phase_id is the current phase; this is how it got there.
-- from_phase_id makes the log self-validating: a chain that does not join up is
-- detectably corrupt.
CREATE TABLE `project_event` (
  `id`              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `project_id`      INT UNSIGNED NOT NULL,
  `event_type`      ENUM('CREATED','PHASE_CHANGED','EDITED','BUDGET_APPROVED',
                         'DISBURSED','ATTACHMENT_ADDED') NOT NULL,
  `from_phase_id`   INT UNSIGNED NULL,
  `to_phase_id`     INT UNSIGNED NULL,
  `edited_section`  VARCHAR(64) NULL,
  `actor_person_id` INT UNSIGNED NOT NULL,
  `detail`          JSON NULL,
  `occurred_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `ix_project_event` (`project_id`, `occurred_at`),
  CONSTRAINT `fk_event_project` FOREIGN KEY (`project_id`)      REFERENCES `project`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_event_actor`   FOREIGN KEY (`actor_person_id`) REFERENCES `person`(`id`),
  CONSTRAINT `fk_event_from`    FOREIGN KEY (`from_phase_id`)   REFERENCES `phase`(`id`),
  CONSTRAINT `fk_event_to`      FOREIGN KEY (`to_phase_id`)     REFERENCES `phase`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 5. Money  — all DECIMAL(12,2). Nothing summable is stored.
-- ---------------------------------------------------------------------------

-- NEW. Q20/Q25 layer (c). The old schema had no table for this at all.
CREATE TABLE `agency_allocation` (
  `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `club_id`       INT UNSIGNED NOT NULL,
  `campus_id`     INT UNSIGNED NOT NULL,
  `academic_year` SMALLINT UNSIGNED NOT NULL,
  `amount`        DECIMAL(12,2) NOT NULL,
  `created_by`    INT UNSIGNED NOT NULL,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_allocation` (`club_id`, `campus_id`, `academic_year`),   -- Q31 grain
  CONSTRAINT `fk_allocation_club`   FOREIGN KEY (`club_id`)    REFERENCES `club`(`id`),
  CONSTRAINT `fk_allocation_campus` FOREIGN KEY (`campus_id`)  REFERENCES `campus`(`id`),
  CONSTRAINT `fk_allocation_person` FOREIGN KEY (`created_by`) REFERENCES `person`(`id`),
  CONSTRAINT `ck_allocation_positive` CHECK (`amount` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- was netprojectbudget. Q27: a real FK replaces the project_name string join,
-- and one plan line ↔ one project is now enforced.
CREATE TABLE `budget_plan_line` (
  `id`              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `project_id`      INT UNSIGNED NOT NULL,
  `planned_amount`  DECIMAL(12,2) NOT NULL,   -- was net_budget
  `approved_amount` DECIMAL(12,2) NULL,       -- was allow_budget; NULL until approval
  `approved_by`     INT UNSIGNED NULL,
  `approved_at`     DATETIME NULL,
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_plan_line_project` (`project_id`),
  CONSTRAINT `fk_plan_line_project` FOREIGN KEY (`project_id`)  REFERENCES `project`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_plan_line_person`  FOREIGN KEY (`approved_by`) REFERENCES `person`(`id`),
  CONSTRAINT `ck_plan_amounts` CHECK (
    `planned_amount` >= 0 AND (`approved_amount` IS NULL OR `approved_amount` >= 0)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- was p_budget (382 cols) + p_finalbudget. `amount` is GENERATED, so the line
-- total is stored — hence summable and indexable — but cannot drift.
-- COALESCE(qty,1) encodes the per-category shape: A is people x hours x rate,
-- BNT and C are qty x price.
CREATE TABLE `budget_line` (
  `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `project_id`  INT UNSIGNED NOT NULL,
  `variant`     ENUM('PLANNED','ACTUAL') NOT NULL,
  `category`    ENUM('A','BT','BNT','C','ETC') NOT NULL,
  `ordinal`     SMALLINT UNSIGNED NOT NULL,
  `description` VARCHAR(512) NOT NULL,
  `qty1`        DECIMAL(10,2) NULL,
  `unit1`       VARCHAR(64)   NULL,
  `qty2`        DECIMAL(10,2) NULL,
  `unit2`       VARCHAR(64)   NULL,
  `unit_price`  DECIMAL(12,2) NOT NULL,
  `amount`      DECIMAL(12,2) AS (COALESCE(`qty1`,1) * COALESCE(`qty2`,1) * `unit_price`) STORED,
  UNIQUE KEY `uq_budget_line` (`project_id`, `variant`, `category`, `ordinal`),
  KEY `ix_budget_line_project` (`project_id`, `variant`),
  CONSTRAINT `fk_budget_line_project` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
  CONSTRAINT `ck_budget_line_positive` CHECK (`unit_price` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- was logstudentgetmoney. Append-only. remainingBudget is NOT a column here —
-- "remaining" is a subtraction over committed rows (Q28).
CREATE TABLE `disbursement` (
  `id`               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `project_id`       INT UNSIGNED NOT NULL,
  `amount`           DECIMAL(12,2) NOT NULL,
  `received_by_name` VARCHAR(255) NOT NULL,
  `issued_by_name`   VARCHAR(255) NOT NULL,
  `disbursed_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `ix_disbursement_project` (`project_id`, `disbursed_at`),
  CONSTRAINT `fk_disbursement_project` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`),
  CONSTRAINT `ck_disbursement_positive` CHECK (`amount` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 6. Derived view — the budget enforcement reads from here
-- ---------------------------------------------------------------------------

CREATE VIEW `project_budget_status` AS
SELECT
  p.`id`                AS `project_id`,
  p.`club_id`           AS `club_id`,
  p.`academic_year`     AS `academic_year`,
  pl.`planned_amount`   AS `planned_amount`,
  pl.`approved_amount`  AS `approved_amount`,
  COALESCE((SELECT SUM(b.`amount`) FROM `budget_line` b
             WHERE b.`project_id` = p.`id` AND b.`variant` = 'PLANNED'), 0) AS `requested_total`,
  COALESCE((SELECT SUM(b.`amount`) FROM `budget_line` b
             WHERE b.`project_id` = p.`id` AND b.`variant` = 'ACTUAL'), 0)  AS `actual_total`,
  COALESCE((SELECT SUM(d.`amount`) FROM `disbursement` d
             WHERE d.`project_id` = p.`id`), 0)                             AS `disbursed_total`,
  pl.`approved_amount`
    - COALESCE((SELECT SUM(d.`amount`) FROM `disbursement` d
                 WHERE d.`project_id` = p.`id`), 0)                         AS `remaining`,
  pl.`approved_amount`
    - COALESCE((SELECT SUM(b.`amount`) FROM `budget_line` b
                 WHERE b.`project_id` = p.`id` AND b.`variant` = 'ACTUAL'), 0) AS `refund_total`
FROM `project` p
LEFT JOIN `budget_plan_line` pl ON pl.`project_id` = p.`id`;
