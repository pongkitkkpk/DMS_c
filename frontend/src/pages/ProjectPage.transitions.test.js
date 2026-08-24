/**
 * The phase stepper's controls — the one place a project moves from one
 * state to the next. Everything here is drawn from what the server marked
 * `allowedForCaller` (see the page's own header comment); nothing is
 * inferred from a role. Companion to `ProjectPage.timeline.test.js`, which
 * covers the ประวัติ card instead.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route } from 'react-router-dom';

import ProjectPage from './ProjectPage';
import { api } from '../api';

jest.mock('../api', () => ({
  api: {
    getProject: jest.fn(),
    events: jest.fn(),
    phases: jest.fn(),
    transition: jest.fn(),
    deleteProject: jest.fn(),
    endorseAsAdvisor: jest.fn(),
  },
  messageOf: () => 'error',
}));

jest.mock('../components/AttachmentsCard', () => () => <div data-testid="attachments" />);
jest.mock('../components/DocumentsCard', () => () => <div data-testid="documents" />);
jest.mock('../components/BudgetPanel', () => () => <div data-testid="budget" />);
jest.mock('../components/SignaturesCard', () => () => <div data-testid="signatures" />);

const mockCaptureSignature = jest.fn();
jest.mock('../components/SignaturePad', () => ({
  captureSignature: (...args) => mockCaptureSignature(...args),
}));

const mockHistoryPush = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useHistory: () => ({ push: mockHistoryPush }),
}));

const mockSwalFire = jest.fn();
jest.mock('sweetalert2', () => ({
  __esModule: true,
  default: { fire: (...args) => mockSwalFire(...args) },
}));

const baseProject = {
  id: 1,
  name: 'โครงการตัวอย่าง',
  academicYear: 2567,
  draftSequence: 1,
  projectNumber: null,
  phase: { id: 1, code: 'DRAFT_PROPOSAL', ordinal: 1, nameTh: 'ร่างคำขออนุมัติ' },
  club: { id: 28, code: 'A201', nameTh: 'ชมรมพุทธศาสน์' },
  owner: { id: 1, nameTh: 'สมชาย นักศึกษา' },
  advisor: null,
  prepareStartOn: '2024-06-01', prepareEndOn: '2024-06-15',
  eventStartOn: '2024-07-01', eventEndOn: '2024-07-03',
  contacts: [],
  sections: {
    objectives: [], rationales: [], locations: [], types: [], problems: [],
    activities: [], indicators: [], attendance: [], tags: [],
  },
  transitions: [],
  permissions: { edit: false, delete: false },
};

const show = () => render(
  <MemoryRouter initialEntries={['/projects/1']}>
    <Route path="/projects/:id"><ProjectPage /></Route>
  </MemoryRouter>
);

beforeEach(() => {
  jest.clearAllMocks();
  api.events.mockResolvedValue({ events: [] });
  api.phases.mockResolvedValue({ phases: [{ code: 'DRAFT_PROPOSAL', ordinal: 1, name_th: 'ร่างคำขออนุมัติ' }] });
});

it('shows only the buttons the server actually allowed, not one per possible transition', async () => {
  api.getProject.mockResolvedValue({
    ...baseProject,
    transitions: [
      { toPhaseCode: 'PENDING_ADVISOR', toPhaseNameTh: 'รออาจารย์', allowedForCaller: true, requiresBudgetCheck: false, allowedRoles: ['SH'] },
      { toPhaseCode: 'PENDING_STUACT', toPhaseNameTh: 'รอฝ่ายกิจการ', allowedForCaller: false, requiresBudgetCheck: false, allowedRoles: ['AD'] },
    ],
  });
  show();

  expect(await screen.findByText('เปลี่ยนเป็น “รออาจารย์” →', { exact: false })).toBeInTheDocument();
  expect(screen.queryByText('เปลี่ยนเป็น “รอฝ่ายกิจการ” →', { exact: false })).not.toBeInTheDocument();
});

it('names who may take the next step when the caller may not', async () => {
  api.getProject.mockResolvedValue({
    ...baseProject,
    transitions: [
      { toPhaseCode: 'PENDING_ADVISOR', toPhaseNameTh: 'รออาจารย์', allowedForCaller: false, requiresBudgetCheck: false, allowedRoles: ['SH'] },
    ],
  });
  show();

  expect(await screen.findByText(/ขั้นตอนถัดไป “รออาจารย์” ทำได้โดย SH เท่านั้น/)).toBeInTheDocument();
});

it('confirms before advancing, and does not call the server on cancel', async () => {
  api.getProject.mockResolvedValue({
    ...baseProject,
    transitions: [{ toPhaseCode: 'PENDING_ADVISOR', toPhaseNameTh: 'รออาจารย์', allowedForCaller: true, requiresBudgetCheck: false, allowedRoles: ['SH'] }],
  });
  mockSwalFire.mockResolvedValue({ isConfirmed: false });
  show();

  await userEvent.click(await screen.findByText('เปลี่ยนเป็น “รออาจารย์” →', { exact: false }));

  expect(api.transition).not.toHaveBeenCalled();
});

it('advances only after confirming, and reports the new project number', async () => {
  api.getProject.mockResolvedValue({
    ...baseProject,
    transitions: [{ toPhaseCode: 'PENDING_ADVISOR', toPhaseNameTh: 'รออาจารย์', allowedForCaller: true, requiresBudgetCheck: false, allowedRoles: ['SH'] }],
  });
  mockSwalFire.mockResolvedValue({ isConfirmed: true });
  api.transition.mockResolvedValue({
    toPhase: { nameTh: 'รออาจารย์' },
    projectNumber: 'A201-2567-001',
    budgetWarnings: [],
  });
  show();

  await userEvent.click(await screen.findByText('เปลี่ยนเป็น “รออาจารย์” →', { exact: false }));

  await waitFor(() => expect(api.transition).toHaveBeenCalledWith('1', 'PENDING_ADVISOR', null));
  const successCall = mockSwalFire.mock.calls.find(([opts]) => opts.icon === 'success');
  expect(successCall[0].text).toContain('A201-2567-001');
  // A successful transition reloads the page (api.getProject again) — wait
  // for that second fetch to settle too, or its state updates land after the
  // test (and its render tree) is already gone.
  await waitFor(() => expect(api.getProject).toHaveBeenCalledTimes(2));
});

it('marks a warning-carrying transition as a warning, not a plain success', async () => {
  api.getProject.mockResolvedValue({
    ...baseProject,
    transitions: [{ toPhaseCode: 'PROJECT_APPROVED', toPhaseNameTh: 'อนุมัติ', allowedForCaller: true, requiresBudgetCheck: true, allowedRoles: ['STUACT'] }],
  });
  mockSwalFire.mockResolvedValue({ isConfirmed: true });
  api.transition.mockResolvedValue({
    toPhase: { nameTh: 'อนุมัติ' },
    projectNumber: null,
    budgetWarnings: [{ code: 'OVER_PLAN', message: 'เกินงบตามแผน' }],
  });
  show();

  await userEvent.click(await screen.findByText('เปลี่ยนเป็น “อนุมัติ” →', { exact: false }));

  await waitFor(() => {
    const call = mockSwalFire.mock.calls.find(([opts]) => opts.icon && opts.icon !== 'question');
    expect(call[0].icon).toBe('warning');
    expect(call[0].text).toContain('เกินงบตามแผน');
  });
  // A successful transition reloads the page (api.getProject again) — wait
  // for that second fetch to settle too, or its state updates land after the
  // test (and its render tree) is already gone.
  await waitFor(() => expect(api.getProject).toHaveBeenCalledTimes(2));
});

it('flags a transition that carries a budget check, before it is even clicked', async () => {
  api.getProject.mockResolvedValue({
    ...baseProject,
    transitions: [{ toPhaseCode: 'PROJECT_APPROVED', toPhaseNameTh: 'อนุมัติ', allowedForCaller: true, requiresBudgetCheck: true, allowedRoles: ['STUACT'] }],
  });
  show();

  expect(await screen.findByText('ขั้นตอนนี้มีการตรวจสอบงบประมาณ')).toBeInTheDocument();
});

it('asks for a signature before advancing a transition that requires one', async () => {
  api.getProject.mockResolvedValue({
    ...baseProject,
    transitions: [{ toPhaseCode: 'BUDGET_APPROVED', toPhaseNameTh: 'เงินโครงการอนุมัติ', allowedForCaller: true, requiresBudgetCheck: true, requiresSignature: true, allowedRoles: ['STUACT'] }],
  });
  mockSwalFire.mockResolvedValue({ isConfirmed: true });
  mockCaptureSignature.mockResolvedValue('data:image/png;base64,AAAA');
  api.transition.mockResolvedValue({ toPhase: { nameTh: 'เงินโครงการอนุมัติ' }, projectNumber: null, budgetWarnings: [] });
  show();

  await userEvent.click(await screen.findByText('เปลี่ยนเป็น “เงินโครงการอนุมัติ” →', { exact: false }));

  await waitFor(() => expect(mockCaptureSignature).toHaveBeenCalledWith('เปลี่ยนสถานะเป็น “เงินโครงการอนุมัติ”'));
  await waitFor(() =>
    expect(api.transition).toHaveBeenCalledWith('1', 'BUDGET_APPROVED', 'data:image/png;base64,AAAA')
  );
  // A successful transition reloads the page (api.getProject again) — wait
  // for that second fetch to settle too, or its state updates land after the
  // test (and its render tree) is already gone.
  await waitFor(() => expect(api.getProject).toHaveBeenCalledTimes(2));
});

it('sends nothing to the server when the signature dialog is cancelled', async () => {
  api.getProject.mockResolvedValue({
    ...baseProject,
    transitions: [{ toPhaseCode: 'BUDGET_APPROVED', toPhaseNameTh: 'เงินโครงการอนุมัติ', allowedForCaller: true, requiresBudgetCheck: true, requiresSignature: true, allowedRoles: ['STUACT'] }],
  });
  mockSwalFire.mockResolvedValue({ isConfirmed: true });
  mockCaptureSignature.mockResolvedValue(null);
  show();

  await userEvent.click(await screen.findByText('เปลี่ยนเป็น “เงินโครงการอนุมัติ” →', { exact: false }));

  await waitFor(() => expect(mockCaptureSignature).toHaveBeenCalled());
  expect(api.transition).not.toHaveBeenCalled();
});

it('never opens the signature pad for a transition that does not require one', async () => {
  api.getProject.mockResolvedValue({
    ...baseProject,
    transitions: [{ toPhaseCode: 'PENDING_ADVISOR', toPhaseNameTh: 'รออาจารย์', allowedForCaller: true, requiresBudgetCheck: false, requiresSignature: false, allowedRoles: ['SH'] }],
  });
  mockSwalFire.mockResolvedValue({ isConfirmed: true });
  api.transition.mockResolvedValue({ toPhase: { nameTh: 'รออาจารย์' }, projectNumber: null, budgetWarnings: [] });
  show();

  await userEvent.click(await screen.findByText('เปลี่ยนเป็น “รออาจารย์” →', { exact: false }));

  await waitFor(() => expect(api.transition).toHaveBeenCalledWith('1', 'PENDING_ADVISOR', null));
  expect(mockCaptureSignature).not.toHaveBeenCalled();
  // A successful transition reloads the page (api.getProject again) — wait
  // for that second fetch to settle too, or its state updates land after the
  // test (and its render tree) is already gone.
  await waitFor(() => expect(api.getProject).toHaveBeenCalledTimes(2));
});

it('flags a transition that requires a signature, before it is even clicked', async () => {
  api.getProject.mockResolvedValue({
    ...baseProject,
    transitions: [{ toPhaseCode: 'BUDGET_APPROVED', toPhaseNameTh: 'เงินโครงการอนุมัติ', allowedForCaller: true, requiresBudgetCheck: true, requiresSignature: true, allowedRoles: ['STUACT'] }],
  });
  show();

  expect(await screen.findByText('ขั้นตอนนี้ต้องเซ็นชื่ออนุมัติ')).toBeInTheDocument();
});

it('offers the advisor endorsement action only when the server granted it', async () => {
  api.getProject.mockResolvedValue({ ...baseProject, permissions: { edit: false, delete: false, endorseAsAdvisor: true } });
  mockCaptureSignature.mockResolvedValue('data:image/png;base64,AAAA');
  api.endorseAsAdvisor.mockResolvedValue({ endorsed: true });
  show();

  await userEvent.click(await screen.findByText('เซ็นรับรองโครงการ (อาจารย์ที่ปรึกษา)'));

  await waitFor(() =>
    expect(api.endorseAsAdvisor).toHaveBeenCalledWith('1', 'data:image/png;base64,AAAA')
  );
  // A successful endorsement reloads the page (api.getProject again) — wait
  // for that second fetch to settle too, or its state updates land after the
  // test (and its render tree) is already gone.
  await waitFor(() => expect(api.getProject).toHaveBeenCalledTimes(2));
});

it('does not send an endorsement when the signature dialog is cancelled', async () => {
  api.getProject.mockResolvedValue({ ...baseProject, permissions: { edit: false, delete: false, endorseAsAdvisor: true } });
  mockCaptureSignature.mockResolvedValue(null);
  show();

  await userEvent.click(await screen.findByText('เซ็นรับรองโครงการ (อาจารย์ที่ปรึกษา)'));

  await waitFor(() => expect(mockCaptureSignature).toHaveBeenCalled());
  expect(api.endorseAsAdvisor).not.toHaveBeenCalled();
});

it('hides the advisor endorsement action when the server did not grant it', async () => {
  api.getProject.mockResolvedValue({ ...baseProject, permissions: { edit: false, delete: false, endorseAsAdvisor: false } });
  show();

  await screen.findByText('โครงการตัวอย่าง');
  expect(screen.queryByText('เซ็นรับรองโครงการ (อาจารย์ที่ปรึกษา)')).not.toBeInTheDocument();
});

it('offers edit only when the server granted it', async () => {
  api.getProject.mockResolvedValue({ ...baseProject, permissions: { edit: true, delete: false } });
  show();

  expect(await screen.findByRole('link', { name: 'แก้ไขข้อมูล' })).toHaveAttribute('href', '/projects/1/edit');
});

it('offers no edit link when the server refused it', async () => {
  api.getProject.mockResolvedValue({ ...baseProject, permissions: { edit: false, delete: false } });
  show();

  await screen.findByText('โครงการตัวอย่าง');
  expect(screen.queryByRole('link', { name: 'แก้ไขข้อมูล' })).not.toBeInTheDocument();
});

it('deletes only after a second confirmation, then leaves for the project list', async () => {
  api.getProject.mockResolvedValue({ ...baseProject, permissions: { edit: false, delete: true } });
  mockSwalFire.mockResolvedValue({ isConfirmed: true });
  api.deleteProject.mockResolvedValue({});
  show();

  await userEvent.click(await screen.findByText('ลบโครงการ'));

  await waitFor(() => expect(api.deleteProject).toHaveBeenCalledWith('1'));
  expect(mockHistoryPush).toHaveBeenCalledWith('/projects');
});

it('splits attendance into planned and actual, each totalled on its own', async () => {
  api.getProject.mockResolvedValue({
    ...baseProject,
    sections: {
      ...baseProject.sections,
      attendance: [
        { id: 1, variant: 'PLANNED', attendee_type: 'STUDENT', headcount: 100 },
        { id: 2, variant: 'ACTUAL', attendee_type: 'STUDENT', headcount: 92 },
      ],
    },
  });
  show();

  expect(await screen.findByText('รวม 100 คน')).toBeInTheDocument();
  expect(screen.getByText('รวม 92 คน')).toBeInTheDocument();
});
