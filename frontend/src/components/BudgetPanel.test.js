/**
 * The budget panel — see the component's own header comment for its two load
 * -bearing rules: the server decides what is editable (`budget.permissions`,
 * never the role), and no total is computed here to be sent back (an unsaved
 * line shows a labelled preview, never the server's `amount`). Both are
 * exactly the kind of thing that silently rots, so both are tested directly.
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import BudgetPanel from './BudgetPanel';
import { api } from '../api';

jest.mock('../api', () => ({
  api: {
    budget: jest.fn(),
    setPlan: jest.fn(),
    approveBudget: jest.fn(),
    setLines: jest.fn(),
    disburse: jest.fn(),
  },
  messageOf: () => 'error',
}));

const mockSwalFire = jest.fn();
jest.mock('sweetalert2', () => ({
  __esModule: true,
  default: { fire: (...args) => mockSwalFire(...args) },
}));

const autoConfirm = (value = '120000') => mockSwalFire.mockImplementation((opts) => (
  Promise.resolve(opts.input === 'text' ? { isConfirmed: true, value } : { isConfirmed: true })
));

const baseData = {
  money: {
    plannedAmount: '100000.00',
    requestedTotal: '80000.00',
    approvedAmount: '90000.00',
    approvedAt: '2026-08-01',
    disbursedTotal: '40000.00',
    remaining: '50000.00',
    actualTotal: '96000.00',
    refundTotal: null,
    clubYearCommitted: '96000.00',
    allocation: '150000.00',
  },
  lines: {
    planned: [
      {
        category: 'A', description: 'ค่าตอบแทนวิทยากร',
        qty1: 1, unit1: 'คน', qty2: 2, unit2: 'ชม.', unit_price: 500, amount: '1000.00',
      },
    ],
    actual: [],
  },
  disbursements: [
    { id: 1, amount: '40000.00', received_by_name: 'นายเอ', issued_by_name: 'นายบี', disbursed_at: '2026-08-01T10:00:00Z' },
  ],
  warnings: [{ code: 'OVER_ACTUAL', message: 'ค่าใช้จ่ายจริงเกินวงเงินที่อนุมัติ' }],
  permissions: { edit: true, approve: true, disburse: true },
};

const readOnlyData = {
  ...baseData,
  lines: { planned: [], actual: [] },
  disbursements: [],
  warnings: [],
  permissions: { edit: false, approve: false, disburse: false },
};

beforeEach(() => {
  jest.clearAllMocks();
  autoConfirm();
});

it('renders an error rather than a blank panel when the fetch fails', async () => {
  api.budget.mockRejectedValue(new Error('boom'));
  render(<BudgetPanel projectId={1} />);
  expect(await screen.findByText('error')).toBeInTheDocument();
});

it('surfaces the server\'s own warning sentences', async () => {
  api.budget.mockResolvedValue(baseData);
  render(<BudgetPanel projectId={1} />);
  expect(await screen.findByText('ค่าใช้จ่ายจริงเกินวงเงินที่อนุมัติ')).toBeInTheDocument();
});

it('marks "อ่านอย่างเดียว" only when neither edit nor approve is granted', async () => {
  api.budget.mockResolvedValue(readOnlyData);
  render(<BudgetPanel projectId={1} />);
  expect(await screen.findByText('อ่านอย่างเดียว')).toBeInTheDocument();
});

it('does not label the panel read-only when the caller may edit', async () => {
  api.budget.mockResolvedValue(baseData);
  render(<BudgetPanel projectId={1} />);
  await screen.findByText('งบประมาณ');
  expect(screen.queryByText('อ่านอย่างเดียว')).not.toBeInTheDocument();
});

it('draws a limit past its cap as "over", naming the overage, not a bar past 100%', async () => {
  api.budget.mockResolvedValue(baseData);
  render(<BudgetPanel projectId={1} />);

  const meter = await screen.findByRole('meter', { name: 'ค่าใช้จ่ายจริง เทียบ วงเงินที่อนุมัติ' });
  expect(meter).toHaveAttribute('aria-valuenow', '96000');
  expect(meter).toHaveAttribute('aria-valuemax', '90000');
  expect(screen.getByText(/เกิน 6,000\.00/)).toBeInTheDocument();
});

it('omits a meter entirely when its limit is not yet known', async () => {
  api.budget.mockResolvedValue({ ...baseData, money: { ...baseData.money, allocation: null } });
  render(<BudgetPanel projectId={1} />);

  await screen.findByText('งบประมาณ');
  expect(screen.queryByRole('meter', { name: 'วงเงินที่ชมรมอนุมัติแล้วทั้งปี เทียบ วงเงินจัดสรร' }))
    .not.toBeInTheDocument();
});

it('labels the approve button by whether an amount has ever been set', async () => {
  api.budget.mockResolvedValue(baseData);
  render(<BudgetPanel projectId={1} />);
  expect(await screen.findByText('แก้ไขวงเงินที่อนุมัติ')).toBeInTheDocument();

  api.budget.mockResolvedValue({ ...baseData, money: { ...baseData.money, approvedAmount: null } });
  render(<BudgetPanel projectId={2} />);
  expect(await screen.findByText('อนุมัติวงเงิน')).toBeInTheDocument();
});

it('submits the plan edit through the server and reloads the panel with it', async () => {
  api.budget.mockResolvedValue(baseData);
  api.setPlan.mockResolvedValue({});
  const onChange = jest.fn();
  render(<BudgetPanel projectId={7} onChange={onChange} />);

  await userEvent.click(await screen.findByText('แก้ไขงบประมาณตามแผน'));

  await waitFor(() => expect(api.setPlan).toHaveBeenCalledWith(7, '120000'));
  await waitFor(() => expect(api.budget).toHaveBeenCalledTimes(2));
  expect(onChange).toHaveBeenCalled();
});

it('shows an unsaved line as a labelled preview, never the server\'s saved amount', async () => {
  api.budget.mockResolvedValue(baseData);
  render(<BudgetPanel projectId={1} />);

  expect(await screen.findByText('1,000.00')).toBeInTheDocument(); // saved amount, no "≈"

  const priceInput = screen.getByDisplayValue('500');
  await userEvent.clear(priceInput);
  await userEvent.type(priceInput, '900');

  expect(await screen.findByText('≈ 1,800.00')).toBeInTheDocument();
  expect(screen.getByText('ยังไม่ได้บันทึกการแก้ไข', { exact: false })).toBeInTheDocument();
});

it('disables save until a line is actually dirty, and saves the mapped rows on click', async () => {
  api.budget.mockResolvedValue(baseData);
  api.setLines.mockResolvedValue({});
  render(<BudgetPanel projectId={3} />);

  const [saveButton] = await screen.findAllByText('บันทึกรายการ');
  expect(saveButton).toBeDisabled();

  const descriptionInput = screen.getByDisplayValue('ค่าตอบแทนวิทยากร');
  await userEvent.type(descriptionInput, ' (แก้ไข)');
  expect(saveButton).not.toBeDisabled();

  await userEvent.click(saveButton);

  await waitFor(() => expect(api.setLines).toHaveBeenCalledWith(
    3, 'PLANNED',
    [expect.objectContaining({ category: 'A', description: 'ค่าตอบแทนวิทยากร (แก้ไข)', unitPrice: '500' })]
  ));
});

it('adds a blank row on "+ เพิ่มรายการ" and removes a row on its own delete button', async () => {
  api.budget.mockResolvedValue(baseData);
  render(<BudgetPanel projectId={1} />);

  await screen.findByDisplayValue('ค่าตอบแทนวิทยากร');
  const [addPlanned] = screen.getAllByText('+ เพิ่มรายการ');
  await userEvent.click(addPlanned);

  const deleteButtons = screen.getAllByLabelText('ลบรายการ');
  expect(deleteButtons).toHaveLength(2);

  await userEvent.click(deleteButtons[1]);
  expect(screen.getAllByLabelText('ลบรายการ')).toHaveLength(1);
});

it('shows the empty message for a variant with no rows once it is read-only', async () => {
  api.budget.mockResolvedValue(readOnlyData);
  render(<BudgetPanel projectId={1} />);

  expect(await screen.findAllByText('ยังไม่มีรายการ')).toHaveLength(2); // PLANNED and ACTUAL
});

it('offers the disbursement form only when the caller may disburse', async () => {
  api.budget.mockResolvedValue(readOnlyData);
  render(<BudgetPanel projectId={1} />);

  await screen.findByText('ยังไม่มีการเบิกจ่าย');
  expect(screen.queryByPlaceholderText('จำนวนเงิน')).not.toBeInTheDocument();
});

it('records a disbursement and clears the form, without letting the ledger be edited', async () => {
  api.budget.mockResolvedValue(baseData);
  api.disburse.mockResolvedValue({});
  render(<BudgetPanel projectId={9} />);

  await screen.findByText('การเบิกจ่าย');
  await userEvent.type(screen.getByPlaceholderText('จำนวนเงิน'), '5000');
  await userEvent.type(screen.getByPlaceholderText('ผู้รับเงิน'), 'นายซี');
  await userEvent.type(screen.getByPlaceholderText('ผู้จ่ายเงิน'), 'นายดี');
  await userEvent.click(screen.getByText('บันทึกการเบิกจ่าย'));

  await waitFor(() => expect(api.disburse).toHaveBeenCalledWith(
    9, { amount: '5000', receivedByName: 'นายซี', issuedByName: 'นายดี' }
  ));
  await waitFor(() => expect(screen.getByPlaceholderText('จำนวนเงิน')).toHaveValue(''));
});
