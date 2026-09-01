<script lang="ts">
import { untrack } from 'svelte';
import { afterNavigate, goto } from '$app/navigation';
import { page } from '$app/state';
import Avatar from '$lib/Avatar.svelte';
import BetaNotice from '$lib/BetaNotice.svelte';
import { back } from '$lib/back.js';
import Composer from '$lib/Composer.svelte';
import ContextMenu from '$lib/ContextMenu.svelte';
import CommandBar from '$lib/command/CommandBar.svelte';
import DmHome from '$lib/DmHome.svelte';
import { contextMenu } from '$lib/contextmenu.svelte.js';
import { applyUrl, syncUrl } from '$lib/deeplink.js';
import { drawers } from '$lib/drawers.svelte.js';
import { myFaces } from '$lib/faces.svelte.js';
import { notifications } from '$lib/notify.svelte.js';
import { connection } from '$lib/fake/connection.svelte.js';
import { conversation } from '$lib/fake/conversation.svelte.js';
import { core, MY_ACCOUNT } from '$lib/fake/core.svelte.js';
import type { NotifyLevel } from '$lib/fake/data.js';
import Icon from '$lib/Icon.svelte';
import { lastRoom } from '$lib/lastRoom.js';
import { clearStash, readStash } from '$lib/invite.js';
import { reasonOf, whyNot } from '$lib/startErrors.js';
import { layout } from '$lib/layout.svelte.js';
import { live } from '$lib/live.svelte.js';
import MessageList from '$lib/MessageList.svelte';
import { lightbox } from '$lib/media/lightbox.svelte.js';
import { memberMenu, roomMenu, spaceMenu } from '$lib/menus.js';
import Onboarding from '$lib/onboarding/Onboarding.svelte';
import { onboarding } from '$lib/onboarding/onboarding.svelte.js';
import ProfileCard from '$lib/ProfileCard.svelte';
import SearchPanel from '$lib/search/SearchPanel.svelte';
import { search } from '$lib/search/search.svelte.js';
import { session } from '$lib/session.svelte.js';
import SettingsOverlay from '$lib/settings/SettingsOverlay.svelte';
import SpaceSettings from '$lib/space/SpaceSettings.svelte';
import ThreadPanel from '$lib/thread/ThreadPanel.svelte';
import { longpress } from '$lib/touch.svelte.js';
import CallBar from '$lib/voice/CallBar.svelte';
import CallStage from '$lib/voice/CallStage.svelte';
import IncomingCall from '$lib/voice/IncomingCall.svelte';
import { voice } from '$lib/voice/voice.svelte.js';
import WrenSurface from '$lib/wren/WrenSurface.svelte';
import { wren } from '$lib/wren/wren.svelte.js';

// The URL says where we are (`docs/19`): a space and room or a DM, an
// optional message to land on, and an optional settings pane. Read once, at
// init, before anything renders — landing somewhere and then jumping is a
// worse first frame than landing in the right place.
const linked = applyUrl(page.url);
if (linked.message) {
  const here = core.messages[core.currentRoomId]?.some((m) => m.id === linked.message);
  if (here) core.jumpTo = linked.message;
  else core.awaitingKeys = linked.message;
}

/**
 * Restore the signed-in device before deciding anything.
 *
 * The account key is sealed in IndexedDB under a non-extractable device key
 * (`docs/03` §1), so a reload does not need a password. Reading it is async, and
 * until it finishes the app genuinely does not know whether anybody is signed
 * in — so it waits rather than guessing. Guessing wrong means flashing the
 * sign-in screen at somebody who is signed in, which is the exact "did it lose
 * my account?" moment this whole mechanism exists to prevent.
 *
 * **`?demo=1` skips it.** Every fixture-driven screen in this app is reachable
 * without an account and always has been; requiring a real sign-up to look at
 * the room list would make the fake core useless.
 */
/**
 * `?seed=N` fills the current room with N generated messages.
 *
 * For measuring `docs/29` §5's two rendering budgets, which have been unmeasured
 * since the rest were done because they need a DOM: "message list scroll, 100k
 * events, 60 fps" and the render half of "decrypt + render". A number nobody has
 * ever put a figure next to is a claim, and `docs/29` is blunt that claims need
 * numbers.
 *
 * A review affordance like `?touch=1` and `?theme=`, not a test hook: the point
 * is that somebody can open a hundred thousand messages and scroll them by hand.
 */
const seed = Number(page.url.searchParams.get('seed') ?? 0);
if (Number.isFinite(seed) && seed > 0) {
  const faces = Object.keys(core.faces);
  const base = Date.now() - seed * 1000;
  core.messages[core.currentRoomId] = Array.from({ length: seed }, (_, i) => ({
    id: `seed-${i}`,
    faceId: faces[i % faces.length] as string,
    // Varying length, because a list of identical rows measures a best case
    // nobody experiences.
    body: `message ${i} — ${'the quick brown fox '.repeat(1 + (i % 4))}`,
    at: base + i * 1000,
  }));
}

/**
 * `?e2e=1` publishes the app's own singletons on `window`.
 *
 * Not a convenience: a browser test that reaches for a module by URL gets a
 * *different instance* than the app, because Vite serves `…svelte.ts` and
 * `…svelte.js` as separate module records and the app's specifier resolves to
 * one of them. Two copies of `core` look identical, respond to writes, and
 * render nothing — which cost an hour before it was noticed.
 *
 * Publishing what the component actually holds removes the question entirely.
 * Gated so it never exists in an ordinary session.
 */
if (page.url.searchParams.has('e2e')) {
  (window as unknown as Record<string, unknown>).__revel = {
    core,
    live,
    session,
    myFaces,
    onboarding,
    notifications,
  };
}

let startingDm = $state(false);
/** Which kind the form is collecting names for. */
let startingKind = $state<'dm' | 'group'>('dm');
let dmHandle = $state('');
let dmError = $state('');
let dmBusy = $state(false);

/**
 * A signed-in account starts in Home.
 *
 * Direct messages are the part everybody has — a new account has no spaces at
 * all — so that is where the app opens rather than in whichever space happens
 * to sort first. `docs/19` treats Home as a peer of the rail, not a fallback.
 *
 * Runs once, when the core starts, rather than on every change: somebody who
 * has deliberately clicked into a space should stay there.
 */
let homed = false;
$effect(() => {
  if (!live.running || homed) return;
  homed = true;
  core.scope = 'home';
});

/**
 * Open the first conversation, once there is one to open.
 *
 * A separate effect because the room list arrives *after* the core starts —
 * `live.running` is true the moment the stack exists and the Host has not been
 * asked yet. Doing both in one effect meant a reload landed on a fixture room
 * with an empty timeline, which reads exactly like "my messages are gone".
 *
 * Guarded on still being on a fixture room, so it never steals focus from
 * somebody who has already clicked somewhere.
 */
/**
 * Looking at a room marks it read.
 *
 * Depends on `live.version` as well as the room id, so a message that lands
 * while the room is already open is marked too rather than sitting there as a
 * badge on the conversation you are staring at.
 */
$effect(() => {
  if (!live.running) return;
  void live.version;
  const roomId = core.currentRoomId;
  if (!roomId) return;
  // Tell the sink what is on screen, so a message in this room does not also
  // pop up as a desktop notification for a conversation you are reading.
  notifications.looking(roomId);
  notifications.clear(roomId);
  if (live.unread(roomId) === 0) return;
  void live.markRead(roomId);
});

/**
 * `/app` lands on **home**, not on a conversation.
 *
 * It used to reopen the last room, which was already better than the
 * first-in-the-list it replaced. But looking at a room marks it read, so *any*
 * automatic open silently clears a badge for a message nobody has seen. Home
 * is nobody's conversation, so it cannot do that — and it is the right place
 * for "start a new one" to live.
 *
 * The room you were in is still remembered below and still in the sidebar.
 * You just have to say so.
 */

