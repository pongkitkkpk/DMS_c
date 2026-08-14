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
  login: (username, password) => client.post('/auth/login', { username, password }).then((r) => r.data),
  me: () => client.get('/me').then((r) => r.data),
  listProjects: (params) => client.get('/projects', { params }).then((r) => r.data),
  getProject: (id) => client.get(`/projects/${id}`).then((r) => r.data),
  transition: (id, toPhaseCode) =>
    client.post(`/projects/${id}/transitions`, { toPhaseCode }).then((r) => r.data),
  events: (id) => client.get(`/projects/${id}/events`).then((r) => r.data),
  phases: () => client.get('/reference/phases').then((r) => r.data),

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
};

/**
 * A budget refusal answers 422 with every violation, not just the first. The
 * message is already the right sentence — this is only for a screen that wants
 * to mark more than one field.
 */
export const violationsOf = (error) =>
  (error.response && error.response.data && error.response.data.budgetViolations) || [];
