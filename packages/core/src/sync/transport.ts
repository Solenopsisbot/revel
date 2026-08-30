/**
 * How the client talks to a Host.
 *
 * Two interfaces rather than one, because the server has two halves and they
 * are at different stages. [`Transport`] is history and sending, which
 * `apps/server` serves today over plain HTTP. [`EventStream`] is live delivery,
 * which the server has the fan-out for (`Hub`) but no socket route wired to it
 * yet. Folding them together would mean shipping a `subscribe` that silently
 * does nothing, and a method that lies is worse than a method that is absent.
 *
 * Neither of them knows what an event *means*. They move opaque payloads, which
 * is the same thing the server does, for the same reason.
 */
import type {
  AccountProfile,
  BlobInfo,
  Event,
  EventInput,
  RoomInfo,
  UpdateProfile,
} from '@revel/protocol';

export interface FetchOptions {
  /** Page backwards: only events older than this id. */
  before?: string;
  /** At most this many. The server caps it at 200. */
  limit?: number;
}

export interface SendResult {
  event: Event;
  /**
   * True when the server recognised the `clientNonce` and returned the event it
   * already had. A retry after a dropped response must not become a second
   * message, so this is a success, not a conflict.
   */
  deduped: boolean;
  /** False for `ephemeral` events, which are relayed and never stored. */
  stored: boolean;
}

export interface Transport {
  /** A page of history, oldest first within the page. */
  fetchEvents(roomId: string, options?: FetchOptions): Promise<Event[]>;
  /** Append an event. */
  send(roomId: string, input: EventInput): Promise<SendResult>;

  // -- the directory ---------------------------------------------------------
  //
  // Which rooms exist and who is in them. Separate from the reducer's idea of a
  // room in every way that matters: a `RoomInfo` has no messages, no name and
  // no faces, because the server has never seen any of those. What it has is
  // what policy is enforced on.

  /**
   * Every room this account is in.
   *
   * What a client asks for when it has nothing, or when it comes back and
   * suspects it missed being added to something. Not on the cold-open path —
   * `docs/29` §5 budgets 300 ms to a painted room from the *local* store, and
   * this is the network.
   */
  listRooms(): Promise<RoomInfo[]>;
  getRoom(roomId: string): Promise<RoomInfo>;

  /**
   * Open a DM. Idempotent: the id is derived from the sorted account pair
   * (`docs/03` §4), so asking twice — or both people asking at once — is one
   * room.
   */
  createDm(account: string): Promise<RoomInfo>;
  /** By name — `viola` or `viola@revel.chat`. The point of handles existing. */
  createDmWith(address: string): Promise<RoomInfo>;
  /** Open a group DM. Not idempotent; a second one is a second conversation. */
  createGroupRoom(accounts: string[]): Promise<RoomInfo>;

  addMembers(roomId: string, accounts: string[]): Promise<RoomInfo>;
  /** Yourself only. Does not remove your MLS leaf — a member has to commit that. */
  leaveRoom(roomId: string): Promise<void>;

  // -- identity --------------------------------------------------------------

  /** This account's profile, or `{ handle: null }` before one is claimed. */
  me(): Promise<AccountProfile | { id: string; handle: null }>;
  claimHandle(handle: string): Promise<AccountProfile>;
  updateProfile(patch: UpdateProfile): Promise<AccountProfile>;
  /**
   * Resolve an address to an account.
   *
   * Store the id it returns, never the handle: a handle can be given up and
   * taken by somebody else, and a key cannot (`docs/17`).
   */
  resolveAddress(address: string): Promise<AccountProfile>;

  // -- blobs -----------------------------------------------------------------
  //
  // Ciphertext in, ciphertext out. Sealing and opening are `blobs/seal.ts`; the
  // transport never sees a key and never sees a filename.

  uploadBlob(roomId: string, ciphertext: Uint8Array): Promise<BlobInfo>;
  downloadBlob(blobId: string): Promise<Uint8Array>;
  /** Remove the bytes. The uploader may; anybody else needs `MANAGE_EVENTS`. */
  purgeBlob(blobId: string): Promise<void>;
}

/** Live events, once something is delivering them. */
export interface EventStream {
  /** Returns an unsubscribe. */
  subscribe(roomId: string, onEvent: (event: Event) => void): () => void;
}

export class TransportError extends Error {
  constructor(
    readonly status: number,
    /** The server's machine-readable reason, e.g. `not_a_member`. */
    readonly reason: string,
  ) {
    super(`the server refused: ${reason} (${status})`);
    this.name = 'TransportError';
  }

  /**
   * Whether trying again could plausibly work.
   *
   * A 403 will still be a 403 in ten seconds; a 502 might not be. The
   * difference decides whether a failed send offers a retry button or an
   * explanation, and getting it wrong means either a button that can never
   * work or an error where a retry would have fixed it.
   */
  get retryable(): boolean {
    return this.status >= 500 || this.status === 429 || this.status === 408;
  }
}

export interface HttpTransportOptions {
  /** Base URL of the Host, e.g. `https://revel.chat`. */
  baseUrl: string;
  /**
   * Called for every request, to add credentials.
   *
   * A function rather than a static header because a device-key
   * challenge-response (`docs/17` §2) produces a token with a lifetime, and a
   * transport that captured one at construction would start failing an hour in.
   */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  /** For tests, and for a host that wants its own retry or timeout behaviour. */
  fetch?: typeof globalThis.fetch;
}

