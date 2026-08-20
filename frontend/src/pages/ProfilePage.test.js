/**
 * Read-only by design (see the page's own header comment), so what's worth
 * checking is that it never claims to be more than that: identity fields
 * read from `/me` rather than the cached session, a membership list that
 * tells the truth about an account holding nothing, and the "system uses
 * the first one" note that only makes sense once a second role exists.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';

import ProfilePage from './ProfilePage';
import { api } from '../api';

jest.mock('../api', () => ({
  api: { me: jest.fn() },
  messageOf: () => 'error',
}));

let mockSession = null;
jest.mock('../AuthContext', () => ({ useAuth: () => ({ session: mockSession }) }));

const person = {
  idStudent: 's6501234567890',
  prefix: 'นาย',
  fullNameTh: 'ทดสอบ ระบบ',
  email: 'test@kmutnb.ac.th',
  accountType: 'students',
  levelDesc: 'ปริญญาตรี',
  stuStatusDesc: 'กำลังศึกษา',
};

const oneMembership = {
  person,
  academicYear: 2567,
  memberships: [
    { id: 1, role: 'SH', club_name: 'ชมรมพุทธศาสน์', academic_year: 2567 },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
});

it('seeds from the cached session immediately, then replaces it once /me answers fresh', async () => {
  mockSession = { person: { fullNameTh: 'เก่า เก่า', idStudent: 'x' }, memberships: [] };
  let resolveMe;
  api.me.mockReturnValue(new Promise((resolve) => { resolveMe = resolve; }));
  render(<ProfilePage />);

  // The stale session copy renders first — /me hasn't answered yet.
  expect(screen.getAllByText('เก่า เก่า', { exact: false }).length).toBeGreaterThan(0);

  resolveMe(oneMembership);
  await screen.findAllByText('s6501234567890');
  expect(screen.queryByText('เก่า เก่า', { exact: false })).not.toBeInTheDocument();
});

it('renders an error rather than a blank page when /me fails', async () => {
  mockSession = null;
  api.me.mockRejectedValue(new Error('boom'));
  render(<ProfilePage />);

  expect(await screen.findByText('error')).toBeInTheDocument();
});

it('reads identity fields from the fresh /me response', async () => {
  mockSession = null;
  api.me.mockResolvedValue(oneMembership);
  render(<ProfilePage />);

  expect(await screen.findByText('นักศึกษา')).toBeInTheDocument();
  expect(screen.getByText('test@kmutnb.ac.th')).toBeInTheDocument();
  expect(screen.getAllByText('s6501234567890').length).toBeGreaterThan(0);
});

it('tells the truth about an account holding no membership this year', async () => {
  mockSession = null;
  api.me.mockResolvedValue({ ...oneMembership, memberships: [] });
  render(<ProfilePage />);

  expect(await screen.findByText('บัญชีนี้ไม่มีสิทธิ์ในปีการศึกษานี้')).toBeInTheDocument();
});

it('names the role summary and the advisor agency when a membership carries one', async () => {
  mockSession = null;
  api.me.mockResolvedValue({
    ...oneMembership,
    memberships: [
      {
        id: 1,
        role: 'AD',
        club_name: 'ชมรมพุทธศาสน์',
        academic_year: 2567,
        advisor_agency: 'ภาควิชาวิศวกรรมคอมพิวเตอร์',
      },
    ],
  });
  render(<ProfilePage />);

  expect(await screen.findByText(/ดูโครงการของชมรมที่เป็นที่ปรึกษา/)).toBeInTheDocument();
  expect(screen.getByText(/หน่วยงาน: ภาควิชาวิศวกรรมคอมพิวเตอร์/)).toBeInTheDocument();
});

it('only explains "first role decides scope" once a second role actually exists', async () => {
  mockSession = null;
  api.me.mockResolvedValue(oneMembership); // one membership
  render(<ProfilePage />);

  await screen.findByText('ชมรมพุทธศาสน์');
  expect(screen.queryByText('ระบบใช้สิทธิ์แรกในการตัดสินขอบเขตการเข้าถึง')).not.toBeInTheDocument();
});

it('explains "first role decides scope" once a second membership exists', async () => {
  mockSession = null;
  api.me.mockResolvedValue({
    ...oneMembership,
    memberships: [
      ...oneMembership.memberships,
      { id: 2, role: 'STUACT', club_group_name: 'กลุ่มที่ 1', academic_year: 2567 },
    ],
  });
  render(<ProfilePage />);

  expect(await screen.findByText('ระบบใช้สิทธิ์แรกในการตัดสินขอบเขตการเข้าถึง')).toBeInTheDocument();
});
