/**
 * The HTTP surface.
 *
 * The whole job: authenticate the device, check policy, assign an id, store
 * opaque bytes, fan out. If this file ever needs to know what an event *means*,
 * something has gone wrong (`docs/02` principle 3).
 */
import { type Event, EventInput, type SnowflakeFactory } from '@revel/protocol';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { mountAccounts } from './accounts.js';
import { mountAuth } from './auth.js';
import { mountBlobs } from './blobs.js';
import { mountEnrolment, type OpaqueServer } from './enrolment.js';
import { mountGroups, nudgeCommitter } from './groups.js';
import type { Hub } from './hub.js';
import { canPurge, canRead, canSend } from './policy.js';
import type { PushSender } from './push.js';
import { mountPush, notify } from './push.js';
import { rateLimit } from './ratelimit.js';
import { mountRooms } from './rooms.js';
import type { Store } from './store/types.js';
import type { SecurityContact } from './wellknown.js';
import { mountWellKnown } from './wellknown.js';

export interface AppDeps {
  store: Store;
  hub: Hub;
  ids: SnowflakeFactory;
  /**
   * Resolve a request to the device that sent it.
   *
   * Production passes `sessionAuthenticator` from `auth.ts` — `docs/03` §2's
   * device-key challenge-response. It stays a dependency so the policy tests
   * can hand over a device id directly: a hundred tests about permissions
   * should test permissions, not perform a signature each.
   */
  authenticate(req: Request): Promise<{ accountId: string; devicePub: string } | null>;
  /** This Host's name, as it appears in the challenge a device signs. */
  host?: string;
  /**
   * This IdP's name — the part after the `@` in an address.
   *
   * Separate from `host` because `docs/02` splits the two roles: a Host serves
   * rooms, an IdP serves handles, and one box can be either or both. Defaults
   * to the Host's name, which is the "both" case.
   */
  idp?: string;
  /** Largest attachment ciphertext this Host will hold. See `blobs.ts`. */
  maxBlobBytes?: number;
  /**
   * This Host's device certificate, base64 — its identity as an MLS external
   * sender (`docs/03` §5). Absent means it does not act as one, and groups
   * opened against it will refuse external proposals.
   */
  externalSender?: string | null;
  /** The OPAQUE server. Absent means this Host does not serve an IdP. */
  opaque?: OpaqueServer;
  /** A long-lived server secret, for answers about accounts that do not exist. */
  decoyKey?: string;
  /**
   * Rate limiting. Absent means none, which is right for a test and wrong for
   * anything reachable — `docs/29` §6.
   */
  rateLimit?: Parameters<typeof rateLimit>[0];
  /**
   * Security contact, for `/.well-known/security.txt`.
   *
   * Absent means the file is not served at all. A `security.txt` pointing at an
   * address nobody reads is worse than none.
   */
  security?: SecurityContact;
  /**
   * Push. Absent means no device is ever woken, which is a working deployment
   * — everything arrives on the next open — and a poor one on a phone.
   */
  push?: { sender?: PushSender; includeRoom?: boolean };
  /**
   * The clock, for the parts that need one injected.
   *
   * Only the IdP takes it so far: TOTP is time-based, so a test that cannot
   * move the clock cannot test a code expiring, being replayed a step later, or
   * the window boundary — which is most of what there is to get wrong.
   */
  now?: () => number;
}

const denialStatus: Record<string, ContentfulStatusCode> = {
  no_such_room: 404,
  not_a_member: 403,
  missing_permission: 403,
  stream_not_enabled: 400,
  notify_not_enabled: 400,
  notify_everyone_denied: 403,
};

