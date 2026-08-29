/**
 * Touch equivalents for the two things a mouse has and a finger doesn't:
 * a right button, and a hover state.
 *
 * `docs/24`: "Long-press opens the context menu, since touch has no
 * right-click. Tap toggles the action bar." Both of those are load-bearing
 * rather than nice-to-have — every context menu in this app is bound to
 * `contextmenu`, which a phone never fires, so without a long-press the room
 * menu, the space menu, the DM menu, the member menu and the message menu are
 * all simply unreachable on the primary surface.
 */

/** How long a press has to last before it counts as a long one. Exported so
    that a tap detector on the same element can tell the two apart rather than
    guessing at a second, slightly different number. */
export const HOLD = 480;
/** Movement that turns a press into a scroll or a swipe instead. */
const SLOP = 10;
/** A click fired this soon after a long-press is the press's own, not a tap. */
const CLICK_GUARD = 700;

/**
 * `use:longpress={handler}` — fires once, at the point of the press.
 *
 * The handler is given the original `pointerdown`, which is a `MouseEvent`, so
 * it drops straight into the same `contextMenu.open(e, …)` the right-click
 * handlers use. One menu definition, two ways in.
 *
 * Mouse presses are ignored: a mouse already has `contextmenu`, and a
 * half-second hold on a mouse button is usually someone about to drag.
 */
export function longpress(node: HTMLElement, handler: (e: PointerEvent) => void) {
  let fn = handler;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let start: { x: number; y: number } | null = null;
  let firedAt = 0;

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    start = null;
  };

  const down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    start = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => {
      timer = null;
      if (!start) return;
      firedAt = performance.now();
      // The one bit of haptics in the product, and it earns its place: a
      // long-press has no visual "nearly there", so the buzz is the only
      // confirmation that the hold worked. Absent on iOS, which is survivable.
      navigator.vibrate?.(8);
      fn(e);
    }, HOLD);
  };

  const move = (e: PointerEvent) => {
    if (!start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP) cancel();
  };

  /**
   * A long-press is followed by a click on most touch platforms, and that
   * click would run whatever the element normally does — opening the room you
   * only meant to get a menu for. Swallowing it in the capture phase, before
   * it reaches the element's own handler, is the only place that works.
   */
  const click = (e: MouseEvent) => {
    if (performance.now() - firedAt > CLICK_GUARD) return;
    firedAt = 0;
    e.preventDefault();
    e.stopPropagation();
  };

  // Suppresses iOS's "copy / look up" callout, which otherwise races the
  // long-press and wins. Set here rather than in CSS so that anything using
  // this action gets it without having to remember.
  node.style.setProperty('-webkit-touch-callout', 'none');

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', cancel);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('click', click, true);

  return {
    update(next: (e: PointerEvent) => void) {
      fn = next;
    },
    destroy() {
      cancel();
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', cancel);
      node.removeEventListener('pointercancel', cancel);
      node.removeEventListener('click', click, true);
    },
  };
}

/**
 * Which message row is showing its action bar.
 *
 * On a fine pointer the bar appears on hover and no state is needed. A finger
 * has no hover, so `docs/24` gives it a tap — and one shared id rather than a
 * flag per row is what makes tapping a second message put the first one away.
 */
class TapActions {
  id = $state<string | null>(null);

  toggle(id: string) {
    this.id = this.id === id ? null : id;
  }
  clear() {
    this.id = null;
  }
}

export const tapActions = new TapActions();
