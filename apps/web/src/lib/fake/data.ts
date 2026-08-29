/**
 * Fixture data.
 *
 * The real core (`docs/05` §4) will expose the same shapes from a local
 * database fed by the sync engine. Building the UI against this first means
 * the interface gets designed by what the interface actually needs, rather
 * than by what happened to be convenient to store.
 */
import { withHistory } from './history.js';

export type FaceColour = 'gold' | 'rose' | 'violet' | 'sky' | 'mint' | 'coral' | 'lilac' | 'aqua';

export interface Face {
  id: string;
  name: string;
  colour: FaceColour;
  /** The account this face belongs to. Several faces may share one. */
  accountId: string;
  pronouns?: string;
  /** Free text on the profile card. */
  bio?: string;
  /** What the roster sorts and the profile card shows. */
  status?: 'here' | 'away' | 'busy' | 'invisible';
  /** A line of their own, under the name on the profile card. */
  note?: string;
  /** Software, and therefore always badged (`docs/11`). */
  agent?: { label: 'Agent' | 'Bot' | 'Friend' | 'Assistant' | 'Companion' | 'Service'; by: string };
}

export type AttachmentKind = 'image' | 'gif' | 'video' | 'audio' | 'file';

/**
 * One piece of media on a message.
 *
 * `w`/`h` are the intrinsic pixel size and are REQUIRED for anything visual:
 * the box is reserved at the right aspect ratio before the bytes arrive, so a
 * loading image never shoves the conversation around (`docs/32`). In the real
 * client these come from the encrypted manifest, which is why the server can
 * hand out sizes it cannot itself read.
 */
export interface Attachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  /** Bytes. Shown on file cards and while a large one is still arriving. */
  size: number;
  url: string;
  w?: number;
  h?: number;
  poster?: string;
  /** Seconds, for video and audio. */
  duration?: number;
  /** Peak per bucket, 0..1. Precomputed by the sender; the receiver can't
      afford to decode a whole file just to draw a scrubber. */
  waveform?: number[];
  /** Description. Empty is a real state and the UI says so rather than lying. */
  alt?: string;
  /** Sender marked it sensitive: covered until asked for (`docs/05` §6). */
  spoiler?: boolean;
  /** Still being fetched and decrypted. The frame is already the right shape. */
  loading?: boolean;
}

export interface LinkCard {
  url: string;
  site: string;
  title: string;
  blurb?: string;
  /** Never fetched by the server: the sender renders it or nobody does
      (`docs/03` — unfurling on the server would leak every link). */
  by: 'sender';
}

export interface Message {
  id: string;
  faceId: string;
  body: string;
  at: number;
  /** Not yet acknowledged by the server. Renders provisional (`docs/32`). */
  pending?: boolean;
  failed?: boolean;
  /** When the author last changed it. Renders as a quiet "edited" marker. */
  editedAt?: number;
  /**
   * A tombstone. The row stays so the conversation still makes sense; the
   * content is gone. Who removed it matters: "you deleted this" and "a
   * moderator removed this" are different facts and get different words.
   */
  deleted?: { by: 'author' | 'moderator'; at: number };
  pinned?: boolean;
  reactions?: Reaction[];
  replyTo?: string;
  /**
   * The message this one branches off, if it is a thread reply (`docs/16`: "a
   * branch inside a room. Not a room.").
   *
   * A thread is *not* a separate audience or key group — `docs/03` is explicit
   * that it is an event stream within the room, same members, same group. So
   * this is one field on a message rather than a room-like object, and every
   * permission and every key question about a thread reply has exactly the
   * same answer as it does for the room around it.
   */
  thread?: string;
  attachments?: Attachment[];
  link?: LinkCard;
  /** A translation or transcript someone published (`docs/10`). */
  annotation?: { by: string; kind: string; body: string };
}

/** `key` is the emoji itself, tone stripped, so tone variants pool. */
export interface Reaction {
  key: string;
  /** Face ids, in the order they reacted. `count` is derived from this. */
  by: string[];
}

