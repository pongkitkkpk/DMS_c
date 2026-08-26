/**
 * `assembler.js` turns a loaded project into the flat payload the two
 * government-form templates read. `docs/template-contract.md` documents real
 * defects that shipped on produced documents — `Infinity%`/`NaN%` on กนศ.06's
 * percentage column, the approved total printing blank on every กนศ.06 ever
 * produced — and this file is what replaced them. `build`/`buildTemp04`/
 * `buildTemp06` take a plain `document` object, so these are pure unit tests
 * against a synthetic one; no database is touched (`loadDocument`, the one
 * function that queries, is not exercised here).
 */
const { build, buildTemp04, buildTemp06, money, quantity } = require('./assembler');
const { LIMITS } = require('./arity');

function baseDocument(overrides = {}) {
  return {
    project: {
      name: 'โครงการทดสอบ',
      club_name: 'ชมรมทดสอบ',
      advisor_name: 'อาจารย์ทดสอบ',
      contact1_name: null,
      contact1_phone: null,
      contact2_name: null,
      contact2_phone: null,
      event_start_on: '2024-06-01',
      event_end_on: '2024-06-02',
      prepare_start_on: null,
      prepare_end_on: null,
      report_due_on: null,
      is_new_project: 1,
      is_continue_project: 0,
      ...overrides.project,
    },
    sections: {
      objectives: [], rationales: [], locations: [], types: [], problems: [],
      activities: [], indicators: [], attendance: [], tags: [],
      ...overrides.sections,
    },
    owner: null,
    advisor: null,
    budget: {
      lines: [], planned: [], actual: [],
      money: {
        plannedAmount: '0.00', approvedAmount: null, requestedTotal: '0.00',
        actualTotal: '0.00', disbursedTotal: '0.00', remaining: null, refundTotal: null,
        approvedAt: null, allocation: null, clubYearCommitted: null, clubYearRemaining: null,
      },
      ...overrides.budget,
    },
    disbursements: [],
    signatures: {},
    ...overrides,
  };
}

describe('money / quantity', () => {
  test('money formats with a thousands separator and two decimals, blank for absent', () => {
    expect(money('19200')).toBe('19,200.00');
    expect(money(null)).toBe('');
    expect(money('not-a-number')).toBe('');
  });

  test('quantity drops a bare .00 but keeps a real fraction — it is a count, not money', () => {
    expect(quantity('2.00')).toBe('2');
    expect(quantity('2.50')).toBe('2.5');
    expect(quantity(null)).toBe('');
  });
});

describe('clubHeadTitle (via buildTemp04)', () => {
  test.each([
    ['ชมรมกรีฑา', 'ประธาน'],
    ['สภานักศึกษา มจพ.กรุงเทพฯ', 'ประธาน'],
    ['สโมสรคณะครุศาสตร์อุตสาหกรรม', 'นายก'],
    ['องค์การนักศึกษา มจพ.ระยอง', 'นายก'],
  ])('%s -> %s', (clubName, expected) => {
    const doc = baseDocument({ project: { club_name: clubName } });
    expect(buildTemp04(doc).clubHeadTitle).toBe(expected);
  });
});

describe('percentRoot (via buildTemp06.persen)', () => {
  test('zero planned is a dash, never Infinity% or NaN%', () => {
    const doc = baseDocument({
      sections: { attendance: [{ variant: 'ACTUAL', attendee_type: 'STUDENT', headcount: 5 }] },
    });
    expect(buildTemp06(doc).persen.grandTotalStudent).toBe('—');
  });

  test('zero planned and zero actual is also a dash, not 0%', () => {
    const doc = baseDocument();
    expect(buildTemp06(doc).persen.grandTotalStudent).toBe('—');
  });

  test('a real ratio rounds to the nearest percent', () => {
    const doc = baseDocument({
      sections: {
        attendance: [
          { variant: 'PLANNED', attendee_type: 'STUDENT', headcount: 40 },
          { variant: 'ACTUAL', attendee_type: 'STUDENT', headcount: 30 },
        ],
      },
    });
    expect(buildTemp06(doc).persen.grandTotalStudent).toBe('75%');
  });
});

