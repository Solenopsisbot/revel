<script lang="ts">
let moving = $state(false);
</script>

<h2>Account</h2>
<p class="lede">viola@revel.chat</p>

<section class="provider">
  <div class="grid">
    <span class="k">Your provider</span><span class="v">revel.chat</span>
    <span class="k">What lives there</span>
    <span class="v">your handle, your encrypted account backup, your device list</span>
    <span class="k">What doesn't</span>
    <span class="v">your messages, your rooms, your keys</span>
  </div>
  <button class="move" onclick={() => (moving = !moving)}>Move to another provider…</button>
  {#if moving}
    <p class="note">
      Your account key doesn't change, so your rooms, history and contacts are
      unaffected — nobody has to re-add you. Your address changes, and mentions
      of the old one keep working for as long as the old provider serves the
      forwarding record.
    </p>
  {/if}
</section>

<section>
  <h3>Your ways back in</h3>
  <div class="ways">
    <div class="way"><span class="n">Password</span><span class="s">set</span><button>Change</button></div>
    <div class="way"><span class="n">Recovery code</span><span class="s">saved 27 Aug</span><button>Show</button><button>Replace</button></div>
    <div class="way"><span class="n">Passkeys</span><span class="s">1 registered</span><button>Manage</button></div>
  </div>
  <p class="note">
    Any one of these gets you back in. Lose all three and the account can't be
    recovered.
  </p>
</section>

<style>
  h2 { font-family: var(--font-display); font-weight: 600; font-size: var(--text-xl); margin: 0 0 4px; }
  .lede { color: var(--text-mute); margin: 0 0 28px; font-size: var(--text-sm); font-family: var(--font-mono); }
  section { margin-bottom: 32px; }
  h3 { font-size: var(--text-base); font-weight: 700; margin: 0 0 12px; }

  .provider { background: var(--ground-2); border-radius: var(--r-md); padding: 18px 20px; }
  .grid { display: grid; grid-template-columns: minmax(120px, auto) 1fr; gap: 8px 18px; font-size: var(--text-sm); }
  .k { color: var(--text-mute); }
  .v { color: var(--text-dim); }
  .move {
    margin-top: 16px; border: 0; cursor: pointer; font: inherit; font-size: var(--text-sm); font-weight: 600;
    padding: 7px 14px; border-radius: var(--r-pill); background: var(--ground-3); color: var(--text);
    transition: background var(--t-fast) var(--ease);
  }
  .move:hover { background: var(--ground-4); }

  .ways { display: flex; flex-direction: column; gap: 8px; }
  .way {
    display: flex; align-items: center; gap: 12px; padding: 11px 14px;
    border: 1px solid var(--line); border-radius: var(--r-md);
    /* Three fixed-width children plus a 130px label do not fit a 340px pane,
       and the row overflowed its own card on a phone. Wrapping is right rather
       than shrinking: the label and the state belong on one line together. */
    flex-wrap: wrap;
  }
  .way .n { font-weight: 600; min-width: min(130px, 100%); }
  .way .s { flex: 1; min-width: 0; color: var(--text-mute); font-size: var(--text-sm); }
  .way button {
    border: 0; cursor: pointer; font: inherit; font-size: var(--text-sm); font-weight: 600;
    padding: 6px 13px; border-radius: var(--r-pill); background: var(--ground-3); color: var(--text);
    transition: background var(--t-fast) var(--ease);
  }
  .way button:hover { background: var(--ground-4); }
  .note { margin-top: 14px; color: var(--text-mute); font-size: var(--text-sm); max-width: 58ch; }
</style>
