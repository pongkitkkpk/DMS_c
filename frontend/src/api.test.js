/**
 * `api.js` is the one place the browser talks to the API, and every other
 * test in this suite mocks it away wholesale — which means its own request/
 * response interceptors, `messageOf`, `filenameOf`, and `violationsOf` have
 * never actually run. The response interceptor in particular carries a real,
 * documented UX bug it fixes: a 401 used to render as a page-level error
 * while the app bar went on naming the signed-in user, and `/projects` kept
 * its loading skeleton forever. `axios` itself is mocked here (not `api.js`)
 * so the real interceptor bodies execute.
 */
let requestInterceptor;
let responseSuccess;
let responseError;

jest.mock('axios', () => ({
  create: jest.fn(() => ({
    interceptors: {
      request: { use: (fn) => { requestInterceptor = fn; } },
      response: { use: (success, error) => { responseSuccess = success; responseError = error; } },
    },
    get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn(),
  })),
}));

const {
  getToken, setToken, clearToken, SESSION_LOST_EVENT, REAUTH_NEEDED_EVENT,
  messageOf, filenameOf, violationsOf,
} = require('./api');

beforeEach(() => {
  sessionStorage.clear();
});

describe('request interceptor', () => {
  test('adds a bearer token when one is stored', () => {
    setToken('abc123');
    const config = requestInterceptor({ headers: {} });
    expect(config.headers.Authorization).toBe('Bearer abc123');
  });

  test('sends no Authorization header when signed out', () => {
    clearToken();
    const config = requestInterceptor({ headers: {} });
    expect(config.headers.Authorization).toBeUndefined();
  });
});

describe('response interceptor — 401 handling', () => {
  const error401 = (method, url) => ({
    response: { status: 401 },
    config: { method, url },
  });

  let onSessionLost;
  let onReauthNeeded;
  beforeEach(() => {
    onSessionLost = jest.fn();
    onReauthNeeded = jest.fn();
    window.addEventListener(SESSION_LOST_EVENT, onSessionLost);
    window.addEventListener(REAUTH_NEEDED_EVENT, onReauthNeeded);
  });
  afterEach(() => {
    window.removeEventListener(SESSION_LOST_EVENT, onSessionLost);
    window.removeEventListener(REAUTH_NEEDED_EVENT, onReauthNeeded);
  });

  test('a 401 on a read (GET) clears the token and fires SESSION_LOST — costs nothing, there was nothing typed', async () => {
    setToken('abc123');
    await expect(responseError(error401('get', '/projects'))).rejects.toBeDefined();

    expect(getToken()).toBeNull();
    expect(onSessionLost).toHaveBeenCalledTimes(1);
    expect(onReauthNeeded).not.toHaveBeenCalled();
  });

  test('a 401 on a write (POST) leaves the token alone and fires REAUTH_NEEDED instead — an in-progress form must survive', async () => {
    setToken('abc123');
    await expect(responseError(error401('post', '/projects/1/budget/approve'))).rejects.toBeDefined();

    expect(getToken()).toBe('abc123'); // still there, for ReauthDialog to read the signed-in person from
    expect(onReauthNeeded).toHaveBeenCalledTimes(1);
    expect(onSessionLost).not.toHaveBeenCalled();
  });

  test('/auth/* is exempt — a wrong password is a form message, not session loss for whoever else is signed in', async () => {
    setToken('someone-elses-token');
    await expect(responseError(error401('post', '/auth/login'))).rejects.toBeDefined();

    expect(getToken()).toBe('someone-elses-token');
    expect(onSessionLost).not.toHaveBeenCalled();
    expect(onReauthNeeded).not.toHaveBeenCalled();
  });

  test('a non-401 error passes through untouched', async () => {
    setToken('abc123');
    await expect(responseError({ response: { status: 500 }, config: { method: 'get', url: '/projects' } }))
      .rejects.toBeDefined();

    expect(getToken()).toBe('abc123');
    expect(onSessionLost).not.toHaveBeenCalled();
    expect(onReauthNeeded).not.toHaveBeenCalled();
  });

  test('still rejects the promise either way, so the caller’s own catch runs', async () => {
    await expect(responseError(error401('get', '/projects'))).rejects.toEqual(error401('get', '/projects'));
  });

  test('the response interceptor’s success handler is left undefined — errors are the only thing it touches', () => {
    expect(responseSuccess).toBeUndefined();
  });
});

describe('messageOf', () => {
  test('shows the server’s own message when there is one', () => {
    const error = { response: { data: { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' } } };
    expect(messageOf(error)).toBe('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  });

  test('names the API base and the page origin when the request never got a response', () => {
    const error = { request: {} };
    const message = messageOf(error);
    expect(message).toContain('ติดต่อเซิร์ฟเวอร์ไม่ได้');
    expect(message).toContain(window.location.origin);
  });

  test('falls back to the raw error message for anything else', () => {
    expect(messageOf({ message: 'boom' })).toBe('boom');
  });
});

describe('filenameOf', () => {
  test('decodes the UTF-8 filename* form of Content-Disposition', () => {
    const response = { headers: { 'content-disposition': `attachment; filename="x.docx"; filename*=UTF-8''${encodeURIComponent('กนศ.04-B123.docx')}` } };
    expect(filenameOf(response, 'fallback.docx')).toBe('กนศ.04-B123.docx');
  });

  test('falls back when the header is absent', () => {
    expect(filenameOf({ headers: {} }, 'fallback.docx')).toBe('fallback.docx');
  });
});

describe('violationsOf', () => {
  test('extracts the budgetViolations array from a 422', () => {
    const error = { response: { data: { budgetViolations: [{ code: 'REQUEST_OVER_PLAN' }] } } };
    expect(violationsOf(error)).toEqual([{ code: 'REQUEST_OVER_PLAN' }]);
  });

  test('defaults to an empty array for any other shape of error', () => {
    expect(violationsOf({ message: 'network down' })).toEqual([]);
    expect(violationsOf({})).toEqual([]);
  });
});
