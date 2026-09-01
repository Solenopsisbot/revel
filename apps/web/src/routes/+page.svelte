<script lang="ts">
import { goto } from '$app/navigation';
import BetaNotice from '$lib/BetaNotice.svelte';
import Mark from '$lib/Mark.svelte';
import Button from '$lib/moment/Button.svelte';
import Reveal from '$lib/Reveal.svelte';

const pillars = [
  {
    title: 'No cleartext path',
    body: `Every room is end to end encrypted. Not as an option, not for "public" rooms, not for bots. There is one pipeline and it carries ciphertext, so there is nothing on the server to hand over, to leak, or to quietly start reading.`,
  },
  {
    title: 'No ghost readers',
    body: `Anything that can read a room is in that room's member list — people, their devices, and bots alike. If a translation bot can see your messages, you can see the bot.`,
  },
  {
    title: 'Your key is you',
    body: `Your account is a keypair you own. Your handle lives with a provider you can leave, and moving doesn't cost you your rooms, your history or your contacts.`,
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
      <a href="/app">Open the app</a>
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
    <div class="hero-in">
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
    <div class="wrap pillars">
      {#each pillars as p, i (p.title)}
        <Reveal delay={i * 90}>
          <article class="pillar">
            <h2>{p.title}</h2>
            <p>{p.body}</p>
          </article>
        </Reveal>
      {/each}
    </div>
  </section>

  <section class="band alt" id="costs">
    <div class="wrap">
      <Reveal>
        <h2 class="big">Here's what it costs.</h2>
        <p class="lede">
          A server that can't read your messages can't do things for you either.
          Most of it comes back — done on your device, or by someone visibly in
          the room. Some of it doesn't.
        </p>
      </Reveal>
      <div class="costs">
        {#each costs as [title, back], i (title)}
          <Reveal delay={i * 60}>
            <div class="cost">
              <div class="lost">{title}</div>
              <div class="back">{back}</div>
            </div>
          </Reveal>
        {/each}
      </div>
    </div>
  </section>

  <section class="band" id="faces">
    <div class="wrap two">
      <Reveal>
        <div class="feature">
          <h2>One account, many faces.</h2>
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
      </Reveal>
      <Reveal delay={90}>
        <div class="feature">
          <h2>Computer friends are members.</h2>
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
      </Reveal>
    </div>
  </section>

  <section class="band alt">
    <div class="wrap">
      <Reveal>
        <h2 class="big">Or run the whole thing yourself.</h2>
        <p class="lede">
          One binary, your own box, your own rules about who can sign in. The
          source is public, so you can check what it does rather than take our
          word for it. Centralised until you'd rather it wasn't.
        </p>
        <div class="cta">
          <Button variant="secondary" onclick={() => goto('/app')}>See how it works</Button>
          <a class="link" href="https://github.com/Solenopsisbot/revel">Read the source</a>
        </div>
      </Reveal>
    </div>
  </section>

  <footer>
    <div class="wrap foot">
      <div class="brand"><Mark size={22} stroke="var(--ground-0)" /><span>Revel</span></div>
      <p>
        The cryptography has not been independently audited yet. Encryption
        protects your messages from the server's operators and from a breach of
        its database; it does not protect against a compromised client build.
        The threat model has the details.
      </p>
    </div>
  </footer>
</div>

<style>
  .page { height: 100dvh; overflow-y: auto; background: var(--ground-0); }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 0 6vw; }

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
  .nav nav a:hover { color: var(--text); }

  .hero {
    position: relative; overflow: hidden; background: var(--moment-bg);
    padding: 11vh 6vw 13vh; display: flex; align-items: center; min-height: 76dvh;
  }
  .hero-in { position: relative; z-index: 2; max-width: 36rem; }
  h1 {
    font-family: var(--font-display); font-size: clamp(2.6rem, 6.4vw, 4.4rem);
    line-height: .97; letter-spacing: -.035em; font-weight: 600; margin: 0 0 22px;
  }
  .sub { font-size: 1.0625rem; line-height: 1.55; margin: 0 0 30px; color: color-mix(in oklab, var(--text) 88%, transparent); }
  .cta { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
  .fine { margin-top: 30px; font-size: var(--text-sm); line-height: 1.75; color: color-mix(in oklab, var(--text) 60%, transparent); }

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

  .band { padding: 92px 0; }
  .band.alt { background: var(--ground-1); border-block: 1px solid var(--line); }
  h2 { font-family: var(--font-display); font-weight: 600; letter-spacing: -.025em; }
  .big { font-size: clamp(1.9rem, 3.6vw, 2.6rem); margin: 0 0 14px; }
  .lede { color: var(--text-dim); max-width: 56ch; margin: 0 0 34px; }

  .pillars { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 26px; }
  .pillar h2 { font-size: var(--text-xl); margin: 0 0 8px; }
  .pillar p { color: var(--text-dim); margin: 0; }

  .costs { display: grid; gap: 1px; background: var(--line); border-radius: var(--r-md); overflow: hidden; }
  .cost {
    display: grid; grid-template-columns: minmax(180px, 1fr) 2fr; gap: 20px;
    background: var(--ground-0); padding: 20px 22px;
    transition: background var(--t-base) var(--ease);
  }
  .cost:hover { background: var(--ground-2); }
  /* Coral, because these are genuinely losses. Softening the colour here
     would be softening the claim. */
  .lost { font-weight: 700; color: var(--face-coral); }
  .back { color: var(--text-dim); font-size: var(--text-sm); }

  .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 40px; }
  .feature h2 { font-size: var(--text-xl); margin: 0 0 10px; }
  .feature p { color: var(--text-dim); margin: 0 0 12px; }
  .micro { font-size: var(--text-sm); color: var(--text-mute); }

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
    .cost { grid-template-columns: 1fr; gap: 6px; }
    .nav nav a { display: none; }
  }
</style>
