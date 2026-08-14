/**
 * Project attachments — files on local disk, reachable only through an
 * authorization check (Q21, deviation 8).
 *
 * The old system served its uploads as a static directory. That is the whole
 * defect: anything under it was fetchable by URL with no token, no scope check
 * and no way to tell who had read what, so a guessable filename was a
 * cross-club leak in the same family as the one deviation 1 closes. Here there
 * is **no static mount at all** — bytes only ever leave through a route that has
 * already resolved the project and narrowed it by the caller's membership.
 *
 * Four rules hold in this file, and each one is a way the old arrangement went
 * wrong:
 *
 * 1. **The client's filename is never a path.** It is stored as a label and
 *    replaced on disk by a generated name. A name like `../../.env` is then
 *    inert rather than clever.
 * 2. **Stored paths are relative, and resolved under one root.** A row that
 *    somehow points outside `config.uploadRoot` is refused at read time rather
 *    than trusted because it is in the database.
 * 3. **Nothing is served inline.** Every download is an attachment with
 *    `application/octet-stream`, so an uploaded `.html` or `.svg` cannot run as
 *    script in the app's own origin.
 * 4. **The row is written after the bytes, and removed if the row fails.** A
 *    half-succeeded upload leaves neither a file nobody knows about nor a row
 *    pointing at nothing.
 */
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const { config } = require('../config');
const { pool, transaction } = require('../db/pool');
const { HttpError } = require('../lib/httpError');
const { check } = require('../lib/validate');
const { recordEvent } = require('./projectService');

/**
 * What may be uploaded.
 *
 * An allow-list rather than a deny-list: the set of things a government project
 * file legitimately holds is small and knowable, and every deny-list of
 * dangerous extensions has been shorter than the set of dangerous extensions.
 */
const ALLOWED_EXTENSIONS = new Map([
  ['.pdf', 'application/pdf'],
  ['.doc', 'application/msword'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.ppt', 'application/vnd.ms-powerpoint'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.txt', 'text/plain'],
  ['.csv', 'text/csv'],
  ['.zip', 'application/zip'],
]);

const MAX_PER_PROJECT = 50;

/**
 * Undo multer's latin1 reading of the multipart filename.
 *
 * RFC 7578 leaves the encoding of `filename=` unstated and browsers send raw
 * UTF-8 bytes; busboy reads the header as latin1, so `เอกสารแนบ.pdf` arrives as
 * `à¹à¸­à¸à¸ªà¸²à¸£à¹à¸à¸.pdf`. In a system whose users name files in Thai,
 * that is not cosmetic — it is every attachment's name, on screen and in the
 * download, wrong.
 *
 * The repair is a reinterpretation, not a guess, and it is guarded: pure ASCII
 * is returned untouched, and bytes that are not valid UTF-8 are left as they
 * arrived rather than mangled a second time in the other direction.
 */
function repairMultipartFilename(name) {
  const raw = Buffer.from(String(name), 'latin1');
  if (raw.every((byte) => byte < 0x80)) return String(name);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    return String(name);
  }
}

/** The extension, lowercased, from a name that is not to be trusted otherwise. */
function extensionOf(originalName) {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw HttpError.badRequest(
      `ไม่รองรับไฟล์ชนิดนี้ (${ext || 'ไม่มีนามสกุล'}) — รองรับ ${[...ALLOWED_EXTENSIONS.keys()].join(' ')}`
    );
  }
  return ext;
}

/**
 * Where a project's files live, relative to the upload root.
 *
 * Sharded by project id so one directory does not accumulate every file in the
 * system, and so deleting a project's files is a directory operation rather
 * than a scan.
 */
const relativeDirFor = (projectId) => path.join('projects', String(projectId));

/**
 * Resolve a stored relative path under the upload root, refusing anything that
 * escapes it.
 *
 * `path.resolve` collapses `..` before this compares, so the check is on the
 * real destination rather than on the string. The separator on the end of the
 * root matters: without it `/uploads-evil` passes a `startsWith('/uploads')`.
 */
function resolveWithin(relativePath) {
  const root = config.uploadRoot;
  const full = path.resolve(root, relativePath);
  if (full !== root && !full.startsWith(root + path.sep)) {
    // Not a client error — a row in the database points somewhere it should not,
    // which is a fault in this system, not in the request.
    throw new Error(`attachment path escapes the upload root: ${relativePath}`);
  }
  return full;
}

