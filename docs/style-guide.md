# DMS_C Style Guide — portable reference

Extracted from `frontend/src/theme.css` so the same look can be reproduced in
another project. Copy the sections you need; the design tokens are the part
worth keeping verbatim, everything else is a pattern to adapt.

## 1. Stack this is built on

- **Bootstrap 4.6** + **reactstrap 8** for base components (buttons, forms,
  alerts, modals via `reactstrap`).
- **SweetAlert2** for dialogs/confirmations, restyled to match (see §7).
- One CSS file (`theme.css`) that layers tokens + overrides on top of
  Bootstrap. No CSS-in-JS, no Tailwind — plain CSS custom properties.
- Font: **IBM Plex Sans Thai** (falls back to Noto Sans Thai, then system
  fonts). Swap for whatever font fits the new project's language/brand.

This approach (tokens as CSS variables, Bootstrap as the component skeleton,
one override file) is the reusable part — you don't need Bootstrap
specifically, but the pattern of "one small token file overriding a component
library" is what makes this easy to port.

## 2. Design philosophy

- **Modern admin look**, not stock Bootstrap: generous whitespace, hairline
  borders, soft shadows instead of heavy borders/gradients.
- **Light mode only** — tokens are structured so a dark palette could be
  added later without touching any component (every color is a variable, no
  component hardcodes a hex value).
- **Status is never color-alone.** Every colored state (warning, danger, OK)
  pairs its color with a mark, an icon, or explicit wording — important for
  accessibility and for readers who don't parse hue quickly.
- **Brand color is kept away from status colors.** If your brand color is a
  hue also used for a status (e.g. red = brand and red = error), separate
  them by depth/saturation, not just by being "different reds." Never reuse
  the brand color for a warning/error state.

## 3. Design tokens

```css
:root {
  /* --- ground and ink --- */
  --c-bg: #f8f7f6;          /* page background */
  --c-surface: #ffffff;      /* cards, inputs */
  --c-surface-2: #f3f1ef;    /* subtle recessed panels, table headers */
  --c-border: #eae6e3;       /* hairline dividers */
  --c-border-strong: #d9d2ce;/* input borders, stronger rules */
  --c-text: #1c1917;         /* primary text */
  --c-text-2: #5f5852;       /* secondary text, labels */
  --c-text-3: #928982;       /* tertiary/dim text */

  /* --- accent: swap this for the new project's brand color --- */
  --c-accent: #ac3520;
  --c-accent-hover: #8e2a19;
  --c-accent-soft: #fbeeea;  /* tinted background for badges/focus rings */
  --c-accent-ink: #7c2412;   /* text-on-soft-accent */

  /* --- status tones --- */
  --c-ok: #146c43;
  --c-ok-soft: #e7f4ec;
  --c-warn: #92620a;
  --c-warn-soft: #fcf3e3;
  --c-danger: #8a1c12;       /* deliberately not the accent hue */
  --c-danger-soft: #fbe9e7;
  --c-archive: #4a4744;      /* "finished/settled", not celebratory */
  --c-archive-soft: #eceae8;

  /* --- shape --- */
  --r-sm: 8px;
  --r-md: 12px;
  --r-lg: 16px;
  --r-pill: 999px;

  /* --- elevation --- */
  --shadow-sm: 0 1px 2px rgba(16, 24, 40, 0.05);
  --shadow-md: 0 4px 14px -4px rgba(16, 24, 40, 0.1), 0 2px 4px -2px rgba(16, 24, 40, 0.04);
  --shadow-lg: 0 16px 40px -12px rgba(16, 24, 40, 0.18);

  /* --- spacing scale (4px base) --- */
  --s-1: 4px;
  --s-2: 8px;
  --s-3: 12px;
  --s-4: 16px;
  --s-5: 24px;
  --s-6: 32px;
  --s-7: 48px;

  --font: 'IBM Plex Sans Thai', 'Noto Sans Thai', system-ui, -apple-system,
    'Segoe UI', Roboto, sans-serif;
}
```

**Porting rule:** only `--c-accent*` and `--font` should normally change
between projects. Everything else (greys, spacing, radii, shadows) is
brand-neutral and can be reused as-is — that's what keeps the "family
resemblance" between projects even with a different brand color.

### Ordinal data ramps (charts)

