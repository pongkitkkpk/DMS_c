/**
 * The ประวัติ card — the project's record, as a reader sees it.
 *
 * Two things it got wrong until 2026-08-18, both of which needed somebody to
 * open the page to notice:
 *
 * 1. Deleting a file wrote no event at all, so the record showed three
 *    attachments added and said nothing about the one that had gone.
 * 2. `detail` had been on the wire since the endpoint was written and nothing
 *    read it, so three uploads printed as three identical lines.
 *
 * The child cards are stubbed: this is a test about the timeline, and the cards
 * have their own.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';

import ProjectPage from './ProjectPage';
import { api } from '../api';

jest.mock('../api', () => ({
  api: {
    getProject: jest.fn(),
    events: jest.fn(),
    phases: jest.fn(),
    transition: jest.fn(),
    deleteProject: jest.fn(),
  },
  messageOf: () => 'error',
}));

jest.mock('../components/AttachmentsCard', () => () => <div data-testid="attachments" />);
jest.mock('../components/DocumentsCard', () => () => <div data-testid="documents" />);
jest.mock('../components/BudgetPanel', () => () => <div data-testid="budget" />);

const mockSwalFire = jest.fn();
jest.mock('sweetalert2', () => ({
  __esModule: true,
  default: { fire: (...args) => mockSwalFire(...args) },
}));

/** Trimmed from a real `GET /api/projects/1`, keeping every key the page reads. */
const project = {
  id: 1,
  name: 'โครงการตัวอย่าง — ร่างคำขออนุมัติ',
  academicYear: 2567,
  academicTerm: null,
  draftSequence: 1,
  projectSequence: null,
  projectNumber: null,
  phase: { id: 1, code: 'DRAFT_PROPOSAL', ordinal: 1, nameTh: 'ร่างคำขออนุมัติ' },
  club: { id: 28, code: 'A201', nameTh: 'ชมรมพุทธศาสน์' },
  owner: { id: 1, nameTh: 'สมชาย นักศึกษา', idStudent: 'fixture.student' },
  advisor: { id: 2, nameTh: 'สมหญิง ที่ปรึกษา' },
  isNewProject: 1,
  isContinueProject: 0,
  prepareStartOn: '2024-06-01',
  prepareEndOn: '2024-06-15',
  eventStartOn: '2024-07-01',
  eventEndOn: '2024-07-03',
  reportDueOn: null,
  contacts: [],
  createdAt: '2026-08-18 21:10:00',
  updatedAt: '2026-08-18 21:13:00',
  sections: {
    objectives: [], rationales: [], locations: [], types: [], problems: [],
    activities: [], indicators: [], attendance: [], tags: [],
  },
  budget: {
    plannedAmount: '19200.00', requestedTotal: '19200.00', approvedAmount: null,
    disbursedTotal: '0.00', actualTotal: '0.00', remaining: null, refundTotal: null,
    approvedAt: null, allocation: '500000.00', lines: [],
  },
  budgetWarnings: [],
  transitions: [],
  permissions: { edit: true, delete: false },
};

const event = (id, type, detail, extra = {}) => ({
  id,
  event_type: type,
  edited_section: null,
  detail,
  occurred_at: '2026-08-18 21:10:00',
  from_phase_code: null,
  from_phase_name_th: null,
  to_phase_code: null,
  to_phase_name_th: null,
  actor_name: 'สมชาย นักศึกษา',
  actor_id_student: 'fixture.student',
  ...extra,
});

const show = () => render(
  <MemoryRouter initialEntries={['/projects/1']}>
    <Route path="/projects/:id"><ProjectPage /></Route>
  </MemoryRouter>
);

beforeEach(() => {
  jest.clearAllMocks();
  api.getProject.mockResolvedValue(project);
  api.phases.mockResolvedValue({ phases: [{ code: 'DRAFT_PROPOSAL', ordinal: 1, name_th: 'ร่างคำขออนุมัติ' }] });
});

it('says a file was deleted, and which one', async () => {
  api.events.mockResolvedValue({
    events: [
      event(1, 'ATTACHMENT_ADDED', { originalName: 'รายงานการประชุม.pdf', byteSize: 69 }),
      event(2, 'ATTACHMENT_REMOVED', { originalName: 'รายงานการประชุม.pdf', byteSize: 69 }),
    ],
  });

  show();

  expect(await screen.findByText('แนบไฟล์')).toBeInTheDocument();
  expect(screen.getByText('ลบไฟล์แนบ')).toBeInTheDocument();
  // Twice: once for the upload, once for the deletion. Without the name the two
  // lines say only that some file arrived and some file left.
  expect(screen.getAllByText(/รายงานการประชุม\.pdf/)).toHaveLength(2);
});

it('tells three uploads apart', async () => {
  api.events.mockResolvedValue({
    events: [
      event(1, 'ATTACHMENT_ADDED', { originalName: 'ก.pdf' }),
      event(2, 'ATTACHMENT_ADDED', { originalName: 'ข.pdf' }),
      event(3, 'ATTACHMENT_ADDED', { originalName: 'ค.pdf' }),
    ],
  });

  show();

  expect(await screen.findByText(/ก\.pdf/)).toBeInTheDocument();
  expect(screen.getByText(/ข\.pdf/)).toBeInTheDocument();
  expect(screen.getByText(/ค\.pdf/)).toBeInTheDocument();
});

it('prints no subject for events that have another kind of detail', async () => {
  // `EDITED` stores `{ fields: [...] }` and `{ count: n }`. Neither is a name,
  // and a timeline that printed them would be worse than one that did not.
  api.events.mockResolvedValue({
    events: [
      event(1, 'EDITED', { fields: ['name'] }, { edited_section: 'rationales' }),
      event(2, 'EDITED', { count: 3 }),
    ],
  });

  show();

  expect(await screen.findByText(/แก้ไขข้อมูล \(หลักการและเหตุผล\)/)).toBeInTheDocument();
  expect(screen.queryByText(/fields|count|\[object Object\]/)).not.toBeInTheDocument();
});

it('survives a detail that arrives as JSON text rather than an object', async () => {
  // MariaDB's JSON is LONGTEXT with a CHECK, so the driver returns a string
  // unless the server parses it. It does — but a driver or engine change is
  // exactly the kind of thing that would put the string back, and a card that
  // throws would take the whole page down with it.
  api.events.mockResolvedValue({
    events: [event(1, 'ATTACHMENT_REMOVED', '{"originalName":"ง.pdf"}')],
  });

  show();

  expect(await screen.findByText('ลบไฟล์แนบ')).toBeInTheDocument();
  expect(screen.queryByText(/originalName/)).not.toBeInTheDocument();
});
