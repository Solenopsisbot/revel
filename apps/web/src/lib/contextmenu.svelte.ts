/**
 * One context menu for the whole app.
 *
 * A right-click menu is anchored to a *point*, not to an element, which is the
 * one thing `Popover` deliberately can't do — it measures from a trigger's
 * rect. Rather than teach Popover two positioning modes, this is a separate
 * tiny store with a single `<ContextMenu />` mounted at the app root.
 *
 * One instance also means opening a second menu closes the first for free,
 * which is the behaviour people expect and the thing that goes wrong when
 * every component owns its own.
 */
import type { Item } from './menu.js';

interface Open {
  x: number;
  y: number;
  items: Item[];
  onpick: (id: string) => void;
  /** Shown above the items, so a menu opened by right-click says what it is
      about. A menu with no subject is a menu you have to guess at. */
  title?: string;
}

class ContextMenu {
  current = $state<Open | null>(null);

  /**
   * Open at the pointer. Takes the raw event so callers don't each have to
   * remember `preventDefault` — forgetting it means the browser's own menu
   * appears on top, which looks like a bug and is one.
   */
  open(e: MouseEvent, items: Item[], onpick: (id: string) => void, title?: string) {
    e.preventDefault();
    e.stopPropagation();
    this.current = { x: e.clientX, y: e.clientY, items, onpick, title };
  }

  close() {
    this.current = null;
  }
}

export const contextMenu = new ContextMenu();
