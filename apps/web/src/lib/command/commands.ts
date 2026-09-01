/**
 * Everything the command surface can do.
 *
 * `docs/12` is explicit that the ⌘K palette and "asking Wren" are the *same
 * surface* — one input taking both fuzzy commands and plain phrasing. It is
 * also explicit about the rule that keeps it honest: **she uses the same code
 * paths the UI uses.** Every `run` below calls a public `core`, `theme` or
 * `voice` method, or opens a screen you could have clicked to. There is no
 * command here that does something you cannot do by hand.
 *
 * The five groups are the doc's: navigate, create, configure, security, and
 * explain — the last being the interesting one, because "what can the server
 * actually see here?" is a question nobody answers well and we can answer it
 * from the room's real configuration.
 */
import { core, MY_ACCOUNT } from '../fake/core.svelte.js';
import { directory } from '../fake/directory.svelte.js';

/** Named by the faces in it, never collapsed by account (`docs/11`). */
const titleOf = (roomId: string) => directory.title(roomId);

import { search } from '../search/search.svelte.js';
import { SECTIONS } from '../settings/sections.js';
import { THEMES, theme } from '../theme.svelte.js';
import { voice } from '../voice/voice.svelte.js';
import { wren } from '../wren/wren.svelte.js';

export type Group = 'Go to' | 'Create' | 'Configure' | 'Security' | 'Explain';

export interface Command {
  id: string;
  label: string;
  /** Right-aligned context: which space a room is in, what a setting does. */
  hint?: string;
  icon?: string;
  group: Group;
  /** Extra words to match on that aren't in the label — so "server" finds the
      explainer even though the label says what it says. */
  keywords?: string;
  /**
   * Returns a string to *show in the palette* rather than closing it. That is
   * how Explain works: an answer is a result, not a destination.
   */
  run: () => string | void;
}

/** Context the palette needs but doesn't own. */
export interface Ctx {
  openSettings: (section: string) => void;
  openSpaceSettings: (tab?: string) => void;
  openRoomSettings: (roomId: string) => void;
}

/**
 * The generated "what can the server see" answer (`docs/12`).
 *
 * Built from the room's actual configuration every time it is asked, never
 * canned — a hardcoded reassurance that silently stops matching reality is
 * worse than none at all.
 */
export function whatTheServerSees(): string {
  const room = core.room;
  // Everything in the room, thread replies included — the server counted
  // those too, and this answer is generated to be exactly true.
  const count = core.everythingInRoom.length;
  const agents = core.roster.filter((f) => f.agent);
  const parts: string[] = [];

  parts.push(
    `That #${room.name} exists, who is in it, and that ${count} ${count === 1 ? 'message has' : 'messages have'} been sent — with their sizes and the times they arrived. Not a word of what any of them say, including the room's name and topic, which are encrypted too.`,
  );

  if (room.audience.kind === 'everyone') {
    parts.push('Everyone in this space holds the keys here.');
  } else if (room.audience.kind === 'roles') {
    // By name. An audience is stored as role *ids* — the Host has never been
    // told the names (`docs/04` §1) — and a sentence explaining who holds the
    // keys is the last place to print a snowflake at somebody.
    const named = room.audience.roles.map(
      (ref) => core.space.roles.find((r) => r.id === ref || r.name === ref)?.name ?? ref,
    );
    parts.push(
      `Only people with ${named.join(' or ')} hold the keys here, so the group is smaller than the space.`,
    );
  } else {
    parts.push(
      `Only the ${room.audience.faceIds.length} people picked for this room hold the keys.`,
    );
  }

  if (agents.length) {
    parts.push(
      `${agents.map((a) => a.name).join(' and ')} ${agents.length === 1 ? 'can' : 'can'} read everything in here, and ${agents.length === 1 ? 'is' : 'are'} in the member list.`,
    );
  }

  if (room.kind === 'voice') {
    parts.push(
      'Audio frames are encrypted with a key from the same group, so the media server forwards packets it cannot decode.',
    );
  }

  return parts.join('\n\n');
}

