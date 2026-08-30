/**
 * Encrypted event types — the part the server cannot see.
 *
 * Adding a feature means adding a variant here plus a reducer case plus UI.
 * The server does not change (`docs/04` §2). That is what makes the platform
 * open-ended rather than a fixed feature list.
 *
 * Two rules from `docs/29` §1, because encrypted history can never be
 * rewritten:
 *   1. Additive only. Never repurpose a field, never make an optional one
 *      required.
 *   2. Unknown fields are preserved and re-emitted, so a v1 client editing a
 *      v2 event does not destroy what it doesn't understand.
 */
import { z } from 'zod';

const Id = z.string().regex(/^\d{1,20}$/);

/** A snapshot of the face that spoke, so an old message renders correctly even
 *  after that face is renamed (`docs/04` §2). */
export const FaceRef = z.object({
  id: Id,
  name: z.string().min(1).max(80),
  color: z.string().max(32).optional(),
  avatar: z.string().max(512).optional(),
  pronouns: z.string().max(40).optional(),
});
export type FaceRef = z.infer<typeof FaceRef>;

/** A sealed attachment. The key travels in the event; the blob store holds
 *  ciphertext with no name and no type (`docs/22`). */
export const BlobRef = z.object({
  id: z.string().min(1).max(128),
  key: z.string().base64(),
  nonce: z.string().base64(),
  size: z.number().int().nonnegative(),
  mime: z.string().max(128),
  name: z.string().max(256),
  hash: z.string().base64(),
  alt: z.string().max(2000).optional(),
  thumb: z.string().min(1).max(128).optional(),
});
export type BlobRef = z.infer<typeof BlobRef>;

/** Rendered as a node tree, never as raw HTML. */
export const RichText: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.array(z.union([z.string(), z.object({ t: z.string() }).passthrough()]))]),
);

const base = { v: z.literal(1) };

/**
 * Loose, deliberately: unknown keys are KEPT, not stripped.
 *
 * Zod's default is to drop them, which would mean a v1 client parsing and
 * re-emitting a v2 event silently deletes the fields it doesn't understand —
 * the exact data loss `docs/29` §1 rule 2 exists to prevent. Encrypted history
 * cannot be rewritten, so that loss would be permanent.
 */
const evt = <T extends z.ZodRawShape>(shape: T) => z.looseObject(shape);

export const EncryptedEvent = z.discriminatedUnion('type', [
  evt({
    ...base,
    type: z.literal('m.message'),
    face: FaceRef.optional(),
    body: RichText,
    attachments: z.array(BlobRef).max(10).optional(),
    replyTo: Id.optional(),
    thread: Id.optional(),
    mentions: z.array(Id).max(256).optional(),
    /** Which of the face's avatars to pin to this message. */
    expression: z.string().max(64).optional(),
    /** Honoured client-side. The setting's own copy says a reader can always
     *  keep what they saw (`docs/03` §10). */
    expiresAt: z.number().int().optional(),
  }),
  evt({ ...base, type: z.literal('m.edit'), target: Id, body: RichText }),
  evt({ ...base, type: z.literal('m.redact'), target: Id, reason: z.string().max(500).optional() }),
  evt({
    ...base,
    type: z.literal('m.reaction'),
    target: Id,
    key: z.string().max(64),
    remove: z.boolean().optional(),
  }),
  evt({ ...base, type: z.literal('m.receipt'), upTo: Id }),
  evt({
    ...base,
    type: z.literal('m.typing'),
    face: FaceRef.optional(),
    stop: z.boolean().optional(),
  }),
  evt({ ...base, type: z.literal('m.pin'), target: Id, unpin: z.boolean().optional() }),
  /**
   * One per (target, author, kind). Translations, transcripts, notes — the
   * "annotate publicly" idea, and how a translator agent adds value without a
   * server ever reading anything (`docs/10`).
   */
  evt({
    ...base,
    type: z.literal('m.annotation'),
    target: Id,
    kind: z.string().max(64),
    body: RichText,
  }),
  evt({
    ...base,
    type: z.literal('room.name'),
    name: z.string().max(200),
    topic: z.string().max(2000).optional(),
  }),
  /** This account's faces as present in this room — so the server never learns
   *  a plural system's roster (`docs/11`). */
  evt({ ...base, type: z.literal('room.faces'), faces: z.array(FaceRef).max(64) }),
]);
export type EncryptedEvent = z.infer<typeof EncryptedEvent>;

/**
 * Parse a decrypted payload, preserving anything we don't understand.
 *
 * An unknown `type` is not an error: it is a newer client's feature, and it
 * renders as a fallback rather than vanishing (`docs/29` §1 rule 3).
 */
export type ParsedEvent =
  | { known: true; event: EncryptedEvent }
  | { known: false; type: string; raw: Record<string, unknown> };

export function parseEncrypted(json: unknown): ParsedEvent {
  const result = EncryptedEvent.safeParse(json);
  if (result.success) return { known: true, event: result.data };
  const raw = (json ?? {}) as Record<string, unknown>;
  return { known: false, type: typeof raw.type === 'string' ? raw.type : 'unknown', raw };
}
