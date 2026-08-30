/**
 * Waking a device that is not listening.
 *
 * `docs/04` §5: "the server sends a **content-free** push (`{room}` at most)
 * for `normal` events to devices with no live socket; the client wakes, syncs
 * from its cursors, decrypts, and decides locally whether that deserves a
 * notification. **Reconcile-on-open means a missed push never means a missed
 * message.**"
 *
 * That last clause is why this file can be as thin as it is. A push is a
 * *nudge*, not a delivery: it carries nothing, it is allowed to be lost, and
 * everything it would have said is already fetchable over HTTP. So the design
 * question is never "what do we put in it" — nothing — but **who gets woken,
 * and what does waking them reveal**.
 *
 * ## Four rules, and they are all about that second question
 *
 * 1. **Only `normal` events.** A `silent` event never notifies by definition
 *    (`docs/04` §2) — a read receipt that woke a phone would be the most
 *    annoying feature ever shipped, and a reaction that did would be the second.
 *    An `ephemeral` event is not even stored.
 * 2. **Only devices with no live socket.** A connected device already has the
 *    event. Pushing anyway would double every message and tell the push service
 *    about traffic it would otherwise never see.
 * 3. **Never the sender's own devices.** You do not need waking about a thing
 *    you just did, and it would tell a push service every time you sent
 *    something.
 * 4. **A revoked device gets nothing**, and its subscription is dropped at
 *    revocation — a signed-out phone's endpoint is a live line to a device
 *    whose whole point was to stop being one.
 *
 * ## What is a seam, and why
 *
 * Actually putting a push on the wire is [`PushSender`], and the default does
 * nothing. Web Push proper is RFC 8292 (VAPID, an ES256 JWT) plus RFC 8291
 * (payload encryption) — and since these pushes have **no payload**, only the
 * first is needed. That is still a signing scheme against a service this
 * codebase cannot reach from a test, and a subtly wrong implementation of it is
 * worse than an absent one: it fails silently, per-device, in production.
 *
 * So the part that is Revel's — who, when, and what may be said — is here and
 * tested, and the part that is a protocol against somebody else's server is a
 * dependency a deployment supplies.
 */
import { type Event, PushSubscription } from '@revel/protocol';
import type { Hono } from 'hono';
import type { Hub } from './hub.js';
import type { Actor } from './policy.js';
import type { Store, StoredPushSubscription } from './store/types.js';

/** What a deployment plugs in. */
export interface PushSender {
  /**
   * Wake a device. The hint is `{ room }` at most and may be dropped entirely.
   *
   * Failure is not an error worth propagating: a push that does not arrive
   * costs a delay, because the client reconciles on open regardless.
   */
  send(subscription: StoredPushSubscription, hint: { room?: string }): Promise<void>;
}

export interface PushDeps {
  store: Store;
  hub: Hub;
  sender?: PushSender;
  /**
   * Whether to include the room id.
   *
   * Off by default, which is the strongest reading of "content-free": a push
   * with no body at all needs no payload encryption and tells the push service
   * nothing beyond "this endpoint had something happen". On means the client
   * can sync one room instead of all of them, at the cost of handing a room id
   * to a service that had none.
   */
  includeRoom?: boolean;
}

/**
 * Wake whoever needs waking about one event.
 *
 * Returns the devices actually pushed, which is what the tests assert on —
 * the interesting behaviour is entirely in who is *not* in that list.
 */
export async function notify(deps: PushDeps, event: Event): Promise<string[]> {
  // Rule 1. Cheapest check first, and the one that matters most: everything
  // else in this function is about who, and this is about whether at all.
  if (event.class !== 'normal') return [];
  if (!deps.sender) return [];

  const room = await deps.store.getRoom(event.room);
  if (!room) return [];

  // Rule 3 is about the *account*, not the device. Your laptop must not buzz
  // about something you just sent from your phone: you sent it, which is the
  // strongest possible signal that you have seen it.
  const sender = await deps.store.getDevice(event.sender);

  const woken: string[] = [];
  for (const membership of await deps.store.listRoomMembers(room.id)) {
    if (sender && membership.accountId === sender.accountId) continue;

    for (const device of await deps.store.listAccountDevices(membership.accountId)) {
      // Rule 2.
      if (deps.hub.isOnline(device.pub)) continue;
      // Rule 4 is enforced twice: subscriptions are dropped at revocation, and
      // `listAccountDevices` already excludes revoked devices. Belt and braces
      // on the one rule whose failure is a message going somewhere it should
      // not.
      if (device.revokedAt) continue;

      const subscription = await deps.store.getPushSubscription(device.pub);
      if (!subscription) continue;

      await deps.sender
        .send(subscription, deps.includeRoom ? { room: room.id } : {})
        .catch(() => {});
      woken.push(device.pub);
    }
  }
  return woken;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export interface PushRouteDeps {
  store: Store;
  authenticate(req: Request): Promise<Actor | null>;
  now?: () => number;
}

export function mountPush(app: Hono, deps: PushRouteDeps): void {
  const now = deps.now ?? (() => Date.now());

  /**
   * Register where to wake this device.
   *
   * Per device, not per account: `docs/17` is explicit that account switching
   * uses "separate device keys, separate sessions, **separate push
   * subscriptions**", because a shared push token across accounts is exactly
   * the correlation leak that would undo cryptographic unlinkability.
   *
   * A new subscription replaces the old one. A device has one push channel, and
   * keeping the previous one means waking a browser profile somebody deleted.
   */
  app.put('/push/subscription', async (c) => {
    const actor = await deps.authenticate(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const parsed = PushSubscription.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_subscription' }, 400);

    await deps.store.putPushSubscription({
      devicePub: actor.devicePub,
      kind: parsed.data.kind,
      endpoint: parsed.data.endpoint,
      ...(parsed.data.keys ? { keys: parsed.data.keys } : {}),
      createdAt: now(),
    });
    return c.body(null, 204);
  });

  /** Stop. Sent when notifications are turned off, and on sign-out. */
  app.delete('/push/subscription', async (c) => {
    const actor = await deps.authenticate(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);
    await deps.store.deletePushSubscription(actor.devicePub);
    return c.body(null, 204);
  });
}
