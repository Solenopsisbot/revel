<script lang="ts">
  /**
   * Space → Who can see what.
   *
   * `docs/18` gives this its own tab, and it earns one: the per-room picker
   * shows you a single decision, but the question people actually have is
   * "which of my rooms are narrower than the space, and do they match what I
   * think?" That is a whole-space question and needs a whole-space view.
   *
   * Rooms are grouped by *audience* rather than listed in room order, because
   * two rooms sharing an audience share a key group — and seeing that grouping
   * is the point. It also makes an accidental one-room group obvious, which is
   * the mistake this screen exists to catch.
   */
  import Icon from '$lib/Icon.svelte';
  import { core } from '$lib/fake/core.svelte.js';
  import type { Audience, Room } from '$lib/fake/data.js';

  const space = $derived(core.space);

  function key(a: Audience) {
    if (a.kind === 'everyone') return 'everyone';
    if (a.kind === 'roles') return `roles:${[...a.roles].sort().join(',')}`;
    return `picked:${[...a.faceIds].sort().join(',')}`;
  }

  function describe(a: Audience) {
    if (a.kind === 'everyone') return 'Everyone in this space';
    if (a.kind === 'roles') return `People with ${a.roles.join(' or ')}`;
    return `${a.faceIds.length} people, picked individually`;
  }

  const groups = $derived.by(() => {
    const map = new Map<string, { audience: Audience; rooms: Room[] }>();
    for (const r of space.rooms) {
      const k = key(r.audience);
      const g = map.get(k);
      if (g) g.rooms.push(r);
      else map.set(k, { audience: r.audience, rooms: [r] });
    }
    return [...map.values()];
  });
</script>

<h2>Who can see what</h2>
<p class="lede">
  Each group below is one set of people holding one set of keys. Rooms in the
  same group are readable by the same people — which is also why they cost the
  same to keep.
</p>

{#each groups as g (describe(g.audience))}
  <section class="group">
    <header>
      <Icon name="lock" size={15} />
      <b>{describe(g.audience)}</b>
      <span class="n">{g.rooms.length} {g.rooms.length === 1 ? 'room' : 'rooms'}</span>
    </header>
    <div class="rooms">
      {#each g.rooms as r (r.id)}
        <button class="room" onclick={() => core.openRoom(space.id, r.id)}>
          {#if r.kind === 'voice'}<Icon name="voice" size={13} />{:else}<span class="hash">#</span>{/if}
          {r.name}
        </button>
      {/each}
    </div>
    {#if g.audience.kind === 'everyone'}
      <p class="note">The space's own group. Every member is in it.</p>
    {:else if g.rooms.length === 1}
      <p class="note warn">
        Only one room uses this group. That's fine, it just means the group
        exists for this room alone — worth a look if you meant to reuse an
        existing one.
      </p>
    {/if}
  </section>
{/each}

<p class="boundary">
  This page is about the lock. Who can post, pin or invite are rules this space
  enforces and a determined server operator could in principle ignore. Who
  holds the keys is not — that one is arithmetic.
</p>

<style>
  h2 { font-family: var(--font-display); font-weight: 600; font-size: var(--text-xl); margin: 0 0 4px; }
  .lede { color: var(--text-mute); margin: 0 0 24px; font-size: var(--text-sm); max-width: 62ch; line-height: 1.55; }

  .group {
    border: 1px solid var(--line); border-radius: var(--r-md);
    padding: 13px 15px; margin-bottom: 10px; background: var(--ground-1);
  }
  header { display: flex; align-items: center; gap: 9px; color: var(--text-mute); margin-bottom: 10px; }
  header b { color: var(--text); font-size: var(--text-sm); flex: 1; }
  .n { font-size: 11px; }

  .rooms { display: flex; flex-wrap: wrap; gap: 6px; }
  .room {
    display: inline-flex; align-items: center; gap: 5px;
    border: 0; background: var(--ground-3); cursor: pointer;
    font: inherit; font-size: 12px; font-weight: 600; color: var(--text-dim);
    padding: 5px 11px; border-radius: var(--r-pill);
    transition: color var(--t-fast) var(--ease), background var(--t-fast) var(--ease);
  }
  .room:hover { color: var(--text); background: var(--ground-4); }
  .hash { opacity: .6; }

  .note { margin: 9px 0 0; font-size: 12px; color: var(--text-mute); line-height: 1.55; }
  .note.warn { color: var(--face-gold); }

  .boundary {
    margin: 22px 0 0; font-size: var(--text-sm); color: var(--text-mute);
    line-height: 1.6; max-width: 60ch;
    border-left: 2px solid var(--line); padding-left: 14px;
  }
</style>
