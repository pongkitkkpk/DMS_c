/**
 * Budget enforcement — the subsystem the old system did not have.
 *
 * `business-rules.md` → "Budget" records what was there instead: `allow_budget`
 * was writable by any caller through a mass-assignment update, `remainingBudget`
 * was a stored column recomputed by the client, and nothing anywhere compared a
 * request against a limit. Deviation 5 in docs/DECISIONS.md is this file.
 *
 * Three limits (Q20/Q25/Q32), each with its own code and its own message so a
 * refusal says which one was hit:
 *
 *   (a) `requested_total ≤ planned_amount`   — the lines may not exceed the plan
 *   (b) `disbursed_total ≤ approved_amount`  — money out may not exceed approval
 *       `actual_total    ≤ approved_amount`  — and neither may the final spend
 *   (c) `Σ approved_amount over the club-year ≤ agency_allocation.amount`
 *
 * Where each one binds is a decision, not a port — nothing in the old system
 * states it. Each flagged transition owns the limit that first becomes real at
 * it (`TRANSITION_BLOCKS` below), and Q26's "re-check on every budget write"
 * means a write that would push an *already approved* project over is refused
 * at the write, not at the next transition (`writeBlocks`).
 *
 * Two things hold throughout:
 *
 * - **Nothing summable is stored.** `budget_line.amount` is a GENERATED column
 *   and every total here is a `SUM` over rows. There is no figure that can
 *   disagree with its components, which is what `p_finalbudget`'s stored totals
 *   did.
 * - **Every check runs inside the transaction that commits the thing it is
 *   checking** (Q28), under locks taken in one order — allocation, then project
 *   — so two approvals against one allocation cannot both pass.
 */
const { pool, transaction } = require('../db/pool');
const { HttpError } = require('../lib/httpError');
const { check, pickFields, pickList } = require('../lib/validate');
const { satang, fromSatang, baht } = require('../lib/money');
const { recordEvent } = require('./projectService');
const scope = require('./scope');

const VARIANTS = ['PLANNED', 'ACTUAL'];
const CATEGORIES = ['A', 'BT', 'BNT', 'C', 'ETC'];

/**
 * A budget line as the client may state it.
 *
 * `amount` is deliberately absent: it is a GENERATED column, so the line total
 * is the database's to compute (Q13). `ordinal` is absent for the same reason
 * it is absent from every other list — it decides which box the line prints in
 * on a government form, so it is assigned from array position (deviation 16).
 */
const LINE_FIELDS = {
  category:    ['category',    check.oneOf(CATEGORIES, { required: true })],
  description: ['description', check.text({ max: 512, required: true })],
  qty1:        ['qty1',        check.decimal({ max: 99999999.99 })],
  unit1:       ['unit1',       check.text({ max: 64 })],
  qty2:        ['qty2',        check.decimal({ max: 99999999.99 })],
  unit2:       ['unit2',       check.text({ max: 64 })],
  unitPrice:   ['unit_price',  check.decimal({ required: true })],
};

const DISBURSEMENT_FIELDS = {
  amount:         ['amount',           check.decimal({ min: 0.01, required: true })],
  receivedByName: ['received_by_name', check.text({ max: 255, required: true })],
  issuedByName:   ['issued_by_name',   check.text({ max: 255, required: true })],
};

// --------------------------------------------------------------------------
// Findings
// --------------------------------------------------------------------------

/**
 * What a check can conclude. The code is the stable identifier; the Thai text
 * is what a user reads. Q32 asks for distinct messages per layer, and these go
 * further — plan-level and commitment-level failures are separate codes, and so
 * are the two halves of layer (b), because "you paid out too much" and "you
 * spent too much" are different problems with different remedies.
 */
const CODES = {
  REQUEST_OVER_PLAN:         'REQUEST_OVER_PLAN',
  APPROVED_AMOUNT_MISSING:   'APPROVED_AMOUNT_MISSING',
  DISBURSED_OVER_APPROVED:   'DISBURSED_OVER_APPROVED',
  ACTUAL_OVER_APPROVED:      'ACTUAL_OVER_APPROVED',
  ALLOCATION_MISSING:        'ALLOCATION_MISSING',
  CLUB_YEAR_OVER_ALLOCATION: 'CLUB_YEAR_OVER_ALLOCATION',
};

