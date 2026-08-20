/**
 * A controlled checkbox grid over the eight taxonomy vocabularies. The thing
 * worth checking is the toggle math: it must add or remove exactly the one
 * id clicked, by identity, and leave every other selection — including ids
 * from a set not even rendered here — untouched.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TagPicker from './TagPicker';

const tagSets = [
  {
    code: 'STRATEGY',
    nameTh: 'ยุทธศาสตร์',
    tags: [
      { id: 1, ordinal: 1, nameTh: 'ด้านที่ 1' },
      { id: 2, ordinal: 2, nameTh: 'ด้านที่ 2' },
    ],
  },
  {
    code: 'SDG',
    nameTh: 'เป้าหมาย SDG',
    tags: [{ id: 10, ordinal: 1, nameTh: 'เป้าหมายที่ 1' }],
  },
];

it('checks exactly the boxes named in `selected`', () => {
  render(<TagPicker tagSets={tagSets} selected={[2]} onChange={jest.fn()} />);

  expect(screen.getByLabelText(/ด้านที่ 1/)).not.toBeChecked();
  expect(screen.getByLabelText(/ด้านที่ 2/)).toBeChecked();
  expect(screen.getByLabelText(/เป้าหมายที่ 1/)).not.toBeChecked();
});

it('shows the count of what is actually selected, across sets', () => {
  render(<TagPicker tagSets={tagSets} selected={[1, 10]} onChange={jest.fn()} />);
  expect(screen.getByText('เลือกแล้ว 2 รายการ')).toBeInTheDocument();
});

it('adds a tag on check without disturbing an unrelated selection', async () => {
  const onChange = jest.fn();
  render(<TagPicker tagSets={tagSets} selected={[10]} onChange={onChange} />);

  await userEvent.click(screen.getByLabelText(/ด้านที่ 1/));

  const next = new Set(onChange.mock.calls[0][0]);
  expect(next).toEqual(new Set([10, 1]));
});

it('removes a tag on uncheck without disturbing the rest', async () => {
  const onChange = jest.fn();
  render(<TagPicker tagSets={tagSets} selected={[1, 2, 10]} onChange={onChange} />);

  await userEvent.click(screen.getByLabelText(/ด้านที่ 2/));

  const next = new Set(onChange.mock.calls[0][0]);
  expect(next).toEqual(new Set([1, 10]));
});
