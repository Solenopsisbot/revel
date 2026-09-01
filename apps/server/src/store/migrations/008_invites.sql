-- Invite links (`docs/04` §1, `docs/03` §4 — the Wormhole trick).
--
-- The row the server holds is deliberately not enough to use. `pub` is the
-- public half of a keypair minted on the inviter's device; the private half
-- lives in the URL fragment and never reaches here, so redeeming means proving
-- possession of something this table does not contain. A database dump is a
-- list of codes that cannot be redeemed.
--
-- That is a bound on a *leak*, not a defence against this server: a Host can
-- write a membership row for anybody at any time. What stops that mattering is
-- the other half of the design — a membership row is not access, and only a
-- member's client can commit somebody into an MLS group (`docs/03` §5).
CREATE TABLE IF NOT EXISTS invites (
  -- Short, human-typeable, and the thing in the URL before the `#`.
  code       text PRIMARY KEY,
  space_id   text NOT NULL,
  -- Who made it. Shown on the invite page, and the reason a revoked inviter's
  -- links can be found.
  created_by text NOT NULL,
  -- Ed25519 public key, base64url. Verifies the redeemer holds the fragment.
  pub        text NOT NULL,
  uses       integer NOT NULL DEFAULT 0,
  -- NULL means unlimited, which the UI says in words rather than as an ∞.
  max_uses   integer,
  -- NULL means it does not expire. Milliseconds, like every other time here.
  expires_at bigint,
  created_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS invites_space ON invites (space_id);
