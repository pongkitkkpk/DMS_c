/**
 * `arity.js` replaces a real data-loss bug: the old system stored 20 `BT`
 * budget rows and its template printed 12, and nothing anywhere noticed the
 * missing eight. This file reads the printable capacity straight out of
 * `docs/template-tags.json` (generated from the real `.docx` templates), so
 * these tests read the same capacities rather than hardcoding numbers that
 * would silently drift out of sync with the templates the way a copied-by-hand
 * limit would.
 */
const { LIMITS, overCapacity, assertPrintable, categoryLabel } = require('./arity');
const { HttpError } = require('../lib/httpError');

function emptyDocument(form) {
  return {
    sections: Object.fromEntries(Object.keys(LIMITS[form].sections).map((name) => [name, []])),
    budget: { lines: [] },
  };
}

function fillSection(document, section, count) {
  document.sections[section] = Array.from({ length: count }, (_, i) => ({ id: i }));
}

function addBudgetLines(document, category, count, variant = 'PLANNED') {
  for (let i = 0; i < count; i++) document.budget.lines.push({ category, variant });
}

describe('overCapacity — sections', () => {
  test('no finding when every section is exactly at its printed capacity', () => {
    const doc = emptyDocument('temp04');
    for (const [section, { capacity }] of Object.entries(LIMITS.temp04.sections)) {
      fillSection(doc, section, capacity);
    }
    expect(overCapacity('temp04', doc)).toEqual([]);
  });

  test('flags a section one row past its printed capacity, and only that one', () => {
    const doc = emptyDocument('temp04');
    const [section, { capacity, label }] = Object.entries(LIMITS.temp04.sections)[0];
    fillSection(doc, section, capacity + 1);

    const findings = overCapacity('temp04', doc);

    expect(findings).toEqual([
      expect.objectContaining({ kind: 'section', name: section, label, rows: capacity + 1, capacity }),
    ]);
  });

  test('temp06 only knows its own three sections, not temp04’s full set', () => {
    expect(Object.keys(LIMITS.temp06.sections).sort()).toEqual(
      ['locations', 'problems', 'indicators'].sort()
    );
  });
});

describe('overCapacity — budget categories', () => {
  test('only PLANNED lines count against the printed capacity — ACTUAL does not', () => {
    const doc = emptyDocument('temp04');
    const capacity = LIMITS.temp04.budget.A;
    addBudgetLines(doc, 'A', capacity + 5, 'ACTUAL');

    expect(overCapacity('temp04', doc)).toEqual([]);
  });

  test('flags a budget category over its printed capacity', () => {
    const doc = emptyDocument('temp04');
    const capacity = LIMITS.temp04.budget.A;
    addBudgetLines(doc, 'A', capacity + 1);

    const findings = overCapacity('temp04', doc);

    expect(findings).toEqual([
      expect.objectContaining({ kind: 'budget', name: 'A', rows: capacity + 1, capacity }),
    ]);
  });

  test('ETC has zero printable capacity — a single line is already over, with its own message', () => {
    const doc = emptyDocument('temp04');
    addBudgetLines(doc, 'ETC', 1);

    const findings = overCapacity('temp04', doc);

    expect(findings).toEqual([
      expect.objectContaining({ kind: 'budget', name: 'ETC', rows: 1, capacity: 0 }),
    ]);
    expect(findings[0].message).toContain('ไม่มีช่องสำหรับหมวดนี้เลย');
  });

  test('reports every category over capacity, not just the first', () => {
    const doc = emptyDocument('temp04');
    addBudgetLines(doc, 'A', LIMITS.temp04.budget.A + 1);
    addBudgetLines(doc, 'C', LIMITS.temp04.budget.C + 1);

    const findings = overCapacity('temp04', doc);

    expect(findings.map((f) => f.name).sort()).toEqual(['A', 'C']);
  });
});

describe('assertPrintable', () => {
  test('does not throw when the document fits', () => {
    expect(() => assertPrintable('temp04', emptyDocument('temp04'))).not.toThrow();
  });

  test('refuses with 422, naming the first violation in the message and carrying every one', () => {
    const doc = emptyDocument('temp04');
    const [firstSection, { capacity: firstCapacity }] = Object.entries(LIMITS.temp04.sections)[0];
    fillSection(doc, firstSection, firstCapacity + 1);
    addBudgetLines(doc, 'ETC', 1);

    let caught;
    try {
      assertPrintable('temp04', doc);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(HttpError);
    expect(caught.status).toBe(422);
    expect(caught.detail.documentViolations).toHaveLength(2);
    // Sections are evaluated before budget categories, so the section
    // violation is `documentViolations[0]` and its message is what the
    // top-level refusal quotes.
    expect(caught.message).toBe(`เอกสารนี้พิมพ์ไม่ได้: ${caught.detail.documentViolations[0].message}`);
  });
});

describe('categoryLabel', () => {
  test('labels a printable category from the template family', () => {
    expect(categoryLabel('temp04', 'A')).toBe('หมวดค่าตอบแทน');
  });

  test('labels ETC as unprintable rather than a template family', () => {
    expect(categoryLabel('temp04', 'ETC')).toBe('หมวดอื่น ๆ');
  });

  test('falls back to the raw code for anything neither list knows', () => {
    expect(categoryLabel('temp04', 'ZZZ')).toBe('ZZZ');
  });
});
