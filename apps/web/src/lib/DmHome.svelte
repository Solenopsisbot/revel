<script lang="ts">
/**
 * Where `/app` lands.
 *
 * Not a conversation. Opening straight into whichever DM happened to be first
 * had two problems: it was arbitrary, and **looking at a room marks it read**,
 * so landing on one silently cleared a badge for a message nobody had seen.
 * A home that is nobody's conversation has neither problem, and it is where
 * starting a new one belongs.
 *
 * Everything here is local. The conversation list is the one the sidebar
 * renders and the address is this device's own, so this paints instantly and
 * works offline — which matters more here than anywhere, because it is the
 * first thing anybody sees.
 */
import Avatar from './Avatar.svelte';
import { core } from './fake/core.svelte.js';
import Icon from './Icon.svelte';
import { session } from './session.svelte.js';
import { whyNot } from './startErrors.js';

let mode = $state<'idle' | 'dm' | 'group'>('idle');
let one = $state('');
let many = $state('');
let busy = $state(false);
let error = $state('');

const dms = $derived(core.dms);
const unread = $derived(dms.reduce((n, d) => n + (d.unread ?? 0), 0));

async function start() {
  busy = true;
  error = '';
  const result =
    mode === 'group'
      ? await core.startGroup(many.split(',').map((s) => s.trim()))
      : await core.startDm(one);
  busy = false;
  if (result.error) error = whyNot(result.error);
  else {
    one = '';
    many = '';
    mode = 'idle';
  }
}
</script>

<div class="home">
  <div class="inner">
    <h1>{dms.length ? 'Your conversations' : 'Nothing here yet'}</h1>
    <p class="lede">
      {#if unread}
        {unread} unread across {dms.filter((d) => d.unread).length}
        {dms.filter((d) => d.unread).length === 1 ? 'conversation' : 'conversations'}.
      {:else if dms.length}
        Nothing waiting. Pick one on the left, or start another.
      {:else}
        You're <b>{session.address}</b>. Give that to somebody and they can reach you —
        or start the first one yourself.
      {/if}
    </p>

    <div class="start">
      {#if mode === 'idle'}
        <button class="go" onclick={() => (mode = 'dm')}>
          <Icon name="plus" size={16} /> Message someone
        </button>
        <button class="go ghost" onclick={() => (mode = 'group')}>
          <Icon name="people" size={16} /> Start a group
        </button>
      {:else}
        <form
          onsubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          {#if mode === 'dm'}
            <input
              bind:value={one}
              placeholder="Their name, like viola"
              aria-label="Who do you want to message?"
              autocomplete="off"
            />
          {:else}
            <input
              bind:value={many}
              placeholder="Names, separated by commas"
              aria-label="Who is in the group?"
              autocomplete="off"
            />
          {/if}
          <button type="submit" disabled={busy || !(mode === 'dm' ? one : many).trim()}>
            {busy ? '…' : 'Start'}
          </button>
          <button
            type="button"
            class="cancel"
            onclick={() => {
              mode = 'idle';
              error = '';
            }}>Cancel</button
          >
        </form>
        {#if mode === 'group'}
          <!-- A group DM is not a space. `docs/03` §4: an explicit list of
               people, no roles, no channels. Saying so here is cheaper than
               somebody discovering it later. -->
          <p class="hint">
            A group conversation, not a space — everyone's in one room and nobody
            is in charge. Anyone in it can add or remove anyone, including you.
          </p>
        {/if}
        {#if error}<p class="err" role="alert">{error}</p>{/if}
      {/if}
    </div>

    {#if dms.length}
      <ul class="list">
        {#each dms as dm (dm.id)}
          <li>
            <button onclick={() => core.openHome(dm.id)}>
              {#if dm.kind === 'group'}
                <span class="ic"><Icon name="people" size={16} /></span>
              {:else}
                <Avatar face={core.faceCard(dm.withIds[0] ?? '')} size={26} />
              {/if}
              <span class="nm">{dm.name ?? core.dmTitle(dm)}</span>
              {#if dm.unread}<span class="pill">{dm.unread}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .home { flex: 1; overflow-y: auto; display: grid; place-items: center; padding: 40px 24px; }
  .inner { width: 100%; max-width: 46ch; }
  h1 { font-family: var(--font-display); font-size: var(--text-2xl); margin: 0 0 8px; }
  .lede { color: var(--text-2); margin: 0 0 26px; line-height: 1.6; }
  .start { display: grid; gap: 10px; margin-bottom: 30px; }
  .go {
    display: inline-flex; align-items: center; justify-content: center; gap: 9px;
    font: inherit; font-weight: 600; cursor: pointer; min-height: var(--tap);
    background: var(--brand); color: #fff; border: 0; border-radius: var(--r-md); padding: 10px 16px;
  }
  .go.ghost { background: var(--ground-3); color: var(--text); }
  .go:hover { filter: brightness(1.08); }
  form { display: flex; gap: 8px; flex-wrap: wrap; }
  input {
    flex: 1; min-width: 0; font: inherit; padding: 9px 12px; min-height: var(--tap);
    border-radius: var(--r-sm); border: 1px solid var(--line);
    background: var(--ground-1); color: var(--text);
  }
  form button {
    font: inherit; font-weight: 600; cursor: pointer; min-height: var(--tap);
    border: 0; border-radius: var(--r-sm); padding: 9px 15px;
    background: var(--brand); color: #fff;
  }
  form button:disabled { opacity: .45; cursor: default; }
  form button.cancel { background: var(--ground-3); color: var(--text); }
  .hint { margin: 10px 0 0; font-size: var(--text-sm); color: var(--text-3); line-height: 1.5; }
  .err { margin: 10px 0 0; font-size: var(--text-sm); color: var(--danger, #ff8f9e); }
  .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .list button {
    width: 100%; display: flex; align-items: center; gap: 11px; text-align: left;
    font: inherit; cursor: pointer; min-height: var(--tap);
    background: transparent; border: 0; border-radius: var(--r-sm);
    padding: 8px 10px; color: var(--text);
  }
  .list button:hover { background: var(--ground-2); }
  .ic { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--ground-3); }
  .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pill {
    background: var(--brand); color: #fff; font-size: var(--text-xs); font-weight: 700;
    border-radius: 999px; padding: 1px 7px; min-width: 18px; text-align: center;
  }
</style>
