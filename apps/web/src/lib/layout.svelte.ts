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

  /**
   * Roughly-iOS, for the notification honesty screen (`docs/24`).
   *
   * The only thing this is allowed to decide is *what we tell you about push*,
   * which is exactly the case where sniffing the platform is the honest move
   * rather than the lazy one: the constraints are Apple's and they are real,
   * and a screen that hides them behind a toggle that quietly does nothing is
   * the failure the doc names.
   *
   * iPadOS Safari reports itself as a Mac, hence the touch-points check.
   */
  ios = $state(false);

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

    // `?touch=1` forces the coarse-pointer treatment on a machine that has a
    // mouse. Not a test hook — the same review affordance `?theme=` and
    // `?onboarding=1` already are, and it exists for the same reason: a
    // surface you can only see by picking up a phone is a surface nobody
    // reviews, and the touch surface is now most of `docs/24`.
    //
    // The data attribute is how the token layer joins in; CSS cannot read a
    // query string, so `--tap` keys off `[data-touch]` as well as the media
    // query it normally follows.
    const qs = new URLSearchParams(location.search);
    if (qs.get('touch') === '1') {
      this.coarse = true;
      document.documentElement.dataset.touch = 'on';
    }

    const ua = navigator.userAgent;
    this.ios =
      qs.get('platform') === 'ios' ||
      /iPad|iPhone|iPod/.test(ua) ||
      (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

    return () => offs.forEach((off) => off());
  }
}

export const layout = new Layout();
