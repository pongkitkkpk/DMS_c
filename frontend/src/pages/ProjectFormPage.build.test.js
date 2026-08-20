/**
 * The payload this page assembles from fifteen fields and eight lists, and
 * the reverse of that on load. Companion to `ProjectFormPage.save.test.js`
 * (the double-submit fix) and `.edit.test.js` (the coordinator-slot fix),
 * which each cover one specific defect rather than the general shape.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  messageOf: () => 'error',
}));

jest.mock('../AuthContext', () => ({
  useAuth: () => ({
    session: { academicYear: 2567, membership: { club_name: 'ชมรมพุทธศาสน์' } },
  }),
}));

const mockGoBack = jest.fn();
const mockPush = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useHistory: () => ({ goBack: mockGoBack, push: mockPush }),
}));

const mockSwalFire = jest.fn();
jest.mock('sweetalert2', () => ({
  __esModule: true,
  default: { fire: (...args) => mockSwalFire(...args) },
}));

const newForm = () => render(
  <MemoryRouter initialEntries={['/projects/new']}>
    <Route path="/projects/new"><ProjectFormPage /></Route>
  </MemoryRouter>
);

const editForm = () => render(
  <MemoryRouter initialEntries={['/projects/5/edit']}>
    <Route path="/projects/:id/edit"><ProjectFormPage /></Route>
  </MemoryRouter>
);

const sectionCallFor = (name) => api.saveSection.mock.calls.find(([, section]) => section === name);

const fullProject = {
  id: 5,
  name: 'โครงการเดิม',
  academicTerm: '2/2567',
  advisor: { id: 9 },
  isNewProject: false,
  isContinueProject: true,
  prepareStartOn: '2024-06-01',
  prepareEndOn: '2024-06-15',
  eventStartOn: '2024-07-01',
  eventEndOn: '2024-07-03',
  reportDueOn: '2024-08-01',
  contacts: [{ slot: 1, name: 'สมชาย', phone: '0810000000' }],
  sections: {
    rationales: [], objectives: [], types: [], locations: [], activities: [],
    indicators: [], problems: [], attendance: [], tags: [],
  },
};

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
  api.advisors.mockResolvedValue({
    advisors: [{ id: 9, prefix: 'อ.', fullNameTh: 'สมหญิง ที่ปรึกษา', agency: 'คณะวิศวกรรมศาสตร์' }],
  });
  api.limits.mockResolvedValue({ sections: { rationales: { capacity: 3 } } });
  api.createProject.mockResolvedValue({ id: 11, draftSequence: 10 });
  api.updateProject.mockResolvedValue({});
  api.saveSection.mockResolvedValue({});
  api.saveTags.mockResolvedValue({});
});

it('drops a section\'s untouched starter row rather than sending it as content', async () => {
  newForm();
  await typeName();

  press();

  await waitFor(() => expect(sectionCallFor('rationales')).toBeDefined());
  expect(sectionCallFor('rationales')[2]).toEqual([]);
});

it('sends a row once any of its fields actually has something typed', async () => {
  newForm();
  await typeName();

  const rationale = await screen.findByPlaceholderText('หลักการและเหตุผล');
  fireEvent.change(rationale, { target: { value: 'เหตุผลของโครงการ' } });
  press();

  await waitFor(() => expect(sectionCallFor('rationales')).toBeDefined());
  expect(sectionCallFor('rationales')[2]).toEqual([
    expect.objectContaining({ content: 'เหตุผลของโครงการ' }),
  ]);
});

it('drops an attendance row that has a type but no headcount', async () => {
  newForm();
  await typeName();
  press();

  await waitFor(() => expect(sectionCallFor('attendance')).toBeDefined());
  // The starter row defaults attendeeType to STUDENT but headcount is blank,
  // so it must not be counted as a real attendance group.
  expect(sectionCallFor('attendance')[2]).toEqual([]);
});

it('sends the chosen advisor as a number, and null when none is chosen', async () => {
  newForm();
  await typeName();
  press();

  await waitFor(() => expect(api.createProject).toHaveBeenCalled());
  expect(api.createProject.mock.calls[0][0].advisorPersonId).toBeNull();
});

it('converts the picked advisor to the numeric id the server expects', async () => {
  newForm();
  await typeName();
  await userEvent.selectOptions(screen.getByLabelText('อาจารย์ที่ปรึกษา'), '9');
  press();

  await waitFor(() => expect(api.createProject).toHaveBeenCalled());
  expect(api.createProject.mock.calls[0][0].advisorPersonId).toBe(9);
});

it('loads every core field back on edit, not only the name and contacts', async () => {
  api.getProject.mockResolvedValue(fullProject);
  editForm();

  expect(await screen.findByDisplayValue('โครงการเดิม')).toBeInTheDocument();
  expect(screen.getByDisplayValue('2/2567')).toBeInTheDocument();
  expect(screen.getByLabelText('อาจารย์ที่ปรึกษา')).toHaveValue('9');
  expect(screen.getByLabelText('โครงการใหม่')).not.toBeChecked();
  expect(screen.getByLabelText('โครงการต่อเนื่อง')).toBeChecked();
  expect(screen.getByLabelText('เตรียมงาน — เริ่ม')).toHaveValue('2024-06-01');
  expect(screen.getByLabelText('กำหนดส่งสรุปผล')).toHaveValue('2024-08-01');
});

it('labels a section with the printable capacity the server reported for it', async () => {
  newForm();
  await screen.findByPlaceholderText('ชื่อโครงการ');

  expect(screen.getByText(/แบบฟอร์มพิมพ์ได้ 3/)).toBeInTheDocument();
});

it('leaves the form on cancel without saving anything', async () => {
  newForm();
  await typeName();

  await userEvent.click(screen.getAllByRole('button', { name: 'ยกเลิก' })[0]);

  expect(mockGoBack).toHaveBeenCalled();
  expect(api.createProject).not.toHaveBeenCalled();
});
