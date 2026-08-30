/**
 * The fixtures' rooms, as `RoomInfo`.
 *
 * The companion to `messageShape.ts`, and it found the same class of thing:
 * translating to the real shape makes a modelling mistake in the fixtures
 * impossible to keep.
 *
 * ## A DM is with a person, not with a face
 *
 * The fixtures key a DM by `withIds` — **face** ids. `docs/11` is explicit that
 * faces are presentations of one account and accounts are the identity, and a
 * DM list keyed by face would give you two conversations with the same person
 * under two of their names, which is exactly the failure that document warns
 * about. `RoomInfo.members` is accounts, so the mapping resolves through the
 * face table and de-duplicates.
 *
 * Reaching for nothing, for the same reason as `messageShape.ts`: this is where
 * a silently dropped field turns into a room with no members and a title that
 * says "someone", and no type checker will ever mention it.
 */
import type { RoomInfo } from '@revel/protocol';
import type { Dm, Face, Room } from './data.js';

/** A DM or group DM, as the directory describes one. */
export function dmAsRoomInfo(dm: Dm, faces: Record<string, Face>): RoomInfo {
  // Through the face table to the accounts behind them, de-duplicated: two
  // faces of one person in one conversation is one member.
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
 * What to call a conversation that nobody named.
 *
 * By account, not by face. Somebody who speaks in a DM as two different faces
 * is one person in it, and a title that listed both would be describing the
 * presentation rather than the conversation.
 */
export function dmTitleOf(
  info: Pick<RoomInfo, 'members'>,
  nameOf: (account: string) => string,
  me: string,
): string {
  const names = info.members.filter((a) => a !== me).map(nameOf);
  if (names.length === 0) return 'Just you';
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
