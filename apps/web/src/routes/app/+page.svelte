<script lang="ts">
  import Avatar from '$lib/Avatar.svelte';
  import Icon from '$lib/Icon.svelte';
  import { core, faces, MY_ACCOUNT } from '$lib/fake/core.svelte.js';
  import MessageList from '$lib/MessageList.svelte';
  import Composer from '$lib/Composer.svelte';
  import SettingsOverlay from '$lib/settings/SettingsOverlay.svelte';
  import WrenSurface from '$lib/wren/WrenSurface.svelte';
  import { page } from '$app/state';

  // ?settings=<section> opens straight to a pane, so any of them can be
  // reviewed without clicking through.
  const deepLink = page.url.searchParams.get('settings');
  let settingsOpen = $state(!!deepLink);
  let settingsSection = $state(deepLink ?? 'account');

  const me = $derived(faces[core.speakingAs]!);

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
</script>

<div class="shell" class:no-members={!core.membersOpen}>
  <nav class="rail" aria-label="Spaces">
    {#each core.spaces as space (space.id)}
      <button
        class="space"
        class:active={space.id === core.currentSpaceId}
        style="--from: var(--face-{space.from}); --to: var(--face-{space.to})"
        onclick={() => core.openRoom(space.id, space.rooms[0]!.id)}
        title={space.name}
      >{space.initial}</button>
    {/each}
    <button class="space add" title="Add a space"><Icon name="plus" size={20} /></button>
  </nav>

  <aside class="sidebar">
    <header class="space-head">{core.space.name}</header>
    <div class="rooms">
      {#each Object.entries(categories) as [category, rooms] (category)}
        <div class="cat">{category}</div>
        {#each rooms as room (room.id)}
          <button
            class="room"
            class:active={room.id === core.currentRoomId}
            class:unread={!!room.unread}
            onclick={() => core.openRoom(core.currentSpaceId, room.id)}
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
        {/each}
      {/each}
    </div>
    <div class="me">
      <button class="me-id" title="You">
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

  <main class="chat">
    <header class="chat-head">
      <span class="glyph">{#if core.room.kind === 'voice'}<Icon name="voice" />{:else}#{/if}</span>
      <h1>{core.room.name}</h1>
      <div class="spacer"></div>
      <WrenSurface onroute={route} />
      <button
        class="icon-btn"
        aria-pressed={core.membersOpen}
        onclick={() => (core.membersOpen = !core.membersOpen)}
        title="Members"
      ><Icon name="people" size={20} /></button>
    </header>

    {#key core.currentRoomId}
      <div class="fade"><MessageList /></div>
    {/key}

    <Composer />
  </main>

  <SettingsOverlay bind:open={settingsOpen} bind:section={settingsSection} />

  {#if core.membersOpen}
    <aside class="members" aria-label="Members">
      <div class="cat">In this room — {core.roster.length}</div>
      {#each core.roster as face (face.id)}
        <div class="member">
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
        </div>
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
  .space-head {
    padding: 14px 16px; border-bottom: 1px solid var(--line);
    font-family: var(--font-display); font-weight: 600; font-size: var(--text-lg);
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
  .icon-btn {
    border: 0; background: transparent; color: var(--text-dim); cursor: pointer;
    width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center;
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
  .member { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: var(--r-sm); }
  .member { cursor: pointer; transition: background var(--t-fast) var(--ease); }
  .member:hover { background: var(--ground-2); }
  .who { min-width: 0; }
  .nm { font-weight: 600; font-size: var(--text-sm); display: flex; align-items: center; gap: 6px; }
  .sub { font-size: 11px; color: var(--text-mute); }
  .badge {
    font-size: 10px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
    padding: 1px 6px; border-radius: var(--r-xs);
    border: 1px solid var(--text-mute); color: var(--text-dim); line-height: 1.5;
  }

  @media (max-width: 900px) {
    .shell, .shell.no-members { grid-template-columns: 68px 1fr; }
    .members { display: none; }
  }
</style>
