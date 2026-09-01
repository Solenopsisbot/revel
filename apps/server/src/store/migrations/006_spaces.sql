-- Spaces: the row a space *is*, and who is in it.
--
-- `roles`, `overrides` and `space_owners` shipped in 001 and `resolve()` has
-- been reading them since — the permission model was ported and wired before
-- anything could create a space to use it. What was missing is the two tables
-- underneath: the space itself, and membership *of the space* rather than of
-- one of its rooms.
--
-- `docs/04` §1 names `member_roles`; it is folded into `space_members` here for
-- the same reason `memberships` carries `role_ids` rather than joining a third
-- table — a member's roles are read on every permission check, and a join per
-- check is a join per event.

-- The space. Deliberately almost empty.
--
-- No name, no topic, no description: those are `room.name`-style events inside
-- the ciphertext (`docs/04` §2), so the server does not hold them and cannot
-- leak them. What is out here is what the server has to enforce policy on.
CREATE TABLE IF NOT EXISTS spaces (
  id         text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- `everyone` / `link` / `public` (`docs/18`). Public means listed in a
  -- directory, which is opt-in and the only way a space is discoverable at all.
  visibility text NOT NULL DEFAULT 'invite'
);

-- Who is in a space, and as what.
--
-- Separate from `memberships`, which is per room. A space member is in the
-- space whether or not they are in any particular room — that is what makes
-- "everyone in this space" an audience the server can compute (`docs/03` §4).
CREATE TABLE IF NOT EXISTS space_members (
  space_id   text NOT NULL,
  account_id text NOT NULL,
  -- `@everyone` is not listed. It applies to every member by definition and
  -- storing it would mean every role change had to remember not to drop it.
  role_ids   text[] NOT NULL DEFAULT '{}',
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, account_id)
);

CREATE INDEX IF NOT EXISTS space_members_account ON space_members (account_id);

-- Rooms already carry `space_id`; this is what makes listing a space's rooms
-- cheap rather than a scan.
CREATE INDEX IF NOT EXISTS rooms_space ON rooms (space_id) WHERE space_id IS NOT NULL;

-- The audience a group serves.
--
-- `docs/03` §4: every room is encrypted under exactly one MLS group, and a
-- group's membership is an audience. Rooms whose visibility is "everyone in
-- the space" **share one group**, so joining a twelve-room space is one commit
-- rather than twelve. A restricted room gets its own.
--
-- Keyed on the audience *rule* rather than on who currently matches it. Two
-- rooms keyed on the resulting member set could silently merge and then
-- diverge as roles change, and there is no way to un-merge encrypted history.
CREATE TABLE IF NOT EXISTS group_audiences (
  group_id   text PRIMARY KEY,
  space_id   text NOT NULL,
  -- `everyone`, or `roles:<sorted ids>`, or `list:<sorted accounts>`.
  audience   text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS group_audiences_rule
  ON group_audiences (space_id, audience);
