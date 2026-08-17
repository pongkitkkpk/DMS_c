/**
 * Routes and the app shell.
 *
 * React Router v5 to match the old frontend (Q9 — it is the behavioural spec,
 * and matching its libraries means screens port across rather than being
 * re-derived).
 */
import React from 'react';
import { BrowserRouter, Switch, Route, Redirect, Link, NavLink, useHistory, useLocation } from 'react-router-dom';
import { Button } from 'reactstrap';

import { AuthProvider, useAuth } from './AuthContext';
import { Avatar, Pill, Skeleton } from './components/ui';
import LoginPage from './pages/LoginPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectPage from './pages/ProjectPage';
import ProjectFormPage from './pages/ProjectFormPage';
import DashboardPage from './pages/DashboardPage';
import AllocationsPage from './pages/AllocationsPage';
import HistoryPage from './pages/HistoryPage';
import SpendingPage from './pages/SpendingPage';
import RolesPage from './pages/RolesPage';
import ProfilePage from './pages/ProfilePage';

/**
 * The nav, in the order a year is worked through: what is happening now, the
 * projects it is made of, the money behind them, the years before, and who may
 * do any of it.
 *
 * This was the last of the four parked features on purpose — a menu designed
 * before the screens exist is a guess about what belongs in it. Only `/roles`
 * is filtered, and by the same two roles the server enforces: allocations and
 * the year summary are readable by everybody in scope (Q30 — a student may see
 * their own club's ceiling, they simply cannot set it), so hiding them would
 * make the nav claim a restriction the API does not have.
 *
 * `roles: undefined` means everyone, including a person holding no membership
 * at all — they will find every list empty, which is the honest answer rather
 * than a nav that pretends the pages are not there.
 */
const NAV = [
  { to: '/dashboard',   label: 'ภาพรวม' },
  { to: '/projects',    label: 'โครงการ' },
  { to: '/allocations', label: 'วงเงินจัดสรร' },
  // Filtered by the same two roles the server enforces on `GET /api/spending`.
  // A cross-club comparison is the view of somebody responsible for more than
  // one club; a student and an adviser read their own ceiling on the
  // allocations screen instead (Q30).
  { to: '/spending',    label: 'สรุปการใช้เงิน', roles: ['ADMIN', 'STUACT'] },
  { to: '/history',     label: 'สรุปรายปี' },
  { to: '/roles',       label: 'สิทธิ์', roles: ['ADMIN', 'STUACT'] },
];

/**
 * Renders nothing until the session is known, so a reload cannot flash the login
 * screen.
 *
 * The redirect carries where the user was, because otherwise the login screen
 * cannot put them back and everybody lands on `/projects`. That is not a
 * nicety: `/spending?year=2566` and `/projects/12` are pages meant to be *sent*
 * to somebody — the spending screen keeps its year in the URL for exactly that
 * reason — and a link that quietly delivers the project list instead looks like
 * a link that worked.
 *
 * Not carried after a deliberate sign-out. Signing out is a handover: the next
 * person to sign in on this browser did not ask for the page the last one was
 * reading, and sending them there can only produce a 403 the system then has to
 * explain.
 */
function RequireAuth({ children }) {
  const { session, loading, ended } = useAuth();
  const location = useLocation();
  if (loading) {
    return <div className="card-x card-x__body" style={{ padding: 'var(--s-6)' }}><Skeleton rows={5} /></div>;
  }
  if (!session) {
    return (
      <Redirect
        to={{
          pathname: '/login',
          state: ended === 'signed-out'
            ? undefined
            : { from: `${location.pathname}${location.search}` },
        }}
      />
    );
  }
  return children;
}

