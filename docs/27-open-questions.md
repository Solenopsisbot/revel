# What else we need to figure out

The design docs cover how the thing works. These are the questions that decide
whether it *survives*, roughly in order of how badly they bite. Several have no
answer yet and that's the point of writing them down.

---

## A note on the tiers

I originally ranked these for a product with strangers on it. At the scale
you're actually building for — friends, then small communities — the first two
are much less urgent than the headings suggest, and I've said so inline. Read
"could kill it" as "could kill it *if this gets big*".

## Tier 1 — could actually kill the project (at scale)

### 1. Abuse, CSAM, and the regulatory position

**The problem.** We cannot scan content; there is nothing to scan. That is a
deliberate, defensible design decision, and it is also the exact thing that gets
E2EE messengers attacked — legislatively and in the press. The UK Online Safety
Act and the EU's CSA Regulation have both circled client-side scanning, which
would break the product's central promise if mandated.

**What we already have:** message franking (`03` §9) so a recipient can
cryptographically report one specific message without exposing anything else;
bans, kicks, purge; agents-as-moderators; no anonymous cold-DMs.

**What's missing:** a written policy. Who receives reports on the hosted
instance? What is the response SLA? What gets reported onward, to whom, and in
which jurisdiction? What's the position if scanning is mandated — geoblock,
comply, litigate, shut down? **Signal's answer is "we leave"; we need our own
before someone asks in public.**

**Realistically, at your scale:** nobody is going to legislate at you directly.
The actual risk is more boring — a host, registrar or payment processor drops
you because something bad happened and you had no visible process. So the answer
is operational rather than legal: have a real reports pipeline, act quickly, ban
decisively, and be publicly clear about what you do and don't do.

Recommendation: a short honest policy page before the hosted instance takes
signups from strangers. Franking-based reporting stays a Phase 3 blocker because
it's genuinely good and rare — a report arriving with cryptographic proof the
message is real is something most E2EE products can't do. Don't geoblock
pre-emptively, keep the self-host path as the genuine escape valve, and don't
try to be legally bulletproof — you can't be, and trying wastes energy that
responsiveness would spend better.

### 2. Who pays for this

Never discussed, and the hosted instance has real costs. A free-tier VPS covers
the early days, but bandwidth, blob storage and a LiveKit SFU are not free at any
scale.

The awkward bit: **the usual monetisation levers require seeing content**, and
we can't. Ads: impossible. Data: impossible and against the point. So what's
actually sellable is the stuff that doesn't touch content:

- storage quota and upload size caps
- custom domain for a space
- more/larger encryption groups, bigger spaces
- cosmetics — themes, custom emote slots, face expression slots
- hosted agent runtime — **no** (`23`, it would mean holding keys)

Plus: donations, and self-hosting as the pressure valve.

### The TeamSpeak model

Suggested by Noelle early on, and missed when this section was first written:

> the untitled chat app is the ONLY official login authority, **can provide
> servers at a small cost**, and you can also make your own server.
> see: TeamSpeak […] centralized until you dont want it to

**It's a better answer than the one I gave**, for one structural reason: the
people who cost you money are the people who pay you. Capping growth avoids the
problem; this one *solves* it, and it does so without ever touching content —
which is the constraint that rules out every normal lever.

We have already adopted the identity half of it (`17`) and made it slightly more
open: the original sketch has one official login authority with self-hosters manually
adding others; ours has the same default, but the hosted Host accepts any IdP
(`accept_idps = ["*"]`) rather than only its own. Same shape, less gatekeeping.

**Where it needs adapting to our architecture.** The phrasing — *provide servers
at a small cost* — carries Discord's and TeamSpeak's mental model, where
a server **is** a unit of provisioning you buy. We deliberately rejected that
(`16`, `18`): a Host runs many spaces, and creating a space is an INSERT, so it
is instant and free. Selling spaces per-unit would drag the "server" model back
in through the billing page.

The synthesis, which keeps both: **you don't buy a space, you buy capacity.**

| Free | Paid |
| --- | --- |
| making a space, instantly, as many as you like | member ceiling above the free tier |
| every security and privacy feature, forever | storage and upload size |
| voice at normal quality | recording-free SFU capacity, higher quality, more concurrent |
| a `revel.chat` address | custom domain for a space |
| self-hosting, entirely | — |

TeamSpeak's slot licensing maps almost exactly onto **member ceiling**, and in
our case that is not an artificial gate: MLS group size is a *genuine* cost
driver — bigger trees, larger Welcome fan-out, more commits per membership
change (`03` §11). Storage and bandwidth are real too.

That gives the pricing an unusually honest property worth keeping deliberately:
**every paid axis maps to a resource that actually costs us money.** Nothing is
gated to create an upsell.

### So which — cap growth, or sell capacity?

It depends on an ambition question only you can answer, and the thread already
framed it. The argument for centralisation was *"bots, and communities, and
market share, and just cultural importance"* — that's a bid for an ecosystem.
Your own stated goals were narrower: cost-efficient, good headmate and computer-
friend support, lots of QoL.

- **If this is for you and your people:** invite-only, don't build billing,
  self-hosting absorbs the rest. Simplest, and you can stop thinking about it.
- **If you want the ecosystem:** the capacity model, adapted as above. It needs a
  legal entity, a payment processor, a support burden and a tax situation — the
  billing code is the easy part and everything around it is not.

