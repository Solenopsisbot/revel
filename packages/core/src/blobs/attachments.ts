/**
 * Attachments end to end: seal, upload, put the key in the event, open again.
 *
 * The two halves are deliberately separate everywhere else — `seal.ts` knows
 * nothing about a network and the transport knows nothing about keys — and this
 * is the one place they meet, so there is exactly one code path where a key and
 * a URL are in scope together.
 *
 * ## The ordering
 *
 * ```
 * seal  →  upload ciphertext  →  put the ref in the message  →  send
 * ```
 *
 * The ref carries the key, so it must be inside the encrypted event and can
 * only be built once the server has assigned an id. Sending the message first
 * and attaching afterwards would mean an edit, and an edit that adds a key is a
 * key that was briefly not in the ciphertext.
 */
import type { BlobRef } from '@revel/protocol';
import type { Transport } from '../sync/transport.js';
import { openBlob, type SealOptions, sealBlob } from './seal.js';

export interface AttachmentsOptions {
  transport: Transport;
  /**
   * Cache opened blobs, so scrolling past the same image twice does not
   * download and decrypt it twice. Any Map-shaped thing; a caller that wants a
   * bounded one supplies it.
   */
  cache?: Map<string, Uint8Array>;
}

export class Attachments {
  #transport: Transport;
  #cache: Map<string, Uint8Array>;
  /** In-flight downloads, so ten images in a row are ten fetches, not thirty. */
  #inflight = new Map<string, Promise<Uint8Array>>();

  constructor(options: AttachmentsOptions) {
    this.#transport = options.transport;
    this.#cache = options.cache ?? new Map();
  }

  /**
   * Seal a file, upload it, and hand back the ref to put in the message.
   *
   * Everything a person would recognise is in the returned `BlobRef`, which
   * belongs inside the encrypted event. Nothing identifying goes to the server.
   */
  async upload(roomId: string, bytes: Uint8Array, options: SealOptions): Promise<BlobRef> {
    const sealed = await sealBlob(bytes, options);
    const blob = await this.#transport.uploadBlob(roomId, sealed.ciphertext);
    return { ...sealed.ref, id: blob.id };
  }

  /**
   * Upload a thumbnail beside its image, and return a ref that points at both.
   *
   * `docs/22`: "Thumbnails are generated before upload on the sender's device,
   * and travel as their own sealed blob — the server can't generate them."
   *
   * *Generating* one is not here, because it needs a canvas and this package
   * has no DOM. The caller renders the bytes; this seals them.
   */
  async uploadWithThumbnail(
    roomId: string,
    bytes: Uint8Array,
    thumbnail: Uint8Array,
    options: SealOptions,
  ): Promise<{ ref: BlobRef; thumb: BlobRef }> {
    // The thumbnail first: an image whose `thumb` points at a blob that does not
    // exist renders as a broken box, and the other order cannot produce one.
    const thumb = await this.upload(roomId, thumbnail, {
      mime: options.mime,
      name: `thumb-${options.name}`,
    });
    const ref = await this.upload(roomId, bytes, { ...options, thumb: thumb.id });
    return { ref, thumb };
  }

  /**
   * Download and open. Cached by blob id, which is safe because a blob id
   * names one immutable set of bytes — there is no version of a blob.
   */
  async open(ref: BlobRef): Promise<Uint8Array> {
    const cached = this.#cache.get(ref.id);
    if (cached) return cached;

    const existing = this.#inflight.get(ref.id);
    if (existing) return existing;

    const pending = this.#transport
      .downloadBlob(ref.id)
      .then((ciphertext) => openBlob(ciphertext, ref))
      .then((bytes) => {
        this.#cache.set(ref.id, bytes);
        return bytes;
      })
      .finally(() => this.#inflight.delete(ref.id));

    this.#inflight.set(ref.id, pending);
    return pending;
  }

  /** Forget a local copy. The bytes on the server are unaffected. */
  forget(blobId: string): void {
    this.#cache.delete(blobId);
  }
}