export class HttpTransport implements Transport {
  #baseUrl: string;
  #headers: NonNullable<HttpTransportOptions['headers']>;
  #fetch: typeof globalThis.fetch;

  constructor(options: HttpTransportOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#headers = options.headers ?? (() => ({}));
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async fetchEvents(roomId: string, options: FetchOptions = {}): Promise<Event[]> {
    const query = new URLSearchParams();
    if (options.before) query.set('before', options.before);
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    const suffix = query.size ? `?${query}` : '';

    const body = await this.#json<{ events: Event[] }>(
      `/rooms/${encodeURIComponent(roomId)}/events${suffix}`,
      { method: 'GET' },
    );
    return body.events;
  }

  async send(roomId: string, input: EventInput): Promise<SendResult> {
    const body = await this.#json<{ event: Event; deduped?: boolean; stored?: boolean }>(
      `/rooms/${encodeURIComponent(roomId)}/events`,
      { method: 'POST', body: JSON.stringify(input) },
    );
    return {
      event: body.event,
      deduped: body.deduped ?? false,
      stored: body.stored ?? true,
    };
  }

  async listRooms(): Promise<RoomInfo[]> {
    const body = await this.#json<{ rooms: RoomInfo[] }>('/rooms', { method: 'GET' });
    return body.rooms;
  }

  getRoom(roomId: string): Promise<RoomInfo> {
    return this.#json(`/rooms/${encodeURIComponent(roomId)}`, { method: 'GET' });
  }

  createDm(account: string): Promise<RoomInfo> {
    return this.#json('/rooms/dm', { method: 'POST', body: JSON.stringify({ account }) });
  }

  createDmWith(address: string): Promise<RoomInfo> {
    return this.#json('/rooms/dm', { method: 'POST', body: JSON.stringify({ address }) });
  }

  me(): Promise<AccountProfile | { id: string; handle: null }> {
    return this.#json('/idp/accounts/me', { method: 'GET' });
  }

  claimHandle(handle: string): Promise<AccountProfile> {
    return this.#json('/idp/accounts/me/handle', {
      method: 'POST',
      body: JSON.stringify({ handle }),
    });
  }

  updateProfile(patch: UpdateProfile): Promise<AccountProfile> {
    return this.#json('/idp/accounts/me', { method: 'PATCH', body: JSON.stringify(patch) });
  }

  resolveAddress(address: string): Promise<AccountProfile> {
    return this.#json(`/idp/accounts/${encodeURIComponent(address)}`, { method: 'GET' });
  }

  async uploadBlob(roomId: string, ciphertext: Uint8Array): Promise<BlobInfo> {
    // Raw bytes, not base64 in JSON: a third more over the wire and a whole
    // extra copy at both ends, on the one request measured in megabytes.
    const body = await this.#json<{ blob: BlobInfo }>(
      `/rooms/${encodeURIComponent(roomId)}/blobs`,
      {
        method: 'POST',
        body: ciphertext as unknown as BodyInit,
        headers: { 'content-type': 'application/octet-stream' },
      },
    );
    return body.blob;
  }

  async downloadBlob(blobId: string): Promise<Uint8Array> {
    const response = await this.#request(`/blobs/${encodeURIComponent(blobId)}`, { method: 'GET' });
    return new Uint8Array(await response.arrayBuffer());
  }

  async purgeBlob(blobId: string): Promise<void> {
    await this.#request(`/blobs/${encodeURIComponent(blobId)}`, { method: 'DELETE' });
  }

  createGroupRoom(accounts: string[]): Promise<RoomInfo> {
    return this.#json('/rooms/group', { method: 'POST', body: JSON.stringify({ accounts }) });
  }

  addMembers(roomId: string, accounts: string[]): Promise<RoomInfo> {
    return this.#json(`/rooms/${encodeURIComponent(roomId)}/members`, {
      method: 'POST',
      body: JSON.stringify({ accounts }),
    });
  }

  async leaveRoom(roomId: string): Promise<void> {
    await this.#request(`/rooms/${encodeURIComponent(roomId)}/members/me`, { method: 'DELETE' });
  }

  async #json<T>(path: string, init: RequestInit): Promise<T> {
    return (await this.#request(path, init)).json() as Promise<T>;
  }

  async #request(path: string, init: RequestInit): Promise<Response> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        // The default, overridable by `init.headers` — which is how a blob
        // upload declares itself as bytes. Ordering matters here and is easy to
        // reverse by accident.
        'content-type': 'application/json',
        ...(await this.#headers()),
        ...init.headers,
      },
    });

    if (!response.ok) {
      // The server answers refusals with `{ error: "<reason>" }`. Anything else
      // came from in front of it — a proxy, a captive portal — and the status
      // is all we have.
      const reason = await response
        .json()
        .then((b: unknown) => (b as { error?: string })?.error)
        .catch(() => undefined);
      throw new TransportError(response.status, reason ?? `http_${response.status}`);
    }

    return response;
  }
}
