/**
 * Rate limiting that is not, accidentally, a log.
 *
 * `docs/29` §3 draws the line this file has to sit on: "no per-user request
 * logs **beyond what rate limiting needs**". A limiter is the one place a
 * privacy-first server is allowed to remember who did something recently, so it
 * had better remember the minimum and forget it as fast as possible.
 *
 * Three properties, and they are the design:
 *
 * 1. **A bucket holds a count and a timestamp.** Not a path, not a method, not
 *    a body, not a history. There is nothing in here to subpoena.
 * 2. **A full bucket is deleted.** Once a bucket has refilled it says exactly
 *    what an absent bucket says — nothing — so keeping it would be storing
 *    information for no reason. Forgetting is free, so it is not optional.
 * 3. **Nothing is written anywhere.** It lives in a Map and dies with the
 *    process, which is a real limitation (a restart forgives everybody) and the
 *    right trade at this size.
 *
 * ## Token buckets, not fixed windows
 *
 * A fixed window lets somebody spend a whole window's quota in the last second
 * of one and the first second of the next — twice the intended rate, at the
 * worst possible moment. A token bucket has a burst size and a sustained rate,
 * which is also what real use looks like: you paste four messages at once and
 * then say nothing for a minute.
 */

export interface Bucket {
  /** Burst: how many requests may arrive at once from cold. */
  capacity: number;
  /** Sustained rate, in tokens per second. */
  refillPerSecond: number;
}

export interface Verdict {
  ok: boolean;
  /** Seconds until one token is available. Whole seconds, for `Retry-After`. */
  retryAfter: number;
  /** What is left, for a caller that wants to spend it on a header. */
  remaining: number;
}

/**
 * How many buckets to hold before sweeping.
 *
 * Not a limit on distinct callers — a sweep drops the ones that have refilled,
 * which is nearly all of them — but a bound on how far memory can run away from
 * somebody rotating addresses.
 */
const SWEEP_AT = 10_000;

export class RateLimiter {
  #buckets = new Map<string, { tokens: number; at: number }>();
  #now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.#now = now;
  }

  /** How many buckets are being held. Exposed so a test can assert forgetting. */
  get size(): number {
    return this.#buckets.size;
  }

  /**
   * Spend a token, if there is one.
   *
   * The key is the caller's business, and the caller decides what a "caller"
   * is: an account for an authenticated request, an address for one that has
   * not proved anything yet. Mixing the two in one key space is fine and
   * intentional — they are different strings.
   */
  take(key: string, bucket: Bucket, cost = 1): Verdict {
    const now = this.#now();
    const held = this.#buckets.get(key);

    const tokens = held
      ? Math.min(bucket.capacity, held.tokens + ((now - held.at) / 1000) * bucket.refillPerSecond)
      : bucket.capacity;

    if (tokens < cost) {
      // Not stored as a rejection, because storing rejections is how a limiter
      // becomes an attack log. The bucket is updated and that is all.
      this.#buckets.set(key, { tokens, at: now });
      const wait = (cost - tokens) / bucket.refillPerSecond;
      return { ok: false, retryAfter: Math.max(1, Math.ceil(wait)), remaining: 0 };
    }

    const left = tokens - cost;
    if (left >= bucket.capacity) {
      // Refilled by spending, which can only mean the cost was zero. Nothing to
      // remember.
      this.#buckets.delete(key);
    } else {
      this.#buckets.set(key, { tokens: left, at: now });
      if (this.#buckets.size > SWEEP_AT) this.sweep(bucket);
    }
    return { ok: true, retryAfter: 0, remaining: Math.floor(left) };
  }

  /**
   * Drop every bucket that has refilled.
   *
   * A full bucket says exactly what a missing one says, so this loses no
   * enforcement at all — and it is the step that keeps this from being a record
   * of who was here.
   */
  sweep(bucket: Bucket): number {
    const now = this.#now();
    let dropped = 0;
    for (const [key, held] of this.#buckets) {
      const tokens = held.tokens + ((now - held.at) / 1000) * bucket.refillPerSecond;
      if (tokens >= bucket.capacity) {
        this.#buckets.delete(key);
        dropped += 1;
      }
    }
    return dropped;
  }

  /** Sign-out, tests, and anything that wants a clean slate. */
  clear(): void {
    this.#buckets.clear();
  }
}

/**
 * What each kind of request costs.
 *
 * **These numbers are chosen, not specified.** No doc gives any, and the real
 * ones depend on what a Host is running on and who is using it — `docs/27` §2
 * is the discussion about scale and it is unresolved. They are grouped by what
 * a request *costs the server*, which is the only thing a limit can defend:
 *
 * - `auth` is unauthenticated and does public-key work. The cheapest request to
 *   send and among the most expensive to serve, which is the classic shape of a
 *   denial-of-service target.
 * - `lookup` is unauthenticated and also the enumeration surface: resolving
 *   handles quickly enough, one at a time, is how somebody builds a directory
 *   nobody agreed to publish.
 * - `upload` is bytes.
 * - `write` allows a real burst, because pasting four messages at once is what
 *   people do, and then a sustained rate well above anybody typing.
 */
