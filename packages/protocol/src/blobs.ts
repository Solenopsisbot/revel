/**
 * Blobs: attachments, as the server sees them.
 *
 * Which is almost nothing. `docs/22`: "Files are sealed client-side with a
 * per-file key that travels inside the encrypted event, so the blob store holds
 * **ciphertext with no filename or type**." Everything a person would recognise
 * — the name, the MIME type, the alt text, the key — is in `BlobRef` inside the
 * encrypted event. What is out here is a length, a room, and who uploaded it.
 *
 * The visible consequence, and it is a feature: **an attachment URL pasted
 * elsewhere is meaningless bytes.** There is no hotlinking, because there is
 * nothing to hotlink to.
 */
import { z } from 'zod';
import { DevicePub, Snowflake } from './ids.js';

/**
 * What the server knows about a stored blob.
 *
 * `docs/04` §1's `blobs` table, minus the columns that would be lies here:
 * there is no name, no MIME type and no width or height, because the server has
 * never seen the plaintext.
 */
export const BlobInfo = z.object({
  id: Snowflake,
  /** The room it belongs to. Reading it is the room's read check, nothing new. */
  room: Snowflake,
  uploader: DevicePub,
  /** Ciphertext length, which is the plaintext length plus GCM's tag. */
  size: z.number().int().nonnegative(),
  /**
   * SHA-256 of the **ciphertext**, base64.
   *
   * Not the same hash as `BlobRef.hash`, which is over the plaintext and which
   * the server could not compute if it wanted to. This one is for integrity at
   * rest — a bit-rotted object storage — and for a client that wants to know
   * whether the bytes it is about to download are the bytes it saw before.
   */
  hash: z.string().base64(),
  createdAt: z.number().int(),
  /** Set when the bytes are gone. The row survives so clients drop their copy. */
  purgedAt: z.number().int().nullable(),
});
export type BlobInfo = z.infer<typeof BlobInfo>;

/**
 * Who may open this, as far as the server is concerned.
 *
 * Nobody, is the honest answer — it holds ciphertext and no key. What this
 * controls is who may *fetch* the bytes, which is the room's read check and
 * exactly as strong as delivery has ever been. The key is what controls
 * reading, and the key is in the event.
 */
export const BlobUploaded = z.object({ blob: BlobInfo });
export type BlobUploaded = z.infer<typeof BlobUploaded>;
