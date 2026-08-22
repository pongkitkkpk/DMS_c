/**
 * Signatures on an approval transition.
 *
 * Closes the "E-signature" open item in `docs/DECISIONS.md` (raised and
 * closed 2026-08-22). A signature is bound to the `project_event` row the
 * approving transition writes, not to the project in general — a project
 * passes through PROJECT_APPROVED, BUDGET_APPROVED and CLOSED on separate
 * occasions, each a distinct approval with its own signer, so
 * `project_signature.project_event_id` is unique. Which transitions demand
 * one lives on `phase_transition.requires_signature` (migration 006); only
 * ADMIN and STUACT ever sign, because those are the only two roles any
 * `requires_signature` transition is ever open to — `phaseService` already
 * refuses any other role before signature logic runs, so nothing here needs
 * to check the role again.
 *
 * Captured as a canvas drawing exported to PNG rather than a cryptographic
 * signature — a PKI scheme would be overkill for a university-internal
 * approval flow that does not have real ICIT authentication behind it yet
 * (Q3). The image is stored on disk the same way an attachment is (Q21): a
 * relative path under `UPLOAD_ROOT`, reachable only through an authorized
 * route, never served statically — `resolveWithin` is shared with
 * `attachmentService` rather than reimplemented, since the traversal guard is
 * identical for both.
 *
 * The bytes are written to disk *before* `phaseService.performTransition`
 * opens its transaction, and removed again if that transaction never
 * commits. `db/pool.js`'s `transaction()` documents its retry loop as "pure
 * database work... safe to re-run from the top" — a retried attempt calling
 * back into disk I/O would risk writing the image twice under two different
 * generated names, which is the same reason `attachmentService.add` writes
 * its file ahead of the row rather than inside the transaction that inserts
 * it.
 */
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const { pool } = require('../db/pool');
const { HttpError } = require('../lib/httpError');
const { resolveWithin } = require('./attachmentService');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DATA_URL_PREFIX = 'data:image/png;base64,';

/**
 * A drawn signature is a few KB; this is generous headroom against a client
 * sending something else entirely, not a real limit on what a signature pad
 * produces.
 */
const MAX_BYTES = 300 * 1024;

/**
 * Decode a `data:image/png;base64,...` string into real PNG bytes.
 *
 * The magic-byte check is what makes serving this back inline safe later
 * (`routes/projects.js`): unlike an uploaded attachment, whose content-type is
 * a claim from the client and is never trusted for inline rendering
 * (deviation 40), this file's bytes are verified here to actually be a PNG
 * before anything is written to disk — there is no path by which arbitrary
 * client content reaches this store.
 */
function decodeImage(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(DATA_URL_PREFIX)) {
    throw HttpError.badRequest('ลายเซ็น: ต้องเป็นรูปภาพ PNG ที่วาดจากระบบ');
  }
  const base64 = dataUrl.slice(DATA_URL_PREFIX.length);
  if (!base64) throw HttpError.badRequest('ลายเซ็น: ยังไม่ได้วาดลายเซ็น');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || !buffer.subarray(0, 8).equals(PNG_MAGIC)) {
    throw HttpError.badRequest('ลายเซ็น: ไฟล์ไม่ใช่ PNG ที่ถูกต้อง');
  }
  if (buffer.length > MAX_BYTES) {
    throw HttpError.badRequest(`ลายเซ็น: ไฟล์ใหญ่เกินไป (จำกัด ${Math.round(MAX_BYTES / 1024)} KB)`);
  }
  return buffer;
}

/** Whether `(fromPhaseId -> toPhaseCode)` for `role` demands a signature, read outside any transaction. */
async function isRequired(fromPhaseId, toPhaseCode, role, conn = pool) {
  const [rows] = await conn.query(
    `SELECT pt.requires_signature
       FROM phase_transition pt
       JOIN phase p ON p.id = pt.to_phase_id
      WHERE pt.from_phase_id = ? AND p.code = ? AND pt.allowed_role = ?`,
    [fromPhaseId, toPhaseCode, role]
  );
  return rows.length > 0 && Boolean(rows[0].requires_signature);
}

/**
 * Validate and write the image to disk, ahead of the transition's own
 * transaction. Throws `HttpError.badRequest` if `dataUrl` is missing or is
 * not a real PNG — a signature-required transition with no valid image never
 * reaches the database at all.
 */
async function stage(projectId, dataUrl) {
  const buffer = decodeImage(dataUrl);
  const relativeDir = path.join('signatures', String(projectId));
  const storedName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.png`;
  const relativePath = path.join(relativeDir, storedName).split(path.sep).join('/');
  const fullPath = resolveWithin(relativePath);

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, buffer, { flag: 'wx' });   // never overwrite

  return { relativePath, fullPath, byteSize: buffer.length };
}

/** Undo `stage()` — called when the transition it was staged for never committed. */
async function discard(staged) {
  if (!staged) return;
  await fs.unlink(staged.fullPath).catch(() => {});
}

/** The row, inside the same transaction as the phase change it documents. */
async function record(conn, { projectId, eventId, personId, role, relativePath, ip }) {
  await conn.query(
    `INSERT INTO project_signature
       (project_id, project_event_id, signer_person_id, signer_role, image_path, ip_address)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [projectId, eventId, personId, role, relativePath, ip]
  );
}

/** Every signature a project carries, newest first — for the "ลายเซ็นอนุมัติ" card. */
async function listForProject(projectId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT s.id, s.project_event_id, s.signer_role, s.signed_at, s.ip_address,
            p.full_name_th AS signer_name,
            e.to_phase_id, ph.name_th AS to_phase_name_th
       FROM project_signature s
       JOIN person p ON p.id = s.signer_person_id
       JOIN project_event e ON e.id = s.project_event_id
       LEFT JOIN phase ph ON ph.id = e.to_phase_id
      WHERE s.project_id = ?
      ORDER BY s.signed_at DESC, s.id DESC`,
    [projectId]
  );
  return rows.map((row) => ({
    id: row.id,
    eventId: row.project_event_id,
    signerName: row.signer_name,
    signerRole: row.signer_role,
    toPhaseNameTh: row.to_phase_name_th,
    signedAt: row.signed_at,
    ipAddress: row.ip_address,
  }));
}

/** One signature's row, scoped to its project so an id alone reaches nothing (same rule as `attachmentService.find`). */
async function find(projectId, signatureId, conn = pool) {
  const [[row]] = await conn.query(
    'SELECT id, project_id, image_path FROM project_signature WHERE id = ? AND project_id = ?',
    [signatureId, projectId]
  );
  return row || null;
}

/** The PNG bytes, for a caller the route has already authorized. */
async function readImage(row) {
  const fullPath = resolveWithin(row.image_path);
  try {
    return await fs.readFile(fullPath);
  } catch (err) {
    if (err.code === 'ENOENT') throw HttpError.notFound('ไม่พบรูปลายเซ็นนี้แล้ว');
    throw err;
  }
}

module.exports = { isRequired, stage, discard, record, listForProject, find, readImage };
