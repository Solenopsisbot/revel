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
   * Track the height the on-screen keyboard actually leaves us.
   *
   * `100dvh` is the *layout* viewport, and no mobile browser shrinks that when
   * the keyboard opens — Safari scrolls the page instead and Chrome only
   * resizes if the viewport meta asks it to. In a chat app that is the worst
   * possible failure: the composer, the one thing you are looking at while
   * typing, goes under the keyboard.
   *
   * `visualViewport` is the part you can actually see, so the shell keys off
   * that and falls back to `100dvh` wherever it is missing. Written straight to
   * a custom property rather than through `$state`, because this fires on every
   * frame of the keyboard animation and none of those frames need Svelte to
   * re-render anything.
   *
   * Two things it deliberately does *not* react to:
   * - **Pinch zoom** (`scale !== 1`), which also shrinks the visual viewport.
   *   Shrinking the app to match would fight the person zooming in.
   * - **Fine pointers.** A desktop window has no keyboard inset, and the
   *   property would just be a slower spelling of `100dvh`.
   */
  #keyboard(): () => void {
    const vv = window.visualViewport;
    if (!vv) return () => {};
    const el = document.documentElement;
    const apply = () => {
      if (!this.coarse || vv.scale !== 1) {
        el.style.removeProperty('--app-h');
        return;
      }
      // `offsetTop` is how far the visual viewport has been scrolled down
      // inside the layout viewport — on iOS the keyboard does that rather than
      // resizing, and without subtracting it the shell runs off the bottom by
      // exactly the amount it scrolled.
      el.style.setProperty('--app-h', `${Math.round(vv.height + vv.offsetTop)}px`);
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      el.style.removeProperty('--app-h');
    };
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

    // After the pointer check above, so the first `apply()` already knows
    // whether this is a device with an on-screen keyboard at all.
    const offKeyboard = this.#keyboard();

    return () => {
      for (const off of offs) off();
      offKeyboard();
    };
  }
}

export const layout = new Layout();
