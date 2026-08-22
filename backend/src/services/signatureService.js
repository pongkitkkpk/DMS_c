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
 * The pad itself draws a 380x160 canvas (`SignaturePad.js`); this is headroom
 * for a HiDPI export, not a real limit on what one produces. It exists to
 * bound what the *dimensions themselves* can claim, independent of the
 * MAX_BYTES check above — a PNG's declared width/height can be enormous while
 * the file that declares them stays tiny (a single flat colour compresses to
 * almost nothing), so a byte-size cap alone does not stop one. Whatever reads
 * `IHDR` and decodes the image — a browser rendering `SignaturesCard.js`'s
 * `<img>`, or any future tool this file's bytes reach — would be handed
 * however many pixels are declared here, which is the "decompression bomb"
 * shape of attack against an image pipeline.
 */
const MAX_DIMENSION = 4000;

/**
 * Walk a PNG's chunk stream (length, type, data, CRC — repeated) starting
 * right after the 8-byte signature already verified by the caller. Returns
 * every chunk found and the byte offset immediately after the last one
 * walked, which is `IEND`'s end if the file is well-formed.
 *
 * Every offset is checked against `buffer.length` before it is read, so a
 * chunk whose declared length runs past the end of the buffer is refused here
 * rather than read out of bounds — `Buffer` would not overrun memory either
 * way, but a length that lies is exactly the kind of value this function
 * exists to stop from being trusted further down.
 */
function readChunks(buffer) {
  const chunks = [];
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;   // + CRC
    if (chunkEnd > buffer.length) {
      throw HttpError.badRequest('ลายเซ็น: โครงสร้างไฟล์ PNG ไม่สมบูรณ์');
    }
    chunks.push({ type, dataStart, dataEnd });
    offset = chunkEnd;
    if (type === 'IEND') break;
  }
  return { chunks, consumed: offset };
}

/**
 * Confirm the bytes are a real, single, self-contained PNG — not merely
 * something that starts with the right eight bytes.
 *
 * Three things the magic-byte check alone does not catch, each closed here:
 *
 * 1. **A declared size with no matching data.** The first chunk must be
 *    `IHDR`, exactly 13 bytes, and its width/height must fit within
 *    `MAX_DIMENSION` — see that constant for why a byte-size cap does not
 *    already cover this.
 * 2. **No terminator, or data after one.** The last chunk walked must be
 *    `IEND`, and nothing may follow it. A client could otherwise append
 *    arbitrary bytes after a valid, small PNG and stay under `MAX_BYTES` —
 *    this file would still open as a PNG in anything that stops at `IEND`
 *    (every real decoder does) while also being a container for whatever was
 *    appended, which is the shape of a polyglot file. `nosniff` on the
 *    download route already stops a browser from executing that tail as
 *    something else; refusing it here means the stored bytes are never
 *    anything but a PNG in the first place.
 * 3. **Nothing to check at all** — an empty or truncated chunk stream, which
 *    `readChunks` already refuses by construction.
 */
function assertWellFormedPng(buffer) {
  const { chunks, consumed } = readChunks(buffer);

  const ihdr = chunks[0];
  if (!ihdr || ihdr.type !== 'IHDR' || ihdr.dataEnd - ihdr.dataStart !== 13) {
    throw HttpError.badRequest('ลายเซ็น: ไม่พบส่วนหัว IHDR ของ PNG ที่ถูกต้อง');
  }
  const width = buffer.readUInt32BE(ihdr.dataStart);
  const height = buffer.readUInt32BE(ihdr.dataStart + 4);
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw HttpError.badRequest(`ลายเซ็น: ขนาดภาพต้องไม่เกิน ${MAX_DIMENSION}x${MAX_DIMENSION} พิกเซล`);
  }

  const last = chunks[chunks.length - 1];
  if (!last || last.type !== 'IEND') {
    throw HttpError.badRequest('ลายเซ็น: ไม่พบส่วนท้าย IEND ของ PNG');
  }
  if (consumed !== buffer.length) {
    throw HttpError.badRequest('ลายเซ็น: มีข้อมูลเกินต่อท้ายไฟล์ PNG');
  }
}

/**
 * Decode a `data:image/png;base64,...` string into real, well-formed PNG
 * bytes.
 *
 * What this makes safe to do later (`routes/projects.js`) is serve the file
 * back inline: unlike an uploaded attachment, whose content-type is a claim
 * from the client and is never trusted for inline rendering (deviation 40),
 * this file's bytes are verified here — magic number, structure, and declared
 * dimensions — before anything is written to disk. There is no path by which
 * arbitrary or malformed client content reaches this store.
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
  assertWellFormedPng(buffer);
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
