/**
 * What shape of device is this, and what kind of finger is on it.
 *
 * Two questions that look like one and are not, which is the mistake `docs/24`
 * is explicit about avoiding: **width decides the layout, pointer decides the
 * interactions.** A 1024px tablet gets the desktop three-column layout *and*
 * long-press context menus, because it is wide and it has no right-click. A
 * phone plugged into a monitor is the other way round. Branching both off
 * `innerWidth` is how apps end up with a hamburger menu on a desktop and no
 * long-press on an iPad.
 *
 * The composer already got this right for Enter-versus-newline (`matchMedia
 * ('(pointer: fine)')`, not a width). This is the same rule, hoisted somewhere
 * everything else can reach it.
 */

/** Below this the shell is one column and two drawers, not four columns. */
export const NARROW = 900;

class Layout {
  /** One column and two drawers (`docs/24`). */
  narrow = $state(false);
  /**
   * A finger, not a mouse. Drives long-press menus, the 44px target floor and
   * the bottom-sheet face switcher — never the column count.
   */
  coarse = $state(false);
  /** Installed to the home screen. iOS push only works from here (`docs/24`). */
  standalone = $state(false);

  /** Roughly-iOS, for the notification honesty table. Safari on iPadOS lies
      about its platform, hence the touch-points check rather than the UA. */
  get ios() {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }

  /**
   * Subscribe to the media queries. Called once from the root layout; returns
   * a teardown so `$effect` can clean up in development's hot reload.
   */
  watch() {
    if (typeof window === 'undefined') return () => {};

    const queries: [MediaQueryList, (m: MediaQueryList) => void][] = [
      [window.matchMedia(`(max-width: ${NARROW - 1}px)`), (m) => (this.narrow = m.matches)],
      [window.matchMedia('(pointer: coarse)'), (m) => (this.coarse = m.matches)],
      [window.matchMedia('(display-mode: standalone)'), (m) => (this.standalone = m.matches)],
    ];

    const offs = queries.map(([mq, set]) => {
      set(mq);
      const on = (e: MediaQueryListEvent) => set(e.target as MediaQueryList);
      mq.addEventListener('change', on);
      return () => mq.removeEventListener('change', on);
    });

    return () => offs.forEach((off) => off());
  }
}

export const layout = new Layout();
