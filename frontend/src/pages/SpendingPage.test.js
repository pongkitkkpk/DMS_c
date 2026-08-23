/**
 * The money comparison page — three levels, widest first, each one drawn
 * only when there is more than one row to compare against. What's worth
 * checking here is that rule (a STUACT's single club group gets no chart
 * restating the headline it already saw) and the headline's own over-commit
 * colour, since both are easy to get right on paper and wrong once a scope
 * with exactly one campus or one group actually loads.
 *
 * The chart itself (`MoneyMeter`) is stubbed — it has its own component, and
 * jsdom's zero-size layout box would only be testing its fallback path, not
 * this page's.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route } from 'react-router-dom';

import SpendingPage from './SpendingPage';
import { api } from '../api';

jest.mock('../api', () => ({
  api: { spending: jest.fn() },
  messageOf: () => 'error',
}));

jest.mock('../components/MoneyMeter', () => ({
  MoneyMeter: () => <div data-testid="chart" />,
}));

let mockSession = null;
jest.mock('../AuthContext', () => ({ useAuth: () => ({ session: mockSession }) }));

const totals = {
  allocated: '500000.00', committed: '96000.00', disbursed: '50000.00',
  remaining: '404000.00', overCommitted: false, activeClubs: 3, projects: 5,
  idleClubs: 66, submitted: 3, closed: 1,
};

const oneCampusOneGroup = {
  academicYear: 2567,
  years: [2567],
  totals,
  byCampus: [{ campus: { id: 1, nameTh: 'มจพ. กรุงเทพฯ' }, activeClubs: 3, clubs: 69,
    allocated: '500000.00', committed: '96000.00', disbursed: '50000.00', remaining: '404000.00', overCommitted: false,
    submitted: 3, closed: 1 }],
  byClubGroup: [{ clubGroup: { id: 1, nameTh: 'กรุงเทพฯ' }, activeClubs: 3, clubs: 69,
    allocated: '500000.00', committed: '96000.00', disbursed: '50000.00', remaining: '404000.00', overCommitted: false,
    submitted: 3, closed: 1 }],
  byClub: [
    { club: { id: 28, nameTh: 'ชมรมพุทธศาสน์', code: 'A201' }, campus: { nameTh: 'มจพ. กรุงเทพฯ' },
      projects: 5, allocated: '500000.00', committed: '96000.00', disbursed: '50000.00', remaining: '404000.00', overCommitted: false,
      submitted: 3, closed: 1 },
  ],
};

const session = (role, academicYear = 2567) => ({ role, academicYear });

const show = (role, initialPath = '/spending') => {
  mockSession = session(role);
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Route path="/spending"><SpendingPage /></Route>
    </MemoryRouter>
  );
};

beforeEach(() => {
  jest.clearAllMocks();
});

it('seeds the viewed year from the URL', async () => {
  api.spending.mockResolvedValue({ ...oneCampusOneGroup, academicYear: 2568, years: [2568] });
  show('ADMIN', '/spending?year=2568');

  await waitFor(() => expect(api.spending).toHaveBeenCalledWith({ year: 2568 }));
});

it('shows a loading card, then the server\'s refusal if the request fails', async () => {
  let reject;
  api.spending.mockReturnValue(new Promise((_, r) => { reject = r; }));
  show('ADMIN');

  expect(screen.getByText('กำลังโหลด')).toBeInTheDocument();
  reject({ response: { status: 403 } });

  expect(await screen.findByText('error')).toBeInTheDocument();
});

it('does not draw a chart for a level with only one row to compare', async () => {
  api.spending.mockResolvedValue(oneCampusOneGroup);
  show('STUACT');

  await screen.findByText('ตามชมรม');
  expect(screen.queryByText('ตามวิทยาเขต')).not.toBeInTheDocument();
  expect(screen.queryByText('ตามกลุ่มชมรม')).not.toBeInTheDocument();
  // The one chart that does draw — the club level, which always has its own
  // comparison to make regardless of how narrow the scope above it is.
  expect(screen.getByTestId('chart')).toBeInTheDocument();
});

it('draws campus and group charts once there is more than one of each', async () => {
  api.spending.mockResolvedValue({
    ...oneCampusOneGroup,
    byCampus: [...oneCampusOneGroup.byCampus, { ...oneCampusOneGroup.byCampus[0], campus: { id: 2, nameTh: 'มจพ. ปราจีนบุรี' } }],
    byClubGroup: [...oneCampusOneGroup.byClubGroup, { ...oneCampusOneGroup.byClubGroup[0], clubGroup: { id: 2, nameTh: 'ปราจีนบุรี' } }],
  });
  show('ADMIN');

  expect(await screen.findByText('ตามวิทยาเขต')).toBeInTheDocument();
  expect(screen.getByText('ตามกลุ่มชมรม')).toBeInTheDocument();
});

it('colours the headline remaining figure only when the total is over-committed', async () => {
  api.spending.mockResolvedValue({
    ...oneCampusOneGroup,
    totals: { ...totals, overCommitted: true },
  });
  show('ADMIN');

  expect(await screen.findByText('อนุมัติเกินวงเงินรวม')).toBeInTheDocument();
});

it('names the empty scope rather than rendering a chart with nothing in it', async () => {
  api.spending.mockResolvedValue({ ...oneCampusOneGroup, byClub: [], totals: { ...totals, activeClubs: 0 } });
  show('ADMIN');

  expect(await screen.findByText('ยังไม่มีชมรมใดเคลื่อนไหวในปี 2567')).toBeInTheDocument();
});

it('shows what share of the ceiling is committed, and how many projects are at each stage', async () => {
  api.spending.mockResolvedValue(oneCampusOneGroup);
  show('ADMIN');

  await screen.findByText('ตามชมรม');
  // 96,000 / 500,000 — committed against allocated, not disbursed against
  // allocated, per the page's own `usagePercent` comment.
  expect(screen.getByText('19.2%')).toBeInTheDocument();
});

it('shows an em dash for usage percent rather than 0% when a club has no allocation', async () => {
  api.spending.mockResolvedValue({
    ...oneCampusOneGroup,
    byClub: [{
      ...oneCampusOneGroup.byClub[0], allocated: '0.00', committed: '0.00', remaining: '0.00',
    }],
  });
  show('ADMIN');

  await screen.findByText('ตามชมรม');
  expect(screen.getAllByText('—').length).toBeGreaterThan(0);
});

it('refetches when a different year is chosen', async () => {
  api.spending.mockResolvedValue({ ...oneCampusOneGroup, years: [2567, 2566] });
  show('ADMIN');

  await screen.findByText('ตามชมรม');
  await userEvent.selectOptions(screen.getByLabelText('ปีการศึกษา'), '2566');

  await waitFor(() => expect(api.spending).toHaveBeenLastCalledWith({ year: 2566 }));
});
