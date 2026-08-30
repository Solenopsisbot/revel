/** Bun entrypoint. Wires the app to Bun's HTTP and WebSocket server. */
import { SnowflakeFactory } from '@revel/protocol';
import { createApp } from './app.js';
import { sessionAuthenticator } from './auth.js';
import { Hub } from './hub.js';
import { type Actor, SocketSession } from './socket.js';
import { MemoryStore } from './store/memory.js';

const store = new MemoryStore();
const hub = new Hub();

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

const app = createApp({ store, hub, ids: new SnowflakeFactory(0), authenticate, host, idp });

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
