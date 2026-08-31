/**
 * Signing up, signing in, and the wraps that make both survivable.
 *
 * `docs/03` §3. The headline is that **a new device signs in with your password
 * and a second factor, and nothing else** — no other device, no recovery code —
 * and the crypto that makes that safe is OPAQUE plus the envelope in
 * `revel-crypto/src/envelope.rs`.
 *
 * ## What the IdP learns, which is the whole design
 *
 * Nothing that opens anything. OPAQUE is an augmented PAKE: the server never
 * sees the password, cannot derive it, and cannot verify a guess offline
 * without doing the work an attacker would. What it stores is a registration
 * record it cannot invert, and three **wraps** of the account key it cannot
 * open — the wrapping keys come from the password, a recovery code, and a
 * passkey, and the IdP holds none of them.
 *
 * Two consequences worth stating plainly, because they shape the UX:
 *
 * - **The IdP cannot reset your password.** A server-side reset would hand you
 *   a new password and no key. Recovery goes through a *different wrap*.
 * - **A second factor is a policy gate, not cryptography** (`docs/03` §3). The
 *   wraps still open only with the password-derived KEK, so an IdP that skips
 *   its own 2FA check gains nothing it did not already lack. What 2FA buys is
 *   defence against a *known* password — phishing, reuse — which is the
 *   realistic attack.
 */
import { z } from 'zod';
import { AccountId } from './ids.js';

/**
 * An opaque protocol message, **base64url**.
 *
 * base64url rather than standard base64 because that is what the OPAQUE
 * implementation emits, and the wire format is not ours to choose here — these
 * bytes are produced and consumed by a library on both ends and never inspected
 * in between. Getting this wrong rejects every real message while accepting
 * every hand-written test fixture, which is exactly how it was found.
 */
const Opaque = z
  .string()
  .regex(/^[A-Za-z0-9_-]+=*$/, 'not base64url')
  .max(4096);

/**
 * A wrap: `nonce | ciphertext`, AES-256-GCM. Opaque to the IdP by design.
 *
 * Standard base64, because unlike the messages above this is *our* encoding —
 * the same one `EventInput.payload` uses, so there is one answer to "how does
 * Revel put bytes in JSON".
 */
const WrapBlob = z.string().base64().max(1024);

/** Which secret opens a wrap. Three doors, one key (`docs/03` §1). */
export const WrapKind = z.enum([
  /** KEK, from OPAQUE's `exportKey`. The everyday one. */
  'password',
  /** RK, from the recovery code via Argon2id. The one that saves the account. */
  'recovery',
  /** PK, from a passkey's WebAuthn PRF output. */
  'passkey',
]);
export type WrapKind = z.infer<typeof WrapKind>;

export const Wrap = z.object({
  kind: WrapKind,
  blob: WrapBlob,
  /**
   * Argon2id salt, `recovery` only. Not secret — its job is to stop one
   * precomputed table covering every account.
   */
  salt: z.string().base64().max(64).optional(),
});
export type Wrap = z.infer<typeof Wrap>;

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export const RegisterStart = z.object({
  handle: z.string().min(1).max(64),
  request: Opaque,
});
export type RegisterStart = z.infer<typeof RegisterStart>;

export const RegisterStartResponse = z.object({ response: Opaque });
export type RegisterStartResponse = z.infer<typeof RegisterStartResponse>;

export const RegisterFinish = z.object({
  handle: z.string().min(1).max(64),
  /** The OPAQUE registration record. The IdP stores it and cannot invert it. */
  record: Opaque,
  /** The account public key — the identity itself (`docs/03` §1). */
  accountPub: AccountId,
  /**
   * At least `password` and `recovery`.
   *
   * Both, always, and the API says so rather than leaving it to the client:
   * a sign-up that skipped the recovery wrap would produce an account where
   * forgetting the password is fatal, and it would look completely fine until
   * the day it wasn't.
   */
  wraps: z.array(Wrap).min(2).max(3),
  /** This device's certificate, signed by the account key. */
  deviceCert: z.string().base64().max(4096),
  /**
   * Proof-of-recovery-code, for the recovery flow. Required, like the wrap.
   *
   * Uploaded now because there is no later: the code is shown once and the
   * person is expected to put it somewhere safe and forget it.
   */
  recoveryVerifier: z.string().base64().max(64),
});
export type RegisterFinish = z.infer<typeof RegisterFinish>;

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export const LoginStart = z.object({
  handle: z.string().min(1).max(64),
  request: Opaque,
});
export type LoginStart = z.infer<typeof LoginStart>;

