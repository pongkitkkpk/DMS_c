/**
 * Mock identity provider (Q3 — there is no ICIT API access yet).
 *
 * It answers with ICIT's response *shape*, not with an internal object, so the
 * normalization in `../identity.js` is exercised on every development login
 * rather than lying dormant until the real provider is wired up.
 *
 * The directory below mirrors the four fixture people seeded by
 * `src/db/seeds/fixtures.js`. It carries identity only — no role. Which role
 * each of them actually holds is decided by their `membership` rows, so
 * changing a role here would change nothing, which is the point.
 */
const DIRECTORY = {
  'fixture.student': {
    displayname: 'สมชาย นักศึกษา',
    prefix_th: 'นาย',
    email: 'student@example.test',
    type: 'students',
    LEVEL_DESC: 'ปริญญาตรี',
    STU_STATUS_DESC: 'กำลังศึกษา',
  },
  'fixture.advisor': {
    displayname: 'สมหญิง ที่ปรึกษา',
    prefix_th: 'นางสาว',
    email: 'advisor@example.test',
    type: 'personel',
  },
  'fixture.stuact': {
    displayname: 'สมศักดิ์ กิจการ',
    prefix_th: 'นาย',
    email: 'stuact@example.test',
    type: 'personel',
  },
  'fixture.admin': {
    displayname: 'ผู้ดูแล ระบบ',
    prefix_th: 'นาย',
    email: 'admin@example.test',
    type: 'personel',
  },
};

/**
 * Any non-empty password is accepted — there is nothing to check against, and a
 * fake password rule would only be theatre. `config.assertValid()` refuses to
 * start with `AUTH_PROVIDER=mock` under `NODE_ENV=production` for that reason.
 */
async function authenticate(username, password) {
  if (!password) return null;

  const entry = DIRECTORY[username];
  if (!entry) return null;

  const { LEVEL_DESC, STU_STATUS_DESC, ...userInfo } = entry;

  return {
    api_status: 'success',
    api_message: 'success',
    userInfo: { username, ...userInfo },
    studentInfo: entry.type === 'students' ? { LEVEL_DESC, STU_STATUS_DESC } : {},
  };
}

module.exports = { name: 'mock', authenticate, knownUsernames: Object.keys(DIRECTORY) };
