/**
 * Message franking (`docs/03` §9).
 *
 * The problem: moderators are members, not the server, and a member reporting
 * a message hands over plaintext the server has never seen. Nothing stops them
 * handing over plaintext that was never sent — so a report queue without this
 * is a place to paste anything you like about somebody, and a moderator acting
 * on one is acting on the reporter's word.
 *
 * The fix is a commitment, and the shape is standard:
 *
 *   1. The sender mints a random **franking key** and puts it *inside* the
 *      ciphertext, so every member of the room ends up holding it.
 *   2. The sender computes `HMAC-SHA256(key, plaintext)` and puts **that** in
 *      the envelope, where the server stores it alongside the event.
 *   3. A reporter reveals the plaintext and the key. A moderator recomputes the
 *      HMAC and checks it against what the *server* is holding — a value the
 *      reporter never controlled.
 *
 * So a report proves "this exact text was sent, in this room, at this time",
 * and proves nothing about any other message. The reporter cannot forge one
 * without finding a second (key, plaintext) pair with the same HMAC.
 *
 * **What it does not do.** It does not stop somebody reporting a real message
 * they provoked, and it does not hide the reported message from the Host once
 * a report is filed — opening one specific event is the entire point. It also
 * cannot help with a message sent before commitments existed, which is why
 * this belongs in the envelope from the start rather than being added once
 * there is history to regret.
 */

import { fromBase64, toBase64 } from './base64.js';

/**
 * A fresh franking key. 32 bytes, from the system CSPRNG.
 *
 * One per message and never reused: a key shared between two messages would
 * let anybody who can open one prove things about the other.
 */
export function frankingKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

async function mac(key: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey(
    'raw',
    key.slice() as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', imported, plaintext.slice() as unknown as ArrayBuffer),
  );
}

/**
 * The commitment that rides in the envelope.
 *
 * Over the **plaintext exactly as encrypted** — the same bytes, byte for byte
 * — because that is the only definition both ends can agree on without a
 * canonical-JSON rule that has to be right forever. The key is inside those
 * bytes, which is fine: the commitment is not hiding the key from room
 * members, it is stopping a reporter inventing a message.
 */
export async function commitment(key: Uint8Array, plaintext: Uint8Array): Promise<string> {
  return toBase64(await mac(key, plaintext));
}

/**
 * Does this key and this plaintext produce the commitment the server holds?
 *
 * Constant-time compare, which is close to pointless here — the commitment is
 * public and a moderator is not an oracle — and is what a verification
 * function should do anyway, because the next one to be written by copying
 * this one might not be.
 */
export async function verifyFranking(
  key: Uint8Array,
  plaintext: Uint8Array,
  claimed: string,
): Promise<boolean> {
  let want: Uint8Array;
  try {
    want = fromBase64(claimed);
  } catch {
    return false;
  }
  const got = await mac(key, plaintext);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i]! ^ want[i]!;
  return diff === 0;
}
