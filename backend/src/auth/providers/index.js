/**
 * The AuthProvider seam (Q17).
 *
 *   AuthProvider = {
 *     name: string,
 *     authenticate(username, password) => Promise<icitPayload | null>
 *   }
 *
 * `null` means "these credentials are wrong". A throw means "the provider could
 * not answer" — the route turns the first into 401 and the second into 502, so a
 * broken SSO is never reported to a student as a bad password.
 *
 * A provider returns identity and nothing else. No implementation of this
 * interface may return a role; see docs/business-rules.md, "Why the token could
 * not carry a role".
 */
const { config } = require('../../config');

const PROVIDERS = {
  mock: require('./mock'),
  icit: require('./icit'),
};

function getAuthProvider() {
  const provider = PROVIDERS[config.authProvider];
  if (!provider) {
    throw new Error(`unknown AUTH_PROVIDER: ${config.authProvider} (expected mock|icit)`);
  }
  return provider;
}

module.exports = { getAuthProvider };