/**
 * How loudly a scope notifies. `mentions` is the useful middle and the one
 * most people actually want; `none` still counts unread, it just doesn't push.
 */
export type NotifyLevel = 'all' | 'mentions' | 'none';

export interface Room {
  id: string;
  name: string;
  kind: 'text' | 'voice';
  category: string;
  /** The one-line description in the header. */
  topic?: string;
  unread?: number;
  mention?: boolean;
  /** Voice rooms: who is currently in them, shown under the room in the list. */
  inCall?: string[];
  /**
   * Per-room notification override. Absent means "whatever the space says",
   * which is the case for almost every room — an explicit level is a choice
   * someone made, and the settings UI shows it as one.
   */
  notify?: NotifyLevel;
  /** Slow mode, in seconds. 0 is off. */
  slow?: number;
  /**
   * The language most of this room is written in, detected on-device
   * (`docs/10`). Absent means "the language you read", which is the common
   * case and shouldn't need stating.
   */
  language?: string;
  /** Roughly how many messages arrived here this week. Counts, never content. */
  weekly?: number;
  /**
   * How messages are drawn (`docs/07` §"Two message styles"). Absent means the
   * room's kind decides: bubbles for DMs, rows for space rooms. Set explicitly
   * it overrides that, because "a busy room wants rows" is true of some DMs
   * and false of some space rooms.
   */
  style?: 'bubbles' | 'rows';
  /**
   * "Always translate this room." Distinct from `language`, which is what the
   * room is written in — one is an observation, the other is your choice
   * about it (`docs/10` §The controls).
   */
  translate?: boolean;
  /**
   * Who holds the keys to this room (`docs/18` §"Who can see what"). This is
   * the encryption boundary, not a permission — which is why it is immutable
   * after the room exists and the UI says so rather than greying out silently.
   */
  audience: Audience;
  /**
   * Whether threads in this room are their own server-side stream.
   *
   * The one genuine privacy knob threads have (`docs/03` §metadata): a stream
   * id lets the server page a thread without shipping the whole room, and in
   * exchange it learns that the thread exists and which messages are in it —
   * never what they say. Off means threads are paged on this device instead:
   * slower, and the structure stays private. Default on, stated plainly, and
   * per room because busy rooms and sensitive rooms want opposite answers.
   */
  streamPaging?: boolean;
}

/**
 * A room's audience. `everyone` is the space's default group; `roles` and
 * `picked` each create their own. Kept as a small closed set because every
 * distinct audience is a separate key group with a real cost (`docs/03` §4).
 */
export type Audience =
  | { kind: 'everyone' }
  | { kind: 'roles'; roles: string[] }
  | { kind: 'picked'; faceIds: string[] };

export interface Space {
  id: string;
  name: string;
  initial: string;
  from: FaceColour;
  to: FaceColour;
  rooms: Room[];
  description?: string;
  /**
   * Who can get in (`docs/18` §Creating a space). Public means listed in the
   * directory, which is opt-in and the only way a space is discoverable at
   * all — there is no algorithmic surface to be ranked by.
   */
  visibility: 'invite' | 'link' | 'public';
  /** Roles that exist in this space, for the audience picker. */
  roles: string[];
}

