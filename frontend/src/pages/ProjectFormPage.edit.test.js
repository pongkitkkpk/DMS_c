/**
 * Loading an existing project into the edit form.
 *
 * `project.contacts` arrives compacted — a blank slot is dropped rather than
 * sent as an empty entry — so a project whose first coordinator was left
 * blank but whose second was filled in answers with a one-element array.
 * Reading it by position (`contacts[0]`) put that second coordinator's name
 * into the "ผู้ประสานงานคนที่ 1" box instead of คนที่ 2, and saving the form
 * again would have written it there for good. Each entry now carries which
 * box it came from (`slot`), and the load reads that instead of the index.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
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

const emptySections = Object.fromEntries(
  ['rationales', 'objectives', 'types', 'locations', 'activities', 'indicators', 'problems', 'attendance']
    .map((name) => [name, []])
);

beforeEach(() => {
  jest.clearAllMocks();
  api.tags.mockResolvedValue({ tagSets: [] });
  api.advisors.mockResolvedValue({ advisors: [] });
  api.limits.mockResolvedValue({ sections: {} });
  api.getProject.mockResolvedValue({
    name: 'โครงการเดิม',
    academicTerm: '1/2567',
    advisor: null,
    isNewProject: true,
    isContinueProject: false,
    prepareStartOn: null,
    prepareEndOn: null,
    eventStartOn: null,
    eventEndOn: null,
    reportDueOn: null,
    // Coordinator 1 was left blank; only coordinator 2 was ever filled in.
    contacts: [{ slot: 2, name: 'สมชาย ใจดี', phone: '0812345678' }],
    sections: { ...emptySections, tags: [] },
  });
});

it('puts a compacted contact back in the box it came from, not the first one', async () => {
  render(
    <MemoryRouter initialEntries={['/projects/7/edit']}>
      <Route path="/projects/:id/edit"><ProjectFormPage /></Route>
    </MemoryRouter>
  );

  const second = await screen.findByLabelText('ผู้ประสานงานคนที่ 2');
  expect(second).toHaveValue('สมชาย ใจดี');

  const first = screen.getByLabelText('ผู้ประสานงานคนที่ 1');
  expect(first).toHaveValue('');
});
