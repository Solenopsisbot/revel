/**
 * The notification menu rows, and the round trip through their ids.
 *
 * These exist because of a rename that `svelte-check` cannot see. The web used
 * to spell the three states `'all' | 'mentions' | 'none'` and the core spells
 * them `'everything' | 'mentions' | 'nothing'`; aligning them meant touching a
 * menu id, the string it is parsed back into, and the comparison that decides
 * which row is ticked — in four files.
 *
 * Every one of those is a **string**, so getting one wrong type-checks
 * perfectly and shows up as a menu that silently stops ticking anything, or a
 * "Mute" that quietly does nothing. That is the whole class of bug this file
 * exists to close: the ids and the levels have to agree, and now something says
 * so.
 */
import { describe, expect, it } from 'vitest';
import type { NotifyLevel } from './fake/data.js';
import { roomMenu, spaceMenu } from './menus.js';

const LEVELS: NotifyLevel[] = ['everything', 'mentions', 'nothing'];

const room = {
  id: 'design',
  name: 'design',
  kind: 'text' as const,
  unread: 0,
} as unknown as Parameters<typeof roomMenu>[0];

/** The `arg` half of a `notify:<arg>` id, which is what the handler switches on. */
function notifyArgs(items: { id: string }[]): string[] {
  return items
    .map((i) => i.id)
    .filter((id) => id.startsWith('notify:') || id.startsWith('space-notify:'))
    .map((id) => id.split(':')[1] as string);
}

describe('the notify rows', () => {
  it('offers exactly the levels the core accepts, plus inherit', () => {
    // The round trip: the handler does `arg as NotifyLevel`, so any id here
    // that is not a level is a cast that lies.
    const args = notifyArgs(roomMenu(room, { level: 'everything', from: 'room' }));
    expect(args.sort()).toEqual(['everything', 'inherit', 'mentions', 'nothing']);
    for (const arg of args) {
      if (arg === 'inherit') continue;
      expect(LEVELS).toContain(arg as NotifyLevel);
    }
  });

  it('ticks the level that is set, for every level', () => {
    // A rename that missed one of these would leave that row permanently
    // unticked, which looks exactly like "the setting did not save".
    for (const level of LEVELS) {
      const items = roomMenu(room, { level, from: 'room' });
      const ticked = items.filter((i) => i.checked).map((i) => i.id);
      expect(ticked).toEqual([`notify:${level}`]);
    }
  });

  it('ticks inherit — and only inherit — when the level came from elsewhere', () => {
    for (const from of ['space', 'global'] as const) {
      const items = roomMenu(room, { level: 'everything', from });
      const ticked = items.filter((i) => i.checked).map((i) => i.id);
      expect(ticked).toEqual(['notify:inherit']);
    }
  });

  it('leaves the space menu pointing at the settings screen', () => {
    // Not an oversight: a space's default is a thing you set once, so the space
    // menu has one item that opens settings rather than four inline rows. The
    // comment on `notifyRows` claimed the two menus shared it, which they never
    // did — asserted here so the claim cannot drift back.
    const space = { id: 'solexsis', name: 'Solexsis' } as unknown as Parameters<
      typeof spaceMenu
    >[0];
    const items = spaceMenu(space);
    expect(items.filter((i) => i.id.startsWith('space-notify:'))).toEqual([]);
    expect(items.map((i) => i.id)).toContain('space-notify');
  });
});
