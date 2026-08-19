/**
 * Yearly allocations — the one editable-money screen with a year switch,
 * where the Q33 bargain (allowed, never quiet) is applied twice: once to the
 * amount, and once here to editing a year that has already closed.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route } from 'react-router-dom';

import AllocationsPage from './AllocationsPage';
import { api } from '../api';

jest.mock('../api', () => ({
  api: {
    allocations: jest.fn(),
    clubs: jest.fn(),
    setAllocation: jest.fn(),
  },
  messageOf: () => 'error',
}));

const mockSwalFire = jest.fn();
jest.mock('sweetalert2', () => ({
  __esModule: true,
  default: { fire: (...args) => mockSwalFire(...args) },
}));

let mockSession = null;
jest.mock('../AuthContext', () => ({ useAuth: () => ({ session: mockSession }) }));

const fundedClub = {
  id: 28,
  club: { id: 28, code: 'A201', nameTh: 'ชมรมพุทธศาสน์' },
  campus: { nameTh: 'มจพ. กรุงเทพฯ' },
  amount: '500000.00',
  committed: '96000.00',
  remaining: '404000.00',
  overCommitted: false,
};

const session = (role, academicYear = 2567) => ({ role, academicYear });

const show = (role, initialPath = '/allocations') => {
  mockSession = session(role);
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Route path="/allocations"><AllocationsPage /></Route>
    </MemoryRouter>
  );
};

// Distinguishes the retroactive-year confirm (a plain question dialog) from
// the amount prompt (`input: 'text'`), so a test can drive both without
// caring which one fires first.
const autoConfirm = (amount = '12345') => mockSwalFire.mockImplementation((opts) => (
  Promise.resolve(opts.input === 'text' ? { isConfirmed: true, value: amount } : { isConfirmed: true })
));

beforeEach(() => {
  jest.clearAllMocks();
  autoConfirm();
  api.clubs.mockResolvedValue({ clubs: [] });
  api.setAllocation.mockResolvedValue({ warnings: [] });
});

it('seeds the viewed year from the URL, not the session\'s academic year', async () => {
  api.allocations.mockResolvedValue({ years: [2568], items: [], overCommitted: [] });
  show('ADMIN', '/allocations?year=2568');

  await waitFor(() => expect(api.allocations).toHaveBeenCalledWith({ year: 2568 }));
  expect(await screen.findByText('ปีการศึกษา 2568')).toBeInTheDocument();
});

it('refetches when a different year is picked', async () => {
  api.allocations.mockResolvedValue({ years: [2567, 2566], items: [], overCommitted: [] });
  show('ADMIN');

  await screen.findByText('ปีการศึกษา 2567');
  await userEvent.selectOptions(screen.getByLabelText('ปีการศึกษา'), '2566');

  await waitFor(() => expect(api.allocations).toHaveBeenLastCalledWith({ year: 2566 }));
});

it('warns before editing a year already closed, naming what already happened', async () => {
  api.allocations.mockResolvedValue({ years: [2565], items: [fundedClub], overCommitted: [] });
  show('ADMIN', '/allocations?year=2565');

  const edit = await screen.findByRole('button', { name: /แก้ไขวงเงินจัดสรรของ ชมรมพุทธศาสน์/ });
  await userEvent.click(edit);

  await waitFor(() => expect(api.setAllocation).toHaveBeenCalledWith({
    clubId: 28, academicYear: 2565, amount: '12345',
  }));
  // Two dialogs in sequence: the retroactive warning, then the amount prompt.
  expect(mockSwalFire).toHaveBeenCalledWith(expect.objectContaining({
    title: 'แก้ไขวงเงินของปี 2565',
    html: expect.stringContaining('อนุมัติเงินไปแล้ว'),
  }));
});

it('tells an unfunded past year apart from one being corrected', async () => {
  api.allocations.mockResolvedValue({ years: [2565], items: [], overCommitted: [] });
  api.clubs.mockResolvedValue({ clubs: [{ id: 29, code: 'A202', nameTh: 'ชมรมมุสลิม', campusName: 'มจพ. กรุงเทพฯ' }] });
  show('ADMIN', '/allocations?year=2565');

  const set = await screen.findByRole('button', { name: /กำหนดวงเงินจัดสรรของ ชมรมมุสลิม/ });
  await userEvent.click(set);

  expect(mockSwalFire).toHaveBeenCalledWith(expect.objectContaining({
    title: 'กำหนดวงเงินย้อนหลังให้ปี 2565',
    html: expect.stringContaining('ยังไม่เคยมีวงเงิน'),
  }));
});

it('asks only once for a future year — no retroactive warning', async () => {
  api.allocations.mockResolvedValue({ years: [2569], items: [fundedClub], overCommitted: [] });
  show('ADMIN', '/allocations?year=2569');

  expect(await screen.findByText(/กำลังตั้งวงเงินล่วงหน้า/)).toBeInTheDocument();

  const edit = await screen.findByRole('button', { name: /แก้ไขวงเงินจัดสรรของ ชมรมพุทธศาสน์/ });
  await userEvent.click(edit);

  await waitFor(() => expect(api.setAllocation).toHaveBeenCalledWith({
    clubId: 28, academicYear: 2569, amount: '12345',
  }));
  expect(mockSwalFire).toHaveBeenCalledTimes(1); // the amount prompt only
});

it('surfaces Q33\'s warning after a save that succeeds anyway', async () => {
  api.allocations.mockResolvedValue({ years: [2567], items: [fundedClub], overCommitted: [] });
  api.setAllocation.mockResolvedValue({
    warnings: [{ message: 'วงเงินใหม่ต่ำกว่ายอดที่อนุมัติไปแล้ว' }],
  });
  show('ADMIN');

  const edit = await screen.findByRole('button', { name: /แก้ไขวงเงินจัดสรรของ ชมรมพุทธศาสน์/ });
  await userEvent.click(edit);

  await waitFor(() => expect(mockSwalFire).toHaveBeenCalledWith(expect.objectContaining({
    icon: 'warning',
    title: 'บันทึกแล้ว แต่โปรดทราบ',
    text: 'วงเงินใหม่ต่ำกว่ายอดที่อนุมัติไปแล้ว',
  })));
});

it('gives a read-only role no edit controls at all', async () => {
  api.allocations.mockResolvedValue({ years: [2567], items: [fundedClub], overCommitted: [] });
  show('AD');

  expect(await screen.findByText('อ่านอย่างเดียว')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /แก้ไขวงเงินจัดสรรของ/ })).not.toBeInTheDocument();
});

it('names every over-committed club for the year being viewed', async () => {
  api.allocations.mockResolvedValue({
    years: [2567],
    items: [{ ...fundedClub, overCommitted: true, remaining: '-1000.00' }],
    overCommitted: [{ club: { nameTh: 'ชมรมพุทธศาสน์' } }],
  });
  show('ADMIN');

  expect(await screen.findByText(/มียอดอนุมัติเกินวงเงินจัดสรรของปี 2567/)).toBeInTheDocument();
  expect(screen.getByText('เกินวงเงิน')).toBeInTheDocument();
});
