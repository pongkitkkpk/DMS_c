/**
 * The recovery path for a session that expires mid-write, over the page
 * rather than away from it. See `api.js` → `REAUTH_NEEDED_EVENT` for why a
 * write's 401 reaches here instead of the redirect a read's 401 still takes.
 *
 * Renders nothing itself — it is a listener that opens a SweetAlert2 prompt,
 * the same library every other confirmation in this app already uses, so this
 * does not introduce a second dialog pattern for one screen.
 */
import { useEffect } from 'react';
import Swal from 'sweetalert2';

import { useAuth } from '../AuthContext';
import { messageOf } from '../api';
import { REAUTH_NEEDED_EVENT } from '../api';

export default function ReauthDialog() {
  const { session, login } = useAuth();

  useEffect(() => {
    // Nothing to recover into if the session that failed is already gone —
    // `SESSION_LOST_EVENT` (a read's 401) already sent this browser to the
    // login screen, which unmounts this component along with everything else.
    if (!session) return undefined;

    const username = session.person.idStudent;
    const fullName = session.person.fullNameTh || username;

    const openPrompt = () => {
      // The failing request's own page always shows its own
      // "บันทึกไม่สำเร็จ" dialog in the same tick this event fires, and
      // SweetAlert2 only ever holds one instance — calling `fire` while one
      // is open replaces it rather than queuing. Waiting for that one to
      // close first is what makes the sequence "see the failure, dismiss it,
      // then get offered the fix" rather than a race that drops one of them.
      if (Swal.isVisible()) {
        setTimeout(openPrompt, 150);
        return;
      }

      Swal.fire({
        icon: 'warning',
        title: 'เซสชันหมดอายุ',
        html:
          `การบันทึกล่าสุดไม่สำเร็จเพราะเซสชันหมดอายุ — ข้อมูลที่พิมพ์ไว้ยังอยู่บนหน้านี้<br/>` +
          `เข้าสู่ระบบอีกครั้งในชื่อ <strong>${fullName}</strong> (${username}) เพื่อบันทึกต่อ`,
        input: 'password',
        inputLabel: 'รหัสผ่าน',
        inputPlaceholder: '••••••••',
        inputAttributes: { autocomplete: 'current-password' },
        showCancelButton: true,
        confirmButtonText: 'เข้าสู่ระบบ',
        cancelButtonText: 'ยกเลิก',
        reverseButtons: true,
        // A cancel or an outside click leaves things exactly as deviation 23
        // already left them: the form is intact, and the first read after this
        // — any nav click, any reload — still makes the trip to the login
        // screen on its own.
        allowOutsideClick: () => !Swal.isLoading(),
        showLoaderOnConfirm: true,
        preConfirm: async (password) => {
          try {
            const me = await login(username, password);
            // The username field above is fixed, never typed — this can only
            // fail if a future change makes it editable, and is kept as the
            // one place that promise is actually checked rather than assumed.
            if (me.person.idStudent !== username) {
              throw new Error('บัญชีที่เข้าสู่ระบบไม่ใช่บัญชีเดิม — กรุณาลองใหม่');
            }
          } catch (err) {
            Swal.showValidationMessage(messageOf(err));
          }
        },
      }).then((result) => {
        if (result.isConfirmed) {
          Swal.fire({
            icon: 'success',
            title: 'เข้าสู่ระบบใหม่แล้ว',
            text: 'กดปุ่มเดิมอีกครั้งเพื่อบันทึกต่อ',
            timer: 1800,
            showConfirmButton: false,
          });
        }
      });
    };

    // The failing request's own page calls its `Swal.fire` synchronously in
    // the same tick as this event — a fixed head start rather than opening on
    // the very first (certainly still-invisible) check is what lets that
    // dialog win the race to open first every time, not just usually.
    const onNeeded = () => setTimeout(openPrompt, 50);

    window.addEventListener(REAUTH_NEEDED_EVENT, onNeeded);
    return () => window.removeEventListener(REAUTH_NEEDED_EVENT, onNeeded);
  }, [session, login]);

  return null;
}