const LAYER_CODES = {
  a: [CODES.REQUEST_OVER_PLAN],
  b: [CODES.APPROVED_AMOUNT_MISSING, CODES.DISBURSED_OVER_APPROVED, CODES.ACTUAL_OVER_APPROVED],
  c: [CODES.APPROVED_AMOUNT_MISSING, CODES.ALLOCATION_MISSING, CODES.CLUB_YEAR_OVER_ALLOCATION],
};

const codesFor = (layers) => [...new Set(layers.flatMap((layer) => LAYER_CODES[layer]))];

/**
 * The layer each flagged transition enforces.
 *
 * One layer per gate, and never a layer that has already been committed:
 * re-checking (c) on the way to `REPORT_SUBMITTED` would let a *lowered*
 * allocation block a report, and Q33 says lowering is allowed loudly rather
 * than retroactively refusing what it already approved.
 */
const TRANSITION_BLOCKS = {
  PROJECT_APPROVED: ['a'],
  BUDGET_APPROVED:  ['a', 'c'],
  REPORT_SUBMITTED: ['b'],
};

/**
 * The layers that already bind at `phaseOrdinal`, and so must hold after any
 * budget write (Q26 — "reject edits that would push an approved project over").
 *
 * (c) is not here on purpose: a budget *line* cannot change any approved amount,
 * so re-checking the allocation on a line edit could only ever fail for a reason
 * the person editing cannot fix.
 */
function writeBlocks(phaseOrdinal) {
  const layers = [];
  if (phaseOrdinal >= 3) layers.push('a');   // PROJECT_APPROVED
  if (phaseOrdinal >= 6) layers.push('b');   // REPORT_SUBMITTED
  return layers;
}

/** Everything worth telling the client about, whether or not it blocks here. */
const ALL_PROJECT_LAYERS = ['a', 'b'];

// --------------------------------------------------------------------------
// Reads
// --------------------------------------------------------------------------

/**
 * One project's money, from its components.
 *
 * `locking` matters more than it looks. InnoDB's REPEATABLE READ fixes a
 * transaction's snapshot at its *first* read — before it starts waiting on any
 * lock — so a plain `SUM` taken after acquiring a lock still returns the world
 * as it was before the previous holder committed. The same trap cost a day in
 * `projectService.lockClubForNumbering`; every check that decides whether a
 * write may commit reads with `FOR UPDATE` for exactly that reason.
 */
async function readProjectMoney(conn, projectId, { locking = false } = {}) {
  const lock = locking ? ' FOR UPDATE' : '';

  const [[plan]] = await conn.query(
    `SELECT planned_amount, approved_amount, approved_by, approved_at
       FROM budget_plan_line WHERE project_id = ?${lock}`,
    [projectId]
  );
  const [[lines]] = await conn.query(
    `SELECT COALESCE(SUM(CASE WHEN variant = 'PLANNED' THEN amount END), 0) AS requested_total,
            COALESCE(SUM(CASE WHEN variant = 'ACTUAL'  THEN amount END), 0) AS actual_total
       FROM budget_line WHERE project_id = ?${lock}`,
    [projectId]
  );
  const [[paid]] = await conn.query(
    `SELECT COALESCE(SUM(amount), 0) AS disbursed_total
       FROM disbursement WHERE project_id = ?${lock}`,
    [projectId]
  );

  // No plan row is not an error: it means nothing has been planned yet, which
  // reads as zero and lets layer (a) refuse lines that have no plan behind them.
  return {
    plannedAmount:  plan ? plan.planned_amount : '0.00',
    approvedAmount: plan ? plan.approved_amount : null,
    approvedBy:     plan ? plan.approved_by : null,
    approvedAt:     plan ? plan.approved_at : null,
    requestedTotal: String(lines.requested_total),
    actualTotal:    String(lines.actual_total),
    disbursedTotal: String(paid.disbursed_total),
    hasPlanLine:    Boolean(plan),
  };
}

/**
 * The club-year allocation row, locked ahead of everything else that a
 * commitment touches.
 *
 * Q31 puts the grain at `(club, campus, year)`; a club has exactly one campus,
 * so the campus in that key is the club's own and not a third axis to search on.
 * Locking a single existing row first is what turns two concurrent approvals
 * into a queue rather than a deadlock — the second half of the lesson in
 * `projectService.lockClubForNumbering`.
 */
