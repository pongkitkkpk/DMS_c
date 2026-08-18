-- ---------------------------------------------------------------------------
-- 005. The one mutation the record did not keep: an attachment being deleted.
--
-- `project_event` is append-only and every other change to a project writes to
-- it — created, edited, phase changed, budget approved, disbursed, file
-- attached. Deleting an attachment wrote nothing. The row went, the file went,
-- and the timeline still said "แนบไฟล์" three times for a project that now had
-- two files, with nothing to say which one had gone, when, or who took it.
--
-- That is the wrong way round. Of everything a person can do to a project, the
-- one that removes evidence is the one whose own record matters most: a minute
-- of an approving meeting, or a quotation a disbursement was based on, can be
-- attached and then taken away again and the project would read as though it
-- had never been there.
--
-- The event carries the file's name and size in `detail`, because after the
-- deletion the row that held them is gone and the event is the only place the
-- name still exists.
-- ---------------------------------------------------------------------------

ALTER TABLE `project_event`
  MODIFY COLUMN `event_type` ENUM('CREATED','PHASE_CHANGED','EDITED','BUDGET_APPROVED',
                                  'DISBURSED','ATTACHMENT_ADDED','ATTACHMENT_REMOVED') NOT NULL;
