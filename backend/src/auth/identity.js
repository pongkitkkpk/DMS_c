/**
 * The one place ICIT's response shape is read.
 *
 * Both providers return the *provider's own* payload and hand it to
 * `normalizeIcitPayload`, so the mock exercises exactly the mapping the real
 * provider will use. When ICIT access finally exists (Q3) and a field name turns
 * out to be wrong, this file is the only edit.
 *
 * ⚠ The field names below are reconstructed from `docs/DECISIONS.md` (Q17 —
 * "`userInfo` + `studentInfo`"), `docs/schema-current.md` (`LEVEL_DESC`,
 * `STU_STATUS_DESC` "passed through from ICIT") and the old `users` columns. The
 * old `src/login.js` is no longer on disk and there is no API access, so they are
 * **unverified**. Alternates are accepted where the old column names suggest one.
 *
 * What this deliberately does NOT read is a role. ICIT returns identity; the
 * application role lives in `membership` and is resolved separately — see
 * docs/business-rules.md, "Why the token could not carry a role".
 */

/** First non-empty value among `keys`, else `null`. */
function pick(source, keys) {
  for (const key of keys) {
    const value = source == null ? undefined : source[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return null;
}

/**
 * ICIT scopes are `student,personel`; `person.account_type` is
 * `students | personel`. The plural mismatch is the old system's, kept because
 * the enum is already migrated.
 */
function normalizeAccountType(raw) {
  const value = String(raw || '').toLowerCase();
  if (value.startsWith('stu')) return 'students';
  if (value.startsWith('per') || value.startsWith('emp') || value.startsWith('staff')) return 'personel';
  return null;
}

/**
 * @param {object} payload provider response: `{ userInfo, studentInfo? }`
 * @returns {{idStudent: string, prefix: ?string, fullNameTh: string, email: ?string,
 *            phone: ?string, accountType: 'students'|'personel',
 *            levelDesc: ?string, stuStatusDesc: ?string}}
 * @throws if the payload lacks a username, a name, or a usable account type —
 *         all three are `NOT NULL` on `person`, so guessing them would write junk.
 */
function normalizeIcitPayload(payload) {
  const userInfo = payload.userInfo || payload.userinfo || {};
  const studentInfo = payload.studentInfo || payload.studentinfo || {};

  const idStudent = pick(userInfo, ['username', 'uid', 'userPrincipalName', 'id_student']);
  if (!idStudent) throw new Error('ICIT payload has no username');

  const accountType = normalizeAccountType(
    pick(userInfo, ['type', 'account_type', 'accountType', 'usertype'])
  );
  if (!accountType) {
    throw new Error(`ICIT payload has no recognisable account type: ${JSON.stringify(pick(userInfo, ['type', 'account_type']))}`);
  }

  // ICIT returns a display name; the old `users.name_student` held the Thai name.
  // Fall back to composing it, because `person.full_name_th` is NOT NULL.
  const fullNameTh =
    pick(userInfo, ['displayname', 'displayName', 'name_student', 'fullname_th']) ||
    [pick(userInfo, ['firstname_th', 'firstnameTh']), pick(userInfo, ['lastname_th', 'lastnameTh'])]
      .filter(Boolean)
      .join(' ')
      .trim();
  if (!fullNameTh) throw new Error(`ICIT payload has no name for ${idStudent}`);

  return {
    idStudent,
    prefix: pick(userInfo, ['prefix_th', 'prefix', 'title_th']),
    fullNameTh,
    email: pick(userInfo, ['email', 'mail']),
    phone: pick(userInfo, ['phone', 'telephone', 'mobile']),
    accountType,
    levelDesc: pick(studentInfo, ['LEVEL_DESC', 'level_desc']) || pick(userInfo, ['LEVEL_DESC', 'level_desc']),
    stuStatusDesc:
      pick(studentInfo, ['STU_STATUS_DESC', 'stu_status_desc']) ||
      pick(userInfo, ['STU_STATUS_DESC', 'stu_status_desc']),
  };
}

module.exports = { normalizeIcitPayload, normalizeAccountType };
