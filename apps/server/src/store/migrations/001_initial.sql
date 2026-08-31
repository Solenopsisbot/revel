-- `docs/04` §1, as tables.
--
-- Two things to notice, because they are the design rather than the plumbing:
--
--   1. **There is no `content` column anywhere.** `events.payload` and
--      `blobs` hold ciphertext the server cannot open; every other column is
--      routing and policy. If a migration ever adds a column that holds
--      something a Host could read, that is the moment this stopped being the
--      product it claims to be.
--   2. **Ids are `text`, not `bigint`.** Snowflakes exceed 2^53 and JSON has no
--      bigint, so they are strings end to end (`docs/04` §6) and clients order
--      them with `compareIds`, which parses both sides as `BigInt` and compares
--      numerically.
--
--      A plain `ORDER BY id` here would be *lexical*, and lexical disagrees
--      with numeric the moment ids differ in length: '9999999999999999999'
--      sorts after '10000000000000000000' because '9' > '1'. So every ordered
--      read sorts by `(length(id), id)` — which is exactly numeric order for
--      non-negative decimal strings with no leading zeros, and which snowflakes
--      are. The indexes below are built on the same expression, so the sort is
--      free rather than a sequential scan.
--
--      This is invisible until a room crosses a digit boundary, at which point
--      history quietly reorders itself. `store.conformance.ts` pins it.
--
-- Applied by `PostgresStore.migrate()`, which is idempotent. There is no
-- migration framework yet; that lands with `revel init` (`docs/29` §7).

CREATE TABLE IF NOT EXISTS accounts (
  id            text PRIMARY KEY,
  handle        text UNIQUE NOT NULL,
  display_name  text,
  avatar        text,
  status        text NOT NULL DEFAULT 'active',
  created_at    bigint NOT NULL,
  moved_to      text
);

