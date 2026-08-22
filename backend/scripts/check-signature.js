#!/usr/bin/env node
/**
 * E-signature acceptance run.
 *
 *   npm run db:reset          # the assertions below act on the seeded fixtures
 *   npm run dev               # in another terminal
 *   npm run check:signature
 *
 * Closes the "E-signature" open item in docs/DECISIONS.md (raised and closed
 * 2026-08-22): approving PROJECT_APPROVED -> BUDGET_APPROVED,
 * DRAFT_REPORT -> REPORT_SUBMITTED and REPORT_SUBMITTED -> CLOSED now
 * requires a signature image, and only ADMIN/STUACT can ever reach those
 * transitions in the first place. PROPOSAL_SUBMITTED -> PROJECT_APPROVED is
 * deliberately excluded (AD may also take it), and is checked here too, so a
 * future change that widens `requires_signature` to it would be caught.
 *
 * Black box against a live server, like the phase acceptance runs. It writes
 * to the development database and acts on the one-project-per-phase fixtures
 * (`db/seeds/fixtures.js`) — each of those fixture projects can only be
 * advanced once, so run it once per reseed.
 */
const B = 'http://localhost:3001';
let pass = 0, fail = 0;

function ok(label, condition, extra = '') {
  if (condition) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(B + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, body: json, text };
}

async function login(username) {
  const r = await call('POST', '/api/auth/login', { body: { username, password: 'dev' } });
  if (r.status !== 200) throw new Error(`login ${username} -> ${r.status} ${r.text}`);
  return r.body.token;
}

/** The smallest well-formed PNG there is — a 1x1 transparent pixel. */
const VALID_PNG = 'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/** Real bytes, but not a PNG — the magic-byte check should refuse this. */
const NOT_A_PNG = 'data:image/png;base64,' + Buffer.from('this is not an image').toString('base64');

const advance = (token, id, toPhaseCode, signatureImage) =>
  call('POST', `/api/projects/${id}/transitions`, { token, body: { toPhaseCode, signatureImage } });

