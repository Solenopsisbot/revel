<script lang="ts">
import { faceColour } from './colour.js';
import Avatar from './Avatar.svelte';
import { conversation } from './fake/conversation.svelte.js';
import { core } from './fake/core.svelte.js';
import Icon from './Icon.svelte';
import { layout } from './layout.svelte.js';
import { live } from './live.svelte.js';

/**
 * The thread this composer posts into, if it is the one in a thread panel.
 *
 * One component for both, because a thread reply is an ordinary message with
 * one extra field (`docs/03`) — everything else about composing, the face
 * switcher, the growth, the drop target, the send rules, is identical, and a
 * second copy would diverge on the first change to any of them.
 */
let { thread }: { thread?: string } = $props();

let draft = $state('');
let input = $state<HTMLTextAreaElement>();
let dragging = $state(false);

/**
 * The face this composer sends as, or `undefined`.
 *
 * Undefined is a real state and the first one a new account is in: it has made
 * no faces, so there is nothing to speak as, and sending without a `FaceRef` is
 * correct rather than broken. This was `core.faces[…]!` — the `!` was a lie the
 * moment the faces stopped being fixtures, and it took the whole composer down
 * with "cannot read properties of undefined".
 */
const face = $derived(
  core.myFaces.find((f) => f.id === core.speakingHere) ?? core.faces[core.speakingHere],
);

/**
 * The face waiting on a confirmation to join this conversation, if any.
 *
 * Kept here rather than in `core` because it is one dialog's worth of state and
 * nothing outside this component can be in the middle of it.
 */
let joining = $state<string | null>(null);

/**
 * Whether this composer is the one stray keystrokes belong to. With a thread
 * open there are two on screen, and both grabbing at every keypress would
 * make typing land wherever the DOM happened to order them.
 */
const active = $derived(thread ? core.openThreadId === thread : !core.openThreadId);

/**
 * Tell the room somebody is typing. Safe to call per keystroke — `RoomSync`
 * owns the throttle, deliberately, so that the obvious call site is the
 * correct one and no composer has to keep its own copy of the interval.
 */
function announceTyping() {
  if (!live.running) return;
  void live.setTyping(core.currentRoomId, thread);
}

import { sound } from './sound.js';

function selectFace(faceId: string) {
  const here = core.facesHere === null || core.facesHere.includes(faceId);
  const reveals = here && core.revealsLinkHere(faceId);
  if (!here || reveals) {
    joining = faceId;
  } else {
    core.speakHere(faceId);
    core.speakingAsOpen = false;
    sound.switchFace();
  }
}

function submit() {
  // Clearing the reply target is `core.send`'s job, not the composer's.
  if (thread) core.sendToThread(thread, draft);
  else core.send(draft);
  sound.send();
  draft = '';
  if (live.running) void live.stopTyping(core.currentRoomId, thread);
  // Someone replies, so the typing indicator and arrival animation have
  // something to do.
  core.simulateTyping('rae', 2600, thread);
  if (input) input.style.height = 'auto';
}

