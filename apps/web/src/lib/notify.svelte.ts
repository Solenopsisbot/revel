/**
 * What happens when `docs/35`'s rules say something is worth your attention.
 *
 * `RoomSync` runs the rules and hands every decrypted event here, notifying or
 * not — that is deliberate (`docs/05` §8): a muted room still gets its quiet
 * dot, and the only way to know which mark a room deserves is to be told about
 * the events that did *not* notify as well as the ones that did.
 *
 * Two things come out of it:
 *
 * - **A mark per room**, `badge` or `dot`, which is what the sidebar renders.
 *   Kept here rather than derived from unread counts, because "unread" and
 *   "owed your attention" are different claims and `decide` is the only thing
 *   that knows the difference.
 * - **A desktop notification**, when the browser has already been given
 *   permission and the room is not on screen.
 *
 * Permission is never asked for on its own. A page that demands notification
 * access before you have done anything is the single most disliked pattern on
 * the web, and browsers now ignore the request outside a user gesture anyway —
 * so this stays quiet until a settings toggle calls `requestPermission`.
 */

import type { Decision, LocalEvent, NotificationSettings } from '@revel/core';

/**
 * The rules' settings plus the two that are only about presentation.
 *
 * `previews` and `sound` are not in `NotificationSettings` on purpose: they
 * change what a notification *looks like*, never whether one is owed, and
 * `docs/35`'s rules stay a decision about attention rather than about chrome.
 */
export interface AppNotificationSettings extends NotificationSettings {
  /** Whether the message text appears in the notification itself. */
  previews?: boolean;
  sound?: boolean;
}

/** The strongest mark wins, so a mention is never downgraded by a later dot. */
const RANK = { none: 0, dot: 1, badge: 2 } as const;
type Mark = keyof typeof RANK;

class Notifications {
  /** roomId → the strongest mark since that room was last read. */
  #marks = $state<Record<string, Mark>>({});

  /**
   * Where the settings live.
   *
   * Injected rather than imported: the settings belong to the screen that
   * edits them, and reaching into it from here would make the notification
   * rules depend on the UI instead of the other way round.
   */
  #source: (() => AppNotificationSettings) | null = null;

  /** The room on screen, so a message you are looking at does not pop up. */
  #looking: string | null = null;

  useSettings(source: () => AppNotificationSettings): void {
    this.#source = source;
  }

  /**
   * `everything` as the floor, not `mentions`.
   *
   * This is only reached before a settings source is wired, and an unwired
   * client that goes quiet is a client that loses messages silently. Too loud
   * is a complaint; too quiet is a bug nobody reports.
   */
  settings(): AppNotificationSettings {
    return this.#source?.() ?? { default: 'everything' };
  }

  /** Tell the sink which room is on screen. */
  looking(roomId: string | null): void {
    this.#looking = roomId;
  }

  /** The mark this room has earned, for the sidebar. */
  mark(roomId: string): Mark {
    return this.#marks[roomId] ?? 'none';
  }

  /** Reading a room clears what it was owed. */
  clear(roomId: string): void {
    if (!this.#marks[roomId]) return;
    const { [roomId]: _gone, ...rest } = this.#marks;
    this.#marks = rest;
  }

  /** Every decrypted event, notifying or not. Wired as `NotifyDeps.deliver`. */
  deliver(roomId: string, event: LocalEvent, decision: Decision): void {
    if (decision.mark !== 'none' && RANK[decision.mark] > RANK[this.mark(roomId)]) {
      this.#marks = { ...this.#marks, [roomId]: decision.mark };
    }
    if (decision.notify) this.#raise(roomId, event, decision);
  }

  /** Whether this browser will show anything at all. */
  get permission(): NotificationPermission | 'unsupported' {
    return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  }

  /** Ask. Must be called from a user gesture, so only a settings toggle may. */
  async requestPermission(): Promise<NotificationPermission | 'unsupported'> {
    if (typeof Notification === 'undefined') return 'unsupported';
    return await Notification.requestPermission();
  }

  #raise(roomId: string, event: LocalEvent, decision: Decision): void {
    if (this.permission !== 'granted') return;
    // Already in front of them. The mark is still recorded above — it is
    // cleared by reading the room, not by the message having arrived.
    if (this.#looking === roomId && document.visibilityState === 'visible') return;

    const payload = event.payload;
    const message =
      payload.known && payload.event.type === 'm.message'
        ? (payload.event as { body?: string; face?: { name?: string } })
        : null;
    if (!message) return;

    try {
      // "Show message previews" off means the notification says somebody said
      // something and not what. The plaintext is already on this device — it
      // was decrypted here — so this is a choice about who else can read the
      // screen, not about what the app knows.
      const previews = this.settings().previews !== false;
      new Notification(message.face?.name ?? 'Revel', {
        body: previews ? (message.body ?? '') : 'sent you a message',
        // One per room: a burst of ten messages replaces itself rather than
        // stacking ten notifications for one conversation.
        tag: `revel:${roomId}`,
        // The rule, in words (`docs/05` §8) — so a notification can always
        // answer "why did you wake me up for this".
        data: { roomId, because: decision.because },
      });
    } catch {
      // Some browsers throw for a constructed Notification outside a service
      // worker. Not being able to pop up is not a reason to break syncing.
    }
  }
}

export const notifications = new Notifications();
