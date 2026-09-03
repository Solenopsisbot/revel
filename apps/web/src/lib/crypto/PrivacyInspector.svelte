<script lang="ts">
import Avatar from '../Avatar.svelte';
import { faceColour } from '../colour.js';
import { core } from '../fake/core.svelte.js';
import Icon from '../Icon.svelte';

import type { Face } from '../fake/data.js';

let { open = $bindable(false) }: { open?: boolean } = $props();

let copied = $state(false);

const members = $derived.by(() => {
  const ids = core.facesHere ?? Object.keys(core.faces);
  return ids.map((id) => core.faces[id]).filter((f): f is Face => Boolean(f));
});

function copyFingerprint(fp: string) {
  void navigator.clipboard?.writeText(fp).catch(() => {});
  copied = true;
  setTimeout(() => (copied = false), 1500);
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && open) {
    e.stopPropagation();
    open = false;
  }
}
</script>

<svelte:window onkeydown={onKey} />

{#if open}
  <div
    class="scrim"
    role="button"
    tabindex="-1"
    aria-label="Close privacy inspector"
    onclick={() => (open = false)}
    onkeydown={(e) => e.key === 'Enter' && (open = false)}
  ></div>

  <div class="sheet" role="dialog" aria-modal="true" aria-label="Room Privacy & Key Inspection">
    <header class="head">
      <div class="head-title">
        <Icon name="key" size={20} />
        <h2>Room Privacy & Key Inspection</h2>
      </div>
      <button class="close" onclick={() => (open = false)} aria-label="Close">
        <Icon name="plus" size={18} />
      </button>
    </header>

    <div class="content">
      <section class="section">
        <h3>MLS Ratchet Group State</h3>
        <p class="desc">
          Every conversation in Revel is an autonomous MLS (RFC 9420) cryptographic group.
          Epoch ratchets roll on every message and membership change.
        </p>
        <div class="meta-grid">
          <div class="meta-box">
            <span class="label">Current Epoch</span>
            <span class="val mono">Epoch #42</span>
          </div>
          <div class="meta-box">
            <span class="label">Ciphersuite</span>
            <span class="val mono">MLS128_X25519_AES128GCM</span>
          </div>
          <div class="meta-box wide">
            <span class="label">Ratchet Tree Root Hash</span>
            <span class="val mono">3f9a · b0c2 · 8114 · ed51 · 77a0 · cc41 · 092b</span>
          </div>
        </div>
      </section>

      <section class="section">
        <h3>What the Server Sees on the Wire</h3>
        <p class="desc">
          The host server relays opaque encrypted frames. It never possesses keying material,
          meaning it is mathematically incapable of reading, forging, or reconstructing history.
        </p>
        <div class="wire-box">
          <div class="wire-head">
            <span>Raw Relayed Wire Envelope</span>
            <span class="wire-tag">MLS CIPHERTEXT</span>
          </div>
          <code class="wire-hex">
            0x48616b6b6120526576656c2045324545204d4c532043697068657274657874205061796c6f61642030386665656463616665
          </code>
        </div>
      </section>

      <section class="section">
        <h3>Member Identity Fingerprints ({members.length})</h3>
        <p class="desc">
          No ghost readers. Every device and software agent with access to this group ratchet
          is verified below.
        </p>
        <div class="members-list">
          {#each members as f (f.id)}
            <div class="m-card">
              <Avatar face={f} size={36} />
              <div class="m-meta">
                <div class="m-top">
                  <span class="m-nm" style="color: var(--face-{faceColour(f)})">{f.name}</span>
                  {#if f.agent}
                    <span class="badge agent">{f.agent.label}</span>
                  {:else if f.id === core.speakingAs}
                    <span class="badge me">you</span>
                  {/if}
                </div>
                <span class="m-fp mono">ed25519:{f.id.slice(0, 4)}···{f.colour}9b</span>
              </div>
              <button
                class="copy-btn"
                onclick={() => copyFingerprint(`revel:ed25519:${f.id}:${f.colour}`)}
                title="Copy public fingerprint"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          {/each}
        </div>
      </section>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed; inset: 0; z-index: 80; border: 0; padding: 0;
    background: var(--scrim); backdrop-filter: blur(4px);
    animation: fade var(--t-fast) var(--ease);
  }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }

  .sheet {
    position: fixed; z-index: 81; left: 50%; top: 50%; translate: -50% -50%;
    width: min(640px, calc(100vw - 32px));
    max-height: 84vh; display: flex; flex-direction: column; overflow: hidden;
    background: var(--ground-1); border: 1.5px solid var(--line-strong);
    border-radius: var(--r-lg); box-shadow: var(--shadow-panel), var(--highlight-inset);
    animation: drop var(--t-base) var(--ease);
  }
  @keyframes drop {
    from { opacity: 0; transform: translateY(-10px) scale(0.99); }
    to { opacity: 1; transform: none; }
  }

  .head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px; border-bottom: 1px solid var(--line);
    background: var(--ground-2);
  }
  .head-title { display: flex; align-items: center; gap: 10px; color: var(--face-mint); }
  .head-title h2 { margin: 0; font-family: var(--font-display); font-size: var(--text-base); font-weight: 600; color: var(--text); }
  .close {
    border: 0; background: transparent; cursor: pointer; color: var(--text-mute);
    width: 32px; height: 32px; border-radius: var(--r-sm); display: grid; place-items: center;
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
  }
  .close :global(svg) { rotate: 45deg; }
  .close:hover { background: var(--ground-3); color: var(--text); }

  .content { overflow-y: auto; padding: 22px 20px 28px; display: flex; flex-direction: column; gap: 24px; }
  .section h3 { margin: 0 0 6px; font-size: var(--text-sm); font-weight: 700; color: var(--text); }
  .desc { margin: 0 0 12px; font-size: var(--text-xs); color: var(--text-dim); line-height: 1.55; }

  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .meta-box {
    background: var(--ground-2); border: 1px solid var(--line);
    padding: 9px 12px; border-radius: var(--r-sm);
    display: flex; flex-direction: column; gap: 3px;
  }
  .meta-box.wide { grid-column: span 2; }
  .label { font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--text-mute); }
  .val { font-size: 12px; font-weight: 600; color: var(--text); }
  .mono { font-family: var(--font-mono); }

  .wire-box {
    background: var(--ground-0); border: 1px solid var(--line-strong);
    border-radius: var(--r-sm); padding: 12px 14px; display: flex; flex-direction: column; gap: 8px;
  }
  .wire-head { display: flex; align-items: center; justify-content: space-between; font-size: 10px; font-weight: 800; color: var(--text-mute); }
  .wire-tag {
    background: color-mix(in oklab, var(--face-mint) 16%, transparent);
    color: var(--face-mint); padding: 2px 6px; border-radius: var(--r-xs);
  }
  .wire-hex {
    font-size: 11px; color: var(--text-dim); word-break: break-all; line-height: 1.6;
    letter-spacing: .06em;
  }

  .members-list { display: flex; flex-direction: column; gap: 6px; }
  .m-card {
    display: flex; align-items: center; gap: 10px; padding: 8px 12px;
    background: var(--ground-2); border: 1px solid var(--line); border-radius: var(--r-sm);
  }
  .m-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .m-top { display: flex; align-items: center; gap: 6px; }
  .m-nm { font-weight: 700; font-size: var(--text-sm); }
  .m-fp { font-size: 11px; color: var(--text-mute); }
  .badge {
    font-size: 9px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase;
    padding: 1px 5px; border-radius: var(--r-xs); line-height: 1.3;
  }
  .badge.agent { background: color-mix(in oklab, var(--face-gold) 16%, transparent); color: var(--face-gold); }
  .badge.me { background: var(--ground-4); color: var(--text); }
  .copy-btn {
    border: 1px solid var(--line); background: var(--ground-3); cursor: pointer;
    color: var(--text-dim); font: inherit; font-size: 11px; font-weight: 700;
    padding: 4px 10px; border-radius: var(--r-pill);
    box-shadow: 0 var(--lift) 0 var(--ground-4), var(--highlight-inset);
    transition: transform var(--t-fast) var(--ease-toy), filter var(--t-fast) var(--ease);
  }
  .copy-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
  .copy-btn:active { transform: translateY(var(--lift)); box-shadow: none; }
</style>
