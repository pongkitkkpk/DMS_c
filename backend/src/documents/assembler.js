/**
 * Domain objects → the flat payload the two government forms consume (Q4/Q7).
 *
 * The templates are treated as fixed inputs. Everything that makes them
 * awkward — 433 field names, a 15×12 Gantt expanded inline, the same value
 * wanted under two different roots in the two forms — is absorbed here so the
 * schema does not have to carry it. That is the whole point of the assembler:
 * `docs/schema-target.md` normalizes, and this file flattens.
 *
 * Which root owns which field is **not** guessed from naming. It was read off
 * the templates by walking their section stacks
 * (`scripts/extract-template-tags.js` → `docs/template-tags.json`), because a
 * field placed under the wrong root renders blank with no error at all — which
 * is exactly how กนศ.06's approved total has been printing empty for the life
 * of the old system.
 *
 * Nothing here is stored. Thai dates, month indices, subtotals, the spelled-out
 * amount and the whole `persen` object are computed on every render, from the
 * one value that *is* stored. The old schema kept all of them in columns and
 * they drifted (Q19).
 */
const { pool } = require('../db/pool');
const { satang, fromSatang } = require('../lib/money');
const { thaiDate, thaiYear, monthIndex, bahtText } = require('./thai');
const { LIMITS } = require('./arity');
const projects = require('../services/projectService');
const budgetService = require('../services/budgetService');

// --------------------------------------------------------------------------
// Formatting
// --------------------------------------------------------------------------

