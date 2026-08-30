/**
 * The two drawers, and the finger that moves them.
 *
 * `docs/24`: on a phone the app is one column with a drawer either side —
 * navigation on the left (rail and rooms merged, because two nested drawers is
 * a maze), members on the right. Kith's finger-tracking carries over: the panel
 * follows your thumb 1:1, axis-locks in the first ~10px so a vertical scroll
 * still wins, and commits past the halfway point on release.
 *
 * ## One axis, not two booleans
 *
 * Position is a single number in [-1, 1]: +1 is navigation fully open, -1 is
 * members fully open, 0 is closed. Two booleans would let both drawers be open
 * at once, which is meaningless on a 390px screen — a track with three stops
 * makes that unrepresentable rather than merely forbidden, and it makes the
 * gesture arithmetic fall out for free.
 *
 * ## Why opening is edge-only
 *
 * `docs/24` also wants swipe-right-on-a-message-to-reply. A drawer that opened
 * on a swipe anywhere would eat every one of those gestures. So opening is a
 * drag from within `EDGE` px of the screen edge — the convention both phone
 * platforms already teach — and everything inboard of that belongs to whatever
 * it started on. Once a drawer *is* open, a drag anywhere closes it, because
 * then there is nothing underneath to compete with.
 */

/** How close to the screen edge a drag must start to open a drawer. */
const EDGE = 26;
/** Movement before the gesture commits to an axis. Below this we do not know
    whether this is a swipe or the start of a scroll, so we do nothing. */
const LOCK = 10;
/** px/ms past which the throw's direction beats its position. A short fast
    flick should open the drawer even though it never crossed halfway. */
const FLICK = 0.45;

type Side = 'nav' | 'members';

class Drawers {
  /** +1 nav open · 0 closed · −1 members open, and every fraction between. */
  x = $state(0);
  /** A finger is on it. The panel must not also be running its own settle
      transition while it is being dragged, or it lags behind the thumb. */
  dragging = $state(false);

  /** Measured from the DOM rather than hardcoded, so the CSS stays the single
      source of truth for how wide a drawer is. */
  private width = { nav: 320, members: 280 };

  // Live gesture. Null between gestures.
  private g: {
    id: number;
    x0: number;
    y0: number;
    t0: number;
    from: number;
    lo: number;
    hi: number;
    axis: null | 'x' | 'y';
  } | null = null;

  get nav() {
    return Math.max(0, this.x);
  }
  get members() {
    return Math.max(0, -this.x);
  }
  get open() {
    return this.x !== 0;
  }

  setWidth(side: Side, px: number) {
    if (px > 0) this.width[side] = px;
  }

  open_(side: Side) {
    this.x = side === 'nav' ? 1 : -1;
  }
  toggle(side: Side) {
    const want = side === 'nav' ? 1 : -1;
    this.x = this.x === want ? 0 : want;
  }
  close() {
    this.x = 0;
  }

  // ── gesture ──────────────────────────────────────────────────────────────

  down(e: PointerEvent) {
    // A mouse gets the buttons. Dragging with one would fight text selection,
    // and nobody swipes a trackpad expecting a drawer.
    if (e.pointerType === 'mouse') return;
    const el = e.target instanceof Element ? e.target : null;
    // An opt-out for anything that owns horizontal drags of its own — the
    // audio scrubber, a carousel.
    if (el?.closest('[data-no-swipe]')) return;
    // A modal owns the screen while it is up, including the screen edges.
    // Every overlay in the app announces itself with one of these two roles,
    // which is what makes one query enough.
    if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;

    const fromEdge = e.clientX <= EDGE || e.clientX >= window.innerWidth - EDGE;
    if (!this.open && !fromEdge) return;

    // Which way this drag is allowed to travel. Fixed at `down` so a wobble
    // mid-drag can't slide from one drawer straight into the other.
    let lo = -1;
    let hi = 1;
    if (this.x > 0) lo = 0;
    else if (this.x < 0) hi = 0;
    else if (e.clientX <= EDGE) lo = 0;
    else hi = 0;

    this.g = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      t0: performance.now(),
      from: this.x,
      lo,
      hi,
      axis: null,
    };
  }

  move(e: PointerEvent) {
    const g = this.g;
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;

    if (g.axis === null) {
      if (Math.hypot(dx, dy) < LOCK) return;
      // Ties go to the scroll. Reading is the common case and a drawer that
      // steals a slightly-diagonal scroll is infuriating.
      g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (g.axis === 'y') {
        this.g = null;
        return;
      }
      this.dragging = true;
      try {
        // Keeps the drag alive if the thumb leaves the element it started on,
        // which it will — the panel moves out from under it. Throws if the
        // pointer went away between the move and here, which is not an error
        // worth breaking the gesture over.
        (e.target as Element).setPointerCapture?.(g.id);
      } catch {
        /* pointer already gone; `up` still resolves it */
      }
    }

    // 1:1 with the thumb, in units of this drawer's own width.
    const w = (g.hi === 0 ? this.width.members : this.width.nav) || 1;
    this.x = Math.min(g.hi, Math.max(g.lo, g.from + dx / w));
    e.preventDefault();
  }

  up(e: PointerEvent) {
    const g = this.g;
    if (g && e.pointerId !== g.id) return;
    this.g = null;
    this.dragging = false;
    if (!g || g.axis !== 'x' || this.x === 0) return;

    const dx = e.clientX - g.x0;
    const v = dx / Math.max(1, performance.now() - g.t0);
    const side = this.x > 0 ? 1 : -1;
    // Travelling *towards* the open end means opening, whichever drawer it is:
    // right opens the left drawer, left opens the right one.
    const opening = Math.sign(dx) === side;
    const commit = Math.abs(v) > FLICK ? opening : Math.abs(this.x) > 0.5;
    this.x = commit ? side : 0;
  }

  cancel() {
    const g = this.g;
    if (!g) return;
    this.g = null;
    this.dragging = false;
    // A cancelled pointer (an incoming phone call, a system edge gesture) is
    // not a decision, so return to where the drag started rather than
    // committing to whatever fraction it happened to have reached.
    this.x = g.from;
  }
}

export const drawers = new Drawers();
