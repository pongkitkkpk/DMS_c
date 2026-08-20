/**
 * The project list — scoped entirely server-side (see the page's own header
 * comment: there is no club selector). What's worth checking from here is
 * the URL-carried filter behaviour: a phase or year arriving via the URL is
 * named on screen rather than silently shrinking the count, the two filters
 * survive each other, and the create button follows the role rather than
 * being a client-side decision that matters.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Switch } from 'react-router-dom';

import ProjectsPage from './ProjectsPage';
import { api } from '../api';

jest.mock('../api', () => ({
  api: { listProjects: jest.fn(), phases: jest.fn() },
  messageOf: () => 'error',
}));

let mockSession = null;
jest.mock('../AuthContext', () => ({ useAuth: () => ({ session: mockSession }) }));

const phases = [
  { code: 'DRAFT_PROPOSAL', ordinal: 1, name_th: 'ร่างคำขออนุมัติ' },
  { code: 'PROJECT_APPROVED', ordinal: 2, name_th: 'โครงการอนุมัติ' },
];

const oneItem = {
  total: 1,
  items: [
    {
      id: 5,
      name: 'โครงการทดสอบ',
      projectNumber: null,
      draftSequence: 3,
      club: { nameTh: 'ชมรมพุทธศาสน์' },
      phase: { code: 'DRAFT_PROPOSAL', nameTh: 'ร่างคำขออนุมัติ' },
    },
  ],
};

const show = (role, path = '/projects') => {
  mockSession = { role, membership: { club_name: 'ชมรมพุทธศาสน์' } };
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Route path="/projects"><ProjectsPage /></Route>
    </MemoryRouter>
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  api.phases.mockResolvedValue({ phases });
});

it('shows a real empty state, not an endless skeleton, for a scope with nothing', async () => {
  api.listProjects.mockResolvedValue({ total: 0, items: [] });
  show('SH');

  expect(await screen.findByText('ยังไม่มีโครงการในขอบเขตของบัญชีนี้')).toBeInTheDocument();
  expect(screen.getByText('หัวหน้านักศึกษาสามารถสร้างโครงการใหม่ได้')).toBeInTheDocument();
});

it('distinguishes "nothing in scope" from "nothing matches the filter"', async () => {
  api.listProjects.mockResolvedValue({ total: 0, items: [] });
  show('AD', '/projects?phase=PROJECT_APPROVED');

  expect(await screen.findByText('ไม่พบโครงการตามเงื่อนไขที่ค้นหา')).toBeInTheDocument();
});

it('renders an error rather than a blank list when the fetch fails', async () => {
  api.listProjects.mockRejectedValue(new Error('boom'));
  show('SH');

  expect(await screen.findByText('error')).toBeInTheDocument();
});

it('shows a draft label for a project with no project number yet', async () => {
  api.listProjects.mockResolvedValue(oneItem);
  show('SH');

  expect(await screen.findByText('ร่างที่ 3')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'โครงการทดสอบ' })).toHaveAttribute('href', '/projects/5');
});

it('names a year arriving through the URL rather than silently filtering by it', async () => {
  api.listProjects.mockResolvedValue(oneItem);
  show('SH', '/projects?year=2567');

  await screen.findByText('โครงการทดสอบ');
  expect(api.listProjects).toHaveBeenCalledWith(expect.objectContaining({ year: '2567' }));
  expect(screen.getByText('ปีการศึกษา 2567', { exact: false })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'ดูทุกปี' })).toHaveAttribute('href', '/projects');
});

it('keeps the year filter when the phase filter changes alongside it', async () => {
  api.listProjects.mockResolvedValue(oneItem);
  show('SH', '/projects?year=2567');
  await screen.findByText('โครงการทดสอบ');

  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'PROJECT_APPROVED' } });

  await waitFor(() =>
    expect(api.listProjects).toHaveBeenCalledWith(
      expect.objectContaining({ year: '2567', phase: 'PROJECT_APPROVED' })
    )
  );
});

it('offers the create button only to a student head, who alone may create', async () => {
  api.listProjects.mockResolvedValue({ total: 0, items: [] });
  show('AD');

  await screen.findByText('ยังไม่มีโครงการในขอบเขตของบัญชีนี้');
  expect(screen.queryByRole('link', { name: '+ สร้างโครงการ' })).not.toBeInTheDocument();
});

it('opens the row that was actually clicked, not just the row\'s own link', async () => {
  // Regression for a live bug: the row used to be made clickable by stretching
  // its `<a>` over the `<tr>` with CSS (`position: relative` + an absolutely
  // positioned `::after`). On iPad, both Safari and Chrome are WebKit, and
  // WebKit did not treat the `<tr>` as a containing block for that overlay —
  // every row's overlay landed on the whole page instead of its own row, so
  // whichever project was last in the list ate every tap, everywhere on the
  // screen. Clicking a non-link cell of the *first* row here must open the
  // first project, not the last one.
  api.listProjects.mockResolvedValue({
    total: 2,
    items: [
      { id: 1, name: 'โครงการหนึ่ง', projectNumber: null, draftSequence: 1,
        club: { nameTh: 'ชมรมหนึ่ง' }, phase: { code: 'DRAFT_PROPOSAL', nameTh: 'ร่างคำขออนุมัติ' } },
      { id: 2, name: 'โครงการสอง', projectNumber: null, draftSequence: 2,
        club: { nameTh: 'ชมรมสอง' }, phase: { code: 'DRAFT_PROPOSAL', nameTh: 'ร่างคำขออนุมัติ' } },
    ],
  });
  mockSession = { role: 'SH', membership: { club_name: 'ชมรมหนึ่ง' } };
  render(
    <MemoryRouter initialEntries={['/projects']}>
      <Switch>
        <Route exact path="/projects"><ProjectsPage /></Route>
        <Route path="/projects/:id" render={({ match }) => <div>เปิดโครงการ {match.params.id}</div>} />
      </Switch>
    </MemoryRouter>
  );

  await screen.findByText('โครงการหนึ่ง');
  // The club-name cell of the first row — not the row's own link.
  fireEvent.click(screen.getByText('ชมรมหนึ่ง'));

  expect(await screen.findByText('เปิดโครงการ 1')).toBeInTheDocument();
});

it('debounces a typed search rather than firing a request per keystroke', async () => {
  api.listProjects.mockResolvedValue(oneItem);
  show('SH');
  await screen.findByText('โครงการทดสอบ');
  api.listProjects.mockClear();

  const input = screen.getByPlaceholderText('ค้นหาชื่อ หรือเลขที่โครงการ');
  fireEvent.change(input, { target: { value: 'ท' } });
  fireEvent.change(input, { target: { value: 'ทด' } });
  fireEvent.change(input, { target: { value: 'ทดส' } });

  await waitFor(() =>
    expect(api.listProjects).toHaveBeenCalledWith(expect.objectContaining({ q: 'ทดส' }))
  );
  expect(api.listProjects).toHaveBeenCalledTimes(1);
});
