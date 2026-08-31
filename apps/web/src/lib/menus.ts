/**
 * The item lists for every context menu in the shell.
 *
 * Separated from the markup because these are mostly *copy* — labels, order,
 * which action is destructive — and copy belongs somewhere it can be read in
 * one screen rather than scattered across three components' templates. The
 * handlers stay with the state they mutate; these functions only describe.
 */

import type { NotifyLevel, Room, Space } from './fake/data.js';
import type { Item } from './menu.js';

/** Rows for choosing a room's notification level, ticked to show the current
    one and where it came from.

    Used by the room menu only. The space menu has a single "Notification
    defaults" item that opens the settings screen instead — a space's default is
    a thing you set once, and a context menu is for the thing in front of you.
    (This said "shared by the room menu and the space menu", which it never
    was.) */
function notifyRows(current: NotifyLevel, inherited: boolean, prefix: string): Item[] {
  return [
    {
      id: `${prefix}:inherit`,
      label: 'Use the space default',
      header: 'Notifications',
      checked: inherited,
    },
    {
      id: `${prefix}:everything`,
      label: 'Everything',
      checked: !inherited && current === 'everything',
    },
    { id: `${prefix}:mentions`, label: 'Mentions', checked: !inherited && current === 'mentions' },
    { id: `${prefix}:nothing`, label: 'Nothing', checked: !inherited && current === 'nothing' },
  ];
}

export function roomMenu(
  room: Room,
  resolved: { level: NotifyLevel; from: 'room' | 'space' | 'global' },
): Item[] {
  return [
    ...notifyRows(resolved.level, resolved.from !== 'room', 'notify'),
    {
      id: 'mark-read',
      label: 'Mark as read',
      icon: 'check',
      header: 'Room',
      disabled: !room.unread,
    },
    { id: 'room-settings', label: 'Room settings', icon: 'gear' },
    { id: 'copy-link', label: 'Copy link', icon: 'link' },
    { id: 'leave-room', label: 'Leave room', icon: 'door', danger: true },
  ];
}

export function spaceMenu(space: Space): Item[] {
  return [
    { id: 'space-settings', label: 'Space settings', icon: 'gear', key: '⌘,' },
    { id: 'invite', label: 'Invite people', icon: 'user' },
    { id: 'create-room', label: 'Create a room', icon: 'plus' },
    { id: 'space-notify', label: 'Notification defaults', icon: 'bell' },
    { id: 'server-sees', label: `What the server can see`, icon: 'eye' },
    { id: 'leave-space', label: `Leave ${space.name}`, icon: 'door', danger: true },
  ];
}

/**
 * A member row. The agent case is deliberately different: the useful actions
 * for software are "what is it" and "who runs it", not "message them".
 */
export function memberMenu(opts: { name: string; isAgent: boolean; isMe: boolean }): Item[] {
  const rows: Item[] = [{ id: 'profile', label: 'View profile', icon: 'user' }];
  if (!opts.isMe) {
    rows.push(
      opts.isAgent
        ? { id: 'agent-info', label: 'What this agent can read', icon: 'eye' }
        : { id: 'dm', label: `Message ${opts.name}`, icon: 'send' },
    );
  }
  rows.push({ id: 'copy-handle', label: 'Copy address', icon: 'copy' });
  if (!opts.isMe && !opts.isAgent) {
    rows.push(
      { id: 'verify', label: `Verify ${opts.name}`, icon: 'shield' },
      { id: 'block', label: `Block ${opts.name}`, icon: 'x', danger: true },
    );
  }
  return rows;
}
