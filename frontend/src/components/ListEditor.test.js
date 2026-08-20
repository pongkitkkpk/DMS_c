/**
 * A repeating-row editor shared by all seven of a project's child lists (see
 * the component's own header comment). It never carries a server id or
 * ordinal — position in the array *is* the order — so what matters here is
 * that every operation (edit, add, remove, move) rebuilds that array
 * correctly, and that the over-capacity notice is a form fact, not a mood.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ListEditor from './ListEditor';

const columns = [
  { key: 'name', label: 'ชื่อ' },
  { key: 'phone', label: 'เบอร์โทร' },
];

const rows = [
  { name: 'ก', phone: '111' },
  { name: 'ข', phone: '222' },
  { name: 'ค', phone: '333' },
];

it('shows the empty hint rather than a bare table when there are no rows', () => {
  render(<ListEditor title="รายชื่อ" columns={columns} rows={[]} onChange={jest.fn()} empty="ยังไม่มีรายการ" />);
  expect(screen.getByText('ยังไม่มีรายการ')).toBeInTheDocument();
});

it('appends one blank row on add, leaving existing rows untouched', async () => {
  const onChange = jest.fn();
  render(<ListEditor title="รายชื่อ" columns={columns} rows={rows} onChange={onChange} />);

  await userEvent.click(screen.getByText('+ เพิ่มแถว'));

  expect(onChange).toHaveBeenCalledWith([...rows, { name: '', phone: '' }]);
});

it('edits only the one field on the one row targeted, by index', async () => {
  const onChange = jest.fn();
  render(<ListEditor title="รายชื่อ" columns={columns} rows={rows} onChange={onChange} />);

  const secondNameInput = screen.getByLabelText('ชื่อ แถวที่ 2');
  await userEvent.clear(secondNameInput);
  await userEvent.type(secondNameInput, 'ง');

  // Assert the final call left rows 1 and 3 untouched and only row 2's name changed.
  const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
  expect(last[0]).toEqual(rows[0]);
  expect(last[2]).toEqual(rows[2]);
  expect(last[1].phone).toBe('222');
});

it('removes exactly the targeted row, closing the gap', async () => {
  const onChange = jest.fn();
  render(<ListEditor title="รายชื่อ" columns={columns} rows={rows} onChange={onChange} />);

  await userEvent.click(screen.getAllByLabelText('ลบแถว')[1]);

  expect(onChange).toHaveBeenCalledWith([rows[0], rows[2]]);
});

it('swaps two rows on move rather than mutating any row in place', async () => {
  const onChange = jest.fn();
  render(<ListEditor title="รายชื่อ" columns={columns} rows={rows} onChange={onChange} />);

  await userEvent.click(screen.getAllByLabelText('เลื่อนลง')[0]);

  expect(onChange).toHaveBeenCalledWith([rows[1], rows[0], rows[2]]);
});

it('disables move at both boundaries of the list', () => {
  render(<ListEditor title="รายชื่อ" columns={columns} rows={rows} onChange={jest.fn()} />);

  expect(screen.getAllByLabelText('เลื่อนขึ้น')[0]).toBeDisabled();
  expect(screen.getAllByLabelText('เลื่อนลง')[rows.length - 1]).toBeDisabled();
  expect(screen.getAllByLabelText('เลื่อนลง')[0]).not.toBeDisabled();
});

it('names the printable capacity as a document fact once rows exceed it', () => {
  render(<ListEditor title="รายชื่อ" columns={columns} rows={rows} onChange={jest.fn()} max={2} />);
  expect(screen.getByText(/มี 3 รายการ แต่แบบฟอร์มพิมพ์ได้ 2 รายการ/)).toBeInTheDocument();
});

it('raises no over-capacity warning when rows are within the limit', () => {
  render(<ListEditor title="รายชื่อ" columns={columns} rows={rows} onChange={jest.fn()} max={5} />);
  expect(screen.queryByText(/บันทึกได้ แต่จะออกเอกสารไม่ได้/)).not.toBeInTheDocument();
});
