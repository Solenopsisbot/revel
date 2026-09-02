<script lang="ts">
/**
 * Settings → Faces (`docs/11`, `docs/19`).
 *
 * The list is also the editor: clicking Edit opens the fields in place
 * rather than pushing a second modal on top of the settings modal, which is
 * two layers of chrome to get at four text inputs.
 *
 * The public-linking toggle is the load-bearing control on this page and it
 * is off by default. Some systems are out and some very much aren't, and the
 * copy says exactly that instead of a neutral "privacy option" euphemism.
 */
import Avatar from '$lib/Avatar.svelte';
import { core } from '$lib/fake/core.svelte.js';
import type { FaceColour } from '$lib/fake/data.js';
import Icon from '$lib/Icon.svelte';

let { editing = $bindable<string | null>(null) }: { editing?: string | null } = $props();

const COLOURS: FaceColour[] = ['gold', 'rose', 'violet', 'sky', 'mint', 'coral', 'lilac', 'aqua'];
const STATUSES = [
  { id: 'here', label: 'Here' },
  { id: 'away', label: 'Away' },
  { id: 'busy', label: 'Busy' },
  { id: 'invisible', label: 'Invisible' },
] as const;

const myFaces = $derived(core.myFaces);
const face = $derived(myFaces.find((f) => f.id === editing));

let adding = $state(false);
let newName = $state('');

function add() {
  if (!newName.trim()) return;
  core.addFace(newName);
  newName = '';
  adding = false;
}
</script>

<h2>Faces</h2>
<p class="lede">
  The ways you appear. Everything else in the app only shows a face switcher
  because you have more than one.
</p>

