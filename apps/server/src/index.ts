/** Bun entrypoint. Wires the app to Bun's HTTP and WebSocket server. */
import { SnowflakeFactory } from '@revel/protocol';
import { createApp } from './app.js';
import { Hub } from './hub.js';
import { type Actor, SocketSession } from './socket.js';
import { MemoryStore } from './store/memory.js';

const store = new MemoryStore();
const hub = new Hub();

/** Placeholder until device challenge-response lands (`docs/17` §2). */
async function authenticate(req: Request): Promise<Actor | null> {
  const device = req.headers.get('x-revel-device') ?? new URL(req.url).searchParams.get('device');
  if (!device) return null;
  const record = await store.getDevice(device);
  if (!record || record.revokedAt) return null;
  return { accountId: record.accountId, devicePub: record.pub };
}

const app = createApp({ store, hub, ids: new SnowflakeFactory(0), authenticate });

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
      const actor = await authenticate(req);
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
