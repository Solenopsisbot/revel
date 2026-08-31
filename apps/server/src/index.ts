/** Bun entrypoint. Wires the app to Bun's HTTP and WebSocket server. */
import { SnowflakeFactory } from '@revel/protocol';
import { createApp } from './app.js';
import { createHostIdentity, sessionAuthenticator } from './auth.js';
import { Hub } from './hub.js';
import { RateLimiter } from './ratelimit.js';
import { type Actor, SocketSession } from './socket.js';
import { MemoryStore } from './store/memory.js';
import { PostgresStore } from './store/postgres.js';
import type { Store } from './store/types.js';

/**
 * Postgres when there is one, memory when there is not.
 *
 * The in-memory store is a real mode rather than a fallback — it is what
 * `revel dev` runs on and what the whole test suite uses (`docs/29` §4). What
 * it is *not* is a silent default for a deployment: a Host that came up on
 * memory because a connection string was misspelled would work perfectly and
 * lose every message on restart, which is the worst way for a mistake like that
 * to behave. So the choice is printed at boot, every time.
 */
const store: Store = await (async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('store: memory (no DATABASE_URL — nothing will survive a restart)');
    return new MemoryStore();
  }
  const pg = new PostgresStore({ url });
  await pg.migrate();
  console.log(`store: postgres (${new URL(url).host})`);
  return pg;
})();

const hub = new Hub();

/**
 * This process's snowflake shard (`docs/04` §6).
 *
 * **Every Host process sharing a database needs a different one.** Ids carry a
 * 12-bit shard so two processes can mint ids in the same millisecond without
 * colliding; two processes both on shard 0 collide the moment both are busy,
 * and an id collision is not a soft failure — `appendEvent`'s `ON CONFLICT`
 * clause arbitrates on `(sender, client_nonce)`, so a primary-key collision
 * escapes as an unhandled 500 and a blob collision is silent.
 *
 * It defaults to 0 because a single process is the common case and needing to
 * set an environment variable to run one server would be absurd. It is printed
 * at boot next to the store, because "two Hosts, one database, both on shard 0"
 * is a misconfiguration that works perfectly until it corrupts something.
 */
const shard = Number(process.env.REVEL_SHARD ?? 0);
console.log(
  `shard: ${shard}${shard === 0 ? ' (set REVEL_SHARD if this is not the only Host)' : ''}`,
);

/**
 * The Host's name, as it appears in the challenge a device signs.
 *
 * It is inside the signature, so a signature collected here cannot be presented
 * at another Host. Getting it wrong means every sign-in fails, which is the
 * right way for a misconfiguration this consequential to behave.
 */
const host = process.env.REVEL_HOST ?? `localhost:${process.env.PORT ?? 8080}`;

/** `docs/03` §2's device-key challenge-response. No passwords at Hosts, ever. */
const authenticate = sessionAuthenticator({ store, host });

/** The IdP this box serves handles for. Both roles in one process by default. */
const idp = process.env.REVEL_IDP ?? host;

/**
 * This Host's identity as an MLS external sender (`docs/03` §5).
 *
 * Generated per process, which is **wrong for a real deployment**: the key ends
 * up in the group context of every group opened while it was published, and a
 * restart with a new key means the Host can never propose into any of them.
 * There is nowhere in this codebase that durably holds a server secret yet —
 * that lands with `revel init` (`docs/29` §7).
 */
const hostIdentity = await createHostIdentity(host);

/**
 * The address a request came from, for the limiter.
 *
 * `REVEL_TRUST_PROXY` is off by default and has to be, because trusting
 * `x-forwarded-for` without a proxy in front means every caller sets their own
 * rate-limit key and the limiter stops existing. Turning it on is a statement
 * that something upstream overwrites the header.
 */
const trustProxy = process.env.REVEL_TRUST_PROXY === '1';
const address = (req: Request): string => {
  if (trustProxy) {
    const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  // No proxy and no portable way to see a socket from here: one shared bucket.
  // That makes the limits global rather than per-caller, which still bounds
  // what one process will do and is honest about what it is.
  return 'shared';
};

const app = createApp({
  store,
  hub,
  ids: new SnowflakeFactory(shard),
  authenticate,
  host,
  idp,
  externalSender: hostIdentity.certificate,
  rateLimit: { limiter: new RateLimiter(), address },
  // `docs/29` §6. Unset means `/.well-known/security.txt` is not served, which
  // is deliberate: a contact nobody reads is worse than no contact at all.
  ...(process.env.REVEL_SECURITY_CONTACT
    ? {
        security: {
          contact: [process.env.REVEL_SECURITY_CONTACT],
          ...(process.env.REVEL_SECURITY_POLICY
            ? { policy: process.env.REVEL_SECURITY_POLICY }
            : {}),
        },
      }
    : {}),
});

/**
 * Sweep expired challenges and sessions, hourly.
 *
 * A method nothing calls is a leak with documentation. Nothing depends on this
 * for correctness — every read checks expiry itself — so a missed sweep costs
 * rows and never a wrong answer, and `unref` means it does not hold the process
 * open on its own.
 */
const sweep = setInterval(
  () => {
    void store.sweepExpired(Date.now()).catch((err) => console.error('sweep failed', err));
  },
  60 * 60 * 1000,
);
sweep.unref?.();

const port = Number(process.env.PORT ?? 8080);
console.log(`revel server on :${port}`);

/**
 * One session per socket, kept off the socket object itself.
 *
 * Bun hands the same `ws` back on every callback, so a WeakMap keyed by it is
 * the natural place — and it means a session cannot outlive its socket even if
 * `close` is somehow missed.
 */
const sessions = new WeakMap<object, SocketSession>();

export default {
  port,
  async fetch(req: Request, server: { upgrade(req: Request, opts?: unknown): boolean }) {
    if (new URL(req.url).pathname === '/socket') {
      // The socket carries its token as a query parameter: browsers cannot set
      // headers on a WebSocket handshake, and a subprotocol would be worse —
      // it ends up in the same places a query string does and is harder to
      // rotate. Short-lived and single-Host, so a leaked URL is a leaked day.
      const url = new URL(req.url);
      const token = url.searchParams.get('token');
      const actor = await authenticate(
        token ? new Request(req.url, { headers: { authorization: `Bearer ${token}` } }) : req,
      );
      if (!actor) return new Response('unauthenticated', { status: 401 });
      // The actor is resolved *before* the upgrade, so an unauthenticated
      // socket is never opened at all rather than opened and then policed.
      if (server.upgrade(req, { data: { actor } })) return undefined as unknown as Response;
      return new Response('upgrade failed', { status: 400 });
    }
    return app.fetch(req);
  },
  websocket: {
    open(ws: { data: { actor: Actor }; send(data: string): void }) {
      const session = new SocketSession({ store, hub }, ws.data.actor, (frame) =>
        ws.send(JSON.stringify(frame)),
      );
      sessions.set(ws, session);
      // READY has already gone out synchronously; this is the part that can
      // touch the database. Floating on purpose — a failure here must not take
      // the socket down, and a Welcome that misses this pass is still queued.
      void session.start().catch((err) => console.error('socket start failed', err));
    },
    async message(ws: object, message: string | Uint8Array) {
      await sessions.get(ws)?.receive(typeof message === 'string' ? message : String(message));
    },
    close(ws: object) {
      sessions.get(ws)?.close();
      sessions.delete(ws);
    },
  },
};