async function list(projectId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT a.id, a.original_name, a.byte_size, a.uploaded_at,
            p.full_name_th AS uploaded_by_name
       FROM project_attachment a
       JOIN person p ON p.id = a.uploaded_by
      WHERE a.project_id = ?
      ORDER BY a.uploaded_at DESC, a.id DESC`,
    [projectId]
  );
  return rows.map((row) => ({
    id: row.id,
    originalName: row.original_name,
    byteSize: row.byte_size,
    uploadedAt: row.uploaded_at,
    uploadedByName: row.uploaded_by_name,
  }));
}

/**
 * Store one uploaded file.
 *
 * The bytes arrive in memory rather than through multer's disk storage, because
 * disk storage has to choose a destination *before* the request is validated —
 * so a rejected upload would already have written a file that something else
 * has to remember to clean up. Ten megabytes in memory is the price of not
 * having that path exist.
 */
async function add(actor, project, file) {
  if (!file) throw HttpError.badRequest('ไม่พบไฟล์ที่อัปโหลด');

  // The label the user sees. Repaired for encoding, then stripped of anything
  // that could read as a path — a browser already sends only the basename, but
  // this does not depend on that: nothing upstream of here is trusted.
  const originalName = check.text({ max: 255, required: true })(
    path.basename(repairMultipartFilename(file.originalname).replace(/\\/g, '/')),
    'ไฟล์'
  );
  const extension = extensionOf(originalName);

  const [[{ count }]] = await pool.query(
    'SELECT COUNT(*) AS count FROM project_attachment WHERE project_id = ?',
    [project.id]
  );
  if (count >= MAX_PER_PROJECT) {
    throw HttpError.badRequest(`แนบไฟล์ได้ไม่เกิน ${MAX_PER_PROJECT} ไฟล์ต่อโครงการ`);
  }

  // The name on disk is ours and carries nothing from the client but the
  // extension — which is itself from the allow-list, not from the string.
  const relativeDir = relativeDirFor(project.id);
  const storedName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${extension}`;
  const relativePath = path.join(relativeDir, storedName);
  const fullPath = resolveWithin(relativePath);

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, file.buffer, { flag: 'wx' });   // never overwrite

  try {
    return await transaction(async (conn) => {
      const [result] = await conn.query(
        `INSERT INTO project_attachment
           (project_id, original_name, storage_path, byte_size, uploaded_by)
         VALUES (?, ?, ?, ?, ?)`,
        // Stored with forward slashes so a row written on Windows still
        // resolves on a POSIX host — `path.resolve` accepts either.
        [project.id, originalName, relativePath.split(path.sep).join('/'), file.size, actor.person.id]
      );

      await recordEvent(conn, {
        projectId: project.id,
        type: 'ATTACHMENT_ADDED',
        actorPersonId: actor.person.id,
        detail: { originalName, byteSize: file.size },
      });

      return { id: result.insertId, originalName, byteSize: file.size };
    });
  } catch (err) {
    // The row is what makes the file findable. Without it the bytes are litter,
    // so they go with it.
    await fs.unlink(fullPath).catch(() => {});
    throw err;
  }
}

/** One attachment's row, scoped to its project so an id alone reaches nothing. */
async function find(projectId, attachmentId, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, project_id, original_name, storage_path, byte_size
       FROM project_attachment WHERE id = ? AND project_id = ?`,
    [attachmentId, projectId]
  );
  return row || null;
}

/**
 * The bytes, for a caller the route has already authorized.
 *
 * A row whose file is missing answers 404 rather than 500: the row is the
 * system's record and the file is what it points at, and a backup restored
 * without its uploads is a foreseeable state, not a crash.
 */
async function read(row) {
  const fullPath = resolveWithin(row.storage_path);
  try {
    return await fs.readFile(fullPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw HttpError.notFound('ไฟล์แนบนี้ไม่อยู่ในระบบแล้ว');
    }
    throw err;
  }
}

/** Remove the row, then the file. The row is the record; losing it is what matters. */
async function remove(actor, project, row) {
  await pool.query('DELETE FROM project_attachment WHERE id = ? AND project_id = ?',
    [row.id, project.id]);
  await fs.unlink(resolveWithin(row.storage_path)).catch(() => {});
}

module.exports = {
  ALLOWED_EXTENSIONS,
  MAX_PER_PROJECT,
  add,
  find,
  list,
  repairMultipartFilename,
  read,
  remove,
  resolveWithin,
};
