#!/usr/bin/env node
/**
 * Build one project filled to every capacity the forms can print, walk it to
 * CLOSED, and write both `.docx` files out for a person to open in Word.
 *
 *   npm run forms:review
 *   npm run forms:review -- --out ../generated/forms
 *
 * **Why this exists.** `npm run forms:read` renders a project and prints the
 * text, which answers "did the field arrive". It cannot answer the two
 * questions left open on 2026-08-16 after both forms were read through:
 *
 *   1. do the Wingdings tick marks land in the *visually* correct cell, and
 *   2. where do the pages break when every table is full?
 *
 * Both are questions about the page, and only Word can answer them. What a
 * person needs in order to answer them is a document that is *hard* — not the
 * fixture project with one budget line and three activities, but one that fills
 * every fixed-arity family to its limit, because a table that fits at three
 * rows and overflows at fifteen looks correct right up until somebody's real
 * project has fifteen.
 *
 * So the capacities come from `docs/template-tags.json` — the same inventory
 * `arity.js` enforces against — and not from numbers typed here. Replace a
 * template, re-run the extraction, and this fills the new shape.
 *
 * It is also a **continuing** project, which is the branch a single test
 * project never reaches: section 11 of กนศ.04 sits inside `{#is_continueproject}`
 * and its "โครงการต่อเนื่อง" box is the tick most worth looking at.
 *
 * Everything goes through the API as the right role, so this exercises the
 * refusals as it goes rather than writing rows behind them.
 */
const fs = require('fs');
const path = require('path');

const inventory = require('../../docs/template-tags.json');

const B = process.env.API_BASE || 'http://localhost:3001';

/** How many rows of `stem` temp04 can print. The forms are fixed-arity. */
function capacity(stem) {
  const found = inventory.temp04.families.find((f) => f.stem === stem);
  if (!found) throw new Error(`no family "${stem}" in the extracted inventory`);
  return found.max;
}

async function call(method, p, { token, body, raw = false } = {}) {
  const res = await fetch(B + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}

/** Fail loudly and immediately: a half-built review copy is worse than none. */
function must(label, res, expected = [200, 201]) {
  if (!expected.includes(res.status)) {
    throw new Error(`${label} -> ${res.status} ${(res.text || '').slice(0, 300)}`);
  }
  return res.body;
}

async function login(username) {
  const r = await call('POST', '/api/auth/login', { body: { username, password: 'dev' } });
  must(`login ${username}`, r);
  return r.body.token;
}

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split('=');
    if (!flag.startsWith('--')) continue;
    args[flag.slice(2)] = inline !== undefined ? inline : argv[++i];
  }
  return args;
};

/**
 * Long enough to wrap, and numbered, so a truncated or reordered row is
 * obvious on paper. A row of "ทดสอบ" repeated tells a reader nothing about
 * where row 12 went.
 */
const filler = (label, n, tail = '') =>
  `${label}ลำดับที่ ${n} — ข้อความยาวพอที่จะตัดบรรทัดในตาราง เพื่อให้เห็นว่าเซลล์ขยายหรือดันหน้า${tail}`;

const items = (n, make) => Array.from({ length: n }, (_, i) => make(i + 1));

