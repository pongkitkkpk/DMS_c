/**
 * The one screen that crosses every year at once — read-only by design, so
 * what's worth checking is that the two tables tell the truth: a phase with
 * zero projects in a year still gets a column, and a year with nothing at
 * all doesn't get mistaken for a year that hasn't loaded yet.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';

import HistoryPage from './HistoryPage';
import { api } from '../api';

jest.mock('../api', () => ({
  api: { history: jest.fn(), phases: jest.fn() },
  messageOf: () => 'error',
}));

let mockSession = null;
jest.mock('../AuthContext', () => ({ useAuth: () => ({ session: mockSession }) }));

const phases = [
  { code: 'DRAFT_PROPOSAL', ordinal: 1, name_th: 'ร่างคำขออนุมัติ' },
  { code: 'APPROVED', ordinal: 2, name_th: 'โครงการอนุมัติ' },
];

const year2567 = {
  academicYear: 2567,
  projectCount: 5,
  isCurrent: true,
  clubsFunded: 10,
  clubsOverCommitted: 1,
  allocated: '500000.00',
  committed: '96000.00',
  remaining: '404000.00',
  overCommitted: false,
  byPhase: [{ code: 'DRAFT_PROPOSAL', count: 5 }], // nothing in APPROVED this year
};

const show = (role) => {
  mockSession = { role, academicYear: 2567 };
  return render(
    <MemoryRouter initialEntries={['/history']}>
      <Route path="/history"><HistoryPage /></Route>
    </MemoryRouter>
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  api.phases.mockResolvedValue({ phases });
});

it('shows a real empty state rather than an endless skeleton for a scope with no years', async () => {
  api.history.mockResolvedValue({ items: [] });
  show('ADMIN');

  expect(await screen.findByText('ยังไม่มีข้อมูลปีใดในขอบเขตของบัญชีนี้')).toBeInTheDocument();
});

it('gives a phase with zero projects its own dimmed cell, not a blank one', async () => {
  api.history.mockResolvedValue({ items: [year2567] });
  show('ADMIN');

  const zero = await screen.findByText('0');
  expect(zero).toHaveClass('u-dim');
  // "5" appears twice — the phase cell's <span> and the row's plain-text
  // total — so only the span (the phase count itself) is the one under test.
  const five = screen.getAllByText('5').find((el) => el.tagName === 'SPAN');
  expect(five).not.toHaveClass('u-dim');
});

it('names the over-committed clubs at the year level, separately from the money columns', async () => {
  api.history.mockResolvedValue({ items: [year2567] });
  show('ADMIN');

  expect(await screen.findByText('เกินวงเงิน 1')).toBeInTheDocument();
});

it('labels the allocations link by what this role may actually do there', async () => {
  api.history.mockResolvedValue({ items: [year2567] });
  show('SH');

  expect(await screen.findByText('ดูวงเงินจัดสรร →')).toBeInTheDocument();
});

it('offers the editing label to a role that may set a ceiling', async () => {
  api.history.mockResolvedValue({ items: [year2567] });
  show('STUACT');

  expect(await screen.findByText('กำหนดวงเงิน →')).toBeInTheDocument();
});

it('carries the year onto both tables\' links, to the screen each one owns', async () => {
  api.history.mockResolvedValue({ items: [year2567] });
  show('ADMIN');

  expect(await screen.findByRole('link', { name: /วงเงินจัดสรร ปีการศึกษา 2567/ }))
    .toHaveAttribute('href', '/allocations?year=2567');
  expect(screen.getByRole('link', { name: /โครงการ ปีการศึกษา 2567/ }))
    .toHaveAttribute('href', '/projects?year=2567');
});
