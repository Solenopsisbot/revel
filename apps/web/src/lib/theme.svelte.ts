/**
 * Theme, density, personality and motion.
 *
 * Every one of these is a single attribute on <html> that the token layer
 * reads (`packages/ui/tokens.css`), which is the whole point of the
 * CSS-custom-property seam: one write re-themes the app with no component
 * aware it happened.
 */
export const THEMES = [
  { id: 'dusk', name: 'Dusk', hint: 'violet, the default' },
  { id: 'midnight', name: 'Midnight', hint: 'navy' },
  { id: 'ember', name: 'Ember', hint: 'warm dark' },
  { id: 'moss', name: 'Moss', hint: 'green dark' },
  { id: 'daylight', name: 'Daylight', hint: 'light' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];
export type Density = 'cozy' | 'compact';
export type Personality = 'full' | 'calm';

const KEY = 'revel.appearance';

interface Appearance {
  theme: ThemeId;
  density: Density;
  personality: Personality;
  reduceMotion: boolean;
}

const DEFAULTS: Appearance = {
  theme: 'dusk',
  density: 'cozy',
  personality: 'full',
  reduceMotion: false,
};

class Theme {
  current = $state<Appearance>({ ...DEFAULTS });

  load() {
    if (typeof document === 'undefined') return;
    // ?theme=/&density=/&personality= override the stored choice without
    // persisting it — for reviewing a screen in a theme you don't run.
    const qs = new URLSearchParams(location.search);
    const override = {
      theme: qs.get('theme') as ThemeId | null,
      density: qs.get('density') as Density | null,
      personality: qs.get('personality') as Personality | null,
    };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.current = { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      /* corrupt or unavailable storage is not worth failing a page load over */
    }
    for (const [k, v] of Object.entries(override)) {
      if (v) this.current = { ...this.current, [k]: v };
    }
    // No apply() here: the inline script in app.html already stamped the
    // attributes before paint. This only reconciles the store with them.
    document.body?.classList.toggle('reduce-motion', this.current.reduceMotion);
  }

  set<K extends keyof Appearance>(key: K, value: Appearance[K]) {
    this.current = { ...this.current, [key]: value };
    this.apply(true);
    try {
      localStorage.setItem(KEY, JSON.stringify(this.current));
    } catch {
      /* private mode; the choice just won't persist */
    }
  }

  /**
   * Applying a theme rewrites custom properties that ~32 transition
   * declarations are watching, so every background and colour in the app
   * animates at once — at different durations, because they were tuned for
   * different jobs. The result reads as lag and smear.
   *
   * A theme change is not a state change worth animating: you asked for it and
   * it should already be true. So transitions are suppressed for one frame
   * while it lands.
   */
  apply(instant = false) {
    if (typeof document === 'undefined') return;
    const el = document.documentElement;
    if (instant) {
      el.classList.add('theme-switching');
      // Two frames: one for the class to take effect, one for the paint.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => el.classList.remove('theme-switching')),
      );
    }
    el.dataset.theme = this.current.theme;
    el.dataset.density = this.current.density;
    el.dataset.personality = this.current.personality;
    // Kills every transition and animation at the token layer, rather than
    // shortening them (`docs/32`).
    document.body?.classList.toggle('reduce-motion', this.current.reduceMotion);
  }
}

export const theme = new Theme();
