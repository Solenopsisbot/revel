/**
 * What a room looks like once every event has been applied.
 *
 * This is the shape the UI reads and the local store persists — the
 * "materialised state" of `docs/04` §Client-side. It is produced only by
 * `reduce.ts` and never edited in place by anything else, which is the property
 * that makes a room's contents a function of its event log rather than of
 * whatever order things happened to arrive in.
 */
import type { FaceRef } from '@revel/protocol';

/** A decrypted event, ready to be applied. */
export interface LocalEvent {
  /** Server-assigned snowflake. Sorting by it sorts by time (`docs/04` §6). */
  id: string;
  /**
   * The **account** that sent it.
   *
   * The envelope carries the sending *device*; which account that device
   * belongs to comes from the MLS roster, and the layer that decrypts knows it.
   * The reducer cannot derive it and will not guess: receipts are per account,
   * and so is "may this person redact that".
   */
  account: string;
  /** Milliseconds. The server's clock, not the sender's. */
  at: number;
  /** The sender's idempotency key, when we were the sender. */
  clientNonce?: string;
  /** Set when the server has purged the bytes; the tombstone survives. */
  purgedAt?: number | null;
  /** The decrypted payload, parsed. Unknown types are preserved, not dropped. */
  payload: ParsedPayload;
}

/**
 * Mirrors `parseEncrypted`'s result, restated here so this package does not
 * make callers import a zod-inferred union to describe their own data.
 */
export type ParsedPayload =
  | { known: true; event: KnownEvent }
  /** `raw` is whatever was there — JSON, not necessarily an object. See
   *  `parseEncrypted`: typing it as a record was a lie for a payload that is a
   *  bare string or array, which a buggy client can genuinely send. */
  | { known: false; type: string; raw: unknown };

/** Narrowed from `@revel/protocol`'s `EncryptedEvent` at the call site. */
// biome-ignore lint/suspicious/noExplicitAny: the protocol union is zod-inferred
export type KnownEvent = { type: string; v: number } & Record<string, any>;

export interface Reaction {
  key: string;
  /** Accounts that reacted, in the order they did. */
  accounts: string[];
}

export interface Annotation {
  /** One per (target, author, kind) — a later one replaces an earlier one. */
  author: string;
  kind: string;
  body: unknown;
  at: number;
}

/** A previous body of an edited message, kept because `docs/04` §3 says to. */
export interface Edit {
  body: unknown;
  at: number;
}

export interface Message {
  id: string;
  account: string;
  /** A snapshot of the face that spoke, so renaming a face later changes
   *  nothing about how an old message renders (`docs/04` §2). */
  face?: FaceRef;
  body: unknown;
  at: number;

  /** Sent, not yet acknowledged. Renders provisional (`docs/32`). */
  pending?: boolean;
  /** The send failed and is retryable. Set by the sender, not by an event. */
  failed?: boolean;
  clientNonce?: string;

  /** When the body last changed. Renders as a quiet "edited". */
  editedAt?: number;
  /** Every earlier body, oldest first. */
  edits?: Edit[];

  /**
   * A tombstone. The row stays so the conversation still makes sense; the
   * content is gone. Who removed it is a different fact from that it was
   * removed, and the two get different words in the UI.
   */
  redacted?: { by: 'author' | 'moderator'; at: number; reason?: string };
  /** The server dropped the bytes. Distinct from a redaction: nobody chose it. */
  purged?: boolean;
  /** When the server dropped them. */
  purgedAt?: number;

  pinned?: boolean;
  /**
   * The id of the event that pinned it.
   *
   * `pinned` is ordered by this rather than by the order pins happened to be
   * applied in. "Most recently pinned first" has to be a fact about the log,
   * not about which page of history arrived first, or two devices that
   * synced differently would show the noticeboard in different orders.
   */
  pinnedAt?: string;
  reactions?: Reaction[];
  annotations?: Annotation[];

