/**
 * The shape of one row in an overflow menu.
 *
 * Lives outside `Menu.svelte` because the callers build their item lists in
 * their own `$derived` blocks — a message row's menu depends on whether the
 * message is yours, whether it is pinned, and whether the room is read-only —
 * and they need the type without importing the component.
 */
export type Item = {
  /** Returned to `onpick`. Stable across renders; used as the keyed each. */
  id: string;
  label: string;
  /** A drawn icon name from `Icon.svelte`. Menus read fine without one. */
  icon?: string;
  /**
   * The keyboard equivalent, shown right-aligned. A menu that hides its own
   * shortcuts trains people to keep using the menu, so set this wherever the
   * action actually has a binding.
   */
  key?: string;
  /**
   * Destructive. Sorted below a rule and drawn in rose. Deliberately a flag
   * rather than a separate list, so callers can build one flat array.
   */
  danger?: boolean;
  /** Shown, but not pickable — an absent row is harder to reason about than a
      greyed one when you are looking for an action you know exists. */
  disabled?: boolean;
};