/**
 * Remember the open room, so the next load comes back to it.
 *
 * `currentRoomId` is read *before* the guards on purpose. An effect only
 * depends on what it actually reads, so returning early on `opened` — a plain
 * `let`, and not reactive — would mean this never subscribed to the room id at
 * all and never ran again after the first time.
 */
$effect(() => {
  const roomId = core.currentRoomId;
  if (!live.running || !roomId) return;
  lastRoom.write(roomId);
});

const demo = page.url.searchParams.has('demo');

/**
 * Whether it is safe to render the app at all.
 *
 * Until `session.restore()` answers, this client does not know whether anybody
 * is signed in — and it used to render the whole fixture app in the meantime.
 * Signed out, that meant opening `/app` showed a complete fake Solexsis with
 * fake conversations before the redirect to `/signin` landed. Signed in, it
 * meant a second of somebody else's spaces before your own arrived.
 *
 * Neither is a loading state. Both are the app confidently showing data that
 * belongs to nobody, which is the single worst thing a chat client can do.
 */
let ready = $state(demo);

/**
 * Has SvelteKit's client router finished starting?
 *
 * `afterNavigate` fires once for the hydration navigation itself, which is the
 * documented signal that `goto`/`replaceState` are safe to call. `onMount` is
 * not — it runs *during* hydration, before the router marks itself started.
 */
let routed = $state(false);
afterNavigate(() => (routed = true));

if (demo) session.demo = true;

if (!demo) {
  void session.restore().then((restored) => {
    if (restored) ready = true;
    else void goto('/signin');
  });
}

/**
 * Finish a join that started on `/i/<code>`.
 *
 * That page has the words and this one has the stack, so it hands the code
 * over and the key comes back out of the stash — which is where it has been
 * since the fragment was read, and is the reason a detour through sign-up does
 * not lose it.
 *
 * Once, and only once the core is running: redeeming needs a signature from
 * this account's device, and there is no account until the stack exists.
 */
let joining = $state('');
let joinFailed = $state('');
let joined = false;
$effect(() => {
  const code = page.url.searchParams.get('join');
  if (!code || joined || !live.running) return;
  joined = true;
  const secret = readStash(code);
  if (!secret) {
    joinFailed = 'That invite link is missing the part after the #. Open it again from the message.';
    return;
  }
  joining = code;
  void live
    .stack!.core.directory.redeemInvite(code, secret)
    .then(async (result) => {
      clearStash();
      await live.refreshRooms();
      await live.refreshSpaces();
      // Straight in. The rooms are there; the *keys* arrive when a member's
      // client next syncs and commits the new leaf, which is the one part of
      // joining nobody here can hurry along.
      openSpace(result.space);
      joining = '';
    })
    .catch((err) => {
      console.error('could not join', err);
      joinFailed = whyNot(reasonOf(err));
      joining = '';
    });
});

const deepLink = page.url.searchParams.get('settings');
let settingsOpen = $state(!!deepLink);
let settingsSection = $state(deepLink ?? 'account');

const me = $derived(
  core.myFaces.find((f) => f.id === core.speakingHere) ??
    core.myFaces.find((f) => f.id === core.speakingAs) ??
    (live.running ? undefined : core.facesSeed[core.speakingAs]),
);
/** This account, as a person reads it: the handle when there is one. */
const myAddress = $derived(
  live.running
    ? (session.address || session.current?.handle || live.stack?.account.slice(0, 8) || '')
    : 'viola@revel.chat',
);

let commandOpen = $state(false);
let spaceOpen = $state(false);
let spaceTab = $state('overview');
let spaceRoom = $state<string | undefined>(undefined);
let editingFace = $state<string | null>(null);
let spaceHead = $state<HTMLElement>();

/** Every surface the command bar can reach is one the chrome can reach too
      — that is the rule, not a coincidence (`docs/12`). */
const cmdCtx = {
  openSettings: (section: string) => {
    settingsSection = section;
    settingsOpen = true;
  },
  openSpaceSettings: (tab = 'overview') => {
    spaceTab = tab;
    spaceRoom = undefined;
    spaceOpen = true;
  },
  openRoomSettings: (roomId: string) => {
    spaceTab = 'rooms';
    spaceRoom = roomId;
    spaceOpen = true;
  },
};

function onKey(e: KeyboardEvent) {
  // ⌘K is the command surface, ⌘F is search (`docs/19` — two keys, two jobs,
  // because merging them makes both worse).
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    commandOpen = !commandOpen;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === ',') {
    e.preventDefault();
    settingsOpen = true;
  }
  // ⌘F is search, and it is worth taking from the browser now that there is
  // something to take it for: find-in-page can only see the messages already
  // rendered, which is a fraction of a room and none of the others.
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    if (search.open) search.close();
    else search.show();
  }
  // Escape unwinds the most specific thing on screen, in the same order the
  // back ladder does — one key, one meaning.
  if (e.key === 'Escape') {
    if (drawers.open) drawers.close();
    else if (core.openThreadId) core.closeThread();
  }
}

/**
 * Right-clicking chrome that has no menu should do nothing, not open the
 * browser's.
 *
 * Anything with a menu of its own has already called `preventDefault` by the
 * time this runs, so it never sees those. What is left is the empty case —
 * right-clicking a header, a divider, the space between two rooms — where
 * the native menu offers Back, Reload and Save As, none of which mean
 * anything inside an app and all of which look like the app leaking.
 *
 * The exceptions are where the browser genuinely has something to give:
 * selected text, a field you can paste into, a link or an image. Those keep
 * their menu, because "copy that" is a real thing to want and reimplementing
 * it worse would be the actual mistake.
 */
function swallowEmptyContextMenu(e: MouseEvent) {
  if (e.defaultPrevented) return;
  const el = e.target instanceof Element ? e.target : null;
  if (
    el?.closest(
      'input, textarea, [contenteditable=""], [contenteditable="true"], a[href], img, video, audio',
    )
  ) {
    return;
  }
  // A selection means "copy" is on the menu, and copy is the one item worth
  // keeping everywhere.
  if (!window.getSelection()?.isCollapsed) return;
  e.preventDefault();
}

function openRoomMenu(e: MouseEvent, roomId: string) {
  const room = core.space.rooms.find((r) => r.id === roomId);
  if (!room) return;
  const resolved = core.notifyFor(core.currentSpaceId, roomId);
  contextMenu.open(
    e,
    // No "leave room" in a live space: membership is recomputed from the
    // room's audience, so leaving one you still match puts you back in.
    roomMenu(room, resolved, core.demo),
    (id) => {
      const [verb, arg] = id.split(':');
      if (verb === 'notify') {
        core.setRoomNotify(
          core.currentSpaceId,
          roomId,
          arg === 'inherit' ? undefined : (arg as NotifyLevel),
        );
      }
      if (id === 'mark-read') core.markRead(core.currentSpaceId, roomId);
      if (id === 'room-settings') cmdCtx.openRoomSettings(roomId);
      if (id === 'leave-room') core.leaveRoom(core.currentSpaceId, roomId);
    },
    `#${room.name}`,
  );
}

/**
 * Go to a space, landing on whichever room it has.
 *
 * A real space can have no rooms at all — the last one can be deleted, and a
 * room you have no audience for is a room you never see — so `rooms[0]!` is a
 * crash waiting for the first person it happens to. `openRoom` with an empty id
 * puts you in the space with nothing open, which is the truth.
 */
function openSpace(spaceId: string) {
  const space = core.spaces.find((s) => s.id === spaceId);
  core.openRoom(spaceId, space?.rooms[0]?.id ?? '');
}

/** The make-a-space sheet. */
let makingSpace = $state(false);
let newSpaceName = $state('');
let newSpaceBusy = $state(false);
let newSpaceError = $state('');

async function makeSpace(e: SubmitEvent) {
  e.preventDefault();
  newSpaceBusy = true;
  newSpaceError = '';
  const result = await core.createSpace(newSpaceName);
  newSpaceBusy = false;
  if (result.error) {
    newSpaceError = whyNot(result.error);
    return;
  }
  makingSpace = false;
  newSpaceName = '';
  navigated();
}

