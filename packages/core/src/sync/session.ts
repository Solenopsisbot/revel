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
  /**
   * How to wait between retries. Overridable for the same reason `now` is: a
   * test that actually sleeps four seconds to prove a backoff is a test nobody
   * runs.
   */
  sleep?: (ms: number) => Promise<void>;
  /** Called whenever a fresh token is obtained, for a caller that stores it. */
  onSession?: (session: SessionResponse) => void;
  /**
   * The Host's name, as it must appear in the challenge this device signs.
   *
   * Defaults to the hostname (and port) of `baseUrl`, which is the right answer
   * for every ordinary deployment and is what the Host's own default computes.
   * Set it explicitly when the Host is published under a name that is not the
   * one you connect to.
   */
  host?: string;
}

/**
 * The name we expect the Host to call itself.
 *
 * The origin the client was pointed at, which is the only name it has any
 * business trusting — and the one a Host's own default computes for itself. An
 * empty `baseUrl` means "same origin as this page", which is how the web client
 * is deployed.
 */
function defaultHost(baseUrl: string): string {
  if (baseUrl) return new URL(baseUrl).host;
  if (typeof location !== 'undefined' && location.host) return location.host;
  return '';
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
  #sleep: (ms: number) => Promise<void>;
  #onSession: ((session: SessionResponse) => void) | undefined;
  #host: string;

  #session: SessionResponse | null = null;
  /** In-flight sign-in, so ten parallel requests produce one, not ten. */
  #pending: Promise<SessionResponse> | null = null;

  constructor(options: HostSessionOptions) {
    this.#crypto = options.crypto;
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#now = options.now ?? (() => Date.now());
    this.#sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.#onSession = options.onSession;
    this.#host = (options.host ?? defaultHost(this.#baseUrl)).toLowerCase();
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

    // **The name has to be the one we came here for.**
    //
    // The host is inside what we sign precisely so a signature collected by one
    // Host cannot be presented at another — and taking that name from the
    // response, which is what this did, handed the choice to whoever answered.
    // A rogue Host could fetch a nonce from the real one, pass it on with the
    // real one's name attached, and replay the signature there: a device-bound
    // session on a Host the user never spoke to. The field exists to be
    // checked, not copied.
    // An empty expectation is a misconfiguration, not a licence to skip: there
    // is no name to check against, so there is nothing holding the signature to
    // this Host.
    if (!this.#host || challenge.host.toLowerCase() !== this.#host) {
      throw new TransportError(0, 'wrong_host');
    }

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

  /**
   * POST, and try again when the answer says trying again would work.
   *
   * Every request this class makes is safe to repeat. `register` is idempotent
   * by design; `/auth/challenge` just mints another nonce; `/auth/session`
   * spends one, and a refusal means the handler never ran — the limiter is
   * middleware in front of it, and a 5xx is the same story — so the nonce is
   * still there to spend.
   *
   * It matters because this is the *startup* path. A rate limit is transient
   * by definition and says so in a header, and giving up on one left a
   * signed-in account with no core at all: no rooms, no messages, nothing to
   * retry with. Two accounts on one machine was enough to cause it.
   *
   * Bounded and short. Three attempts, and `Retry-After` is honoured but
   * clamped — a server asking us to wait a minute is telling us to stop, not
   * to sleep through the app's entire startup, and the caller has a Try again
   * button for that case.
   */
  async #json<T>(path: string, body: unknown): Promise<T> {
    let last: TransportError | undefined;
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      if (attempt > 0) await this.#sleep(backoff(last, attempt));
      const response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.ok) return (await response.json()) as T;

      const reason = await response
        .json()
        .then((b: unknown) => (b as { error?: string })?.error)
        .catch(() => undefined);
      last = new TransportError(response.status, reason ?? `http_${response.status}`);
      // A 403 will still be a 403 in a second. Only the ones that might not be.
      if (!last.retryable) throw last;
      last.retryAfter = seconds(response.headers.get('retry-after'));
    }
    throw last as TransportError;
  }
}

/** Attempts in total, not retries after the first. */
const RETRIES = 3;
/** Long enough for a token to refill, short enough not to look like a hang. */
const MAX_WAIT_MS = 4000;

/**
 * How long to wait before attempt `n`.
 *
 * The server's `Retry-After` when it gave one, because it knows when its own
 * bucket refills and we are guessing; otherwise exponential from 250ms. Capped
 * either way.
 */
function backoff(last: TransportError | undefined, attempt: number): number {
  const asked = last?.retryAfter;
  if (asked !== undefined) return Math.min(asked * 1000, MAX_WAIT_MS);
  return Math.min(250 * 2 ** (attempt - 1), MAX_WAIT_MS);
}

/** `Retry-After` in whole seconds, or undefined if it was absent or a date. */
function seconds(header: string | null): number | undefined {
  if (!header) return undefined;
  const n = Number(header);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function toBase64url(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
