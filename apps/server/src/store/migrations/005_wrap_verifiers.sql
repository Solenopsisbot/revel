-- A verifier per wrap, rather than one recovery verifier on the account.
--
-- `enrolments.recovery_verifier` answered "may this caller have the recovery
-- wrap without a password". A passkey wrap needs exactly the same question
-- answered about itself, and bolting a second column onto `enrolments` would
-- have been the moment this stopped generalising.
--
-- So the verifier lives on the wrap it authorises. Both are derived the same
-- way — `HKDF(wrapping_key, "revel/recovery-verifier/v1")` — and both are
-- compared and never used to open anything: a dump of this column yields
-- verifiers, and a verifier neither opens a wrap nor inverts to the secret
-- behind it.
--
-- `password` wraps have no verifier and never will. That one is released by
-- finishing an OPAQUE login, which is a stronger check than a hash comparison
-- and does not need this.
ALTER TABLE wraps ADD COLUMN IF NOT EXISTS verifier text;

-- Carry across what `enrolments` already holds, so accounts created before this
-- keep working. Idempotent: re-running finds nothing left to copy.
UPDATE wraps w
   SET verifier = e.recovery_verifier
  FROM enrolments e
 WHERE w.account_pub = e.account_pub
   AND w.kind = 'recovery'
   AND w.verifier IS NULL
   AND e.recovery_verifier <> '';