export const faces: Record<string, Face> = {
  viola: { id: 'viola', name: 'Viola', colour: 'aqua', accountId: 'acct-v', status: 'here', note: 'building the thing' },
  june: { id: 'june', name: 'June', colour: 'mint', accountId: 'acct-v', pronouns: 'she/her', status: 'here' },
  ash: { id: 'ash', name: 'Ash', colour: 'lilac', accountId: 'acct-v', status: 'away' },
  rae: { id: 'rae', name: 'Rae', colour: 'rose', accountId: 'acct-r', pronouns: 'she/her', status: 'here', note: 'shapes, mostly' },
  emeri: { id: 'emeri', name: 'Emeri', colour: 'sky', accountId: 'acct-e', pronouns: 'they/them', status: 'busy' },
  kiko: {
    id: 'kiko',
    name: 'Kiko',
    colour: 'violet',
    accountId: 'acct-k',
    status: 'here',
    agent: { label: 'Friend', by: 'Viola' },
  },
  translator: {
    id: 'translator',
    name: 'Translator',
    colour: 'gold',
    accountId: 'acct-t',
    status: 'here',
    agent: { label: 'Service', by: 'the space' },
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
    description: 'Building Revel, mostly at unreasonable hours.',
    visibility: 'invite',
    roles: ['Admin', 'Build', 'Design'],
    rooms: [
      { id: 'general', name: 'general', kind: 'text', category: 'General', topic: 'Anything, within reason', unread: 2, audience: { kind: 'everyone' } },
      { id: 'design', name: 'design', kind: 'text', category: 'General', topic: 'Shapes, colour, and arguing about radii', unread: 3, mention: true, audience: { kind: 'everyone' } },
      { id: 'off-topic', name: 'off-topic', kind: 'text', category: 'General', audience: { kind: 'everyone' } },
      { id: 'crypto-review', name: 'crypto-review', kind: 'text', category: 'Build', topic: 'Read the threat model before posting', slow: 30, streamPaging: false, audience: { kind: 'roles', roles: ['Build'] } },
      { id: 'ci-noise', name: 'ci-noise', kind: 'text', category: 'Build', notify: 'none', audience: { kind: 'everyone' } },
      { id: 'the-couch', name: 'the couch', kind: 'voice', category: 'Voice', inCall: ['rae', 'emeri'], audience: { kind: 'everyone' } },
      { id: 'focus', name: 'focus', kind: 'voice', category: 'Voice', audience: { kind: 'everyone' } },
    ],
  },
  {
    id: 'braid',
    name: 'Braid',
    initial: 'B',
    from: 'aqua',
    to: 'sky',
    description: 'A byte-level architecture and the loss curves it produces.',
    visibility: 'link',
    roles: ['Admin', 'Research'],
    rooms: [
      { id: 'papers', name: 'papers', kind: 'text', category: 'General', language: 'Japanese', weekly: 210, audience: { kind: 'everyone' } },
      { id: 'runs', name: 'runs', kind: 'text', category: 'General', topic: 'Loss curves and disappointment', unread: 7, weekly: 340, audience: { kind: 'everyone' } },
    ],
  },
];

const t = (mins: number) => Date.now() - mins * 60_000;

/** A plausible speech envelope, so the scrubber has something honest to draw. */
const wave = (n: number, seed = 7) => {
  const out: number[] = [];
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const noise = (s / 2147483648) * 0.55;
    // Two overlapping phrases with a breath between them.
    const env = Math.sin((i / n) * Math.PI * 2.2) * 0.5 + 0.5;
    out.push(Math.min(1, 0.12 + env * 0.75 + noise * 0.3));
  }
  return out;
};

/**
 * The *recent* messages, hand-written: each one is here to exercise a
 * particular rendering — a spoiler, a tombstone, an audio file, a link card.
 * `withHistory` fills in a few weeks of generated backlog behind them, because
 * twenty-seven messages is plenty for looking at a room and nowhere near
 * enough for looking at search.
 */