async function lockAllocation(conn, clubId, academicYear) {
  const [rows] = await conn.query(
    `SELECT a.id, a.amount, a.campus_id
       FROM agency_allocation a
      WHERE a.club_id = ? AND a.academic_year = ?
      FOR UPDATE`,
    [clubId, academicYear]
  );
  return rows[0] || null;
}

async function readAllocation(conn, clubId, academicYear) {
  const [rows] = await conn.query(
    'SELECT id, amount, campus_id FROM agency_allocation WHERE club_id = ? AND academic_year = ?',
    [clubId, academicYear]
  );
  return rows[0] || null;
}

/**
 * What the club has already committed this year: every approved amount in it.
 *
 * An `approved_amount` counts from the moment it is written, not from the phase
 * change that follows it. Anything else would let a club approve its way past
 * the ceiling in the gap between the two, and would make the write-time check
 * and the transition-time check disagree about the same number.
 */
async function readCommitted(conn, clubId, academicYear, { locking = false } = {}) {
  const [[row]] = await conn.query(
    `SELECT COALESCE(SUM(pl.approved_amount), 0) AS committed
       FROM budget_plan_line pl
       JOIN project p ON p.id = pl.project_id
      WHERE p.club_id = ? AND p.academic_year = ? AND pl.approved_amount IS NOT NULL
      ${locking ? 'FOR UPDATE' : ''}`,
    [clubId, academicYear]
  );
  return String(row.committed);
}

// --------------------------------------------------------------------------
// The checks
// --------------------------------------------------------------------------

/**
 * Run `layers` against `project` and return what they found.
 *
 * Nothing here throws: a finding is data. Whether a given finding blocks or
 * merely warns is the caller's decision, which is what makes "warn on draft
 * submit, hard-block at the three gates" one implementation rather than two.
 *
 * `committing` is what separates "not stated yet" from "missing". An approved
 * amount and a club ceiling are absent for the whole of drafting, and saying so
 * on every read would train people to ignore the warnings that matter. They
 * become findings only where money is actually about to be committed — at the
 * `BUDGET_APPROVED` gate and after it — which is where their absence is a fault
 * rather than a fact.
 *
 * @param {object} project a project row carrying `id`, `club_id`, `academic_year`
 * @param {string[]} layers subset of `['a','b','c']`
 * @returns {Promise<{money: object, allocation: object|null, committed: string|null, findings: object[]}>}
 */
