/**
 * The one place the browser talks to the API.
 *
 * The token is kept in `sessionStorage` because it has to live somewhere, but
 * note what is *not* kept there: the user's role. The old frontend read
 * `sessionStorage.getItem("user")` and rendered every transition control from
 * `storedUser.position` (`ProjectDocument.js:28-29`), which meant editing one
 * browser value granted any capability — and the endpoints behind those
 * controls were unauthenticated anyway. Here the role always comes from
 * `GET /me`, and the server re-checks it on every request regardless of what
 * the client believes.
 */
import axios from 'axios';

const BASE = process.env.REACT_APP_API_BASE || 'http://localhost:3001';
const TOKEN_KEY = 'dms.token';

export const getToken = () => sessionStorage.getItem(TOKEN_KEY);
export const setToken = (token) => sessionStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => sessionStorage.removeItem(TOKEN_KEY);

const client = axios.create({ baseURL: `${BASE}/api` });

client.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/**
 * What the app listens for when the token it is holding stops being good.
 *
 * A `window` event rather than a callback registered by `AuthContext`, because
 * this module is imported by every page and loaded before React mounts: an event
 * has no initialisation order to get wrong, and no page needs to know that
 * session loss is something it could have caused.
 */
export const SESSION_LOST_EVENT = 'dms:session-lost';

/**
 * What the app listens for when a *write* dies to an expired session, as
 * opposed to a read (`SESSION_LOST_EVENT`, below). `ReauthDialog` is the
 * listener — it offers to sign back in over the current page rather than
 * sending the user through the login screen, which is the recovery path the
 * project owner asked for on 2026-08-21 (previously recorded as an open
 * question in DECISIONS.md → "Re-authenticating without leaving the page").
 */
export const REAUTH_NEEDED_EVENT = 'dms:reauth-needed';

/**
 * A 401 is the server saying the token is no longer good — expired, or issued to
 * a person who has since been removed. It is not a page-level error, and the
 * screens were treating it as one: every page rendered
 * "กรุณาเข้าสู่ระบบใหม่" in its own red alert while the app bar above it went on
 * naming the signed-in user, so the app both insisted you were signed in and
 * told you to sign in again — with no control that did it. `/projects` was worse
 * than that: it kept its "กำลังโหลด…" skeleton, so an ended session looked like
 * a slow one, indefinitely.
 *
 * **`/auth/*` is exempt, and that is the whole subtlety.** `POST /auth/login`
 * answers 401 for a wrong password (`routes/auth.js` —
 * "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"). That 401 is a message for the form, from
 * somebody who has no session to lose; treating it as session loss would wipe
 * the state of whoever was signed in when a second person mistyped a password on
 * the same browser, and would swallow the message the form exists to show.
 *
 * **Reads and writes now recover differently, and that is not arbitrary.** A GET
 * that comes back 401 has nothing in it the user typed, so bouncing to the login
 * screen costs them nothing — the token is dropped and `SESSION_LOST_EVENT`
 * fires, same as before. A failed *write* may be a project form with an hour of
 * work in it, and navigating away from it would destroy what is still on
 * screen — so the token is left alone (it is still what `ReauthDialog` reads the
 * signed-in person's identity from) and `REAUTH_NEEDED_EVENT` fires instead. The
 * page's own error dialog for that failed request still runs exactly as before;
 * the reauth dialog is a second, independent offer to fix the session sitting
 * underneath it. Once the dialog replaces the token, the button that failed is
 * there to be pressed again — no request is auto-replayed, because guessing at
 * that risks a silent double-submission on the one class of request this whole
 * feature exists to protect.
 */
client.interceptors.response.use(undefined, (error) => {
  const status = error.response && error.response.status;
  const url = (error.config && error.config.url) || '';
  const method = ((error.config && error.config.method) || 'get').toLowerCase();
  const isRead = method === 'get' || method === 'head';
  if (status === 401 && !url.startsWith('/auth/')) {
    if (isRead) {
      clearToken();
      window.dispatchEvent(new Event(SESSION_LOST_EVENT));
    } else {
      window.dispatchEvent(new Event(REAUTH_NEEDED_EVENT));
    }
  }
  // Still a rejection: the caller's own `catch` has to run, or a page that was
  // loading waits forever for a promise nobody settles.
  return Promise.reject(error);
});