  replyTo?: string;
  /** The message this branches off, if it is a thread reply (`docs/16`). */
  thread?: string;

  // biome-ignore lint/suspicious/noExplicitAny: BlobRef, kept loose at this seam
  attachments?: any[];
  mentions?: string[];
  expression?: string;
  /** Honoured client-side at render time, never by deleting (`docs/03` §10). */
  expiresAt?: number;

  /**
   * An event type this build does not understand.
   *
   * It keeps its place in the timeline and renders as a fallback rather than
   * vanishing — `docs/29` §1 rule 3. Dropping it would be worse than showing
   * "something happened here": encrypted history cannot be re-fetched into
   * existence once a client has decided it was noise.
   */
  unknown?: { type: string; raw: unknown };
}

export interface RoomState {
  roomId: string;
  name?: string;
  topic?: string;
  /**
   * The id of the event that set the name and topic.
   *
   * Last write wins, and "last" has to mean by event id rather than by
   * whichever page of history arrived last — otherwise scrolling up far enough
   * renames the room to something it was called a year ago.
   */
  nameAt?: string;

  /** In event-id order, which is time order. */
  messages: Message[];
  /** id → the same object that is in `messages`. */
  byId: Map<string, Message>;

  /** Pinned message ids, most recently pinned first — by `Message.pinnedAt`. */
  pinned: string[];
  /** account → the last event id they have read. Only ever moves forward. */
  receipts: Map<string, string>;

  /**
   * Thread names, by the id of the message each branches from.
   *
   * Only the **name** is stored. Everything else about a thread — how many
   * replies, who is in it, when it last moved — is derivable from the messages
   * that carry `thread`, and `threadsIn` derives it. Two sources of truth for
   * the same count is two things that can disagree, and the derived one cannot.
   */
  threadNames: Map<string, string>;
  /** Which event set each name, so a page of old history cannot un-rename one. */
  threadNamesAt: Map<string, string>;
  /** face id → the face, from `room.faces`. */
  faces: Map<string, FaceRef>;
  /** face id → the id of the event that last set it. Same reason as `nameAt`. */
  facesAt: Map<string, string>;
  /** thread root id → reply ids, in order. */
  threads: Map<string, string[]>;

  /**
   * Every event id applied.
   *
   * Idempotency the blunt way, and deliberately: a sync engine re-fetches, a
   * socket reconnects and replays, and an event applied twice must change
   * nothing. Deriving that per event type is a per-type opportunity to get it
   * wrong. This can be compacted below a watermark once history is settled.
   */
  applied: Set<string>;
  /** The highest event id applied. */
  lastEventId?: string;

  /**
   * Events waiting for the message they refer to, keyed by that message's id.
   *
   * An edit, a reaction, a pin or an annotation names a target, and there is no
   * guarantee the target has arrived. Dropping those would be *almost* fine —
   * except that scrolling up is exactly the case where it is not: live
   * messages arrive first, then a backfill brings the older ones, and a
   * reaction to something you had not loaded yet would be gone for good.
   *
   * So they are parked here and applied the moment their target lands. This is
   * what makes the reducer genuinely independent of the order events are
   * *delivered* in, rather than only of the order within one batch.
   */
  deferred: Map<string, LocalEvent[]>;
}

export function emptyRoom(roomId: string): RoomState {
  return {
    roomId,
    messages: [],
    byId: new Map(),
    pinned: [],
    receipts: new Map(),
    threadNames: new Map(),
    threadNamesAt: new Map(),
    faces: new Map(),
    facesAt: new Map(),
    threads: new Map(),
    applied: new Set(),
    deferred: new Map(),
  };
}

/**
 * Order two snowflakes.
 *
 * They are decimal strings of up to 20 digits, so plain string comparison is
 * wrong the moment two ids differ in length — `"9"` sorts after `"10"`. Compare
 * by length first, which is correct for non-negative decimals with no leading
 * zeros, and avoids parsing 20 digits into a BigInt on every comparison.
 */
export function compareIds(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}
