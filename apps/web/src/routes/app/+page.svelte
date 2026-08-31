<script lang="ts">
import { untrack } from 'svelte';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import Avatar from '$lib/Avatar.svelte';
import { back } from '$lib/back.js';
import Composer from '$lib/Composer.svelte';
import ContextMenu from '$lib/ContextMenu.svelte';
import CommandBar from '$lib/command/CommandBar.svelte';
import { contextMenu } from '$lib/contextmenu.svelte.js';
import { applyUrl, syncUrl } from '$lib/deeplink.js';
import { drawers } from '$lib/drawers.svelte.js';
import { connection } from '$lib/fake/connection.svelte.js';
import { conversation } from '$lib/fake/conversation.svelte.js';
import { core, MY_ACCOUNT } from '$lib/fake/core.svelte.js';
import type { NotifyLevel } from '$lib/fake/data.js';
import Icon from '$lib/Icon.svelte';
import { layout } from '$lib/layout.svelte.js';
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
const demo = page.url.searchParams.has('demo');
if (!demo) {
  void session.restore().then((restored) => {
    if (!restored) void goto('/signin');
  });
}

const deepLink = page.url.searchParams.get('settings');
let settingsOpen = $state(!!deepLink);
let settingsSection = $state(deepLink ?? 'account');

const me = $derived(core.faces[core.speakingAs]!);

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
    roomMenu(room, resolved),
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

function openSpaceMenu(e: MouseEvent, spaceId = core.currentSpaceId) {
  const space = core.spaces.find((s) => s.id === spaceId);
  if (!space) return;
  if (spaceId !== core.currentSpaceId) core.openRoom(spaceId, space.rooms[0]!.id);
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
      if (verb === 'notify') dm.notify = arg === 'inherit' ? undefined : (arg as NotifyLevel);
      if (picked === 'mark-read') {
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
  syncUrl({
    scope: core.scope,
    spaceId: core.currentSpaceId,
    roomId: core.currentRoomId,
    settings: settingsOpen ? settingsSection : undefined,
  });
});

$effect(() => layout.watch());
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

    {#each core.spaces as space (space.id)}
      <button
        class="space"
        class:active={core.scope === 'space' && space.id === core.currentSpaceId}
        style="--from: var(--face-{space.from}); --to: var(--face-{space.to})"
        onclick={() => { core.openRoom(space.id, space.rooms[0]!.id); navigated(); }}
        oncontextmenu={(e) => openSpaceMenu(e, space.id)}
        use:longpress={(e) => openSpaceMenu(e, space.id)}
        title={space.name}
      >{space.initial}</button>
    {/each}
    <button class="space add" title="Add a space"><Icon name="plus" size={20} /></button>
  </nav>

  <aside class="sidebar">
    {#if core.scope === 'home'}
      <header class="space-head static"><span class="sh-nm">Direct messages</span></header>
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
          <span class="me-nm">{me.name}</span>
          <span class="me-sub">viola@revel.chat</span>
        </span>
      </button>
      <button
        class="me-btn"
        onclick={() => (settingsOpen = true)}
        title="Settings"
        aria-label="Settings"
      ><Icon name="chevron" size={17} /></button>
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

    {#if voice.viewingCall}
      <CallStage />
    {:else}
      {#key core.currentRoomId}
        <div class="fade"><MessageList /></div>
      {/key}
      <Composer />
    {/if}
  </main>

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
  {#if core.membersOpen || layout.narrow}
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

<style>
  .shell {
    display: grid;
    grid-template-columns: 76px 250px 1fr 240px;
    height: 100dvh;
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
