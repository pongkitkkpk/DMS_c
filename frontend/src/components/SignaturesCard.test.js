/**
 * `SignaturesCard` is the only place a captured signature is currently seen
 * at all (the owner deferred printing them onto กนศ.04/06 to a later change),
 * and it is the one card in this codebase whose thumbnail fetches an
 * authorized image and turns it into an object URL rather than a bare
 * `<img src>` — the same rule attachments follow (Q21). Nothing in this
 * codebase's existing suite mocks `URL.createObjectURL`, because no other
 * card's tests happen to exercise that path; these do, so it is mocked here.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import SignaturesCard from './SignaturesCard';
import { api } from '../api';

jest.mock('../api', () => ({
  api: {
    signatures: jest.fn(),
    downloadSignature: jest.fn(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  global.URL.createObjectURL = jest.fn(() => 'blob:mock-signature-url');
  global.URL.revokeObjectURL = jest.fn();
  // Every loaded signature renders a thumbnail, which always calls this —
  // give it a default so tests that aren't about the thumbnail don't have to.
  api.downloadSignature.mockResolvedValue({ data: new Blob(['png-bytes']) });
});

const signature = (overrides = {}) => ({
  id: 1,
  eventId: 10,
  signerName: 'สมชาย นักศึกษา',
  signerRole: 'SH',
  eventType: 'PHASE_CHANGED',
  toPhaseNameTh: 'ส่งข้อเสนอแล้ว',
  signedAt: '2026-08-18 21:10:00',
  ipAddress: '10.0.0.1',
  ...overrides,
});

describe('loading and failure', () => {
  it('shows a skeleton while the list loads', async () => {
    api.signatures.mockReturnValue(new Promise(() => {})); // never resolves
    render(<SignaturesCard projectId="1" />);

    expect(await screen.findByText('ลายเซ็นอนุมัติ')).toBeInTheDocument();
    expect(document.querySelector('.skel')).toBeInTheDocument();
  });

  it('says so, with a retry, when the request fails', async () => {
    api.signatures.mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ signatures: [signature()] });
    render(<SignaturesCard projectId="1" />);

    expect(await screen.findByText(/โหลดลายเซ็นไม่สำเร็จ/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));

    expect(await screen.findByText('สมชาย นักศึกษา', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/โหลดลายเซ็นไม่สำเร็จ/)).not.toBeInTheDocument();
  });
});

describe('no signatures yet', () => {
  it('renders nothing at all, rather than an empty-state card', async () => {
    api.signatures.mockResolvedValue({ signatures: [] });
    const { container } = render(<SignaturesCard projectId="1" />);

    await waitFor(() => expect(api.signatures).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe('a loaded signature', () => {
  it('shows the count, signer, role label, phase, and timestamp', async () => {
    api.signatures.mockResolvedValue({ signatures: [signature()] });
    render(<SignaturesCard projectId="1" />);

    expect(await screen.findByText('1 รายการ')).toBeInTheDocument();
    expect(screen.getByText(/สมชาย นักศึกษา/)).toBeInTheDocument();
    expect(screen.getByText(/หัวหน้านักศึกษา/)).toBeInTheDocument(); // ROLE_LABELS.SH
    expect(screen.getByText(/ส่งข้อเสนอแล้ว/)).toBeInTheDocument();
    expect(screen.getByText(/10\.0\.0\.1/)).toBeInTheDocument();
  });

  it('falls back to the raw role code for a role ROLE_LABELS does not know', async () => {
    api.signatures.mockResolvedValue({ signatures: [signature({ signerRole: 'MYSTERY' })] });
    render(<SignaturesCard projectId="1" />);

    expect(await screen.findByText(/MYSTERY/)).toBeInTheDocument();
  });

  it('omits the phase clause for a signature with no phase change (e.g. an advisor endorsement)', async () => {
    api.signatures.mockResolvedValue({
      signatures: [signature({ eventType: 'ADVISOR_ENDORSED', toPhaseNameTh: null })],
    });
    render(<SignaturesCard projectId="1" />);

    await screen.findByText(/สมชาย นักศึกษา/);
    expect(screen.queryByText(/อนุมัติเป็น/)).not.toBeInTheDocument();
  });
});

describe('the thumbnail', () => {
  it('shows a skeleton, then the image once the authorized download resolves', async () => {
    let resolveDownload;
    api.signatures.mockResolvedValue({ signatures: [signature()] });
    api.downloadSignature.mockReturnValue(new Promise((resolve) => { resolveDownload = resolve; }));
    render(<SignaturesCard projectId="1" />);
    await screen.findByText(/สมชาย นักศึกษา/);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    resolveDownload({ data: new Blob(['png-bytes']) });

    const img = await screen.findByRole('img', { name: 'ลายเซ็นของ สมชาย นักศึกษา' });
    expect(img).toHaveAttribute('src', 'blob:mock-signature-url');
  });

  it('revokes its object URL on unmount, so a card full of thumbnails does not leak memory', async () => {
    api.signatures.mockResolvedValue({ signatures: [signature()] });
    api.downloadSignature.mockResolvedValue({ data: new Blob(['png-bytes']) });
    const { unmount } = render(<SignaturesCard projectId="1" />);

    await screen.findByRole('img');
    unmount();

    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-signature-url');
  });
});
