/**
 * A password for a throwaway end-to-end account.
 *
 * **Fresh per run, not a constant.** Every suite here used to sign up with the
 * same well-known string, and `spaces.mjs` supports pointing `REVEL_E2E_APP` at
 * a real deployment — so the accounts these tests create on that Host were
 * owned by anybody who read this directory. Handles are timestamp-stamped and
 * therefore guessable, which is the other half of it.
 *
 * Long and random: nothing needs to type it, and the run that created the
 * account is the only thing that ever needs to know it.
 */
import { randomBytes } from 'node:crypto';

export const password = `e2e-${randomBytes(24).toString('base64url')}`;
