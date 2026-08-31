/**
 * A tiny sealed key-value store in IndexedDB.
 *
 * Extracted from `session.ts` when a second thing needed the same treatment.
 * The pattern is the interesting part and it is worth stating once:
 *
 * **The wrapping key is a non-extractable `CryptoKey` kept in the same row as
 * the bytes it opens.** The browser will use it and will not hand its material
 * to JavaScript — not to us, and not to anything that gets to run as us. So an
 * attacker who can read IndexedDB gets ciphertext and a handle they cannot
 * export, rather than the contents.
 *
 * What it does *not* defend against is code executing in this origin while the
 * page is open, which can simply ask the browser to decrypt. That is the honest
 * limit of client-side storage in a browser, and `docs/26` is why the desktop
 * build exists — under Tauri this becomes the OS keychain and the limit moves.
 *
 * Deleting a row deletes the only reference to its key, so the bytes become
 * permanently unopenable even if they were recovered from disk afterwards.
 */

export interface SealedStoreOptions {
  factory?: IDBFactory;
  /** Database name. One per concern, so clearing one does not clear the other. */
  name: string;
}

interface Row {
  /** Non-extractable AES-GCM key. Structured-cloneable; its bytes are not. */
  key: CryptoKey;
  /** `nonce | ciphertext`. */
  sealed: ArrayBuffer;
}

const STORE = 'sealed';

function open(options: SealedStoreOptions): Promise<IDBDatabase> {
  const factory = options.factory ?? indexedDB;
  return new Promise((resolve, reject) => {
    const request = factory.open(options.name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
) {
  return new Promise<T>((resolve, reject) => {
    const request = fn(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Seal `value` under a fresh key and store it at `id`, replacing anything there. */
export async function putSealed(
  id: string,
  value: unknown,
  options: SealedStoreOptions,
): Promise<void> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: new Uint8Array(nonce) },
      key,
      new Uint8Array(plain),
    ),
  );

  const sealed = new Uint8Array(nonce.length + ciphertext.length);
  sealed.set(nonce);
  sealed.set(ciphertext, nonce.length);

  const db = await open(options);
  try {
    await run(db, 'readwrite', (s) => s.put({ key, sealed: sealed.buffer } as Row, id));
  } finally {
    db.close();
  }
}

/**
 * Read it back, or `null`.
 *
 * `null` for "nothing there", which is what every first visit looks like, and
 * also for "there is something and it will not open" — with the row removed,
 * because a blob nothing can decrypt is not going to start working later and an
 * app that cannot start is worse than one that has forgotten something.
 */
export async function getSealed<T>(id: string, options: SealedStoreOptions): Promise<T | null> {
  const db = await open(options);
  try {
    const row = await run<Row | undefined>(db, 'readonly', (s) => s.get(id));
    if (!row) return null;

    const sealed = new Uint8Array(row.sealed);
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(sealed.slice(0, 12)) },
        row.key,
        new Uint8Array(sealed.slice(12)),
      );
      return JSON.parse(new TextDecoder().decode(plain)) as T;
    } catch {
      await run(db, 'readwrite', (s) => s.delete(id));
      return null;
    }
  } finally {
    db.close();
  }
}

/** Forget it. Idempotent, so a failed clear can be retried. */
export async function deleteSealed(id: string, options: SealedStoreOptions): Promise<void> {
  const db = await open(options);
  try {
    await run(db, 'readwrite', (s) => s.delete(id));
  } finally {
    db.close();
  }
}
