/**
 * Push subscriptions.
 *
 * `docs/04` §5: "the server sends a **content-free** push (`{room}` at most)
 * for `normal` events to devices with no live socket; the client wakes, syncs
 * from its cursors, decrypts, and decides locally whether that deserves a
 * notification. **Reconcile-on-open means a missed push never means a missed
 * message.**"
 *
 * That last sentence is what makes the whole thing safe to keep this thin. A
 * push here is a *nudge*, not a delivery: it carries nothing, it is allowed to
 * be lost, and everything it would have said is already fetchable. So the
 * design question is not "what do we put in it" — the answer is nothing — but
 * "who gets woken, and what does the act of waking them reveal".
 */
import { z } from 'zod';
import { DevicePub, Snowflake } from './ids.js';

/**
 * Where a push goes.
 *
 * Web Push is the only one implemented; APNs and FCM are named because
 * `docs/05` is explicit that iOS needs a native path and Web Push there is
 * "not at all in the EU (DMA), flaky after restarts". Naming them now means the
 * shape does not have to change when one arrives.
 */
export const PushKind = z.enum(['webpush', 'apns', 'fcm']);
export type PushKind = z.infer<typeof PushKind>;

export const PushSubscription = z.object({
  kind: PushKind,
  /** The push service URL, or a device token for APNs/FCM. */
  endpoint: z.string().max(2048),
  /**
   * Web Push's `p256dh` and `auth`, if a deployment ever sends a payload.
   *
   * Optional because the pushes this server sends carry **no payload at all**,
   * which needs only VAPID — and a push with no body is the strongest possible
   * form of "content-free". A deployment that wants the `{room}` hint needs
   * these; one that does not should not be storing them.
   */
  keys: z.object({ p256dh: z.string().max(256), auth: z.string().max(256) }).optional(),
});
export type PushSubscription = z.infer<typeof PushSubscription>;

/**
 * What a push may say.
 *
 * At most a room id (`docs/04` §5). Never a sender, never a count, never a
 * word of content — the server has none of those and must not learn to want
 * them. A client that receives one syncs the room and decides for itself
 * whether anything deserves a notification, which is also the only place that
 * decision *can* be made: the rules are the user's and the content is
 * encrypted.
 */
export const PushHint = z.object({ room: Snowflake.optional() });
export type PushHint = z.infer<typeof PushHint>;

export const PushSubscriptionInfo = z.object({
  device: DevicePub,
  kind: PushKind,
  createdAt: z.number().int(),
});
export type PushSubscriptionInfo = z.infer<typeof PushSubscriptionInfo>;
