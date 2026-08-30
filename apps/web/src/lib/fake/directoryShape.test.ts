/**
 * The directory seam, and the privacy rule it exists to keep.
 *
 * Two questions that look like one: **who does the server think is here**
 * (accounts, de-duplicated) and **who is in this conversation** (faces, never
 * de-duplicated). `docs/11`'s "Linking faces" makes the second one a privacy
 * control rather than a display preference:
 *
 * > **Off:** each face appears as an independent person. Nothing in the UI
 * > connects them. This is the safe default and it must stay the default.
 *
 * The tests under "who is in the conversation" are that control. A title that
 * collapsed two faces into one name would announce to everybody in the room
 * that those faces are the same person — a disclosure made by the client
 * instead of by the person it is about.
 */
import { describe, expect, it } from 'vitest';
import { dms as seedDms, faces as seedFaces } from './data.js';
import { dmAsRoomInfo, dmFaces, dmTitleOf } from './directoryShape.js';

const faces = seedFaces;

/** Two faces belonging to one account, from the fixtures, or null. */
function twoFacesOfOneSystem() {
  const byAccount = new Map<string, string[]>();
  for (const [id, f] of Object.entries(faces)) {
    byAccount.set(f.accountId, [...(byAccount.get(f.accountId) ?? []), id]);
  }
  for (const [, ids] of byAccount) if (ids.length >= 2) return ids.slice(0, 2);
  return null;
}

describe('a DM as the *server* sees it', () => {
  it('has members that are accounts, not faces', () => {
    // `docs/11`: a face is a presentation of an account, and the account is the
    // identity. A member list of faces would make one person look like two.
    for (const dm of seedDms) {
      const info = dmAsRoomInfo(dm, faces);
      for (const member of info.members) {
        expect(Object.values(faces).some((f) => f.accountId === member)).toBe(true);
      }
    }
  });

  it('counts one account once, however many faces it brought', () => {
    // True of the *room*: two faces of one account are one member, one set of
    // MLS leaves, one membership row. This is what the server genuinely knows
    // and it is not the list anybody renders.
    const [first] = seedDms;
    const pair = twoFacesOfOneSystem();
    if (!first || !pair) return;

    const account = faces[pair[0] as string]?.accountId as string;
    const info = dmAsRoomInfo({ ...first, withIds: pair }, faces);
    expect(info.members).toEqual([account]);
  });

  it('has no space and no group', () => {
    // `docs/03` §4: DMs are rooms with no space and an explicit-list audience,
    // and a group only exists once somebody opens one.
    for (const dm of seedDms) {
      const info = dmAsRoomInfo(dm, faces);
      expect(info.space).toBeNull();
      expect(info.group).toBeNull();
    }
  });

  it('keeps its kind, so a 1:1 stays a 1:1', () => {
    // The distinction is load-bearing on the server: a 1:1's id is derived from
    // exactly two accounts and cannot gain a third.
    for (const dm of seedDms) {
      expect(dmAsRoomInfo(dm, faces).kind).toBe(dm.kind);
    }
  });

  it('never invents a member for a face nobody has heard of', () => {
    const info = dmAsRoomInfo(
      { ...(seedDms[0] as (typeof seedDms)[number]), withIds: ['ghost'] },
      faces,
    );
    expect(info.members).toEqual(['ghost']);
  });
});
describe('who is in the conversation', () => {
  it('is faces, and never collapses two of them into one person', () => {
    // **The privacy control.** `docs/11`: with linking off — the default — each
    // face appears as an independent person and nothing in the UI connects
    // them. A title that said one name here would tell everybody in the room
    // that those two faces are the same system.
    const [first] = seedDms;
    const pair = twoFacesOfOneSystem();
    if (!first || !pair) return;

    const people = dmFaces({ ...first, withIds: pair }, faces);
    expect(people).toHaveLength(2);
    expect(new Set(people.map((f) => f.name)).size).toBe(2);
    expect(dmTitleOf(people)).toContain(' and ');
  });

  it('leaves your own face out of the title', () => {
    const [first] = seedDms;
    if (!first) throw new Error('no fixture DMs');
    const mine = first.withIds[0] as string;
    expect(dmFaces(first, faces, mine).some((f) => f.id === mine)).toBe(false);
  });

  it('joins two with "and", and more with commas', () => {
    expect(dmTitleOf([{ name: 'Ash' }, { name: 'Kit' }])).toBe('Ash and Kit');
    expect(dmTitleOf([{ name: 'a' }, { name: 'b' }, { name: 'c' }])).toBe('a, b and c');
  });

  it('says something rather than nothing for a conversation with only you', () => {
    expect(dmTitleOf([])).toBe('Just you');
  });

  it('drops a face nobody has heard of rather than rendering a raw id', () => {
    const [first] = seedDms;
    if (!first) throw new Error('no fixture DMs');
    expect(dmFaces({ ...first, withIds: ['ghost'] }, faces)).toEqual([]);
  });
});
