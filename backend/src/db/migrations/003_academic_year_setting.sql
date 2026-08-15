-- ---------------------------------------------------------------------------
-- 003. Which academic year the system is in.
--
-- It lived in `ACADEMIC_YEAR` in `.env`, which made the most consequential
-- value in the system a line in a file that needs shell access and a restart to
-- change — and, worse, gave it no guard. `ACADEMIC_YEAR` is what
-- `requireAuth` resolves every membership against, so moving it to a year
-- nobody was prepared for leaves every account at `role: null`, the Admin
-- included, and granting a role requires an Admin. Proven against a running
-- server on 2026-08-15; see DMS_REBUILD_STRATEGY.md, "The lockout".
--
-- Here it is a row an Admin changes through a screen, which lets the change be
-- *refused*: the service will not move into a year with no ADMIN membership, so
-- the lockout stops being a documented hazard and becomes impossible.
--
-- Deliberately not a generic key/value settings table. There is one setting,
-- it has a type and a range, and a `VARCHAR` store for "anything" attracts
-- values nobody validates. If a second setting ever appears, it gets its own
-- columns here or its own table.
--
-- Only the current value is kept, with who set it and when — the question
-- people ask is "who rolled us into 2568", not the whole history. What the year
-- was prepared *with* is already in `membership_event` and `agency_allocation`.
-- ---------------------------------------------------------------------------

CREATE TABLE `academic_year_setting` (
  -- One row, structurally: the primary key and the CHECK together mean a second
  -- row cannot be inserted, so nothing has to remember to use `LIMIT 1`.
  `id`            TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  `academic_year` SMALLINT UNSIGNED NOT NULL,
  `changed_by`    INT UNSIGNED NULL,          -- NULL for the seeded initial value
  `changed_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                    ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `ck_academic_year_single_row` CHECK (`id` = 1),
  CONSTRAINT `ck_academic_year_range`      CHECK (`academic_year` BETWEEN 2400 AND 2700),
  CONSTRAINT `fk_academic_year_person` FOREIGN KEY (`changed_by`) REFERENCES `person`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
