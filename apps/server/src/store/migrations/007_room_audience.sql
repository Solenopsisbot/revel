-- A room remembers which audience it is for.
--
-- 006 recorded audience→group in `group_audiences`, which answers "who already
-- has a group for this rule". It does not answer the question the *other*
-- direction, which is the one that comes up first: a client opening a space
-- room whose `group_id` is still null has to create the group, and the server
-- has to know which audience that new group serves before it can let a sibling
-- room reuse it.
--
-- `docs/04` §1 lists `visibility` (`everyone` / `roles:[…]` / `list`) on the
-- rooms table and it was never added. This is that column, storing the
-- canonical key from `audienceKey()` rather than a parsed shape — the key is
-- what both tables join on, and one of them holding a different spelling of it
-- is the bug this is meant to prevent.
--
-- Null for a DM or a group DM: those have no space, and their audience is the
-- explicit list of accounts in `memberships` (`docs/03` §4).
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS audience text;

-- Finding the rooms an audience covers, which is what a role change has to
-- walk in order to work out whose membership moved.
CREATE INDEX IF NOT EXISTS rooms_audience
  ON rooms (space_id, audience) WHERE space_id IS NOT NULL;