export const LIMITS = {
  auth: { capacity: 10, refillPerSecond: 0.2 },
  /**
   * Registering a device certificate.
   *
   * It was `auth`, and that was wrong in a way that only shows up on a shared
   * address. `auth` is sized against *password guessing*, where every attempt
   * is an attempt and ten in a burst is already suspicious. Device
   * registration is a different act: it is idempotent, it is self-
   * authenticating — the certificate either verifies against the account key
   * or it does not, and there is nothing to guess at — and a normal client
   * calls it once per device per start.
   *
   * On one bucket per address that meant two accounts on one machine, or a
   * household, or anyone behind carrier NAT, sharing ten tokens refilling at
   * one per five seconds. What that produced was a 429 during startup, which
   * the client surfaced as a core that would not start.
   *
   * Still bounded, because it does public-key work on bytes a stranger chose:
   * one signature verification a second, sustained, per address. An Ed25519
   * verify is tens of microseconds, so this is not the expensive part of
   * anything.
   */
  device: { capacity: 20, refillPerSecond: 1 },
  lookup: { capacity: 30, refillPerSecond: 0.5 },
  write: { capacity: 60, refillPerSecond: 5 },
  read: { capacity: 120, refillPerSecond: 10 },
  upload: { capacity: 10, refillPerSecond: 0.2 },
} as const satisfies Record<string, Bucket>;

export type LimitClass = keyof typeof LIMITS;

// ---------------------------------------------------------------------------
// As middleware
// ---------------------------------------------------------------------------

export interface RateLimitDeps {
  limiter: RateLimiter;
  /**
   * Who is asking, for a request that has not been authenticated yet.
   *
   * A network address, normally. Supplied by the caller rather than read here
   * because there is no portable way to get one — Bun, Node and a test each
   * answer differently — and because a Host behind a proxy has to decide which
   * header it trusts, which is a deployment decision and a security one.
   *
   * Returning the same string for everybody is a legitimate configuration: it
   * makes the limits global instead of per-caller, which is what you want on a
   * box where every request arrives from one reverse proxy you have not taught
   * to forward addresses yet.
   */
  address(req: Request): string;
  /**
   * Override the buckets. Absent means [`LIMITS`], which is the answer for
   * anything reachable.
   *
   * It exists for **local multi-client testing**, and that is a narrow enough
   * need to say out loud: in development every caller shares one bucket (see
   * `address` above), so two browsers signing up against one box exhaust the
   * `auth` capacity between them before either finishes. That is the limiter
   * working, and it also makes an honest end-to-end test impossible without a
   * way to say "not on this box".
   *
   * Not a way to turn limiting off — a caller still has to supply real buckets,
   * so a misconfiguration is a *different* limit rather than none at all.
   */
  limits?: Record<LimitClass, Bucket>;
  /** Off by default in tests, where 600 requests a minute is a Tuesday. */
  enabled?: boolean;
}

/**
 * Classify a request by what it costs to serve.
 *
 * A table rather than per-route middleware, because the interesting property is
 * that **every route has a class** — and a table is the only shape where a new
 * route without one is visible. The default is `read`, which is the cheapest
 * thing to get wrong.
 */
export function classify(method: string, path: string): LimitClass {
  // Before the `/auth/` test, because it is the more specific claim on a path
  // that would otherwise fall into a bucket sized for a different threat.
  if (method === 'POST' && path === '/idp/devices') return 'device';
  if (path.startsWith('/auth/')) return 'auth';
  if (path.startsWith('/idp/accounts/') && method === 'GET') return 'lookup';
  if (path.endsWith('/blobs') && method === 'POST') return 'upload';
  if (method === 'GET' || method === 'HEAD') return 'read';
  return 'write';
}

/**
 * Hono middleware.
 *
 * Keyed by the session token when there is one and by the address otherwise —
 * so a signed-in device gets its own allowance, and everything before sign-in
 * shares the allowance of wherever it came from. The token is hashed, because a
 * limiter that held credentials in memory would be a worse thing than the one
 * it replaced.
 */
export function rateLimit(deps: RateLimitDeps) {
  return async (
    c: {
      req: { method: string; path: string; raw: Request };
      header: (k: string, v: string) => void;
      json: (body: unknown, status: 429) => Response;
    },
    next: () => Promise<void>,
  ) => {
    if (deps.enabled === false) return next();

    const limit = classify(c.req.method, c.req.path);
    const subject = await subjectOf(deps, c.req.raw);
    const verdict = deps.limiter.take(`${limit}:${subject}`, (deps.limits ?? LIMITS)[limit]);

    if (!verdict.ok) {
      c.header('retry-after', String(verdict.retryAfter));
      return c.json({ error: 'rate_limited', retryAfter: verdict.retryAfter }, 429);
    }
    return next();
  };
}

async function subjectOf(deps: RateLimitDeps, req: Request): Promise<string> {
  const header = req.headers.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim();
    if (token) return `t:${await shortHash(token)}`;
  }
  return `a:${deps.address(req)}`;
}

/**
 * Enough hash to distinguish, not enough to be a credential.
 *
 * Truncated deliberately: the map only needs distinct keys, and a full digest
 * of a live token is a thing worth not having in a heap dump.
 */
async function shortHash(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}
