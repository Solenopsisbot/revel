/**
 * Attachments, as far as the server is involved.
 *
 * `docs/22`: files are sealed on the sender's device with a per-file key that
 * travels inside the encrypted event, so what arrives here is ciphertext with
 * no filename and no type. This file therefore does almost nothing, and the
 * almost-nothing is the point — the entire feature is "hold these bytes and
 * hand them back to people who may read the room".
 *
 * ## Three consequences, all deliberate
 *
 * **No hotlinking.** An attachment URL pasted elsewhere is meaningless bytes,
 * because the key was never in the URL and never in a header. `docs/22` says
 * the share menu should say so out loud.
 *
 * **No thumbnails from here.** The server cannot generate one; it cannot see
 * the image. A thumbnail is its own sealed blob, made on the sender's device.
 *
 * **No link previews from here.** Same reason, plus a better one: a server that
 * fetched a URL on a reader's behalf would leak that the link was read, and to
 * whom, to the linked site.
 */
import type { BlobInfo } from '@revel/protocol';
import { has, Permission, toBase64 } from '@revel/protocol';
import type { Hono } from 'hono';
import { type Actor, canPurge, canRead, permissionsFor } from './policy.js';
import type { Blob, Store } from './store/types.js';

export interface BlobDeps {
  store: Store;
  newId(): string;
  authenticate(req: Request): Promise<Actor | null>;
  /**
   * The largest ciphertext this Host will hold, in bytes.
   *
   * **A placeholder.** No doc gives a number, and the real one is a hosting
   * decision that depends on what storage costs and what a self-hoster wants to
   * pay — `docs/27` §2 is the discussion and it is unresolved. 100 MB is big
   * enough for a video somebody actually sends and small enough that a
   * misbehaving client cannot fill a disk in a minute.
   */
  maxBytes?: number;
  now?: () => number;
}

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

export function mountBlobs(app: Hono, deps: BlobDeps): void {
  const now = deps.now ?? (() => Date.now());
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;

  /**
   * Upload ciphertext to a room.
   *
   * `SEND_MEDIA`, not `SEND`: `docs/04` §4 separates them so a room can be
   * "you may talk, you may not post files", which is a real moderation setting
   * and not one that can be reconstructed from the other.
   *
   * The body is raw bytes rather than JSON with base64 in it. Base64 is a third
   * more bytes over the wire and a full extra copy in memory at both ends, on
   * the one request in this API where the payload is measured in megabytes.
   */
  app.post('/rooms/:room/blobs', async (c) => {
    const actor = await deps.authenticate(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const roomId = c.req.param('room');
    const resolved = await permissionsFor(deps.store, roomId, actor.accountId);
    if (!resolved) {
      // 404 for a room that does not exist, 403 for one you are not in — the
      // same distinction the event routes make, so a stranger cannot use this
      // endpoint to enumerate rooms the other ones hide.
      const exists = (await deps.store.getRoom(roomId)) !== null;
      return exists
        ? c.json({ error: 'not_a_member' }, 403)
        : c.json({ error: 'no_such_room' }, 404);
    }
    if (!has(resolved.bits, Permission.SEND_MEDIA)) {
      return c.json({ error: 'missing_permission' }, 403);
    }

    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length === 0) return c.json({ error: 'empty_blob' }, 400);
    if (bytes.length > maxBytes) return c.json({ error: 'too_large', maxBytes }, 413);

    const blob: Blob = {
      id: deps.newId(),
      roomId,
      uploader: actor.devicePub,
      size: bytes.length,
      hash: await sha256(bytes),
      createdAt: now(),
      purgedAt: null,
    };
    // The *stored* row, not the one just built. The id is freshly minted so a
    // collision means something is wrong upstream — two Hosts on one shard, say
    // — and in that case the uploader should be told what is actually there
    // rather than handed a 201 describing bytes that were discarded.
    const stored = await deps.store.putBlob(blob, bytes);
    return c.json({ blob: info(stored) }, 201);
  });

  /**
   * Fetch the ciphertext.
   *
   * The read check is the room's, unchanged and no weaker: this hands over
   * bytes nobody without the event's key can open. Doing it anyway is
   * defence in depth and, more practically, keeps a stranger from measuring how
   * much somebody is uploading.
   */
  app.get('/blobs/:id', async (c) => {
    const actor = await deps.authenticate(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const blob = await deps.store.getBlob(c.req.param('id'));
    if (!blob) return c.json({ error: 'no_such_blob' }, 404);

    const denial = await canRead(deps.store, blob.roomId, actor);
    if (denial) return c.json({ error: denial }, 403);

    const bytes = await deps.store.readBlob(blob.id);
    // The row outlives the bytes so a client can be told the difference between
    // "never existed" and "was removed", and drop its cached copy for the
    // second (`docs/04` §2's tombstones, same idea).
    if (!bytes) return c.json({ error: 'purged', purgedAt: blob.purgedAt }, 410);

    return new Response(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        // Deliberately not the file's type: the server does not know it, and
        // guessing would be the one place a sniffed MIME type could contradict
        // what the sender said inside the ciphertext.
        'content-type': 'application/octet-stream',
        'content-length': String(bytes.length),
        // Nothing here is a secret, but nothing here is meaningful either, and
        // a shared cache holding somebody's attachment is a surprise.
        'cache-control': 'private, max-age=31536000, immutable',
      },
    });
  });

  /** What the server knows, without the bytes. For a client checking a link. */
  app.get('/blobs/:id/info', async (c) => {
    const actor = await deps.authenticate(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const blob = await deps.store.getBlob(c.req.param('id'));
    if (!blob) return c.json({ error: 'no_such_blob' }, 404);

    const denial = await canRead(deps.store, blob.roomId, actor);
    if (denial) return c.json({ error: denial }, 403);
    return c.json({ blob: info(blob) });
  });

  /**
   * Remove the bytes. `MANAGE_EVENTS`, same as purging an event.
   *
   * The uploader may too, without the permission — deleting your own thing is
   * not moderation, and `docs/04` §4 notes the same asymmetry for messages
   * ("authors always may, in-band").
   */
  app.delete('/blobs/:id', async (c) => {
    const actor = await deps.authenticate(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const blob = await deps.store.getBlob(c.req.param('id'));
    if (!blob) return c.json({ error: 'no_such_blob' }, 404);

    if (blob.uploader !== actor.devicePub) {
      const denial = await canPurge(deps.store, blob.roomId, actor);
      if (denial) return c.json({ error: denial }, 403);
    }

    await deps.store.purgeBlob(blob.id, now());
    return c.body(null, 204);
  });
}

function info(blob: Blob): BlobInfo {
  return {
    id: blob.id,
    room: blob.roomId,
    uploader: blob.uploader,
    size: blob.size,
    hash: blob.hash,
    createdAt: blob.createdAt,
    purgedAt: blob.purgedAt,
  };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))));
}
