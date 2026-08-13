/**
 * ICIT SSO identity provider.
 *
 * Untested against the live service — there is no API access yet (Q3), and the
 * old `src/login.js` that called it is no longer on disk. The request shape
 * below is what `docs/DECISIONS.md:121` records: a bearer token from
 * `ICIT_TOKEN`, `scopes: "student,personel"`, and a second call for the user's
 * information. Treat it as a first draft to be checked against the real service,
 * not as verified behaviour; the response mapping lives in `../identity.js`.
 *
 * Two things this does that the old client did not: it bounds the request with a
 * timeout, and it distinguishes "wrong password" (return `null`) from "the
 * identity provider is broken" (throw), so a failing SSO cannot present itself
 * to the user as bad credentials.
 */
const axios = require('axios');
const { config } = require('../../config');

const TIMEOUT_MS = 10000;
const SCOPES = 'student,personel';

async function authenticate(username, password) {
  const headers = {
    Authorization: `Bearer ${config.icit.token}`,
    'Content-Type': 'application/json',
  };

  let auth;
  try {
    auth = await axios.post(
      config.icit.authentication,
      { username, password, scopes: SCOPES },
      { headers, timeout: TIMEOUT_MS, validateStatus: (s) => s < 500 }
    );
  } catch (err) {
    throw new Error(`ICIT authentication endpoint unreachable: ${err.message}`);
  }

  // 401/403, or a body that says failure, is a rejected credential.
  const status = String(auth.data?.api_status ?? '').toLowerCase();
  if (auth.status === 401 || auth.status === 403 || status === 'error' || status === 'fail') {
    return null;
  }
  if (auth.status >= 400) {
    throw new Error(`ICIT authentication returned HTTP ${auth.status}`);
  }

  // The authentication response carries the username; the information endpoint
  // carries the profile the `person` row is built from.
  let info;
  try {
    info = await axios.post(
      config.icit.information,
      { username },
      { headers, timeout: TIMEOUT_MS }
    );
  } catch (err) {
    throw new Error(`ICIT information endpoint failed for ${username}: ${err.message}`);
  }

  const body = info.data || {};
  return {
    api_status: body.api_status ?? auth.data?.api_status,
    api_message: body.api_message ?? auth.data?.api_message,
    userInfo: body.userInfo || body.userinfo || auth.data?.userInfo || {},
    studentInfo: body.studentInfo || body.studentinfo || {},
  };
}

module.exports = { name: 'icit', authenticate };
