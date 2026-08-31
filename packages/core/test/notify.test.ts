/**
 * The notification rules (`docs/35`, `docs/05` §8).
 *
 * One test per rule, plus the interactions that decide the arguments. These are
 * one-liners because `decide` is pure — that is most of the reason it is pure.
 *
 * The promise being defended is **predictability**, so the tests that matter
 * most are the ones asserting a rule *does not* fire: a mute that holds against
 * a direct mention, a DND that holds against everything, a reaction that does
 * not mark a room unread.
 */
import { describe, expect, it } from 'vitest';
import {
  type Candidate,
  decide,
  effectiveSetting,
  type NotificationSettings,
} from '../src/index.js';

const ME = 'acct-me';
const THEM = 'acct-them';

const reader = (minuteOfDay?: number) =>
  minuteOfDay === undefined ? { account: ME } : { account: ME, minuteOfDay };

/** A plain message from somebody else, in a space room. */
function message(over: Partial<Candidate> = {}): Candidate {
  return {
    roomId: 'room-1',
    spaceId: 'space-1',
    kind: 'space',
    class: 'normal',
    sender: THEM,
    ...over,
  };
}

const settings = (over: Partial<NotificationSettings> = {}): NotificationSettings => ({
  default: 'everything',
  ...over,
});

describe('the rules that stop a notification', () => {
  it('never notifies you about your own message from another device', () => {
    // Matched on the account, not the device: your laptop must not buzz about
    // something you just sent from your phone.
    const d = decide(message({ sender: ME }), settings(), reader());
    expect(d).toMatchObject({ notify: false, mark: 'none', rule: 'self' });
  });

  it('never notifies — or marks — for a reaction or a receipt', () => {
    // A room that goes bold when somebody reacts is a room whose bold means
    // nothing.
    for (const cls of ['silent', 'ephemeral'] as const) {
      const d = decide(message({ class: cls }), settings(), reader());
      expect(d).toMatchObject({ notify: false, mark: 'none', rule: 'never-notifies' });
    }
  });

  it('keeps a mute against a direct mention', () => {
    // **The decision.** A mute you have to re-explain to every person who pings
    // you is not a mute.
    const d = decide(
      message({ mentions: [ME] }),
      settings({ rooms: { 'room-1': 'nothing' } }),
      reader(),
    );
    expect(d).toMatchObject({ notify: false, rule: 'muted' });
    // Discoverable when you look, and never a badge (`docs/05` §8).
    expect(d.mark).toBe('dot');
  });

  it('keeps a mute against an @everyone', () => {
    const d = decide(
      message({ broadcast: true }),
      settings({ rooms: { 'room-1': 'nothing' } }),
      reader(),
    );
    expect(d.rule).toBe('muted');
  });

  it('lets nothing at all through Do Not Disturb', () => {
    // No priority contact, no repeated-DM heuristic, no @everyone. Anything
    // that can break DND makes it a suggestion.
    const loud = [
      message({ mentions: [ME] }),
      message({ broadcast: true }),
      message({ kind: 'dm', spaceId: null }),
      message({ replyTo: ME }),
    ];
    for (const candidate of loud) {
      const d = decide(candidate, settings({ dnd: true }), reader());
      expect(d.notify).toBe(false);
      expect(d.rule).toBe('dnd');
      // Badged, not lost: it is all there when you come back.
      expect(d.mark).toBe('badge');
    }
  });

  it('reports the mute rather than DND when both apply', () => {
    // The more specific and more durable reason is the more useful one to show.
    const d = decide(message(), settings({ dnd: true, rooms: { 'room-1': 'nothing' } }), reader());
    expect(d.rule).toBe('muted');
  });

  it('suppresses inside quiet hours, including across midnight', () => {
    const overnight = settings({ quietHours: { start: 1380, end: 420 } }); // 23:00–07:00
    expect(decide(message(), overnight, reader(1400)).rule).toBe('quiet-hours'); // 23:20
    expect(decide(message(), overnight, reader(120)).rule).toBe('quiet-hours'); // 02:00
    expect(decide(message(), overnight, reader(600)).rule).toBe('everything'); // 10:00
  });

  it('treats an empty quiet-hours window as empty, not as all day', () => {
    // The setting that means "always" is DND, and having two ways to spell it
    // is how somebody silences themselves by accident.
    const d = decide(message(), settings({ quietHours: { start: 540, end: 540 } }), reader(540));
    expect(d.rule).toBe('everything');
  });

  it('ignores quiet hours when the reader has not said what time it is', () => {
    // No clock is read in here, so an absent `minuteOfDay` means "unknown"
    // rather than "midnight" — and unknown must not silence anything.
    const d = decide(message(), settings({ quietHours: { start: 0, end: 1440 } }), reader());
    expect(d.notify).toBe(true);
  });

  it('marks but does not notify in a mentions-only room', () => {
    const d = decide(message(), settings({ rooms: { 'room-1': 'mentions' } }), reader());
    expect(d).toMatchObject({ notify: false, mark: 'badge', rule: 'mentions-only' });
  });
});