/**
 * Server messages are already Thai and already specific — show them, don't
 * invent one.
 *
 * The no-response case names the API and the page's own origin, because the two
 * causes look identical from here — the API is down, or the browser blocked the
 * call because this origin is not in the backend's `CORS_ORIGIN`. Without the
 * origin printed, "ติดต่อเซิร์ฟเวอร์ไม่ได้" sends you to check a server that is
 * running perfectly well.
 */
export function messageOf(error) {
  if (error.response && error.response.data && error.response.data.error) {
    return error.response.data.error;
  }
  if (error.request) {
    return `ติดต่อเซิร์ฟเวอร์ไม่ได้ (API: ${BASE} · หน้านี้เปิดจาก: ${window.location.origin}) — ` +
      'ตรวจว่า backend รันอยู่ และ origin ด้านบนอยู่ใน CORS_ORIGIN ของ backend';
  }
  return error.message;
}

export const api = {
  /**
   * What the login screen is talking to — which provider, whether it wants a
   * shared password, and the demonstration accounts if there are any.
   *
   * Asked of the server rather than derived from `process.env.NODE_ENV` here:
   * that flag describes how this bundle was *built*, and `npm run build` always
   * sets it to production, which says nothing about whether the API on the
   * other end is running the mock.
   */
  authMode: () => client.get('/auth/mode').then((r) => r.data),
  login: (username, password) => client.post('/auth/login', { username, password }).then((r) => r.data),
  me: () => client.get('/me').then((r) => r.data),
  /** One year's money per club and per campus. Officers only; the server refuses. */
  spending: (params) => client.get('/spending', { params }).then((r) => r.data),
  listProjects: (params) => client.get('/projects', { params }).then((r) => r.data),
  getProject: (id) => client.get(`/projects/${id}`).then((r) => r.data),
  /**
   * `signatureImage` is a `data:image/png;base64,...` string from
   * `SignaturePad.captureSignature`, required exactly when the transition's
   * own `requiresSignature` flag is true — the server refuses it otherwise.
   */
  transition: (id, toPhaseCode, signatureImage) =>
    client.post(`/projects/${id}/transitions`, { toPhaseCode, signatureImage }).then((r) => r.data),
  events: (id) => client.get(`/projects/${id}/events`).then((r) => r.data),
  // Signatures captured on this project's approvals. There is no static URL
  // for the image, same rule as an attachment (Q21) — even though the bytes
  // are server-verified PNG and safe to render inline, the route is still
  // behind a bearer token, so the download is a fetch, not a bare `<img src>`.
  signatures: (id) => client.get(`/projects/${id}/signatures`).then((r) => r.data),
  downloadSignature: (id, signatureId) =>
    client.get(`/projects/${id}/signatures/${signatureId}`, { responseType: 'blob' }),
  phases: () => client.get('/reference/phases').then((r) => r.data),
  tags: () => client.get('/reference/tags').then((r) => r.data),
  advisors: () => client.get('/reference/advisors').then((r) => r.data),
  clubs: () => client.get('/reference/clubs').then((r) => r.data),
  // How many rows of each list the government forms can print. Served, not
  // hard-coded here: the numbers come from the templates themselves.
  limits: () => client.get('/reference/limits').then((r) => r.data),

  // Writes. `createProject` takes only the core row — the child lists need an
  // id to hang from, so the form saves them immediately after.
  createProject: (body) => client.post('/projects', body).then((r) => r.data),
  updateProject: (id, body) => client.patch(`/projects/${id}`, body).then((r) => r.data),
  deleteProject: (id) => client.delete(`/projects/${id}`).then((r) => r.data),
  /** Each child list is replaced whole — `ordinal` is the server's to assign. */
  saveSection: (id, section, items) =>
    client.put(`/projects/${id}/sections/${section}`, { items }).then((r) => r.data),
  saveTags: (id, tagIds) => client.put(`/projects/${id}/tags`, { tagIds }).then((r) => r.data),

  // Budget. `budget()` answers with the figures, the lines, the ledger, the
  // findings, and `permissions` — which controls this caller may use. The
  // client draws what the server says it may; it does not work that out from
  // the role, which is exactly what the old frontend did wrong.
  budget: (id) => client.get(`/projects/${id}/budget`).then((r) => r.data),
  setPlan: (id, plannedAmount) =>
    client.put(`/projects/${id}/budget/plan`, { plannedAmount }).then((r) => r.data),
  setLines: (id, variant, items) =>
    client.put(`/projects/${id}/budget/lines/${variant}`, { items }).then((r) => r.data),
  approveBudget: (id, approvedAmount) =>
    client.post(`/projects/${id}/budget/approve`, { approvedAmount }).then((r) => r.data),
  disburse: (id, body) => client.post(`/projects/${id}/disbursements`, body).then((r) => r.data),
  allocations: (params) => client.get('/allocations', { params }).then((r) => r.data),
  setAllocation: (body) => client.put('/allocations', body).then((r) => r.data),
  // Every year at once, summarised. Takes no parameters on purpose: the scope
  // is the caller's membership and there is nothing here a client may widen.
  history: () => client.get('/history').then((r) => r.data),
  // Officers only. Answers "has anyone set next year up yet", which nothing
  // else in the system would ever volunteer.
  readiness: () => client.get('/readiness').then((r) => r.data),
  // The year itself. Moving it is the one action that changes what every user
  // of the system may do, so the server guards it — see academicYearService.
  academicYear: () => client.get('/academic-year').then((r) => r.data),
  setAcademicYear: (year) =>
    client.put('/academic-year', { academicYear: year }).then((r) => r.data),

  // Roles. `people` is a search and refuses a short term — `person` is every
  // human who has ever signed in, and a listing endpoint would be a directory
  // export. `memberships` answers with what the caller may grant as well as
  // what exists, so the form never offers a choice the server will refuse.
  clubGroups: () => client.get('/reference/club-groups').then((r) => r.data),
  memberships: (params) => client.get('/memberships', { params }).then((r) => r.data),
  people: (q) => client.get('/people', { params: { q } }).then((r) => r.data),
  grantMembership: (body) => client.post('/memberships', body).then((r) => r.data),
  // Asked before revoking, not after: revoking an adviser leaves their club's
  // projects unable to be saved until a different adviser is named.
  membershipEvents: () => client.get('/memberships/events').then((r) => r.data),
  membershipImpact: (id) => client.get(`/memberships/${id}/impact`).then((r) => r.data),
  revokeMembership: (id) => client.delete(`/memberships/${id}`).then((r) => r.data),

  // Documents. `documents()` answers with both forms and, where one cannot be
  // produced, the server's own reason — too early in the phase machine, or more
  // rows than the government form has boxes for.
  // Attachments. There is no static URL for these — the bytes only come back
  // through an authorized request, so the download is a fetch, not an href.
  attachments: (id) => client.get(`/projects/${id}/attachments`).then((r) => r.data),
  uploadAttachment: (id, file) => {
    const form = new FormData();
    form.append('file', file);
    // Content-Type is left to the browser: it has to carry the multipart
    // boundary, and setting it by hand drops that and breaks the parse.
    return client.post(`/projects/${id}/attachments`, form).then((r) => r.data);
  },
  downloadAttachment: (id, attachmentId) =>
    client.get(`/projects/${id}/attachments/${attachmentId}`, { responseType: 'blob' }),
  deleteAttachment: (id, attachmentId) =>
    client.delete(`/projects/${id}/attachments/${attachmentId}`).then((r) => r.data),

  documents: (id) => client.get(`/projects/${id}/documents`).then((r) => r.data),
  documentUrl: (id, form) => `${BASE}/api/projects/${id}/documents/${form}`,
  /**
   * Fetch the file rather than pointing the browser at the URL: the download is
   * authenticated by a bearer token, and a plain `<a href>` sends no headers,
   * so it would answer 401 and the user would see a blank tab.
   */
  downloadDocument: (id, form) =>
    client.get(`/projects/${id}/documents/${form}`, { responseType: 'blob' }),
};

/** The filename the server chose, out of `Content-Disposition`'s UTF-8 form. */
export function filenameOf(response, fallback) {
  const header = response.headers['content-disposition'] || '';
  const match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  return match ? decodeURIComponent(match[1]) : fallback;
}

/**
 * A budget refusal answers 422 with every violation, not just the first. The
 * message is already the right sentence — this is only for a screen that wants
 * to mark more than one field.
 */
export const violationsOf = (error) =>
  (error.response && error.response.data && error.response.data.budgetViolations) || [];