**My recommendation: build as if the second is possible, operate as if the first
is true.** Concretely — keep the hosted instance invite-only for now and don't
build billing, but make sure member ceilings, storage quotas and per-space limits
exist as real, enforced, *configurable* numbers from the start. Then turning
pricing on later is a config change and a Stripe integration, not a re-architecture.

That costs nearly nothing now and keeps the door open.

### The original recommendation, kept for the record

**Don't monetise, and cap growth instead.** At
friends-and-small-communities scale this costs approximately nothing — a free-tier
VPS covers it, object-storage free tiers are generous, and LiveKit self-hosts on
the same box. Building
billing now would be premature and would distort the design.

Instead: keep the hosted instance **invite-only**, so costs stay bounded by
choice rather than by luck, and let self-hosting absorb anyone who wants more.
Write the position down honestly — *free while it's small; if it grows, here's
what we'd charge for; self-hosting always exists* — rather than promising "free
forever" and being trapped by it later.

**One hard principle if money ever appears: never sell security or privacy.**
No "encrypted backups on the paid tier", no "verification for subscribers". That
is the trap Proton and Tutanota fell into, where the free tier is deliberately
worse at the exact thing the company claims to care about. Everything
security-relevant is free for everyone, forever. Sell storage, custom domains
and cosmetics, or sell nothing.

### 3. The crypto audit — *and what that even means*

**What it is:** paying a firm with actual cryptographers to read the crypto code
and try to break it. Not a code review — an adversarial review by people who do
this for a living. Scope would be the Rust core from `26`: the MLS usage, key
handling, the OPAQUE integration, and — most importantly — **the parts we
invented**.

**Why it matters here specifically:** we are not only using standard crypto.
**Era encryption with anchor-split history (`03` §6) is a custom scheme.** So is
the device-certificate hierarchy (`03` §1). Custom crypto is exactly where bugs
live, and they are the kind of bug you cannot find by testing, because the code
works perfectly while being wrong.

**What it costs:** roughly $20k–50k for a scope this size from a reputable firm
(Trail of Bits, Cure53, NCC, Least Authority). Six figures if the scope sprawls.

**When it's actually needed — later than I first implied.** This is not a
prerequisite for your friends using it. It's a prerequisite for telling
*strangers* to trust it with things that could hurt them. Until then the honest
position is the one the docs already take: say it's unaudited, publish the threat
model, and don't overclaim. That is a completely respectable place to be.

**Cheaper routes, if it ever matters:** OTF (Open Technology Fund), NLnet/NGI
grants in the EU, and Cure53's reduced-rate open-source work all fund precisely
this kind of thing. A funded audit is more realistic than a paid one for a
project like this.

Recommendation: **do nothing now.** Note it as the gate on the strong public
claim, revisit if the project grows past friends-and-communities.

---

## Tier 2 — will hurt if left late

### 4. Getting people off Discord

The discussion thread's "consider the cost of transfer" point. We cannot import
message history — it's Discord's, and we couldn't decrypt it into our model
anyway. But we *can* import **structure**: channel layout, categories, roles and
permissions, emote sets, and a member list turned into pending invites.

A one-shot "recreate my server here" tool that reads the Discord API with an
admin token and produces a ready-made space is high-leverage and mostly boring
work. Worth building before launch, not after.

### 5. Spam and abuse on an unscannable network

You cannot content-filter spam you can't read. Available levers: rate limits,
invite-gated growth, account age, per-IdP reputation, blocking, and making
cold-DMs impossible without a shared space or friendship (already designed).
Worth thinking through *before* the first spam wave rather than during.

### 6. Localisation of the app itself

A product with built-in translation shipping an English-only interface would be
an embarrassing irony. Nothing in the codebase is set up for i18n yet, and
retrofitting string extraction is far more expensive than starting with it.

Recommendation: wire up an i18n layer in Phase 0 even if there's only one
locale in it.

### 7. Data retention on the Host

Undefined. How long does ciphertext live? What garbage-collects blobs when
nobody references them? What happens to a space nobody has opened in two years?
Self-hosters need knobs; the hosted instance needs a stated policy. It's also
the honest answer to "what are you actually storing about me".

### 8. Key transparency, operationally

`03` §2 specifies the log. Unanswered: who runs independent auditors, how
clients gossip to detect a split view, and what a monitor does when it fires.
A transparency log nobody audits is a database with extra steps.

---

## Tier 3 — real, but later

- **If the hosted instance dies.** The export path (`19`) and self-hosting are
  the answer; it should be written down as a commitment, not left implied.
- **Accessibility audit** by someone who actually uses a screen reader. The
  principles in `19` are necessary and not sufficient.
- **Age rating and app-store review.** An E2EE chat app with user-generated
  content gets scrutiny; worth understanding before submitting.
- **Backup of local history.** If your only device dies, the anchor gets you
  history back — but is there a user-facing backup story beyond that?
- **Large public spaces.** The ~2,000-leaf ceiling (`03` §11) is documented but
  the "public means public" design for above it doesn't exist.
- **A team.** The thread's "I want a full team" was right. Realistically needed:
  someone who genuinely knows MLS, a mobile engineer, and a designer who can
  draw. Wren was generated because there wasn't one.

---

## Deliberately not open

For the avoidance of re-litigating: message federation (never), a hosted
key-holding agent runtime (never — `23`), server-side scanning of any kind
(never), cloud translation (never — `10`), ads (never). These are settled and
the docs say why.