const recent: Record<string, Message[]> = {
  design: [
    { id: 'd0', faceId: 'emeri', body: 'starting the room over. everything before this is in the archive.', at: t(1700) },
    {
      id: 'd0b',
      faceId: 'rae',
      body: 'the palette, before I ruin it',
      at: t(1690),
      attachments: [
        { id: 'a0', kind: 'image', name: 'palette.png', size: 157_655, url: '/mock/shot-wide.png', w: 1280, h: 800, alt: 'Three candy colours bleeding into each other' },
      ],
      reactions: [{ key: '🔥', by: ['viola', 'june', 'emeri'] }],
    },
    { id: 'd1', faceId: 'rae', body: 'the buttons need to feel like you can press them. that’s the whole thing.', at: t(48) },
    // A thread: the tangent that would otherwise have eaten the room. These
    // carry `thread`, so they are absent from the timeline and reachable only
    // through the summary line on d1 — which is the point of a branch.
    { id: 'd1-t1', faceId: 'emeri', body: 'is that a shadow or a border though. i can never tell from the mock', at: t(46), thread: 'd1' },
    { id: 'd1-t2', faceId: 'rae', body: 'shadow. a border would make it a card and it is not a card', at: t(45), thread: 'd1' },
    { id: 'd1-t3', faceId: 'emeri', body: 'ok but then it needs to move on press or the shadow is lying', at: t(44), thread: 'd1' },
    { id: 'd1-t4', faceId: 'rae', body: 'it does move. that is the entire reason the toy easing exists', at: t(43), thread: 'd1' },
    { id: 'd1-t5', faceId: 'june', body: 'i measured it, 2px down and the shadow goes to zero. it reads as an object', at: t(41), thread: 'd1' },
    { id: 'd1-t6', faceId: 'emeri', body: 'fine. i withdraw the objection and i am keeping the receipt', at: t(38), thread: 'd1' },
    {
      id: 'd2',
      faceId: 'viola',
      body: 'hard shadow, no blur. it’s a physical object or it isn’t',
      at: t(46),
      replyTo: 'd1',
      editedAt: t(45),
      reactions: [
        { key: '💯', by: ['rae', 'june'] },
        { key: '👍', by: ['emeri'] },
      ],
    },
    { id: 'd2b', faceId: 'ash', body: 'this message is gone', at: t(44), deleted: { by: 'author', at: t(43) } },
    { id: 'd3', faceId: 'june', body: 'she does this every single time', at: t(12) },
    {
      id: 'd3b',
      faceId: 'june',
      body: '',
      at: t(11),
      attachments: [
        { id: 'a1', kind: 'gif', name: 'loop.gif', size: 96_102, url: '/mock/loop.gif', w: 240, h: 180, alt: '' },
      ],
    },
    {
      id: 'd4',
      faceId: 'emeri',
      body: 'Ich schaffe es heute Abend nicht, mein Zug ist ausgefallen.',
      at: t(9),
      annotation: { by: 'Translator', kind: 'German', body: 'I can’t make it tonight, my train is cancelled.' },
    },
    {
      id: 'd4b',
      faceId: 'emeri',
      body: '',
      at: t(8),
      attachments: [
        {
          id: 'a2',
          kind: 'audio',
          name: 'note.ogg',
          size: 59_766,
          url: '/mock/voice.ogg',
          duration: 14,
          waveform: wave(64),
        },
      ],
    },
    {
      id: 'd4c',
      faceId: 'rae',
      body: 'the motion study, second pass',
      at: t(6),
      attachments: [
        {
          id: 'a3',
          kind: 'video',
          name: 'motion-2.mp4',
          size: 221_225,
          url: '/mock/clip.mp4',
          poster: '/mock/clip-poster.jpg',
          w: 960,
          h: 540,
          duration: 6,
        },
      ],
      reactions: [{ key: '👀', by: ['viola'] }],
    },
    {
      id: 'd5',
      faceId: 'kiko',
      body: 'On daylight six of the eight candy colours fall under 3:1 as name colours. The bright values are fine as fills; they just can’t be ink.',
      at: t(4),
      link: {
        url: 'https://www.w3.org/TR/WCAG22/#contrast-minimum',
        site: 'w3.org',
        title: 'Contrast (Minimum) — WCAG 2.2',
        blurb: 'Text and images of text have a contrast ratio of at least 4.5:1.',
        by: 'sender',
      },
    },
    {
      id: 'd6',
      faceId: 'viola',
      body: 'ok fine. ink twins it is',
      at: t(3),
      attachments: [
        { id: 'a4', kind: 'image', name: 'the-fix.png', size: 108_712, url: '/mock/shot-tall.png', w: 900, h: 1200, alt: 'Darkened ink values against a light ground', spoiler: true },
        { id: 'a5', kind: 'file', name: 'contrast-audit.csv', size: 4_812, url: '#' },
      ],
    },
  ],
  general: [
    { id: 'g1', faceId: 'rae', body: 'morning', at: t(1440) },
    { id: 'g2', faceId: 'emeri', body: 'read this when you wake up', at: t(90) },
    { id: 'g3', faceId: 'emeri', body: 'actually never mind, fixed it', at: t(88) },
  ],
  'off-topic': [],
  'crypto-review': [
    { id: 'c1', faceId: 'kiko', body: 'A revoked device cannot read the next epoch. 30 tests hold it down.', at: t(200), pinned: true },
    { id: 'c1-t1', faceId: 'emeri', body: 'Including the case where the revocation and a message race each other?', at: t(196), thread: 'c1' },
    { id: 'c1-t2', faceId: 'kiko', body: 'Yes. The message either lands before the epoch advance or it does not land at all. There is no window where it lands after and is still readable.', at: t(194), thread: 'c1' },
    { id: 'c1-t3', faceId: 'emeri', body: 'That is the one I actually wanted to know about. Thank you.', at: t(190), thread: 'c1' },
  ],
  'ci-noise': [],
  'dm-acct-r~acct-v': [
    { id: 'dm1', faceId: 'rae', body: 'did you see the contrast thing kiko posted', at: t(180) },
    { id: 'dm2', faceId: 'viola', body: 'yeah. he\u2019s right and i hate it', at: t(174) },
    { id: 'dm3', faceId: 'rae', body: 'the ink twins fix is fine though. genuinely', at: t(170) },
    { id: 'dm4', faceId: 'rae', body: 'anyway are you around later? want to argue about radii in person', at: t(12) },
    { id: 'dm4-t1', faceId: 'viola', body: 'after seven. bring the tablet', at: t(10), thread: 'dm4' },
    { id: 'dm4-t2', faceId: 'rae', body: 'i am always bringing the tablet, that is not a condition', at: t(9), thread: 'dm4' },
  ],
  'dm-acct-e~acct-v': [
    { id: 'dm5', faceId: 'emeri', body: 'train\u2019s cancelled, so tonight is off from my end', at: t(240) },
  ],
  'dm-group-shapes': [
    { id: 'dm6', faceId: 'emeri', body: 'making this so we stop derailing #design', at: t(400) },
    { id: 'dm7', faceId: 'rae', body: 'we will absolutely still derail #design', at: t(396) },
  ],
  papers: [],
  runs: [{ id: 'r1', faceId: 'viola', body: 'loss curve looks sane finally', at: t(30) }],
};

