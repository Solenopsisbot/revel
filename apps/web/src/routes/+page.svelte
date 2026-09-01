<script lang="ts">
import { goto } from '$app/navigation';
import BetaNotice from '$lib/BetaNotice.svelte';
import Mark from '$lib/Mark.svelte';
import Button from '$lib/moment/Button.svelte';

const pillars = [
  {
    title: 'No cleartext path',
    body: `There is one pipeline and it carries ciphertext — no second path for "public" rooms, for search, or for bots. So there is nothing on the server to hand over, to leak, or to quietly start reading.`,
  },
  {
    title: 'No ghost readers',
    body: `Anything that can read a room is in that room's member list — people, their devices, and bots alike. If a translation bot can see your messages, you can see the bot.`,
  },
  {
    title: 'Your key is you',
    body: `Your account is a keypair you hold, not a row in our database. The name people reach you by is issued by a server — ours, or one you run — and moving to a different one costs you nothing: same key, same rooms, same history.`,
  },
];

const costs: [string, string][] = [
  [
    'Server-side search',
    'Your device searches its own copy. A new device says so while it indexes, rather than quietly returning half the results.',
  ],
  [
    'Link previews',
    "Built by the sender's device and sent with the message, so nobody's server fetches a URL on your behalf.",
  ],
  [
    'Spam and abuse filtering',
    'Nothing scans your messages, because nothing can. Reports carry cryptographic proof instead, and moderators are members like anyone else.',
  ],
  [
    'Notification previews',
    'Pushes carry no content. Your phone decrypts locally, so a preview on your lock screen is your choice rather than ours.',
  ],
  [
    'Recovering your account',
    'We never had your password, so there is nothing to reset. Lose it and your recovery code, and the account is gone.',
  ],
];
</script>

<svelte:head><title>Revel — somewhere to actually talk</title></svelte:head>

