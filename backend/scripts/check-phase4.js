#!/usr/bin/env node
/**
 * Phase 4 acceptance run.
 *
 *   npm run db:reset          # the assertions below start from the fixtures
 *   npm run dev               # in another terminal
 *   npm run check:phase4
 *
 * The build plan's "Done when" list for Phase 4, made executable: both forms
 * render fully populated from a fixture project, every tag in the contract is
 * either filled or deliberately blank, and an over-capacity project produces an
 * error naming the category and the limit.
 *
 * Unlike the Phase 2 and 3 runs this is **half in-process**. The contract check
 * has to compare the assembler's payload against the extracted tag inventory
 * key by key, which is not something an HTTP response can show; the download
 * path, its authorization and its phase gate are exercised over HTTP as usual.
 */
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const inventory = require('../../docs/template-tags.json');
const { pool } = require('../src/db/pool');
const { loadDocument, build } = require('../src/documents/assembler');
const { render } = require('../src/documents/render');
const { overCapacity } = require('../src/documents/arity');
const { thaiDate, monthIndex, bahtText } = require('../src/documents/thai');

const B = 'http://localhost:3001';
let pass = 0, fail = 0;

function ok(label, condition, extra = '') {
  if (condition) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
}

async function call(method, p, { token, body, raw = false } = {}) {
  const res = await fetch(B + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) {
    return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
  }
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

/** The rendered document's own text, the same way the tags were extracted. */
function textOf(buffer) {
  const zip = new PizZip(buffer);
  return Object.keys(zip.files)
    .filter((entry) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(entry))
    .sort()
    .map((entry) => (zip.files[entry].asText().match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || [])
      .map((run) => run.replace(/<[^>]+>/g, ''))
      .join(''))
    .join('\n');
}

/**
 * Tags the contract lists that the assembler deliberately does not supply.
 *
 * Each one is a decision, not an oversight, and naming it here is what keeps
 * "deliberately blank" honest — an unlisted missing tag fails the run.
 */
const DELIBERATELY_ABSENT = {
  temp04: {},
  temp06: {
    // `grandTypeETC` under `persen`: the label of the "other" attendee category
    // is a label, and a percentage of a label is not a thing. The form reads it
    // from `person` in the same row, which is supplied.
    'persen.grandTypeETC': 'a label has no percentage; person.grandTypeETC carries it',
  },
};

(async () => {
  const sh = await login('fixture.student');
  const ad = await login('fixture.advisor');
  const stuact = await login('fixture.stuact');
  const admin = await login('fixture.admin');
  const otherSh = await login('fixture.otherstudent');

  // The student's own list, not the admin's: every project named below is
  // downloaded as `sh` further down, and the admin's list also contains the
  // out-of-scope club — whose projects `sh` is rightly refused.
  const list = await call('GET', '/api/projects', { token: sh });
  const byPhase = (code) => list.body.items.find((p) => p.phase.code === code);
  const closed = byPhase('CLOSED');
  const draft = byPhase('DRAFT_PROPOSAL');
  const approved = byPhase('PROJECT_APPROVED');

  // ------------------------------------------------------------------
  console.log('\n--- derivations ---');

  ok('a Thai date is the Buddhist year and the Thai month',
    thaiDate('2024-06-01') === '1 มิถุนายน 2567', thaiDate('2024-06-01'));
  ok('an absent date is blank, not 1 มกราคม 2513',
    thaiDate(null) === '' && thaiDate('') === '' && thaiDate('0000-00-00') === '');
  ok('a month index is a number, not a string',
    monthIndex('2024-10-05') === 10 && typeof monthIndex('2024-10-05') === 'number');
  ok('an absent date has no month, so its Gantt row shades nothing',
    monthIndex(null) === null);
  ok('the spelled-out amount is Thai',
    bahtText('19200.00') === 'หนึ่งหมื่นเก้าพันสองร้อยบาทถ้วน', bahtText('19200.00'));
  ok('  …with เอ็ด and ยี่', bahtText('21') === 'ยี่สิบเอ็ดบาทถ้วน', bahtText('21'));
  ok('  …with satang', bahtText('12.34') === 'สิบสองบาทสามสิบสี่สตางค์', bahtText('12.34'));
  ok('  …above the old 9,999,999 ceiling, instead of an error string',
    bahtText('12000000').startsWith('สิบสองล้าน'), bahtText('12000000'));

  // ------------------------------------------------------------------
  console.log('\n--- the contract: every tag is filled or deliberately blank ---');

  const document = await loadDocument(closed.id);
  ok('the fixture project loads', Boolean(document));

  for (const form of ['temp04', 'temp06']) {
    const payload = build(form, document);
    const owners = inventory[form].owners;
    const absent = DELIBERATELY_ABSENT[form];

    const missing = [];
    for (const [what, table] of [['field', owners.fields], ['section', owners.sections]]) {
      for (const [name, roots] of Object.entries(table)) {
        for (const root of roots) {
          const key = `${root || '(top)'}.${name}`;
          if (absent[key]) continue;
          const scope = root === null ? payload : payload[root];
          if (!scope || !(name in scope)) missing.push(`${what} ${key}`);
        }
      }
    }
    ok(`${form}: every contract tag has a key in the payload`,
      missing.length === 0, `${missing.length} missing: ${missing.slice(0, 6).join(', ')}`);

    const undef = [];
    for (const [root, values] of Object.entries(payload)) {
      for (const [name, value] of Object.entries(values)) {
        if (value === undefined || value === null) undef.push(`${root}.${name}`);
      }
    }
    ok(`${form}: no key is undefined or null`, undef.length === 0, undef.slice(0, 6).join(', '));
  }

  // ------------------------------------------------------------------
  console.log('\n--- rendering ---');

  for (const form of ['temp04', 'temp06']) {
    const out = render(form, document);
    const text = textOf(out.buffer);

    ok(`${form}: renders a non-trivial document`, out.buffer.length > 40000, String(out.buffer.length));
    ok(`${form}: no unrendered tag survives`,
      (text.match(/\{[^}]{0,40}\}/g) || []).length === 0,
      (text.match(/\{[^}]{0,40}\}/g) || []).slice(0, 3).join(' '));
    ok(`${form}: prints no undefined / null / NaN / Infinity`,
      !/undefined|NaN|Infinity/.test(text) && !/(^|[^A-Za-z])null([^A-Za-z]|$)/.test(text));
    ok(`${form}: carries the project's own name`, text.includes(closed.name.slice(0, 20)));
    ok(`${form}: carries the club`, text.includes('ชมรมพุทธศาสน์'));
    ok(`${form}: the filename names the form and the project number`,
      out.filename.includes(closed.projectNumber), out.filename);
  }

  const temp04Text = textOf(render('temp04', document).buffer);
  ok('temp04: the spelled-out grand total is printed',
    temp04Text.includes('หนึ่งหมื่นเก้าพันสองร้อยบาทถ้วน'));
  ok('temp04: the budget grid prints its line items',
    temp04Text.includes('ค่าตอบแทนวิทยากร') && temp04Text.includes('ค่าวัสดุอุปกรณ์'));
  ok('temp04: Thai dates are printed, not ISO ones',
    temp04Text.includes('กรกฎาคม 2567') && !/2024-07/.test(temp04Text));

  // ------------------------------------------------------------------
  console.log('\n--- the three render-path defects ---');

  const temp06Payload = build('temp06', document);
  const temp06Text = textOf(render('temp06', document).buffer);

  ok('defect 1: กนศ.06 states the approved total instead of a blank',
    temp06Payload.budget.listSAll === '19,200.00' &&
    /19,200\.00 บาท จากเงินเหลือจ่าย/.test(temp06Text),
    temp06Payload.budget.listSAll);
  ok('  …and the actual spend is separate from it',
    temp06Payload.Fbudget.listSAll === '16,800.00', temp06Payload.Fbudget.listSAll);
  ok('  …and the refund is approved minus actual',
    temp06Payload.Fbudget.refundtotal === '2,400.00', temp06Payload.Fbudget.refundtotal);

  ok('defect 2: a percentage of zero planned is a dash, not Infinity%',
    temp06Payload.persen.grandTotalExecutive === '—', temp06Payload.persen.grandTotalExecutive);
  ok('  …and a real percentage is still computed',
    temp06Payload.persen.grandTotalStudent === '92%', temp06Payload.persen.grandTotalStudent);
  ok('  …and the total percentage is over the total planned',
    temp06Payload.persen.grandTotalAll === '88%', temp06Payload.persen.grandTotalAll);

  ok('defect 3: the space-padded tag is matched by its trimmed name',
    'grandTypeETC' in temp06Payload.person &&
    Object.keys(inventory.temp06.owners.fields).includes('grandTypeETC'));

  // ------------------------------------------------------------------
  console.log('\n--- arity: over capacity errors, never truncates ---');

  const limits = inventory.temp04.families.find((f) => f.stem === 'listBT');
  ok('the BT limit is read from the template, not typed in', limits.max === 12, String(limits.max));

  const overBT = {
    ...document,
    budget: {
      ...document.budget,
      lines: [], planned: [],
    },
  };
  overBT.budget.planned = Array.from({ length: 13 }, (_, i) => ({
    variant: 'PLANNED', category: 'BT', ordinal: i + 1,
    description: `รายการที่ ${i + 1}`, qty1: '1', unit1: 'ชิ้น', qty2: null, unit2: null,
    unit_price: '100.00', amount: '100.00',
  }));
  overBT.budget.lines = overBT.budget.planned;

  const btFindings = overCapacity('temp04', overBT);
  ok('13 BT lines are refused', btFindings.length === 1, JSON.stringify(btFindings));
  ok('  …naming the category', /ค่าใช้สอย/.test(btFindings[0].message), btFindings[0].message);
  ok('  …naming both counts',
    btFindings[0].rows === 13 && btFindings[0].capacity === 12 &&
    /13/.test(btFindings[0].message) && /12/.test(btFindings[0].message),
    btFindings[0].message);

  let threw = null;
  try { render('temp04', overBT); } catch (err) { threw = err; }
  ok('  …and the render refuses rather than dropping the thirteenth',
    threw !== null && threw.status === 422, threw ? String(threw.status) : 'no error');
  ok('  …carrying every violation, not just the first',
    threw && Array.isArray(threw.detail.documentViolations), threw && JSON.stringify(threw.detail));

  const overETC = { ...document, budget: { ...document.budget, planned: [
    { variant: 'PLANNED', category: 'ETC', ordinal: 1, description: 'อื่น ๆ',
      qty1: '1', unit1: null, qty2: null, unit2: null, unit_price: '50.00', amount: '50.00' },
  ] } };
  overETC.budget.lines = overETC.budget.planned;
  const etcFindings = overCapacity('temp04', overETC);
  ok('a category the form cannot print at all is refused, not silently dropped',
    etcFindings.length === 1 && etcFindings[0].capacity === 0, JSON.stringify(etcFindings));
  ok('  …and says the form has no place for it',
    /ไม่มีช่อง/.test(etcFindings[0].message), etcFindings[0].message);

  const fine = overCapacity('temp04', document);
  ok('a project inside every limit has no findings', fine.length === 0, JSON.stringify(fine));

  // ------------------------------------------------------------------
  console.log('\n--- downloads: authorized and phase-checked ---');

  const avail = await call('GET', `/api/projects/${closed.id}/documents`, { token: sh });
  ok('a project lists what it can produce', avail.status === 200 &&
    avail.body.documents.length === 2, avail.text.slice(0, 200));
  ok('  …and both are available for a closed project',
    avail.body.documents.every((d) => d.available), JSON.stringify(avail.body.documents));

  const draftAvail = await call('GET', `/api/projects/${draft.id}/documents`, { token: sh });
  ok('a draft cannot produce either form yet',
    draftAvail.body.documents.every((d) => !d.available));
  ok('  …and says why, naming the phase it needs',
    /ดำเนินการขออนุมัติ/.test(draftAvail.body.documents.find((d) => d.form === 'temp04').reason),
    draftAvail.body.documents[0].reason);

  const approvedAvail = await call('GET', `/api/projects/${approved.id}/documents`, { token: sh });
  ok('an approved project can produce กนศ.04 but not yet กนศ.06',
    approvedAvail.body.documents.find((d) => d.form === 'temp04').available === true &&
    approvedAvail.body.documents.find((d) => d.form === 'temp06').available === false,
    JSON.stringify(approvedAvail.body.documents.map((d) => [d.form, d.available])));

  const download = await call('GET', `/api/projects/${closed.id}/documents/temp04`, { token: sh, raw: true });
  ok('the download succeeds', download.status === 200, String(download.status));
  ok('  …with the Word content type',
    /wordprocessingml\.document/.test(download.headers.get('content-type')),
    download.headers.get('content-type'));
  ok('  …as an attachment with a UTF-8 filename',
    /attachment/.test(download.headers.get('content-disposition')) &&
    /filename\*=UTF-8''/.test(download.headers.get('content-disposition')),
    download.headers.get('content-disposition'));
  ok('  …and the bytes are a real docx', download.buffer.slice(0, 2).toString() === 'PK' &&
    download.buffer.length > 40000, String(download.buffer.length));
  ok('  …that opens and carries the project', textOf(download.buffer).includes('ชมรมพุทธศาสน์'));

  ok('too early is a 400 naming the phase',
    (await call('GET', `/api/projects/${draft.id}/documents/temp06`, { token: sh })).status === 400);
  ok('an unknown form is a 404',
    (await call('GET', `/api/projects/${closed.id}/documents/temp99`, { token: sh })).status === 404);

  console.log('\n--- who may download ---');
  ok('the adviser may download — a viewer still gets the forms',
    (await call('GET', `/api/projects/${closed.id}/documents/temp04`, { token: ad, raw: true })).status === 200);
  ok('STUACT may download in its jurisdiction',
    (await call('GET', `/api/projects/${closed.id}/documents/temp04`, { token: stuact, raw: true })).status === 200);
  ok('another club\'s student gets 404, not a document',
    (await call('GET', `/api/projects/${closed.id}/documents/temp04`, { token: otherSh })).status === 404);
  ok('  …and cannot list its documents either',
    (await call('GET', `/api/projects/${closed.id}/documents`, { token: otherSh })).status === 404);
  const outside = (await call('GET', '/api/projects', { token: admin }))
    .body.items.find((p) => p.club.id !== closed.club.id);
  ok('  …and the leak does not run the other way either',
    (await call('GET', `/api/projects/${outside.id}/documents`, { token: sh })).status === 404);
  ok('unauthenticated download is 401',
    (await call('GET', `/api/projects/${closed.id}/documents/temp04`)).status === 401);

  // ------------------------------------------------------------------
  console.log('\n--- the templates are unchanged ---');
  const crypto = require('crypto');
  const md5 = (f) => crypto.createHash('md5')
    .update(fs.readFileSync(path.resolve(__dirname, '../../templates', f))).digest('hex');
  ok('temp04.docx is byte-identical to the copied original',
    md5('temp04.docx') === 'caa8d2634d7fbe2e3b05147c7870ce3e', md5('temp04.docx'));
  ok('temp06.docx is byte-identical to the copied original',
    md5('temp06.docx') === '1686cc9b8f930fe798697967d13bfc0b', md5('temp06.docx'));

  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail ? 1 : 0);
})().catch(async (err) => {
  console.error('\nrun aborted:', err.stack || err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