If a project needs a chart where values represent **stages of one thing**
(e.g. money: spent → committed → free), don't assign four unrelated hues.
Use one hue, 2–4 lightness steps, monotone (each step ≥ 0.06 lightness apart
from its neighbor), with the palest step still passing ~2:1 contrast against
the page background so it reads as a mark, not a tint. Reserve `--c-danger`
for genuine over-limit/error states rather than making it a ramp step, and
back it with a hatch pattern (not color alone) when it sits close in hue to
the ramp's darkest step:

```css
background-image: repeating-linear-gradient(
  45deg,
  rgba(255, 255, 255, 0.45) 0 3px,
  rgba(255, 255, 255, 0) 3px 7px
);
```

## 4. Base typography & utilities

```css
body {
  background: var(--c-bg);
  color: var(--c-text);
  font-family: var(--font);
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3, h4, h5, h6 { font-weight: 600; letter-spacing: -0.01em; color: var(--c-text); }
a { color: var(--c-accent); text-decoration: none; }
a:hover { color: var(--c-accent-hover); }

.u-muted { color: var(--c-text-2); }
.u-dim   { color: var(--c-text-3); }
.u-mono  { font-variant-numeric: tabular-nums; }  /* for numbers that must align in a column */
.u-small { font-size: 0.85rem; }
.u-stack { display: flex; flex-direction: column; gap: var(--s-4); }
.u-row   { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); }
.u-spacer { margin-left: auto; }
```

## 5. Layout shell (app bar + main)

Sticky, blurred top bar; content column capped at 1140px and centered.

```css
.app-bar {
  position: sticky; top: 0; z-index: 20;
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: saturate(1.4) blur(10px);
  border-bottom: 1px solid var(--c-border);
}
.app-bar__inner {
  max-width: 1140px; margin: 0 auto;
  padding: var(--s-3) var(--s-5);
  display: flex; flex-direction: column; gap: var(--s-2);
}
.app-main {
  max-width: 1140px; margin: 0 auto;
  padding: var(--s-6) var(--s-5) var(--s-7);
}
```

