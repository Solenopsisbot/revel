/**
 * "Should this event notify, and how" (`docs/05` §5's `notify/`).
 *
 * `docs/05` §8 is the whole brief and it is a promise about *predictability*,
 * not about features:
 *
 * > **Notifications you can predict.** One rules screen: per room — everything
 * > / mentions / nothing; per space — inherit; global — DND, quiet hours,
 * > sounds. **The rule that fired is shown on the notification.** Muted things
 * > get a quiet dot, never a badge.
 *
 * ## Why this is a pure function
 *
 * Every input is passed in — the settings, the event, the reader, even the time
 * of day. Nothing here reads a clock, a store, or a preference. That is what
 * makes "the rule that fired is shown on the notification" a thing that can be
 * *true*: the decision is reproducible, so the label is the actual reason and
 * not a guess reconstructed afterwards. It is also why every rule below has a
 * test that is one line long.
 *
 * ## The order is the specification
 *
 * First match wins, and the order encodes the decisions rather than describing
 * them. Two are worth stating out loud because they are the ones people
 * disagree about, and both were decided deliberately:
 *
 * - **A mute is absolute.** It sits above every mention rule, so a direct `@you`
 *   in a muted room does not notify. A mute you have to re-explain to each
 *   person who pings you is not a mute. The room still gets its quiet dot, so
 *   it is discoverable the moment you look — it just never interrupts.
 * - **Nothing overrides Do Not Disturb.** No priority contact, no repeated-DM
 *   heuristic, no `@everyone`. Everything queues and is there when you come
 *   back. Anything that can break DND makes it a suggestion, and a suggestion is
 *   exactly what people have learned to distrust about every other app's.
 *
 * `docs/35-notification-rules.md` is the long form.
 */

/** What a room, a space, or the global default can be set to. */
export type Loudness = 'everything' | 'mentions' | 'nothing';
/** A room or space setting. `inherit` defers to the level above. */
export type Setting = Loudness | 'inherit';

/** Every rule that can decide, in the order they are tried. */
export type RuleId =
  | 'self'
  | 'never-notifies'
  | 'muted'
  | 'dnd'
  | 'quiet-hours'
  | 'mention'
  | 'reply'
  | 'broadcast'
  | 'direct'
  | 'mentions-only'
  | 'everything';

export interface NotificationSettings {
  /**
   * The global fallback for rooms in spaces, when nothing nearer has an
   * opinion. DMs do not use this — see [`effectiveSetting`].
   */
  default: Loudness;
  /** Per space, by space id. */
  spaces?: Record<string, Setting>;
  /** Per room, by room id. Beats the space it is in. */
  rooms?: Record<string, Setting>;
  /** Absolute. Nothing gets through (see above). */
  dnd?: boolean;
  /**
   * Local minutes from midnight, `[start, end)`, wrapping past midnight — so
   * 23:00→07:00 is `{ start: 1380, end: 420 }`.
   *
   * **Suppress, not delay.** A queue that empties at 07:00 is twelve
   * notifications arriving at once about things you have already read, which is
   * worse than the silence it was trying to soften.
   */
  quietHours?: { start: number; end: number };
}

/** The event, reduced to only what the decision depends on. */
export interface Candidate {
  roomId: string;
  /** Null for a DM or group DM. There is no space to inherit from. */
  spaceId: string | null;
  kind: 'space' | 'dm' | 'group';
  /** `silent` and `ephemeral` never notify (`docs/04` §2). */
  class: 'normal' | 'silent' | 'ephemeral';
  /** The account that sent it, resolved from the MLS leaf. */
  sender: string;
  /**
   * Accounts named in the payload's `mentions` — accounts, never faces.
   *
   * The protocol types this `AccountId`, but the shape cannot police it (a
   * snowflake is valid base64url), so a caller passing face ids gets silence
   * rather than an error. Hence the name of this field and this sentence.
   */
  mentions?: string[];
  /** `@everyone`, or a role the reader holds. Gated by `MENTION_EVERYONE`. */
  broadcast?: boolean;
  /** The author of the message this replies to, when it is a reply. */
  replyTo?: string;
}

export interface Reader {
  /** The reading account. One account, however many faces it wears. */
  account: string;
  /**
   * Local minutes from midnight. Passed in rather than read from a clock, so
   * a quiet-hours decision is reproducible and testable.
   */
  minuteOfDay?: number;
}

export interface Decision {
  /** Raise something the person sees or hears. */
  notify: boolean;
  /**
   * How the room is marked in the list.
   *
   * `docs/05` §8: "Muted things get a quiet dot, never a badge." The dot says
   * *something happened* without asserting that it is owed attention, which is
   * the whole difference between a muted room and an unread one.
   */
  mark: 'badge' | 'dot' | 'none';
  /** Which rule decided. */
  rule: RuleId;
  /** The rule, in words, for the notification itself (`docs/05` §8). */
  because: string;
}

/** Short, lowercase, no hedging — `docs/08`'s voice. */
const BECAUSE: Record<RuleId, string> = {
  self: 'you sent this',
  'never-notifies': 'reactions and receipts never notify',
  muted: 'this room is muted',
  dnd: 'do not disturb is on',
  'quiet-hours': 'quiet hours',
  mention: 'you were mentioned',
  reply: 'a reply to you',
  broadcast: 'everyone here was mentioned',
  direct: 'a direct message',
  'mentions-only': 'this room only notifies for mentions',
  everything: 'this room notifies for everything',
};

