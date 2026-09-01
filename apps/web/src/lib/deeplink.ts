import { replaceState } from '$app/navigation';
/**
 * Every meaningful thing has a URL (`docs/19` §The web app).
 *
 * "Links are shareable, the back button works, and refreshing lands you where
 * you were." Before this, none of those were true: location lived entirely in
 * `core` as plain state seeded to one room, so a refresh always dumped you
 * back in #design and a link to a conversation was not a thing that existed.
 *
 * ## Replace, never push
 *
 * The one decision worth defending. Changing room updates the URL with
 * `replaceState`, so it adds no history entry.
 *
 * That is not laziness, it is the back table from `docs/24`: back from a room
 * opens the room list, and from there it goes up to the previous *space*. If
 * every room change also pushed an entry, back would instead retrace every
 * room you had looked at, and the two systems would be fighting over the same
 * button. `back.ts` owns history; this owns the address bar.
 *
 * The corollary is that `history.state` must be carried through every
 * `replaceState` untouched — the layer-depth stamp `back.ts` keeps there is
 * what stops back from silently doing nothing, and clobbering it would break
 * the ladder in a way that only shows up two presses later.
 *
 * ## Query parameters rather than paths
 *
 * `/app?space=solexsis&room=design` rather than `/app/solexsis/design`. Paths
 * would be prettier and are what a shipped product should have; this matches
 * the `?settings=`, `?theme=` and `?onboarding=` conventions already here,
 * needs no routing, and swapping later is a routing change rather than a state
 * change.
 */
import { core } from './fake/core.svelte.js';

export interface Location {
  scope: 'home' | 'space';
  spaceId: string;
  roomId: string;
  /** Only while a sheet is open — a settings pane is a place too. */
  settings?: string;
}

/**
 * Point the app at what a URL describes.
 *
 * Returns the message id the link asked for, if any, so the caller can decide
 * what to do when it isn't here yet — which is a real case and not an error
 * (`docs/19`: "opening a message link you can't decrypt yet shows the catching
 * up on keys banner").
 */
export function applyUrl(url: URL): { message?: string } {
  const q = url.searchParams;
  const dm = q.get('dm');
  const spaceId = q.get('space');
  const roomId = q.get('room');

  if (dm && core.dms.some((d) => d.id === dm)) {
    core.openHome(dm);
  } else if (spaceId && roomId) {
    const space = core.spaces.find((s) => s.id === spaceId);
    const room = space?.rooms.find((r) => r.id === roomId);
    // A room that isn't there is a link to somewhere you can't go — land on
    // the space if we know it and leave the rest to the banner.
    // `rooms[0]` may not exist: a space can have no rooms you can see, and
    // landing on it with nothing open is a truer answer than a crash.
    if (space) core.openRoom(space.id, room?.id ?? space.rooms[0]?.id ?? '');
  }

  const message = q.get('m') ?? undefined;
  return message ? { message } : {};
}

/** The parameters this module owns. Everything else in the URL is not ours. */
const OWNED = ['space', 'room', 'dm', 'm', 'settings'];

/**
 * The address for where the app is now.
 *
 * Built by editing the current query rather than replacing it, because the
 * review affordances live there too — `?theme=`, `?touch=1`, `?platform=ios`,
 * `?indexing=slow`, `?onboarding=1`. Rebuilding from scratch would strip them
 * on the first render, and the first thing anyone reviewing a surface does is
 * refresh it.
 *
 * `m` is deliberately dropped: a message id is something you create a link
 * *with*, not something the address bar should carry around afterwards, or
 * every link copied out of it points at whichever message you last landed on.
 */
export function urlFor(loc: Location): string {
  const q = new URLSearchParams(location.search);
  for (const k of OWNED) q.delete(k);
  // Only write what there is. A signed-in account has no spaces and often no
  // room open yet, and writing the ids anyway put `?space=solexsis&room=design`
  // in the address bar of somebody who had never seen either — a fixture id,
  // in a URL, ready to be copied and shared.
  if (loc.scope === 'home') {
    if (loc.roomId) q.set('dm', loc.roomId);
  } else if (loc.spaceId) {
    q.set('space', loc.spaceId);
    if (loc.roomId) q.set('room', loc.roomId);
  }
  if (loc.settings) q.set('settings', loc.settings);
  return `${location.pathname}?${q}`;
}

/** An absolute, shareable link to one message. */
export function linkToMessage(roomId: string, messageId: string): string {
  const q = new URLSearchParams();
  const space = core.spaces.find((s) => s.rooms.some((r) => r.id === roomId));
  if (space) {
    q.set('space', space.id);
    q.set('room', roomId);
  } else {
    q.set('dm', roomId);
  }
  q.set('m', messageId);
  return `${location.origin}${location.pathname}?${q}`;
}

/**
 * Write the address bar without touching history depth or the entry stack.
 *
 * `history.state` is passed straight back through: `back.ts` keeps the layer
 * count there and this must not be the thing that loses it.
 */
export function syncUrl(loc: Location) {
  if (typeof history === 'undefined') return;
  const next = urlFor(loc);
  if (location.pathname + location.search === next) return;
  // SvelteKit's `replaceState`, not the browser's. SvelteKit 2 owns the
  // history entry — calling `history.replaceState` directly is ignored with a
  // warning, which is why closing settings cleared the state, re-ran this, and
  // left `?settings=account` in the address bar anyway.
  //
  // `history.state` is passed straight back through: `back.ts` keeps the layer
  // count there and this must not be the thing that loses it.
  replaceState(next, history.state ?? {});
}
