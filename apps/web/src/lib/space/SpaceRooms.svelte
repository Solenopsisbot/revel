<script lang="ts">
/**
 * Space → Rooms (`docs/18`): the list, create/delete, and per-room settings.
 *
 * The audience picker is the careful one. A room's audience *is* its
 * encryption group — the crypto boundary — while who can post or pin are
 * rules the space enforces. Users must not be misled about which is which,
 * so the picker says the difference in three lines at the point of decision
 * and never says "MLS", "epoch" or "key group".
 *
 * Audience is immutable after creation. There is no re-encryption story for
 * a populated room, so the control is disabled afterwards *with the reason*
 * rather than greying out mysteriously.
 */

import { core } from '$lib/fake/core.svelte.js';
import type { Audience, Room } from '$lib/fake/data.js';
import Icon from '$lib/Icon.svelte';
import { whyNot } from '$lib/startErrors.js';
import { wren } from '$lib/wren/wren.svelte.js';

let { initialRoom }: { initialRoom?: string } = $props();

const space = $derived(core.space);
/** Which room's settings are open. Seeded from the prop — the caller can
      deep-link straight to one room — and owned by this component after that,
      so picking a different room from the list doesn't fight the prop. */
let editing = $state<string | null>(null);
$effect(() => {
  if (initialRoom) editing = initialRoom;
});
let creating = $state(false);
let newName = $state('');
let newKind = $state<'text' | 'voice'>('text');
/** The audience for a room that doesn't exist yet — the only time it's editable. */
let newAudience = $state<Audience>({ kind: 'everyone' });

const room = $derived(space.rooms.find((r) => r.id === editing));

/**
 * Roles you can build an audience from.
 *
 * `@everyone` is not one of them: an audience of "people with @everyone" is
 * the `everyone` audience with extra steps, and it would make a second key
 * group holding exactly the same people (`docs/03` §4).
 */
const pickableRoles = $derived(space.roles.filter((r) => !r.everyone));

/** A role, by whichever identifier the audience happens to be written in. */
const nameRole = (ref: string) =>
  space.roles.find((r) => r.id === ref || r.name === ref)?.name ?? ref;

function describe(a: Audience): string {
  if (a.kind === 'everyone') return 'Everyone in this space';
  if (a.kind === 'roles') return `People with ${a.roles.map(nameRole).join(' or ')}`;
  return `${a.faceIds.length} people, picked`;
}

/** Nudge toward reusing an existing group: a second identical audience is a
      second key group with a real cost (`docs/18`). */
function matches(a: Audience): string | null {
  if (a.kind !== 'roles') return null;
  const key = [...a.roles].sort().join();
  const twin = space.rooms.find(
    (r) => r.audience.kind === 'roles' && [...r.audience.roles].sort().join() === key,
  );
  return twin ? `#${twin.name}` : null;
}

let failed = $state('');

/**
 * Make the room.
 *
 * The audience goes *in* rather than being set on the room afterwards. It is
 * the crypto boundary, chosen once and never again (`docs/03` §4) — assigning
 * it after the fact worked on a fixture and would have made a live room whose
 * group did not match the audience its own settings claimed.
 */
async function create() {
  const name = newName.trim();
  if (!name) return;
  failed = '';
  const audience =
    newAudience.kind === 'roles'
      ? ({ kind: 'roles', roles: newAudience.roles } as const)
      : ({ kind: 'everyone' } as const);
  const result = await core.createRoom(space.id, name, audience, newKind);
  if (result.error) {
    failed = result.error;
    return;
  }
  creating = false;
  newName = '';
  newKind = 'text';
  newAudience = { kind: 'everyone' };
}

/**
 * Ask first. This is the one control on the screen that cannot be undone.
 *
 * The body says what is actually true rather than what would be reassuring:
 * the Host forgets the bytes, and the people who already read them may have
 * kept them. No app can fix that half and pretending otherwise here would be
 * the worst place to do it.
 */
function confirmDelete(r: Room) {
  wren.confirm({
    title: `Delete #${r.name}?`,
    body: `Every message in it goes, for everyone — they were encrypted to this room and there is nowhere else they live. People who already read them may have kept them; that part no app can fix.`,
    confirm: `Delete #${r.name}`,
    onConfirm: async () => {
      const result = await core.deleteRoom(space.id, r.id);
      if (result.error) failed = result.error;
      editing = null;
    },
  });
}

