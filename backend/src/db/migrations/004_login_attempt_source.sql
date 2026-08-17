-- ---------------------------------------------------------------------------
-- 004. Where a login attempt came from.
--
-- `login_attempt` has recorded every success and failure since migration 001,
-- and nothing has ever read it. That is the whole gap: the table is a log, and
-- a log nobody consults does not slow an attacker down. `POST /api/auth/login`
-- could be called as fast as the network allowed, forever, against any
-- username — the one endpoint in the system that is reachable without a token.
--
-- Counting failures per username is enough to stop a password being guessed.
-- It is not enough to stop *spraying*: one attempt each against a thousand
-- usernames trips no per-username counter, and the accounts here are ICIT
-- usernames, which are predictable. So the source address is recorded too, and
-- throttled on its own budget — see `src/services/loginThrottle.js`.
--
-- `VARCHAR(45)` holds an IPv6 address in full (39 characters) plus a zone id,
-- which is what `req.ip` returns for a v6 client. NULL is allowed because the
-- address is not always knowable — a request arriving through a proxy that is
-- not trusted has no honest client address, and inventing one would put every
-- user of that proxy on a single shared budget.
--
-- The column is deliberately not an index of its own: every query that reads it
-- also bounds `attempted_at`, so the pair is the useful key.
-- ---------------------------------------------------------------------------

ALTER TABLE `login_attempt`
  ADD COLUMN `remote_ip` VARCHAR(45) NULL AFTER `is_success`,
  ADD KEY `ix_login_attempt_ip` (`remote_ip`, `attempted_at`);
