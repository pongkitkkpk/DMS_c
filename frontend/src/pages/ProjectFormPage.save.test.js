/**
 * Saving a new project, which is nine requests rather than one.
 *
 * `POST /projects` creates the core row and eight `PUT …/sections/*` calls fill
 * it. A failure anywhere after the first leaves a project that exists, with a
 * draft number, and a dialog that says บันทึกไม่สำเร็จ — and the page used to go
 * on believing it was still creating. Pressing save again therefore created a
 * *second* project: reproduced on 2026-08-18 by pasting a rationale past the
 * column's byte limit and pressing twice, which produced ร่างที่ 8 and
 * ร่างที่ 9, identical and both half-empty.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';

import ProjectFormPage from './ProjectFormPage';
import { api } from '../api';

jest.mock('../api', () => ({
  api: {
    tags: jest.fn(),
    advisors: jest.fn(),
    limits: jest.fn(),
    getProject: jest.fn(),
    createProject: jest.fn(),
    updateProject: jest.fn(),
    saveSection: jest.fn(),
    saveTags: jest.fn(),
  },
  messageOf: (error) =>
    (error && error.response && error.response.data && error.response.data.error) || 'error',
}));

jest.mock('../AuthContext', () => ({
  useAuth: () => ({
    session: { academicYear: 2567, membership: { club_name: 'ชมรมพุทธศาสน์' } },
  }),
}));

const mockSwalFire = jest.fn();
jest.mock('sweetalert2', () => ({
  __esModule: true,
  default: { fire: (...args) => mockSwalFire(...args) },
}));

const tooLong = {
  response: {
    data: { error: 'content: ข้อความยาวเกินที่ระบบเก็บได้ (66000 ไบต์ จากที่เก็บได้ 65535 ไบต์)' },
  },
};

const newForm = () => render(
  <MemoryRouter initialEntries={['/projects/new']}>
    <Route path="/projects/new"><ProjectFormPage /></Route>
  </MemoryRouter>
);

const typeName = async () => {
  const name = await screen.findByPlaceholderText('ชื่อโครงการ');
  fireEvent.change(name, { target: { value: 'โครงการทดสอบ' } });
};

const press = () => fireEvent.click(
  screen.getAllByRole('button', { name: /สร้างโครงการ|บันทึกการแก้ไข/ })[0]
);

beforeEach(() => {
  jest.clearAllMocks();
  mockSwalFire.mockResolvedValue({ isConfirmed: true });
  api.tags.mockResolvedValue({ tagSets: [] });
  api.advisors.mockResolvedValue({ advisors: [] });
  api.limits.mockResolvedValue({ sections: {} });
  api.createProject.mockResolvedValue({ id: 11, draftSequence: 10 });
  api.updateProject.mockResolvedValue({});
  api.saveTags.mockResolvedValue({});
});

it('creates the project once, however many times the save fails', async () => {
  api.saveSection.mockRejectedValue(tooLong);
  newForm();
  await typeName();

  press();
  await waitFor(() => expect(mockSwalFire).toHaveBeenCalled());
  press();
  await waitFor(() => expect(mockSwalFire).toHaveBeenCalledTimes(2));

  expect(api.createProject).toHaveBeenCalledTimes(1);
  // The second attempt is an update of what the first one made.
  expect(api.updateProject).toHaveBeenCalledWith(11, expect.objectContaining({ name: 'โครงการทดสอบ' }));
});

it('says the draft exists, because "บันทึกไม่สำเร็จ" alone reads as "nothing happened"', async () => {
  api.saveSection.mockRejectedValue(tooLong);
  newForm();
  await typeName();

  press();

  await waitFor(() => expect(mockSwalFire).toHaveBeenCalled());
  const dialog = mockSwalFire.mock.calls[0][0];
  expect(dialog.title).toBe('บันทึกไม่สำเร็จ');
  expect(dialog.text).toMatch(/ไบต์/);
  expect(dialog.footer).toMatch(/ร่างที่ 10/);
  expect(dialog.footer).toMatch(/ไม่สร้างใหม่/);
});

it('renames the button after the draft exists, since the press now updates it', async () => {
  api.saveSection.mockRejectedValue(tooLong);
  newForm();
  await typeName();

  expect(screen.getAllByRole('button', { name: 'สร้างโครงการ' }).length).toBeGreaterThan(0);
  press();

  await waitFor(() => expect(screen.getAllByRole('button', { name: 'บันทึกการแก้ไข' }).length).toBeGreaterThan(0));
  expect(screen.queryByRole('button', { name: 'สร้างโครงการ' })).not.toBeInTheDocument();
});

it('finishes into the same draft once the refused value is corrected', async () => {
  api.saveSection.mockRejectedValueOnce(tooLong).mockResolvedValue({});
  newForm();
  await typeName();

  press();
  await waitFor(() => expect(mockSwalFire).toHaveBeenCalled());
  press();

  await waitFor(() => expect(api.saveTags).toHaveBeenCalledWith(11, []));
  expect(api.createProject).toHaveBeenCalledTimes(1);
});

it('refuses to send anything at all without a project name', async () => {
  newForm();
  await screen.findByPlaceholderText('ชื่อโครงการ');

  press();

  await waitFor(() => expect(mockSwalFire).toHaveBeenCalled());
  expect(mockSwalFire.mock.calls[0][0].title).toBe('ยังไม่ได้ตั้งชื่อโครงการ');
  expect(api.createProject).not.toHaveBeenCalled();
});