export const LoginStartResponse = z.object({
  response: Opaque,
  /** Opaque handle for the server's half of this exchange. Single use. */
  session: z.string().min(8).max(128),
});
export type LoginStartResponse = z.infer<typeof LoginStartResponse>;

export const LoginFinish = z.object({
  session: z.string().min(8).max(128),
  request: Opaque,
  /**
   * A TOTP code, when the account has a second factor enrolled.
   *
   * Sent with the finish rather than in a round trip of its own: the IdP has
   * already decided whether it needs one (it said so at `start`), and a
   * separate step would mean holding a half-authenticated session open.
   */
  totp: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});
export type LoginFinish = z.infer<typeof LoginFinish>;

/**
 * What a successful login returns.
 *
 * The wraps come back here and nowhere else — they are the thing 2FA gates.
 */
export const LoginFinishResponse = z.object({
  accountPub: AccountId,
  handle: z.string(),
  wraps: z.array(Wrap),
});
export type LoginFinishResponse = z.infer<typeof LoginFinishResponse>;

/** Why a login did not finish. Deliberately few, and deliberately vague. */
export const LoginRefusal = z.enum([
  /**
   * Wrong password, unknown handle, or a spent session — **one code for all
   * three**, because telling them apart is an oracle for which handles exist.
   */
  'bad_credentials',
  /** The account has a second factor and the request did not carry one. */
  'totp_required',
  /** It carried one and it was wrong. Distinct, because the password was right. */
  'totp_invalid',
]);
export type LoginRefusal = z.infer<typeof LoginRefusal>;

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

/**
 * "I forgot my password."
 *
 * `docs/03` §4 is blunt that the IdP **cannot** reset one — a server-side reset
 * would hand you a new password and no key — so this opens a different wrap
 * instead. It is the flow that only ever runs when everything else has already
 * gone wrong, and the one that decides whether an account is recoverable at all.
 *
 * How the wrap is released is a gap `docs/03` leaves open, and the obvious
 * answer is wrong twice over: handing wraps to anybody who names a handle is a
 * public answer to "does this person have an account here" *and* an offline
 * attack surface against every account at once. So the client proves knowledge
 * of the code with a **verifier** derived from RK — see `recovery_verifier` in
 * `revel-crypto/src/envelope.rs` for why that is not RK itself.
 */
export const RecoverStart = z.object({ handle: z.string().min(1).max(64) });
export type RecoverStart = z.infer<typeof RecoverStart>;

export const RecoverStartResponse = z.object({
  /**
   * The Argon2id salt for this account's recovery wrap.
   *
   * **Always answered, even for a handle that does not exist**, with a value
   * derived from the handle and a server secret. An unknown handle that got a
   * different shape of answer — or no answer — would make this endpoint a
   * membership oracle, which is exactly what the rest of the design spends its
   * effort avoiding. The made-up salt is stable per handle, so asking twice
   * does not give it away either.
   */
  salt: z.string().base64().max(64),
});
export type RecoverStartResponse = z.infer<typeof RecoverStartResponse>;

export const RecoverFinish = z.object({
  handle: z.string().min(1).max(64),
  /** `HKDF(RK, "revel/recovery-verifier/v1")`, base64. Proof, never the key. */
  verifier: z.string().base64().max(64),
});
export type RecoverFinish = z.infer<typeof RecoverFinish>;

/** Set a new password after recovery: a fresh OPAQUE record and a fresh wrap. */
export const ResetPassword = z.object({
  handle: z.string().min(1).max(64),
  verifier: z.string().base64().max(64),
  /** The new OPAQUE registration record. */
  record: Opaque,
  /** The account key re-wrapped under the new KEK. */
  wrap: WrapBlob,
});
export type ResetPassword = z.infer<typeof ResetPassword>;

// ---------------------------------------------------------------------------
// Second factors
// ---------------------------------------------------------------------------

export const TotpEnrolResponse = z.object({
  /** Base32, for an authenticator app. Shown once. */
  secret: z.string().min(16).max(64),
  /** `otpauth://` URI for the QR code. */
  uri: z.string().max(512),
});
export type TotpEnrolResponse = z.infer<typeof TotpEnrolResponse>;

export const TotpConfirm = z.object({ code: z.string().regex(/^\d{6}$/) });
export type TotpConfirm = z.infer<typeof TotpConfirm>;
