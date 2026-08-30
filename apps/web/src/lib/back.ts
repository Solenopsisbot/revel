/**
 * The back button, and where you have been.
 *
 * `docs/24` writes the back behaviour out as a table and says why: the classic
 * web-app failure — back exiting the app from three levels deep — is the single
 * fastest way to feel broken. So this is a real state machine rather than
 * whatever the router happens to do.
 *
 * ## How it talks to browser history
 *
 * The app is one route, so there is nothing here for the router to do. Instead
 * we keep the number of history entries *we own* equal to the number of
 * dismissible layers on screen, and stamp the count onto each entry as
 * `state.revel`. That stamp is the whole trick: **the browser's own history is
 * the source of truth for how deep we are**, so nothing has to be counted on
 * this side and nothing can drift out of step with it.
 *
 * Which matters, because `history.go(-2)` fires *one* popstate, not two. Any
 * scheme that counts the events it expects to see gets it wrong the first time
 * two layers close together, and then swallows a real back press later — a bug
 * that would look like "sometimes back does nothing".
 *
 * Three things happen:
 *
 * - a layer opens → push an entry, so there is something for back to consume
 * - back is pressed → the entry we land on has a smaller stamp than the number
 *   of layers, so it is a real press: dismiss one layer, then re-stamp
 * - a layer is dismissed some other way (Escape, tapping the scrim) → the
 *   stamp is now too big, so rewind to the right entry; the popstate that
 *   lands has a stamp equal to the layer count, which is how we know it was
 *   ours and not a press
 *
 * Entries carry SvelteKit's own history state forward unchanged. Ours is an
 * extra field on it, not a replacement — clobbering `sveltekit:index` would
 * break the router's idea of which direction a navigation went.
 */
import { tick } from 'svelte';

/** Somewhere you have been. Home is `scope: 'home'` and has no space. */
export interface Loc {
  scope: 'home' | 'space';
  spaceId: string;
  roomId: string;
}

/** Enough to walk back through a session; more is just memory. */
const TRAIL_MAX = 40;

/** How many layers deep the given history entry was pushed at. */
function depthOf(state: unknown): number {
  const d = (state as { revel?: unknown } | null)?.revel;
  return typeof d === 'number' ? d : 0;
}

class Back {
  /**
   * Oldest first, most recent last. The last entry is where you are now.
   *
   * Deliberately *not* `$state`: nothing renders the trail, and an effect that
   * both records into it and reads it to de-duplicate would be tracking its
   * own write. Plain data means that question never comes up.
   */
  private trail: Loc[] = [];

  /** A rewind we asked for and are waiting to land. Blocks a second one. */
  private rewinding = false;

  /** Where you are now, for callers that would rather not index. */
  get here(): Loc | undefined {
    return this.trail[this.trail.length - 1];
  }

  /**
   * Note a location change. Consecutive duplicates are dropped so that
   * re-rendering, or opening the room you are already in, doesn't stack up
   * entries that back would then have to walk through one by one.
   */
  record(loc: Loc) {
    const last = this.here;
    if (
      last &&
      last.scope === loc.scope &&
      last.spaceId === loc.spaceId &&
      last.roomId === loc.roomId
    ) {
      return;
    }
    this.trail = [...this.trail, loc].slice(-TRAIL_MAX);
  }

  /**
   * The most recent place you were that `match` accepts, with everything after
   * it forgotten — because going back to it makes it the present, and leaving
   * the newer entries in place would make the next back press retrace the way
   * you just came.
   */
  popTo(match: (l: Loc) => boolean): Loc | undefined {
    for (let i = this.trail.length - 2; i >= 0; i--) {
      const l = this.trail[i]!;
      if (!match(l)) continue;
      this.trail = this.trail.slice(0, i + 1);
      return l;
    }
    return undefined;
  }

  /**
   * Keep browser history in step with how many layers are open.
   *
   * @param layers how many dismissible things are on screen right now
   */
  sync(layers: number) {
    if (typeof history === 'undefined') return;
    // A rewind is in flight and `history.state` is still the old entry, so any
    // decision made from it now would be made on stale information. The
    // popstate that lands re-runs this.
    if (this.rewinding) return;

    const depth = depthOf(history.state);
    if (layers > depth) {
      for (let i = depth; i < layers; i++) {
        history.pushState({ ...history.state, revel: i + 1 }, '');
      }
    } else if (layers < depth) {
      this.rewinding = true;
      history.go(layers - depth);
    }
  }

  /**
   * Listen for back.
   *
   * `pop` undoes exactly one layer; `count` reports how many there are. Both
   * are needed, and the second one is the subtle part: undoing a layer does not
   * always change the *count*. Back out of a room into the room list and there
   * is still exactly one layer — a different one. Waiting to be told the count
   * changed would leave us an entry short every time that happens, and an entry
   * short means the next back press leaves the app.
   *
   * Returns a teardown.
   */
  attach(count: () => number, pop: () => void) {
    if (typeof window === 'undefined') return () => {};

    const on = (e: PopStateEvent) => {
      const landed = depthOf(e.state);
      if (this.rewinding) {
        this.rewinding = false;
        // Re-check rather than assume: the layer count may have moved again
        // while the traversal was in flight.
        tick().then(() => this.sync(count()));
        return;
      }
      // Landing at or above the current layer count means this entry still has
      // everything on screen accounted for — nothing to dismiss.
      if (landed >= count()) return;
      pop();
      // After the framework has applied whatever `pop` changed, not before.
      tick().then(() => this.sync(count()));
    };

    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }
}

export const back = new Back();