async function evaluate(conn, project, layers, { locking = false, committing = null } = {}) {
  const commits = committing === null ? Number(project.phase_ordinal || 0) >= 4 : committing;
  const money = await readProjectMoney(conn, project.id, { locking });
  const findings = [];
  const seen = new Set();
  const add = (finding) => {
    if (seen.has(finding.code)) return;
    seen.add(finding.code);
    findings.push(finding);
  };

  if (layers.includes('a')) {
    const over = satang(money.requestedTotal) - satang(money.plannedAmount);
    if (over > 0) {
      add({
        layer: 'a',
        code: CODES.REQUEST_OVER_PLAN,
        message: `รายการงบประมาณที่ขอ ${baht(money.requestedTotal)} บาท เกินงบประมาณที่วางแผนไว้ ${baht(money.plannedAmount)} บาท (เกิน ${baht(fromSatang(over))} บาท)`,
        requested: money.requestedTotal,
        planned: money.plannedAmount,
        over: fromSatang(over),
      });
    }
  }

  if (layers.includes('b')) {
    if (money.approvedAmount === null) {
      if (commits) {
        add({
          layer: 'b',
          code: CODES.APPROVED_AMOUNT_MISSING,
          message: 'ยังไม่ได้อนุมัติวงเงินของโครงการนี้',
        });
      }
    } else {
      const approved = satang(money.approvedAmount);
      const paidOver = satang(money.disbursedTotal) - approved;
      if (paidOver > 0) {
        add({
          layer: 'b',
          code: CODES.DISBURSED_OVER_APPROVED,
          message: `ยอดเบิกจ่ายสะสม ${baht(money.disbursedTotal)} บาท เกินวงเงินที่อนุมัติ ${baht(money.approvedAmount)} บาท (เกิน ${baht(fromSatang(paidOver))} บาท)`,
          disbursed: money.disbursedTotal,
          approved: money.approvedAmount,
          over: fromSatang(paidOver),
        });
      }
      const spentOver = satang(money.actualTotal) - approved;
      if (spentOver > 0) {
        add({
          layer: 'b',
          code: CODES.ACTUAL_OVER_APPROVED,
          message: `ค่าใช้จ่ายจริง ${baht(money.actualTotal)} บาท เกินวงเงินที่อนุมัติ ${baht(money.approvedAmount)} บาท (เกิน ${baht(fromSatang(spentOver))} บาท)`,
          actual: money.actualTotal,
          approved: money.approvedAmount,
          over: fromSatang(spentOver),
        });
      }
    }
  }

  let allocation = null;
  let committed = null;

  if (layers.includes('c')) {
    allocation = locking
      ? await lockAllocation(conn, project.club_id, project.academic_year)
      : await readAllocation(conn, project.club_id, project.academic_year);
    committed = await readCommitted(conn, project.club_id, project.academic_year, { locking });

    if (money.approvedAmount === null && commits) {
      add({
        layer: 'c',
        code: CODES.APPROVED_AMOUNT_MISSING,
        message: 'ยังไม่ได้อนุมัติวงเงินของโครงการนี้',
      });
    }
    if (!allocation) {
      if (commits) {
        add({
          layer: 'c',
          code: CODES.ALLOCATION_MISSING,
          message: `ยังไม่ได้กำหนดวงเงินจัดสรรของชมรมนี้ในปีการศึกษา ${project.academic_year}`,
        });
      }
    } else {
      const over = satang(committed) - satang(allocation.amount);
      if (over > 0) {
        add({
          layer: 'c',
          code: CODES.CLUB_YEAR_OVER_ALLOCATION,
          message: `วงเงินที่อนุมัติรวมของชมรมในปีการศึกษา ${project.academic_year} คือ ${baht(committed)} บาท เกินวงเงินจัดสรร ${baht(allocation.amount)} บาท (เกิน ${baht(fromSatang(over))} บาท)`,
          committed,
          allocation: allocation.amount,
          over: fromSatang(over),
        });
      }
    }
  }

  return { money, allocation, committed, findings };
}

/**
 * Split findings into the ones that stop this operation and the ones that only
 * need saying. A blocked operation answers **422**, not 400: the request was
 * well formed and the caller is entitled to make it — the numbers are what
 * refuse it, and `budgetViolations` carries every one so a form can mark more
 * than the first field.
 */
function enforce(findings, blockLayers) {
  const blocking = codesFor(blockLayers);
  const blocked = findings.filter((f) => blocking.includes(f.code));
  const warnings = findings.filter((f) => !blocking.includes(f.code));
  if (blocked.length) {
    throw new HttpError(422, blocked[0].message, { budgetViolations: blocked, budgetWarnings: warnings });
  }
  return warnings;
}

/** The phase-machine hook. Called from `phaseService` inside the transition's transaction. */
async function assertTransitionAllowed(conn, project, toPhaseCode) {
  const blockLayers = TRANSITION_BLOCKS[toPhaseCode] || [];
  const layers = [...new Set([...blockLayers, ...ALL_PROJECT_LAYERS])];
  // A gate that enforces (b) or (c) is a gate money passes through, so from
  // here on an unstated approved amount or an unset ceiling is a fault.
  const committing = blockLayers.includes('b') || blockLayers.includes('c');
  const { findings } = await evaluate(conn, project, layers, { locking: true, committing });
  return enforce(findings, blockLayers);
}

/** True when advancing to `toPhaseCode` will touch the allocation row. */
const transitionLocksAllocation = (toPhaseCode) =>
  (TRANSITION_BLOCKS[toPhaseCode] || []).includes('c');

/**
 * Advisory findings for a project standing where it is — Q26's "warn on draft
 * submit", generalised: every transition response and every budget read carries
 * whatever does not yet block, so a problem is visible for the whole of the
 * phase in which it can still be fixed.
 */
async function warningsFor(conn, project) {
  const { findings } = await evaluate(conn, project, ALL_PROJECT_LAYERS);
  return findings;
}

