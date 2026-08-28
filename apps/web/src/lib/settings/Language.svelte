<script lang="ts">
  /**
   * Settings → Language (`docs/19`, `docs/10`).
   *
   * The rule the whole screen is built around: **a decrypted message never
   * leaves the device to be translated.** There is no cloud fallback, not even
   * a quiet one for languages the local models can't do — shipping plaintext
   * to a translation API would undo the entire product, so a pair we can't
   * handle locally is a pair we say we can't handle.
   *
   * The other thing this screen must not do is imply the translation is
   * authoritative. Machine translation is machine translation; the original
   * stays visible in the message list, and the copy here says so once rather
   * than apologising in every string.
   */
  import Icon from '$lib/Icon.svelte';
  import { core } from '$lib/fake/core.svelte.js';
  import { INTERFACE_LANGUAGES, READABLE_LANGUAGES } from '$lib/fake/data.js';

  const l = $derived(core.language);
  const mb = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} GB` : `${n} MB`);

  /** Rooms written in something outside your reading list — the ones the
      global rule would actually act on. */
  const foreign = $derived(
    core.spaces.flatMap((s) =>
      s.rooms
        .filter((r) => r.language && !l.reads.includes(r.language))
        .map((r) => ({ space: s, room: r })),
    ),
  );

  let adding = $state(false);
  const addable = $derived(READABLE_LANGUAGES.filter((x) => !l.reads.includes(x)));

  function drop(lang: string) {
    // Removing the last language would mean translating everything into
    // nothing, so the list keeps a floor of one.
    if (l.reads.length > 1) l.reads = l.reads.filter((x) => x !== lang);
  }
</script>

<h2>Language</h2>
<p class="lede">
  Translation runs on this device, on models it downloads. Nothing you read here
  is sent anywhere to be translated — there is no cloud option, including as a
  fallback.
</p>

<section>
  <h3>Interface</h3>
  <div class="langs">
    {#each INTERFACE_LANGUAGES as opt (opt.id)}
      <button
        class:sel={l.interface === opt.id}
        onclick={() => (l.interface = opt.id)}
        aria-pressed={l.interface === opt.id}
      >
        {opt.name}
        {#if l.interface === opt.id}<Icon name="check" size={14} />{/if}
      </button>
    {/each}
  </div>
</section>

<section>
  <h3>Languages you read</h3>
  <p class="sub">
    Anything in one of these is left alone. Anything else is what the rule below
    applies to.
  </p>
  <div class="chips">
    {#each l.reads as lang (lang)}
      <span class="chip">
        {lang}
        {#if l.reads.length > 1}
          <button onclick={() => drop(lang)} aria-label="Remove {lang}">
            <Icon name="x" size={12} />
          </button>
        {/if}
      </span>
    {/each}
    {#if adding}
      {#each addable as lang (lang)}
        <button class="chip add" onclick={() => { l.reads = [...l.reads, lang]; adding = false; }}>
          {lang}
        </button>
      {:else}
        <span class="none">Nothing left to add.</span>
      {/each}
      <button class="chip cancel" onclick={() => (adding = false)}>Cancel</button>
    {:else}
      <button class="chip add" onclick={() => (adding = true)}>
        <Icon name="plus" size={12} /> Add
      </button>
    {/if}
  </div>
</section>

<section>
  <h3>When something isn't in one of them</h3>
  <label class="check">
    <input type="checkbox" bind:checked={l.auto} />
    <span>
      <b>Translate it automatically</b>
      <span class="sub">
        Off means each message gets a Translate button instead. Either way the
        original stays on screen — a translation is shown beneath it, never in
        place of it.
      </span>
    </span>
  </label>

  {#if foreign.length}
    <div class="rooms">
      {#each foreign as { space, room } (room.id)}
        <div class="row">
          <div class="meta">
            <div class="nm">#{room.name}<span class="in">in {space.name}</span></div>
            <div class="bl">Mostly {room.language}</div>
          </div>
          <label class="toggle">
            <input type="checkbox" bind:checked={room.translate} />
            <span>Always translate</span>
          </label>
        </div>
      {/each}
    </div>
  {:else}
    <p class="empty">Every room you're in is in a language you read.</p>
  {/if}
</section>

<section>
  <h3>Voice</h3>
  <label class="check">
    <input type="checkbox" bind:checked={l.transcribeVoice} />
    <span>
      <b>Transcribe voice messages</b>
      <span class="sub">
        Same architecture as translation and the same rule — the audio is
        decrypted here and stays here. Costs a separate model download.
      </span>
    </span>
  </label>
</section>

<section>
  <h3>Downloaded models</h3>
  <p class="sub">
    One per language pair, downloaded when you first need it. Deleting one frees
    the space; it re-downloads if you need it again.
  </p>
  {#each core.storage.models_ as m (m.id)}
    <div class="row">
      <div class="meta">
        <div class="nm">{m.name}</div>
        <div class="bl">
          {mb(m.mb)} ·
          {#if m.lastUsed}last used {m.lastUsed}{:else}never used{/if}
        </div>
      </div>
      <button class="del" onclick={() => core.deleteModel(m.id)}>Delete</button>
    </div>
  {:else}
    <p class="empty">Nothing downloaded yet.</p>
  {/each}
</section>

<p class="note">
  Machine translation is machine translation. It is good enough to follow a
  conversation and not good enough to trust with anything that matters, which is
  why the original is always one glance away rather than hidden behind a
  toggle.
</p>

<style>
  h2 { font-family: var(--font-display); font-weight: 600; font-size: var(--text-xl); margin: 0 0 4px; }
  .lede { color: var(--text-mute); margin: 0 0 28px; font-size: var(--text-sm); max-width: 62ch; line-height: 1.55; }
  section { margin-bottom: 34px; }
  h3 { font-size: var(--text-base); font-weight: 700; margin: 0 0 4px; }
  .sub { color: var(--text-mute); font-size: var(--text-sm); margin: 0 0 12px; display: block; line-height: 1.5; max-width: 60ch; }

  .langs { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 12px; }
  .langs button {
    display: inline-flex; align-items: center; gap: 7px;
    border: 2px solid var(--line); background: var(--ground-2); cursor: pointer;
    font: inherit; font-size: var(--text-sm); font-weight: 600; color: var(--text);
    padding: 8px 14px; border-radius: var(--r-pill);
    transition: border-color var(--t-fast) var(--ease), background var(--t-fast) var(--ease);
  }
  .langs button:hover { border-color: var(--ground-4); }
  .langs button.sel { border-color: var(--brand); background: var(--ground-3); }
  .langs :global(svg) { color: var(--brand); }

  .chips { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
  .chip {
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--ground-3); border-radius: var(--r-pill);
    padding: 6px 12px; font-size: var(--text-sm); font-weight: 600; color: var(--text);
    border: 0; font-family: inherit;
  }
  .chip button {
    border: 0; background: transparent; cursor: pointer; color: var(--text-mute);
    display: flex; padding: 0; border-radius: 50%;
  }
  .chip button:hover { color: var(--text); }
  .chip.add, .chip.cancel {
    cursor: pointer; background: transparent; color: var(--text-mute);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .chip.add:hover { color: var(--text); background: var(--ground-2); }
  .none { font-size: 12px; color: var(--text-mute); }

  .rooms { margin-top: 8px; }
  .row {
    display: flex; align-items: center; gap: 12px;
    padding: 11px 0; border-bottom: 1px solid var(--line);
  }
  .meta { flex: 1; min-width: 0; }
  .nm { font-size: var(--text-sm); font-weight: 600; display: flex; align-items: baseline; gap: 8px; }
  .in { font-weight: 400; font-size: 11px; color: var(--text-mute); }
  .bl { font-size: 12px; color: var(--text-mute); margin-top: 1px; }

  .toggle { display: flex; align-items: center; gap: 8px; cursor: pointer; flex: none; font-size: 12px; color: var(--text-dim); }
  .toggle input { width: 16px; height: 16px; accent-color: var(--face-mint); cursor: pointer; }

  .del {
    border: 1px solid var(--line); background: transparent; cursor: pointer;
    font: inherit; font-size: 12px; font-weight: 600; color: var(--text-mute);
    padding: 6px 12px; border-radius: var(--r-pill); flex: none;
    transition: color var(--t-fast) var(--ease), background var(--t-fast) var(--ease);
  }
  .del:hover { color: var(--text); background: var(--ground-2); }

  .check { display: flex; gap: 12px; align-items: flex-start; cursor: pointer; margin-bottom: 14px; }
  .check input { width: 18px; height: 18px; margin-top: 2px; accent-color: var(--face-mint); cursor: pointer; flex: none; }
  .check b { display: block; font-weight: 600; margin-bottom: 2px; font-size: var(--text-sm); }
  .check .sub { margin: 0; }

  .empty { font-size: var(--text-sm); color: var(--text-mute); margin: 0; }

  .note {
    margin: 0; font-size: var(--text-sm); color: var(--text-mute); line-height: 1.55;
    max-width: 60ch; border-left: 2px solid var(--line); padding-left: 14px;
  }
</style>
