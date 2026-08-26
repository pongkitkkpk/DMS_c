/**
 * `render.js` is where a payload actually becomes the `.docx` a club head
 * signs and a STUACT office files — the one place in `documents/` that is not
 * pure, so unlike `thai`/`arity`/`assembler` this exercises the real
 * docxtemplater engine against the real templates in `templates/`. Nothing is
 * mocked: a broken template placeholder, a wrong module option, or a payload
 * shape docxtemplater cannot bind would all be invisible to the pure-function
 * tests and would only ever surface here (or in production).
 */
const { render, FORMS } = require('./render');
const { HttpError } = require('../lib/httpError');

// The smallest valid PNG: an 8-byte signature, a 13-byte IHDR (1x1, 8-bit
// greyscale), and an IEND — the same shape `signatureService` would have
// already validated and staged before this layer ever sees it.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=',
  'base64'
);

function baseDocument(overrides = {}) {
  return {
    project: {
      id: 1,
      name: 'โครงการทดสอบการเรนเดอร์',
      club_name: 'ชมรมทดสอบ',
      advisor_name: 'อาจารย์ทดสอบ',
      contact1_name: null, contact1_phone: null, contact2_name: null, contact2_phone: null,
      event_start_on: '2024-06-01', event_end_on: '2024-06-02',
      prepare_start_on: null, prepare_end_on: null, report_due_on: null,
      is_new_project: 1, is_continue_project: 0,
      project_number: null, draft_sequence: 7,
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

const PK_MAGIC = Buffer.from('PK');

describe('render', () => {
  test('refuses an unknown form', () => {
    expect(() => render('temp99', baseDocument())).toThrow(HttpError);
  });

  test.each(Object.keys(FORMS))('renders %s for a minimal document into a real .docx (zip) buffer', (form) => {
    const result = render(form, baseDocument());

    expect(result.buffer.subarray(0, 2)).toEqual(PK_MAGIC);
    expect(result.form).toBe(FORMS[form]);
  });

  test('names the file after the draft sequence when no project number has been issued yet', () => {
    const result = render('temp04', baseDocument({ project: { project_number: null, draft_sequence: 7 } }));
    expect(result.filename).toBe('กนศ.04-ร่างที่7.docx');
  });

  test('names the file after the real project number once one has been issued', () => {
    const result = render('temp04', baseDocument({ project: { project_number: 'B690420100003' } }));
    expect(result.filename).toBe('กนศ.04-B690420100003.docx');
  });

  test('refuses to render a document that would silently truncate — arity is checked before the template runs', () => {
    // A project with more objectives than temp04's template can print. This is
    // the same refusal `arity.test.js` exercises directly; here it confirms
    // `render` actually calls it, ahead of ever opening the template.
    const objectives = Array.from({ length: 999 }, (_, i) => ({ content: `ข้อ ${i}` }));
    expect(() => render('temp04', baseDocument({ sections: { objectives } })))
      .toThrow(expect.objectContaining({ status: 422 }));
  });

  test('renders successfully with a real project number, budget lines, and sections filled in', () => {
    const doc = baseDocument({
      project: { project_number: 'B690420100003' },
      sections: {
        objectives: [{ content: 'เพื่อทดสอบระบบ' }],
        activities: [{ topic: 'เตรียมงาน', start_on: '2024-06-01', end_on: '2024-06-02', responsible: 'ประธาน' }],
      },
      budget: {
        lines: [], planned: [{ category: 'A', description: 'ค่าตอบแทน', unit_price: '500.00', amount: '500.00' }], actual: [],
        money: {
          plannedAmount: '500.00', approvedAmount: '500.00', requestedTotal: '500.00',
          actualTotal: '0.00', disbursedTotal: '0.00', remaining: '500.00', refundTotal: '500.00',
          approvedAt: '2026-01-01', allocation: null, clubYearCommitted: null, clubYearRemaining: null,
        },
      },
    });

    const result = render('temp04', doc);

    expect(result.buffer.length).toBeGreaterThan(0);
  });

  test('renders a signature image without throwing when one is present', () => {
    const doc = baseDocument({ signatures: { sh: TINY_PNG } });
    expect(() => render('temp04', doc)).not.toThrow();
  });
});