function openSpaceMenu(e: MouseEvent, spaceId = core.currentSpaceId) {
  const space = core.spaces.find((s) => s.id === spaceId);
  if (!space) return;
  if (spaceId !== core.currentSpaceId) openSpace(spaceId);
  contextMenu.open(
    e,
    spaceMenu(space),
    (id) => {
      if (id === 'space-settings') cmdCtx.openSpaceSettings();
      if (id === 'invite') cmdCtx.openSpaceSettings('invites');
      if (id === 'create-room') cmdCtx.openSpaceSettings('rooms');
      if (id === 'space-notify') cmdCtx.openSettings('notifications');
      if (id === 'server-sees') cmdCtx.openSettings('about');
      if (id === 'leave-space') cmdCtx.openSpaceSettings('danger');
    },
    space.name,
  );
}

/** Unread anywhere in Home, for the rail dot. */
const dmUnread = $derived(core.dms.some((d) => d.unread));

function openDmMenu(e: MouseEvent, id: string) {
  const dm = core.dms.find((d) => d.id === id);
  if (!dm) return;
  const level = dm.notify ?? core.notifications.global;
  contextMenu.open(
    e,
    [
      {
        id: 'notify:inherit',
        label: 'Use the default',
        header: 'Notifications',
        checked: !dm.notify,
      },
      { id: 'notify:everything', label: 'Everything', checked: dm.notify === 'everything' },
      { id: 'notify:mentions', label: 'Mentions', checked: dm.notify === 'mentions' },
      { id: 'notify:nothing', label: 'Nothing', checked: dm.notify === 'nothing' },
      {
        id: 'mark-read',
        label: 'Mark as read',
        icon: 'check',
        header: 'Conversation',
        disabled: !dm.unread,
      },
      { id: 'call', label: 'Start a call', icon: 'voice' },
      { id: 'close', label: 'Close conversation', icon: 'x', danger: true },
    ],
    (picked) => {
      const [verb, arg] = picked.split(':');
      if (verb === 'notify') {
        // Through `core`, not onto `dm`: a live DM is derived from the room
        // list, so a write to it is discarded on the next read and the rules
        // engine never sees it.
        core.setNotifyFor(dm.id, arg === 'inherit' ? undefined : (arg as NotifyLevel));
      }
      if (picked === 'mark-read') {
        // Live `dms` are derived from the room list, so writing to one is
        // writing to a value that gets rebuilt on the next read. The real
        // read marker lives in the sync engine.
        if (live.running) void live.markRead(dm.id);
        dm.unread = undefined;
        dm.mention = false;
      }
      if (picked === 'call') voice.startCall(dm.id);
      // Closing hides the conversation; it does not delete anything, and
      // messaging them again brings the same room back (the id is derived).
      if (picked === 'close') core.closeDm(dm.id);
    },
    dm.name ?? core.dmTitle(dm),
  );
}

function openMemberMenu(e: MouseEvent, faceId: string) {
  const face = core.faces[faceId];
  if (!face) return;
  contextMenu.open(
    e,
    memberMenu({ name: face.name, isAgent: !!face.agent, isMe: faceId === core.speakingAs }),
    (id) => {
      if (id === 'profile' || id === 'agent-info') core.profileFor = faceId;
      if (id === 'dm') core.openDm(faceId);
      if (id === 'block') cmdCtx.openSettings('privacy');
      if (id === 'verify') cmdCtx.openSettings('devices');
    },
    face.name,
  );
}

/** Where one of Wren's actions wants to take you. She uses the same routes
      the chrome does — there is no screen she can reach that you can't. */
function route(to: { settings?: string; members?: boolean }) {
  if (to.settings) {
    settingsSection = to.settings;
    settingsOpen = true;
  }
  if (to.members) core.membersOpen = true;
}

const categories = $derived(
  core.space.rooms.reduce<Record<string, typeof core.space.rooms>>((acc, r) => {
    (acc[r.category] ??= []).push(r);
    return acc;
  }, {}),
);

// ── mobile ────────────────────────────────────────────────────────────────

let navEl = $state<HTMLElement>();
let membersEl = $state<HTMLElement>();

/**
 * Mirror where we are into the address bar.
 *
 * `replaceState`, so refreshing lands you here and a link is shareable, but
 * changing room adds no history entry — see `deeplink.ts` for why that
 * matters to the back ladder.
 */
$effect(() => {
  // Everything read *before* the guard, on purpose. An effect depends on what
  // it actually read, so returning early on `ready` meant this never
  // subscribed to `settingsOpen` — the URL kept `?settings=account` after the
  // sheet had closed, because nothing told it to run again. Exactly the same
  // trap as the "remember the open room" effect below.
  const loc = {
    scope: core.scope,
    spaceId: core.currentSpaceId,
    roomId: core.currentRoomId,
    settings: settingsOpen ? settingsSection : undefined,
  };
  // Not before the app knows whose it is. This ran during the unknown window
  // and wrote whatever `core` was defaulting to, which is how a fresh visit to
  // `/app` flashed `?space=solexsis&room=design`.
  if (!ready) return;
  // Not before SvelteKit's router has started. `replaceState` *throws* when it
  // has not, and an effect that throws aborts the rest of the flush along with
  // it — which is how the touch layer used to die on mobile, several effects
  // further down. `?demo=1` hit it every single load, because `ready` is true
  // at init there rather than after an await.
  if (!routed) return;
  syncUrl(loc);
});

// Indexing starts with the app, not with the first search: the state worth
// showing is "still catching up", and you only see it if it began earlier.
$effect(() => untrack(() => search.start()));
// `untrack` is load-bearing: `watchConnection` seeds the state from
// `navigator.onLine`, and seeding reads `connection` to decide whether to
// flush the outbox. An effect that reads what it writes re-runs on its own
// write — here that meant re-seeding to "online" the instant anything set it
// to "offline". Same shape as the theme loop in `+layout.svelte`.
$effect(() => untrack(() => core.watchConnection()));

/**
 * Tell the gesture how wide the panels actually are, so the drag can be 1:1
 * with the thumb. Measured rather than hardcoded — the widths are `min()`
 * expressions in CSS and that stays the one place they are decided.
 *
 * Depends on `layout.narrow` only. Reading `drawers.x` here would make the
 * effect re-run on every frame of a drag, and writing a width back into the
 * store it just read from is the shape of loop that froze the app once
 * already.
 */
$effect(() => {
  if (!layout.narrow) return;
  if (navEl) drawers.setWidth('nav', navEl.offsetWidth);
  if (membersEl) drawers.setWidth('members', membersEl.offsetWidth);
});

/** Chat is the app; the drawer is transient (`docs/24`). Picking something
      from it is the end of its job, so it gets out of the way. */
function navigated() {
  if (layout.narrow) drawers.close();
}

// ── back ──────────────────────────────────────────────────────────────────

/** Remember where you have been, so back has somewhere to go. */
$effect(() => {
  const loc = {
    scope: core.scope,
    spaceId: core.currentSpaceId,
    roomId: core.currentRoomId,
  } as const;
  untrack(() => back.record({ ...loc }));
});

/**
 * Up a level, per the two rows of `docs/24`'s table that are about place
 * rather than about closing something:
 *
 *   in a room       → the room list drawer, opened
 *   in the room list → the previous space, or home
 *
 * The second row is the interesting one. Closing the drawer instead would
 * put you back in the room, where the next back press would open it again —
 * a loop that never reaches the top and never lets you leave the app.
 */
function goUp() {
  if (drawers.members) {
    drawers.close();
    return;
  }
  if (drawers.nav) {
    // Home with the room list open is the top of the ladder. From here the
    // next press is allowed to leave.
    if (core.scope === 'home') {
      drawers.close();
      return;
    }
    const prev = back.popTo((l) => l.scope === 'home' || l.spaceId !== core.currentSpaceId);
    if (prev && prev.scope === 'space') core.openRoom(prev.spaceId, prev.roomId);
    else core.openHome(prev?.roomId);
    return;
  }
  drawers.open_('nav');
}