(async () => {
  const sh = await login('fixture.student');
  const ad = await login('fixture.advisor');
  const stuact = await login('fixture.stuact');
  const admin = await login('fixture.admin');
  const otherSh = await login('fixture.otherstudent');

  // SH's own scope is exactly the one club the fixtures build one project per
  // phase for — no ambiguity with the out-of-scope club's single project.
  const mine = await call('GET', '/api/projects', { token: sh });
  const byPhase = (code) => mine.body.items.find((p) => p.phase.code === code);

  const proposalSubmitted = byPhase('PROPOSAL_SUBMITTED'); // ordinal 2
  const projectApproved   = byPhase('PROJECT_APPROVED');   // ordinal 3
  const draftReport       = byPhase('DRAFT_REPORT');       // ordinal 5
  const reportSubmitted   = byPhase('REPORT_SUBMITTED');   // ordinal 6

  // ------------------------------------------------------------------
  console.log('\n--- which transitions ask for a signature ---');

  const t2 = await call('GET', `/api/projects/${proposalSubmitted.id}/transitions`, { token: ad });
  const toApproved = t2.body.transitions.find((t) => t.toPhaseCode === 'PROJECT_APPROVED');
  ok('PROPOSAL_SUBMITTED -> PROJECT_APPROVED does not ask for a signature (AD may also take it)',
    toApproved && toApproved.requiresSignature === false, JSON.stringify(toApproved));

  const t3 = await call('GET', `/api/projects/${projectApproved.id}/transitions`, { token: stuact });
  const toBudgetApproved = t3.body.transitions.find((t) => t.toPhaseCode === 'BUDGET_APPROVED');
  ok('PROJECT_APPROVED -> BUDGET_APPROVED asks for a signature',
    toBudgetApproved && toBudgetApproved.requiresSignature === true, JSON.stringify(toBudgetApproved));

  const t5 = await call('GET', `/api/projects/${draftReport.id}/transitions`, { token: admin });
  const toReportSubmitted = t5.body.transitions.find((t) => t.toPhaseCode === 'REPORT_SUBMITTED');
  ok('DRAFT_REPORT -> REPORT_SUBMITTED asks for a signature',
    toReportSubmitted && toReportSubmitted.requiresSignature === true, JSON.stringify(toReportSubmitted));

  const t6 = await call('GET', `/api/projects/${reportSubmitted.id}/transitions`, { token: stuact });
  const toClosed = t6.body.transitions.find((t) => t.toPhaseCode === 'CLOSED');
  ok('REPORT_SUBMITTED -> CLOSED asks for a signature',
    toClosed && toClosed.requiresSignature === true, JSON.stringify(toClosed));

  // ------------------------------------------------------------------
  console.log('\n--- refused without a real signature ---');

  const missing = await advance(stuact, projectApproved.id, 'BUDGET_APPROVED', undefined);
  ok('missing signatureImage is refused, not silently skipped',
    missing.status === 400 && /เซ็น/.test(missing.body.error), missing.text.slice(0, 200));

  const bogus = await advance(stuact, projectApproved.id, 'BUDGET_APPROVED', NOT_A_PNG);
  ok('bytes that decode but are not a PNG are refused',
    bogus.status === 400 && /PNG/.test(bogus.body.error), bogus.text.slice(0, 200));

  const wrongRole = await advance(sh, projectApproved.id, 'BUDGET_APPROVED', VALID_PNG);
  ok('a role this transition is not open to is refused before signature logic runs (403, not 400)',
    wrongRole.status === 403, wrongRole.text.slice(0, 200));

  const stillNoSignature = await call('GET', `/api/projects/${projectApproved.id}/signatures`, { token: stuact });
  ok('none of the refused attempts left a signature row behind',
    stillNoSignature.status === 200 && stillNoSignature.body.signatures.length === 0,
    JSON.stringify(stillNoSignature.body));

  // ------------------------------------------------------------------
  console.log('\n--- a real signature advances the project and is recorded ---');

  const approved = await advance(stuact, projectApproved.id, 'BUDGET_APPROVED', VALID_PNG);
  ok('a valid signature lets the transition through', approved.status === 200, approved.text.slice(0, 300));
  ok('the response says the transition was signed', approved.body && approved.body.signed === true);

  const sigList = await call('GET', `/api/projects/${projectApproved.id}/signatures`, { token: stuact });
  ok('exactly one signature is now on record', sigList.body.signatures.length === 1, JSON.stringify(sigList.body));
  const sig = sigList.body.signatures[0];
  ok('recorded against the STUACT who signed it', sig.signerRole === 'STUACT', sig.signerRole);
  ok('carries a signer name for display', typeof sig.signerName === 'string' && sig.signerName.length > 0);

  const image = await fetch(`${B}/api/projects/${projectApproved.id}/signatures/${sig.id}`, {
    headers: { Authorization: 'Bearer ' + stuact },
  });
  const bytes = Buffer.from(await image.arrayBuffer());
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  ok('the stored image downloads as a real PNG',
    image.status === 200 &&
    image.headers.get('content-type') === 'image/png' &&
    bytes.subarray(0, 8).equals(PNG_MAGIC),
    `status=${image.status} content-type=${image.headers.get('content-type')}`);

  // ------------------------------------------------------------------
  console.log('\n--- a transition open to AD too never asks for one ---');

  const adAdvance = await advance(ad, proposalSubmitted.id, 'PROJECT_APPROVED', undefined);
  ok('AD advances PROPOSAL_SUBMITTED -> PROJECT_APPROVED with no signature at all',
    adAdvance.status === 200, adAdvance.text.slice(0, 300));

  const adSignatures = await call('GET', `/api/projects/${proposalSubmitted.id}/signatures`, { token: ad });
  ok('and no signature row was created for it', adSignatures.body.signatures.length === 0);

  // ------------------------------------------------------------------
  console.log('\n--- the other two signature-gated transitions ---');

  const reportAdvance = await advance(admin, draftReport.id, 'REPORT_SUBMITTED', VALID_PNG);
  ok('ADMIN signs DRAFT_REPORT -> REPORT_SUBMITTED', reportAdvance.status === 200, reportAdvance.text.slice(0, 300));
  const reportSig = await call('GET', `/api/projects/${draftReport.id}/signatures`, { token: admin });
  ok('recorded against ADMIN', reportSig.body.signatures[0] && reportSig.body.signatures[0].signerRole === 'ADMIN');

  const closeAdvance = await advance(stuact, reportSubmitted.id, 'CLOSED', VALID_PNG);
  ok('STUACT signs REPORT_SUBMITTED -> CLOSED', closeAdvance.status === 200, closeAdvance.text.slice(0, 300));
  const closeSig = await call('GET', `/api/projects/${reportSubmitted.id}/signatures`, { token: stuact });
  ok('recorded against STUACT', closeSig.body.signatures[0] && closeSig.body.signatures[0].signerRole === 'STUACT');

  // ------------------------------------------------------------------
  console.log('\n--- scope: signatures follow the same rule as everything else on a project ---');

  const outOfScope = await call('GET', `/api/projects/${projectApproved.id}/signatures`, { token: otherSh });
  ok('a caller outside this club sees 404, not 403 or the data (Q16 / deviation 15)',
    outOfScope.status === 404, outOfScope.text.slice(0, 200));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
