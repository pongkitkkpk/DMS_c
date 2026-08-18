/**
 * The attachments card, against the four things browser pass 9 found by hand.
 *
 * Every one of them was invisible to the 481 API assertions, because every one
 * is about what the page does with an answer rather than what the answer is.
 * These are the same findings, made repeatable.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import AttachmentsCard from './AttachmentsCard';
import { api } from '../api';

jest.mock('../api', () => ({
  api: {
    attachments: jest.fn(),
    uploadAttachment: jest.fn(),
    downloadAttachment: jest.fn(),
    deleteAttachment: jest.fn(),
  },
  filenameOf: (_response, fallback) => fallback,
  messageOf: (error) =>
    (error && error.response && error.response.data && error.response.data.error) || 'error',
}));

// The dialog is a real modal in the browser; here it is a promise whose answer
// each test states, so "asked before deleting" is something the test can see.
// The name has to start with `mock` — jest forbids a factory from reaching any
// other out-of-scope variable, because one that is not hoisted would be
// undefined by the time the module under test called it.
const mockSwalFire = jest.fn();
jest.mock('sweetalert2', () => ({
  __esModule: true,
  default: { fire: (...args) => mockSwalFire(...args) },
}));
const swal = { fire: mockSwalFire };

const listing = (attachments, canEdit = true) => ({
  attachments,
  canEdit,
  maxBytes: 10 * 1024 * 1024,
  allowedExtensions: ['.pdf', '.docx'],
});

const twoFiles = [
  { id: 1, originalName: 'รายงานการประชุม.pdf', byteSize: 69, uploadedByName: 'สมชาย นักศึกษา', uploadedAt: '2026-08-18 21:10:00' },
  { id: 2, originalName: 'ใบเสนอราคา.pdf', byteSize: 120, uploadedByName: 'สมชาย นักศึกษา', uploadedAt: '2026-08-18 21:11:00' },
];

beforeEach(() => {
  jest.clearAllMocks();
  swal.fire.mockResolvedValue({ isConfirmed: true });
});

describe('when the request for the list fails', () => {
  it('says so instead of animating a skeleton forever', async () => {
    api.attachments.mockRejectedValue(new Error('boom'));
    render(<AttachmentsCard projectId="1" />);

    expect(await screen.findByText(/โหลดไฟล์แนบไม่สำเร็จ/)).toBeInTheDocument();
  });

  it('offers a retry, and the retry fills the card in place', async () => {
    api.attachments.mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(listing(twoFiles));
    render(<AttachmentsCard projectId="1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'ลองใหม่' }));

    expect(await screen.findByText('รายงานการประชุม.pdf')).toBeInTheDocument();
    expect(screen.queryByText(/โหลดไฟล์แนบไม่สำเร็จ/)).not.toBeInTheDocument();
  });

  it('never renders an empty state, which would say the project has no files', async () => {
    api.attachments.mockRejectedValue(new Error('boom'));
    render(<AttachmentsCard projectId="1" />);

    await screen.findByText(/โหลดไฟล์แนบไม่สำเร็จ/);
    expect(screen.queryByText('ยังไม่มีไฟล์แนบ')).not.toBeInTheDocument();
  });
});

describe('the controls on each row', () => {
  it('name the file they act on, since their visible text repeats', async () => {
    api.attachments.mockResolvedValue(listing(twoFiles));
    render(<AttachmentsCard projectId="1" />);

    // Two buttons read "ดาวน์โหลด" and two read "×"; only the accessible name
    // says which file, and a reader using the buttons alone never reaches the
    // cell that would have told them.
    expect(await screen.findByRole('button', { name: 'ดาวน์โหลด รายงานการประชุม.pdf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ดาวน์โหลด ใบเสนอราคา.pdf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ลบไฟล์แนบ รายงานการประชุม.pdf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ลบไฟล์แนบ ใบเสนอราคา.pdf' })).toBeInTheDocument();
  });

  it('offers no delete to somebody who may not edit the project', async () => {
    api.attachments.mockResolvedValue(listing(twoFiles, false));
    render(<AttachmentsCard projectId="1" />);

    expect(await screen.findAllByRole('button', { name: /ดาวน์โหลด/ })).toHaveLength(2);
    expect(screen.queryAllByRole('button', { name: /ลบไฟล์แนบ/ })).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /แนบไฟล์/ })).not.toBeInTheDocument();
  });
});

describe('deleting', () => {
  it('asks first, naming the file in the question', async () => {
    api.attachments.mockResolvedValue(listing(twoFiles));
    api.deleteAttachment.mockResolvedValue({ deleted: 1 });
    render(<AttachmentsCard projectId="1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'ลบไฟล์แนบ รายงานการประชุม.pdf' }));

    await waitFor(() => expect(swal.fire).toHaveBeenCalled());
    expect(swal.fire.mock.calls[0][0].text).toBe('รายงานการประชุม.pdf');
  });

  it('deletes nothing when the question is answered no', async () => {
    swal.fire.mockResolvedValue({ isConfirmed: false });
    api.attachments.mockResolvedValue(listing(twoFiles));
    render(<AttachmentsCard projectId="1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'ลบไฟล์แนบ รายงานการประชุม.pdf' }));

    await waitFor(() => expect(swal.fire).toHaveBeenCalled());
    expect(api.deleteAttachment).not.toHaveBeenCalled();
  });

  it('tells the page, so the record beside it stops showing a file that is gone', async () => {
    api.attachments.mockResolvedValue(listing(twoFiles));
    api.deleteAttachment.mockResolvedValue({ deleted: 1 });
    const onChanged = jest.fn();
    render(<AttachmentsCard projectId="1" onChanged={onChanged} />);

    fireEvent.click(await screen.findByRole('button', { name: 'ลบไฟล์แนบ รายงานการประชุม.pdf' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});

describe('uploading', () => {
  const choose = (container, file) => {
    const input = container.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [file] } });
    return input;
  };

  it('shows the server\'s own sentence when the file is refused', async () => {
    api.attachments.mockResolvedValue(listing([]));
    api.uploadAttachment.mockRejectedValue({
      response: { data: { error: 'ไม่รองรับไฟล์ชนิดนี้ (.exe) — รองรับ .pdf .docx' } },
    });
    const { container } = render(<AttachmentsCard projectId="1" />);
    await screen.findByText('ยังไม่มีไฟล์แนบ');

    choose(container, new File(['x'], 'notes.exe'));

    await waitFor(() => expect(swal.fire).toHaveBeenCalled());
    const dialog = swal.fire.mock.calls[0][0];
    expect(dialog.title).toBe('อัปโหลดไม่สำเร็จ');
    expect(dialog.text).toMatch(/ไม่รองรับไฟล์ชนิดนี้ \(\.exe\)/);
  });

  it('clears the input so the same file can be chosen twice running', async () => {
    api.attachments.mockResolvedValue(listing([]));
    api.uploadAttachment.mockResolvedValue({ id: 9 });
    const { container } = render(<AttachmentsCard projectId="1" />);
    await screen.findByText('ยังไม่มีไฟล์แนบ');

    const input = choose(container, new File(['x'], 'a.pdf'));

    await waitFor(() => expect(api.uploadAttachment).toHaveBeenCalled());
    expect(input.value).toBe('');
  });
});
