/**
 * Which face is in a conversation, and which one speaks.
 *
 * These are privacy rules wearing UI clothes, so they get tested like rules.
 * The bug that prompted them: the roster and audience of a group DM were built
 * from `speakingAs` — the *account-wide* selection — so switching face anywhere
 * changed who the app believed was in a conversation somewhere else, and the
 * face you sent as depended on what you had last picked in another window.
 */
import { describe, expect, it } from 'vitest';
import type { Dm } from './data.js';
import { facesIn, isHere, participantsIn, speakerIn } from './faceShape.js';

const group = (over: Partial<Dm> = {}): Dm => ({
  id: 'dm-group',
  kind: 'group',
  withIds: ['rae', 'emeri'],
  mineIds: ['viola'],
  ...over,
});

describe('who is in a conversation', () => {
  it('is the faces the conversation records, not the one selected', () => {
    // The whole bug, in one assertion.
    expect(facesIn(group())).toEqual(['viola']);
    expect(facesIn(group({ mineIds: ['viola', 'ash'] }))).toEqual(['viola', 'ash']);
  });

  it('is null in a space room, which is not the same as "everyone"', () => {
    // A space room's membership is per account (`docs/03` §4), so no face is a
    // participant in its own right and nothing should be greyed out. The caller
    // has to be able to tell that apart from "they all happen to be in it".
    expect(facesIn(undefined)).toBeNull();
    expect(isHere(undefined, 'ash')).toBe(true);
  });

  it('says a face that has not joined is not here', () => {
    expect(isHere(group(), 'viola')).toBe(true);
    expect(isHere(group(), 'ash')).toBe(false);
  });

  it('lists mine and theirs, in that order, without de-duplicating', () => {
    // `docs/11`: with linking off each face is an independent person.
    // Collapsing two of mine into one entry would announce that they are one
    // system to anybody who can count.
    const both = group({ mineIds: ['viola', 'ash'] });
    expect(participantsIn(both)).toEqual(['viola', 'ash', 'rae', 'emeri']);
  });
});

describe('who is speaking', () => {
  it('uses the conversation choice over the account-wide one', () => {
    const dm = group({ mineIds: ['viola', 'ash'], speakingAs: 'ash' });
    expect(speakerIn(dm, 'june')).toBe('ash');
  });

  it('falls back to the first member when the choice has left', () => {
    // A stored choice can name a face that is no longer in the conversation.
    // Speaking as somebody who is not in the room is a worse outcome than
    // quietly ignoring the preference.
    const dm = group({ mineIds: ['viola'], speakingAs: 'ash' });
    expect(speakerIn(dm, 'june')).toBe('viola');
  });

  it('falls back to the account-wide face only when there is nothing else', () => {
    expect(speakerIn(group({ mineIds: [] }), 'june')).toBe('june');
  });

  it('is the account-wide face in a space room', () => {
    expect(speakerIn(undefined, 'june')).toBe('june');
  });

  it('does not change when the account-wide face changes', () => {
    // The regression this exists to catch: two conversations, one selection,
    // and switching in one must not move the other.
    const a = group({ id: 'a', mineIds: ['viola', 'ash'], speakingAs: 'ash' });
    const b = group({ id: 'b', mineIds: ['viola', 'june'], speakingAs: 'june' });
    for (const global of ['viola', 'ash', 'june']) {
      expect(speakerIn(a, global)).toBe('ash');
      expect(speakerIn(b, global)).toBe('june');
    }
  });
});
