/**
 * Signing in to a Host, from the client's side.
 *
 * `docs/03` §2: register the device certificate, ask for a nonce, sign
 * `{nonce, host, device_pub}`, get a short-lived token bound to this device.
 * **No passwords at Hosts, ever** — the device key is the credential, and it
 * never leaves the crypto core.
 *
 * ## What this is for
 *
 * Everything else in `packages/core` takes a `headers()` function and asks it
 * for credentials on every request, precisely so a token with a lifetime does
 * not have to be captured at construction. This is the thing that answers.
 *
 * ## Re-signing is not a failure
 *
 * A session lasts a day; an app stays open longer than that. So this refreshes
 * on its own, ahead of expiry, and a caller that only ever reads `headers`
 * never has to know. The alternative — surfacing an auth error and asking the
 * UI to re-sign — turns a housekeeping detail into a screen somebody has to
 * design, and into a class of bug where one request in ten thousand fails at
 * 3am.
 */
import type { CryptoEngine } from '@revel/crypto';
import {
  authPayload,
  type ChallengeResponse,
  fromBase64,
  type SessionResponse,
  toBase64,
} from '@revel/protocol';
import { TransportError } from './transport.js';

export interface HostSessionOptions {
  crypto: CryptoEngine;
  /** Base URL of the Host. */
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  /** Overridable so a test is not a function of the wall clock. */
  now?: () => number;
  /** Called whenever a fresh token is obtained, for a caller that stores it. */
  onSession?: (session: SessionResponse) => void;
}

/**
 * How long before expiry to renew.
 *
 * Generous, because the cost of renewing early is one request and the cost of
 * renewing late is a failure somebody sees.
 */
const REFRESH_MARGIN_MS = 5 * 60_000;

export class HostSession {
  #crypto: CryptoEngine;
  #baseUrl: string;
  #fetch: typeof globalThis.fetch;
  #now: () => number;
  #onSession: ((session: SessionResponse) => void) | undefined;

  #session: SessionResponse | null = null;
  /** In-flight sign-in, so ten parallel requests produce one, not ten. */
  #pending: Promise<SessionResponse> | null = null;

  constructor(options: HostSessionOptions) {
    this.#crypto = options.crypto;
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#now = options.now ?? (() => Date.now());
    this.#onSession = options.onSession;
  }

  /** The account this session speaks for, once there is one. */
  get account(): string | null {
    return this.#session?.account ?? null;
  }

  get device(): string | null {
    return this.#session?.device ?? null;
  }

  /**
   * Credentials for a request, signing in first if there are none.
   *
   * Pass this straight to `HttpTransport`'s `headers` — it is the shape that
   * option exists for.
   */
  headers = async (): Promise<Record<string, string>> => {
    const session = await this.ensure();
    return { authorization: `Bearer ${session.token}` };
  };

  /** A live session, renewing if the current one is close to done. */
  async ensure(): Promise<SessionResponse> {
    const current = this.#session;
    if (current && current.expiresAt - REFRESH_MARGIN_MS > this.#now()) return current;
    // Collapsed rather than queued: ten requests that all notice an expired
    // token at once must not perform ten challenge-responses, and the last
    // nine would spend nonces the server has to keep.
    this.#pending ??= this.#signIn().finally(() => {
      this.#pending = null;
    });
    return this.#pending;
  }

  /**
   * Register this device's certificate with the Host.
   *
   * Separate from signing in because it is a different act: registering says
   * "this device belongs to this account, here is the proof"; signing in says
   * "and it is awake right now". Idempotent, so calling it on every start is
   * fine and is what a client should do — a Host may have been reinstalled.
   */
  async register(): Promise<void> {
    const { certificate } = await this.#crypto.identity();
    await this.#json('/idp/devices', { certificate: toBase64(certificate) });
  }

  async #signIn(): Promise<SessionResponse> {
    const devicePub = toBase64url(await this.#devicePublicKey());

    const challenge = await this.#json<ChallengeResponse>('/auth/challenge', {
      device: devicePub,
    });

    // The Host names itself in the challenge and that name is inside what we
    // sign, so a signature collected here cannot be presented anywhere else.
    const signature = await this.#crypto.signAuth(
      authPayload(challenge.host, fromBase64(challenge.nonce), await this.#devicePublicKey()),
    );

    const session = await this.#json<SessionResponse>('/auth/session', {
      device: devicePub,
      nonce: challenge.nonce,
      signature: toBase64(signature),
    });

    this.#session = session;
    this.#onSession?.(session);
    return session;
  }

  async #devicePublicKey(): Promise<Uint8Array> {
    return (await this.#crypto.identity()).devicePublicKey;
  }

  async #json<T>(path: string, body: unknown): Promise<T> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const reason = await response
        .json()
        .then((b: unknown) => (b as { error?: string })?.error)
        .catch(() => undefined);
      throw new TransportError(response.status, reason ?? `http_${response.status}`);
    }
    return (await response.json()) as T;
  }
}

function toBase64url(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
