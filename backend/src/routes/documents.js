/**
 * Document downloads.
 *
 * The old routes had neither authorization nor a phase check
 * (`docs/business-rules.md` → "Document generation"): `GET /gennerateDoc/:id`
 * sat in the unauthenticated inline group, took the project id from the URL,
 * and would render any project for anybody who could guess a number. Both gaps
 * close here — the router is authenticated as a whole, and `loadProject`
 * narrows the id by the caller's membership before any handler runs, so an
 * out-of-scope project is a 404 rather than a document.
 *
 * **The phase rule is an assumption, not a port.** The old system had none, so
 * something had to be chosen; it is recorded in `docs/DECISIONS.md` →
 * "Phase 4 close-out" and is the one part of this phase awaiting confirmation.
 */
const express = require('express');

const { asyncRoute } = require('../lib/asyncRoute');
const { HttpError } = require('../lib/httpError');
const { loadProject } = require('../middleware/loadProject');
const { requireAuth } = require('../middleware/requireAuth');
const { loadDocument } = require('../documents/assembler');
const { overCapacity } = require('../documents/arity');
const { render, FORMS } = require('../documents/render');

const router = express.Router();

router.use(requireAuth);

/**
 * From which phase each form may be produced.
 *
 * กนศ.04 is the approval request, so it exists once the project has been put
 * forward — before that the numbers are still being drafted and a document that
 * looks official should not be circulating. กนศ.06 reports what actually
 * happened, and there are no actuals to report until the report is being
 * drafted; produced earlier it would be a form full of zeroes that reads as a
 * project that spent nothing.
 */
const AVAILABLE_FROM = {
  temp04: { ordinal: 2, phase: 'ดำเนินการขออนุมัติ' },
  temp06: { ordinal: 5, phase: 'ร่างสรุปผลโครงการ' },
};

function unavailableReason(form, project) {
  const gate = AVAILABLE_FROM[form];
  if (project.phase_ordinal < gate.ordinal) {
    return `${FORMS[form].code} ออกได้ตั้งแต่สถานะ "${gate.phase}" เป็นต้นไป (สถานะปัจจุบัน: ${project.phase_name_th})`;
  }
  return null;
}

/**
 * What this project can produce, and why not where it cannot.
 *
 * Both reasons a form may be unavailable are reported together — too early, and
 * too big for the form to hold. The second is the interesting one: a project
 * with thirteen ค่าใช้สอย lines is perfectly valid and simply cannot be printed
 * on กนศ.04, and the person who has to fix that would rather find out here than
 * from a failed download.
 */
router.get('/projects/:id/documents', loadProject, asyncRoute(async (req, res) => {
  const document = await loadDocument(req.project.id);

  res.json({
    documents: Object.keys(FORMS).map((form) => {
      const tooEarly = unavailableReason(form, req.project);
      const violations = tooEarly ? [] : overCapacity(form, document);
      return {
        form,
        code: FORMS[form].code,
        title: FORMS[form].title,
        available: !tooEarly && violations.length === 0,
        reason: tooEarly || (violations.length ? violations[0].message : null),
        violations,
      };
    }),
  });
}));

router.get('/projects/:id/documents/:form', loadProject, asyncRoute(async (req, res) => {
  const { form } = req.params;
  if (!FORMS[form]) {
    throw HttpError.notFound(`ไม่รู้จักแบบฟอร์ม ${form} (มี: ${Object.keys(FORMS).join(', ')})`);
  }

  const tooEarly = unavailableReason(form, req.project);
  if (tooEarly) throw HttpError.badRequest(tooEarly);

  const document = await loadDocument(req.project.id);
  if (!document) throw HttpError.notFound('ไม่พบโครงการ');

  // Throws 422 with every violation if the project is over what the form holds
  // — never truncates (Q8).
  const { buffer, filename } = render(form, document);

  res.setHeader('Content-Type',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  // RFC 5987: the filename is Thai, and a bare `filename=` is Latin-1 only, so
  // a browser would save it mojibaked or fall back to "download".
  res.setHeader('Content-Disposition',
    `attachment; filename="${form}.docx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
}));

module.exports = router;
