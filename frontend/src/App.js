/**
 * Routes and the app shell.
 *
 * React Router v5 to match the old frontend (Q9 — it is the behavioural spec,
 * and matching its libraries means screens port across rather than being
 * re-derived).
 */
import React from 'react';
import { BrowserRouter, Switch, Route, Redirect, Link, NavLink, useHistory } from 'react-router-dom';
import { Button } from 'reactstrap';

import { AuthProvider, useAuth } from './AuthContext';
import { Avatar, Pill, Skeleton } from './components/ui';
import LoginPage from './pages/LoginPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectPage from './pages/ProjectPage';
import ProjectFormPage from './pages/ProjectFormPage';
import DashboardPage from './pages/DashboardPage';
import ProfilePage from './pages/ProfilePage';

/** Renders nothing until the session is known, so a reload cannot flash the login screen. */
function RequireAuth({ children }) {
  const { session, loading } = useAuth();
  if (loading) {
    return <div className="card-x card-x__body" style={{ padding: 'var(--s-6)' }}><Skeleton rows={5} /></div>;
  }
  if (!session) return <Redirect to="/login" />;
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
        <Link to="/projects" className="app-brand">
          <span className="app-brand__mark">มจพ</span>
          <span>
            ระบบจัดการโครงการกิจกรรมนักศึกษา
            <span className="d-block u-small u-dim" style={{ fontWeight: 400, lineHeight: 1.2 }}>
              ปีการศึกษา {session.academicYear}
            </span>
          </span>
        </Link>

        <nav className="app-nav">
          <NavLink to="/dashboard" className="app-nav__link" activeClassName="is-current">ภาพรวม</NavLink>
          <NavLink to="/projects" className="app-nav__link" activeClassName="is-current">โครงการ</NavLink>
        </nav>

        <div className="u-spacer" />

        <Link to="/profile" className="user-chip" style={{ textDecoration: 'none', color: 'inherit' }}>
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
          onClick={() => { logout(); history.push('/login'); }}
        >
          ออกจากระบบ
        </Button>
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
            <Route exact path="/profile" render={() => <RequireAuth><ProfilePage /></RequireAuth>} />
            <Redirect to="/projects" />
          </Switch>
        </main>
      </BrowserRouter>
    </AuthProvider>
  );
}