export function buildCommands(ctx: Ctx): Command[] {
  const out: Command[] = [];

  // --- navigate -------------------------------------------------------------
  for (const space of core.spaces) {
    for (const room of space.rooms) {
      out.push({
        id: `room:${space.id}:${room.id}`,
        label: `${room.kind === 'voice' ? '' : '#'}${room.name}`,
        hint: space.name,
        icon: room.kind === 'voice' ? 'voice' : 'hash',
        group: 'Go to',
        keywords: `${space.name} room channel ${room.topic ?? ''}`,
        run: () => void core.openRoom(space.id, room.id),
      });
    }
    out.push({
      id: `space:${space.id}`,
      label: space.name,
      hint: 'Space',
      icon: 'grid',
      group: 'Go to',
      keywords: 'server community space',
      // Empty id for a space with no rooms you can see. `rooms[0]!` crashes,
      // and a space genuinely can be empty — the last room can be deleted, and
      // a room whose audience you do not match is one you never learn exists.
      run: () => void core.openRoom(space.id, space.rooms[0]?.id ?? ''),
    });
  }

  for (const dm of core.dms) {
    out.push({
      id: `dm:${dm.id}`,
      label: dm.name ?? titleOf(dm.id),
      hint: dm.kind === 'group' ? 'Group' : 'Direct message',
      icon: 'send',
      group: 'Go to',
      keywords: 'dm direct message conversation chat',
      run: () => void core.openHome(dm.id),
    });
  }

  for (const face of core.roster) {
    out.push({
      id: `face:${face.id}`,
      label: face.name,
      hint: face.agent ? face.agent.label : 'In this room',
      icon: 'user',
      group: 'Go to',
      keywords: 'profile person member',
      run: () => void (core.profileFor = face.id),
    });
  }

  // Anyone you share a room with is someone you can start a conversation
  // with. Agents are excluded: you talk to an agent in the room it is in.
  const dmTargets = new Set<string>();
  for (const space of core.spaces) {
    for (const room of space.rooms) {
      for (const id of core.rosterFor(room.id)) dmTargets.add(id);
    }
  }
  for (const id of dmTargets) {
    const face = core.faces[id];
    if (!face || face.agent || face.accountId === MY_ACCOUNT) continue;
    out.push({
      id: `message:${id}`,
      label: `Message ${face.name}`,
      icon: 'send',
      group: 'Create',
      keywords: 'dm direct new conversation start',
      run: () => void core.openDm(id),
    });
  }

  for (const s of SECTIONS) {
    out.push({
      id: `settings:${s.id}`,
      label: s.name,
      hint: 'Settings',
      icon: 'gear',
      group: 'Go to',
      keywords: s.blurb,
      run: () => ctx.openSettings(s.id),
    });
  }

  // --- create ---------------------------------------------------------------
  out.push(
    {
      id: 'create-room',
      label: 'Create a room',
      hint: core.space.name,
      icon: 'plus',
      group: 'Create',
      keywords: 'new channel add',
      run: () => ctx.openSpaceSettings('rooms'),
    },
    {
      id: 'create-invite',
      label: 'Create an invite link',
      icon: 'link',
      group: 'Create',
      keywords: 'share join',
      run: () => ctx.openSpaceSettings('invites'),
    },
    {
      id: 'create-face',
      label: 'Add a face',
      icon: 'user',
      group: 'Create',
      keywords: 'plural system identity',
      run: () => ctx.openSettings('faces'),
    },
  );

  // --- configure ------------------------------------------------------------
  for (const t of THEMES) {
    out.push({
      id: `theme:${t.id}`,
      label: `Theme: ${t.name}`,
      hint: t.hint,
      icon: 'palette',
      group: 'Configure',
      keywords: 'appearance colour dark light',
      run: () => void theme.set('theme', t.id),
    });
  }
  out.push(
    {
      id: 'space-settings',
      label: `${core.space.name} settings`,
      icon: 'gear',
      group: 'Configure',
      keywords: 'server space manage rooms roles',
      run: () => ctx.openSpaceSettings(),
    },
    {
      id: 'room-settings',
      label: `#${core.room.name} settings`,
      icon: 'gear',
      group: 'Configure',
      keywords: 'channel rename topic audience',
      run: () => ctx.openRoomSettings(core.currentRoomId),
    },
    {
      id: 'mute-room',
      label: `Mute #${core.room.name}`,
      icon: 'bell-off',
      group: 'Configure',
      keywords: 'notifications quiet silence',
      run: () => void core.setRoomNotify(core.currentSpaceId, core.currentRoomId, 'nothing'),
    },
    {
      id: 'translate-room',
      label: `Translate #${core.room.name}`,
      icon: 'globe',
      group: 'Configure',
      keywords: 'language on-device',
      run: () => ctx.openSettings('language'),
    },
    {
      id: 'wren-quiet',
      label: 'Turn Wren down to Quiet',
      icon: 'bell-off',
      group: 'Configure',
      keywords: 'notices interruptions',
      run: () => void wren.setVolume('quiet'),
    },
  );

  // A call in the DM you're looking at. It rings rather than being a place
  // you walk into, so it is a distinct verb from joining a voice room.
  if (core.scope === 'home' && core.dm) {
    out.push({
      id: 'call-dm',
      label: `Call ${core.dm.name ?? core.dmTitle(core.dm)}`,
      icon: 'voice',
      group: 'Configure',
      keywords: 'ring phone voice dm',
      run: () => voice.startCall(core.dm!.id),
    });
  }

  // Voice rooms you can drop into.
  for (const space of core.spaces) {
    for (const room of space.rooms.filter((r) => r.kind === 'voice')) {
      const here = voice.roomId === room.id;
      out.push({
        id: `join:${room.id}`,
        label: here ? `Leave ${room.name}` : `Join ${room.name}`,
        hint: space.name,
        icon: here ? 'hangup' : 'voice',
        group: 'Configure',
        keywords: 'call vc voice audio',
        run: () => (here ? voice.leave() : voice.join(space.id, room.id)),
      });
    }
  }

  out.push({
    id: 'search',
    label: 'Search messages',
    hint: '⌘F',
    icon: 'search',
    group: 'Go to',
    keywords: 'find grep look for',
    run: () => search.show(),
  });

  // Not a debug hatch that shipped by accident: the offline path is most of
  // what `docs/24` is about, and a state you can only reach by turning off
  // wifi at the right moment is a state nobody reviews. It says "simulated".
  out.push({
    id: 'toggle-connection',
    label: core.connection === 'online' ? 'Go offline (simulated)' : 'Come back online (simulated)',
    hint: 'pending messages go out on reconnect',
    icon: core.connection === 'online' ? 'eye-off' : 'globe',
    group: 'Configure',
    keywords: 'network connection offline outbox pending retry',
    run: () => core.setConnection(core.connection === 'online' ? 'offline' : 'online'),
  });

  // --- security -------------------------------------------------------------
  out.push(
    {
      id: 'recovery-code',
      label: 'Show my recovery code',
      icon: 'key',
      group: 'Security',
      keywords: 'backup forgot password',
      run: () => ctx.openSettings('account'),
    },
    {
      id: 'add-device',
      label: 'Add a device',
      icon: 'shield',
      group: 'Security',
      keywords: 'enrol pair phone',
      run: () => ctx.openSettings('devices'),
    },
    {
      id: 'devices',
      label: 'Show device fingerprints',
      icon: 'shield',
      group: 'Security',
      keywords: 'verify keys safety numbers',
      run: () => ctx.openSettings('devices'),
    },
  );

  // --- explain --------------------------------------------------------------
  out.push({
    id: 'explain-server',
    label: `What can the server see about #${core.room.name}?`,
    icon: 'eye',
    group: 'Explain',
    keywords: 'privacy metadata leak knows plaintext encrypted server',
    run: () => whatTheServerSees(),
  });
  out.push({
    id: 'explain-audience',
    label: `Who holds the keys to #${core.room.name}?`,
    icon: 'lock',
    group: 'Explain',
    keywords: 'audience encryption group members read',
    run: () => {
      const a = core.room.audience;
      const names = core.roster.map((f) => f.name).join(', ');
      const who =
        a.kind === 'everyone'
          ? 'Everyone in this space.'
          : a.kind === 'roles'
            ? `People with ${a.roles.join(' or ')}.`
            : 'Only the people picked for this room.';
      return `${who}\n\nIn this room right now: ${names}.\n\nThat list is the lock itself. Who can post or pin are rules this space enforces — this one is who can decrypt.`;
    },
  });

  return out;
}

/**
 * Subsequence match with a light score. Deliberately not a fuzzy library: the
 * candidate list is small, and the behaviour people want from a palette is
 * "the thing I typed the start of", which prefix-and-word-boundary weighting
 * gets right more often than edit distance does.
 */
export function score(cmd: Command, q: string): number {
  if (!q) return 0;
  const query = q.toLowerCase();
  const label = cmd.label.toLowerCase();
  const hay = `${label} ${cmd.hint ?? ''} ${cmd.keywords ?? ''} ${cmd.group}`.toLowerCase();

  if (label.startsWith(query)) return 1000 - label.length;
  if (label.includes(query)) return 700 - label.indexOf(query);
  if (hay.includes(query)) return 400;

  // Subsequence over the label, so "crv" finds "crypto-review".
  let i = 0;
  for (const ch of label) {
    if (ch === query[i]) i++;
    if (i === query.length) return 200 - label.length;
  }
  return -1;
}
