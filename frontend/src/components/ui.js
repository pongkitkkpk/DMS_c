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
const PHASE_TONE = {
  DRAFT_PROPOSAL: 'neutral',
  PROPOSAL_SUBMITTED: 'active',
  PROJECT_APPROVED: 'go',
  BUDGET_APPROVED: 'go',
  DRAFT_REPORT: 'neutral',
  REPORT_SUBMITTED: 'active',
  CLOSED: 'done',
};

export function PhasePill({ code, children }) {
  return <span className={`pill pill--${PHASE_TONE[code] || 'neutral'}`}>{children}</span>;
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
 * A timestamp as a Thai reader expects it — "1 มิ.ย. 2567 14:30".
 *
 * Unlike `ProjectPage`'s `date`, this takes a full DATETIME rather than a
 * date-only string, so parsing it is unambiguous and there is no UTC-midnight
 * trap to sidestep. Kept here because it is the shared home; the date-only
 * helper stays where its one caller is until something else needs it.
 */
export function dateTime(value) {
  if (!value) return '—';
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return '—';
  return at.toLocaleString('th-TH', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function money(value) {
  if (value === null || value === undefined) return '—';
  return Number(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
