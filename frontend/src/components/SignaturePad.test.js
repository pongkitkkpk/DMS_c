/**
 * `captureSignature` is a thin wrapper around one `Swal.fire` call — the
 * canvas drawing itself only runs inside a real `didOpen`/`preConfirm`
 * lifecycle, which a mocked SweetAlert2 never invokes. What is worth testing
 * from outside is the contract `ProjectPage` relies on: what title reaches
 * the dialog, and how its result maps to the promise `captureSignature`
 * resolves.
 */
import { captureSignature } from './SignaturePad';

const mockSwalFire = jest.fn();
jest.mock('sweetalert2', () => ({
  __esModule: true,
  default: { fire: (...args) => mockSwalFire(...args) },
}));

beforeEach(() => {
  jest.clearAllMocks();
});

it('titles the dialog with the action being signed for', async () => {
  mockSwalFire.mockResolvedValue({ isConfirmed: false });
  await captureSignature('เปลี่ยนสถานะเป็น "เงินโครงการอนุมัติ"');

  expect(mockSwalFire.mock.calls[0][0].title).toBe('เปลี่ยนสถานะเป็น "เงินโครงการอนุมัติ"');
});

it('resolves the drawn PNG when confirmed', async () => {
  const dataUrl = 'data:image/png;base64,AAAA';
  mockSwalFire.mockResolvedValue({ isConfirmed: true, value: dataUrl });

  await expect(captureSignature('เซ็นชื่อ')).resolves.toBe(dataUrl);
});

it('resolves null when the signer cancels', async () => {
  mockSwalFire.mockResolvedValue({ isConfirmed: false });

  await expect(captureSignature('เซ็นชื่อ')).resolves.toBeNull();
});

it('refuses to close on an empty canvas, via preConfirm returning false', async () => {
  mockSwalFire.mockImplementation((opts) => {
    // Simulate SweetAlert2 calling preConfirm before ever settling — an empty
    // canvas keeps the dialog open, which here means `Swal.fire` never
    // resolves from that click at all.
    expect(typeof opts.preConfirm).toBe('function');
    return new Promise(() => {}); // still open
  });

  const pending = captureSignature('เซ็นชื่อ');
  let settled = false;
  pending.then(() => { settled = true; });

  await Promise.resolve();
  expect(settled).toBe(false);
});
