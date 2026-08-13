/**
 * Routes and the app shell.
 *
 * React Router v5 to match the old frontend (Q9 — it is the behavioural spec,
 * and matching its libraries means screens port across rather than being
 * re-derived).
 */
import React from 'react';
import { BrowserRouter, Switch, Route, Redirect, Link, useHistory } from 'react-router-dom';
import { Navbar, NavbarBrand, Nav, NavItem, Button, Spinner, Badge } from 'reactstrap';

import { AuthProvider, useAuth } from './AuthContext';
import LoginPage from './pages/LoginPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectPage from './pages/ProjectPage';

/** Renders nothing until the session is known, so a reload cannot flash the login screen. */
function RequireAuth({ children }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="text-center p-5"><Spinner /></div>;
  if (!session) return <Redirect to="/login" />;
  return children;
}

function Header() {
  const { session, logout } = useAuth();
  const history = useHistory();
  if (!session) return null;

  return (
    <Navbar light expand="md" className="mb-4" style={{ background: 'var(--dms-surface)', borderBottom: '1px solid var(--dms-border)' }}>
      <NavbarBrand tag={Link} to="/projects">ระบบจัดการโครงการกิจกรรมนักศึกษา</NavbarBrand>
      <Nav className="ml-auto align-items-center" navbar>
        <NavItem className="mr-3">
          <span>{session.person.fullNameTh} </span>
          {/* The role is whatever the server resolved from `membership`. */}
          <Badge color="secondary">{session.role || 'ไม่มีสิทธิ์'}</Badge>
          {session.membership && session.membership.club_name && (
            <span className="dms-muted ml-2">{session.membership.club_name}</span>
          )}
        </NavItem>
        <NavItem>
          <Button size="sm" outline onClick={() => { logout(); history.push('/login'); }}>ออกจากระบบ</Button>
        </NavItem>
      </Nav>
    </Navbar>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Header />
        <div className="container pb-5">
          <Switch>
            <Route path="/login" component={LoginPage} />
            <Route path="/projects/:id" render={() => <RequireAuth><ProjectPage /></RequireAuth>} />
            <Route path="/projects" render={() => <RequireAuth><ProjectsPage /></RequireAuth>} />
            <Redirect to="/projects" />
          </Switch>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
