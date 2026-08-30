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
import { core } from './core.svelte.js';
import { dmAsRoomInfo, dmFaces, dmTitleOf, roomAsRoomInfo } from './directoryShape.js';

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

  /**
   * Who is in a conversation, as faces. Never collapsed by account.
   *
   * `docs/11`: with linking off — the default — each face is an independent
   * person and nothing in the UI connects them.
   */
  people(roomId: string) {
    const dm = core.dms.find((d) => d.id === roomId);
    return dm ? dmFaces(dm, core.faces, core.speakingAs) : [];
  },

  /** What to call a conversation nobody named. By face, for the same reason. */
  title(roomId: string): string {
    const dm = core.dms.find((d) => d.id === roomId);
    return dm?.name ?? dmTitleOf(dm ? dmFaces(dm, core.faces, core.speakingAs) : []);
  },
};