function onKey(e: KeyboardEvent) {
  // Enter sends on a fine pointer only; on touch it is a newline and the
  // button sends (`docs/24`). matchMedia, not screen width.
  const fine = window.matchMedia('(pointer: fine)').matches;
  if (e.key === 'Enter' && !e.shiftKey && fine) {
    e.preventDefault();
    submit();
    return;
  }
  if (core.myFaces.length > 1) {
    if ((e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j')) {
      e.preventDefault();
      const currentIdx = core.myFaces.findIndex(f => f.id === core.speakingHere);
      const delta = e.key === 'ArrowUp' ? -1 : 1;
      const nextIdx = (currentIdx + delta + core.myFaces.length) % core.myFaces.length;
      const target = core.myFaces[nextIdx];
      if (target) selectFace(target.id);
      return;
    }
  }
  if (e.key === 'Escape') {
    // Escape clears the most specific thing first, then the next.
    if (core.speakingAsOpen) core.speakingAsOpen = false;
    else if (core.replyTo) core.replyTo = null;
  }
}

/**
 * Start typing anywhere and the characters land in the composer.
 *
 * Lives here rather than in the shell because this component owns the
 * textarea, and "typing goes to the message box" is a fact about the message
 * box. Focusing during `keydown` and *not* preventing the default is what
 * makes the keystroke itself arrive: the browser inserts text after keydown,
 * into whatever is focused by then. Handling the character by hand instead
 * double-types on the browsers that already delivered it.
 */
function typeToFocus(e: KeyboardEvent) {
  if (!active) return;
  if (!input || document.activeElement === input) return;
  // A shortcut is not typing. ⌘K, ⌘, and friends must still work.
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // Exactly one character: letters, digits, punctuation, space. Enter, Tab,
  // Escape and the arrows are navigation and belong to whatever has focus.
  if (e.key.length !== 1) return;

  const el = e.target instanceof HTMLElement ? e.target : null;
  if (el) {
    const tag = el.tagName;
    // Somebody else is already taking text — a search field, the command
    // bar, a settings input, a message being edited.
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return;
    // An open dialog owns the keyboard while it is up.
    if (el.closest('[role="dialog"], [role="alertdialog"]')) return;
  }
  input.focus();
}

function grow(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
}
</script>

<svelte:window onkeydown={typeToFocus} />

<div class="composer">
  {#if core.speakingAsOpen}
    <!-- A dropdown on a mouse, a bottom sheet on a finger (`docs/24`):
         switching face mid-conversation is a frequent action for a plural
         user, and a 200px popover anchored to a chip is a bad way to ask a
         thumb to do it. Same markup, same list, different frame. -->
    {#if layout.coarse}
      <div class="sheet-scrim" onclick={() => (core.speakingAsOpen = false)} role="presentation"></div>
    {/if}
    <div
      class="switcher"
      class:sheet={layout.coarse}
      role={layout.coarse ? 'dialog' : 'listbox'}
      aria-modal={layout.coarse ? 'true' : undefined}
      aria-label="Speaking as"
    >
      {#if layout.coarse}
        <div class="grab" aria-hidden="true"></div>
        <p class="sheet-title">Speaking as</p>
      {/if}
      {#each core.myFaces as f (f.id)}
        {@const here = core.facesHere === null || core.facesHere.includes(f.id)}
        <!-- Two different questions, one confirmation. A DM has a participant
             list, so a face that is not on it has to *join* — and is greyed out
             until it does. A space room has no per-face membership (`docs/03`
             §4: roles and audiences are account-level), so every face is
             already allowed to post and greying one out would be a lie. What
             is still disclosable there is two of my faces appearing in the same
             room, because that is what connects them — so the face stays
             selectable and the click asks once. -->
        {@const reveals = here && core.revealsLinkHere(f.id)}
        <button
          role={layout.coarse ? undefined : 'option'}
          aria-selected={layout.coarse ? undefined : f.id === core.speakingHere}
          aria-pressed={layout.coarse ? f.id === core.speakingHere : undefined}
          class="opt"
          class:sel={f.id === core.speakingHere}
          class:absent={!here}
          onclick={() => {
            if (!here || reveals) {
              // Not a switch. Either brings a face into a conversation or
              // connects two of them in front of people — both disclosures.
              joining = f.id;
            } else {
              core.speakHere(f.id);
              core.speakingAsOpen = false;
            }
          }}
        >
          <Avatar face={f} size={layout.coarse ? 36 : 28} />
          <span style="color: var(--face-{f.colour})">{f.name}</span>
          {#if f.id === core.speakingHere}
            <Icon name="check" size={16} />
          {:else if !here}
            <span class="not-here">not in this conversation</span>
          {:else if reveals}
            <!-- Stated as the fact, not as a warning. It is not risky to use a
                 face here; it is just the first time, and the consequence
                 belongs in the dialog rather than shouted from a list row. -->
            <span class="not-here">not used here yet</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  {#if joining}
    {@const f = core.faces[joining]}
    {@const isMember = core.facesHere === null || core.facesHere.includes(joining)}
    {@const alongside = core.facesSpokenHere
      .filter((id) => id !== joining)
      .map((id) => core.faces[id]?.name ?? id)}
    {#if f}
      <div class="scrim" onclick={() => (joining = null)} role="presentation"></div>
      <div class="confirm" role="dialog" aria-modal="true" aria-labelledby="join-title">
        <!-- Two situations, and they are not the same fact, so they do not get
             the same sentence. Joining a DM adds a participant *and* connects
             the faces; speaking in a room only connects them. Saying "add" for
             the second would describe something that is not happening. -->
        <p class="confirm-title" id="join-title">
          {#if !isMember}
            Bring <span style="color: var(--face-{f.colour})">{f.name}</span> into this conversation?
          {:else}
            Speak as <span style="color: var(--face-{f.colour})">{f.name}</span> here?
          {/if}
        </p>
        <!-- `docs/11`: faces on one account are *not* unlinkable to somebody in
             the same room — attribution is per account and the face is a field
             inside the message. This is where that stops being abstract, so it
             is where to say it, in `docs/08`'s voice: what happens, not how we
             feel about it. -->
        <p class="confirm-body">
          {#if !isMember}
            Everyone here will see that {f.name} exists{alongside.length
              ? `, and that ${f.name} and ${alongside.join(' and ')} are the same account`
              : ''}.
          {:else}
            {alongside.join(' and ')} {alongside.length > 1 ? 'have' : 'has'} already
            posted here, so everyone in this room will see that {f.name} and
            {alongside.join(' and ')} are the same account.
          {/if}
          That cannot be undone by deleting the message.
        </p>
        <p class="confirm-body dim">
          If these need to stay unconnected, a separate account is the tool for
          that — nothing links two accounts.
        </p>
        <div class="confirm-row">
          <button class="ghost" onclick={() => (joining = null)}>Cancel</button>
          <button
            class="go"
            onclick={() => {
              if (joining) {
                if (isMember) core.speakHere(joining);
                else core.addFaceHere(joining);
              }
              joining = null;
              core.speakingAsOpen = false;
            }}
          >
            {isMember ? `Speak as ${f.name}` : `Add ${f.name}`}
          </button>
        </div>
      </div>
    {/if}
  {/if}

  {#if core.replyTo && !thread}
    {@const target = conversation.find(core.replyTo)}
    {#if target}
      <div class="reply-banner">
        <Icon name="reply" size={14} />
        <span>Replying to <b style="color: var(--face-{faceColour(target.face)})">{target.face?.name ?? 'Unknown'}</b></span>
        <span class="snip">{target.body}</span>
        <button class="x" onclick={() => (core.replyTo = null)} aria-label="Cancel reply">×</button>
      </div>
    {/if}
  {/if}

  <div
    class="box"
    class:dragging
    class:replying={!!core.replyTo && !thread}
    style="--fc: var(--face-{faceColour(face)})"
    ondragover={(e) => { e.preventDefault(); dragging = true; }}
    ondragleave={() => (dragging = false)}
    ondrop={(e) => { e.preventDefault(); dragging = false; }}
    role="group"
  >
    {#if core.plural}
      <!-- The chip exists only because this account has several faces.
           A singlet never sees it (`docs/11`). -->
      <button class="chip" onclick={() => (core.speakingAsOpen = !core.speakingAsOpen)} title="Speaking as">
        <Avatar {face} size={24} />
        <span class="nm">{face?.name ?? 'Someone'}</span>
        <Icon name="chevron" size={14} />
      </button>
    {/if}

    <textarea
      bind:this={input}
      bind:value={draft}
      onkeydown={onKey}
      oninput={(e) => {
        grow(e.currentTarget);
        announceTyping();
      }}
      rows="1"
      placeholder={thread
        ? 'Reply in thread'
        : core.scope === 'home'
          ? // A DM is a person, not a channel. `#` is the channel sigil
            // (`docs/16`), and putting it on somebody's name reads as a room
            // called after them.
            `Message ${core.room.name}`
          : `Message #${core.room.name}`}
      aria-label="Message"
    ></textarea>

    <button class="icon" title="Attach"><Icon name="attach" size={19} /></button>
    <button class="send" onclick={submit} disabled={!draft.trim()} title="Send">
      <Icon name="send" size={18} />
    </button>
  </div>
</div>

<style>
  .composer { padding: 10px 16px 16px; flex: none; position: relative; }

  .switcher {
    position: absolute; bottom: calc(100% - 4px); left: 16px; z-index: 5;
    background: var(--ground-2); border: 1px solid var(--line);
    border-radius: var(--r-md); padding: 6px; min-width: 200px;
    box-shadow: var(--shadow-panel);
    animation: rise var(--t-base) var(--ease);
  }
  @keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .opt {
    display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
    padding: 7px 8px; border: 0; background: transparent; cursor: pointer;
    min-height: var(--tap);
    border-radius: var(--r-sm); font-weight: 600;
    transition: background var(--t-fast) var(--ease);
  }
  .opt:hover, .opt.sel { background: var(--ground-3); }

  /* A face that is not in this conversation. Dimmed rather than hidden or
     disabled: hidden would make it look like the face does not exist, and
     `disabled` would take it out of the tab order and give a keyboard user no
     way to reach the one action it does have. It is still a button — it just
     opens a question instead of switching. */
  .opt.absent { opacity: 0.45; }
  .opt.absent:hover { opacity: 1; background: var(--ground-3); }
  .not-here {
    margin-left: auto; font-size: var(--text-xs); font-weight: 500;
    color: var(--text-mute); white-space: nowrap;
  }

  /* ── "bring this face in" confirmation ─────────────────────────────────── */
  .scrim { position: fixed; inset: 0; z-index: 47; background: var(--scrim); }
  .confirm {
    position: absolute; bottom: calc(100% + 8px); left: 8px; right: 8px;
    max-width: 380px; z-index: 48;
    background: var(--ground-2); border: 1px solid var(--line);
    border-radius: var(--r-md); padding: 14px; box-shadow: var(--shadow-lg);
  }
  .confirm-title { margin: 0 0 8px; font-weight: 650; font-size: var(--text-base); }
  .confirm-body { margin: 0 0 8px; font-size: var(--text-sm); color: var(--text-dim); }
  .confirm-body.dim { color: var(--text-mute); }
  .confirm-row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
  .confirm-row button {
    font: inherit; font-size: var(--text-sm); font-weight: 600; cursor: pointer;
    padding: 8px 14px; border-radius: var(--r-pill); min-height: var(--tap);
  }
  .confirm-row .ghost { background: transparent; border: 1px solid var(--line); color: var(--text); }
  .confirm-row .go { background: var(--accent); border: 0; color: var(--on-accent); }

  /* ── bottom sheet (coarse pointers only) ───────────────────────────────── */
  .sheet-scrim { position: fixed; inset: 0; z-index: 45; background: var(--scrim); }
  .switcher.sheet {
    position: fixed; left: 0; right: 0; bottom: 0; top: auto; z-index: 46;
    min-width: 0; padding: 8px 12px;
    /* Home-indicator territory. Without this the last row sits under it and
       every tap on it is a swipe-up out of the app instead. */
    padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    border-radius: var(--r-lg) var(--r-lg) 0 0; border-bottom: 0;
    animation: sheet-up var(--t-base) var(--ease);
  }
  @keyframes sheet-up { from { translate: 0 100%; } to { translate: 0 0; } }
  /* The one affordance that says "this came up from the bottom and goes back
     down", without asking for a gesture the sheet doesn't actually implement. */
  .grab {
    width: 38px; height: 4px; border-radius: var(--r-pill);
    background: var(--ground-4); margin: 2px auto 8px;
  }
  .sheet-title {
    margin: 0 0 4px; padding: 0 8px;
    font-size: 11px; font-weight: 800; letter-spacing: .09em;
    text-transform: uppercase; color: var(--text-mute);
  }
  .switcher.sheet .opt { padding: 10px; font-size: var(--text-base); }

  .box {
    display: flex; align-items: flex-end; gap: 10px;
    background: var(--ground-2); border: 1.5px solid var(--line-strong);
    border-radius: var(--r-lg); padding: 8px 8px 8px 14px;
    box-shadow: var(--shadow-subtle), var(--highlight-inset);
    transition:
      border-color var(--t-base) var(--ease),
      background var(--t-base) var(--ease),
      box-shadow var(--t-base) var(--ease);
  }
  /* Hovering the box hints it is a target before you commit to clicking it. */
  .box:hover:not(:focus-within) {
    border-color: color-mix(in oklab, var(--brand) 40%, var(--line-strong));
    background: var(--ground-2);
  }
  .box:focus-within {
    border-color: var(--brand);
    background: var(--ground-2);
    box-shadow: var(--focus-ring), var(--shadow-ambient);
  }
  /* Files dragged over it: the whole field becomes the drop target, so the
     affordance is the field rather than a separate zone that appears. */
  .box.dragging {
    border-color: var(--face-mint);
    border-style: dashed;
    background: color-mix(in oklab, var(--face-mint) 10%, var(--ground-2));
  }
  .box.replying { border-top-left-radius: 0; border-top-right-radius: 0; }

  .reply-banner {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 14px; font-size: var(--text-sm); color: var(--text-mute);
    background: var(--ground-2); border: 1.5px solid var(--line-strong); border-bottom: 0;
    border-radius: var(--r-lg) var(--r-lg) 0 0;
    animation: banner var(--t-base) var(--ease);
  }
  @keyframes banner {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: none; }
  }
  .reply-banner .snip {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--text-mute);
  }
  .reply-banner .x {
    border: 0; background: transparent; color: var(--text-mute); cursor: pointer;
    font-size: 18px; line-height: 1; padding: 0 4px; border-radius: var(--r-xs);
    transition: color var(--t-fast) var(--ease), background var(--t-fast) var(--ease);
  }
  .reply-banner .x:hover { color: var(--text); background: var(--ground-3); }

  .chip {
    display: inline-flex; align-items: center; gap: 7px; flex: none; cursor: pointer;
    background: color-mix(in oklab, var(--fc) 18%, var(--ground-3));
    border: 1.5px solid color-mix(in oklab, var(--fc) 46%, transparent);
    color: var(--fc); border-radius: var(--r-pill); padding: 4px 10px 4px 4px;
    font-size: var(--text-sm); font-weight: 700; margin-bottom: 2px;
    min-height: var(--tap);
    box-shadow: var(--shadow-subtle);
    transition: background var(--t-base) var(--ease), border-color var(--t-base) var(--ease),
      color var(--t-base) var(--ease), transform var(--t-fast) var(--ease);
  }
  .chip:hover {
    background: color-mix(in oklab, var(--fc) 26%, var(--ground-3));
    transform: translateY(-1px);
  }

  textarea {
    flex: 1; background: transparent; border: 0; color: var(--text);
    font: inherit; padding: 8px 0; resize: none; overflow-y: auto; max-height: 180px;
  }
  textarea:focus { outline: none; }
  /* The placeholder recedes as you focus, so the field feels ready rather
     than still labelled. */
  textarea::placeholder { color: var(--text-mute); transition: color var(--t-base) var(--ease); }
  .box:focus-within textarea::placeholder { color: color-mix(in oklab, var(--text-mute) 55%, transparent); }

  .icon {
    border: 0; background: transparent; color: var(--text-dim); cursor: pointer;
    width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center;
    min-width: var(--tap); min-height: var(--tap);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
  }
  .icon:hover { background: var(--ground-3); color: var(--text); }
  .icon:active { transform: scale(0.92); }

  .send {
    flex: none; width: 36px; height: 36px; border-radius: 50%; border: 0; cursor: pointer;
    min-width: var(--tap); min-height: var(--tap);
    background: linear-gradient(180deg, #935ced, #7944d6); color: #fff;
    display: grid; place-items: center;
    box-shadow: 0 var(--lift) 0 var(--violet-deep), var(--highlight-inset);
    transition: transform var(--t-fast) var(--ease-toy), box-shadow var(--t-fast) var(--ease),
      opacity var(--t-fast) var(--ease), filter var(--t-fast) var(--ease);
  }
  /* Enabling the send button is the clearest signal that the field has
     content, so it is worth animating rather than snapping. */
  .send:disabled {
    opacity: .35; cursor: default; box-shadow: none;
    background: var(--ground-3); transform: scale(.92);
  }
  .send:not(:disabled):hover { filter: brightness(1.10); }
  /* The one overshoot in the product: it presses down like an object. */
  .send:not(:disabled):active { transform: translateY(var(--lift)); box-shadow: none; }
</style>
