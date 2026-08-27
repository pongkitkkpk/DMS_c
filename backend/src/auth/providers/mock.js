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
const crypto = require('crypto');

const { config } = require('../../config');

const DIRECTORY = {
  'fixture.student': {
    displayname: 'สมชาย นักศึกษา',
    prefix_th: 'นาย',
    email: 'student@example.test',
    type: 'students',
    LEVEL_DESC: 'ปริญญาตรี',
    STU_STATUS_DESC: 'กำลังศึกษา',
  },
  // A student head in a different club and a different club group — the account
  // scope rules are meant to refuse.
  'fixture.otherstudent': {
    displayname: 'สมปอง ต่างชมรม',
    prefix_th: 'นาย',
    email: 'other@example.test',
    type: 'students',
    LEVEL_DESC: 'ปริญญาตรี',
    STU_STATUS_DESC: 'กำลังศึกษา',
  },
  // A student head of a different club, this time the one the D04 taxonomy
  // seeds for the student council itself — for testing the ประธานสภานักศึกษา
  // signature line (docs/DECISIONS.md, "E-signature") without inventing a
  // sixth kind of account.
  'fixture.council': {
    displayname: 'สมคิด ประธานสภา',
    prefix_th: 'นาย',
    email: 'council@example.test',
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
 * start with `AUTH_PROVIDER=mock` under `NODE_ENV=production` for that reason,
 * unless the deployment says `ALLOW_MOCK_AUTH=1`, which in turn requires the
 * `MOCK_PASSWORD` below.
 *
 * `MOCK_PASSWORD` is not authentication and does not pretend to be: everyone
 * who has it shares it, and it says nothing about *which* of the five fixture
 * people is typing. It is a door on a demonstration, which is the honest
 * description of what a demonstration needs — the usernames are published in
 * this very file, so without it a public URL is an open Admin session.
 *
 * Compared with `timingSafeEqual` on padded buffers. The comparison is almost
 * certainly not the weakest thing about a shared password, but a constant-time
 * compare costs one function call and removes the question.
 */
function passwordAccepted(password) {
  const expected = config.mockPassword;
  if (!expected) return Boolean(password);

  const given = Buffer.from(String(password));
  const want = Buffer.from(expected);
  // Hash first so the buffers are the same length whatever was typed:
  // `timingSafeEqual` throws on a length mismatch, and the throw itself would
  // leak the length.
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(given).digest(),
    crypto.createHash('sha256').update(want).digest()
  );
}

async function authenticate(username, password) {
  if (!passwordAccepted(password)) return null;

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