export const messages: Record<string, Message[]> = withHistory(recent);

/** Who is in a given room, for the member list. */
export const rosters: Record<string, string[]> = {
  // DMs carry their roster the same way a room does — the audience is an
  // explicit list, so there is nothing special to look up.
  'dm-acct-r~acct-v': ['viola', 'rae'],
  'dm-acct-e~acct-v': ['viola', 'emeri'],
  'dm-group-shapes': ['viola', 'rae', 'emeri'],
  design: ['rae', 'viola', 'june', 'kiko', 'emeri', 'translator'],
  general: ['rae', 'viola', 'emeri'],
  'crypto-review': ['viola', 'kiko'],
};

/**
 * Where the unread divider sits per room. In the real client this is the last
 * receipt this device acknowledged, and it stays put while you read so the
 * line doesn't crawl up the screen underneath you.
 */
export const lastRead: Record<string, string> = {
  design: 'd3',
};

// ---------------------------------------------------------------------------
// Account, devices and local storage
//
// These live here rather than inside the settings components because Wren
// reads them too (`docs/12`: device and key state is explicitly on her
// charter). A notice that says "you have one device" while the Devices screen
// lists four is the kind of thing that destroys trust in the whole feature, so
// there is one source and both surfaces read it.
// ---------------------------------------------------------------------------

export interface Device {
  id: string;
  name: string;
  platform: string;
  /** Human label for the list. */
  seen: string;
  /** Days since last contact. Drives the 90-day heuristic; 0 is now. */
  seenDays: number;
  /** The device you are reading this on. Cannot be signed out from itself. */
  current?: boolean;
  /** This device runs an agent, so signing it out also stops the agent. */
  agent?: string;
  fingerprint: string;
}

