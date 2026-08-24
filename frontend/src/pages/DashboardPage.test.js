/**
 * The overview page — phase tiles, the allocation table, and the two loud
 * banners (Q33's over-commitment, and year readiness) that only an Admin or
 * STUACT ever sees the button half of.
 *
 * The Excel export itself has its own unit tests
 * (`utils/exportDashboardExcel.test.js`); this file only checks that the
 * button hands it exactly what the page already rendered, scoped the same
 * way for every role.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route } from 'react-router-dom';

import DashboardPage from './DashboardPage';
import { api } from '../api';

jest.mock('../api', () => ({
  api: {
    listProjects: jest.fn(),
    allocations: jest.fn(),
    phases: jest.fn(),
    clubs: jest.fn(),
    readiness: jest.fn(),
    setAllocation: jest.fn(),
  },
  messageOf: () => 'error',
}));

const mockDownload = jest.fn();
jest.mock('../utils/exportDashboardExcel', () => ({
  downloadDashboardExcel: (...args) => mockDownload(...args),
}));

const mockSwalFire = jest.fn();
jest.mock('sweetalert2', () => ({
  __esModule: true,
  default: { fire: (...args) => mockSwalFire(...args) },
}));

const autoConfirm = (amount = '12345') => mockSwalFire.mockImplementation((opts) => (
  Promise.resolve(opts.input === 'text' ? { isConfirmed: true, value: amount } : { isConfirmed: true })
));

const phases = [
  { code: 'DRAFT_PROPOSAL', ordinal: 1, name_th: 'ร่างคำขออนุมัติ' },
  { code: 'APPROVED', ordinal: 2, name_th: 'โครงการอนุมัติ' },
];

const project = (id, phaseCode) => ({
  id, phase: { code: phaseCode }, club: { id: 1 },
});

const allocation = (overrides = {}) => ({
  id: 1,
  club: { id: 28, code: 'A201', nameTh: 'ชมรมพุทธศาสน์' },
  campus: { nameTh: 'มจพ. กรุงเทพฯ' },
  amount: '500000.00',
  committed: '96000.00',
  remaining: '404000.00',
  overCommitted: false,
  ...overrides,
});

function stubApi({ role }) {
  api.listProjects.mockResolvedValue({
    total: 2,
    items: [project(1, 'DRAFT_PROPOSAL'), project(2, 'APPROVED')],
  });
  api.allocations.mockResolvedValue({ items: [allocation()], overCommitted: [] });
  api.phases.mockResolvedValue({ phases });
  api.clubs.mockResolvedValue({
    clubs: role === 'ADMIN' || role === 'STUACT'
      ? [{ id: 28, code: 'A201', nameTh: 'ชมรมพุทธศาสน์' }, { id: 29, code: 'A202', nameTh: 'ชมรมมุสลิม', campusName: 'มจพ. กรุงเทพฯ' }]
      : [],
  });
  api.readiness.mockResolvedValue(null);
}

const session = (role) => ({
  role,
  academicYear: 2567,
  membership: role === 'STUACT' ? { club_group_name: 'กรุงเทพฯ' } : null,
});

let mockSession = null;
jest.mock('../AuthContext', () => ({ useAuth: () => ({ session: mockSession }) }));

const show = (role) => {
  mockSession = session(role);
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Route path="/dashboard"><DashboardPage /></Route>
    </MemoryRouter>
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  autoConfirm();
  api.setAllocation.mockResolvedValue({ warnings: [] });
});

it('counts projects per phase, including a phase with zero', async () => {
  stubApi({ role: 'ADMIN' });
  show('ADMIN');

  expect(await screen.findByText('1. ร่างคำขออนุมัติ')).toBeInTheDocument();
  const tiles = screen.getAllByText('1');
  expect(tiles.length).toBeGreaterThanOrEqual(2); // one project each in the two phases above
});

it('lets ADMIN edit an allocation and see the export button', async () => {
  stubApi({ role: 'ADMIN' });
  show('ADMIN');

  expect(await screen.findByText(/แก้ไขได้/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /แก้ไขวงเงินจัดสรรของ ชมรมพุทธศาสน์/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'ดาวน์โหลด Excel' })).toBeInTheDocument();
});

it('actually saves an allocation edit from the dashboard table, not just the button', async () => {
  stubApi({ role: 'ADMIN' });
  show('ADMIN');

  const edit = await screen.findByRole('button', { name: /แก้ไขวงเงินจัดสรรของ ชมรมพุทธศาสน์/ });
  await userEvent.click(edit);

  await waitFor(() => expect(api.setAllocation).toHaveBeenCalledWith({
    clubId: 28, academicYear: 2567, amount: '12345',
  }));
  // A successful save reloads the page (api.allocations again) — wait for
  // that second fetch to settle too, or its state updates land after the
  // test (and its render tree) is already gone.
  await waitFor(() => expect(api.allocations).toHaveBeenCalledTimes(2));
});

it('gives SH a read-only table but still the export button', async () => {
  stubApi({ role: 'SH' });
  show('SH');

  expect(await screen.findByText(/อ่านอย่างเดียว/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /แก้ไขวงเงินจัดสรรของ/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'ดาวน์โหลด Excel' })).toBeInTheDocument();
});

it('hands the export exactly what the page rendered, scoped to the caller', async () => {
  stubApi({ role: 'STUACT' });
  show('STUACT');

  const button = await screen.findByRole('button', { name: 'ดาวน์โหลด Excel' });
  await userEvent.click(button);

  expect(mockDownload).toHaveBeenCalledTimes(1);
  const args = mockDownload.mock.calls[0][0];
  expect(args.academicYear).toBe(2567);
  expect(args.scopeLabel).toBe('กรุงเทพฯ');
  expect(args.projectsTotal).toBe(2);
  expect(args.phases).toEqual(phases);
  expect(args.allocations.items).toHaveLength(1);
  // The one club STUACT's fixture clubs list carries that has no allocation
  // row is the unfunded one this export must still name.
  expect(args.unfundedClubs.map((c) => c.code)).toEqual(['A202']);
});

it('names every over-committed club when Q33 fires', async () => {
  stubApi({ role: 'ADMIN' });
  api.allocations.mockResolvedValue({
    items: [allocation({ overCommitted: true, remaining: '-1000.00' })],
    overCommitted: [{ club: { nameTh: 'ชมรมพุทธศาสน์' } }],
  });
  show('ADMIN');

  expect(await screen.findByText(/มียอดอนุมัติเกินวงเงินจัดสรรของปีนี้/)).toBeInTheDocument();
  expect(screen.getByText('เกินวงเงิน')).toBeInTheDocument();
});
