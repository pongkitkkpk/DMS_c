# DMS frontend

A first slice, not Phase 5. Enough screens to drive the Phase 2 API end to end:
log in, list the projects your membership can see, open one, and advance it
through the phase machine.

## Running

The API must be up first — see `../backend`.

```bash
cd frontend
npm install
npm start          # http://localhost:3000
```

`REACT_APP_API_BASE` overrides the API location (default `http://localhost:3001`).
The backend's `CORS_ORIGIN` must match wherever this runs.

In development the login screen lists the mock provider's fixture accounts; any
password works while `AUTH_PROVIDER=mock`.

## Two rules this code follows

**The role never comes from the browser.** The token lives in `sessionStorage`
because it has to live somewhere, but the role and the available transitions are
read from `GET /me` and `GET /projects/:id`. The old frontend read the user out
of `sessionStorage` and rendered every transition control from
`storedUser.position` — against endpoints that checked nothing, so editing one
browser value granted every capability. Hiding a button here is a convenience;
the refusal is the server's.

**Success is announced after the server answers.** The old screen fired four
unawaited requests and showed "สำเร็จ!" immediately, so a failed phase write was
reported to the user as a success.

## Theme

Chosen by the owner on 2026-08-14: **#AC3520**, KMUTNB's colour, as the single
accent, on warmed neutral greys, with IBM Plex Sans Thai for type.

`src/theme.css` is the whole design system — tokens first, then overrides of the
Bootstrap and SweetAlert2 classes. Components use `var(--c-*)` and never a
literal colour, radius or shadow, so re-theming is one file.

Two rules the palette follows:

- **The accent belongs to actions, never to status.** A phase pill is neutral,
  amber, green or slate; none of them is the brand red, because a red status
  reads as a problem.
- **Errors are a deeper, cooler red than the accent**, and are also marked by
  position, a left rule, and wording — a brand that is itself red cannot rely on
  hue alone to say "something went wrong".

Light only, per the "no dark mode" decision in the build plan. The tokens are
structured so a dark set could be added without touching a component.

## What is not here yet

Creating and editing projects, budget screens, document downloads, and the rest
of the screen list in `docs/DECISIONS.md` → "Old frontend screens". Phase 5
builds those, after Phase 3 (budget) and Phase 4 (documents) exist for them to
build on.
