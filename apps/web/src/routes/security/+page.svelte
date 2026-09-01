<script lang="ts">
/**
 * The disclosure policy, published.
 *
 * `docs/34` decided all of this and said the one thing it could not do for
 * itself: a policy that lives only in a repository is a policy most reporters
 * will never find. `security.txt` points `Policy:` here, which is what makes
 * that file worth serving at all.
 *
 * Kept deliberately plain. Somebody reading this has found something and wants
 * two answers — where to send it, and what happens next — and every paragraph
 * between them and those answers is a paragraph that loses reports.
 */
import Mark from '$lib/Mark.svelte';

const CONTACT = 'security@revel.chat';
</script>

<svelte:head>
  <title>Security · Revel</title>
  <meta
    name="description"
    content="How to report a security problem in Revel, and what we commit to doing about it."
  />
</svelte:head>

<div class="page">
  <header>
    <a class="brand" href="/"><Mark size={24} stroke="var(--ground-0)" /><span>Revel</span></a>
  </header>

  <main>
    <h1>Reporting a security problem</h1>
    <p class="lede">
      Email <a href="mailto:{CONTACT}">{CONTACT}</a>. It reaches a person, not a queue.
    </p>

    <p>
      Include what you did, what happened, and what you expected. A rough reproduction beats a
      polished write-up; we would rather read four sentences today than a PDF next month.
    </p>
    <p>
      If a report is sensitive enough that email is not good enough, say so in an empty message and
      we will find another channel. Don't sit on something because the channel is imperfect.
    </p>

    <h2>What we commit to</h2>
    <ul>
      <li><b>We will acknowledge within 72 hours.</b> That's a human saying "we have it", not a fix.</li>
      <li>
        <b>We will tell you what we think within 7 days</b> — including "this isn't a bug, and here's
        why", which is a real answer and one you're owed.
      </li>
      <li><b>We will tell you when it's fixed</b>, and what the fix was.</li>
      <li><b>We will credit you</b> by whatever name you give us, or not at all if you prefer.</li>
      <li>
        <b>We will not threaten you.</b> Not with lawyers, not with law enforcement, not with a
        strongly-worded letter. Reporting a vulnerability in good faith is a thing we asked you to
        do.
      </li>
    </ul>

    <h2>What we ask</h2>
    <ul>
      <li>
        <b>Give us 90 days before you publish</b>, and the clock doesn't stop. We can ask for more
        time and explain why; you can say no. A deadline a vendor is allowed to pause isn't a
        deadline, and every disclosure programme that quietly acquired one became a way of never
        shipping the fix.
      </li>
      <li>
        Don't access, modify or keep anybody else's data. If you need to prove a bug touches real
        data, tell us and we'll make you an account that's allowed to.
      </li>
      <li>
        Don't degrade the service for other people. No load testing, no denial of service, no spam.
      </li>
      <li>
        Stay inside the systems we run. Third-party services we happen to use aren't ours to
        authorise, and neither are other people's self-hosted instances — which is most of them.
      </li>
    </ul>

    <h2>Scope</h2>
    <p>
      <b>In scope:</b> the hosted Host and IdP, the official clients, the repository, and the
      protocol itself. A flaw in the design is worth more than a flaw in the code, and is explicitly
      wanted.
    </p>
    <p><b>Out of scope</b>, stated plainly so nobody wastes an afternoon:</p>
    <ul>
      <li>
        Anything that needs an attacker who already controls a user's device. That isn't a boundary
        this design defends, and never claimed to be.
      </li>
      <li>
        Metadata the server is <i>documented</i> to hold. If you think that list is wrong, that's a
        design report and very much in scope.
      </li>
      <li>
        Rate limits, missing security headers, and reports whose entire content is a scanner's
        output.
      </li>
      <li>Somebody else's self-hosted instance. Ask them.</li>
    </ul>

    <h2>Credit, not money</h2>
    <p>
      <b>There is no bug bounty.</b> It costs money that doesn't exist yet, and a badly funded bounty
      is worse than none: it sets a price on a thing and then fails to pay it.
    </p>
    <p>
      What there is instead is public credit — by name, by handle, or anonymously — in
      <code>SECURITY-CREDITS.md</code> in the repository. If a bounty ever appears, everything
      already reported is eligible retroactively.
    </p>

    <p class="foot">
      Last reviewed 1 September 2026. The full policy, including the reasoning behind each decision,
      is in <code>docs/34-security-disclosure.md</code>.
    </p>
  </main>
</div>

<style>
  .page {
    min-height: 100dvh;
    background: var(--ground-0);
    color: var(--text);
  }
  header {
    padding: 22px 26px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    color: var(--text);
    text-decoration: none;
    font-weight: 700;
  }
  /* The one standalone link in this page's chrome. The contact address further
     down is deliberately left alone — it sits inside a sentence, and a 44px
     inline box would put a hole in the paragraph. */
  @media (pointer: coarse) { .brand { min-height: var(--tap); } }
  main {
    max-width: 68ch;
    margin: 0 auto;
    padding: 20px 26px 90px;
  }
  h1 {
    font-size: 1.9rem;
    margin: 18px 0 10px;
    letter-spacing: -0.01em;
  }
  h2 {
    font-size: 1.2rem;
    margin: 34px 0 10px;
  }
  .lede {
    font-size: 1.15rem;
    margin: 0 0 22px;
  }
  p,
  li {
    line-height: 1.65;
  }
  li {
    margin: 8px 0;
  }
  ul {
    padding-left: 1.15em;
  }
  main :global(a) {
    color: var(--brand);
    text-underline-offset: 2px;
  }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.92em;
  }
  .foot {
    margin-top: 42px;
    padding-top: 18px;
    border-top: 1px solid var(--line);
    font-size: 0.9rem;
    opacity: 0.75;
  }
</style>