<div class="page">
  <!-- Before the pitch, not after it. Somebody deciding whether to put their
       conversations here is owed the caveat while they are still deciding. -->
  <BetaNotice dismissible={false} />

  <header class="nav">
    <a class="brand" href="/"><Mark size={26} stroke="var(--ground-0)" /><span>Revel</span></a>
    <nav>
      <a class="secondary" href="/app">Open the app</a>
      <a href="/signin">Sign in</a>
      <Button onclick={() => goto('/signup')}>Make an account</Button>
    </nav>
  </header>

  <section class="hero">
    <div class="haze a"></div>
    <div class="haze b"></div>
    <div class="haze c"></div>
    <!-- Leaning, not standing: the landing page is the one screen where she
         is waiting on you rather than answering you. -->
    <img class="art" src="/wren/leaning.webp" alt="" aria-hidden="true" />
    <div class="wrap hero-in">
      <h1>Somewhere to actually talk.</h1>
      <p class="sub">
        Every room is end to end encrypted, with no cleartext path and no
        exceptions. Your headmates and your computer friends are members here,
        not features. And anything that can read a room is sitting in the member
        list where you can see it.
      </p>
      <div class="cta">
        <Button onclick={() => goto('/signup')}>Make an account</Button>
        <Button variant="secondary" onclick={() => goto('/app')}>Look around first</Button>
      </div>
      <p class="fine">
        We can't read your messages.<br />
        We also can't search them for you, recover them, or tell you what you missed.
      </p>
    </div>
  </section>

  <section class="band" id="how">
    <div class="wrap">
      <h2 class="big">Three promises, and how they're kept.</h2>
      <div class="pillars">
        {#each pillars as p (p.title)}
          <article class="pillar">
            <h3>{p.title}</h3>
            <p>{p.body}</p>
          </article>
        {/each}
      </div>
    </div>
  </section>

  <section class="band alt" id="costs">
    <div class="wrap">
      <h2 class="big">Here's what it costs.</h2>
      <p class="lede">
        A server that can't read your messages can't do things for you either.
        Most of it comes back — done on your device, or by someone visibly in
        the room. Some of it doesn't.
      </p>
      <div class="costs">
        {#each costs as [title, back], i (title)}
          <div class="cost">
            <div class="lost">{title}</div>
            <div class="back">{back}</div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="band" id="faces">
    <div class="wrap">
      <h2 class="big">Who's in the room is the whole point.</h2>
      <p class="lede">
        Two kinds of member most apps make you work around, and neither of them
        is a plug-in here.
      </p>
      <div class="two">
      <div class="feature">
        <h3>One account, many faces.</h3>
        <p>
          If you're a plural system, you shouldn't need five accounts and a bot
          to be yourself. One login, many names, avatars and pronouns —
          switched from the composer, per message. And if that isn't you, you
          will never see any of it: the machinery only appears once you have a
          second face.
        </p>
        <p class="micro">
          Whether your faces are publicly linked is off by default. Some
          systems are out; some very much aren't.
        </p>
      </div>
      <div class="feature">
        <h3>Computer friends are members.</h3>
        <p>
          The people in your rooms who happen to be AI aren't integrations
          bolted on from the side. Same presence, same permissions, same
          roster, and a badge saying what they are.
        </p>
        <p class="micro">
          They hold keys like anyone else, which is why they appear in the
          member list. It's also why we don't offer to host one for you: we'd
          be holding its keys, and then we could read your rooms.
        </p>
      </div>
      </div>
    </div>
  </section>

  <section class="band alt">
    <div class="wrap">
      <h2 class="big">Or run the whole thing yourself.</h2>
      <p class="lede">
        One binary, your own box, your own rules about who can sign in. The
        source is public, so you can read exactly what it does with your
        messages.
      </p>
      <div class="cta">
        <a class="gh" href="https://github.com/Solenopsisbot/revel" rel="noreferrer">
          <!-- GitHub's own mark. Inlined rather than added to `Icon`, which is
               a set of generic glyphs — a wordmark is somebody else's asset and
               does not belong in a palette of nouns. -->
          <svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
                 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
                 -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
                 .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
                 -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0
                 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82
                 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01
                 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
            />
          </svg>
          <span>View on GitHub</span>
        </a>
        <a class="link" href="/app">See how it works</a>
      </div>
    </div>
  </section>

  <footer>
    <div class="wrap foot">
      <div class="brand"><Mark size={22} stroke="var(--ground-0)" /><span>Revel</span></div>
      <p>
        The cryptography has not been independently audited yet. Encryption
        protects your messages from the server's operators and from a breach of
        its database; it does not protect against a compromised client build.
        <a href="/security">What we'd want to hear about</a>.
      </p>
    </div>
  </footer>
</div>

<style>
  /* Scrolls with the page now: `body` no longer hides its overflow for
     everybody, so this does not need to be its own scroll container — and a
     document that scrolls the document is the one that gets the browser's
     address-bar collapse on a phone. */
  .page { min-height: 100dvh; background: var(--ground-0); }
  /*
   * One measure and one gutter, shared by the hero and every band below it.
   *
   * The hero used to set its own `6vw` padding while the bands were a centred
   * 1080px box *plus* `6vw` — so at a desktop width the headline started about
   * a hundred pixels left of every heading under it, and nothing on the page
   * lined up with anything else. A landing page is mostly a column of text; if
   * the column moves, that is the thing people see.
   */
  .wrap {
    width: 100%;
    max-width: 68rem;
    margin: 0 auto;
    padding-inline: max(6vw, 20px);
  }

  .nav {
    position: sticky; top: 0; z-index: 20;
    display: flex; align-items: center; justify-content: space-between; gap: 20px;
    padding: 14px 6vw;
    background: color-mix(in oklab, var(--ground-0) 78%, transparent);
    backdrop-filter: blur(14px);
    border-bottom: 1px solid color-mix(in oklab, var(--line) 60%, transparent);
  }
  .brand { display: flex; align-items: center; gap: 10px; text-decoration: none; color: var(--text); }
  .brand span { font-family: var(--font-display); font-weight: 600; font-size: 1.3rem; letter-spacing: -.02em; }
  .nav nav { display: flex; align-items: center; gap: 18px; }
  .nav nav a {
    color: var(--text-dim); text-decoration: none; font-size: var(--text-sm); font-weight: 600;
    transition: color var(--t-fast) var(--ease);
  }
  /* Standalone navigation, not words in a sentence — so on a finger these take
     the same floor as everything else that is its own control. `align-items`
     keeps the row centred once the links are taller than their text. */
  @media (pointer: coarse) {
    .brand, .nav nav a {
      min-height: var(--tap); display: flex; align-items: center; justify-content: center;
    }
    /* Both dimensions, not just height. "Sign in" is 40px of word, and a target
       is a box — being tall enough does not help a thumb that lands 3px wide. */
    .nav nav a { min-width: var(--tap); }
  }
  .nav nav a:hover { color: var(--text); }

  .hero {
    position: relative; overflow: hidden; background: var(--moment-bg);
    padding-block: 12vh 14vh; display: flex; align-items: center; min-height: 74dvh;
  }
  .hero-in { position: relative; z-index: 2; }
  /* The measure the headline reads at, inside the shared gutter rather than
     instead of it — so `.wrap` still decides where the column starts. */
  .hero-in > * { max-width: 34rem; }
  h1 {
    font-family: var(--font-display); font-size: clamp(2.6rem, 6.4vw, 4.4rem);
    line-height: .97; letter-spacing: -.035em; font-weight: 600; margin: 0 0 22px;
  }
  .sub { font-size: 1.0625rem; line-height: 1.6; margin: 0 0 30px; color: color-mix(in oklab, var(--text) 90%, transparent); }
  /*
    GitHub's own colours, because a link to a repository that looks like every
    other button on the page is a link people do not recognise as one. White
    with the mark is what that button looks like everywhere it appears.
  */
  .gh {
    display: inline-flex; align-items: center; gap: 9px;
    background: #e9eaee; color: #24292f; text-decoration: none;
    font: inherit; font-weight: 600;
    padding: 11px 18px; border-radius: 999px;
    border: 1px solid rgba(0, 0, 0, .08);
    transition: background var(--t-fast) var(--ease), transform var(--t-fast) var(--ease);
  }
  .gh:hover { background: #f5f6f8; }

  .foot a { color: var(--text-2); text-underline-offset: 2px; }
  .foot a:hover { color: var(--text); }
  .gh:active { transform: translateY(1px); }

  .cta { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
  /* Quiet, not invisible. At 60% over the hero gradient this was below the
     point where it can be read at a glance, and it is the most honest sentence
     on the page — it should not be the hardest one to see. */
  .fine { margin-top: 30px; font-size: var(--text-sm); line-height: 1.7; color: color-mix(in oklab, var(--text) 74%, transparent); }

  .haze { position: absolute; z-index: 0; border-radius: 50%; filter: blur(70px); pointer-events: none; }
  .a { width: 520px; height: 520px; background: var(--face-violet); left: -160px; top: -140px; opacity: .5; }
  .b { width: 380px; height: 380px; background: var(--face-rose); right: 26%; bottom: -180px; opacity: .3; }
  .c { width: 300px; height: 300px; background: var(--face-aqua); left: 34%; top: -150px; opacity: .26; }
  .art {
    position: absolute; right: 2%; bottom: 0; z-index: 1; height: min(74dvh, 620px); width: auto;
    pointer-events: none;
    /* A true alpha cutout, so no edge mask — see `Moment.svelte` for why the
       shadow is doing the work the mask used to. */
    filter: drop-shadow(0 12px 34px rgb(0 0 0 / .5));
  }

  /*
   * One vertical rhythm for every band, so the page has a beat instead of five
   * different amounts of air. `clamp` because 92px of padding on a phone is
   * most of a screen.
   */
  .band { padding-block: clamp(64px, 9vw, 108px); }
  .band.alt { background: var(--ground-1); border-block: 1px solid var(--line); }
  h2, h3 { font-family: var(--font-display); font-weight: 600; letter-spacing: -.025em; }
  .big { font-size: clamp(1.9rem, 3.6vw, 2.6rem); margin: 0 0 16px; line-height: 1.1; }
  /* A heading with no deck under it still needs the same air before its
     content, or the two sections that have one and the two that don't read as
     different amounts of section. */
  .big:last-child { margin-bottom: 38px; }
  /* A deck, not body copy. At body size under a 2.6rem heading it read as the
     first paragraph of something rather than as the subtitle of the section. */
  .lede {
    color: var(--text-dim); max-width: 54ch; margin: 0 0 38px;
    font-size: 1.0625rem; line-height: 1.6;
  }

  .pillars {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0 34px;
  }
  /*
   * Anchored at the top by a rule, not by their bottoms.
   *
   * Three paragraphs of honest prose are never the same length, so the grid
   * always ends ragged — and a ragged grid floating in an empty band reads as a
   * layout that broke. A shared line across the top gives them one edge they do
   * all agree on, and the unevenness underneath becomes obviously fine.
   */
  .pillar { border-top: 1px solid var(--line); padding-top: 20px; }
  .pillar h3 { font-size: var(--text-xl); margin: 0 0 10px; }
  .pillar p { color: var(--text-dim); margin: 0; line-height: 1.62; }

  .costs {
    display: grid; gap: 1px; background: var(--line);
    border: 1px solid var(--line); border-radius: var(--r-md); overflow: hidden;
    max-width: 62rem;
  }
  .cost {
    display: grid; grid-template-columns: minmax(180px, 1fr) 2fr; gap: 24px;
    /* Darker than the band it sits on, so the table reads as a panel of rows
       rather than as five stray lines. It is the only inset thing on the page
       and it is the only place the page is making a list of losses. */
    background: var(--ground-0); padding: 18px 22px;
    transition: background var(--t-base) var(--ease);
  }
  .cost:hover { background: var(--ground-2); }
  .back { line-height: 1.6; }
  /* Coral, because these are genuinely losses. Softening the colour here
     would be softening the claim. */
  .lost { font-weight: 700; color: var(--face-coral); }
  .back { color: var(--text-dim); font-size: var(--text-sm); }

  .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 0 34px; }
  /* Same top rule as the pillars, for the same reason and so the two grids on
     the page are recognisably the same kind of thing. */
  .feature { border-top: 1px solid var(--line); padding-top: 20px; }
  .feature h3 { font-size: var(--text-xl); margin: 0 0 10px; }
  .feature p { color: var(--text-dim); margin: 0 0 14px; line-height: 1.62; }
  .micro { font-size: var(--text-sm); color: var(--text-mute); line-height: 1.6; }

  .link {
    display: inline-flex; align-items: center; gap: 7px; color: var(--text-dim);
    text-decoration: none; font-weight: 600; font-size: var(--text-sm);
    transition: color var(--t-fast) var(--ease);
  }
  .link:hover { color: var(--text); }

  footer { padding: 46px 0 70px; border-top: 1px solid var(--line); }
  .foot { display: flex; gap: 26px; align-items: flex-start; flex-wrap: wrap; }
  .foot p { color: var(--text-mute); font-size: var(--text-sm); max-width: 60ch; margin: 0; line-height: 1.7; }

  @media (max-width: 860px) {
    .art { display: none; }
    /* The hero's height was making room for her. With her gone it was 14vh of
       empty gradient under the last line — on the screen where vertical space
       is the scarce thing and the fold is the whole argument. */
    .hero { min-height: 0; padding-block: 8vh 9vh; }
    .cost { grid-template-columns: 1fr; gap: 6px; }
    /*
      "Open the app" goes; **"Sign in" stays.** Hiding both left a returning
      visitor on a phone with no way back into their account from anywhere on
      this page — not the nav, not the footer, nowhere. They would have had to
      know to type `/signin`.
    */
    .nav nav a.secondary { display: none; }
  }
</style>
