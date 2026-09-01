/**
 * The settings IA from `docs/19` §1, ordered by how often a real person opens
 * a section rather than by how the system is architected.
 *
 * `built: false` sections are listed rather than hidden. A settings screen that
 * quietly omits half its own map is harder to reason about than one that says
 * what is coming.
 *
 * `wired` is the other axis, and it is the one that was missing. A screen can
 * be **built** — designed, laid out, rendering — and still be a mockup: static
 * rows, invented numbers, buttons with no handler. Every section here said
 * `built: true`, which was true and read as "this works". The result was a
 * settings screen telling somebody their recovery code was saved on a date
 * they had never seen, and counting a passkey they had never registered.
 *
 * A design preview is worth keeping and worth *labelling*. What it must never
 * do is state facts about an account that are not facts.
 */
export interface Section {
  id: string;
  name: string;
  blurb: string;
  /** The screen exists and renders. */
  built: boolean;
  /** It does something for a real, signed-in account. */
  wired: boolean;
}

export const SECTIONS: Section[] = [
  {
    id: 'account',
    name: 'Account',
    blurb: 'Handle, provider, password, passkeys, recovery code',
    built: true,
    wired: false,
  },
  {
    id: 'faces',
    name: 'Faces',
    blurb: 'The ways you appear, and who can link them',
    built: true,
    wired: true,
  },
  {
    id: 'devices',
    name: 'Devices',
    blurb: 'What is signed in, and signing it out',
    built: true,
    wired: false,
  },
  {
    id: 'appearance',
    name: 'Appearance',
    blurb: 'Theme, density, personality, motion',
    built: true,
    wired: true,
  },
  {
    id: 'about',
    name: 'About',
    blurb: 'Version, and what the server can see',
    built: true,
    wired: false,
  },
  {
    id: 'notifications',
    name: 'Notifications',
    blurb: 'Per room and space, quiet hours, previews',
    built: true,
    wired: true,
  },
  {
    id: 'language',
    name: 'Language',
    blurb: 'Interface language and on-device translation',
    built: true,
    wired: false,
  },
  {
    id: 'wren',
    name: 'Wren',
    blurb: 'How much she speaks up, and what she has silenced',
    built: true,
    wired: true,
  },
  {
    id: 'privacy',
    name: 'Privacy & safety',
    blurb: 'Who can reach you, blocking, receipts',
    built: true,
    wired: false,
  },
  {
    id: 'storage',
    name: 'Storage & data',
    blurb: 'What is on this device, export, clearing it',
    built: true,
    wired: false,
  },
];