describe('attendanceRoot (via person/Fperson)', () => {
  test('sums headcount per attendee type and grand-totals across all of them', () => {
    const doc = baseDocument({
      sections: {
        attendance: [
          { variant: 'PLANNED', attendee_type: 'STUDENT', headcount: 10 },
          { variant: 'PLANNED', attendee_type: 'STUDENT', headcount: 5 },
          { variant: 'PLANNED', attendee_type: 'PROFESSOR', headcount: 2 },
          { variant: 'ACTUAL', attendee_type: 'STUDENT', headcount: 999 }, // wrong variant, must not count
        ],
      },
    });
    const person = buildTemp04(doc).person;
    expect(person.grandTotalStudent).toBe('15');
    expect(person.grandTotalProfessor).toBe('2');
    expect(person.grandTotalAll).toBe('17');
  });

  test('collects distinct OTHER labels rather than dropping all but the first', () => {
    const doc = baseDocument({
      sections: {
        attendance: [
          { variant: 'PLANNED', attendee_type: 'OTHER', headcount: 3, label: 'ผู้ปกครอง' },
          { variant: 'PLANNED', attendee_type: 'OTHER', headcount: 2, label: 'ชุมชน' },
          { variant: 'PLANNED', attendee_type: 'OTHER', headcount: 1, label: 'ชุมชน' }, // duplicate label
        ],
      },
    });
    const person = buildTemp04(doc).person;
    expect(person.grandTotalETC).toBe('6');
    expect(person.grandTypeETC).toBe('ผู้ปกครอง, ชุมชน');
  });
});

describe('indexed section fields fill every capacity slot, blank past the real rows', () => {
  test('temp04’s objectives are padded to the template’s full capacity', () => {
    const capacity = LIMITS.temp04.sections.objectives.capacity;
    const doc = baseDocument({ sections: { objectives: [{ content: 'หนึ่ง' }] } });

    const detail = buildTemp04(doc).detail;

    expect(detail.objective1).toBe('หนึ่ง');
    expect(detail.objective2).toBe('');
    expect(detail[`objective${capacity}`]).toBe('');
    expect(detail[`objective${capacity + 1}`]).toBeUndefined();
  });
});

describe('checkboxes', () => {
  test('marks only the chosen tag true, everything else in the bank false', () => {
    const doc = baseDocument({
      sections: { tags: [{ tag_set_code: 'SDG', ordinal: 3 }] },
    });
    const detail = buildTemp04(doc).detail;
    expect(detail.is_SDGs_3).toBe(true);
    expect(detail.is_SDGs_1).toBe(false);
    expect(detail.is_SDGs_17).toBe(false);
  });
});

describe('buildTemp06 — the approved-vs-actual defect this file fixes', () => {
  test('budget.listSAll (approved) and Fbudget.listSAll (actual) are both populated, from different figures', () => {
    // The old render passed only `Fbudget`, so the sentence naming the
    // approved total printed blank on every กนศ.06 ever produced.
    const doc = baseDocument({
      budget: {
        lines: [], planned: [], actual: [],
        money: {
          plannedAmount: '10000.00', approvedAmount: '9500.00', requestedTotal: '10000.00',
          actualTotal: '8000.00', disbursedTotal: '8000.00', remaining: '1500.00',
          refundTotal: '1500.00', approvedAt: '2026-01-01', allocation: null,
          clubYearCommitted: null, clubYearRemaining: null,
        },
      },
    });

    const payload = buildTemp06(doc);

    expect(payload.budget.listSAll).toBe('9,500.00');
    expect(payload.Fbudget.listSAll).toBe('8,000.00');
    expect(payload.Fbudget.refundtotal).toBe('1,500.00');
  });

  test('temp06’s detail root omits temp04-only fields like prepare dates and is_newproject', () => {
    const doc = baseDocument();
    const detail = buildTemp06(doc).detail;
    expect(detail.thaistart_prepare).toBeUndefined();
    expect(detail.is_newproject).toBeUndefined();
  });
});

describe('build', () => {
  test('dispatches to the right form and throws for an unknown one', () => {
    const doc = baseDocument();
    expect(build('temp04', doc)).toEqual(buildTemp04(doc));
    expect(() => build('temp99', doc)).toThrow(/unknown form/);
  });
});
