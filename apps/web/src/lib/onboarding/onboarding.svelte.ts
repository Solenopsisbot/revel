/**
 * Whether the first-run overlay has been seen.
 *
 * Its own tiny store rather than a field on `core`, because it is a property
 * of this *install* rather than of the account — a second device belonging to
 * the same person is still a first run on that device, and Wren's whole pitch
 * is that she is the thing living on it.
 */
const KEY = 'revel.onboarded';

class Onboarding {
  /** Open on a fresh install, and whenever `?onboarding=1` asks for it. */
  open = $state(false);

  constructor() {
    if (typeof localStorage === 'undefined') return;
    try {
      const forced = new URLSearchParams(location.search).get('onboarding');
      // A screen you see exactly once is a screen nobody can review, so there
      // is a way to summon it that doesn't involve clearing storage.
      this.open = forced === '1' || localStorage.getItem(KEY) !== 'yes';
    } catch {
      /* private mode: show it, which is the safe direction to fail */
      this.open = true;
    }
  }

  dismiss() {
    this.open = false;
    try {
      localStorage.setItem(KEY, 'yes');
    } catch {
      /* private mode; it will greet them again next time, which is survivable */
    }
  }
}

export const onboarding = new Onboarding();
