/**
 * Notification preferences that survive a reload.
 *
 * Per account, like `lastRoom` and for the same reason: two people sharing a
 * browser must not inherit each other's mutes.
 *
 * **Device-local.** Muting a room here does not mute it on your phone. That
 * needs somewhere shared to put it — either account settings the Host holds,
 * or an encrypted event the way `room.faces` works — and neither exists yet.
 * `docs/35` specifies the *rules*, not where the settings live, so this is the
 * smallest honest thing rather than a guess at the eventual shape.
 *
 * Best effort throughout: `localStorage` throws in a private window in some
 * browsers and is absent during SSR, and neither is a reason for the app not
 * to open. The cost of failure is notification settings that reset, which is
 * annoying rather than broken.
 */

import type { Notifications } from './fake/data.js';

const KEY = 'revel:notify';

let account = '';

/** Scope the preferences to a signed-in account. Called once the session is known. */
export function forAccount(accountKey: string): void {
  account = accountKey;
}

function key(): string {
  return account ? `${KEY}:${account}` : KEY;
}

/** Merge anything stored over the defaults, so a new field is not a migration. */
export function loadPrefs(defaults: Notifications): Notifications {
  try {
    const raw = globalThis.localStorage?.getItem(key());
    if (!raw) return defaults;
    const saved = JSON.parse(raw) as Partial<Notifications>;
    return {
      ...defaults,
      ...saved,
      spaces: { ...defaults.spaces, ...(saved.spaces ?? {}) },
      rooms: { ...defaults.rooms, ...(saved.rooms ?? {}) },
      quietHours: { ...defaults.quietHours, ...(saved.quietHours ?? {}) },
    };
  } catch {
    return defaults;
  }
}

export function savePrefs(prefs: Notifications): void {
  try {
    globalThis.localStorage?.setItem(key(), JSON.stringify(prefs));
  } catch {
    // A browser that will not remember is a browser whose mutes reset.
  }
}