Two rows inside the bar: identity (brand + user chip) on top, navigation
links below on their own row. This is what let five nav links, a long brand
name, and a user chip coexist without any of them wrapping into a ragged
mid-word break — nothing in the bar wraps its own text; when space runs out,
one deliberate element (the brand's text label) disappears at a breakpoint
rather than everything shrinking at once.

```css
.app-brand__mark {   /* square logo mark */
  flex: none; width: 32px; height: 32px;
  border-radius: var(--r-sm);
  background: linear-gradient(135deg, var(--c-accent), #d4553c);
  color: #fff; display: grid; place-items: center;
  font-size: 0.8rem; font-weight: 700; letter-spacing: 0.02em;
}
.avatar {
  width: 32px; height: 32px; border-radius: 50%;
  background: var(--c-accent-soft); color: var(--c-accent-ink);
  display: grid; place-items: center; font-weight: 600; font-size: 0.9rem;
}
.app-nav__link {
  padding: var(--s-2) var(--s-3); border-radius: var(--r-sm);
  font-size: 0.9rem; color: var(--c-text-2); white-space: nowrap;
  transition: background 0.12s ease, color 0.12s ease;
}
.app-nav__link.is-current {
  background: var(--c-accent-soft); color: var(--c-accent-ink); font-weight: 600;
}
```

## 6. Core components

### Card

```css
.card-x { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--r-md); box-shadow: var(--shadow-sm); }
.card-x__head { padding: var(--s-4) var(--s-5); border-bottom: 1px solid var(--c-border); font-weight: 600; }
.card-x__body { padding: var(--s-5); }
```

### Pills (status badges)

```css
.pill { display: inline-flex; align-items: center; gap: var(--s-2); padding: 3px 10px; border-radius: var(--r-pill); font-size: 0.8rem; font-weight: 500; }
.pill::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.7; }
.pill--neutral { background: var(--c-surface-2); color: var(--c-text-2); }
.pill--active  { background: var(--c-warn-soft); color: var(--c-warn); }
.pill--go      { background: var(--c-ok-soft); color: var(--c-ok); }
.pill--done    { background: var(--c-archive-soft); color: var(--c-archive); }
.pill--brand   { background: var(--c-accent-soft); color: var(--c-accent-ink); }
```

### Stepper (for any multi-phase/workflow process)

Dots connected by a rail; done steps fill accent, current step gets a
focus-ring glow, future steps stay outlined grey. Scrolls horizontally on
narrow screens rather than wrapping.

```css
.stepper { display: flex; overflow-x: auto; }
.step { display: flex; flex-direction: column; align-items: center; min-width: 92px; flex: 1; position: relative; }
.step:not(:last-child)::after { content: ''; position: absolute; top: 13px; left: 50%; width: 100%; height: 2px; background: var(--c-border-strong); }
.step--done:not(:last-child)::after { background: var(--c-accent); }
.step__dot { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--c-surface); border: 2px solid var(--c-border-strong); color: var(--c-text-3); }
.step--done .step__dot { background: var(--c-accent); border-color: var(--c-accent); color: #fff; }
.step--current .step__dot { border-color: var(--c-accent); color: var(--c-accent-ink); box-shadow: 0 0 0 4px var(--c-accent-soft); }
```

### Data table

Columns size to content (not stretched); a wrapper handles horizontal
scroll instead of ever crushing a text column vertical. Title cells get a
`min-width` floor so unspaced scripts (e.g. Thai) don't wrap one syllable
per line.

```css
.table-x-wrap { overflow-x: auto; }
.table-x-wrap .table-x { width: auto; min-width: 100%; }
.table-x { width: 100%; border-collapse: separate; border-spacing: 0; }
.table-x th { text-align: left; font-size: 0.76rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--c-text-3); padding: var(--s-3) var(--s-5); background: var(--c-surface-2); border-bottom: 1px solid var(--c-border); }
.table-x td { padding: var(--s-4) var(--s-5); border-bottom: 1px solid var(--c-border); vertical-align: middle; }
.table-x tbody tr:hover { background: var(--c-surface-2); }
```

Row-as-link pattern: don't fake a full-row click target with CSS
positioning tricks (`position:absolute; inset:0` on a pseudo-element inside
a `<tr>`) — it's unreliable across engines. Use one real `<a>` in the title
cell and handle the row's own click via JS to call that link, so there's
still exactly one tab stop and one right-clickable URL.

### KPI row (headline numbers, no time axis)

```css
.kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--s-3); }
.kpi { padding: var(--s-4); border: 1px solid var(--c-border); border-radius: var(--r-md); background: var(--c-surface-2); }
.kpi__value { font-size: 1.3rem; font-weight: 600; font-variant-numeric: proportional-nums; }
```

Rule of thumb: a handful of single numbers with nothing to compare across a
category or time axis isn't a chart — display it as plain numbers in a grid,
not as a bar/donut chart pretending to show trend.

### Meter (a ratio against a limit)

```css
.meter__track { height: 8px; border-radius: 4px; overflow: hidden; }
.meter__fill { height: 100%; border-radius: 4px; transition: width 0.2s ease; }
.meter--ok   .meter__track { background: var(--c-ok-soft); }   .meter--ok   .meter__fill { background: var(--c-ok); }
.meter--near .meter__track { background: var(--c-warn-soft); } .meter--near .meter__fill { background: var(--c-warn); }
.meter--over .meter__track { background: var(--c-danger-soft); } .meter--over .meter__fill { background: var(--c-danger); }
```

The bar never draws past 100% even when the value is over the limit — cap
the fill and say "over by X" in the caption text instead.

### Notice / alert

Status is carried by a mark + wording, color is the third channel:

```css
.notice { display: flex; gap: var(--s-3); padding: var(--s-3) var(--s-4); border-radius: var(--r-sm); border: 1px solid transparent; font-size: 0.86rem; }
.notice--warn   { background: var(--c-warn-soft); color: var(--c-warn); border-color: rgba(146, 98, 10, 0.2); }
.notice--danger { background: var(--c-danger-soft); color: var(--c-danger); border-color: rgba(138, 28, 18, 0.2); }
```

### Timeline / event log

```css
.timeline { position: relative; padding-left: var(--s-5); }
.timeline::before { content: ''; position: absolute; left: 5px; top: 6px; bottom: 6px; width: 2px; background: var(--c-border); }
.tl-item { position: relative; padding-bottom: var(--s-4); }
.tl-item::before { content: ''; position: absolute; left: calc(-1 * var(--s-5) + 1px); top: 7px; width: 10px; height: 10px; border-radius: 50%; background: var(--c-surface); border: 2px solid var(--c-border-strong); }
.tl-item--phase::before { background: var(--c-accent); border-color: var(--c-accent); }
```

### Empty & loading states

```css
.empty { text-align: center; padding: var(--s-7) var(--s-5); color: var(--c-text-2); }
.empty__mark { font-size: 1.6rem; margin-bottom: var(--s-3); opacity: 0.5; }

/* Skeleton (not a bare spinner) — communicates "a table is coming" */
.skel { background: linear-gradient(90deg, var(--c-surface-2) 25%, #e9ecf2 37%, var(--c-surface-2) 63%); background-size: 400% 100%; animation: skel 1.3s ease-in-out infinite; border-radius: var(--r-sm); height: 14px; }
@keyframes skel { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
@media (prefers-reduced-motion: reduce) { .skel { animation: none; } }
```

## 7. Bootstrap/reactstrap overrides

If reusing Bootstrap 4 + reactstrap, override these classes so the framework
defaults don't leak through:

```css
.btn { border-radius: var(--r-sm); font-weight: 500; font-size: 0.92rem; padding: 0.45rem 1rem; box-shadow: none !important; }
.btn-primary { background: var(--c-accent); border-color: var(--c-accent); }
.btn-primary:hover, .btn-primary:focus, .btn-primary:active { background: var(--c-accent-hover); border-color: var(--c-accent-hover); }
.btn-primary:focus-visible { box-shadow: 0 0 0 4px var(--c-accent-soft) !important; }
/* Bootstrap keeps its own blue on disabled primary buttons unless you override it too: */
.btn-primary:disabled { background: var(--c-accent); border-color: var(--c-accent); opacity: 0.45; }

.form-control, .custom-select { border-radius: var(--r-sm); border-color: var(--c-border-strong); font-size: 0.95rem; padding: 0.5rem 0.75rem; height: auto; }
.form-control:focus, .custom-select:focus { border-color: var(--c-accent); box-shadow: 0 0 0 4px var(--c-accent-soft); }

label { font-size: 0.85rem; font-weight: 500; color: var(--c-text-2); }

.alert { border-radius: var(--r-md); border: 1px solid transparent; font-size: 0.92rem; }
.alert-danger { background: var(--c-danger-soft); color: var(--c-danger); border-left: 3px solid var(--c-danger); }
/* A neutral "notice" (e.g. session timeout) should NOT use alert-warning's yellow —
   that reads as the user's fault. Use a grey neutral instead: */
.alert-secondary { background: var(--c-surface-2); color: var(--c-text-2); border-left: 3px solid var(--c-border-strong); }
```

If using SweetAlert2 for dialogs, theme it too (it renders outside the React
tree so it needs its own block):

```css
.swal2-popup { border-radius: var(--r-lg) !important; font-family: var(--font) !important; box-shadow: var(--shadow-lg) !important; }
.swal2-styled.swal2-confirm { background: var(--c-accent) !important; border-radius: var(--r-sm) !important; }
.swal2-styled.swal2-cancel { background: var(--c-surface) !important; color: var(--c-text-2) !important; border: 1px solid var(--c-border-strong) !important; border-radius: var(--r-sm) !important; }
```

## 8. Responsive principles

1. **One deliberate step, not simultaneous shrinking.** When a bar/row runs
   out of room, pick one specific element to give way (hide, wrap, or
   truncate) rather than letting every child shrink at once — simultaneous
   shrinking tends to produce ragged multi-line collisions instead of a
   clean layout.
2. **`nowrap` always pairs with an `overflow` rule.** Text set to
   `white-space: nowrap` without a corresponding `overflow: hidden` (or a
   fixed container width) will paint over its neighbor instead of clipping.
3. **Forms: labels above inputs, not beside them**, when the UI supports a
   language with variable label lengths — a label column is either too wide
   for short labels or too narrow for long ones.
4. **Wrap `minmax()` floors in `min(px, 100%)`** for any grid track that
   must hold a fixed-width pair (e.g. name + phone number) so the floor
   itself doesn't overflow a narrow phone viewport.
5. Test real breakpoints, not just component isolation — issues in this
   codebase were consistently found "live" at 768px (tablet) and ~390px
   (phone), not in desktop-only review.

## 9. What to change per project

| Token | Change? |
|---|---|
| `--c-accent*` | Yes — swap to the new project's brand color, then re-derive `-hover` (darker), `-soft` (very light tint), `-ink` (dark text-on-soft) from it |
| `--font` | Yes — pick per project's language/brand |
| Greys (`--c-bg`, `--c-surface*`, `--c-border*`, `--c-text*`) | Usually keep, maybe re-warm/re-cool slightly to sit better with the new accent hue |
| Status colors (`--c-ok`, `--c-warn`, `--c-danger`, `--c-archive`) | Keep — these are convention-driven (green/amber/red), not brand-driven |
| Radii, shadows, spacing scale | Keep as-is, they're brand-neutral |
| Component classes (`.card-x`, `.pill`, `.stepper`, etc.) | Copy whichever ones the new project actually needs; skip domain-specific ones (money meter, budget lines) that don't apply |
