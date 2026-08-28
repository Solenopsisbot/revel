/**
 * The HTTP surface.
 *
 * The whole job: authenticate the device, check policy, assign an id, store
 * opaque bytes, fan out. If this file ever needs to know what an event *means*,
 * something has gone wrong (`docs/02` principle 3).
 */
import { EventInput, SnowflakeFactory, type Event } from '@revel/protocol';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { Hub } from './hub.js';
import { canPurge, canRead, canSend } from './policy.js';
import type { Store } from './store/types.js';

export interface AppDeps {
  store: Store;
  hub: Hub;
  ids: SnowflakeFactory;
  /**
   * Resolve a request to the device that sent it. Real deployments use a
   * device-key challenge-response (`docs/17` §2); this is the seam.
   */
  authenticate(req: Request): Promise<{ accountId: string; devicePub: string } | null>;
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

  return app;
}
