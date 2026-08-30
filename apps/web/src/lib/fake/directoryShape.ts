/**
 * The fixtures' rooms, as `RoomInfo`.
 *
 * The companion to `messageShape.ts`, and it found the same class of thing:
 * translating to the real shape makes a modelling mistake in the fixtures
 * impossible to keep.
 *
 * ## Two different questions, and conflating them is a privacy bug
 *
 * **Who does the server think is in this room?** Accounts. That is what
 * `RoomInfo.members` is, it is what policy is enforced on, and it is all the
 * server can possibly know — faces live inside the ciphertext (`docs/03` §7).
 *
 * **Who is in this conversation, as far as anyone reading it is concerned?**
 * *Faces.* And they must **not** be collapsed by account. `docs/11`'s
 * "Linking faces" is an explicit, off-by-default privacy control:
 *
 * > **Off:** each face appears as an independent person. Nothing in the UI
 * > connects them. No badge, no shared profile, no "also known as". This is the
 * > safe default and it must stay the default.
 *
 * An earlier version of this file de-duplicated the title by account, on the
 * reasoning that a DM is "with a person". That is true of the *room* and false
 * of the *conversation*, and the difference is the whole point: collapsing two
 * faces into one name tells everybody in the room that those two faces are the
 * same person. For a system that is not out, that is the disclosure the control
 * exists to prevent, made by the client rather than by them.
 *
 * So: `dmAsRoomInfo` produces accounts, because that is the server's view.
 * `dmFaces` and `dmTitleOf` produce faces, because that is everyone else's.
 *
 * Reaching for nothing, for the same reason as `messageShape.ts`: this is where
 * a silently dropped field turns into a room with no members and a title that
 * says "someone", and no type checker will ever mention it.
 */
import type { RoomInfo } from '@revel/protocol';
import type { Dm, Face, Room } from './data.js';

/**
 * A DM or group DM, as the **server** describes one.
 *
 * Members are accounts and are de-duplicated, because that is what the server
 * genuinely knows: two faces of one account are one member of the room, one set
 * of MLS leaves, one entry in the membership table. This is not the list to
 * render — see [`dmFaces`].
 */
export function dmAsRoomInfo(dm: Dm, faces: Record<string, Face>): RoomInfo {
  const members = [...new Set(dm.withIds.map((faceId) => faces[faceId]?.accountId ?? faceId))];
  return {
    id: dm.id,
    kind: dm.kind,
    // A DM has no space (`docs/03` §4: "rooms with no space and an explicit-list
    // audience"), and no MLS group until somebody opens one.
    space: null,
    group: null,
    members,
    streamPaging: false,
    notifyHints: false,
  };
}

/** A room inside a space. */
export function roomAsRoomInfo(room: Room, spaceId: string, members: string[]): RoomInfo {
  return {
    id: room.id,
    kind: 'space',
    space: spaceId,
    group: null,
    members,
    streamPaging: room.streamPaging ?? false,
    notifyHints: false,
  };
}

/**
 * Who is in this conversation, as faces, in the order they were added.
 *
 * **Never de-duplicated by account.** Two faces of one system are two people
 * here, because `docs/11` says each face appears as an independent person while
 * linking is off — and linking is off by default.
 */
export function dmFaces(dm: Dm, faces: Record<string, Face>, myFaceId?: string): Face[] {
  return dm.withIds
    .filter((id) => id !== myFaceId)
    .map((id) => faces[id])
    .filter((f): f is Face => !!f);
}

/**
 * What to call a conversation nobody named.
 *
 * By face. A title that collapsed two faces into one name would be announcing
 * to everybody in the room that those two faces are the same person — which is
 * exactly the disclosure `docs/11`'s linking control exists to prevent, made by
 * the client instead of by the person it is about.
 */
export function dmTitleOf(people: { name: string }[]): string {
  const names = people.map((f) => f.name);
  if (names.length === 0) return 'Just you';
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
