/**
 * The one chart in the app — see the component's own header comment for the
 * reasoning. Worth testing from outside: the "one row is not a chart" rule
 * (nothing drawn below two rows), the over-commitment math that the header
 * comment says was once double-counted, and that the bar's accessible label
 * carries the same four figures the tooltip and legend draw.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { MoneyMeter, MoneyLegend } from './MoneyMeter';

const inside = {
  key: 'a', label: 'ชมรมเอ', allocated: 100000, committed: 60000, disbursed: 40000,
};
const overCommitted = {
  key: 'b', label: 'ชมรมบี', allocated: 70000, committed: 96000, disbursed: 96000,
};

it('shows the empty text rather than an empty chart when there are no rows', () => {
  render(<MoneyMeter rows={[]} emptyText="ไม่มีข้อมูล" />);
  expect(screen.getByText('ไม่มีข้อมูล')).toBeInTheDocument();
});

it('draws nothing for a single row — there is nothing to compare it to', () => {
  const { container } = render(<MoneyMeter rows={[inside]} />);
  expect(container).toBeEmptyDOMElement();
});

it('states all four figures on the bar\'s accessible label for a row inside its ceiling', () => {
  render(<MoneyMeter rows={[inside, overCommitted]} />);

  const bar = screen.getByRole('img', { name: /ชมรมเอ — จัดสรร/ });
  expect(bar).toHaveAccessibleName(
    'ชมรมเอ — จัดสรร 100,000.00 บาท · อนุมัติแล้ว 60,000.00 · จ่ายจริง 40,000.00'
  );
});

it('names the overrun amount on an over-committed row\'s label, and marks it in words', () => {
  render(<MoneyMeter rows={[inside, overCommitted]} />);

  const bar = screen.getByRole('img', { name: /ชมรมบี — จัดสรร/ });
  expect(bar).toHaveAccessibleName(
    'ชมรมบี — จัดสรร 70,000.00 บาท · อนุมัติแล้ว 96,000.00 · จ่ายจริง 96,000.00 · เกินวงเงิน 26,000.00'
  );
  expect(screen.getAllByText('เกินวงเงิน').length).toBeGreaterThan(0);
});

it('shows a tooltip naming the hovered row\'s figures, and clears it on mouse leave', () => {
  const { container } = render(<MoneyMeter rows={[inside, overCommitted]} />);

  const bar = screen.getByRole('img', { name: /ชมรมเอ — จัดสรร/ });
  fireEvent.mouseEnter(bar, { clientX: 50, clientY: 20 });

  const total = screen.getByText('จัดสรรทั้งหมด');
  expect(total).toBeInTheDocument();
  expect(total.nextSibling).toHaveTextContent('100,000.00');

  fireEvent.mouseLeave(container.firstChild);
  expect(screen.queryByText('จัดสรรทั้งหมด')).not.toBeInTheDocument();
});

it('legend adds the overrun swatch only when a row actually needs it', () => {
  const { rerender } = render(<MoneyLegend showOver={false} />);
  expect(screen.queryByText('เกินวงเงิน')).not.toBeInTheDocument();

  rerender(<MoneyLegend showOver />);
  expect(screen.getByText('เกินวงเงิน')).toBeInTheDocument();
});