/** Its own name, so a re-run can find and remove what the last one left. */
const REVIEW_COPY_NAME = 'โครงการตัวอย่างสำหรับตรวจแบบฟอร์ม (เต็มทุกช่อง)';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(args.out || path.join(__dirname, '..', '..', 'generated', 'forms'));

  const sh = await login('fixture.student');
  const ad = await login('fixture.advisor');
  const stuact = await login('fixture.stuact');
  const admin = await login('fixture.admin');

  const me = must('me', await call('GET', '/api/me', { token: sh }));
  const year = me.academicYear;
  const clubId = me.membership.club_id;
  const advisors = must('advisors', await call('GET', '/api/reference/advisors', { token: sh }));

  console.log(`ปีการศึกษา ${year} · ชมรม ${clubId}`);

  // --- clear out what the last run left behind -----------------------------
  // Only projects carrying this script's own name, and only as Admin — the one
  // role allowed to delete anything past DRAFT_PROPOSAL. A run that got as far
  // as paying the money out cannot be deleted at all (the ledger is what stops
  // it), so that is reported and left; `npm run db:reset` is the way to clear
  // those. The ceiling arithmetic below is written to survive either outcome.
  const mine = must('list', await call('GET', '/api/projects', { token: admin }))
    .items.filter((p) => p.name === REVIEW_COPY_NAME);
  for (const old of mine) {
    const gone = await call('DELETE', `/api/projects/${old.id}`, { token: admin });
    if (gone.status === 200) console.log(`  ลบสำเนาตรวจฟอร์มเดิม #${old.id}`);
    else if (gone.status === 409) console.log(`  เก็บ #${old.id} ไว้ — ${gone.body.error}`);
    else must(`delete #${old.id}`, gone);
  }

  // --- the project ---------------------------------------------------------
  const created = must('create', await call('POST', '/api/projects', {
    token: sh,
    body: {
      name: REVIEW_COPY_NAME,
      academicTerm: `1/${year}`,
      advisorPersonId: advisors.advisors[0].id,
      // The branch a single test project never reaches: section 11 of กนศ.04
      // and the second of the two tick boxes at the top of the form.
      isNewProject: false,
      isContinueProject: true,
      prepareStartOn: '2024-06-01',
      prepareEndOn: '2024-06-30',
      eventStartOn: '2024-07-15',
      eventEndOn: '2024-07-17',
      reportDueOn: '2024-08-15',
      contact1Name: 'ผู้ประสานงานคนที่หนึ่ง', contact1Phone: '0810000001',
      contact2Name: 'ผู้ประสานงานคนที่สอง', contact2Phone: '0810000002',
      contact3Name: 'ผู้ประสานงานคนที่สาม', contact3Phone: '0810000003',
    },
  }), [201]);
  const id = created.id;
  console.log(`โครงการ #${id} (ร่างที่ ${created.draftSequence})`);

  // --- every fixed-arity family, filled to its limit -----------------------
  const sections = {
    objectives: items(capacity('objective'), (n) => ({ content: filler('วัตถุประสงค์', n) })),
    rationales: items(capacity('principles_and_reasons'), (n) => ({ content: filler('หลักการและเหตุผล', n) })),
    locations: items(capacity('location'), (n) => ({ content: `อาคาร ${n} คณะวิศวกรรมศาสตร์ มจพ.` })),
    types: items(capacity('project_type'), (n) => ({ content: `ลักษณะโครงการที่ ${n}` })),
    problems: items(capacity('problem'), (n) => ({
      problem: filler('ปัญหา', n),
      resolution: filler('แนวทางแก้ไข', n),
    })),
    activities: items(capacity('topic_table'), (n) => ({
      topic: filler('ขั้นตอนการดำเนินงาน', n),
      // Spread across the year so the Gantt shading is visibly different per
      // row — a chart where every row shades the same month proves nothing.
      startOn: `2024-${String(((n - 1) % 12) + 1).padStart(2, '0')}-01`,
      endOn: `2024-${String(((n - 1) % 12) + 1).padStart(2, '0')}-28`,
      responsible: `ผู้รับผิดชอบลำดับที่ ${n}`,
    })),
    indicators: items(capacity('expresult'), (n) => ({
      expectedResult: filler('ผลที่คาดว่าจะได้รับ', n),
      qualityTarget: `เชิงคุณภาพ ${n}: ผู้เข้าร่วมพึงพอใจไม่น้อยกว่าร้อยละ ${80 + n}`,
      // A bare number, not a sentence. The field is free text in the database,
      // but กนศ.06 drops `volume1` into "จำนวน ___ คน" and into "ร้อยละ ___" —
      // the same value in three places (see `assembler.js`) — so anything but a
      // number reads as nonsense on the page it is printed on.
      volumeTarget: String(80 + n),
      etcFollow: `ติดตามผลลำดับที่ ${n}`,
    })),
    // Both variants and all five attendee types: the percentage columns on
    // กนศ.06 are computed, so a type left empty hides a division it would do.
    attendance: ['PLANNED', 'ACTUAL'].flatMap((variant) =>
      ['STUDENT', 'PROFESSOR', 'EXECUTIVE', 'EXPERT', 'OTHER'].map((attendeeType, i) => ({
        variant,
        attendeeType,
        label: attendeeType === 'OTHER' ? 'บุคคลภายนอก' : '',
        headcount: (variant === 'PLANNED' ? 50 : 47) - i * 5,
      }))),
  };

  for (const [name, rows] of Object.entries(sections)) {
    must(`section ${name}`, await call('PUT', `/api/projects/${id}/sections/${name}`, {
      token: sh, body: { items: rows },
    }));
    console.log(`  ${name.padEnd(11)} ${rows.length} แถว`);
  }

  // --- the checkbox vocabularies ------------------------------------------
  // Every tag set gets one tick, which is what makes a misplaced Wingdings
  // glyph visible: an all-empty or all-ticked form looks the same either way
  // if the character is landing in the wrong cell.
  const sets = must('tag sets', await call('GET', '/api/reference/tags', { token: sh }));
  const tagSets = sets.tagSets || sets.sets || [];
  const tagIds = tagSets.map((set) => (set.tags[0] || {}).id).filter(Boolean);
  must('tags', await call('PUT', `/api/projects/${id}/tags`, { token: sh, body: { tagIds } }));
  console.log(`  tags        ${tagIds.length} ชุด ชุดละ 1 ข้อ`);

  // --- the money, filled to each category's own capacity -------------------
  // Uneven amounts on purpose: a column that silently prints the row above it
  // is invisible when every row is 100 baht.
  const budgetLines = [
    // A takes two quantities like BT does — people × hours — even though the
    // form prints both units literally (คน, ชั่วโมง) and so has no unit tags of
    // its own. Leaving `qty2` off prints "จำนวน ___ ชั่วโมง" with a hole in it,
    // and the generated `amount` column (qty1 × qty2 × price) silently drops
    // the hours from every speaker's fee.
    ...items(capacity('listA'), (n) => ({
      category: 'A', description: `ค่าตอบแทนวิทยากรลำดับที่ ${n}`,
      qty1: String(n), unit1: 'คน',
      qty2: String(((n - 1) % 3) + 1), unit2: 'ชั่วโมง',
      unitPrice: String(300 + n * 10),
    })),
    ...items(capacity('listBT'), (n) => ({
      category: 'BT', description: `ค่าใช้สอย (สองหน่วยนับ) ลำดับที่ ${n}`,
      qty1: String(n), unit1: 'วัน', qty2: '2', unit2: 'มื้อ', unitPrice: String(60 + n),
    })),
    ...items(capacity('listBNT'), (n) => ({
      category: 'BNT', description: `ค่าใช้สอย (หน่วยนับเดียว) ลำดับที่ ${n}`,
      qty1: String(n * 2), unit1: 'ชุด', unitPrice: String(45 + n),
    })),
    ...items(capacity('listC'), (n) => ({
      category: 'C', description: `ค่าวัสดุลำดับที่ ${n}`,
      qty1: String(n), unit1: 'ชิ้น', unitPrice: String(25 + n * 3),
    })),
  ];
  const total = budgetLines.reduce(
    (sum, l) => sum + Number(l.qty1) * Number(l.qty2 || 1) * Number(l.unitPrice), 0
  );

  // The club's ceiling is cumulative across every project of the year, so it
  // has to be raised by what this one will commit rather than set to a round
  // number — otherwise a second run of this script is refused by the first
  // run's own project. Read, add, write: the same three steps an officer
  // preparing a year does on the allocations screen.
  const allocation = must('allocations', await call(
    'GET', `/api/allocations?academicYear=${year}`, { token: admin }
  )).items.find((row) => row.club.id === clubId);
  const ceiling = Math.ceil(Number(allocation ? allocation.committed : 0)) + total + 1000;
  must('allocation', await call('PUT', '/api/allocations', {
    token: admin, body: { clubId, academicYear: year, amount: String(ceiling) },
  }));
  console.log(`  วงเงินจัดสรร ${ceiling.toLocaleString()} บาท (ผูกพันไว้แล้ว ${Number(allocation ? allocation.committed : 0).toLocaleString()})`);

  must('plan', await call('PUT', `/api/projects/${id}/budget/plan`, {
    token: sh, body: { plannedAmount: String(total) },
  }));
  must('planned lines', await call('PUT', `/api/projects/${id}/budget/lines/PLANNED`, {
    token: sh, body: { items: budgetLines },
  }));
  console.log(`  งบประมาณ    ${budgetLines.length} รายการ รวม ${total.toLocaleString()} บาท`);

  // --- walk it to CLOSED ---------------------------------------------------
  // The approved amount is deliberately *not* the requested one, and the actual
  // spend is deliberately less again: กนศ.06 prints ขอ / อนุมัติ / ใช้จริง / คืน,
  // and four numbers that are all equal cannot show a column swapped for its
  // neighbour.
  const approved = Math.round(total * 0.9);
  const spent = Math.round(approved * 0.85);

  const approveAmount = async () => {
    must('approve amount', await call('POST', `/api/projects/${id}/budget/approve`, {
      token: stuact, body: { approvedAmount: String(approved) },
    }));
  };

  // The money leaves *after* the phase moves, not before: the disbursement gate
  // opens at BUDGET_APPROVED, so paying first is refused. Worth stating because
  // the approval of the amount is the opposite way round — it has to be set
  // before the phase it justifies.
  const payOut = async () => {
    must('disbursement', await call('POST', `/api/projects/${id}/disbursements`, {
      token: stuact,
      body: {
        amount: String(approved),
        receivedByName: 'หัวหน้าชมรม (ผู้รับเงิน)',
        issuedByName: 'เจ้าหน้าที่กองกิจการนักศึกษา (ผู้จ่ายเงิน)',
      },
    }), [201]);
  };

  const recordActualSpend = async () => {
    // The actual spend keeps the same shape as the plan — the report form
    // prints both, side by side, and a reader compares them row by row.
    const actual = budgetLines.map((l) => ({
      ...l, unitPrice: String(Math.max(1, Math.round(Number(l.unitPrice) * 0.75))),
    }));
    must('actual lines', await call('PUT', `/api/projects/${id}/budget/lines/ACTUAL`, {
      token: sh, body: { items: actual },
    }));
  };

  // Migrations 006/007: a signature is required to enter these four phases.
  // Not what this script exists to exercise, so every one of them just gets
  // the same drawn PNG.
  const SIGNATURE_GATED = new Set(['PROPOSAL_SUBMITTED', 'BUDGET_APPROVED', 'REPORT_SUBMITTED', 'CLOSED']);
  const VALID_PNG = 'data:image/png;base64,' +
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  const walk = [
    ['PROPOSAL_SUBMITTED', sh, null, null],
    ['PROJECT_APPROVED', stuact, null, null],
    ['BUDGET_APPROVED', stuact, approveAmount, payOut],
    ['DRAFT_REPORT', sh, null, null],
    ['REPORT_SUBMITTED', stuact, recordActualSpend, null],
    ['CLOSED', stuact, null, null],
  ];

  for (const [code, token, before, after] of walk) {
    if (before) await before();
    const moved = must(`advance to ${code}`, await call('POST', `/api/projects/${id}/transitions`, {
      token, body: { toPhaseCode: code, ...(SIGNATURE_GATED.has(code) ? { signatureImage: VALID_PNG } : {}) },
    }));
    if (after) await after();
    console.log(`  → ${code}${moved.projectNumber ? `  เลขที่ ${moved.projectNumber}` : ''}`);

    // The advisor's endorsement is not part of the walk — AD does not own a
    // transition of its own (migration 007) — so it is a separate call, made
    // right after submission, matching กนศ.04's own cover-letter ordering.
    if (code === 'PROPOSAL_SUBMITTED') {
      must('advisor endorsement', await call('POST', `/api/projects/${id}/advisor-endorsement`, {
        token: ad, body: { signatureImage: VALID_PNG },
      }));
      console.log('  → เซ็นรับรองโครงการ (อาจารย์ที่ปรึกษา)');
    }
  }

  console.log(`  อนุมัติ ${approved.toLocaleString()} · ใช้จริงประมาณ ${spent.toLocaleString()} บาท`);

  // --- write the documents out --------------------------------------------
  fs.mkdirSync(outDir, { recursive: true });
  const listed = must('documents', await call('GET', `/api/projects/${id}/documents`, { token: sh }));
  const written = [];
  for (const doc of listed.documents) {
    if (!doc.available) {
      console.log(`\n  ${doc.form}: ไม่พร้อมให้ดาวน์โหลด — ${doc.reason}`);
      continue;
    }
    const res = await call('GET', `/api/projects/${id}/documents/${doc.form}`, { token: sh, raw: true });
    if (res.status !== 200) throw new Error(`download ${doc.form} -> ${res.status}`);
    const file = path.join(outDir, `${doc.form}-review-${id}.docx`);
    fs.writeFileSync(file, res.buffer);
    written.push([file, res.buffer.length]);
  }

  console.log('\nเปิดไฟล์นี้ใน Word แล้วดูสองเรื่องที่อ่าน XML แล้วตอบไม่ได้:');
  for (const [file, bytes] of written) console.log(`  ${file}  (${(bytes / 1024).toFixed(0)} KB)`);
  console.log('  1. เครื่องหมายถูก (Wingdings) ตกอยู่ในช่องที่ถูกต้องตามสายตาหรือไม่');
  console.log('  2. ตารางที่เต็มทุกแถวดันหน้าแตกตรงไหน');
}

main().catch((err) => {
  console.error('\nforms:review failed:', err.message);
  process.exit(1);
});