/**
 * The name and topic boxes, committed on blur.
 *
 * Both ride one `room.name` event, so they are saved together — and neither is
 * saved per keystroke, which is what `oninput` did: live, that is one encrypted
 * event sent to every member of the room for every character typed.
 */
let draftName = $state('');
let draftTopic = $state('');
$effect(() => {
  draftName = room?.name ?? '';
  draftTopic = room?.topic ?? '';
});

function saveIdentity() {
  if (!room) return;
  const name = draftName.trim();
  if (!name) return;
  if (name === room.name && (draftTopic.trim() || undefined) === room.topic) return;
  core.renameRoom(space.id, room.id, name, draftTopic);
}

function toggleRole(a: Audience, role: string): Audience {
  if (a.kind !== 'roles') return { kind: 'roles', roles: [role] };
  const roles = a.roles.includes(role) ? a.roles.filter((r) => r !== role) : [...a.roles, role];
  return roles.length ? { kind: 'roles', roles } : { kind: 'everyone' };
}
</script>

<h2>Rooms</h2>
<p class="lede">
  {space.rooms.length}
  {space.rooms.length === 1 ? 'room' : 'rooms'} in {space.name}. Deleting one
  deletes its history for everyone — the messages were encrypted to this room
  and there's nowhere else they live.
</p>

