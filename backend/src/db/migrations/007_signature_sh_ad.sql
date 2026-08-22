-- ---------------------------------------------------------------------------
-- 007. Extend e-signature to SH and AD, so กนศ.04's own signature blocks can
-- be filled from real signatures instead of staying blank dotted lines.
--
-- Reading the rendered form (`npm run forms:read`) after migration 006 showed
-- the mismatch: กนศ.04's own three signature lines are ประธานชมรม (SH, the
-- project owner), อาจารย์ที่ปรึกษา (AD, the advisor) and a ที่ปรึกษาฝ่าย...
-- สำหรับกองกิจการนักศึกษา slot that carries no data at all — none of them is
-- ADMIN or STUACT, which is who migration 006 captured a signature from. The
-- owner confirmed extending capture to SH and AD, and reusing whichever
-- ADMIN/STUACT signature already exists for the third slot rather than
-- inventing a fourth signing action.
--
-- Two additions:
--
-- 1. `DRAFT_PROPOSAL -> PROPOSAL_SUBMITTED` now requires a signature. It is
--    SH-only already (no other role can take it), so this is unambiguous in
--    the way `PROPOSAL_SUBMITTED -> PROJECT_APPROVED` was not (that one stays
--    unsigned — AD can also take it, migration 006's own reasoning).
-- 2. `signer_role` widens to include `SH` and `AD`. `AD`'s signature is not
--    tied to any phase transition — the advisor does not own one — so a new
--    event type, `ADVISOR_ENDORSED`, gives it something to hang off, the same
--    shape every other signature already uses (`project_signature.
--    project_event_id`, unique). It is a one-time, decoupled endorsement:
--    `signatureService.endorseAsAdvisor` writes it directly, not through
--    `performTransition`, and application code — not this schema — is what
--    stops it from being written twice.
-- ---------------------------------------------------------------------------

UPDATE `phase_transition` pt
  JOIN `phase` pf  ON pf.id  = pt.from_phase_id
  JOIN `phase` pt2 ON pt2.id = pt.to_phase_id
  SET pt.requires_signature = 1
  WHERE pf.code = 'DRAFT_PROPOSAL' AND pt2.code = 'PROPOSAL_SUBMITTED' AND pt.allowed_role = 'SH';

ALTER TABLE `project_signature`
  MODIFY COLUMN `signer_role` ENUM('SH','AD','STUACT','ADMIN') NOT NULL;

ALTER TABLE `project_event`
  MODIFY COLUMN `event_type` ENUM('CREATED','PHASE_CHANGED','EDITED','BUDGET_APPROVED',
                                  'DISBURSED','ATTACHMENT_ADDED','ATTACHMENT_REMOVED',
                                  'ADVISOR_ENDORSED') NOT NULL;
