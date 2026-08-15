-- ---------------------------------------------------------------------------
-- 002. The record of who was given authority, and who took it away.
--
-- `membership` says what is true now. Until roles could only be seeded that was
-- the whole story; now that they can be granted and revoked through the API,
-- "who may do what" changes over time and nothing recorded the changes.
--
-- Deliberately NOT a `revoked_at` column on `membership`. A soft-delete would
-- mean every read of `membership` needs `revoked_at IS NULL`, across the twenty
-- files that touch it, and one missed filter is a revoked person still holding
-- their role. Deleting the row cannot fail that way, and it costs nothing that
-- matters: every other table references `person`, never `membership`, so a
-- project's owner, an event's actor and an approval's approver all survive the
-- membership that authorised them.
--
-- The trade this makes instead: the log copies the membership rather than
-- referencing it, because by the time a REVOKE row is read the row it describes
-- is gone.
-- ---------------------------------------------------------------------------

CREATE TABLE `membership_event` (
  `id`             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `action`         ENUM('GRANT','REVOKE') NOT NULL,

  -- The membership as it stood, copied. `role` and the two scope columns
  -- mirror `membership` exactly, including the rule that only one of the two
  -- scopes is ever populated — though no CHECK is repeated here, because this
  -- table records what happened and must never refuse a record of it.
  `person_id`                  INT UNSIGNED NOT NULL,
  `role`                       ENUM('SH','AD','STUACT','ADMIN') NOT NULL,
  `academic_year`              SMALLINT UNSIGNED NOT NULL,
  `club_id`                    INT UNSIGNED NULL,
  `jurisdiction_club_group_id` INT UNSIGNED NULL,

  `actor_person_id` INT UNSIGNED NOT NULL,
  `occurred_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY `ix_membership_event_subject` (`person_id`, `academic_year`, `occurred_at`),
  KEY `ix_membership_event_actor`   (`actor_person_id`, `occurred_at`),

  -- No `ON DELETE CASCADE` anywhere on this table, unlike `membership` itself.
  -- Removing a person should not quietly erase the record of the authority they
  -- were once given, or of the authority they handed out.
  CONSTRAINT `fk_membership_event_person` FOREIGN KEY (`person_id`)
      REFERENCES `person`(`id`),
  CONSTRAINT `fk_membership_event_actor`  FOREIGN KEY (`actor_person_id`)
      REFERENCES `person`(`id`),
  CONSTRAINT `fk_membership_event_club`   FOREIGN KEY (`club_id`)
      REFERENCES `club`(`id`),
  CONSTRAINT `fk_membership_event_group`  FOREIGN KEY (`jurisdiction_club_group_id`)
      REFERENCES `club_group`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
