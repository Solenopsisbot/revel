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
  | { known: false; type: string; raw: Record<string, unknown> };

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

  pinned?: boolean;
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
  unknown?: { type: string; raw: Record<string, unknown> };
}

export interface RoomState {
  roomId: string;
  name?: string;
  topic?: string;

  /** In event-id order, which is time order. */
  messages: Message[];
  /** id → the same object that is in `messages`. */
  byId: Map<string, Message>;

  /** Pinned message ids, most recently pinned first. */
  pinned: string[];
  /** account → the last event id they have read. Only ever moves forward. */
  receipts: Map<string, string>;
  /** face id → the face, from `room.faces`. */
  faces: Map<string, FaceRef>;
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
}

export function emptyRoom(roomId: string): RoomState {
  return {
    roomId,
    messages: [],
    byId: new Map(),
    pinned: [],
    receipts: new Map(),
    faces: new Map(),
    threads: new Map(),
    applied: new Set(),
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
