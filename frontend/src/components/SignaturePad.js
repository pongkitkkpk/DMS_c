/**
 * Capturing an e-signature — a canvas drawing exported to PNG, not a
 * cryptographic signature (docs/DECISIONS.md, "E-signature", closed
 * 2026-08-22). Opened as a SweetAlert2 prompt, the same library every other
 * confirmation in this app already uses (see `ReauthDialog.js`), so the
 * transition flow gains one more step without a second dialog pattern.
 *
 * `captureSignature` renders nothing itself and owns no component state — the
 * canvas and its drawing handlers live entirely inside the SweetAlert2
 * instance's own DOM, attached in `didOpen` and read back in `preConfirm`.
 * That is what makes this a single function `ProjectPage` can `await`,
 * matching the existing `Swal.fire(...).then(...)` shape used for the
 * confirm-before-advancing step next to it.
 */
import Swal from 'sweetalert2';

const CANVAS_ID = 'dms-signature-pad';
const WIDTH = 380;
const HEIGHT = 160;

/**
 * @param {string} actionLabel what is being signed, e.g. `เปลี่ยนสถานะเป็น
 *   "เงินโครงการอนุมัติ"` — shown as the dialog's title.
 * @returns {Promise<string|null>} a `data:image/png;base64,...` string, or
 *   `null` if the signer cancelled the dialog.
 */
export function captureSignature(actionLabel) {
  let canvas = null;
  let ctx = null;
  let drawing = false;
  let hasDrawn = false;

  const pointOf = (event) => {
    const rect = canvas.getBoundingClientRect();
    const source = event.touches && event.touches.length ? event.touches[0] : event;
    return { x: source.clientX - rect.left, y: source.clientY - rect.top };
  };

  const start = (event) => {
    event.preventDefault();
    drawing = true;
    hasDrawn = true;
    const { x, y } = pointOf(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (event) => {
    if (!drawing) return;
    event.preventDefault();
    const { x, y } = pointOf(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stop = () => { drawing = false; };

  const clear = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawn = false;
  };

  return Swal.fire({
    title: actionLabel,
    html: `
      <div class="u-small u-dim" style="margin-bottom:8px">
        วาดลายเซ็นด้วยเมาส์หรือนิ้ว แล้วกด “ยืนยันลายเซ็น”
      </div>
      <canvas id="${CANVAS_ID}" width="${WIDTH}" height="${HEIGHT}"
        style="border:1px solid var(--c-border, #ccc); border-radius:8px; touch-action:none; cursor:crosshair; background:#fff; max-width:100%"
      ></canvas>
    `,
    showCancelButton: true,
    showDenyButton: true,
    confirmButtonText: 'ยืนยันลายเซ็น',
    denyButtonText: 'ล้าง',
    cancelButtonText: 'ยกเลิก',
    reverseButtons: true,
    focusConfirm: false,
    // Returning `false` from `preDeny` is SweetAlert2's way of refusing to
    // close the popup — the same mechanism `preConfirm` below uses for "you
    // have not drawn anything yet". That is what makes "ล้าง" a clear button
    // rather than a second cancel: the dialog stays open, the canvas empties,
    // and the signer draws again in the same instance.
    preDeny: () => { clear(); return false; },
    didOpen: () => {
      canvas = document.getElementById(CANVAS_ID);
      ctx = canvas.getContext('2d');
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#1a1a1a';

      canvas.addEventListener('mousedown', start);
      canvas.addEventListener('mousemove', move);
      window.addEventListener('mouseup', stop);
      canvas.addEventListener('touchstart', start, { passive: false });
      canvas.addEventListener('touchmove', move, { passive: false });
      canvas.addEventListener('touchend', stop);
    },
    willClose: () => {
      window.removeEventListener('mouseup', stop);
    },
    preConfirm: () => {
      if (!hasDrawn) {
        Swal.showValidationMessage('กรุณาวาดลายเซ็นก่อนยืนยัน');
        return false;
      }
      return canvas.toDataURL('image/png');
    },
  }).then((result) => (result.isConfirmed ? result.value : null));
}
