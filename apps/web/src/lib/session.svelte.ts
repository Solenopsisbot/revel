/**
 * Who this device is signed in as, for the duration of the tab.
 *
 * The sealed copy lives in IndexedDB (`@revel/core`'s `session.ts`); this is the
 * unsealed one, in memory, which is where it has to be to sign anything.
 *
 * ## Why the app waits for it
 *
 * `restore()` is async — it opens a database and does an AES-GCM decrypt — and
 * the app cannot know whether somebody is signed in until it finishes. Deciding
 * before then would mean either flashing the sign-in screen at somebody who is
 * signed in, or rendering the app for somebody who is not. Both are worse than
 * a moment of nothing, so `ready` starts false and the shell holds.
 */
import type { Session } from '@revel/core';

class DeviceSession {
  /** Null until `restore()` has run — see `ready`. */
  current = $state<Session | null>(null);
  /** Whether the answer is known yet. Distinct from "signed out". */
  ready = $state(false);

  get signedIn(): boolean {
    return this.current !== null;
  }

  async restore(): Promise<Session | null> {
    try {
      const { loadSession } = await import('@revel/core');
      this.current = await loadSession();
      if (this.current) {
        // The face book is per account and sealed on this device. Loaded here
        // rather than lazily, because the composer needs to know who it is
        // speaking as before anybody can type.
        const { myFaces } = await import('./faces.svelte.js');
        await myFaces.load(this.current.accountPub);

        // Which room to reopen is per account, not per browser: two people
        // sharing a machine must not inherit each other's last conversation.
        const { forAccount } = await import('./lastRoom.js');
        forAccount(this.current.accountPub);

        // The real core. Floating on purpose: it opens a socket and a database
        // and talks to a Host, and none of that may stop the app rendering —
        // `live.error` is what the connection banner reads if it fails.
        const { live } = await import('./live.svelte.js');
        void live.start(this.current);

        // A device token, so this device can act at the Host. Floating on
        // purpose: a Host that is unreachable must not stop the app opening —
        // everything local still works, and the token is retried on next use.
        const { authenticateDevice } = await import('./identity.js');
        void authenticateDevice(this.current).catch((err) =>
          console.error('device authentication failed', err),
        );
      }
    } catch (err) {
      // A storage failure is not a reason to be stuck on a blank page. Treated
      // as signed out, which is recoverable by signing in — the alternative is
      // a reload loop nobody escapes without clearing site data.
      console.error('could not restore the session', err);
      this.current = null;
    } finally {
      this.ready = true;
    }
    return this.current;
  }

  async signOut(): Promise<void> {
    const { clearSession } = await import('@revel/core');
    const { forgetDeviceToken } = await import('./identity.js');
    const { myFaces } = await import('./faces.svelte.js');
    const { live } = await import('./live.svelte.js');
    await live.stop();
    await clearSession();
    forgetDeviceToken();
    myFaces.forget();
    this.current = null;
  }
}

export const session = new DeviceSession();
