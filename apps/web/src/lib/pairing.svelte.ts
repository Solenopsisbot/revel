/**
 * The new device's half of "add a device from one you are holding".
 *
 * `docs/03` §3's convenient case, from the side that has nothing yet: generate a
 * single-use transfer key, ask the IdP for a channel, show a QR, and wait. The
 * existing device scans it, confirms a fingerprint, and sends the account key
 * sealed to that key — the IdP relays and cannot read it.
 *
 * ## Why this polls
 *
 * There is no socket yet. A socket needs a session and a session is what this
 * flow is *for*, so the only thing available is asking. Every two seconds for
 * five minutes is 150 requests against a route that reads one row, which is
 * cheap enough not to be worth the complexity of anything else.
 */
import { transport } from './identity.js';
import { cryptoWasm } from './wasm.js';

/** How often to ask, and for how long. Matches the channel's own lifetime. */
const POLL_MS = 2000;
const CHANNEL_MS = 5 * 60_000;

export interface Paired {
  accountPub: string;
  handle: string;
  accountKey: Uint8Array;
}

const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const b64url = (bytes: Uint8Array): string =>
  b64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

class Pairing {
  /** What the QR encodes, or '' before the channel exists. */
  link = $state('');
  /** Shown on both screens so a swapped QR is something a person can see. */
  fingerprint = $state('');
  /** `waiting` → `done`, or `expired` / `failed`. */
  status = $state<'idle' | 'waiting' | 'done' | 'expired' | 'failed'>('idle');

  #secret: Uint8Array | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;

  /** Open a channel and start waiting. Returns the account once it arrives. */
  async begin(onPaired: (paired: Paired) => void): Promise<void> {
    this.stop();
    this.status = 'waiting';
    try {
      const wasm = await cryptoWasm();
      const secret = wasm.Transfer.generateKey();
      const pub = wasm.Transfer.publicKey(secret);
      this.#secret = secret;
      this.fingerprint = wasm.Transfer.fingerprint(pub);

      const opened = await transport.post('/idp/enrol/channel', { transferPub: b64(pub) });
      if (opened.status !== 201) {
        this.status = 'failed';
        return;
      }
      const { channel } = opened.body as { channel: string };
      // Everything the other device needs, and nothing it does not: a channel
      // to answer on and the key to seal to. No handle, because the QR is shown
      // by somebody who has not signed in and does not know one yet.
      this.link = `revel://add?c=${encodeURIComponent(channel)}&k=${b64url(pub)}`;
      // Shown as text as well as a QR: a desktop with no camera still has to be
      // able to complete this, and copy-paste is the fallback any camera flow
      // needs anyway.

      const deadline = Date.now() + CHANNEL_MS;
      const poll = async () => {
        if (Date.now() > deadline) {
          this.status = 'expired';
          return;
        }
        const res = await fetch(`/idp/enrol/channel/${encodeURIComponent(channel)}`);
        if (res.status === 404) {
          this.status = 'expired';
          return;
        }
        const body = (await res.json().catch(() => null)) as {
          delivery?: { sealed: string; accountPub: string; handle: string } | null;
        } | null;

        if (body?.delivery) {
          const sealed = unb64(body.delivery.sealed);
          const accountKey = wasm.Transfer.open(secret as Uint8Array, sealed);
          this.status = 'done';
          onPaired({
            accountPub: body.delivery.accountPub,
            handle: body.delivery.handle,
            accountKey,
          });
          return;
        }
        this.#timer = setTimeout(poll, POLL_MS);
      };
      this.#timer = setTimeout(poll, POLL_MS);
    } catch (err) {
      console.error('pairing failed', err);
      this.status = 'failed';
    }
  }

  /** Stop asking. Called when the step is left, so a hidden page is not polling. */
  stop(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    // The transfer secret dies with the attempt. It was single-use anyway, and
    // keeping it would mean a later delivery to an abandoned channel still
    // opened — which is the one thing a single-use key is for.
    this.#secret = null;
    this.link = '';
    this.fingerprint = '';
    this.status = 'idle';
  }
}

export const pairing = new Pairing();