export const devices: Device[] = [
  { id: 'd-mac', name: 'This device', platform: 'macOS', seen: 'now', seenDays: 0, current: true, fingerprint: '4f2a 9c31 88de 05b7 · a1c4 77f0 2be9 6d13' },
  { id: 'd-phone', name: 'Phone', platform: 'iOS', seen: '2 hours ago', seenDays: 0, fingerprint: '77b1 04ce 9a25 f3d8 · 6e02 bb47 1c90 aa35' },
  { id: 'd-ipad', name: 'iPad', platform: 'iPadOS', seen: '94 days ago', seenDays: 94, fingerprint: '2d5f a8b0 3e71 cc94 · 90fa 15d3 6b28 e047' },
  { id: 'd-agent', name: 'Agent host', platform: 'Linux', seen: '5 minutes ago', seenDays: 0, agent: 'Kiko', fingerprint: 'c013 6ea9 47bd 2f85 · 38c1 0d76 b5e2 9147' },
];

export interface Account {
  handle: string;
  address: string;
  provider: string;
  /**
   * Whether the recovery code has been confirmed saved. False by default and
   * deliberately so: it is the state a real new account is in, and it is the
   * one Wren most needs to be able to see.
   */
  recoveryCodeConfirmed: boolean;
  /** This browser can do WebAuthn. */
  passkeySupported: boolean;
  passkeyEnrolled: boolean;
  /** Faces linked publicly to each other (`docs/11`). Off by default. */
  facesLinkedPublicly: boolean;
}

export const account: Account = {
  handle: 'viola',
  address: 'viola@revel.chat',
  provider: 'revel.chat',
  recoveryCodeConfirmed: false,
  passkeySupported: true,
  passkeyEnrolled: false,
  facesLinkedPublicly: false,
};

/**
 * A contact whose key changed. `live` means it happened in a conversation you
 * are currently in, which is the one event allowed past the interruption
 * budget (`docs/12`).
 */
export interface KeyChange {
  faceId: string;
  when: string;
  live: boolean;
  acknowledged: boolean;
}

export const keyChanges: KeyChange[] = [
  { faceId: 'rae', when: 'yesterday', live: false, acknowledged: false },
];

/** Local database sizes, in megabytes. The Storage screen renders these. */
export interface Storage {
  messages: number;
  media: number;
  index: number;
  models: number;
  /** Soft limit this device is willing to give the app, in MB. */
  limit: number;
  bySpace: { id: string; name: string; mb: number }[];
  /** Rooms you left whose decrypted history is still on this device. */
  leftRooms: { name: string; mb: number }[];
  /** Downloaded translation models (`docs/10`). */
  models_: { id: string; name: string; mb: number; lastUsed: string | null }[];
}

export const storage: Storage = {
  messages: 410,
  media: 1700,
  index: 90,
  models: 210,
  limit: 4000,
  bySpace: [
    { id: 'solexsis', name: 'Solexsis', mb: 1100 },
    { id: 'braid', name: 'Braid', mb: 840 },
    { id: 'dms', name: 'Direct messages', mb: 460 },
  ],
  leftRooms: [
    { name: 'kith-migration', mb: 74 },
    { name: 'launch-planning', mb: 38 },
    { name: 'old-standup', mb: 21 },
  ],
  models_: [
    { id: 'ja-en', name: 'Japanese → English', mb: 120, lastUsed: null },
    { id: 'de-en', name: 'German → English', mb: 90, lastUsed: '3 days ago' },
  ],
};

/**
 * Notification preferences.
 *
 * Scoped rather than flat: a global default, per-space overrides, and
 * per-room overrides on the `Room` itself. Resolution is
 * room → space → global, and the settings UI shows which level a room is
 * actually getting and where it came from, because "why is this room quiet"
 * is the only question anyone ever asks of this screen.
 */
export interface Notifications {
  global: NotifyLevel;
  /** Space id → level. Absent means it follows the global default. */
  spaces: Record<string, NotifyLevel>;
  quietHours: { on: boolean; from: string; to: string };
  /**
   * Whether the lock screen shows message content. Off by default: the push
   * itself carries no content, so the preview is decrypted locally and is
   * genuinely the user's choice rather than ours.
   */
  previews: boolean;
  sound: boolean;
}

