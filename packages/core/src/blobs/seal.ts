/**
 * Sealing an attachment.
 *
 * `docs/22`: "Files are sealed client-side with a per-file key that travels
 * inside the encrypted event, so the blob store holds ciphertext with no
 * filename or type." This is that seal.
 *
 * ## Why this one is not in the Rust core
 *
 * `docs/26` Option C puts "MLS, device keys and envelope encryption" in Rust,
 * and a strict reading would put this there too. It is here instead, on
 * purpose, and the reasons are worth stating because the boundary is otherwise
 * a good one:
 *
 * - **Size.** wasm has its own linear memory. Sealing a 100 MB file in Rust
 *   means copying it in and copying the result out — 200 MB of heap for a
 *   photo, in a browser tab that also has to render a room.
 * - **Hardware.** WebCrypto's AES-GCM is hardware-accelerated on every target;
 *   the wasm build is not, and cannot be.
 * - **The argument is small enough to check.** A fresh 256-bit key per blob,
 *   used exactly once, with a fresh nonce. There is no ratchet, no state, and
 *   nothing to restore behind — which is what made group state genuinely
 *   dangerous (`docs/31` §7) and makes this genuinely not.
 *
 * That last point is the real one. What makes MLS state need care is that
 * getting the *sequencing* wrong silently reuses a nonce. Here the key is new
 * every time, so there is no sequence to get wrong.
 */
import { type BlobRef, fromBase64, toBase64 } from '@revel/protocol';

/** AES-256-GCM. The nonce is 96 bits, which is what GCM is specified for. */
const KEY_BITS = 256;
const NONCE_BYTES = 12;

export interface SealedBlob {
  /** What goes to the server. Opaque, unnamed, untyped. */
  ciphertext: Uint8Array;
  /**
   * Everything needed to open it again, minus the id the server has not
   * assigned yet. Goes **inside the encrypted event**, never beside the bytes.
   */
  ref: Omit<BlobRef, 'id'>;
}

export interface SealOptions {
  mime: string;
  name: string;
  /** Alt text. Inside the ciphertext, like everything else a person wrote. */
  alt?: string;
  /** The id of a separately sealed thumbnail (`docs/22`). */
  thumb?: string;
}

/**
 * Seal a file under a key that has never existed before and never will again.
 *
 * A fresh key per blob is what makes this safe with no bookkeeping: nonce reuse
 * under a given key is the failure mode for GCM, and a key used once cannot
 * have a nonce reused under it. The nonce is random anyway — belt and braces,
 * because the cost is twelve bytes.
 */
export async function sealBlob(plaintext: Uint8Array, options: SealOptions): Promise<SealedBlob> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: KEY_BITS }, true, [
    'encrypt',
  ]);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, new Uint8Array(plaintext)),
  );
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));

  return {
    ciphertext,
    ref: {
      key: toBase64(raw),
      nonce: toBase64(nonce),
      size: plaintext.length,
      mime: options.mime,
      name: options.name,
      // Over the *plaintext*. GCM's tag already makes tampering impossible
      // without the key, so this is not the security control it looks like —
      // it catches a sender whose client built the ref wrong, and it lets a
      // client recognise a file it already holds.
      hash: await sha256(plaintext),
      ...(options.alt ? { alt: options.alt } : {}),
      ...(options.thumb ? { thumb: options.thumb } : {}),
    },
  };
}

/**
 * Open a sealed blob.
 *
 * Throws if the ciphertext does not authenticate, which is GCM doing its job: a
 * blob store that returned somebody else's bytes, or its own, fails here rather
 * than rendering.
 */
export async function openBlob(
  ciphertext: Uint8Array,
  ref: Pick<BlobRef, 'key' | 'nonce' | 'size' | 'hash'>,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(fromBase64(ref.key)),
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );

  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(fromBase64(ref.nonce)) },
      key,
      new Uint8Array(ciphertext),
    ),
  );

  // The ref said how big it was and what it hashed to. Disagreeing means the
  // event and the blob describe different files — a bug rather than an attack,
  // because GCM has already ruled the attack out, but a bug that would
  // otherwise surface as a corrupt image.
  if (plaintext.length !== ref.size) {
    throw new Error(`blob is ${plaintext.length} bytes, the event said ${ref.size}`);
  }
  if ((await sha256(plaintext)) !== ref.hash) {
    throw new Error('blob does not match the hash in the event');
  }
  return plaintext;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))));
}
