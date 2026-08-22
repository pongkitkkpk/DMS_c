-- ---------------------------------------------------------------------------
-- 006. E-signature on an approval transition.
--
-- Open item since 2026-08-22 (docs/DECISIONS.md, "Open items" ->
-- "E-signature"): the owner wants approvals to carry a signature rather than
-- just a phase transition. Closed the same day. Not a cryptographic
-- signature — a canvas drawing exported to PNG, the same trust level the rest
-- of this phase machine already runs on (mock auth, an append-only event log
-- as the record of who did what). A PKI scheme would be overkill for a
-- university-internal approval flow that does not have real ICIT
-- authentication behind it yet (Q3).
--
-- `requires_signature` is a property of the *transition*, the same shape as
-- `requires_budget_check`: only the three transitions gated to ADMIN/STUACT
-- alone carry it. `PROPOSAL_SUBMITTED -> PROJECT_APPROVED` is also open to AD
-- (Q5, business-rules.md), so it is deliberately left out — a signature
-- captured only when an ADMIN or STUACT happens to be the one clicking the
-- same button AD also uses would be a rule nobody could explain by looking
-- at the screen. This mirrors phaseService's own enforcement: a transition's
-- allowed roles already decide who may act, so restricting *signing* to
-- ADMIN/STUACT falls out of restricting these three transitions to them,
-- rather than needing a second check anywhere.
-- ---------------------------------------------------------------------------

ALTER TABLE `phase_transition`
  ADD COLUMN `requires_signature` TINYINT(1) NOT NULL DEFAULT 0 AFTER `requires_budget_check`;

UPDATE `phase_transition` pt
  JOIN `phase` pf  ON pf.id  = pt.from_phase_id
  JOIN `phase` pt2 ON pt2.id = pt.to_phase_id
  SET pt.requires_signature = 1
  WHERE pt.allowed_role IN ('ADMIN', 'STUACT')
    AND (
      (pf.code = 'PROJECT_APPROVED' AND pt2.code = 'BUDGET_APPROVED') OR
      (pf.code = 'DRAFT_REPORT'     AND pt2.code = 'REPORT_SUBMITTED') OR
      (pf.code = 'REPORT_SUBMITTED' AND pt2.code = 'CLOSED')
    );

-- One signature per approval event: the event is the thing being signed for
-- (`project_event.event_type = 'PHASE_CHANGED'`), so a project accumulates one
-- signature per approval it passes through, never two for the same one.
-- `image_path` follows Q21 exactly — relative to UPLOAD_ROOT, reachable only
-- through an authorized route, never a static mount.
CREATE TABLE `project_signature` (
  `id`               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `project_id`       INT UNSIGNED NOT NULL,
  `project_event_id` BIGINT UNSIGNED NOT NULL,
  `signer_person_id` INT UNSIGNED NOT NULL,
  `signer_role`      ENUM('STUACT','ADMIN') NOT NULL,
  `image_path`       VARCHAR(512) NOT NULL,
  `ip_address`       VARCHAR(45)  NOT NULL,
  `signed_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_signature_event` (`project_event_id`),
  KEY `ix_signature_project` (`project_id`, `signed_at`),
  CONSTRAINT `fk_signature_project` FOREIGN KEY (`project_id`)       REFERENCES `project`(`id`)       ON DELETE CASCADE,
  CONSTRAINT `fk_signature_event`   FOREIGN KEY (`project_event_id`) REFERENCES `project_event`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_signature_person`  FOREIGN KEY (`signer_person_id`) REFERENCES `person`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
