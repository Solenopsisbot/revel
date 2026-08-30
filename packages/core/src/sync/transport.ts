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
import type { Event, EventInput } from '@revel/protocol';

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

  async #json<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
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

    return (await response.json()) as T;
  }
}
