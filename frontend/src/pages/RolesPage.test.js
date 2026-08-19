/**
 * Granting and revoking access — the one screen that creates authority
 * rather than spending it, so its gates matter more than most: who may even
 * open the form, which roles it lets them pick, and what it silently refuses
 * to submit before the server ever sees it (a หัวหน้าชมรม on a staff
 * account, an อาจารย์ที่ปรึกษา with no agency for กนศ.04).
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route } from 'react-router-dom';

import RolesPage from './RolesPage';
import { api } from '../api';

jest.mock('../api', () => ({
  api: {
    memberships: jest.fn(),
    clubs: jest.fn(),
    clubGroups: jest.fn(),
    membershipEvents: jest.fn(),
    people: jest.fn(),
    grantMembership: jest.fn(),
    revokeMembership: jest.fn(),
    membershipImpact: jest.fn(),
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

const club = { id: 28, code: 'A201', nameTh: 'ชมรมพุทธศาสน์' };
const group = { id: 1, nameTh: 'กรุงเทพฯ' };

const ownRow = { id: 5, person: { fullNameTh: 'สมศักดิ์ กิจการ', idStudent: 'fixture.stuact' },
  role: 'STUACT', club: null, jurisdiction: group, academicYear: 2567 };
const otherRow = { id: 11, person: { fullNameTh: 'สมชาย นักศึกษา', idStudent: 'fixture.student' },
  role: 'SH', club, jurisdiction: null, academicYear: 2567 };

function stubApi() {
  api.memberships.mockResolvedValue({
    grantableYears: [2567, 2568],
    grantableRoles: ['SH', 'AD'],
    items: [ownRow, otherRow],
  });
  api.clubs.mockResolvedValue({ clubs: [club] });
  api.clubGroups.mockResolvedValue({ clubGroups: [group] });
  api.membershipEvents.mockResolvedValue({ events: [] });
  api.membershipImpact.mockResolvedValue({ projects: 0 });
}

const session = (role) => ({
  role,
  academicYear: 2567,
  membership: { id: 5, jurisdiction_club_group_id: 1, club_group_name: 'กรุงเทพฯ' },
});

const show = (role) => {
  mockSession = session(role);
  return render(
    <MemoryRouter initialEntries={['/roles']}>
      <Route path="/roles"><RolesPage /></Route>
    </MemoryRouter>
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSwalFire.mockResolvedValue({ isConfirmed: true });
});

it('refuses a role with nothing to grant, before any request', async () => {
  show('SH');

  expect(await screen.findByText(/หน้านี้สำหรับผู้ดูแลระบบและกองกิจการนักศึกษาเท่านั้น/)).toBeInTheDocument();
  expect(api.memberships).not.toHaveBeenCalled();
});

it('shows a revoke button only for a row this session may actually grant', async () => {
  stubApi();
  show('STUACT');

  expect(await screen.findByText('สมศักดิ์ กิจการ')).toBeInTheDocument();
  // ownRow is STUACT, which is not in this session's own grantableRoles list
  // (`['SH', 'AD']`) — the same rule that keeps a STUACT from touching a
  // fellow STUACT's row also happens to cover the row this session is
  // itself acting under, since that row's role is STUACT too.
  expect(screen.queryByRole('button', { name: /ถอนสิทธิ์.*สมศักดิ์ กิจการ/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /ถอนสิทธิ์ หัวหน้านักศึกษา ของ สมชาย นักศึกษา/ })).toBeInTheDocument();
});

it('blocks granting หัวหน้าชมรม to a staff account before it ever reaches the server', async () => {
  stubApi();
  api.people.mockResolvedValue({
    people: [{ id: 9, prefix: '', fullNameTh: 'สมหญิง ที่ปรึกษา', idStudent: 'fixture.advisor', accountType: 'staff' }],
  });
  show('STUACT');

  await userEvent.type(await screen.findByPlaceholderText('อย่างน้อย 3 ตัวอักษร'), 'สมหญิง');
  await userEvent.click(await screen.findByText('สมหญิง ที่ปรึกษา'));
  await userEvent.selectOptions(screen.getByLabelText('สิทธิ์'), 'SH');
  await userEvent.selectOptions(screen.getByLabelText('ชมรม'), '28');

  expect(await screen.findByText(/หัวหน้าชมรมต้องเป็นบัญชีนักศึกษา/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'ให้สิทธิ์' })).toBeDisabled();
});

it('blocks granting อาจารย์ที่ปรึกษา with no agency, then enables once one is typed', async () => {
  stubApi();
  api.people.mockResolvedValue({
    people: [{ id: 9, prefix: '', fullNameTh: 'สมหญิง ที่ปรึกษา', idStudent: 'fixture.advisor', accountType: 'staff' }],
  });
  show('STUACT');

  await userEvent.type(await screen.findByPlaceholderText('อย่างน้อย 3 ตัวอักษร'), 'สมหญิง');
  await userEvent.click(await screen.findByText('สมหญิง ที่ปรึกษา'));
  await userEvent.selectOptions(screen.getByLabelText('สิทธิ์'), 'AD');
  await userEvent.selectOptions(screen.getByLabelText('ชมรม'), '28');

  const submit = screen.getByRole('button', { name: 'ให้สิทธิ์' });
  expect(submit).toBeDisabled();

  await userEvent.type(screen.getByLabelText('หน่วยงานต้นสังกัด'), 'กองกิจการนักศึกษา');
  expect(submit).toBeEnabled();
});

it('sends the confirmed grant with the right scope and a trimmed agency', async () => {
  stubApi();
  api.grantMembership.mockResolvedValue({});
  api.people.mockResolvedValue({
    people: [{ id: 9, prefix: '', fullNameTh: 'สมหญิง ที่ปรึกษา', idStudent: 'fixture.advisor', accountType: 'staff' }],
  });
  show('STUACT');

  await userEvent.type(await screen.findByPlaceholderText('อย่างน้อย 3 ตัวอักษร'), 'สมหญิง');
  await userEvent.click(await screen.findByText('สมหญิง ที่ปรึกษา'));
  await userEvent.selectOptions(screen.getByLabelText('สิทธิ์'), 'AD');
  await userEvent.selectOptions(screen.getByLabelText('ชมรม'), '28');
  await userEvent.type(screen.getByLabelText('หน่วยงานต้นสังกัด'), '  กองกิจการนักศึกษา  ');

  await userEvent.click(screen.getByRole('button', { name: 'ให้สิทธิ์' }));

  await waitFor(() => expect(api.grantMembership).toHaveBeenCalledWith({
    personId: 9,
    role: 'AD',
    academicYear: 2567,
    clubId: 28,
    jurisdictionClubGroupId: undefined,
    advisorAgency: 'กองกิจการนักศึกษา',
  }));
});

it('checks the impact before confirming a revoke, and only revokes on confirmation', async () => {
  stubApi();
  api.membershipImpact.mockResolvedValue({ projects: 2 });
  api.revokeMembership.mockResolvedValue({});
  show('STUACT');

  const button = await screen.findByRole('button', { name: /ถอนสิทธิ์ หัวหน้านักศึกษา ของ สมชาย นักศึกษา/ });
  await userEvent.click(button);

  await waitFor(() => expect(api.membershipImpact).toHaveBeenCalledWith(11));
  await waitFor(() => expect(api.revokeMembership).toHaveBeenCalledWith(11));
  // The number of affected projects is what makes the warning worth reading.
  expect(mockSwalFire).toHaveBeenCalledWith(expect.objectContaining({
    html: expect.stringContaining('2'),
  }));
});

it('does not revoke when the confirmation is dismissed', async () => {
  stubApi();
  mockSwalFire.mockResolvedValue({ isConfirmed: false });
  show('STUACT');

  const button = await screen.findByRole('button', { name: /ถอนสิทธิ์ หัวหน้านักศึกษา ของ สมชาย นักศึกษา/ });
  await userEvent.click(button);

  await waitFor(() => expect(api.membershipImpact).toHaveBeenCalled());
  expect(api.revokeMembership).not.toHaveBeenCalled();
});