/**
 * Room, then space, then the default — with DMs deliberately outside the chain.
 *
 * A DM has no space to inherit from, and falling through to a global default of
 * `mentions` would mean a message from one specific person, sent to only you,
 * silently not notifying. Nobody means that when they set a default for rooms.
 * So a DM's floor is `everything`, and muting one is an explicit per-room act.
 */
export function resolveSetting(
  candidate: Candidate,
  settings: NotificationSettings,
): { level: Loudness; from: 'room' | 'space' | 'default' } {
  const room = settings.rooms?.[candidate.roomId];
  if (room && room !== 'inherit') return { level: room, from: 'room' };

  if (candidate.spaceId) {
    const space = settings.spaces?.[candidate.spaceId];
    if (space && space !== 'inherit') return { level: space, from: 'space' };
  }

  const level = candidate.kind === 'space' ? settings.default : 'everything';
  return { level, from: 'default' };
}

/**
 * Just the level, for callers that only have to decide.
 *
 * [`resolveSetting`] is the one to reach for in UI: **every notification screen
 * in every app answers "what is this set to" and none of them answer "why"**,
 * which is the only question anybody has. Returning the provenance here means
 * the room menu can tick "Use the space default" without walking the chain a
 * second time — and a second walk is a second implementation of the rule
 * `docs/35` calls the specification.
 */
export function effectiveSetting(candidate: Candidate, settings: NotificationSettings): Loudness {
  return resolveSetting(candidate, settings).level;
}

/** Whether `minute` falls in `[start, end)`, wrapping past midnight. */
function withinQuietHours(minute: number, hours: { start: number; end: number }): boolean {
  const { start, end } = hours;
  // A window that does not wrap is the simple case; one that does covers the
  // two halves either side of midnight. `start === end` is an empty window
  // rather than a whole day, because the setting that means "always" is DND.
  return start <= end ? minute >= start && minute < end : minute >= start || minute < end;
}

/** True when this event names the reader, by any of the routes that count. */
function mentions(candidate: Candidate, reader: Reader): RuleId | null {
  // Matched on the **account**, which is what makes "an `@` at any of your
  // faces" true: a face resolves to its account when the message is composed,
  // so being addressed at a face you are not currently speaking as still
  // reaches you. The face that was addressed lives in the message body, which
  // is where the notification gets the name to show.
  //
  // `EncryptedEvent.mentions` is typed `AccountId` for exactly this. It used to
  // be the generic snowflake `Id` — the same shape as `FaceRef.id` — and a
  // client that put the face id it had just rendered into that list would have
  // produced silence here with no error anywhere.
  if (candidate.mentions?.includes(reader.account)) return 'mention';
  if (candidate.replyTo === reader.account) return 'reply';
  if (candidate.broadcast) return 'broadcast';
  return null;
}

const decision = (rule: RuleId, notify: boolean, mark: Decision['mark']): Decision => ({
  notify,
  mark,
  rule,
  because: BECAUSE[rule],
});

/**
 * Decide. First match wins; the order above is the specification.
 */
export function decide(
  candidate: Candidate,
  settings: NotificationSettings,
  reader: Reader,
): Decision {
  // 1. Your own message, from any of your devices. Not a notification and not
  //    an unread — you were there. Matched on the *account*, which is why your
  //    laptop stays quiet about something you sent from your phone.
  if (candidate.sender === reader.account) return decision('self', false, 'none');

  // 2. A receipt or a reaction. `docs/04` §2 says silent events never notify;
  //    they do not mark either, because a room that goes bold when somebody
  //    reacts is a room whose bold means nothing.
  if (candidate.class !== 'normal') return decision('never-notifies', false, 'none');

  const setting = effectiveSetting(candidate, settings);

  // 3. Muted — above every mention rule, on purpose. A mute you have to
  //    re-explain to each person who pings you is not a mute.
  if (setting === 'nothing') return decision('muted', false, 'dot');

  // 4 & 5. DND and quiet hours suppress the notification and keep the badge, so
  //        everything is waiting rather than lost. Nothing overrides either.
  if (settings.dnd) return decision('dnd', false, 'badge');
  if (
    settings.quietHours &&
    reader.minuteOfDay !== undefined &&
    withinQuietHours(reader.minuteOfDay, settings.quietHours)
  ) {
    return decision('quiet-hours', false, 'badge');
  }

  // 6. Named, replied to, or included in a broadcast. Above `everything` so the
  //    label is the useful one: "you were mentioned" tells you more than "this
  //    room notifies for everything", and the label is the point.
  const named = mentions(candidate, reader);
  if (named) return decision(named, true, 'badge');

  // 7. A DM that has not been muted. Its floor is `everything` (see
  //    `effectiveSetting`), so this only reads more clearly than falling
  //    through to rule 9.
  if (candidate.kind !== 'space' && setting === 'everything') {
    return decision('direct', true, 'badge');
  }

  // 8. Set to mentions, and this was not one.
  if (setting === 'mentions') return decision('mentions-only', false, 'badge');

  // 9. Everything else in a room set to everything.
  return decision('everything', true, 'badge');
}
