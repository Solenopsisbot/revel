-- Device-handoff channels (`docs/03` §3's convenient case).
--
-- The IdP relays and cannot read. `delivery` holds the account key sealed to a
-- transfer key the server never had — the same relationship it has to every
-- message in every room, applied to the one moment a key legitimately moves
-- between two devices somebody is holding.
--
-- Short-lived on purpose. A QR on a screen is not a durable thing, and a
-- channel that outlived the moment would be somewhere to leave something for a
-- device that never came.
CREATE TABLE IF NOT EXISTS enrol_channels (
  id           text PRIMARY KEY,
  transfer_pub text NOT NULL,
  delivery     text,
  expires_at   bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS enrol_channels_expiry ON enrol_channels (expires_at);
