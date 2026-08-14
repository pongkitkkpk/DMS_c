/**
 * Attachment routes (Q21, deviation 8).
 *
 * There is deliberately **no `express.static`** anywhere in this application.
 * The old system mounted its upload directory as static files, which meant a
 * guessable filename returned somebody else's document with no token, no scope
 * check and no record. Every byte here leaves through a handler that has already
 * run `loadProject` — which resolves the project and narrows it by the caller's
 * membership, answering 404 rather than 403 so a refusal cannot confirm that a
 * project exists in a club the caller may not see.
 *
 * Reading follows visibility; writing and deleting follow `assertCanEdit`, the
 * same rule as any other part of a project.
 */
const express = require('express');
const multer = require('multer');

const { config } = require('../config');
const { asyncRoute } = require('../lib/asyncRoute');
const { HttpError } = require('../lib/httpError');
const { check } = require('../lib/validate');
const { loadProject } = require('../middleware/loadProject');
const { requireAuth } = require('../middleware/requireAuth');
const scope = require('../services/scope');
const attachments = require('../services/attachmentService');

const router = express.Router();

router.use(requireAuth);

/**
 * In memory, one file, hard-capped.
 *
 * Memory rather than disk so a request that fails validation has not already
 * written a file somewhere — see `attachmentService.add`. The cap is enforced
 * by multer *while reading the socket*, so an oversized upload is cut off
 * rather than buffered in full and then rejected.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploadMaxBytes, files: 1, fields: 4 },
});

/** multer's own errors are not HttpErrors, and its default message is English. */
const receiveOne = (req, res, next) => upload.single('file')(req, res, (err) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') {
    const mb = Math.round(config.uploadMaxBytes / (1024 * 1024));
    return next(HttpError.badRequest(`ไฟล์ใหญ่เกินไป — จำกัดที่ ${mb} MB`));
  }
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
    return next(HttpError.badRequest('อัปโหลดได้ครั้งละหนึ่งไฟล์'));
  }
  return next(err);
});

/** Load the attachment named in the path, scoped to the project already loaded. */
const loadAttachment = asyncRoute(async (req, res, next) => {
  const id = check.integer({ min: 1, required: true })(req.params.attachmentId, 'attachmentId');
  const row = await attachments.find(req.project.id, id);
  // Scoped by project, so an id from another project is simply not found —
  // there is no path here that takes an attachment id on its own.
  if (!row) throw HttpError.notFound('ไม่พบไฟล์แนบ');
  req.attachment = row;
  next();
});

router.get('/projects/:id/attachments', loadProject, asyncRoute(async (req, res) => {
  res.json({
    attachments: await attachments.list(req.project.id),
    canEdit: scope.permits(() => scope.assertCanEdit(req.actor, req.project)),
    maxBytes: config.uploadMaxBytes,
    allowedExtensions: [...attachments.ALLOWED_EXTENSIONS.keys()],
  });
}));

router.post('/projects/:id/attachments', loadProject, receiveOne, asyncRoute(async (req, res) => {
  scope.assertCanEdit(req.actor, req.project);
  const saved = await attachments.add(req.actor, req.project, req.file);
  res.status(201).json(saved);
}));

/**
 * Download.
 *
 * `application/octet-stream` and `attachment` on everything, whatever was
 * uploaded. Serving an uploaded `.html` or `.svg` inline would run it as script
 * in this application's own origin, with the viewer's session — the classic way
 * a file store becomes a stored-XSS vector. The browser saves; nothing renders.
 */
router.get('/projects/:id/attachments/:attachmentId', loadProject, loadAttachment,
  asyncRoute(async (req, res) => {
    const buffer = await attachments.read(req.attachment);
    const name = req.attachment.original_name;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition',
      `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }));

router.delete('/projects/:id/attachments/:attachmentId', loadProject, loadAttachment,
  asyncRoute(async (req, res) => {
    scope.assertCanEdit(req.actor, req.project);
    await attachments.remove(req.actor, req.project, req.attachment);
    res.json({ deleted: req.attachment.id });
  }));

module.exports = router;