{#if face}
  <button class="back" onclick={() => (editing = null)}>
    <Icon name="chevron-left" size={15} /> All faces
  </button>

  <div class="preview">
    <Avatar {face} size={52} dot />
    <div>
      <div class="p-nm" style="color: var(--face-{face.colour})">{face.name}</div>
      <div class="p-sub">{face.pronouns || 'no pronouns set'}</div>
    </div>
  </div>

  <label class="field">
    <span class="lbl">Name</span>
    <input
      type="text"
      value={face.name}
      oninput={(e) => core.updateFace(face.id, { name: e.currentTarget.value })}
    />
  </label>

  <label class="field">
    <span class="lbl">Pronouns</span>
    <input
      type="text"
      placeholder="she/her, they/them, or leave it blank"
      value={face.pronouns ?? ''}
      oninput={(e) => core.updateFace(face.id, { pronouns: e.currentTarget.value })}
    />
  </label>

  <label class="field">
    <span class="lbl">Note</span>
    <input
      type="text"
      placeholder="A line under your name"
      value={face.note ?? ''}
      oninput={(e) => core.updateFace(face.id, { note: e.currentTarget.value })}
    />
    <span class="hint">Short. Shown on your profile card and nowhere else.</span>
  </label>

  <label class="field">
    <span class="lbl">About</span>
    <textarea
      rows="3"
      placeholder="Anything you want on the card."
      value={face.bio ?? ''}
      oninput={(e) => core.updateFace(face.id, { bio: e.currentTarget.value })}
    ></textarea>
  </label>

  <div class="field">
    <span class="lbl">Colour</span>
    <div class="colours">
      {#each COLOURS as c (c)}
        <button
          class="sw"
          class:sel={face.colour === c}
          style="background: var(--face-{c})"
          aria-label={c}
          aria-pressed={face.colour === c}
          onclick={() => core.updateFace(face.id, { colour: c })}
        >{#if face.colour === c}<Icon name="check" size={14} />{/if}</button>
      {/each}
    </div>
    <span class="hint">
      This is how people find you in a busy room — it names you in the message
      list, rings your tile in a call, and banners this card.
    </span>
  </div>

  <div class="field">
    <span class="lbl">Status</span>
    <div class="seg">
      {#each STATUSES as s (s.id)}
        <button
          class:sel={face.status === s.id}
          onclick={() => core.updateFace(face.id, { status: s.id })}
          aria-pressed={face.status === s.id}
        >{s.label}</button>
      {/each}
    </div>
    {#if face.status === 'invisible'}
      <span class="hint">
        Everyone sees you as offline. You will still get messages, and anything
        you send still arrives with your name on it.
      </span>
    {/if}
  </div>
{:else}
  <section>
    {#each myFaces as f (f.id)}
      <div class="face">
        <Avatar face={f} size={40} dot />
        <div class="meta">
          <div class="nm" style="color: var(--face-{f.colour})">{f.name}</div>
          <div class="sub">{f.pronouns ?? 'no pronouns set'}</div>
        </div>
        {#if f.id === core.speakingAs}<span class="badge">speaking as</span>{/if}
        <button class="edit" onclick={() => (editing = f.id)}>Edit</button>
      </div>
    {/each}

    {#if adding}
      <div class="add-row">
        <input
          type="text"
          bind:value={newName}
          placeholder="What should this one be called?"
          onkeydown={(e) => e.key === 'Enter' && add()}
        />
        <button class="edit" onclick={add} disabled={!newName.trim()}>Add</button>
        <button class="edit" onclick={() => (adding = false)}>Cancel</button>
      </div>
    {:else}
      <button class="add" onclick={() => (adding = true)}>Add another face</button>
    {/if}
  </section>
{/if}

<!--
  A statement, not a switch.

  There was a "link my faces publicly" checkbox here, off by default, and it
  could not do what its name said. Being in an MLS group means holding every
  member's leaf credential — a device certificate carrying their account public
  key — and `RoomState.faces` records the announcing account against every
  face. `GET /idp/accounts/key/<accountPub>` then turns that key into a handle
  with no authentication. Anyone in the room can follow those three steps, and
  `docs/26` treats custom clients as a supported thing to write.

  So the switch hid the connection from the one person running a client that
  honoured it. What faces genuinely separate is *audiences*, and that survives
  intact, because an account key is only ever visible to people in rooms with
  you. Saying which of the two you get is worth more than a control that
  implies the other one.
-->
<section>
  <h3>What a face does and doesn't hide</h3>
  <p class="note">
    <b>In one room, your faces are not separate people.</b> Anyone in a room
    where two of your faces have spoken can tell they're both yours — who sent a
    message is attributed to your account, and the room's own roster records
    which account each face belongs to. A client that chooses to show you that
    is not breaking anything.
  </p>
  <p class="note">
    <b>Across rooms, they are.</b> Your account is only visible to people in
    rooms with you, so a face you use somewhere they aren't tells them nothing —
    and the server never learns any of it, because faces live inside the
    encryption.
  </p>
  <p class="note">
    If you need two identities that genuinely cannot be connected, that's two
    accounts, not two faces. Faces are how you appear; accounts are what the
    cryptography actually separates.
  </p>
</section>

<style>
  h2 { font-family: var(--font-display); font-weight: 600; font-size: var(--text-xl); margin: 0 0 4px; }
  h3 { font-size: var(--text-base); font-weight: 700; margin: 0 0 10px; }
  .note {
    margin: 0 0 10px; font-size: var(--text-sm); line-height: 1.6;
    color: var(--text-dim); max-width: 62ch;
  }
  .note b { color: var(--text); font-weight: 600; }
  .lede { color: var(--text-mute); margin: 0 0 28px; font-size: var(--text-sm); max-width: 56ch; }
  section { margin-bottom: 30px; }

  .face {
    display: flex; align-items: center; gap: 12px; padding: 10px 12px;
    border: 1px solid var(--line); border-radius: var(--r-md); margin-bottom: 8px;
    transition: border-color var(--t-fast) var(--ease), background var(--t-fast) var(--ease);
  }
  .face:hover { border-color: var(--ground-4); background: var(--ground-2); }
  .meta { flex: 1; min-width: 0; }
  .nm { font-weight: 700; }
  .sub { display: block; color: var(--text-mute); font-size: var(--text-sm); }
  .badge {
    font-size: 10px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
    color: var(--face-mint); border: 1px solid color-mix(in oklab, var(--face-mint) 45%, transparent);
    background: color-mix(in oklab, var(--face-mint) 15%, transparent);
    padding: 2px 7px; border-radius: var(--r-pill);
  }
  .edit, .add, .back {
    border: 0; cursor: pointer; font: inherit; font-size: var(--text-sm); font-weight: 600;
    padding: 7px 14px; border-radius: var(--r-pill);
    background: var(--ground-3); color: var(--text); flex: none;
    display: inline-flex; align-items: center; gap: 6px;
    transition: background var(--t-fast) var(--ease);
  }
  .edit:hover, .add:hover, .back:hover { background: var(--ground-4); }
  .edit:disabled { opacity: .45; cursor: default; }
  .add { margin-top: 4px; }
  .back { background: transparent; box-shadow: inset 0 0 0 1px var(--line); margin-bottom: 18px; font-size: 12px; }
  .add-row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
  .add-row input { flex: 1; }

  .preview {
    display: flex; align-items: center; gap: 13px; margin-bottom: 22px;
    padding: 14px; border-radius: var(--r-md); background: var(--ground-2);
  }
  .p-nm { font-weight: 700; font-size: var(--text-base); }
  .p-sub { font-size: var(--text-sm); color: var(--text-mute); }

  .field { display: block; margin-bottom: 18px; }
  .lbl { display: block; font-size: var(--text-sm); font-weight: 600; margin-bottom: 6px; }
  input[type='text'], textarea {
    width: 100%; font: inherit; font-size: var(--text-sm); color: var(--text);
    background: var(--ground-2); border: 1px solid var(--line); border-radius: var(--r-sm);
    padding: 10px 12px; resize: vertical;
  }
  input[type='text']:focus, textarea:focus { outline: 2px solid var(--brand); outline-offset: -1px; }
  .hint { display: block; font-size: 12px; color: var(--text-mute); margin-top: 6px; line-height: 1.5; max-width: 56ch; }

  .colours { display: flex; flex-wrap: wrap; gap: 8px; }
  .sw {
    width: 30px; height: 30px; border-radius: 50%; border: 0; cursor: pointer;
    display: grid; place-items: center; color: #fff;
    box-shadow: 0 0 0 2px transparent;
    transition: box-shadow var(--t-fast) var(--ease);
  }
  .sw.sel { box-shadow: 0 0 0 2px var(--ground-0), 0 0 0 4px currentColor; }

  .seg { display: inline-flex; gap: 3px; background: var(--ground-2); padding: 3px; border-radius: var(--r-pill); }
  .seg button {
    border: 0; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600;
    padding: 6px 14px; border-radius: var(--r-pill); background: transparent; color: var(--text-dim);
  }
  .seg button.sel { background: var(--brand); color: #fff; }

</style>
