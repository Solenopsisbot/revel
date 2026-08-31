/**
 * Where attachment ciphertext actually lives.
 *
 * A seam, for the same reason [`PushSender`] is one: the part that is Revel's —
 * *what* is stored, and the fact that it is opaque — belongs here and is tested,
 * and the part that is a protocol against somebody else's service is a
 * dependency a deployment supplies.
 *
 * `docs/22`: "the blob store holds ciphertext with no filename or type". None of
 * these implementations is told what a blob *is*, and none of them could find
 * out — the key is inside the encrypted event that references it.
 *
 * ## The two orderings, which are not the same
 *
 * Writing and purging fail in opposite directions, so they are ordered
 * oppositely and deliberately:
 *
 * - **Write bytes, then the row.** A crash in between leaves bytes nothing
 *   points at — garbage, collectable later. The other order leaves a row
 *   promising an attachment that was never stored, which is a broken message
 *   forever.
 * - **Delete bytes, then mark the row.** A crash in between leaves a row that
 *   claims bytes it no longer has, which reads as an already-purged blob. The
 *   other order leaves ciphertext on disk *after somebody asked for it to be
 *   gone*, and that is not a failure mode a privacy product gets to have.
 */

export interface BlobBytes {
  /** Store ciphertext. Overwriting an existing id must not be possible. */
  put(id: string, bytes: Uint8Array): Promise<void>;
  /** `null` when the bytes are absent — never distinguishable from purged. */
  get(id: string): Promise<Uint8Array | null>;
  /** Idempotent: deleting what is not there is a success, not an error. */
  delete(id: string): Promise<void>;
}

/**
 * Bytes in a `bytea` column, alongside the row.
 *
 * The default, and **fine at this scale and wrong at any other**: every read
 * pulls the whole attachment through the database connection, and the database
 * is the one thing in this architecture that is hard to scale sideways. It is
 * the right default anyway, because it needs no configuration and a Host that
 * has not thought about storage yet should still work.
 */
export class ColumnBlobBytes implements BlobBytes {
  // Implemented inside `PostgresStore`, which already has the row's transaction
  // — splitting it out would mean two round trips and a window where the row
  // and its bytes disagree. This class exists to *name* the choice, so that
  // "we are storing attachments in Postgres" is a decision somebody made rather
  // than the absence of one.
  async put(): Promise<void> {
    throw new Error('ColumnBlobBytes is handled inline by PostgresStore');
  }
  async get(): Promise<Uint8Array | null> {
    throw new Error('ColumnBlobBytes is handled inline by PostgresStore');
  }
  async delete(): Promise<void> {
    throw new Error('ColumnBlobBytes is handled inline by PostgresStore');
  }
}

export interface FileBlobOptions {
  /** Directory to write into. Created if missing, `0700`. */
  dir: string;
}

/**
 * Bytes as files on disk.
 *
 * The smallest thing that takes attachments out of the database, and enough for
 * a self-hosted Host with a volume. Object storage is the same interface with a
 * different four methods, which is the point of having the interface.
 */
export class FileBlobBytes implements BlobBytes {
  readonly #dir: string;

  constructor(options: FileBlobOptions) {
    this.#dir = options.dir;
  }

  /**
   * Blob ids are snowflakes, but this never trusts that.
   *
   * The id reaches here from a route, and a path assembled from anything a
   * caller influenced is a path traversal waiting to happen. Rejecting outright
   * rather than sanitising: a sanitised `../../etc/passwd` is a filename nobody
   * meant, and silently storing something under the wrong name is worse than
   * refusing.
   */
  #path(id: string): string {
    if (!/^[0-9]{1,20}$/.test(id)) throw new Error(`blob id ${JSON.stringify(id)} is not an id`);
    // Two levels of fan-out from the *end* of the id, because snowflakes share
    // their leading digits — bucketing on a prefix would put a whole day in one
    // directory and defeat the point.
    const tail = id.slice(-4);
    return `${this.#dir}/${tail.slice(0, 2)}/${tail.slice(2)}/${id}`;
  }

  async put(id: string, bytes: Uint8Array): Promise<void> {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    const path = this.#path(id);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    // `wx` — never overwrite. First write wins, matching the store's rule, and
    // a collision is a bug upstream rather than something to paper over.
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' }).catch(
      (err: NodeJS.ErrnoException) => {
        if (err.code !== 'EEXIST') throw err;
      },
    );
  }

  async get(id: string): Promise<Uint8Array | null> {
    const { readFile } = await import('node:fs/promises');
    try {
      return new Uint8Array(await readFile(this.#path(id)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(id: string): Promise<void> {
    const { rm } = await import('node:fs/promises');
    // `force` — deleting what is not there is a success. A purge that fails
    // because it already happened would make retrying one impossible.
    await rm(this.#path(id), { force: true });
  }
}
