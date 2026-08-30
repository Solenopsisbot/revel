/**
 * The directory seam.
 *
 * Same reason as `conversation.test.ts`: this is where a dropped field becomes
 * a room with no members and a title reading "someone", which type-checks
 * perfectly and is only visible to eyes.
 *
 * The first test is the one that matters. A DM list keyed by face gives you two
 * conversations with the same person under two of their names, and `docs/11` is
 * explicit about why that is wrong rather than merely untidy.
 */
import { describe, expect, it } from 'vitest';
import { dms as seedDms, faces as seedFaces } from './data.js';
import { dmAsRoomInfo, dmTitleOf } from './directoryShape.js';

const faces = seedFaces;
const nameOf = (account: string) =>
  Object.values(faces).find((f) => f.accountId === account)?.name ?? account;

describe('a DM as the directory sees it', () => {
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

  it('counts one person once, however many faces they used', () => {
    const [first] = seedDms;
    if (!first) throw new Error('no fixture DMs');
    const account = faces[first.withIds[0] as string]?.accountId as string;

    // Two faces of one person, in one conversation, is one member.
    const twoFaces = Object.entries(faces)
      .filter(([, f]) => f.accountId === account)
      .map(([id]) => id);
    const info = dmAsRoomInfo({ ...first, withIds: [...twoFaces, ...twoFaces] }, faces);
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

describe('naming a conversation nobody named', () => {
  const me = 'acct-me';

  it('leaves you out of your own DM title', () => {
    const title = dmTitleOf(
      { members: [me, 'acct-ash'] },
      (a) => (a === 'acct-ash' ? 'Ash' : 'You'),
      me,
    );
    expect(title).toBe('Ash');
  });

  it('joins two with "and", and more with commas', () => {
    const name = (a: string) => a.replace('acct-', '');
    expect(dmTitleOf({ members: [me, 'acct-ash', 'acct-kit'] }, name, me)).toBe('ash and kit');
    expect(dmTitleOf({ members: [me, 'acct-a', 'acct-b', 'acct-c'] }, name, me)).toBe('a, b and c');
  });

  it('says something rather than nothing for a conversation with only you', () => {
    expect(dmTitleOf({ members: [me] }, () => 'x', me)).toBe('Just you');
  });

  it('names people once even when they brought two faces', () => {
    // The point of titling by account: somebody who speaks as two faces is one
    // person in the conversation, and a title listing both would be describing
    // the presentation rather than who is there.
    const info = { members: ['acct-ash'] };
    expect(dmTitleOf(info, () => 'Ash', me)).toBe('Ash');
  });
});
