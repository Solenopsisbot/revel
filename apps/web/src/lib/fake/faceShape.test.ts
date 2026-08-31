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
import {
  facesIn,
  facesSpokenIn,
  isHere,
  participantsIn,
  revealsLink,
  speakerIn,
} from './faceShape.js';

/** The faces this account can speak as, as `data.ts` seeds them. */
const MINE = ['viola', 'june', 'ash'];

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
  it('uses the room choice over the account-wide one', () => {
    expect(speakerIn(group({ mineIds: ['viola', 'ash'] }), 'ash', 'june')).toBe('ash');
  });

  it('falls back to the first member when the choice has left', () => {
    // A stored choice can name a face that is no longer in the conversation.
    // Speaking as somebody who is not in the room is a worse outcome than
    // quietly ignoring the preference.
    expect(speakerIn(group({ mineIds: ['viola'] }), 'ash', 'june')).toBe('viola');
  });

  it('falls back to the account-wide face only when there is nothing else', () => {
    expect(speakerIn(group({ mineIds: [] }), undefined, 'june')).toBe('june');
  });

  it('honours a room choice in a space room too', () => {
    // Not just DMs: the reveal check runs against the room you are in, so a
    // global selection would let you switch where it is harmless and arrive
    // where it is not, already set to the face that gives you away.
    expect(speakerIn(undefined, 'ash', 'june')).toBe('ash');
    expect(speakerIn(undefined, undefined, 'june')).toBe('june');
  });

  it('does not change when the account-wide face changes', () => {
    // The regression this exists to catch: one selection shared across rooms,
    // where switching in one moved the other.
    const a = group({ id: 'a', mineIds: ['viola', 'ash'] });
    const b = group({ id: 'b', mineIds: ['viola', 'june'] });
    for (const global of ['viola', 'ash', 'june']) {
      expect(speakerIn(a, 'ash', global)).toBe('ash');
      expect(speakerIn(b, 'june', global)).toBe('june');
    }
  });
});

describe('what speaking here would reveal', () => {
  const spoke = (...ids: string[]) =>
    facesSpokenIn(
      ids.map((faceId) => ({ faceId })),
      MINE,
    );

  it('collects only my faces, once each, in the order they spoke', () => {
    expect(
      facesSpokenIn(
        [
          { faceId: 'rae' },
          { faceId: 'ash' },
          { faceId: 'rae' },
          { faceId: 'viola' },
          { faceId: 'ash' },
        ],
        MINE,
      ),
    ).toEqual(['ash', 'viola']);
  });

  it('reveals nothing when none of my faces has spoken here', () => {
    // Nobody can connect a face to anything yet, so there is nothing to warn
    // about — a fresh room is the one place a new face is free.
    expect(revealsLink(spoke(), 'ash')).toBe(false);
    expect(revealsLink(spoke('rae', 'emeri'), 'ash')).toBe(false);
  });

  it('reveals nothing when this face has already spoken here', () => {
    // The link is already out. Asking again would be theatre, and friction on a
    // privacy control is how people learn to click through it.
    expect(revealsLink(spoke('ash'), 'ash')).toBe(false);
    expect(revealsLink(spoke('viola', 'ash'), 'ash')).toBe(false);
  });

  it('reveals a link when a different face of mine has spoken here', () => {
    // Attribution is per account and the face is a field inside the message
    // (`docs/11`), so the second face to speak is the one that joins them up.
    expect(revealsLink(spoke('viola'), 'ash')).toBe(true);
  });

  it('fires at most once per face per room', () => {
    // Self-limiting by construction: once it has spoken it is in the list.
    let seen = spoke('viola');
    expect(revealsLink(seen, 'ash')).toBe(true);
    seen = [...seen, 'ash'];
    expect(revealsLink(seen, 'ash')).toBe(false);
  });
});
