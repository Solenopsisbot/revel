/**
 * The fake core, wearing the read side of `DirectoryCore`.
 *
 * Thin, like `conversation.svelte.ts`: all the translation is in
 * `directoryShape.ts`, which reaches for nothing and is therefore testable.
 *
 * Spaces are only partly here, and honestly so. `DirectoryCore` describes rooms
 * a Host actually serves; `docs/06` puts spaces, roles and overrides in phase 3
 * and the server has none of it, so a space room maps to a `RoomInfo` with a
 * `space` id and an empty member list rather than pretending to know who is in
 * it. What is real today is DMs and group DMs.
 */
import type { RoomInfo } from '@revel/protocol';
import { core, MY_ACCOUNT } from './core.svelte.js';
import { dmAsRoomInfo, dmTitleOf, roomAsRoomInfo } from './directoryShape.js';

/** The display name for an account, via whichever face is its primary one. */
function nameOfAccount(account: string): string {
  const face = Object.values(core.faces).find((f) => f.accountId === account);
  return face?.name ?? account;
}

export const directory = {
  /** Every DM and group DM, as the directory sees them. */
  dms(): RoomInfo[] {
    return core.dms.map((dm) => dmAsRoomInfo(dm, core.faces));
  },

  /** Rooms in a space. Members are empty: the server has no spaces yet. */
  spaceRooms(spaceId: string): RoomInfo[] {
    const space = core.spaces.find((s) => s.id === spaceId);
    return (space?.rooms ?? []).map((room) => roomAsRoomInfo(room, spaceId, []));
  },

  find(roomId: string): RoomInfo | undefined {
    return (
      this.dms().find((r) => r.id === roomId) ?? this.allSpaceRooms().find((r) => r.id === roomId)
    );
  },

  allSpaceRooms(): RoomInfo[] {
    return core.spaces.flatMap((s) => this.spaceRooms(s.id));
  },

  /** What to call a conversation nobody named. By account, never by face. */
  title(info: RoomInfo): string {
    return dmTitleOf(info, nameOfAccount, MY_ACCOUNT);
  },
};
