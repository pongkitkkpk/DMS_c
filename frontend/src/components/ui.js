/**
 * Small presentational pieces shared by the screens.
 *
 * They carry no rules of their own — `PhasePill` colours a phase, it does not
 * decide anything about it. Anything that decides comes from the server.
 */
import React from 'react';

/**
 * Phase → tone. Four tones rather than seven colours: a rainbow would imply
 * seven unrelated states, when what the phases actually express is drafting →
 * waiting on someone → approved → finished.
 *
 * None of them is the brand red. The accent belongs to actions the user can
 * take; a status is not an action, and a red status would read as a problem.
 */
export const PHASE_TONE = {
  DRAFT_PROPOSAL: 'neutral',
  PROPOSAL_SUBMITTED: 'active',
  PROJECT_APPROVED: 'go',
  BUDGET_APPROVED: 'go',
  DRAFT_REPORT: 'neutral',
  REPORT_SUBMITTED: 'active',
  CLOSED: 'done',
};

/**
 * The four roles, in Thai. Here rather than beside one screen because the login
 * page names them before a session exists and the roles page names them after,
 * and two spellings of `STUACT` on two screens is how a system starts calling
 * the same job two things.
 */
export const ROLE_LABELS = {
  SH: 'หัวหน้านักศึกษา',
  AD: 'อาจารย์ที่ปรึกษา',
  STUACT: 'กองกิจการนักศึกษา',
  ADMIN: 'ผู้ดูแลระบบ',
};

export function PhasePill({ code, children }) {
  return <span className={`pill pill--${PHASE_TONE[code] || 'neutral'}`}>{children}</span>;
}

/**
 * Makes a whole `table-x` row open the same place its one real link does,
 * without stretching a pseudo-element over the `<tr>` (`position: relative`
 * on a table row is not a reliable containing block in every engine — on
 * iPad, both Safari and Chrome are WebKit, and WebKit was resolving that
 * stretched link's `inset: 0` against the page instead of the row, so every
 * tap opened whichever project was last in the list). Clicks that land on
 * the link itself are left alone, so opening in a new tab still works.
 */
export function rowLinkClick(history, to) {
  return (e) => {
    if (e.target.closest('a')) return;
    history.push(to);
  };
}

export function Pill({ tone = 'neutral', plain = false, children }) {
  return <span className={`pill pill--${tone}${plain ? ' pill--plain' : ''}`}>{children}</span>;
}

/** Initials for the avatar. Thai names have no case, so this is just the first glyph. */
export function Avatar({ name }) {
  return <span className="avatar">{(name || '?').trim().charAt(0)}</span>;
}

export function Card({ title, aside, children, className = '' }) {
  return (
    <section className={`card-x ${className}`}>
      {(title || aside) && (
        <header className="card-x__head">
          <span>{title}</span>
          {aside && <span className="u-spacer u-dim u-small">{aside}</span>}
        </header>
      )}
      <div className="card-x__body">{children}</div>
    </section>
  );
}

export function Empty({ mark = '—', title, hint }) {
  return (
    <div className="empty">
      <div className="empty__mark">{mark}</div>
      <div>{title}</div>
      {hint && <div className="u-small u-dim mt-1">{hint}</div>}
    </div>
  );
}

/**
 * A card whose own request failed, saying so and offering the way out.
 *
 * The alternative each card had before was to keep its `Skeleton` up, or to
 * render as though the server had answered with nothing — a card that says a
 * project has no attachments when what happened is that nobody could tell. Both
 * are indistinguishable from a slow answer and neither ends, which is the same
 * defect the session-expiry work fixed for whole pages (deviation 23); this is
 * it one level down, for a card whose request failed while the page around it
 * succeeded.
 *
 * `secondary`, not `danger`: the reader did nothing wrong, and red is for
 * errors they caused. A retry rather than a reload, because the rest of the
 * page is fine and reloading would throw it away.
 */
export function LoadFailed({ what, onRetry }) {
  return (
    <div className="alert alert-secondary u-small mb-0 u-row" role="status">
      <span>โหลด{what}ไม่สำเร็จ</span>
      {onRetry && (
        // An outline button, not a `btn-link`: this theme draws link buttons in
        // the muted text colour, so the one control on the card would have been
        // the one thing that did not look pressable.
        <button type="button" className="btn btn-sm btn-outline-secondary u-spacer"
          onClick={onRetry}>
          ลองใหม่
        </button>
      )}
    </div>
  );
}

/** Placeholder rows shaped like the content that is loading. */
export function Skeleton({ rows = 4 }) {
  return (
    <div className="u-stack" style={{ gap: 'var(--s-3)' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skel" style={{ width: `${100 - i * 7}%` }} />
      ))}
    </div>
  );
}

/**
 * The seven phases as a connected stepper.
 *
 * Steps before the current one are drawn as done. That is a presentation
 * choice, not an inference about history — the real record is the event log
 * on the project page.
 */
export function PhaseStepper({ phases, currentOrdinal }) {
  return (
    <div className="stepper">
      {phases.map((phase) => {
        const state =
          phase.ordinal < currentOrdinal ? 'done' : phase.ordinal === currentOrdinal ? 'current' : 'todo';
        return (
          <div key={phase.code} className={`step step--${state}`}>
            <span className="step__dot">{state === 'done' ? '✓' : phase.ordinal}</span>
            <span className="step__label">{phase.name_th}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Thai-formatted money. The API sends DECIMAL as a string so it cannot float-round. */
/**
 * `'2024-06-01'` or `'2026-08-17 00:03:18'` → the numbers in it.
 *
 * Every date the API sends is the string a `DATE` or `DATETIME` column holds,
 * with no timezone (see `backend/src/db/pool.js`). So they are read as digits
 * and handed to `new Date(y, m, d, …)`, which builds a local time from parts.
 * Never `new Date(string)`: it applies a UTC rule to date-only values and its
 * handling of a space-separated datetime is not something the language
 * guarantees at all.
 */
function partsOf(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(value));
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h || 0), Number(mi || 0));
}

/** A date as a Thai reader expects it — "1 มิ.ย. 2567", Buddhist year. */
export function calendarDate(value) {
  const at = value && partsOf(value);
  if (!at) return '—';
  return at.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The same, with the time — "1 มิ.ย. 2567 14:30". */
export function dateTime(value) {
  const at = value && partsOf(value);
  if (!at) return '—';
  return at.toLocaleString('th-TH', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function money(value) {
  if (value === null || value === undefined) return '—';
  return Number(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
