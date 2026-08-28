<script lang="ts">
  /**
   * The profile card.
   *
   * `core.profileFor` has been set by clicking an author name since the
   * message list was built, and until now nothing rendered it — the click went
   * nowhere.
   *
   * Three things this card has to get right, all of them from `docs/11`:
   *
   * - **An agent's card leads with what it can read**, not with its badge. The
   *   badge is flavour its owner picked; "can read this room" is the security
   *   statement and is never customisable.
   * - **Faces on your own account** say so, but only to you. Whether your
   *   faces are publicly linked is off by default, so this line is drawn from
   *   your own account rather than from anything the other person can see.
   * - **Nothing here is fetched.** Everything on the card is already on this
   *   device, which is why it can appear instantly and why it works offline.
   */
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import Popover from './Popover.svelte';
  import { core, MY_ACCOUNT } from './fake/core.svelte.js';

  let {
    faceId,
    anchor,
    onclose,
    onedit,
  }: {
    faceId: string;
    /** Hangs off the clicked name when there is one; centres when there isn't. */
    anchor?: HTMLElement;
    onclose: () => void;
    onedit?: (faceId: string) => void;
  } = $props();

  const face = $derived(core.faces[faceId]!);
  const mine = $derived(face?.accountId === MY_ACCOUNT);
  const isMe = $derived(face?.id === core.speakingAs);

  const STATUS: Record<string, string> = {
    here: 'Here',
    away: 'Away',
    busy: 'Busy',
    invisible: 'Invisible to everyone else',
  };
</script>

{#snippet card()}
  <div class="card" role="dialog" aria-label="{face.name}'s profile">
    <div class="banner" style="--fc: var(--face-{face.colour})"></div>

    <div class="head">
      <Avatar {face} size={64} dot />
      <div class="who">
        <div class="nm" style="color: var(--face-{face.colour})">{face.name}</div>
        <div class="meta">
          {#if face.pronouns}<span>{face.pronouns}</span>{/if}
          {#if face.status}<span>{STATUS[face.status]}</span>{/if}
        </div>
      </div>
    </div>

    {#if face.note}<p class="note">{face.note}</p>{/if}
    {#if face.bio}<p class="bio">{face.bio}</p>{/if}

    {#if face.agent}
      <!-- Leads with what it can read. The badge is its owner's word; this
           line is the product's. -->
      <div class="statement agent">
        <Icon name="eye" size={15} />
        <div>
          <b>Can read this room</b>
          <span>
            Every message, past and future — the same as any member. Software,
            run by {face.agent.by}, badged “{face.agent.label}” by them.
          </span>
        </div>
      </div>
    {:else if mine && !isMe}
      <div class="statement">
        <Icon name="user" size={15} />
        <div>
          <b>Another of your faces</b>
          <span>Only you see this line. Your faces aren't linked publicly.</span>
        </div>
      </div>
    {/if}

    <div class="actions">
      {#if mine}
        <button class="go" onclick={() => { onedit?.(face.id); onclose(); }}>
          <Icon name="pencil" size={14} /> Edit this face
        </button>
        {#if !isMe}
          <button class="alt" onclick={() => { core.speakingAs = face.id; onclose(); }}>
            Speak as {face.name}
          </button>
        {/if}
      {:else if face.agent}
        <button class="alt" onclick={onclose}>View in member list</button>
      {:else}
        <button class="go"><Icon name="send" size={14} /> Message</button>
        <button class="alt"><Icon name="shield" size={14} /> Verify</button>
      {/if}
    </div>
  </div>
{/snippet}

{#if anchor}
  <Popover {anchor} align="start" prefer="top" {onclose}>{@render card()}</Popover>
{:else}
  <div
    class="scrim"
    role="button"
    tabindex="-1"
    aria-label="Close profile"
    onclick={onclose}
    onkeydown={(e) => e.key === 'Escape' && onclose()}
  ></div>
  <div class="centred">{@render card()}</div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 76; background: var(--scrim); }
  .centred { position: fixed; z-index: 77; left: 50%; top: 50%; translate: -50% -50%; }

  .card {
    width: 300px; overflow: hidden;
    background: var(--ground-0); border: 1px solid var(--line);
    border-radius: var(--r-lg); box-shadow: var(--shadow-panel);
  }

  /* The face's own colour, as a band. Identity colour is the one consistent
     thread between the roster, the message list and here. */
  .banner {
    height: 52px;
    background: linear-gradient(120deg, var(--fc), color-mix(in oklab, var(--fc) 40%, var(--ground-2)));
  }

  .head { display: flex; align-items: flex-end; gap: 11px; padding: 0 15px; margin-top: -26px; }
  .head :global(.av) { box-shadow: 0 0 0 3px var(--ground-0); }
  .who { padding-bottom: 3px; min-width: 0; }
  .nm { font-weight: 700; font-size: var(--text-base); overflow: hidden; text-overflow: ellipsis; }
  .meta { display: flex; gap: 8px; font-size: 11px; color: var(--text-mute); }
  .meta span:not(:first-child)::before { content: '·'; margin-right: 8px; }

  .note { margin: 11px 15px 0; font-size: var(--text-sm); color: var(--text); line-height: 1.5; }
  .bio { margin: 6px 15px 0; font-size: var(--text-sm); color: var(--text-mute); line-height: 1.55; }

  .statement {
    display: flex; gap: 10px; margin: 13px 15px 0; padding: 10px 11px;
    background: var(--ground-2); border-radius: var(--r-md); color: var(--text-mute);
  }
  .statement.agent { color: var(--face-gold); background: color-mix(in oklab, var(--face-gold) 12%, transparent); }
  .statement div { min-width: 0; }
  .statement b { display: block; font-size: 12px; color: var(--text); margin-bottom: 2px; }
  .statement span { font-size: 11px; color: var(--text-mute); line-height: 1.5; display: block; }

  .actions { display: flex; gap: 7px; padding: 14px 15px 15px; }
  .go, .alt {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px; flex: 1;
    border: 0; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600;
    padding: 8px 12px; border-radius: var(--r-pill);
    background: var(--brand); color: #fff;
    transition: filter var(--t-fast) var(--ease), background var(--t-fast) var(--ease);
  }
  .go:hover { filter: brightness(1.08); }
  .alt { background: var(--ground-3); color: var(--text-dim); }
  .alt:hover { background: var(--ground-4); color: var(--text); }
</style>
