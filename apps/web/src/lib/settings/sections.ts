/**
 * The settings IA from `docs/19` §1, ordered by how often a real person opens
 * a section rather than by how the system is architected.
 *
 * `built: false` sections are listed rather than hidden. A settings screen that
 * quietly omits half its own map is harder to reason about than one that says
 * what is coming.
 */
export interface Section {
  id: string;
  name: string;
  blurb: string;
  built: boolean;
}

export const SECTIONS: Section[] = [
  { id: 'account', name: 'Account', blurb: 'Handle, provider, password, passkeys, recovery code', built: true },
  { id: 'faces', name: 'Faces', blurb: 'The ways you appear, and who can link them', built: true },
  { id: 'devices', name: 'Devices', blurb: 'What is signed in, and signing it out', built: true },
  { id: 'appearance', name: 'Appearance', blurb: 'Theme, density, personality, motion', built: true },
  { id: 'about', name: 'About', blurb: 'Version, and what the server can see', built: true },
  { id: 'notifications', name: 'Notifications', blurb: 'Per room and space, quiet hours, previews', built: false },
  { id: 'language', name: 'Language', blurb: 'Interface language and on-device translation', built: false },
  { id: 'wren', name: 'Wren', blurb: 'How much she speaks up, and what she has silenced', built: true },
  { id: 'privacy', name: 'Privacy & safety', blurb: 'Who can reach you, blocking, receipts', built: false },
  { id: 'storage', name: 'Storage & data', blurb: 'What is on this device, export, clearing it', built: false },
];