/** `docs/24`: a call minimises, it does not hang up. Looking at the call is
      the same thing as being in its room, so leaving the view means going
      somewhere else — back to wherever you were before you joined. */
function minimiseCall() {
  const prev = back.popTo((l) => l.roomId !== core.currentRoomId);
  if (prev && prev.scope === 'space') core.openRoom(prev.spaceId, prev.roomId);
  else core.openHome(prev?.roomId);
}

/**
 * Everything back can undo, most general first — so the *last* entry is what
 * one press takes away, and `layers.length` is how many history entries we
 * need to own.
 *
 * One list rather than a chain of ifs in a handler: the count and the action
 * have to agree, and deriving both from the same array is what makes that
 * true by construction instead of by inspection.
 */
const layers = $derived.by(() => {
  const l: (() => void)[] = [];
  // Where you are. Phone only — on a desktop the rooms are always on screen,
  // so there is no "up" to go to and back should leave the app.
  if (layout.narrow && (core.scope === 'space' || drawers.open)) l.push(goUp);
  if (voice.viewingCall) l.push(minimiseCall);
  // `docs/24`'s first row, and the one that was honestly absent until now:
  // "a thread → its room". Below the sheets, above the room itself.
  if (core.openThreadId) l.push(() => core.closeThread());
  // Below the sheets on purpose. A search panel is somewhere you stay while
  // you read the room behind it, so back should take a sheet off the top of
  // it first and only then put the panel away.
  if (search.open) l.push(() => search.close());
  if (settingsOpen) l.push(() => (settingsOpen = false));
  if (spaceOpen) l.push(() => (spaceOpen = false));
  if (commandOpen) l.push(() => (commandOpen = false));
  if (core.speakingAsOpen) l.push(() => (core.speakingAsOpen = false));
  if (core.profileFor) l.push(() => (core.profileFor = null));
  if (lightbox.open) l.push(() => lightbox.close());
  if (wren.popup) l.push(() => (wren.popup = null));
  if (onboarding.open) l.push(() => onboarding.dismiss());
  // A context menu sits over all of it, so it is always the first thing to go.
  if (contextMenu.current) l.push(() => contextMenu.close());
  return l;
});

$effect(() => back.sync(layers.length));

// Reads `layers` only when the callback fires, which is outside the effect's
// tracking — so this attaches one listener for the life of the page rather
// than re-attaching on every state change.
$effect(() =>
  back.attach(
    () => layers.length,
    () => layers[layers.length - 1]?.(),
  ),
);

/** The members list is a column on a desktop and a drawer on a phone. Same
      button, same meaning, two mechanisms. */
function toggleMembers() {
  if (layout.narrow) drawers.toggle('members');
  else core.membersOpen = !core.membersOpen;
}
</script>

<!-- The drawer gesture listens on the window, not the shell, so a swipe that
     starts on a drawer and ends off the edge of the screen still resolves —
     and so the app root does not have to pretend to be an interactive
     element to carry the handlers. -->
<svelte:window
  oncontextmenu={swallowEmptyContextMenu}
  onkeydown={onKey}
  onpointerdown={(e) => layout.narrow && drawers.down(e)}
  onpointermove={(e) => layout.narrow && drawers.move(e)}
  onpointerup={(e) => drawers.up(e)}
  onpointercancel={() => drawers.cancel()}
/>

