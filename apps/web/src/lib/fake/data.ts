/**
 * Fixture data.
 *
 * The real core (`docs/05` §4) will expose the same shapes from a local
 * database fed by the sync engine. Building the UI against this first means
 * the interface gets designed by what the interface actually needs, rather
 * than by what happened to be convenient to store.
 */
export type FaceColour = 'gold' | 'rose' | 'violet' | 'sky' | 'mint' | 'coral' | 'lilac' | 'aqua';

export interface Face {
  id: string;
  name: string;
  colour: FaceColour;
  /** The account this face belongs to. Several faces may share one. */
  accountId: string;
  pronouns?: string;
  /** Software, and therefore always badged (`docs/11`). */
  agent?: { label: 'Agent' | 'Bot' | 'Friend' | 'Assistant' | 'Companion' | 'Service' };
}

export interface Message {
  id: string;
  faceId: string;
  body: string;
  at: number;
  /** Not yet acknowledged by the server. Renders provisional (`docs/32`). */
  pending?: boolean;
  failed?: boolean;
  reactions?: { key: string; count: number; mine?: boolean }[];
  replyTo?: string;
  /** A translation or transcript someone published (`docs/10`). */
  annotation?: { by: string; kind: string; body: string };
}

export interface Room {
  id: string;
  name: string;
  kind: 'text' | 'voice';
  category: string;
  unread?: number;
  mention?: boolean;
}

export interface Space {
  id: string;
  name: string;
  initial: string;
  from: FaceColour;
  to: FaceColour;
  rooms: Room[];
}

export const faces: Record<string, Face> = {
  viola: { id: 'viola', name: 'Viola', colour: 'aqua', accountId: 'acct-v' },
  june: { id: 'june', name: 'June', colour: 'mint', accountId: 'acct-v', pronouns: 'she/her' },
  ash: { id: 'ash', name: 'Ash', colour: 'lilac', accountId: 'acct-v' },
  rae: { id: 'rae', name: 'Rae', colour: 'rose', accountId: 'acct-r' },
  emeri: { id: 'emeri', name: 'Emeri', colour: 'sky', accountId: 'acct-e' },
  kiko: {
    id: 'kiko',
    name: 'Kiko',
    colour: 'violet',
    accountId: 'acct-k',
    agent: { label: 'Friend' },
  },
  translator: {
    id: 'translator',
    name: 'Translator',
    colour: 'gold',
    accountId: 'acct-t',
    agent: { label: 'Service' },
  },
};

/** The faces this account can speak as. More than one turns plurality on. */
export const myFaces = ['viola', 'june', 'ash'];

export const spaces: Space[] = [
  {
    id: 'solexsis',
    name: 'Solexsis',
    initial: 'S',
    from: 'violet',
    to: 'rose',
    rooms: [
      { id: 'general', name: 'general', kind: 'text', category: 'General', unread: 2 },
      { id: 'design', name: 'design', kind: 'text', category: 'General', unread: 3, mention: true },
      { id: 'off-topic', name: 'off-topic', kind: 'text', category: 'General' },
      { id: 'crypto-review', name: 'crypto-review', kind: 'text', category: 'Build' },
      { id: 'ci-noise', name: 'ci-noise', kind: 'text', category: 'Build' },
      { id: 'the-couch', name: 'the couch', kind: 'voice', category: 'Voice' },
    ],
  },
  {
    id: 'braid',
    name: 'Braid',
    initial: 'B',
    from: 'aqua',
    to: 'sky',
    rooms: [
      { id: 'papers', name: 'papers', kind: 'text', category: 'General' },
      { id: 'runs', name: 'runs', kind: 'text', category: 'General', unread: 7 },
    ],
  },
];

const t = (mins: number) => Date.now() - mins * 60_000;

export const messages: Record<string, Message[]> = {
  design: [
    { id: 'd1', faceId: 'rae', body: 'the buttons need to feel like you can press them. that’s the whole thing.', at: t(48) },
    { id: 'd2', faceId: 'viola', body: 'hard shadow, no blur. it’s a physical object or it isn’t', at: t(46), replyTo: 'd1', reactions: [{ key: 'yes', count: 2, mine: true }] },
    { id: 'd3', faceId: 'june', body: 'she does this every single time', at: t(12) },
    {
      id: 'd4',
      faceId: 'emeri',
      body: 'Ich schaffe es heute Abend nicht, mein Zug ist ausgefallen.',
      at: t(9),
      annotation: { by: 'Translator', kind: 'German', body: 'I can’t make it tonight, my train is cancelled.' },
    },
    { id: 'd5', faceId: 'kiko', body: 'On daylight six of the eight candy colours fall under 3:1 as name colours. The bright values are fine as fills; they just can’t be ink.', at: t(4) },
  ],
  general: [
    { id: 'g1', faceId: 'rae', body: 'morning', at: t(120) },
    { id: 'g2', faceId: 'emeri', body: 'read this when you wake up', at: t(90) },
  ],
  'off-topic': [],
  'crypto-review': [
    { id: 'c1', faceId: 'kiko', body: 'A revoked device cannot read the next epoch. 30 tests hold it down.', at: t(200) },
  ],
  'ci-noise': [],
  papers: [],
  runs: [{ id: 'r1', faceId: 'viola', body: 'loss curve looks sane finally', at: t(30) }],
};

/** Who is in a given room, for the member list. */
export const rosters: Record<string, string[]> = {
  design: ['rae', 'viola', 'june', 'kiko', 'translator'],
  general: ['rae', 'viola', 'emeri'],
  'crypto-review': ['viola', 'kiko'],
};