/** `"19200.00"` → `"19,200.00"`. Blank for absent, never `"NaN"` or `"null"`. */
function money(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * A quantity, not an amount: `2.00` prints as `2` and `2.50` as `2.5`.
 * "2.00 คน" on a form reads as a mistake, because it is not money.
 */
function quantity(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return String(Number(n.toFixed(2)));
}

/** Whatever it is, as a string the template can print. Never `undefined`. */
const text = (value) => (value === null || value === undefined ? '' : String(value));

/**
 * What the head of a student organisation is called, on both government forms.
 *
 * The owner's rule (2026-08-16): องค์การนักศึกษา and สโมสร are led by a นายก;
 * everything else — ชมรม, สภานักศึกษา, สมาคม — by a ประธาน. The organisation's
 * own name supplies the rest of the phrase, so this is only ever the first word:
 *
 *   ประธาน + ชมรมกรีฑา              -> ประธานชมรมกรีฑา
 *   ประธาน + สภานักศึกษา มจพ.กรุงเทพฯ -> ประธานสภานักศึกษา มจพ.กรุงเทพฯ
 *   นายก   + สโมสรคณะครุศาสตร์ฯ      -> นายกสโมสรคณะครุศาสตร์ฯ
 *   นายก   + องค์การนักศึกษา มจพ.ระยอง -> นายกองค์การนักศึกษา มจพ.ระยอง
 *
 * Until 2026-08-16 the word was literal text inside the templates — กนศ.04 said
 * `ประธานชมรม` — so all 47 clubs printed `ประธานชมรมชมรม…` and the other 22
 * organisations were called ชมรม when they are not one. `scripts/patch-head-
 * title.js` records that edit.
 *
 * Matched on the name because that is where the kind lives; `club_group` is the
 * jurisdiction (ฝ่ายกีฬา, ฝ่ายศิลปวัฒนธรรม) and says nothing about what the
 * organisation is. An unrecognised name gets ประธาน, which is the common case
 * and the safer wrong answer of the two.
 */
const NAYOK_PREFIXES = ['องค์การ', 'สโมสร'];
const clubHeadTitle = (clubName) =>
  NAYOK_PREFIXES.some((p) => String(clubName || '').startsWith(p)) ? 'นายก' : 'ประธาน';

/**
 * Fill `name1…nameN` from `rows`, applying `pick` to each.
 *
 * Every index up to the form's capacity is emitted, including the empty ones:
 * a template tag with no key behind it is a silent blank, and a payload that
 * only carries the rows that exist cannot be checked for completeness. The
 * acceptance run asserts that every tag in the contract has a key here.
 */
function indexed(prefix, capacity, rows, pick) {
  const out = {};
  for (let i = 1; i <= capacity; i++) {
    const row = rows[i - 1];
    out[`${prefix}${i}`] = row === undefined ? '' : pick(row, i);
  }
  return out;
}

// --------------------------------------------------------------------------
// Checkbox banks
// --------------------------------------------------------------------------

/**
 * `tag_set` code → the tag names the forms use, and how many there are.
 *
 * The counts are the seeded vocabularies (`db/seeds/reference.js`), and they
 * match the template's own banks exactly — 17 SDGs, 4 + 9 + 6 + 7 strategy
 * items, 5 sides, 4 graduate attributes, 4 follow-up methods. Every key is
 * emitted, `true` or `false`, so an unchecked box is unchecked rather than
 * merely absent.
 */
const TAG_BANKS = {
  SDG:    { count: 17, key: (n) => `is_SDGs_${n}`,   root: 'detail' },
  P5_1:   { count: 4,  key: (n) => `is_5p1_${n}`,    root: 'detail' },
  P5_2_1: { count: 9,  key: (n) => `is_5p2p1_${n}`,  root: 'detail' },
  P5_2_2: { count: 6,  key: (n) => `is_5p2p2_${n}`,  root: 'detail' },
  P5_2_3: { count: 7,  key: (n) => `is_5p2p3_${n}`,  root: 'detail' },
  SIDE:   { count: 5,  key: (n) => `is_${n}side`,    root: 'detail' },
  BASIC:  { count: 4,  key: (n) => `is_${n}basic`,   root: 'detail' },
  FOLLOW: { count: 4,  key: (n) => `is_${n}follow`,  root: 'indicator' },
};

function checkboxes(tags, root) {
  const chosen = new Set(tags.map((tag) => `${tag.tag_set_code}:${tag.ordinal}`));
  const out = {};
  for (const [code, bank] of Object.entries(TAG_BANKS)) {
    if (bank.root !== root) continue;
    for (let n = 1; n <= bank.count; n++) {
      out[bank.key(n)] = chosen.has(`${code}:${n}`);
    }
  }
  return out;
}

// --------------------------------------------------------------------------
// Loading
// --------------------------------------------------------------------------

/**
 * Everything the two forms need, in one place.
 *
 * The adviser's agency and the student head's title live on `membership` and
 * `person`, not on the project — the old system stored the adviser as free text
 * on the project row, which is how 12 of its 30 projects came to name a person
 * who did not exist.
 */
async function loadDocument(projectId, conn = pool) {
  const project = await projects.findProject(projectId, conn);
  if (!project) return null;

  const [sections, lines, disbursements, summary] = await Promise.all([
    projects.loadSections(projectId, conn),
    budgetService.loadLines(projectId, conn),
    budgetService.loadDisbursements(projectId, conn),
    budgetService.loadSummary(project),
  ]);

  // Correlated subqueries rather than a join: a person can hold more than one
  // membership, and a join would make which agency prints on the form depend on
  // row order. The adviser's agency is specifically their `AD` membership of
  // *this* club in *this* year — the same rule `assertAdvisorIsValid` enforces.
  const [people] = await conn.query(
    `SELECT p.id, p.prefix, p.full_name_th, p.phone,
            (SELECT m.advisor_agency FROM membership m
              WHERE m.person_id = p.id AND m.academic_year = ?
                AND m.role = 'AD' AND m.club_id = ? LIMIT 1) AS advisor_agency,
            (SELECT m.department_th FROM membership m
              WHERE m.person_id = p.id AND m.academic_year = ?
                AND m.department_th IS NOT NULL LIMIT 1) AS department_th
       FROM person p
      WHERE p.id IN (?, ?)`,
    [project.academic_year, project.club_id, project.academic_year,
      project.owner_person_id, project.advisor_person_id || 0]
  );
  const personById = new Map(people.map((row) => [row.id, row]));

  return {
    project,
    sections,
    owner: personById.get(project.owner_person_id) || null,
    advisor: project.advisor_person_id ? personById.get(project.advisor_person_id) || null : null,
    budget: {
      lines: [...lines.planned, ...lines.actual],
      planned: lines.planned,
      actual: lines.actual,
      money: summary.money,
    },
    disbursements,
  };
}

// --------------------------------------------------------------------------
// Roots
// --------------------------------------------------------------------------

/**
 * Attendance totals for one variant, as `person` / `Fperson`.
 *
 * `grandTypeETC` is the label of the OTHER rows — the form prints a
 * user-supplied category name beside its count. Several OTHER rows with
 * different labels collapse to a list, because the form has one slot and
 * dropping all but the first would be the same silent loss Q8 refuses.
 */
function attendanceRoot(rows, variant) {
  const of = (type) => rows
    .filter((row) => row.variant === variant && row.attendee_type === type)
    .reduce((total, row) => total + Number(row.headcount || 0), 0);

  const student = of('STUDENT');
  const professor = of('PROFESSOR');
  const executive = of('EXECUTIVE');
  const expert = of('EXPERT');
  const other = of('OTHER');

  const labels = [...new Set(rows
    .filter((row) => row.variant === variant && row.attendee_type === 'OTHER' && row.label)
    .map((row) => row.label))];

  return {
    grandTotalStudent: String(student),
    grandTotalProfessor: String(professor),
    grandTotalExecutive: String(executive),
    grandTotalExpert: String(expert),
    grandTotalETC: String(other),
    grandTotalAll: String(student + professor + executive + expert + other),
    grandTypeETC: labels.join(', '),
  };
}

/**
 * `persen` — the percentage column on กนศ.06, actual over planned.
 *
 * Defect 2 in `docs/template-contract.md`: the old render computed
 * `final / planned` on two `varchar(255)` columns with no guard, so a project
 * that planned nobody printed **`Infinity%`** and one with an empty count
 * printed **`NaN%`**. Both are on shipped documents.
 *
 * A percentage of nothing is not a number, and the honest cell is a dash. Zero
 * planned *and* zero actual is likewise a dash rather than `0%`, because `0%`
 * asserts a comparison that was never made.
 */
function percentRoot(person, fperson) {
  const out = {};
  for (const key of ['grandTotalStudent', 'grandTotalProfessor', 'grandTotalExecutive',
    'grandTotalExpert', 'grandTotalETC', 'grandTotalAll']) {
    const planned = Number(person[key]);
    const actual = Number(fperson[key]);
    out[key] = (!Number.isFinite(planned) || !Number.isFinite(actual) || planned <= 0)
      ? '—'
      : `${Math.round((actual / planned) * 100)}%`;
  }
  return out;
}

/** The Gantt and the step table. */
function timestepRoot(document, capacity) {
  const rows = document.sections.activities || [];
  const years = rows
    .flatMap((row) => [thaiYear(row.start_on), thaiYear(row.end_on)])
    .filter(Boolean)
    .sort();

  return {
    ...indexed('topic_table', capacity, rows, (row) => text(row.topic)),
    ...indexed('thaistart_duration_table', capacity, rows, (row) => thaiDate(row.start_on)),
    ...indexed('thaiend_duration_table', capacity, rows, (row) => thaiDate(row.end_on)),
    // `responsibleTable1str` — one word, the template's own spelling, and the
    // name its row guards compare against.
    ...Object.fromEntries(Object.entries(
      indexed('responsibleTable', capacity, rows, (row) => text(row.responsible))
    ).map(([key, value]) => [`${key}str`, value])),
    // Integers, never strings: angular-expressions compares `"10" <= 9` as true,
    // which shades the wrong cells (docs/template-contract.md, "The Gantt").
    ...indexed('startM', capacity, rows, (row) => monthIndex(row.start_on)),
    ...indexed('endM', capacity, rows, (row) => monthIndex(row.end_on)),
    // The old system initialised these to `false`/`""` and posted them
    // unchanged, so the Gantt's year header has always printed blank. Filling
    // it is deviation 36.
    start_inyear: years[0] || '',
    end_inyear: years[years.length - 1] || '',
    is_inyear: years.length > 0 && years[0] === years[years.length - 1],
  };
}

/** The budget grid for temp04, and its subtotals. */
function budgetRoot(document, limits) {
  const planned = document.budget.planned;
  const rowsOf = (category) => planned.filter((line) => line.category === category);

  const a = rowsOf('A');
  const bt = rowsOf('BT');
  const bnt = rowsOf('BNT');
  const c = rowsOf('C');

  const sum = (rows) => rows.reduce((total, row) => total + satang(row.amount), 0);
  const subtotalA = sum(a);
  const subtotalB = sum(bt) + sum(bnt);
  const subtotalC = sum(c);
  const grand = subtotalA + subtotalB + subtotalC;

  return {
    // A: the form prints "คน" and "ชั่วโมง" literally, which is why this
    // category has no unit-label columns at all.
    ...indexed('listA', limits.A, a, (row) => text(row.description)),
    ...indexed('listNA', limits.A, a, (row) => quantity(row.qty1)),
    ...indexed('listTA', limits.A, a, (row) => quantity(row.qty2)),
    ...indexed('listTPA', limits.A, a, (row) => money(row.unit_price)),
    ...indexed('listSA', limits.A, a, (row) => money(row.amount)),

    // BT carries two quantities and two unit labels. `listTNBT` is emitted
    // twice by the form — once as the unit, once in the "…ละ" phrase — from
    // this one field.
    ...indexed('listBT', limits.BT, bt, (row) => text(row.description)),
    ...indexed('listNBT', limits.BT, bt, (row) => quantity(row.qty1)),
    ...indexed('listNNBT', limits.BT, bt, (row) => text(row.unit1)),
    ...indexed('listTBT', limits.BT, bt, (row) => quantity(row.qty2)),
    ...indexed('listTNBT', limits.BT, bt, (row) => text(row.unit2)),
    ...indexed('listTPBT', limits.BT, bt, (row) => money(row.unit_price)),
    ...indexed('listSBT', limits.BT, bt, (row) => money(row.amount)),

    ...indexed('listBNT', limits.BNT, bnt, (row) => text(row.description)),
    ...indexed('listNBNT', limits.BNT, bnt, (row) => quantity(row.qty1)),
    ...indexed('listNNBNT', limits.BNT, bnt, (row) => text(row.unit1)),
    ...indexed('listTPBNT', limits.BNT, bnt, (row) => money(row.unit_price)),
    ...indexed('listSBNT', limits.BNT, bnt, (row) => money(row.amount)),

    ...indexed('listC', limits.C, c, (row) => text(row.description)),
    ...indexed('listNC', limits.C, c, (row) => quantity(row.qty1)),
    ...indexed('listNNC', limits.C, c, (row) => text(row.unit1)),
    ...indexed('listTPC', limits.C, c, (row) => money(row.unit_price)),
    ...indexed('listSC', limits.C, c, (row) => money(row.amount)),

    // Computed here, never stored. `listSSBT` and `listSSBNT` are columns in
    // the old database and tags in neither template — the form only ever prints
    // the combined ค่าใช้สอย subtotal.
    listSSA: money(fromSatang(subtotalA)),
    listSSB: money(fromSatang(subtotalB)),
    listSSC: money(fromSatang(subtotalC)),
    listSAll: money(fromSatang(grand)),
    thailistSAll: bahtText(fromSatang(grand)),
  };
}

/**
 * The people blocks. `detail.advisor_name` is separate from `user`.
 *
 * `clubHeadTitle` is deliberately *not* in here. In both templates the tag sits
 * outside `{#userSH}`, immediately before it, so it has to be a root of the
 * payload — put inside `userSH` it resolved to nothing and every signature line
 * rendered as a bare club name.
 */
function peopleRoots(document) {
  const { owner, advisor, project } = document;
  return {
    user: {
      prefix: text(advisor && advisor.prefix),
      AgencyAdvisor: text(advisor && (advisor.advisor_agency || advisor.department_th)),
      Phone: text(advisor && advisor.phone),
    },
    userSH: {
      prefix: text(owner && owner.prefix),
      name_student: text(owner && owner.full_name_th),
      clubName: text(project.club_name),
    },
  };
}

/** The fields both forms read from `detail`, plus temp04's extras. */
function detailRoot(document, form) {
  const { project, sections } = document;
  const limits = LIMITS[form].sections;
  const capacity = (name, fallback) => (limits[name] ? limits[name].capacity : fallback);

  const problems = sections.problems || [];
  const indicators = sections.indicators || [];

  const common = {
    project_name: text(project.name),
    responsible_agency: text(project.club_name),
    advisor_name: text(project.advisor_name),
    person1_name: text(project.contact1_name),
    person1_contact: text(project.contact1_phone),
    person2_name: text(project.contact2_name),
    person2_contact: text(project.contact2_phone),
    thaistart_event: thaiDate(project.event_start_on),
    thaiend_event: thaiDate(project.event_end_on),
    ...indexed('location', capacity('locations', 5), sections.locations || [], (row) => text(row.content)),
    ...indexed('problem', capacity('problems', 3), problems, (row) => text(row.problem)),
    // `result` shares `problem`'s arity and its rows: the form prints the
    // problem and the resolution side by side.
    ...indexed('result', capacity('problems', 3), problems, (row) => text(row.resolution)),
    ...checkboxes(sections.tags || [], 'detail'),
  };

  if (form === 'temp06') return common;

  return {
    ...common,
    thaistart_prepare: thaiDate(project.prepare_start_on),
    thaiend_prepare: thaiDate(project.prepare_end_on),
    thaideadline: thaiDate(project.report_due_on),
    is_newproject: Boolean(project.is_new_project),
    is_continueproject: Boolean(project.is_continue_project),
    ...indexed('objective', capacity('objectives', 5), sections.objectives || [], (row) => text(row.content)),
    ...indexed('principles_and_reasons', capacity('rationales', 5), sections.rationales || [], (row) => text(row.content)),
    ...indexed('project_type', capacity('types', 5), sections.types || [], (row) => text(row.content)),
    // temp04 reads the expected results from `detail`; temp06 reads the same
    // values from `indicator`. Both are supplied, from the one domain list.
    ...indexed('expresult', capacity('indicators', 5), indicators, (row) => text(row.expected_result)),
  };
}

function indicatorRoot(document, form) {
  const indicators = document.sections.indicators || [];
  const capacity = LIMITS[form].sections.indicators
    ? LIMITS[form].sections.indicators.capacity : 5;

  const base = {
    // `volume` has five columns in the database and **one** tag in the form.
    // Only the first is printable; `arity.js` is what refuses a project that
    // would lose the rest.
    volume1: text(indicators[0] && indicators[0].volume_target),
    ...checkboxes(document.sections.tags || [], 'indicator'),
    is_etcfollow: Boolean(indicators[0] && indicators[0].etc_follow),
    etcfollow: text(indicators[0] && indicators[0].etc_follow),
  };

  if (form === 'temp04') return base;
  return { ...base, ...indexed('expresult', capacity, indicators, (row) => text(row.expected_result)) };
}

// --------------------------------------------------------------------------
// The payloads
// --------------------------------------------------------------------------

/** กนศ.04 — the proposal. */
function buildTemp04(document) {
  const limits = LIMITS.temp04;
  const people = peopleRoots(document);

  return {
    detail: detailRoot(document, 'temp04'),
    person: attendanceRoot(document.sections.attendance || [], 'PLANNED'),
    timestep: timestepRoot(document, limits.sections.activities.capacity),
    indicator: indicatorRoot(document, 'temp04'),
    budget: budgetRoot(document, limits.budget),
    user: people.user,
    userSH: people.userSH,
    clubHeadTitle: clubHeadTitle(document.project.club_name),
  };
}

/**
 * กนศ.06 — the final report.
 *
 * Note `budget` *and* `Fbudget`. Defect 1 in `docs/template-contract.md`: the
 * template contains `{#budget}{listSAll}{/budget} บาท จากเงินเหลือจ่าย…` — the
 * sentence stating the approved total — and the old render passed `Fbudget`
 * only, so that amount has printed blank on **every** กนศ.06 ever produced.
 * The approved total is `budget`; the actual spend is `Fbudget`.
 */
function buildTemp06(document) {
  const attendance = document.sections.attendance || [];
  const person = attendanceRoot(attendance, 'PLANNED');
  const fperson = attendanceRoot(attendance, 'ACTUAL');
  const people = peopleRoots(document);
  const { money: figures, actual } = document.budget;

  const sum = (rows) => rows.reduce((total, row) => total + satang(row.amount), 0);
  const actualA = sum(actual.filter((r) => r.category === 'A'));
  const actualB = sum(actual.filter((r) => r.category === 'BT' || r.category === 'BNT'));
  const actualC = sum(actual.filter((r) => r.category === 'C'));

  return {
    detail: detailRoot(document, 'temp06'),
    person,
    Fperson: fperson,
    persen: percentRoot(person, fperson),
    indicator: indicatorRoot(document, 'temp06'),
    budget: { listSAll: money(figures.approvedAmount) },
    Fbudget: {
      listSSA: money(fromSatang(actualA)),
      listSSB: money(fromSatang(actualB)),
      listSSC: money(fromSatang(actualC)),
      listSAll: money(figures.actualTotal),
      // approved − actual, a subtraction over rows rather than a column (Q28).
      refundtotal: money(figures.refundTotal),
    },
    user: people.user,
    userSH: people.userSH,
    clubHeadTitle: clubHeadTitle(document.project.club_name),
  };
}

const BUILDERS = { temp04: buildTemp04, temp06: buildTemp06 };

/** The payload for one form. */
function build(form, document) {
  const builder = BUILDERS[form];
  if (!builder) throw new Error(`unknown form ${form}`);
  return builder(document);
}

module.exports = { loadDocument, build, buildTemp04, buildTemp06, money, quantity, TAG_BANKS };
