/**
 * The live socket's frames.
 *
 * Here rather than in either half, for the same reason everything else in this
 * package is: the server, every client and every SDK are typed against one
 * definition. A frame format that lives in the server and is re-typed in the
 * client is a frame format with two versions, and they diverge on the first
 * change nobody remembers to mirror.
 *
 * The socket carries **delivery**, not authority. Everything it sends could
 * also have been fetched over HTTP, and a client that misses a frame catches up
 * rather than losing anything — which is why there is no acknowledgement here
 * and no attempt at exactly-once. `docs/04` §6: the id ordering is what makes a
 * missed frame recoverable.
 */
import { z } from 'zod';
import { Event } from './envelope.js';
import { HandshakeRecord } from './groups.js';
import { Snowflake } from './ids.js';

/** What a client sends up. */
export const ClientFrame = z.discriminatedUnion('op', [
  /**
   * Start receiving events for these rooms.
   *
   * Idempotent and absolute per call: subscribing to a room twice is the same
   * as once, because a reconnect re-sends the whole set and should not have to
   * know what the last connection managed to register.
   */
  z.object({ op: z.literal('SUBSCRIBE'), d: z.object({ rooms: z.array(Snowflake).max(500) }) }),
  z.object({ op: z.literal('UNSUBSCRIBE'), d: z.object({ rooms: z.array(Snowflake).max(500) }) }),
  /** Keeps a connection alive through a middlebox that would otherwise cut it. */
  z.object({ op: z.literal('PING') }),
]);
export type ClientFrame = z.infer<typeof ClientFrame>;

/** What a server sends down. */
export const ServerFrame = z.discriminatedUnion('op', [
  /**
   * The connection is authenticated and usable.
   *
   * Carries nothing about what happened while it was gone. A client that
   * reconnects must catch up over HTTP — the socket cannot replay, and a
   * server that pretended to would be promising something it cannot keep
   * across a restart.
   */
  z.object({ op: z.literal('READY'), d: z.object({ device: z.string() }) }),
  z.object({ op: z.literal('EVENT'), d: Event }),
  /** Which rooms this connection is now receiving. */
  z.object({ op: z.literal('SUBSCRIBED'), d: z.object({ rooms: z.array(Snowflake) }) }),
  z.object({ op: z.literal('ERROR'), d: z.object({ reason: z.string() }) }),
  z.object({ op: z.literal('PONG') }),

  /**
   * One handshake record, pushed to a device the server believes is a member.
   *
   * Addressed per device rather than per room because a group can serve
   * several rooms (`docs/03` §4) and a device can be in a group whose rooms it
   * is not currently subscribed to. Missing one costs nothing: the log is
   * sequenced, and `GET /groups/:id/handshake?since=` is the catch-up.
   */
  z.object({ op: z.literal('HANDSHAKE'), d: HandshakeRecord }),

  /**
   * "You are the designated committer and proposals are waiting."
   *
   * `docs/03` §5: the nudge, with the 10-second deadline after which it moves
   * to the next most recently active online device. Advisory — a client that
   * ignores it is not broken, it is just slow, and any device that wants to
   * send while proposals are pending has to commit first anyway.
   */
  z.object({
    op: z.literal('COMMIT_REQUESTED'),
    d: z.object({ group: Snowflake, deadline: z.number().int() }),
  }),

  /**
   * A Welcome that was waiting for this device.
   *
   * Sent unprompted on connect, which is the whole point: being added to a
   * group while offline must not be a thing you have to go looking for.
   */
  z.object({
    op: z.literal('WELCOME'),
    d: z.object({ group: Snowflake, bytes: z.string().base64() }),
  }),
]);
export type ServerFrame = z.infer<typeof ServerFrame>;

export function parseClientFrame(json: unknown): ClientFrame | null {
  const result = ClientFrame.safeParse(json);
  return result.success ? result.data : null;
}

export function parseServerFrame(json: unknown): ServerFrame | null {
  const result = ServerFrame.safeParse(json);
  return result.success ? result.data : null;
}
