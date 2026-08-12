/**
 * Reference seed — phases, the transition table, and the tag vocabularies.
 *
 * The phase list is the old frontend's own array (ProjectDocument.js:172-180).
 * The transition rows are the JSX gate table at ProjectDocument.js:286-364 —
 * that table was the only written statement of who may advance what, and this is
 * where it stops being JSX and becomes something the server can enforce.
 */
const path = require('path');
const fs = require('fs');

// Q14: stable codes with a Thai label map. Q40: the four unused รอ… states are
// dropped — they appear in zero rows anywhere in the old data.
const PHASES = [
  { ordinal: 1, code: 'DRAFT_PROPOSAL',     name_th: 'ร่างคำขออนุมัติ' },
  { ordinal: 2, code: 'PROPOSAL_SUBMITTED', name_th: 'ดำเนินการขออนุมัติ' },
  { ordinal: 3, code: 'PROJECT_APPROVED',   name_th: 'โครงการอนุมัติ' },
  { ordinal: 4, code: 'BUDGET_APPROVED',    name_th: 'เงินโครงการอนุมัติ' },
  { ordinal: 5, code: 'DRAFT_REPORT',       name_th: 'ร่างสรุปผลโครงการ' },
  { ordinal: 6, code: 'REPORT_SUBMITTED',   name_th: 'ดำเนินการสรุปผล' },
  { ordinal: 7, code: 'CLOSED',             name_th: 'ปิดโครงการ' },
];

/**
 * from -> to, and who may do it.
 *
 * `position === "S"` in the old JSX is dropped: the database's only role values
 * are SH | AD | STUACT | ADMIN, so that branch was dead.
 *
 * Q26 hard-blocks the budget check on entry to PROJECT_APPROVED,
 * BUDGET_APPROVED and REPORT_SUBMITTED.
 */
const TRANSITIONS = [
  { from: 'DRAFT_PROPOSAL',     to: 'PROPOSAL_SUBMITTED', roles: ['SH'],                    budget: false },
  { from: 'PROPOSAL_SUBMITTED', to: 'PROJECT_APPROVED',   roles: ['ADMIN', 'AD', 'STUACT'], budget: true  },
  { from: 'PROJECT_APPROVED',   to: 'BUDGET_APPROVED',    roles: ['ADMIN', 'STUACT'],       budget: true  },
  { from: 'BUDGET_APPROVED',    to: 'DRAFT_REPORT',       roles: ['SH'],                    budget: false },
  { from: 'DRAFT_REPORT',       to: 'REPORT_SUBMITTED',   roles: ['ADMIN', 'STUACT'],       budget: true  },
  { from: 'REPORT_SUBMITTED',   to: 'CLOSED',             roles: ['ADMIN', 'STUACT'],       budget: false },
];

// The 8 vocabularies behind the 56 is_* columns. `prefix` is how a variable name
// maps to a set; `ordinal` is what the document assembler uses to emit the
// original tag name (tag 4 of SDG -> is_SDGs_4), so it must stay stable.
const TAG_SETS = [
  { code: 'SDG',    name_th: 'เป้าหมายการพัฒนาที่ยั่งยืน (SDGs)', match: /^is_SDGs_(\d+)$/ },
  { code: 'P5_1',   name_th: 'ยุทธศาสตร์ 5.1',                    match: /^is_5p1_(\d+)$/ },
  { code: 'P5_2_1', name_th: 'ยุทธศาสตร์ 5.2.1',                  match: /^is_5p2p1_(\d+)$/ },
  { code: 'P5_2_2', name_th: 'ยุทธศาสตร์ 5.2.2',                  match: /^is_5p2p2_(\d+)$/ },
  { code: 'P5_2_3', name_th: 'ยุทธศาสตร์ 5.2.3',                  match: /^is_5p2p3_(\d+)$/ },
  { code: 'SIDE',   name_th: 'ด้านของกิจกรรม',                    match: /^is_(\d+)side$/ },
  { code: 'BASIC',  name_th: 'คุณลักษณะบัณฑิตที่พึงประสงค์',       match: /^is_(\d+)basic$/ },
  { code: 'FOLLOW', name_th: 'วิธีการติดตามประเมินผล',             match: /^is_(\d+)follow$/ },
];

function buildTags() {
  const file = JSON.parse(fs.readFileSync(path.join(__dirname, 'checkbox-labels.json'), 'utf8'));
  const labels = file.labels;
  const sets = TAG_SETS.map((s) => ({ ...s, tags: [] }));

  for (const [variable, text] of Object.entries(labels)) {
    const set = sets.find((s) => s.match.test(variable));
    if (!set) throw new Error(`checkbox label ${variable} matches no tag set`);
    const ordinal = Number(variable.match(set.match)[1]);
    // 'SDG 4 : ...' — strip the redundant numeric prefix, the ordinal carries it.
    const name_th = text.replace(/^SDG\s*\d+\s*:\s*/, '').trim();
    set.tags.push({ ordinal, name_th });
  }

  for (const s of sets) {
    s.tags.sort((a, b) => a.ordinal - b.ordinal);
    const expected = s.tags.map((_, i) => i + 1);
    const actual = s.tags.map((t) => t.ordinal);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      throw new Error(`tag set ${s.code} has gaps: ${actual.join(',')}`);
    }
  }
  return sets;
}

async function seedReference(conn, log) {
  const phaseId = {};
  for (const p of PHASES) {
    const [r] = await conn.query(
      'INSERT INTO `phase` (`code`,`ordinal`,`name_th`) VALUES (?,?,?)',
      [p.code, p.ordinal, p.name_th]
    );
    phaseId[p.code] = r.insertId;
  }

  let transitionRows = 0;
  for (const t of TRANSITIONS) {
    for (const role of t.roles) {
      await conn.query(
        'INSERT INTO `phase_transition` (`from_phase_id`,`to_phase_id`,`allowed_role`,`requires_budget_check`) VALUES (?,?,?,?)',
        [phaseId[t.from], phaseId[t.to], role, t.budget ? 1 : 0]
      );
      transitionRows += 1;
    }
  }

  const sets = buildTags();
  let tagRows = 0;
  for (const s of sets) {
    const [r] = await conn.query('INSERT INTO `tag_set` (`code`,`name_th`) VALUES (?,?)', [s.code, s.name_th]);
    for (const tag of s.tags) {
      await conn.query(
        'INSERT INTO `tag` (`tag_set_id`,`ordinal`,`name_th`) VALUES (?,?,?)',
        [r.insertId, tag.ordinal, tag.name_th]
      );
      tagRows += 1;
    }
  }

  log(`  phase ${PHASES.length} · phase_transition ${transitionRows}`);
  log(`  tag_set ${sets.length} · tag ${tagRows}  (${sets.map((s) => `${s.code}:${s.tags.length}`).join(' ')})`);
  return { phaseId };
}

module.exports = { seedReference, buildTags, PHASES, TRANSITIONS, TAG_SETS };
