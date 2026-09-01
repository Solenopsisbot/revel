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

  /**
   * The identity provider this account lives on.
   *
   * Taken from where the app is being served, which is true for a normal
   * deployment and honest about being a guess: `docs/02` splits Host and IdP
   * into separate roles, and nothing in the client is told which IdP issued
   * its handle. When that becomes a real setting this is where it reads from.
   */
  get provider(): string {
    return typeof location === 'undefined' ? '' : location.host;
  }

  /**
   * How a person reads this account: `viola@revel.chat`.
   *
   * The provider half is not decoration. A handle is only unique on the IdP
   * that issued it (`docs/17`), so a bare name is ambiguous the moment there
   * is more than one provider — which is the entire point of the design.
   */
  get address(): string {
    const handle = this.current?.handle;
    if (!handle) return '';
    const provider = this.provider;
    return provider ? `${handle}@${provider}` : handle;
  }

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

        // Notification preferences are per account too, and they have to be in
        // place before `live.start` below: the rules engine reads them on the
        // first event that arrives.
        const { forAccount: notifyForAccount } = await import('./notifyPrefs.js');
        notifyForAccount(this.current.accountPub);
        const { core } = await import('./fake/core.svelte.js');
        core.loadNotifications();

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