{#if room}
  <!-- Per-room settings -->
  <button class="back" onclick={() => (editing = null)}>
    <Icon name="chevron-left" size={15} /> All rooms
  </button>

  <section>
    <label class="field">
      <span class="lbl">Name</span>
      <input
        type="text"
        bind:value={draftName}
        onblur={saveIdentity}
        onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        maxlength="200"
      />
    </label>

    {#if room.kind === 'text'}
      <label class="field">
        <span class="lbl">Topic</span>
        <input
          type="text"
          placeholder="What's this room for?"
          bind:value={draftTopic}
          onblur={saveIdentity}
          onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          maxlength="2000"
        />
        <span class="hint">
          Shown in the header. Encrypted like everything else — which is why
          both of these save when you click away rather than as you type.
        </span>
      </label>
    {/if}

    {#if core.demo}
      <label class="field">
        <span class="lbl">Category</span>
        <input
          type="text"
          value={room.category}
          oninput={(e) => (room.category = e.currentTarget.value.trim() || 'General')}
        />
      </label>
    {/if}
  </section>

  {#if room.kind === 'text'}
    <section>
      <h3>Threads in #{room.name}</h3>
      <!-- The one genuine privacy knob a thread has (`docs/03` §metadata).
           Copy from `docs/08`, kept close to its wording because it was
           written to say the awkward thing without either overselling the
           protection or making the default sound reckless. -->
      <label class="toggle" class:off={!core.demo}>
        <input
          type="checkbox"
          checked={room.streamPaging !== false}
          disabled={!core.demo}
          onchange={(e) => (room.streamPaging = e.currentTarget.checked)}
        />
        <span>
          <b>Let the server page threads separately</b>
          <span class="hint">
            Threads in this room become their own streams on the server, which
            makes them faster to load and means the server learns that a thread
            exists and which messages are in it — never what they say. Turn it
            off and threads are paged on your device instead: slower, and the
            structure stays private.
          </span>
        </span>
      </label>
      <p class="boundary">
        Either way a thread is <b>inside</b> this room — same people, same keys.
        This is about how it is fetched, not about who can read it.
      </p>
      {#if !core.demo}
        <!-- The room is created with `streamPaging: false` and there is no
             route to change it afterwards. A switch that moved and did nothing
             would be worse here than anywhere else on this screen: it is the
             one control that claims to change what the server learns. -->
        <p class="hint">
          Fixed when the room is made, for now — threads in this room are paged
          on your device.
        </p>
      {/if}
    </section>
  {/if}

  <section>
    <h3>Who can see #{room.name}</h3>
    <div class="aud locked">
      <div class="current">
        <Icon name="lock" size={15} />
        <b>{describe(room.audience)}</b>
      </div>
      <p class="why">
        To change who can see a room, make a new one — the messages in here were
        encrypted for the people above, and that can't be rewritten.
      </p>
    </div>
    <p class="boundary">
      Everyone listed above holds the keys to this room. Other permissions —
      who can post, who can pin — are rules this space enforces.
      <b>This one is the lock itself.</b>
    </p>
  </section>

  <section>
    <button class="danger" onclick={() => confirmDelete(room)}>
      Delete #{room.name}
    </button>
  </section>
{:else}
  <!-- The list -->
  {#each space.rooms as r (r.id)}
    <div class="row">
      <span class="glyph">
        {#if r.kind === 'voice'}<Icon name="voice" size={15} />{:else}#{/if}
      </span>
      <div class="meta">
        <div class="nm">{r.name}</div>
        <div class="bl">
          {r.category} · {describe(r.audience)}
          {#if r.topic}· {r.topic}{/if}
        </div>
      </div>
      <button class="edit" onclick={() => (editing = r.id)}>Settings</button>
    </div>
  {/each}

  {#if creating}
    <div class="new">
      <div class="new-top">
        <!-- Voice rooms are `docs/06` phase 5 and the Host has no `kind` to
             put one in, so a live space makes text rooms and does not offer a
             button that would quietly make one anyway. -->
        <div class="seg">
          <button class:sel={newKind === 'text'} onclick={() => (newKind = 'text')}>Text</button>
          {#if core.demo}
            <button class:sel={newKind === 'voice'} onclick={() => (newKind = 'voice')}>Voice</button>
          {/if}
        </div>
        <input
          type="text"
          bind:value={newName}
          placeholder="room-name"
          onkeydown={(e) => e.key === 'Enter' && create()}
        />
      </div>

      <div class="aud">
        <span class="lbl">Who can see it</span>
        <label class="opt" class:sel={newAudience.kind === 'everyone'}>
          <input
            type="radio"
            checked={newAudience.kind === 'everyone'}
            onchange={() => (newAudience = { kind: 'everyone' })}
          />
          <span>Everyone in this space</span>
        </label>
        <label class="opt" class:sel={newAudience.kind === 'roles'}>
          <input
            type="radio"
            checked={newAudience.kind === 'roles'}
            onchange={() => (newAudience = { kind: 'roles', roles: pickableRoles.slice(0, 1).map((r) => r.id) })}
          />
          <span>People with a role</span>
        </label>
        {#if newAudience.kind === 'roles'}
          <div class="roles">
            <!-- Ids, not names. The Host resolves an audience from role ids
                 and has never been told the names (`docs/04` §1), so a picker
                 that collected names would build a room nobody matched.
                 `nameRole` puts the words back for the sentence underneath. -->
            {#each pickableRoles as role (role.id)}
              <button
                class="role"
                class:on={newAudience.kind === 'roles' && newAudience.roles.includes(role.id)}
                onclick={() => (newAudience = toggleRole(newAudience, role.id))}
              >{role.name}</button>
            {/each}
          </div>
          {#if matches(newAudience)}
            <p class="reuse">
              Same set of people as {matches(newAudience)} — it'll share that
              room's group rather than making a second one.
            </p>
          {/if}
        {/if}

        <p class="boundary">
          Everyone you pick holds the keys to this room.
          <b>This is the lock, not a permission</b> — and it can't be changed
          once the room exists.
        </p>
      </div>

      {#if failed}
        <p class="failed">{whyNot(failed)}</p>
      {/if}

      <div class="new-actions">
        <button class="go" disabled={!newName.trim()} onclick={create}>Create room</button>
        <button class="cancel" onclick={() => (creating = false)}>Cancel</button>
      </div>
    </div>
  {:else}
    <button class="add" onclick={() => (creating = true)}>
      <Icon name="plus" size={15} /> Create a room
    </button>
  {/if}
{/if}

<style>
  .toggle { display: flex; gap: 12px; align-items: flex-start; cursor: pointer; margin-bottom: 12px; }
  .toggle input { width: 18px; height: 18px; margin-top: 2px; accent-color: var(--face-mint); cursor: pointer; flex: none; }
  .toggle > span { min-width: 0; }
  .toggle b { display: block; font-weight: 600; font-size: var(--text-sm); margin-bottom: 3px; }

  h2 { font-family: var(--font-display); font-weight: 600; font-size: var(--text-xl); margin: 0 0 4px; }
  .lede { color: var(--text-mute); margin: 0 0 24px; font-size: var(--text-sm); max-width: 60ch; line-height: 1.55; }
  section { margin-bottom: 30px; }
  h3 { font-size: var(--text-base); font-weight: 700; margin: 0 0 10px; }

  .row {
    display: flex; align-items: center; gap: 11px;
    padding: 11px 0; border-bottom: 1px solid var(--line);
  }
  .glyph { width: 18px; display: grid; place-items: center; color: var(--text-mute); flex: none; }
  .meta { flex: 1; min-width: 0; }
  .nm { font-size: var(--text-sm); font-weight: 600; }
  .bl { font-size: 12px; color: var(--text-mute); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .edit, .add, .go, .cancel, .back, .danger {
    border: 1px solid var(--line); background: transparent; cursor: pointer;
    font: inherit; font-size: 12px; font-weight: 600; color: var(--text-mute);
    padding: 6px 12px; border-radius: var(--r-pill); flex: none;
    display: inline-flex; align-items: center; gap: 6px;
    transition: color var(--t-fast) var(--ease), background var(--t-fast) var(--ease);
  }
  .edit:hover, .add:hover, .cancel:hover, .back:hover { color: var(--text); background: var(--ground-2); }
  .add, .back { margin: 14px 0; }
  .go { background: var(--brand); color: #fff; border-color: transparent; }
  .go:disabled { opacity: .45; cursor: default; }
  .danger { color: var(--face-rose); border-color: color-mix(in oklab, var(--face-rose) 45%, transparent); }
  .danger:hover { background: color-mix(in oklab, var(--face-rose) 16%, transparent); }

  .field { display: block; margin-bottom: 16px; }
  .lbl { display: block; font-size: var(--text-sm); font-weight: 600; margin-bottom: 6px; }
  input[type='text'] {
    width: 100%; font: inherit; font-size: var(--text-sm); color: var(--text);
    background: var(--ground-2); border: 1px solid var(--line); border-radius: var(--r-sm);
    padding: 10px 12px;
  }
  input[type='text']:focus { outline: 2px solid var(--brand); outline-offset: -1px; }
  .hint { font-size: 12px; color: var(--text-mute); margin-top: 5px; display: block; }

  .new { border: 1px solid var(--ground-4); border-radius: var(--r-md); padding: 14px; margin-top: 14px; }
  .new-top { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; }
  .new-top input { flex: 1; }
  .seg { display: inline-flex; gap: 3px; background: var(--ground-2); padding: 3px; border-radius: var(--r-pill); flex: none; }
  .seg button {
    border: 0; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600;
    padding: 6px 13px; border-radius: var(--r-pill); background: transparent; color: var(--text-dim);
  }
  .seg button.sel { background: var(--brand); color: #fff; }

  .aud { background: var(--ground-2); border-radius: var(--r-md); padding: 13px 14px; }
  .aud.locked { background: var(--ground-2); }
  .current { display: flex; align-items: center; gap: 9px; font-size: var(--text-sm); color: var(--text); }
  .why { margin: 8px 0 0; font-size: 12px; color: var(--text-mute); line-height: 1.55; }

  .opt { display: flex; align-items: center; gap: 9px; padding: 7px 2px; cursor: pointer; font-size: var(--text-sm); color: var(--text-dim); }
  .opt.sel { color: var(--text); }
  .opt input { accent-color: var(--brand); cursor: pointer; }

  .roles { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 0 26px; }
  .failed { margin: 8px 0 0; font-size: 13px; color: var(--danger); }
  .toggle.off { opacity: .6; }
  .role {
    border: 1px solid var(--line); background: transparent; cursor: pointer;
    font: inherit; font-size: 12px; font-weight: 600; color: var(--text-mute);
    padding: 5px 11px; border-radius: var(--r-pill);
  }
  .role.on { background: var(--brand); color: #fff; border-color: transparent; }
  .reuse { margin: 9px 0 0 26px; font-size: 12px; color: var(--face-mint); line-height: 1.5; }

  /* The three lines that carry the whole distinction, at the point of choice. */
  .boundary {
    margin: 12px 0 0; padding-top: 11px; border-top: 1px solid var(--line);
    font-size: 12px; color: var(--text-mute); line-height: 1.6;
  }
  .boundary b { color: var(--text); }

  .new-actions { display: flex; gap: 8px; margin-top: 14px; }
</style>