function AppBar() {
  const { session, logout } = useAuth();
  const history = useHistory();
  if (!session) return null;

  const scope =
    (session.membership &&
      (session.membership.club_name || session.membership.club_group_name || session.membership.agency_name)) ||
    null;

  return (
    <header className="app-bar">
      <div className="app-bar__inner">
        {/* Two rows, measured rather than guessed. Brand, user and sign-out
            come to 680px and the five nav entries to 400; with gaps and
            padding that is 1192 against a container capped at 1140, so on one
            row it overflowed at every viewport width — the cap means a wider
            screen never helps. Giving the nav its own row keeps every label
            whole instead of hiding the app's own name to buy 200px. */}
        <div className="app-bar__top">
        {/* Named explicitly rather than left to be assembled from the subtree.
            The contents are a mark, a title and the year in separate elements,
            which concatenate into
            "มจพระบบจัดการโครงการกิจกรรมนักศึกษาปีการศึกษา 2567" — one
            unpunctuated run where the reader wanted "where does this go". */}
        <Link to="/projects" className="app-brand" aria-label="หน้าแรก · ระบบจัดการโครงการกิจกรรมนักศึกษา">
          <span className="app-brand__mark">มจพ</span>
          <span className="app-brand__text">
            {/* The full name gives way before the nav does. Below the layout's
                own width the mark and the year still say where you are, and
                five Thai nav labels need the room more than a title nobody
                reads twice. */}
            <span className="app-brand__name">ระบบจัดการโครงการกิจกรรมนักศึกษา</span>
            <span className="d-block u-small u-dim" style={{ fontWeight: 400, lineHeight: 1.2 }}>
              ปีการศึกษา {session.academicYear}
            </span>
          </span>
        </Link>

        <div className="u-spacer" />

        <Link
          to="/profile"
          className="user-chip"
          style={{ textDecoration: 'none', color: 'inherit' }}
          aria-label={`บัญชีของฉัน · ${session.person.fullNameTh} · ${session.role || 'ไม่มีสิทธิ์'}${scope ? ` · ${scope}` : ''}`}
        >
          <Avatar name={session.person.fullNameTh} />
          <span className="u-small d-none d-md-block">
            {session.person.fullNameTh}
            <span className="d-block u-dim">{scope || 'ไม่ได้สังกัดหน่วยงาน'}</span>
          </span>
          {/* The role is whatever the server resolved from `membership`. */}
          <Pill tone={session.role ? 'brand' : 'neutral'} plain>
            {session.role || 'ไม่มีสิทธิ์'}
          </Pill>
        </Link>

        <Button
          size="sm"
          outline
          color="secondary"
          style={{ whiteSpace: 'nowrap' }}
          onClick={() => { logout(); history.push('/login'); }}
        >
          ออกจากระบบ
        </Button>
        </div>

        <nav className="app-nav">
          {NAV.filter((item) => !item.roles || item.roles.includes(session.role)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className="app-nav__link"
              activeClassName="is-current"
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppBar />
        <main className="app-main">
          <Switch>
            <Route path="/login" component={LoginPage} />
            {/* Order matters in Router v5: `/projects/new` would otherwise be
                matched by `/projects/:id` and load a project called "new". */}
            <Route exact path="/projects/new" render={() => <RequireAuth><ProjectFormPage /></RequireAuth>} />
            <Route exact path="/projects/:id/edit" render={() => <RequireAuth><ProjectFormPage /></RequireAuth>} />
            <Route exact path="/projects/:id" render={() => <RequireAuth><ProjectPage /></RequireAuth>} />
            <Route exact path="/projects" render={() => <RequireAuth><ProjectsPage /></RequireAuth>} />
            <Route exact path="/dashboard" render={() => <RequireAuth><DashboardPage /></RequireAuth>} />
            {/* Reached from the dashboard card for now. It gets a nav entry
                when the officer's menu is built — that item is deliberately
                last, so the menu is designed around screens that exist. */}
            <Route exact path="/allocations" render={() => <RequireAuth><AllocationsPage /></RequireAuth>} />
            <Route exact path="/spending" render={() => <RequireAuth><SpendingPage /></RequireAuth>} />
            <Route exact path="/history" render={() => <RequireAuth><HistoryPage /></RequireAuth>} />
            <Route exact path="/roles" render={() => <RequireAuth><RolesPage /></RequireAuth>} />
            <Route exact path="/profile" render={() => <RequireAuth><ProfilePage /></RequireAuth>} />
            <Redirect to="/projects" />
          </Switch>
        </main>
      </BrowserRouter>
    </AuthProvider>
  );
}
