-- Enrolment: OPAQUE, the three wraps, and second factors (`docs/03` §3).
--
-- What the IdP holds here is deliberately all things it cannot use:
--
--   * `enrolments.record` is an OPAQUE registration record. The server never
--     sees the password, cannot derive it, and cannot test a guess offline
--     without doing the work an attacker would.
--   * `wraps.blob` is the account key sealed under a key derived from the
--     password, a recovery code, or a passkey. The IdP holds none of the three.
--
-- A dump of this schema is not a way into anybody's messages. That is the
-- entire point of the design, and the reason there is no `password_hash`
-- column anywhere to be tempted by.

CREATE TABLE IF NOT EXISTS enrolments (
  handle      text PRIMARY KEY,
  account_pub text UNIQUE NOT NULL,
  record      text NOT NULL,
  created_at  bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS wraps (
  account_pub text NOT NULL,
  -- 'password' | 'recovery' | 'passkey'. One of each, replaceable.
  kind        text NOT NULL,
  blob        text NOT NULL,
  -- Argon2id salt, `recovery` only. Not secret: its job is to stop one
  -- precomputed table covering every account.
  salt        text,
  PRIMARY KEY (account_pub, kind)
);

CREATE TABLE IF NOT EXISTS login_sessions (
  id          text PRIMARY KEY,
  account_pub text NOT NULL,
  handle      text NOT NULL,
  -- The server's half of the OPAQUE exchange, between the two round trips.
  state       text NOT NULL,
  expires_at  bigint NOT NULL
);
-- Swept on the same timer as challenges and sessions.
CREATE INDEX IF NOT EXISTS login_sessions_expiry ON login_sessions (expires_at);

CREATE TABLE IF NOT EXISTS totp_secrets (
  account_pub  text PRIMARY KEY,
  secret       text NOT NULL,
  -- The highest counter step already spent. What makes a code single-use —
  -- without it a phished code stays valid for its whole window, which is most
  -- of what a second factor is for.
  last_counter bigint,
  -- Null until a correct code proves the authenticator was actually set up.
  -- An unconfirmed secret must never gate a login, or a mistyped enrolment
  -- locks somebody out of their own account.
  confirmed_at bigint
);