// --------------------------------------------------------------------------
// Reads for the client
// --------------------------------------------------------------------------

/** camelCase for the wire, plus the derived figures the view exposes. */
function presentMoney(money, { allocation = null, committed = null } = {}) {
  const approved = money.approvedAmount;
  return {
    plannedAmount: money.plannedAmount,
    requestedTotal: money.requestedTotal,
    approvedAmount: approved,
    disbursedTotal: money.disbursedTotal,
    actualTotal: money.actualTotal,
    // Both are subtractions over committed rows, never columns (Q28).
    remaining: approved === null ? null : fromSatang(satang(approved) - satang(money.disbursedTotal)),
    refundTotal: approved === null ? null : fromSatang(satang(approved) - satang(money.actualTotal)),
    approvedAt: money.approvedAt,
    allocation: allocation ? allocation.amount : null,
    clubYearCommitted: committed,
    clubYearRemaining:
      allocation && committed !== null ? fromSatang(satang(allocation.amount) - satang(committed)) : null,
  };
}

async function loadLines(projectId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, variant, category, ordinal, description, qty1, unit1, qty2, unit2, unit_price, amount
       FROM budget_line WHERE project_id = ?
      ORDER BY variant, FIELD(category, 'A', 'BT', 'BNT', 'C', 'ETC'), ordinal`,
    [projectId]
  );
  return {
    planned: rows.filter((r) => r.variant === 'PLANNED'),
    actual: rows.filter((r) => r.variant === 'ACTUAL'),
  };
}

async function loadDisbursements(projectId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, amount, received_by_name, issued_by_name, disbursed_at
       FROM disbursement WHERE project_id = ? ORDER BY disbursed_at, id`,
    [projectId]
  );
  return rows;
}

/**
 * The figures alone, for screens that show money without editing it. Findings
 * are advisory here by definition — a read blocks nothing.
 */
async function loadSummary(project) {
  const { money, allocation, committed, findings } = await evaluate(
    pool, project, [...ALL_PROJECT_LAYERS, 'c']
  );
  return { money: presentMoney(money, { allocation, committed }), warnings: findings };
}

/**
 * Everything the budget screen needs in one round trip, including which of its
 * controls this caller may use.
 *
 * `permissions` is asked of the same assertions the writes run, so the screen
 * cannot offer a control the server would refuse or hide one it would allow.
 * It is a convenience, not a defence: every write re-runs the rule regardless of
 * what the client believes it may do.
 */
async function loadOverview(actor, project) {
  const [summary, lines, disbursements] = await Promise.all([
    loadSummary(project),
    loadLines(project.id),
    loadDisbursements(project.id),
  ]);
  return {
    ...summary,
    lines,
    disbursements,
    permissions: {
      edit: scope.permits(() => scope.assertCanEdit(actor, project)),
      approve: scope.permits(() => assertMayApprove(actor, project)),
      disburse: scope.permits(() => assertMayDisburse(actor, project)),
    },
  };
}

// --------------------------------------------------------------------------
// Writes
// --------------------------------------------------------------------------

/**
 * Serialize everything that touches one project's money.
 *
 * Held for the whole of a budget write so the totals a check reads cannot move
 * under it. Taken *after* any allocation lock, never before — one lock order
 * everywhere is what keeps an approval racing a transition from deadlocking.
 */
async function lockProject(conn, projectId) {
  const [rows] = await conn.query('SELECT id FROM project WHERE id = ? FOR UPDATE', [projectId]);
  if (!rows.length) throw HttpError.notFound('ไม่พบโครงการ');
}

/**
 * Who may approve money, and when.
 *
 * Role and phase are asserted together, in one place, because the screens ask
 * the same question the routes do — `loadOverview` runs these through
 * `scope.permits` to decide which controls to draw. Splitting the rule between
 * a route and a service would give the client and the server two different
 * answers to it, which is the drift `scope.permits` exists to prevent.
 */
function assertMayApprove(actor, project) {
  scope.assertCanApproveBudget(actor);
  if (project.phase_code === 'CLOSED') {
    throw HttpError.forbidden('โครงการปิดแล้ว ไม่สามารถแก้ไขวงเงินได้');
  }
  if (project.phase_ordinal < 3) {
    throw HttpError.badRequest(
      `อนุมัติวงเงินได้ตั้งแต่สถานะ "โครงการอนุมัติ" เป็นต้นไป (สถานะปัจจุบัน: ${project.phase_name_th})`
    );
  }
}

