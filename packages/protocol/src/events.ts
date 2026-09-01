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
import { AccountId, RoleId } from './ids.js';

const Id = z.string().regex(/^\d{1,20}$/);

/** A snapshot of the face that spoke, so an old message renders correctly even
 *  after that face is renamed (`docs/04` §2). */
export const FaceRef = z.object({
  id: Id,
  name: z.string().min(1).max(80),
  /**
   * Spelled the way the rest of the product spells it.
   *
   * `docs/07`, every CSS variable and every component in `apps/web` say
   * `colour`; this field said `color`, and it is the one field where that
   * matters permanently — a `FaceRef` is inside encrypted history, and
   * `docs/29` §1 is blunt that encrypted history cannot be re-encrypted. A
   * field renamed after anything has shipped is a field with two names forever.
   */
  colour: z.string().max(32).optional(),
  avatar: z.string().max(512).optional(),
  pronouns: z.string().max(40).optional(),
});
export type FaceRef = z.infer<typeof FaceRef>;

/**
 * A face as it appears on the room's roster, which is a face plus its note.
 *
 * Deliberately *not* `FaceRef`. A `FaceRef` rides on every single message, and
 * `docs/29` §1 is blunt that encrypted history can never be re-encrypted — so
 * a field added there is a field on every message anyone ever sends, forever,
 * carrying something that changes about twice a year.
 *
 * `room.faces` is the right home: one event per face per room, superseded by
 * the next one the way a rename already is (the reducer keeps `facesAt` and
 * takes the newest by event id). The profile card reads the roster; the
 * message keeps carrying only what it needs to render a row.
 */
export const FaceCard = FaceRef.extend({
  /** `docs/11`'s one-line note — "the bit that does the actual work". */
  note: z.string().max(280).optional(),
});
export type FaceCard = z.infer<typeof FaceCard>;

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
    /**
     * Accounts named in this message.
     *
     * **Accounts, not faces.** `Id` here was ambiguous — `FaceRef.id` has the
     * same shape — and the ambiguity was load-bearing in the wrong direction:
     * the notification rules test `mentions` against the reading *account*
     * (`docs/35` rule 6), so a client that put the face id it rendered into
     * this list would produce silence and no error. Same fix and same reason as
     * `EventInput.notify`, which this mirrors: the server's wake hint and the
     * client's mention list have to name the same thing.
     *
     * Which *face* was addressed is a rendering question, and lives in `body`
     * where the mention is written. This list is for deciding.
     *
     * **The schema cannot enforce this**, and pretending otherwise would be
     * worse than the gap: a snowflake is a valid base64url string, so
     * `AccountId` accepts a face id too. What the type buys is the call site —
     * handing this a `FaceRef.id` from code that has both is now a type error —
     * and a name that tells the next person which of the two belongs here.
     */
    mentions: z.array(AccountId).max(256).optional(),
    /**
     * A room-wide address — `@everyone`, or `@here`.
     *
     * A *claim* by the sender's client, and **not self-enforcing**. The server
     * cannot read this field, so a member without `MENTION_EVERYONE` can set it
     * to `true` and there is nothing here to stop them. `docs/04` puts the other
     * half on the reader — "client, on rendering the ping" — which means every
     * client must check the sender's permission before honouring it, and the
     * notification rules do (`docs/35` rule 8).
     *
     * A flag rather than a sentinel in `mentions`: that list is `AccountId`s,
     * and smuggling a magic string through a typed list is how a permission
     * check ends up comparing the wrong thing.
     */
    mentionsEveryone: z.boolean().optional(),
    /**
     * Roles addressed by name. Same rules as above: a claim, checked by the
     * reader against both the sender's permission and their own roles.
     */
    mentionsRoles: z.array(RoleId).max(32).optional(),
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
   * Name a thread.
   *
   * `target` is the message the thread branches from, which is already how a
   * thread is identified everywhere else — there is no separate thread object
   * to name, and inventing one would mean a thread could exist without any
   * messages in it.
   *
   * Last writer wins by event id, like `room.name`, and for the same reason: a
   * page of old history must not un-rename something. Anyone in the room may
   * send one; a thread is a shared thing and `docs/04` §4 has no permission
   * for "may name a branch", so inventing one here would be inventing policy.
   */
  evt({ ...base, type: z.literal('m.thread'), target: Id, name: z.string().max(120) }),
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
  evt({ ...base, type: z.literal('room.faces'), faces: z.array(FaceCard).max(64) }),
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
  | {
      known: false;
      type: string;
      /**
       * Whatever was actually there, unchanged.
       *
       * `unknown`, not `Record<string, unknown>`, because a payload is
       * decrypted JSON and JSON is not always an object — a member with a buggy
       * client can send `"hello"` or `[1,2,3]` as an entire body. This used to
       * be typed as a record and cast, which made it a *lie* for exactly those
       * payloads, and `docs/29` §1 rule 2 says unknown content is "preserved
       * and re-emitted" — you cannot preserve a string into a type that cannot
       * hold one. Found by fuzzing.
       */
      raw: unknown;
    };

export function parseEncrypted(json: unknown): ParsedEvent {
  const result = EncryptedEvent.safeParse(json);
  if (result.success) return { known: true, event: result.data };

  const type =
    typeof json === 'object' && json !== null && !Array.isArray(json)
      ? (json as Record<string, unknown>).type
      : undefined;
  return { known: false, type: typeof type === 'string' ? type : 'unknown', raw: json };
}
