-- ---------------------------------------------------------------------------
-- 008. The student council must countersign before money is approved.
--
-- Not a port — checked against the old code and there is no such rule there
-- ("สภานักศึกษา" appears only as a sample club name in a Swagger example, with
-- no special approval step). This is a new requirement from the owner
-- (docs/TODO.md, 2026-08-27), recorded as a deliberate deviation in
-- docs/DECISIONS.md at the time this was implemented.
--
-- Three additions:
--
-- 1. `club.is_council` — which club, if any, *is* "the" student council on its
--    campus. Every campus's central club group carries two central bodies,
--    องค์การนักศึกษา and สภานักศึกษา, told apart only by name
--    (`fixtures.js` already matched this the same way before this flag
--    existed). Deriving it once at seed time and storing it as a typed column
--    is the same move `taxonomy.js` already makes for the D02/D03 student-union
--    prefix fix — a fact read out of a name is turned into structural data
--    instead of being re-derived by string match on every request, which is
--    exactly the anti-pattern `business-rules.md` documents the old system
--    running everywhere (`AgnecyGroupName`/`clubName` string equality).
-- 2. `signer_role` and `event_type` widen for a new, one-time, standalone
--    endorsement — `COUNCIL` / `COUNCIL_ENDORSED` — the same shape migration
--    007 gave the advisor's endorsement, because the council president does
--    not own a phase transition either: they endorse *any* club's project on
--    their own campus, not just their own club's.
-- ---------------------------------------------------------------------------

ALTER TABLE `club`
  ADD COLUMN `is_council` TINYINT(1) NOT NULL DEFAULT 0 AFTER `parent_agency_id`;

ALTER TABLE `project_signature`
  MODIFY COLUMN `signer_role` ENUM('SH','AD','STUACT','ADMIN','COUNCIL') NOT NULL;

ALTER TABLE `project_event`
  MODIFY COLUMN `event_type` ENUM('CREATED','PHASE_CHANGED','EDITED','BUDGET_APPROVED',
                                  'DISBURSED','ATTACHMENT_ADDED','ATTACHMENT_REMOVED',
                                  'ADVISOR_ENDORSED','COUNCIL_ENDORSED') NOT NULL;