describe('the rules that raise one', () => {
  it('notifies on a direct mention, and says that is why', () => {
    const d = decide(message({ mentions: [ME] }), settings({ default: 'mentions' }), reader());
    expect(d).toMatchObject({ notify: true, rule: 'mention' });
    expect(d.because).toBe('you were mentioned');
  });

  it('notifies on a reply to something you wrote', () => {
    const d = decide(message({ replyTo: ME }), settings({ default: 'mentions' }), reader());
    expect(d.rule).toBe('reply');
  });

  it('notifies on a broadcast, and does not on somebody else being named', () => {
    expect(
      decide(message({ broadcast: true }), settings({ default: 'mentions' }), reader()).rule,
    ).toBe('broadcast');
    expect(
      decide(message({ mentions: [THEM] }), settings({ default: 'mentions' }), reader()).rule,
    ).toBe('mentions-only');
  });

  it('prefers the mention label over the room-setting label', () => {
    // Both would notify; "you were mentioned" is the one worth reading.
    const d = decide(message({ mentions: [ME] }), settings({ default: 'everything' }), reader());
    expect(d.rule).toBe('mention');
  });

  it('notifies for a DM even when the global default is mentions-only', () => {
    // A message from one specific person, sent to only you, silently not
    // notifying is not what anybody means by a default for rooms.
    const d = decide(
      message({ kind: 'dm', spaceId: null }),
      settings({ default: 'mentions' }),
      reader(),
    );
    expect(d).toMatchObject({ notify: true, rule: 'direct' });
  });

  it('still lets you mute a specific DM', () => {
    const d = decide(
      message({ kind: 'dm', spaceId: null, mentions: [ME] }),
      settings({ default: 'mentions', rooms: { 'room-1': 'nothing' } }),
      reader(),
    );
    expect(d.rule).toBe('muted');
  });
});

describe('where a setting comes from', () => {
  const dm = message({ kind: 'dm', spaceId: null });

  it('prefers the room over the space over the default', () => {
    expect(
      effectiveSetting(
        message(),
        settings({
          default: 'nothing',
          spaces: { 'space-1': 'mentions' },
          rooms: { 'room-1': 'everything' },
        }),
      ),
    ).toBe('everything');
    expect(
      effectiveSetting(
        message(),
        settings({ default: 'nothing', spaces: { 'space-1': 'mentions' } }),
      ),
    ).toBe('mentions');
    expect(effectiveSetting(message(), settings({ default: 'nothing' }))).toBe('nothing');
  });

  it('treats inherit as absent at every level', () => {
    expect(
      effectiveSetting(
        message(),
        settings({
          default: 'mentions',
          spaces: { 'space-1': 'inherit' },
          rooms: { 'room-1': 'inherit' },
        }),
      ),
    ).toBe('mentions');
  });

  it('keeps DMs out of the global room default', () => {
    expect(effectiveSetting(dm, settings({ default: 'nothing' }))).toBe('everything');
    // ...but an explicit setting on that DM still wins.
    expect(
      effectiveSetting(dm, settings({ default: 'nothing', rooms: { 'room-1': 'nothing' } })),
    ).toBe('nothing');
  });
});

describe('every decision explains itself', () => {
  it('carries a reason for every rule that can fire', () => {
    // `docs/05` §8: "The rule that fired is shown on the notification." A rule
    // with no words is one that cannot be shown, so this is the check that the
    // copy deck has not fallen behind the rule list.
    const cases: Candidate[] = [
      message({ sender: ME }),
      message({ class: 'silent' }),
      message(),
      message({ mentions: [ME] }),
      message({ replyTo: ME }),
      message({ broadcast: true }),
      message({ kind: 'dm', spaceId: null }),
    ];
    const seen = new Set<string>();
    for (const c of cases) {
      const configurations = [
        settings(),
        settings({ dnd: true }),
        settings({ quietHours: { start: 0, end: 1440 } }),
        settings({ rooms: { 'room-1': 'nothing' } }),
        settings({ rooms: { 'room-1': 'mentions' } }),
      ];
      for (const s of configurations) {
        const d = decide(c, s, reader(720));
        expect(d.because.length).toBeGreaterThan(0);
        // Lowercase and unpunctuated — it is appended to a notification, not a
        // sentence of its own (`docs/08`).
        expect(d.because).toBe(d.because.toLowerCase());
        expect(d.because.endsWith('.')).toBe(false);
        seen.add(d.rule);
      }
    }
    // Every rule the engine can reach is covered above. If a new one is added
    // without a case here, this drops and somebody has to decide what it says.
    expect([...seen].sort()).toEqual([
      'broadcast',
      'direct',
      'dnd',
      'everything',
      'mention',
      'mentions-only',
      'muted',
      'never-notifies',
      'quiet-hours',
      'reply',
      'self',
    ]);
  });
});