{#if !ready}
  <!-- Deliberately almost nothing. A spinner would be a claim that something
       is coming; this is the half-second before the app knows whose it is. -->
  <div class="waiting" aria-busy="true"></div>
{:else}
<div
  class="shell"
  class:no-members={!core.membersOpen}
  class:narrow={layout.narrow}
  class:dragging={drawers.dragging}
  class:drawer-open={drawers.open}
  style="--nav-open: {drawers.nav}; --mem-open: {drawers.members}"
>
  <!-- Rail and rooms are two columns on a desktop and one drawer on a phone,
       so they need a wrapper to slide together. `display: contents` makes it
       disappear at desktop widths, leaving the four-column grid untouched —
       the alternative is a second copy of the navigation markup for mobile,
       and two copies of anything diverge. -->
  <div class="nav" bind:this={navEl} inert={layout.narrow && !drawers.nav}>
  <nav class="rail" aria-label="Spaces">
    <button
      class="home"
      class:active={core.scope === 'home'}
      onclick={() => core.openHome()}
      title="Direct messages"
      aria-label="Direct messages"
    >
      <Icon name="send" size={19} />
      {#if dmUnread}<span class="rail-dot" aria-label="unread"></span>{/if}
    </button>
    <hr class="rail-sep" />

    <!-- `core.spaces` is the fixtures in the demo and the real ones otherwise,
         never both. It used to be fixtures-or-nothing, because there was no
         such thing as a real space — showing Solexsis to somebody who signed
         up an hour ago let them click into a stranger's conversation and read
         it as their own. -->
    {#each core.spaces as space (space.id)}
      <button
        class="space"
        class:active={core.scope === 'space' && space.id === core.currentSpaceId}
        style="--from: var(--face-{space.from}); --to: var(--face-{space.to})"
        onclick={() => { openSpace(space.id); navigated(); }}
        oncontextmenu={(e) => openSpaceMenu(e, space.id)}
        use:longpress={(e) => openSpaceMenu(e, space.id)}
        title={space.name}
      >{space.initial}</button>
    {/each}
    <button
      class="space add"
      title={live.running ? 'Make a space' : 'Sign in to make a space'}
      aria-label="Make a space"
      disabled={!live.running}
      onclick={() => (makingSpace = true)}
    ><Icon name="plus" size={20} /></button>
  </nav>

  <aside class="sidebar">
    {#if core.scope === 'home'}
      <header class="space-head static">
        <span class="sh-nm">Direct messages</span>
        {#if live.running}
          <!-- Only when there is a real directory to ask. Without an account
               the fixtures are the list, and a box that resolved nothing would
               be a promise the demo cannot keep. -->
          <button
            class="sh-add"
            title="Start a conversation"
            aria-haspopup="menu"
            onclick={(e) => {
              dmError = '';
              contextMenu.open(
                e,
                [
                  { id: 'dm', label: 'Message someone', icon: 'plus' },
                  { id: 'group', label: 'New group', icon: 'people' },
                ],
                (picked) => {
                  startingKind = picked === 'group' ? 'group' : 'dm';
                  startingDm = true;
                },
                'Start a conversation',
              );
            }}
          >
            <Icon name="plus" size={16} />
          </button>
        {/if}
      </header>

      {#if startingDm}
        <form
          class="new-dm"
          onsubmit={async (e) => {
            e.preventDefault();
            dmBusy = true;
            const result =
              startingKind === 'group'
                ? await core.startGroup(dmHandle.split(','))
                : await core.startDm(dmHandle);
            dmBusy = false;
            if (result.error) {
              dmError = whyNot(result.error);
              return;
            }
            startingDm = false;
            dmHandle = '';
            navigated();
          }}
        >
          <input
            bind:value={dmHandle}
            placeholder={startingKind === 'group' ? 'names, separated by commas' : 'handle'}
            aria-label={startingKind === 'group'
              ? 'Who is in the group?'
              : 'Who do you want to message?'}
            autocomplete="off"
          />
          <button type="submit" disabled={dmBusy || !dmHandle.trim()}>
            {dmBusy ? '…' : 'Start'}
          </button>
          {#if dmError}<p class="new-dm-err" role="alert">{dmError}</p>{/if}
        </form>
      {/if}

      <div class="rooms">
        {#each core.dms as dm (dm.id)}
          <button
            class="room dm"
            class:active={dm.id === core.currentRoomId}
            class:unread={!!dm.unread}
            onclick={() => { core.openHome(dm.id); navigated(); }}
            oncontextmenu={(e) => openDmMenu(e, dm.id)}
            use:longpress={(e) => openDmMenu(e, dm.id)}
          >
            {#if dm.kind === 'group'}
              <span class="stack">
                {#each dm.withIds.slice(0, 2) as id (id)}
                  <Avatar face={core.faces[id]!} size={20} />
                {/each}
              </span>
            {:else}
              <Avatar face={core.faces[dm.withIds[0]!]!} size={24} dot />
            {/if}
            <span class="name">{dm.name ?? core.dmTitle(dm)}</span>
            {#if dm.mention}
              <span class="pill">{dm.unread}</span>
            {:else if dm.unread}
              <span class="dot" aria-label="unread"></span>
            {/if}
          </button>
        {:else}
          <div class="no-dms">
            <b>No conversations yet.</b>
            <span>When someone messages you or you message them, it'll show up here.</span>
          </div>
        {/each}
      </div>
    {:else}
    <button
      class="space-head"
      bind:this={spaceHead}
      onclick={(e) => openSpaceMenu(e)}
      oncontextmenu={(e) => openSpaceMenu(e)}
      use:longpress={(e) => openSpaceMenu(e)}
      title="{core.space.name} — settings and invites"
    >
      <span class="sh-nm">{core.space.name}</span>
      <Icon name="chevron" size={16} />
    </button>
    <div class="rooms">
      {#if !core.space.rooms.length}
        <!-- A space genuinely can have no rooms you can see: the last one can
             be deleted, and a room whose audience you do not match is a room
             you never learn exists. Saying so beats an empty column. -->
        <div class="no-dms">
          <b>No rooms here yet.</b>
          <span>Make one from the space menu above.</span>
        </div>
      {/if}
      {#each Object.entries(categories) as [category, rooms] (category)}
        <div class="cat">{category}</div>
        {#each rooms as room (room.id)}
          <button
            class="room"
            class:active={room.id === core.currentRoomId}
            class:unread={!!room.unread}
            class:quiet={core.notifyFor(core.currentSpaceId, room.id).level === 'nothing'}
            onclick={() => {
              core.openRoom(core.currentSpaceId, room.id);
              // A voice room is a place you walk into: one click puts you in
              // it, muted (`docs/21`). No modal, no device wizard.
              if (room.kind === 'voice' && voice.roomId !== room.id) {
                voice.join(core.currentSpaceId, room.id);
              }
              navigated();
            }}
            oncontextmenu={(e) => openRoomMenu(e, room.id)}
            use:longpress={(e) => openRoomMenu(e, room.id)}
          >
            <span class="glyph">
              {#if room.kind === 'voice'}<Icon name="voice" size={15} />{:else}#{/if}
            </span>
            <span class="name">{room.name}</span>
            {#if room.mention}
              <span class="pill">{room.unread}</span>
            {:else if room.unread}
              <span class="dot" aria-label="unread"></span>
            {/if}
          </button>
          <!-- Threads you are actually in, under the room they branch off.
               `docs/16`: a thread is a branch inside a room, so it belongs
               under the room rather than beside it in a list of its own — and
               only the ones you have spoken in, because every branch anybody
               ever started is a list nobody reads. -->
          {#if room.id === core.currentRoomId && conversation.myThreads(room.id).length}
            <div class="threads">
              {#each conversation.myThreads(room.id) as t (t.parent)}
                <button
                  class="thread"
                  class:active={core.openThreadId === t.parent}
                  onclick={() => { core.openThread(t.parent); navigated(); }}
                >
                  <Icon name="forward" size={13} />
                  <span class="th-nm">{conversation.label(t, room.id)}</span>
                  <span class="th-n">{t.count}</span>
                </button>
              {/each}
            </div>
          {/if}
          {#if room.kind === 'voice' && room.inCall?.length}
            <!-- Occupants before you commit, so you can see who's in there
                 without joining to find out (`docs/21`). -->
            <div class="incall">
              {#each room.inCall as id (id)}
                {#if core.faces[id]}
                  <button
                    class="occupant"
                    onclick={() => (core.profileFor = id)}
                    oncontextmenu={(e) => openMemberMenu(e, id)}
                    use:longpress={(e) => openMemberMenu(e, id)}
                  >
                    <Avatar face={core.faces[id]} size={18} />
                    <span>{core.faces[id].name}</span>
                  </button>
                {/if}
              {/each}
            </div>
          {/if}
        {/each}
      {/each}
    </div>
    {/if}

    {#if voice.inCall && !voice.viewingCall}
      <CallBar />
    {/if}

    <div class="me">
      <button class="me-id" onclick={() => (core.profileFor = core.speakingAs)} title="You">
        <Avatar face={me} size={30} dot />
        <span class="me-meta">
          <!-- The face speaking here, and the address underneath it. Every
               account has at least one face now — made from the handle at
               sign-in — so the name is always its own rather than a fixture's,
               which is what it used to fall through to. -->
          <span class="me-nm">{me?.name ?? myAddress}</span>
          <span class="me-sub">{myAddress}</span>
        </span>
      </button>
      <!-- A gear, not a chevron. It was a chevron, which reads as "expand
           this" — and on a phone this button is the *only* way into settings,
           because the keyboard shortcut isn't there and neither is anything
           else in the chrome. -->
      <button
        class="me-btn"
        onclick={() => (settingsOpen = true)}
        title="Settings"
        aria-label="Settings"
      ><Icon name="gear" size={18} /></button>
    </div>
  </aside>
  </div>

  {#if layout.narrow}
    <!-- Tracks the drag rather than fading in on a timer, so the dimming is
         part of the same gesture as the panel. Not a <button>: it is a
         dismiss target, and the thing it dismisses is already reachable from
         a real labelled control in the header. -->
    <div
      class="drawer-scrim"
      onclick={() => drawers.close()}
      role="presentation"
    ></div>
  {/if}

  <!-- With a drawer fully open the conversation is behind a scrim, so it
       should be out of the tab order too. Only at *fully* open: `inert` also
       blocks pointer events, and an edge-swipe starts its drag on this
       element — going inert on the first millimetre would kill the gesture
       that is opening the drawer. -->
  <main class="chat" inert={layout.narrow && (drawers.nav === 1 || drawers.members === 1)}>
    <!--
      Home is not a room, so the room's chrome does not belong to it. A `Call`
      button with nobody to call and a member list reading `IN THIS ROOM — 0`
      are both offers the app cannot keep.
    -->
    {#if !(live.running && !core.currentRoomId)}
    <header class="chat-head">
      {#if layout.narrow}
        <!-- The drawer is reachable by swiping from the edge, but a gesture
             nobody can see is not an affordance. This is the visible one. -->
        <button
          class="icon-btn"
          onclick={() => drawers.toggle('nav')}
          aria-label="Spaces and rooms"
          aria-expanded={drawers.nav === 1}
        ><Icon name="menu" size={20} /></button>
      {/if}
      <span class="glyph">
        {#if core.scope === 'home'}<Icon name="send" size={17} />
        {:else if core.room.kind === 'voice'}<Icon name="voice" />
        {:else}#{/if}
      </span>
      <h1>{core.room.name}</h1>
      <div class="spacer"></div>
      {#if !connection.quiet}
        <!-- One dot, and only when there is something to say. `docs/24` is
             specific about the shape: not a banner, not a modal, not a toast
             per reconnect — a phone's connection comes and goes all day, and
             an app that narrates each one is exhausting to carry around. -->
        <span
          class="conn"
          class:offline={core.connection === 'offline'}
          role="status"
          title={core.connection === 'offline'
            ? 'Offline. Messages you send will go out when the connection returns.'
            : 'Reconnecting.'}
          aria-label={core.connection === 'offline' ? 'Offline' : 'Reconnecting'}
        ></span>
      {/if}
      {#if core.room.kind === 'voice' && voice.roomId !== core.currentRoomId}
        <button class="join" onclick={() => voice.join(core.currentSpaceId, core.currentRoomId)}>
          <Icon name="voice" size={15} /> Join
        </button>
      {:else if core.scope === 'home' && voice.roomId !== core.currentRoomId}
        <!-- A DM call rings rather than being somewhere you walk into
             (`docs/21`), so the affordance is Call, not Join. -->
        <button class="join" onclick={() => voice.startCall(core.currentRoomId)}>
          <Icon name="voice" size={15} /> Call
        </button>
      {/if}
      <button
        class="icon-btn"
        aria-pressed={search.open}
        onclick={() => (search.open ? search.close() : search.show())}
        title="Search messages (⌘F)"
        aria-label="Search messages"
      ><Icon name="search" size={19} /></button>
      <button
        class="icon-btn"
        onclick={() => (commandOpen = true)}
        title="Commands (⌘K)"
        aria-label="Command bar"
      ><Icon name="sparkle" size={19} /></button>
      <WrenSurface onroute={route} />
      <button
        class="icon-btn"
        aria-pressed={layout.narrow ? drawers.members === 1 : core.membersOpen}
        onclick={toggleMembers}
        title="Members"
      ><Icon name="people" size={20} /></button>
    </header>

    <!-- Under the room header, above the conversation. Somebody putting real
         messages into a pre-alpha E2EE app is owed one sentence about whether
         they will survive, and it belongs where they are typing rather than
         buried in settings. Only for a signed-in account: the demo has nothing
         to lose. -->
    {#if live.running}<BetaNotice />{/if}

    {/if}

    {#if voice.viewingCall}
      <CallStage />
    {:else if live.running && !core.currentRoomId}
      <!-- No conversation open. Not an empty message list with a composer
           under it — there is nothing to compose *to*. -->
      <DmHome />
    {:else}
      {#key core.currentRoomId}
        <div class="fade"><MessageList /></div>
      {/key}
      <Composer />
    {/if}
  </main>

  {#if joining || joinFailed}
    <!-- A join is the one thing that can be in flight while the app is
         otherwise idle, and it is the reason this person opened the tab. It
         says so rather than leaving them looking at an empty rail wondering
         whether the link worked. -->
    <div class="joining" role="status">
      {#if joining}
        <span>Joining…</span>
      {:else}
        <span>{joinFailed}</span>
        <button onclick={() => (joinFailed = '')} aria-label="Dismiss">
          <Icon name="x" size={15} />
        </button>
      {/if}
    </div>
  {/if}

  {#if makingSpace}
    <!-- `docs/18`: "A new space arrives with `#general`, an `@everyone` role,
         one audience, and you in it. No wizard." So: one field. Everything
         else is a setting you change afterwards, in a screen built for it. -->
    <div
      class="sheet-scrim"
      role="button"
      tabindex="-1"
      aria-label="Close"
      onclick={() => (makingSpace = false)}
      onkeydown={(e) => e.key === 'Escape' && (makingSpace = false)}
    ></div>
    <form class="make-space" onsubmit={makeSpace}>
      <h2>Make a space</h2>
      <p>
        It arrives with a <b>#general</b>, an <b>@everyone</b> role, and you in
        it. Nobody else can see it until you invite them.
      </p>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        bind:value={newSpaceName}
        placeholder="What's it called?"
        aria-label="Space name"
        autocomplete="off"
        autofocus
        maxlength="200"
      />
      {#if newSpaceError}<p class="err">{newSpaceError}</p>{/if}
      <div class="acts">
        <button type="submit" class="go" disabled={newSpaceBusy || !newSpaceName.trim()}>
          {newSpaceBusy ? 'Making it…' : 'Make it'}
        </button>
        <button type="button" class="cancel" onclick={() => (makingSpace = false)}>Cancel</button>
      </div>
    </form>
  {/if}

  <SettingsOverlay bind:open={settingsOpen} bind:section={settingsSection} bind:face={editingFace} />
  <SpaceSettings bind:open={spaceOpen} bind:tab={spaceTab} bind:room={spaceRoom} />
  <CommandBar bind:open={commandOpen} ctx={cmdCtx} />
  <ContextMenu />

  {#if search.open}<SearchPanel />{/if}
  {#if core.openThreadId}<ThreadPanel />{/if}

  {#if voice.incoming}<IncomingCall />{/if}

  {#if onboarding.open}<Onboarding onclose={() => onboarding.dismiss()} />{/if}

  {#if core.profileFor}
    <ProfileCard
      faceId={core.profileFor}
      onclose={() => (core.profileFor = null)}
      onedit={(id) => {
        editingFace = id;
        settingsSection = 'faces';
        settingsOpen = true;
      }}
    />
  {/if}

  <!-- On a phone this is always mounted, because a drawer you can drag has to
       exist before the drag starts; `--mem-open` is what hides it. On a
       desktop it is a real column and `membersOpen` decides. -->
  <!-- Not on home: there is no room to be in. -->
  {#if (core.membersOpen || layout.narrow) && !(live.running && !core.currentRoomId)}
    <aside class="members" bind:this={membersEl} aria-label="Members" inert={layout.narrow && !drawers.members}>
      <div class="cat">In this room — {core.roster.length}</div>
      {#each core.roster as face (face.id)}
        <button
          class="member"
          onclick={() => (core.profileFor = face.id)}
          oncontextmenu={(e) => openMemberMenu(e, face.id)}
          use:longpress={(e) => openMemberMenu(e, face.id)}
        >
          <Avatar {face} size={32} dot />
          <div class="who">
            <div class="nm" style="color: var(--face-{face.colour})">
              {face.name}
              {#if face.agent}<span class="badge">{face.agent.label}</span>{/if}
            </div>
            {#if face.agent}
              <!-- The security statement, not the badge. Never customisable. -->
              <div class="sub">can read this room</div>
            {:else if face.accountId === MY_ACCOUNT && face.id !== 'viola'}
              <div class="sub">another of your faces</div>
            {/if}
          </div>
        </button>
      {/each}
    </aside>
  {/if}
</div>
{/if}

<style>
  .waiting { height: var(--app-h, 100dvh); background: var(--ground-0); }
  .shell {
    display: grid;
    grid-template-columns: 76px 250px 1fr 240px;
    /* `--app-h` is the visible viewport, which on a phone is the screen minus
       the on-screen keyboard (`layout.svelte.ts`). `100dvh` is the fallback and
       what every desktop uses — dvh handles a collapsing URL bar but nothing
       handles the keyboard, and without this the composer types underneath it. */
    height: var(--app-h, 100dvh);
    transition: grid-template-columns var(--t-base) var(--ease);
  }
  .shell.no-members { grid-template-columns: 76px 250px 1fr 0px; }

  .rail {
    background: var(--ground-1); border-right: 1px solid var(--line);
    display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 12px 0;
  }
  .space {
    width: 48px; height: 48px; border: 0; cursor: pointer; position: relative;
    border-radius: var(--r-md); color: #fff; font-weight: 800; font-size: 16px;
    background: linear-gradient(160deg, var(--from), var(--to));
    transition: border-radius var(--t-base) var(--ease-toy), transform var(--t-fast) var(--ease);
  }
  .space:hover { border-radius: var(--r-sm); }
  .space:active { transform: scale(0.94); }
  .space.add { background: var(--ground-3); color: var(--text-mute); display: grid; place-items: center; }
  /* The selection indicator grows from nothing — the thing you did gets the
     visible motion (docs/32). */
  .space.active::before {
    content: ''; position: absolute; left: -14px; top: 50%; translate: 0 -50%;
    width: 4px; height: 26px; border-radius: var(--r-pill); background: var(--text);
    animation: grow var(--t-base) var(--ease);
  }
  @keyframes grow { from { height: 0; opacity: 0; } to { height: 26px; opacity: 1; } }

  .sidebar { background: var(--ground-1); border-right: 1px solid var(--line); display: flex; flex-direction: column; overflow: hidden; }
  /* The space name is the space menu — the affordance Discord taught
     everyone, and the only place a space-wide action is obviously reachable. */
  .space-head {
    display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
    padding: 14px 16px; border: 0; border-bottom: 1px solid var(--line);
    background: transparent; cursor: pointer; color: var(--text);
    font-family: var(--font-display); font-weight: 600; font-size: var(--text-lg);
    transition: background var(--t-fast) var(--ease);
  }
  .space-head:hover { background: var(--ground-2); }
  .sh-nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .space-head :global(svg) { color: var(--text-mute); }

  .join {
    display: inline-flex; align-items: center; gap: 6px; flex: none;
    min-height: var(--tap);
    border: 0; cursor: pointer; font: inherit; font-size: 12px; font-weight: 700;
    background: var(--face-mint); color: var(--ground-0);
    padding: 6px 13px; border-radius: var(--r-pill);
  }
  .join:hover { filter: brightness(1.06); }
  /* Sits in the header rather than floating: "message someone" is a property
     of the list, and a button that hovers over rows is one people click by
     accident while scrolling. */
  /*
    The visible box **is** the button, so the shading and the glyph cannot
    disagree — which they did twice: once as a rotated diamond behind a square
    icon, and once as a pseudo-element centred on the button while the glyph
    sat two pixels off its centre. Anything drawn separately from the thing it
    is drawn around eventually drifts from it.

    The 44px tap target `docs/24` asks for is a transparent `::after` instead.
    A hit area is invisible by definition, so it is the half that can afford to
    be a separate box.
  */
  .sh-add {
    margin-left: auto; position: relative;
    display: grid; place-items: center; cursor: pointer;
    width: 30px; height: 30px;
    border: 0; border-radius: var(--r-sm);
    background: var(--ground-3); color: var(--text-2);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
  }
  .sh-add::after {
    content: ''; position: absolute;
    inset: calc((var(--tap) - 30px) / -2);
  }
  .sh-add:hover { background: var(--ground-4); color: var(--text); }

  .new-dm { display: flex; gap: 6px; padding: 6px 10px 8px; flex-wrap: wrap; }
  .new-dm input {
    flex: 1; min-width: 0; font: inherit; font-size: var(--text-sm);
    padding: 7px 10px; min-height: var(--tap);
    border-radius: var(--r-sm); border: 1px solid var(--line);
    background: var(--ground-1); color: var(--text);
  }
  .new-dm button {
    font: inherit; font-size: var(--text-sm); font-weight: 600; cursor: pointer;
    padding: 0 12px; min-height: var(--tap); border: 0; border-radius: var(--r-sm);
    background: var(--accent); color: var(--on-accent);
  }
  .new-dm button:disabled { opacity: .5; cursor: default; }
  /* The muted warning tone, not red: a handle nobody has is a typo, not an
     alarm (`docs/08`). */
  .new-dm-err {
    flex-basis: 100%; margin: 2px 0 0; font-size: var(--text-xs);
    color: color-mix(in oklab, var(--text) 66%, transparent);
  }

  .joining {
    position: fixed; z-index: 64; left: 50%; translate: -50% 0; top: 16px;
    display: flex; align-items: center; gap: 10px;
    padding: 10px 14px; border-radius: 999px;
    border: 1px solid var(--line); background: var(--ground-2);
    box-shadow: var(--shadow-lg); font-size: var(--text-sm);
    max-width: min(46rem, calc(100vw - 32px));
  }
  .joining button {
    flex: none; display: grid; place-items: center; cursor: pointer;
    width: 24px; height: 24px; border: 0; border-radius: 50%;
    background: transparent; color: var(--text-mute);
  }
  .joining button:hover { color: var(--text); }

  .sheet-scrim {
    position: fixed; inset: 0; z-index: 60; border: 0; padding: 0;
    background: color-mix(in oklab, var(--ground-0) 62%, transparent);
    backdrop-filter: blur(2px);
  }
  .make-space {
    position: fixed; z-index: 61; top: 50%; left: 50%; translate: -50% -50%;
    width: min(380px, calc(100vw - 32px));
    display: flex; flex-direction: column; gap: 10px;
    padding: 20px; border-radius: var(--r-lg);
    border: 1px solid var(--line); background: var(--ground-1);
    box-shadow: var(--shadow-lg);
  }
  .make-space h2 { margin: 0; font-size: var(--text-lg); }
  .make-space p { margin: 0; font-size: var(--text-sm); color: var(--text-mute); }
  .make-space input {
    font: inherit; padding: 9px 11px; min-height: var(--tap);
    border-radius: var(--r-sm); border: 1px solid var(--line);
    background: var(--ground-0); color: var(--text);
  }
  .make-space .err { color: var(--text); font-size: var(--text-xs); }
  .make-space .acts { display: flex; gap: 8px; }
  .make-space .go {
    font: inherit; font-weight: 600; cursor: pointer; flex: 1;
    padding: 0 14px; min-height: var(--tap); border: 0; border-radius: var(--r-sm);
    background: var(--accent); color: var(--on-accent);
  }
  .make-space .go:disabled { opacity: .5; cursor: default; }
  .make-space .cancel {
    font: inherit; cursor: pointer; padding: 0 14px; min-height: var(--tap);
    border: 1px solid var(--line); border-radius: var(--r-sm);
    background: transparent; color: var(--text);
  }

  .rooms { overflow-y: auto; padding: 10px 8px; flex: 1; }

  /* Bottom-left, where every chat client puts the "you" area. */
  .me {
    display: flex; align-items: center; gap: 4px; flex: none;
    padding: 8px; border-top: 1px solid var(--line); background: var(--ground-2);
  }
  .me-id {
    display: flex; align-items: center; gap: 9px; flex: 1; min-width: 0;
    background: transparent; border: 0; cursor: pointer; color: var(--text);
    padding: 4px 6px; border-radius: var(--r-sm); text-align: left;
    min-height: var(--tap);
    transition: background var(--t-fast) var(--ease);
  }
  .me-id:hover { background: var(--ground-3); }
  .me-meta { min-width: 0; display: flex; flex-direction: column; }
  .me-nm { font-weight: 700; font-size: var(--text-sm); line-height: 1.2; }
  .me-sub {
    font-size: 11px; color: var(--text-mute); font-family: var(--font-mono);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .me-btn {
    flex: none; width: 30px; height: 30px; border: 0; cursor: pointer;
    min-width: var(--tap); min-height: var(--tap);
    background: transparent; color: var(--text-mute); border-radius: var(--r-sm);
    display: grid; place-items: center;
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease),
      rotate var(--t-base) var(--ease);
  }
  .me-btn:hover { background: var(--ground-3); color: var(--text); rotate: 90deg; }
  .cat {
    font-size: 11px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase;
    color: var(--text-mute); padding: 12px 8px 4px;
  }
  .room {
    display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
    padding: 7px 10px; border: 0; background: transparent; cursor: pointer;
    min-height: var(--tap);
    border-radius: var(--r-sm); color: var(--text-mute); font-weight: 600;
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
  }
  .room { position: relative; }
  .room:hover { background: var(--ground-2); color: var(--text-dim); }
  .room.active { background: var(--ground-3); color: var(--text); }
  /* The active room gets a marker that grows in, so the selection reads as
     something that moved rather than something that blinked (docs/32). */
  .room.active::before {
    content: ''; position: absolute; left: 0; top: 50%; translate: 0 -50%;
    width: 3px; height: 60%; border-radius: var(--r-pill); background: var(--brand);
    animation: mark var(--t-base) var(--ease);
  }
  @keyframes mark { from { height: 0; opacity: 0; } to { height: 60%; opacity: 1; } }
  .room.unread { color: var(--text); }
  /* A room set to notify about nothing still counts unread, it just reads
     quieter in the list. Otherwise the setting is invisible. */
  .room.quiet { opacity: .55; }

  /* Home is a peer of the spaces, not one of them, so it sits above a rule
     rather than in the same run of icons. */
  .home {
    position: relative; width: 48px; height: 48px; flex: none; margin-bottom: 4px;
    display: grid; place-items: center; border: 0; cursor: pointer;
    border-radius: var(--r-lg); background: var(--ground-3); color: var(--text-dim);
    transition: background var(--t-base) var(--ease), color var(--t-base) var(--ease),
      border-radius var(--t-base) var(--ease);
  }
  .home:hover { border-radius: var(--r-md); color: var(--text); }
  .home.active { background: var(--brand); color: #fff; border-radius: var(--r-md); }
  .rail-sep { width: 24px; border: 0; border-top: 1px solid var(--line); margin: 4px 0 8px; }
  .rail-dot {
    position: absolute; right: 4px; top: 4px; width: 9px; height: 9px;
    border-radius: 50%; background: var(--face-rose);
    box-shadow: 0 0 0 2px var(--ground-0);
  }

  .space-head.static { cursor: default; }
  .room.dm { gap: 9px; }
  /* Two overlapping avatars for a group, so a group reads as one at a glance. */
  .stack { display: flex; flex: none; }
  .stack > :global(*:last-child) { margin-left: -8px; box-shadow: 0 0 0 2px var(--ground-1); }

  .no-dms { padding: 22px 14px; text-align: center; }
  .no-dms b { display: block; font-size: var(--text-sm); margin-bottom: 4px; }
  .no-dms span { font-size: 12px; color: var(--text-mute); line-height: 1.5; }

  .threads {
    display: flex; flex-direction: column; gap: 1px;
    margin: 0 0 3px 26px; padding-left: 9px;
    /* A hairline that says "these hang off the room above" without drawing a
       whole tree. `docs/07`: structure by alignment, not by boxes. */
    border-left: 1px solid var(--line);
  }
  .thread {
    display: flex; align-items: center; gap: 6px;
    padding: 3px 7px; border: 0; background: none; border-radius: var(--r-xs);
    color: var(--text-mute); font: inherit; font-size: var(--text-xs);
    cursor: pointer; text-align: left; width: 100%;
    /* A thread is a room you can be in, listed among rooms — it should be no
       harder to hit than the room above it. It stays visually smaller; only
       the box grows. */
    min-height: var(--tap);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
  }
  .thread:hover { background: var(--ground-3); color: var(--text); }
  .thread.active { background: var(--ground-3); color: var(--text); font-weight: 600; }
  .th-nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .th-n { font-variant-numeric: tabular-nums; opacity: .7; }

  .incall { display: flex; flex-direction: column; gap: 1px; margin: 0 0 4px 30px; }
  .occupant {
    display: flex; align-items: center; gap: 7px; width: 100%; text-align: left;
    border: 0; background: transparent; cursor: pointer; font: inherit;
    min-height: var(--tap);
    font-size: 12px; color: var(--text-mute); padding: 3px 8px; border-radius: var(--r-sm);
  }
  .occupant:hover { background: var(--ground-2); color: var(--text-dim); }
  .room .glyph { opacity: .6; display: grid; place-items: center; width: 15px; }
  .room .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .room .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text); flex: none; }
  .room .pill {
    background: var(--face-rose); color: #fff; font-size: 11px; font-weight: 800;
    border-radius: var(--r-pill); padding: 1px 7px;
  }

  .chat { display: flex; flex-direction: column; overflow: hidden; background: var(--ground-0); min-width: 0; }
  .chat-head {
    display: flex; align-items: center; gap: 10px; padding: 12px 16px;
    border-bottom: 1px solid var(--line); flex: none;
  }
  .chat-head h1 { margin: 0; font-size: var(--text-lg); font-weight: 700; }
  .chat-head .glyph { color: var(--text-mute); display: grid; place-items: center; }
  .spacer { flex: 1; }

  .conn {
    flex: none; width: 8px; height: 8px; border-radius: 50%; margin-right: 2px;
    background: var(--face-gold);
    animation: breathe 1.8s ease-in-out infinite;
  }
  /* Rose, not red-alert: being offline is a state, not an error, and the app
     keeps working. The dot's job is to explain why a message is sitting
     pending, not to demand anything. */
  .conn.offline { background: var(--face-rose); animation: none; }
  @keyframes breathe { 50% { opacity: .35; } }
  .icon-btn {
    border: 0; background: transparent; color: var(--text-dim); cursor: pointer;
    width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center;
    min-width: var(--tap); min-height: var(--tap);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
  }
  .icon-btn:hover { background: var(--ground-2); color: var(--text); }
  .icon-btn:active { transform: scale(0.9); }
  .icon-btn[aria-pressed='true'] { color: var(--text); background: var(--ground-3); }

  /* Room content cross-fades; the sidebar selection is what moves. A slide
     here would fight the promise that switching is instant (docs/32). */
  .fade { flex: 1; min-height: 0; animation: fade var(--t-fast) var(--ease); }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }

  .members { background: var(--ground-1); border-left: 1px solid var(--line); overflow: hidden auto; padding: 8px 10px; }
  /* This became a <button> when members got a context menu, and buttons come
     with a user-agent background, border and centred text — which is why the
     rows turned into white boxes. Resetting all three is not optional when you
     promote a div to a button. */
  .member {
    display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
    padding: 6px 8px; border: 0; border-radius: var(--r-sm); min-height: var(--tap);
    background: transparent; color: inherit; font: inherit;
    cursor: pointer; transition: background var(--t-fast) var(--ease);
  }
  .member:hover { background: var(--ground-2); }
  .who { min-width: 0; }
  .nm { font-weight: 600; font-size: var(--text-sm); display: flex; align-items: center; gap: 6px; }
  .sub { font-size: 11px; color: var(--text-mute); }
  .badge {
    font-size: 10px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
    padding: 1px 6px; border-radius: var(--r-xs);
    border: 1px solid var(--text-mute); color: var(--text-dim); line-height: 1.5;
  }

  /* On a desktop this wrapper does not exist as far as layout is concerned:
     rail and sidebar stay direct children of the four-column grid. */
  .nav { display: contents; }

  /* ── phone: one column, two drawers (docs/24) ───────────────────────────
     `--nav-open` and `--mem-open` run 0→1 and are written by the gesture, so
     a drag and a tap drive exactly the same property. There is no separate
     "animating" path to get out of sync with the dragged one. */
  @media (max-width: 899px) {
    .shell, .shell.no-members { grid-template-columns: 100%; }

    .nav, .members {
      position: fixed; top: 0; bottom: 0; z-index: 41;
      box-shadow: var(--shadow-panel);
      transition: translate var(--t-base) var(--ease);
    }
    /* Vertical scrolling and pinch stay with the browser; horizontal comes to
       us. Without this the compositor can start a scroll before the pointer
       handler runs, and `preventDefault` afterwards is too late — which is the
       difference between a drawer that tracks your thumb and one that stutters
       for the first 100ms. Anything inside that genuinely scrolls sideways
       opts back out where it is defined (see RichText's code blocks). */
    .nav, .members, .chat { touch-action: pan-y pinch-zoom; }
    /* While a finger is on it the panel must not also be running a settle
       transition, or it lags behind the thumb instead of tracking it. */
    .shell.dragging .nav,
    .shell.dragging .members,
    .shell.dragging .drawer-scrim { transition: none; }

    .nav {
      display: flex; left: 0;
      /* Never the full width: the sliver of chat still showing is what says
         this is a drawer over your conversation rather than a page you
         navigated to. */
      width: min(330px, 86vw);
      translate: calc((var(--nav-open) - 1) * 100%) 0;
    }
    .nav .rail { flex: none; width: 68px; }
    .nav .sidebar { flex: 1; min-width: 0; border-right: 0; }

    .members {
      right: 0; width: min(280px, 78vw);
      border-left: 1px solid var(--line);
      translate: calc((1 - var(--mem-open)) * 100%) 0;
    }

    .drawer-scrim {
      position: fixed; inset: 0; z-index: 40; background: var(--scrim);
      opacity: max(var(--nav-open), var(--mem-open));
      /* Zero-width space for the pointer when both drawers are shut, so the
         chat underneath stays fully live. */
      pointer-events: none;
      transition: opacity var(--t-base) var(--ease);
    }
    .shell.drawer-open .drawer-scrim { pointer-events: auto; }

    /* The header is the only chrome left, so it carries the whole title. */
    .chat-head { gap: 6px; padding: 10px 8px; }
    .chat-head h1 { font-size: var(--text-base); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chat-head .glyph { display: none; }
  }
</style>