CREATE TABLE IF NOT EXISTS devices (
  pub           text PRIMARY KEY,
  account_id    text NOT NULL,
  label         text NOT NULL,
  registered_at bigint NOT NULL,
  revoked_at    bigint
);
-- `listAccountDevices` runs on every claim, and almost always wants live ones.
CREATE INDEX IF NOT EXISTS devices_account ON devices (account_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS devices_account_all ON devices (account_id);

CREATE TABLE IF NOT EXISTS rooms (
  id             text PRIMARY KEY,
  kind           text NOT NULL,
  space_id       text,
  group_id       text,
  stream_paging  boolean NOT NULL DEFAULT false,
  notify_hints   boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS rooms_group ON rooms (group_id) WHERE group_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS memberships (
  room_id    text NOT NULL,
  account_id text NOT NULL,
  role_ids   text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (room_id, account_id)
);
CREATE INDEX IF NOT EXISTS memberships_account ON memberships (account_id);

CREATE TABLE IF NOT EXISTS roles (
  id       text PRIMARY KEY,
  space_id text NOT NULL,
  -- Permission bits as text: they are a 64-bit mask and JSON has no bigint,
  -- so the base-10 string is the wire form and storing it as anything else
  -- would mean converting twice and disagreeing once.
  bits     text NOT NULL,
  position integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS overrides (
  room_id text NOT NULL,
  role_id text NOT NULL,
  allow   text NOT NULL,
  deny    text NOT NULL,
  PRIMARY KEY (room_id, role_id)
);

CREATE TABLE IF NOT EXISTS space_owners (
  space_id   text NOT NULL,
  account_id text NOT NULL,
  PRIMARY KEY (space_id, account_id)
);

CREATE TABLE IF NOT EXISTS events (
  id           text PRIMARY KEY,
  room_id      text NOT NULL,
  sender       text NOT NULL,
  class        text NOT NULL,
  -- Which era key opens `payload`. The server checks it is live; it still
  -- cannot open it.
  epoch        integer NOT NULL,
  -- Ciphertext. The one column a Host operator would most like to read and
  -- the one it can do least with.
  payload      text NOT NULL,
  size         integer NOT NULL,
  client_nonce text,
  created_at   bigint NOT NULL,
  purged_at    bigint,
  stream       text,
  notify       text[]
);
-- The only read shape that matters: a room's tail, newest first, paged
-- backwards. Sorted the way `compareIds` sorts, not the way `text` sorts.
CREATE INDEX IF NOT EXISTS events_room_order ON events (room_id, length(id) DESC, id DESC);
-- Idempotency is per *device*, not per room: two devices may legitimately pick
-- the same nonce and neither may shadow the other. Partial, because a null
-- nonce is a server-generated event and there is nothing to deduplicate.
CREATE UNIQUE INDEX IF NOT EXISTS events_nonce
  ON events (sender, client_nonce) WHERE client_nonce IS NOT NULL;

CREATE TABLE IF NOT EXISTS blobs (
  id         text PRIMARY KEY,
  room_id    text NOT NULL,
  uploader   text NOT NULL,
  size       integer NOT NULL,
  hash       text NOT NULL,
  created_at bigint NOT NULL,
  purged_at  bigint,
  -- Ciphertext in the row. Fine at this scale and wrong at any other: a real
  -- deployment puts these in object storage and keeps the row as metadata.
  -- Written here so the seam is visible rather than assumed.
  bytes      bytea
);

CREATE TABLE IF NOT EXISTS challenges (
  -- The *hash* of the nonce. A database that leaks should not hand out
  -- anything spendable.
  nonce_hash text PRIMARY KEY,
  device_pub text NOT NULL,
  expires_at bigint NOT NULL
);
-- Both of the expiry tables below are only self-cleaning on the *read* path,
-- and the read that would clean them is precisely the one that never comes: an
-- abandoned sign-in never spends its challenge, and a client holding an expired
-- token does not present it again. So they need a sweep, and a sweep without an
-- index is a sequential scan over a table that only grows.
CREATE INDEX IF NOT EXISTS challenges_expiry ON challenges (expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  device_pub text NOT NULL,
  account_id text NOT NULL,
  expires_at bigint NOT NULL
);
-- Revoking a device kills every session it holds, in one statement.
CREATE INDEX IF NOT EXISTS sessions_device ON sessions (device_pub);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  device_pub text PRIMARY KEY,
  kind       text NOT NULL,
  endpoint   text NOT NULL,
  p256dh     text,
  auth       text,
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS key_packages (
  device_pub text NOT NULL,
  -- Position on the shelf. Oldest spent first, so shelf age stays bounded.
  seq        bigserial,
  key_package text NOT NULL,
  PRIMARY KEY (device_pub, seq)
);

CREATE TABLE IF NOT EXISTS last_resort_packages (
  device_pub  text PRIMARY KEY,
  key_package text NOT NULL
);

CREATE TABLE IF NOT EXISTS key_package_claims (
  group_id    text NOT NULL,
  device_pub  text NOT NULL,
  key_package text NOT NULL,
  last_resort boolean NOT NULL,
  PRIMARY KEY (group_id, device_pub)
);

CREATE TABLE IF NOT EXISTS groups (
  id                text PRIMARY KEY,
  epoch             integer NOT NULL DEFAULT 0,
  pending_proposals integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id       text NOT NULL,
  device_pub     text NOT NULL,
  account_id     text NOT NULL,
  added_epoch    integer NOT NULL,
  -- Orders the designated-committer fallback (`docs/03` §5). Derived at read
  -- time rather than stored as a `designated_committer_device` column, because
  -- a stored one goes stale and nudges a device that logged out an hour ago.
  last_active_at bigint NOT NULL,
  PRIMARY KEY (group_id, device_pub)
);

CREATE TABLE IF NOT EXISTS handshake_log (
  group_id   text NOT NULL,
  seq        integer NOT NULL,
  kind       text NOT NULL,
  epoch      integer NOT NULL,
  sender     text NOT NULL,
  bytes      text NOT NULL,
  created_at bigint NOT NULL,
  PRIMARY KEY (group_id, seq)
);

CREATE TABLE IF NOT EXISTS group_welcomes (
  device_pub text NOT NULL,
  group_id   text NOT NULL,
  bytes      text NOT NULL,
  created_at bigint NOT NULL,
  -- One row per (device, group): a newer Welcome replaces an unacked older
  -- one, because only the newest can still be opened at the current epoch.
  PRIMARY KEY (device_pub, group_id)
);

CREATE TABLE IF NOT EXISTS group_trees (
  group_id text PRIMARY KEY,
  epoch    integer NOT NULL,
  tree     text NOT NULL
);
