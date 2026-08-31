/**
 * The room this device had open when it was last here.
 *
 * Per account, because two people sharing a browser must not inherit each
 * other's last conversation — and because the id alone would be meaningless
 * to an account that is not in that room.
 *
 * Best effort throughout. `localStorage` throws in a private window in some
 * browsers and is simply absent during SSR, and neither is a reason for the
 * app not to open: the cost of failure here is landing on the first DM
 * instead of the right one.
 */

const KEY = 'revel:last-room';

let account = '';

/** Scope the memory to a signed-in account. Called once the session is known. */
export function forAccount(accountKey: string): void {
  account = accountKey;
}

function key(): string {
  return account ? `${KEY}:${account}` : KEY;
}

export const lastRoom = {
  read(): string | null {
    try {
      return globalThis.localStorage?.getItem(key()) ?? null;
    } catch {
      return null;
    }
  },
  write(roomId: string): void {
    try {
      globalThis.localStorage?.setItem(key(), roomId);
    } catch {
      // A browser that will not remember is a browser that opens on the first
      // DM. That is a worse experience, not a broken one.
    }
  },
};
