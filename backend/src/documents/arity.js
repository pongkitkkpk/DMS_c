/**
 * How many rows each form can actually print — and the refusal when a project
 * has more (Q8).
 *
 * The templates are fixed-arity by construction: their `{#…}` blocks are
 * scoping blocks, not loops, so `listBT1`…`listBT12` is the whole of the
 * ค่าใช้สอย table and there is no thirteenth box. The database is uncapped, which
 * is the right way round — but it means a project can hold rows the form has
 * nowhere to put.
 *
 * **The old system truncated silently.** `p_budget` stores 20 `BT` rows; temp04
 * prints 12; nothing anywhere noticed the missing eight. That is a live
 * data-loss path on a document a government office acts on, and Q8 exists for
 * it: the database stays uncapped and the assembler *errors*, naming the
 * category and the limit.
 *
 * The limits are **read from the extracted tag inventory**, not typed in here.
 * `docs/template-tags.json` is generated from the `.docx` files themselves by
 * `scripts/extract-template-tags.js`, so replacing a template and re-running
 * the extraction moves these limits with it. A number copied by hand would not
 * move, and would be wrong in exactly the silent way this file exists to stop.
 */
const inventory = require('../../../docs/template-tags.json');
const { HttpError } = require('../lib/httpError');

/** `family stem in the template` → `what the domain calls that list`. */
const FAMILIES = {
  temp04: {
    objective: { label: 'วัตถุประสงค์', section: 'objectives' },
    principles_and_reasons: { label: 'หลักการและเหตุผล', section: 'rationales' },
    location: { label: 'สถานที่', section: 'locations' },
    project_type: { label: 'ลักษณะโครงการ', section: 'types' },
    problem: { label: 'ปัญหาและการแก้ไข', section: 'problems' },
    topic_table: { label: 'ขั้นตอนการดำเนินงาน', section: 'activities' },
    expresult: { label: 'ตัวชี้วัด', section: 'indicators' },
    listA: { label: 'หมวดค่าตอบแทน', budgetCategory: 'A' },
    listBT: { label: 'หมวดค่าใช้สอย (สองหน่วยนับ)', budgetCategory: 'BT' },
    listBNT: { label: 'หมวดค่าใช้สอย (หน่วยนับเดียว)', budgetCategory: 'BNT' },
    listC: { label: 'หมวดค่าวัสดุ', budgetCategory: 'C' },
  },
  temp06: {
    location: { label: 'สถานที่', section: 'locations' },
    problem: { label: 'ปัญหาและการแก้ไข', section: 'problems' },
    expresult: { label: 'ตัวชี้วัด', section: 'indicators' },
  },
};

/**
 * `ETC` is in neither template — `listETC`/`listSETC` are in the old database
 * and in the old entry UI, and print nowhere (`docs/template-contract.md`,
 * "Dead budget fields"). Capacity zero rather than absent, so a project that
 * has one is refused with an explanation instead of quietly printing a grand
 * total that does not match the rows above it.
 */
const UNPRINTABLE_BUDGET_CATEGORIES = { ETC: 'หมวดอื่น ๆ' };

/** The capacity the extraction found for one family, or 0 if it has no tags. */
function capacityOf(form, stem) {
  const found = inventory[form].families.find((f) => f.stem === stem);
  return found ? found.max : 0;
}

/** `{ [section|category]: limit }` for one form, built from the inventory. */
function limitsFor(form) {
  const out = { sections: {}, budget: { ...Object.fromEntries(
    Object.keys(UNPRINTABLE_BUDGET_CATEGORIES).map((code) => [code, 0])
  ) } };
  for (const [stem, spec] of Object.entries(FAMILIES[form])) {
    const capacity = capacityOf(form, stem);
    if (spec.section) out.sections[spec.section] = { capacity, label: spec.label, stem };
    if (spec.budgetCategory) out.budget[spec.budgetCategory] = capacity;
  }
  return out;
}

const LIMITS = { temp04: limitsFor('temp04'), temp06: limitsFor('temp06') };

/** Human label for a budget category, printable or not. */
function categoryLabel(form, code) {
  if (UNPRINTABLE_BUDGET_CATEGORIES[code]) return UNPRINTABLE_BUDGET_CATEGORIES[code];
  const spec = Object.values(FAMILIES[form]).find((f) => f.budgetCategory === code);
  return spec ? spec.label : code;
}

/**
 * Everything about `document` that this form cannot print.
 *
 * Returns findings rather than throwing, for the same reason the budget checks
 * do: a screen wants to show all of them at once, and the caller decides
 * whether this is a refusal or a warning.
 */
function overCapacity(form, document) {
  const limits = LIMITS[form];
  const findings = [];

  for (const [section, { capacity, label }] of Object.entries(limits.sections)) {
    const rows = (document.sections[section] || []).length;
    if (rows > capacity) {
      findings.push({
        kind: 'section',
        name: section,
        label,
        rows,
        capacity,
        message: `${label}: มี ${rows} รายการ แต่แบบฟอร์มพิมพ์ได้ ${capacity} รายการ`,
      });
    }
  }

  const planned = document.budget.lines.filter((line) => line.variant === 'PLANNED');
  const byCategory = new Map();
  for (const line of planned) {
    byCategory.set(line.category, (byCategory.get(line.category) || 0) + 1);
  }
  for (const [code, rows] of byCategory) {
    const capacity = limits.budget[code];
    if (capacity === undefined || rows <= capacity) continue;
    const label = categoryLabel(form, code);
    findings.push({
      kind: 'budget',
      name: code,
      label,
      rows,
      capacity,
      message: capacity === 0
        ? `${label}: มี ${rows} รายการ แต่แบบฟอร์มไม่มีช่องสำหรับหมวดนี้เลย`
        : `${label}: มี ${rows} รายการ แต่แบบฟอร์มพิมพ์ได้ ${capacity} รายการ`,
    });
  }

  return findings;
}

/**
 * Refuse rather than truncate.
 *
 * 422 for the same reason a budget violation is: the request was well formed
 * and the caller was entitled to make it — the document is what cannot be
 * produced. `documentViolations` carries every one, so a project that is over
 * on three categories learns about three, not about the first.
 */
function assertPrintable(form, document) {
  const findings = overCapacity(form, document);
  if (!findings.length) return;
  throw new HttpError(
    422,
    `เอกสารนี้พิมพ์ไม่ได้: ${findings[0].message}`,
    { documentViolations: findings }
  );
}

module.exports = { LIMITS, FAMILIES, UNPRINTABLE_BUDGET_CATEGORIES, overCapacity, assertPrintable, categoryLabel };
