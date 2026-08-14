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