export function createApp(deps: AppDeps) {
  const app = new Hono();

  // First, before anything reads a body or touches the store. A limiter that
  // runs after the work it is limiting is decoration.
  if (deps.rateLimit) app.use('*', rateLimit(deps.rateLimit));

  app.get('/health', (c) => c.json({ ok: true }));

  app.post('/rooms/:room/events', async (c) => {
    const actor = await deps.authenticate(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const parsed = EventInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_event' }, 400);
    const input = parsed.data;

    const roomId = c.req.param('room');
    const denial = await canSend(deps.store, roomId, actor, input);
    if (denial) return c.json({ error: denial }, denialStatus[denial] ?? 403);

    const event: Event = {
      ...input,
      id: deps.ids.next(),
      room: roomId,
      sender: actor.devicePub,
      size: input.payload.length,
      createdAt: Date.now(),
      purgedAt: null,
    };

    // Ephemeral events (typing) are relayed and never stored — that is the
    // whole point of the class (`docs/04` §2).
    if (input.class === 'ephemeral') {
      deps.hub.broadcast(roomId, event);
      return c.json({ event, stored: false }, 202);
    }

    const { event: stored, deduped } = await deps.store.appendEvent(event);
    // A deduped retry must not fan out twice, or every dropped response would
    // show the room a duplicate message.
    if (!deduped) deps.hub.broadcast(roomId, stored);

    // Sending is what makes you the designated committer (`docs/03` §5) — the
    // Host "tracks this trivially", and this is the tracking. If proposals are
    // already waiting, the same send is the moment to ask for a commit: it
    // proves this device is awake, which is the only thing a nudge needs.
    // Wake whoever is not here. Content-free, `normal` only, and never a
    // device that already has a socket — `push.ts` holds the rules.
    if (!deduped && deps.push) {
      await notify({ ...deps.push, store: deps.store, hub: deps.hub }, stored);
    }

    const room = await deps.store.getRoom(roomId);
    if (room?.groupId && !deduped) {
      await deps.store.touchGroupMember(room.groupId, actor.devicePub, Date.now());
      await nudgeCommitter(deps, room.groupId);
    }

    return c.json({ event: stored, stored: true, deduped }, deduped ? 200 : 201);
  });

  app.get('/rooms/:room/events', async (c) => {
    const actor = await deps.authenticate(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const roomId = c.req.param('room');
    const denial = await canRead(deps.store, roomId, actor);
    if (denial) return c.json({ error: denial }, denialStatus[denial] ?? 403);

    const before = c.req.query('before') ?? undefined;
    const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200);
    return c.json({ events: await deps.store.listEvents(roomId, { before, limit }) });
  });

  app.delete('/rooms/:room/events/:id', async (c) => {
    const actor = await deps.authenticate(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const roomId = c.req.param('room');
    const denial = await canPurge(deps.store, roomId, actor);
    if (denial) return c.json({ error: denial }, denialStatus[denial] ?? 403);

    const ok = await deps.store.purgeEvent(roomId, c.req.param('id'));
    if (!ok) return c.json({ error: 'no_such_event' }, 404);
    // Tell live clients to drop their local copy. The in-band redaction that
    // carries the reason is a separate encrypted event the mod's client sends.
    deps.hub.broadcast(roomId, {
      id: c.req.param('id'),
      room: roomId,
      sender: actor.devicePub,
      class: 'silent',
      epoch: 0,
      payload: '',
      size: 0,
      createdAt: Date.now(),
      purgedAt: Date.now(),
      clientNonce: `purge-${c.req.param('id')}`,
    });
    return c.body(null, 204);
  });

  const idp = deps.idp ?? deps.host ?? 'localhost';
  mountWellKnown(app, { ...(deps.security ? { security: deps.security } : {}) });
  mountAuth(app, { store: deps.store, host: deps.host ?? 'localhost' });

  // The IdP, when this Host has an OPAQUE setup to serve it with. Absent means
  // the routes are simply not mounted — the same shape as `security.txt` with
  // no contact: a missing capability rather than a broken one.
  if (deps.opaque) {
    mountEnrolment(app, {
      store: deps.store,
      opaque: deps.opaque,
      idp,
      authenticate: deps.authenticate,
      newId: () => deps.ids.next(),
      // The OPAQUE setup doubles as the decoy key: it is already a long-lived
      // server secret, and this needs nothing more than that.
      decoyKey: deps.decoyKey ?? 'revel-decoy',
      ...(deps.now ? { now: deps.now } : {}),
    });
  }

  mountAccounts(app, {
    store: deps.store,
    idp,
    host: deps.host ?? 'localhost',
    externalSender: deps.externalSender ?? null,
    authenticate: deps.authenticate,
  });
  mountPush(app, { store: deps.store, authenticate: deps.authenticate });
  mountBlobs(app, {
    store: deps.store,
    newId: () => deps.ids.next(),
    authenticate: deps.authenticate,
    ...(deps.maxBlobBytes === undefined ? {} : { maxBytes: deps.maxBlobBytes }),
  });
  mountRooms(app, { store: deps.store, ids: deps.ids, idp, authenticate: deps.authenticate });

  mountGroups(app, {
    store: deps.store,
    hub: deps.hub,
    newId: () => deps.ids.next(),
    authenticate: deps.authenticate,
  });

  return app;
}