/** Money out needs the money approved first, which is what phase 4 means. */
function assertMayDisburse(actor, project) {
  scope.assertCanApproveBudget(actor);
  if (project.phase_code === 'CLOSED') {
    throw HttpError.forbidden('โครงการปิดแล้ว ไม่สามารถเบิกจ่ายเพิ่มได้');
  }
  if (project.phase_ordinal < 4) {
    throw HttpError.badRequest(
      `เบิกจ่ายได้ตั้งแต่สถานะ "เงินโครงการอนุมัติ" เป็นต้นไป (สถานะปัจจุบัน: ${project.phase_name_th})`
    );
  }
}

function assertVariant(variant) {
  const v = String(variant || '').toUpperCase();
  if (!VARIANTS.includes(v)) throw HttpError.notFound(`ไม่รู้จักชุดงบประมาณ ${variant} (มี: ${VARIANTS.join(', ')})`);
  return v;
}

/**
 * Replace one variant's lines wholesale.
 *
 * Delete-then-insert for the same reason as every other ordered child list
 * (`projectService.replaceSection`), and `ordinal` restarts inside each category
 * because that is the grain of `uq_budget_line` — and the grain the form prints
 * at: category A row 3 is a fixed box on กนศ.04, not the third row overall.
 */
async function replaceLines(actor, project, variantInput, body) {
  scope.assertCanEdit(actor, project);
  const variant = assertVariant(variantInput);
  const items = pickList(body, 'items', { max: 200 });
  const rows = items.map((item) => pickFields(item, LINE_FIELDS, { requireAll: true }));

  const perCategory = new Map();
  for (const row of rows) {
    const next = (perCategory.get(row.category) || 0) + 1;
    perCategory.set(row.category, next);
    row.ordinal = next;
  }

  return transaction(async (conn) => {
    await lockProject(conn, project.id);
    await conn.query('DELETE FROM budget_line WHERE project_id = ? AND variant = ?', [project.id, variant]);

    for (const row of rows) {
      const columns = ['project_id', 'variant', ...Object.keys(row)];
      await conn.query(
        `INSERT INTO budget_line (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        [project.id, variant, ...Object.keys(row).map((column) => row[column])]
      );
    }

    const { money, findings } = await evaluate(conn, project, ALL_PROJECT_LAYERS, { locking: true });
    const warnings = enforce(findings, writeBlocks(project.phase_ordinal));

    await recordEvent(conn, {
      projectId: project.id,
      type: 'EDITED',
      actorPersonId: actor.person.id,
      section: `budget:${variant.toLowerCase()}`,
      detail: { count: rows.length, requestedTotal: money.requestedTotal, actualTotal: money.actualTotal },
    });

    return { variant, count: rows.length, money: presentMoney(money), warnings };
  }, { retries: 2 });
}

/**
 * State the planned amount — the ceiling the lines are checked against.
 *
 * One plan line per project, enforced by `uq_plan_line_project` (Q27). The old
 * `netprojectbudget` joined on the project *name*, so two projects sharing a
 * name shared a budget, and renaming a project silently detached it from its
 * money.
 */
async function setPlan(actor, project, body) {
  scope.assertCanEdit(actor, project);
  const values = pickFields(body, {
    plannedAmount: ['planned_amount', check.decimal({ required: true })],
  }, { requireAll: true });

  return transaction(async (conn) => {
    await lockProject(conn, project.id);
    await conn.query(
      `INSERT INTO budget_plan_line (project_id, planned_amount) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE planned_amount = VALUES(planned_amount)`,
      [project.id, values.planned_amount]
    );

    const { money, findings } = await evaluate(conn, project, ALL_PROJECT_LAYERS, { locking: true });
    const warnings = enforce(findings, writeBlocks(project.phase_ordinal));

    await recordEvent(conn, {
      projectId: project.id,
      type: 'EDITED',
      actorPersonId: actor.person.id,
      section: 'budget:plan',
      detail: { plannedAmount: values.planned_amount },
    });

    return { money: presentMoney(money), warnings };
  }, { retries: 2 });
}

/**
 * Approve a project's money.
 *
 * This is the one write that consumes the club's allocation, so it is the one
 * that takes the allocation lock — and it takes it *first*, before the project
 * row, matching `phaseService`. Two approvals in the same club-year therefore
 * queue, and the second sees the first's committed amount because the sum is
 * read `FOR UPDATE` rather than from a snapshot fixed before the wait.
 *
 * Layer (c) is checked here rather than only at the `BUDGET_APPROVED`
 * transition: an approved amount is a commitment the moment it is written.
 */
async function approveAmount(actor, project, body) {
  assertMayApprove(actor, project);
  const values = pickFields(body, {
    approvedAmount: ['approved_amount', check.decimal({ required: true })],
  }, { requireAll: true });

  return transaction(async (conn) => {
    await lockAllocation(conn, project.club_id, project.academic_year);
    await lockProject(conn, project.id);

    const [[existing]] = await conn.query(
      'SELECT id FROM budget_plan_line WHERE project_id = ?',
      [project.id]
    );
    if (!existing) {
      throw HttpError.badRequest('ยังไม่ได้ระบุงบประมาณที่วางแผนไว้ของโครงการนี้');
    }

    await conn.query(
      `UPDATE budget_plan_line
          SET approved_amount = ?, approved_by = ?, approved_at = NOW()
        WHERE project_id = ?`,
      [values.approved_amount, actor.person.id, project.id]
    );

    const { money, allocation, committed, findings } = await evaluate(
      conn, project, [...ALL_PROJECT_LAYERS, 'c'], { locking: true, committing: true }
    );
    const warnings = enforce(findings, ['a', 'c']);

    await recordEvent(conn, {
      projectId: project.id,
      type: 'BUDGET_APPROVED',
      actorPersonId: actor.person.id,
      detail: { approvedAmount: values.approved_amount, clubYearCommitted: committed },
    });

    return { money: presentMoney(money, { allocation, committed }), warnings };
  }, { retries: 2 });
}

/**
 * Record money going out. Append-only — there is no update and no delete, so
 * `disbursed_total` is a sum over immutable rows and "remaining" is a
 * subtraction rather than a column anybody can write (Q28/Q41). The old
 * `logstudentgetmoney` stored `remainingBudget` per row and let the client
 * compute it, which is how a ledger stops adding up.
 *
 * Money out blocks immediately rather than at the next gate: paying past the
 * approved amount is not something to warn about and reconcile later.
 */
async function addDisbursement(actor, project, body) {
  assertMayDisburse(actor, project);
  const values = pickFields(body, DISBURSEMENT_FIELDS, { requireAll: true });

  return transaction(async (conn) => {
    await lockProject(conn, project.id);

    const columns = ['project_id', ...Object.keys(values)];
    await conn.query(
      `INSERT INTO disbursement (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      [project.id, ...Object.keys(values).map((column) => values[column])]
    );

    const { money, findings } = await evaluate(
      conn, project, ALL_PROJECT_LAYERS, { locking: true, committing: true }
    );
    const blocked = findings.filter(
      (f) => f.code === CODES.DISBURSED_OVER_APPROVED || f.code === CODES.APPROVED_AMOUNT_MISSING
    );
    if (blocked.length) {
      throw new HttpError(422, blocked[0].message, { budgetViolations: blocked });
    }
    const warnings = findings.filter((f) => !blocked.includes(f));

    await recordEvent(conn, {
      projectId: project.id,
      type: 'DISBURSED',
      actorPersonId: actor.person.id,
      detail: { amount: values.amount, disbursedTotal: money.disbursedTotal },
    });

    return { money: presentMoney(money), warnings };
  }, { retries: 2 });
}

module.exports = {
  CATEGORIES,
  CODES,
  LINE_FIELDS,
  TRANSITION_BLOCKS,
  VARIANTS,
  addDisbursement,
  approveAmount,
  assertMayApprove,
  assertMayDisburse,
  assertTransitionAllowed,
  evaluate,
  loadDisbursements,
  loadLines,
  loadOverview,
  loadSummary,
  lockAllocation,
  presentMoney,
  readCommitted,
  replaceLines,
  setPlan,
  transitionLocksAllocation,
  warningsFor,
  writeBlocks,
};
