/**
 * Keeping the account key on this device, sealed (`docs/03` §1).
 *
 * > **Reloading the app does not require a password.** That was Kith's biggest
 * > UX cliff and it's gone by construction.
 *
 * The account key is unwrapped exactly twice in a lifetime — at sign-in and at
 * recovery — and then it has to live somewhere, because enrolling a device,
 * revoking one, and rotating the key all need it. Asking for the password on
 * every reload instead would be the cliff, restored.
 *
 * ## What "sealed" buys, and what it does not
 *
 * The wrapping key is a **non-extractable** `CryptoKey`. The browser will use it
 * and will not hand its bytes to JavaScript — not to us, and not to anything
 * that gets to run as us. So an attacker who can read IndexedDB gets a sealed
 * blob and a key handle they cannot export, rather than an account key.
 *
 * What it does not buy: anything against code executing in this origin *while
 * the page is open*, which can simply ask the browser to decrypt. That is the
 * honest limit of client-side key storage in a browser, and `docs/26` is why
 * the desktop build exists — under Tauri this becomes the OS keychain and the
 * limit moves.
 *
 * ## Why the key is generated rather than derived
 *
 * There is nothing to derive it from. There is no password at reload time —
 * that is the entire point — so a device-local key is a device-local key. Its
 * security is that it cannot be exported and that it dies with the origin's
 * storage.
 */

/** What a signed-in device keeps between reloads. */
export interface Session {
  accountPub: string;
  handle: string;
  /** The account private seed. Only in memory, only after unsealing. */
  accountKey: Uint8Array;
}

/** The row as it sits in IndexedDB: a key that cannot be exported, and bytes. */
interface StoredSession {
  accountPub: string;
  handle: string;
  /** Non-extractable AES-GCM key. Structured-cloneable; its bytes are not. */
  wrappingKey: CryptoKey;
  /** `nonce | ciphertext`. */
  sealed: ArrayBuffer;
}

const DB_NAME = 'revel-session';
const STORE = 'session';
/** One row, always. A device is signed in to one account or to none. */
const KEY = 'current';

export interface SessionStoreOptions {
  factory?: IDBFactory;
  name?: string;
}

function open(options: SessionStoreOptions = {}): Promise<IDBDatabase> {
  const factory = options.factory ?? indexedDB;
  return new Promise((resolve, reject) => {
    const request = factory.open(options.name ?? DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx<T>(
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

/**
 * Seal the account key to this device and remember it.
 *
 * Replaces whatever was there. Signing in as somebody else on a device that was
 * signed in as you is a normal thing to do, and leaving the old row would mean
 * a reload could restore an account the person had just left.
 */
export async function saveSession(
  session: Session,
  options: SessionStoreOptions = {},
): Promise<void> {
  const wrappingKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);

  const nonce = crypto.getRandomValues(new Uint8Array(12));
  // Copied rather than passed through, for the reason `identity.ts` gives: a
  // view is both a type WebCrypto will not take and a thing that can change
  // under it between here and the encrypt.
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: new Uint8Array(nonce) },
      wrappingKey,
      new Uint8Array(session.accountKey),
    ),
  );
  const sealed = new Uint8Array(nonce.length + ciphertext.length);
  sealed.set(nonce);
  sealed.set(ciphertext, nonce.length);

  const db = await open(options);
  try {
    const row: StoredSession = {
      accountPub: session.accountPub,
      handle: session.handle,
      wrappingKey,
      sealed: sealed.buffer as ArrayBuffer,
    };
    await tx(db, 'readwrite', (s) => s.put(row, KEY));
  } finally {
    db.close();
  }
}

/**
 * Restore it, or `null` if this device is not signed in.
 *
 * `null` rather than throwing for the ordinary "no session" case, because that
 * is what every first visit looks like. A row that exists and does not open is
 * a different thing and is treated as no session too — with the row removed,
 * since a blob nothing can decrypt is not going to start working later.
 */
export async function loadSession(options: SessionStoreOptions = {}): Promise<Session | null> {
  const db = await open(options);
  try {
    const row = await tx<StoredSession | undefined>(db, 'readonly', (s) => s.get(KEY));
    if (!row) return null;

    const sealed = new Uint8Array(row.sealed);
    const nonce = sealed.slice(0, 12);
    const ciphertext = sealed.slice(12);

    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(nonce) },
        row.wrappingKey,
        new Uint8Array(ciphertext),
      );
      return {
        accountPub: row.accountPub,
        handle: row.handle,
        accountKey: new Uint8Array(plain),
      };
    } catch {
      await tx(db, 'readwrite', (s) => s.delete(KEY));
      return null;
    }
  } finally {
    db.close();
  }
}

/**
 * Sign out on this device.
 *
 * Deleting the row deletes the only handle to the wrapping key, so the sealed
 * bytes become permanently unopenable even if they were recovered from disk
 * afterwards — the key was never extractable, and now nothing references it.
 */
export async function clearSession(options: SessionStoreOptions = {}): Promise<void> {
  const db = await open(options);
  try {
    await tx(db, 'readwrite', (s) => s.delete(KEY));
  } finally {
    db.close();
  }
}
