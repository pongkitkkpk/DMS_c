/**
 * A stand-in for `db/pool.js`'s `pool.query`, dispatched by which query text a
 * caller sent rather than by call order — route tests exercise `loginThrottle`,
 * `identityService` and `academicYearService` in the same request, and their
 * queries do not always run in a fixed sequence (the throttle skips the address
 * check when there is no address, for instance).
 *
 * Route tests mock `../db/pool` (or `../../db/pool`) with `{ pool: createFakePool(state).pool }`
 * via `jest.doMock`, then read/assert on the returned `state` — see `routes/auth.test.js`.
 */
function normalize(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function createFakePool(overrides = {}) {
  const state = {
    usernameFailures: { failures: 0, retry_after: 1 },
    addressFailures: { failures: 0, retry_after: 1 },
    personRow: null,
    membershipRows: [],
    describeRows: [],
    describeError: null,
    recordedAttempts: [],
    ...overrides,
  };

  const query = jest.fn(async (sql, params = []) => {
    const text = normalize(sql);

    // Both throttle counts share the same `COUNT(*) ... FROM login_attempt`
    // shape; only the per-username one filters on `id_student =`.
    if (text.includes('FROM login_attempt') && text.includes('COUNT(*)')) {
      return [[text.includes('id_student = ?') ? state.usernameFailures : state.addressFailures]];
    }
    if (text.startsWith('INSERT INTO login_attempt')) {
      state.recordedAttempts.push({ idStudent: params[0], isSuccess: Boolean(params[1]), remoteIp: params[2] });
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith('INSERT INTO person')) {
      return [{ affectedRows: 1, insertId: 1 }];
    }
    if (text.includes('FROM person WHERE id_student') || text.includes('FROM person WHERE id = ?')) {
      return [state.personRow ? [state.personRow] : []];
    }
    if (text.includes('FROM membership m')) {
      return [state.membershipRows];
    }
    if (text.includes('FROM person p')) {
      if (state.describeError) throw state.describeError;
      return [state.describeRows];
    }

    throw new Error(`fakePool: unhandled query: ${text}`);
  });

  return { pool: { query }, state };
}

module.exports = { createFakePool };
