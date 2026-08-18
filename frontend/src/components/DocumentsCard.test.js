/**
 * The two government forms, and the difference between "no documents" and
 * "could not ask".
 *
 * Every project has both forms — there is no state in which this card is
 * legitimately empty — so the empty rendering it used to fall back to on a
 * failed request was a statement that could never be true.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';

import DocumentsCard from './DocumentsCard';
import { api } from '../api';

jest.mock('../api', () => ({
  api: { documents: jest.fn(), downloadDocument: jest.fn() },
  filenameOf: (_response, fallback) => fallback,
  messageOf: () => 'error',
}));

const mockSwalFire = jest.fn();
jest.mock('sweetalert2', () => ({
  __esModule: true,
  default: { fire: (...args) => mockSwalFire(...args) },
}));

const bothForms = {
  documents: [
    { form: 'temp04', code: 'กนศ.04', title: 'แบบเสนอโครงการ', available: true, violations: [] },
    {
      form: 'temp06',
      code: 'กนศ.06',
      title: 'แบบรายงานผลโครงการ',
      available: false,
      reason: 'กนศ.06 ออกได้ตั้งแต่สถานะ "ร่างสรุปผลโครงการ" เป็นต้นไป',
      violations: [],
    },
  ],
};

beforeEach(() => jest.clearAllMocks());

it('says it could not load, rather than drawing a project with no forms', async () => {
  api.documents.mockRejectedValue(new Error('boom'));
  render(<DocumentsCard projectId="1" />);

  expect(await screen.findByText(/โหลดรายการเอกสารไม่สำเร็จ/)).toBeInTheDocument();
  expect(screen.queryByText('กนศ.04')).not.toBeInTheDocument();
});

it('names each download button after its form, since both read the same', async () => {
  api.documents.mockResolvedValue(bothForms);
  render(<DocumentsCard projectId="1" />);

  expect(await screen.findByRole('button', { name: 'ดาวน์โหลด กนศ.04 แบบเสนอโครงการ' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'ดาวน์โหลด กนศ.06 แบบรายงานผลโครงการ' })).toBeInTheDocument();
});

it('disables a form the project is too early for, and says which phase it needs', async () => {
  api.documents.mockResolvedValue(bothForms);
  render(<DocumentsCard projectId="1" />);

  expect(await screen.findByRole('button', { name: /กนศ\.06/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: /กนศ\.04/ })).toBeEnabled();
  expect(screen.getByText(/ออกได้ตั้งแต่สถานะ/)).toBeInTheDocument();
});