export const notifications: Notifications = {
  global: 'mentions',
  spaces: { braid: 'all' },
  quietHours: { on: true, from: '23:00', to: '08:00' },
  previews: false,
  sound: true,
};

/**
 * Privacy and safety (`docs/19`). Read receipts and typing live here rather
 * than under Appearance because they are disclosures about you, not
 * preferences about the app.
 */
export interface Privacy {
  /** Who may start a direct conversation with you. */
  dms: 'anyone' | 'shared-spaces' | 'nobody';
  /** Who may add you to a space without asking. */
  spaceInvites: 'anyone' | 'shared-spaces' | 'nobody';
  readReceipts: boolean;
  typingIndicators: boolean;
  /** Whether your online status is visible at all. */
  presence: boolean;
  blocked: { handle: string; when: string }[];
}

export const privacy: Privacy = {
  dms: 'shared-spaces',
  spaceInvites: 'shared-spaces',
  readReceipts: true,
  typingIndicators: true,
  presence: true,
  blocked: [
    { handle: 'someone@elsewhere.example', when: 'March' },
    { handle: 'spam-bot@free.example', when: 'last week' },
  ],
};

/**
 * Interface language and on-device translation (`docs/10`).
 *
 * `reads` is the set of languages you understand — a room in one of them
 * never gets offered translation, which is the whole point of asking.
 */
export interface LanguageSettings {
  interface: string;
  reads: string[];
  /** Translate automatically, or show a button on each foreign message. */
  auto: boolean;
  /** Also transcribe voice clips, on-device. */
  transcribeVoice: boolean;
}

export const language: LanguageSettings = {
  interface: 'en',
  reads: ['English', 'German'],
  auto: true,
  transcribeVoice: false,
};

export const INTERFACE_LANGUAGES = [
  { id: 'en', name: 'English', audience: { kind: 'everyone' } },
  { id: 'de', name: 'Deutsch', audience: { kind: 'everyone' } },
  { id: 'fr', name: 'Français', audience: { kind: 'everyone' } },
  { id: 'ja', name: '日本語', audience: { kind: 'everyone' } },
  { id: 'pt', name: 'Português', audience: { kind: 'everyone' } },
] as const;

/** Languages the on-device models can handle, for the "languages I read" list. */
export const READABLE_LANGUAGES = [
  'English', 'German', 'French', 'Spanish', 'Portuguese', 'Japanese', 'Korean', 'Dutch',
];

// ---------------------------------------------------------------------------
// Direct messages
//
// A DM is a room with no space and an explicit-list audience (`docs/03` §4).
// Structurally identical to a space room — one group, one event log — which is
// why they share `Room`, the message list, the composer and everything else.
// The only differences are where they are listed and how they are styled.
// ---------------------------------------------------------------------------

/**
 * The id of a 1:1 conversation, derived from the sorted account pair.
 *
 * Deterministic on purpose (`docs/03`, Kith's trick): opening a DM with
 * someone is idempotent, so two people starting one at the same moment land in
 * the same room instead of creating two half-conversations.
 */
export function dmId(accountA: string, accountB: string) {
  return `dm-${[accountA, accountB].sort().join('~')}`;
}

export interface Dm {
  id: string;
  kind: 'dm' | 'group';
  /** Faces in the conversation, not counting you. */
  withIds: string[];
  /** Group DMs can be named; 1:1s are named by whoever is in them. */
  name?: string;
  unread?: number;
  mention?: boolean;
  notify?: NotifyLevel;
}

export const dms: Dm[] = [
  { id: dmId('acct-v', 'acct-r'), kind: 'dm', withIds: ['rae'], unread: 2, mention: true },
  { id: dmId('acct-v', 'acct-e'), kind: 'dm', withIds: ['emeri'] },
  { id: 'dm-group-shapes', kind: 'group', withIds: ['rae', 'emeri'], name: 'shapes and complaints' },
];
