-- Bans (`docs/04` §1, `docs/03` §9 — "bans persist across rejoin").
--
-- The row is what makes a ban different from a kick: a kick is a membership
-- row going away, which a new invite undoes. A ban is a standing refusal that
-- every join path checks, so the link somebody was sent does not work for them.
--
-- Neither is access. Taking the keys away is an MLS Remove committed by a
-- member (`docs/03` §5), and the two halves are separate on purpose — this
-- table stops them coming back, and the commit stops them reading.
CREATE TABLE IF NOT EXISTS bans (
  space_id   text NOT NULL,
  account_id text NOT NULL,
  -- Who did it. Shown in the moderation log, which is a list of decisions
  -- somebody made rather than of things that happened.
  by_account text NOT NULL,
  -- Optional and free text. It is for the other moderators, not for the banned
  -- person — nothing sends it to them.
  reason     text,
  at         bigint NOT NULL,
  PRIMARY KEY (space_id, account_id)
);
CREATE INDEX IF NOT EXISTS bans_space ON bans (space_id);
