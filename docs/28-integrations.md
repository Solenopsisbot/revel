# Integrations — making it feel like you can do anything

The goal: the product should feel open-ended, not like a fixed feature list.
Under end-to-end encryption that's harder than usual, because the normal answer
— "we run it on our servers for you" — is unavailable. Everything here is
therefore built from three primitives that already exist.

## The three primitives

| | Runs where | Sees what | Visible to |
| --- | --- | --- | --- |
| **Agent** (`23`) | a process someone runs | everything in rooms it joined | everyone, in the roster |
| **Plugin** (`07`, Kith's design) | sandboxed iframe in your client | only what you're already looking at, and only with permission | just you |
| **Your own devices** | your hardware | what your account can already read | nobody — it's you |

Almost every integration idea resolves into one of these, and *which one* is the
whole design decision — because it determines who has to be told.

## Delegated transcription — the idea, generalised

The specific ask: *"authorise a bot account to transcribe for me."* It's a good
instinct, and it splits into two genuinely different mechanisms.

### 1. Delegate to your own device — the invisible one

Your phone can't run a Whisper-class model. Your Mac at home can. **They share
an account key, so this is not a new trust boundary at all** — it's your data
going to your own hardware.

```
   phone (in the call)  ──encrypted to your own devices──▶  desktop at home
        ▲                                                        │
        └────────────────── transcript text ─────────────────────┘
```

The desktop **does not join the call** and never appears in the participant
list, because it isn't a participant — it's doing arithmetic on data your phone
already legitimately holds. Nobody needs to be told, because nobody new can read
anything.

This is the best answer to the mobile-hardware problem in `25`, and it
generalises: **any device you own can lend compute to any other device you own.**
Transcription, translation, search indexing, thumbnail generation, model
inference for captions. Settings → Devices gets one toggle: *"Let my other
devices use this one for heavy work when it's plugged in."*

### 2. Delegate to an agent — the visible one

If you have no second device, you can authorise an **agent** to transcribe. But
an agent that hears the call is a key holder, so under "no ghost readers" it
**must** appear in the participant list — even though it's *your* helper rather
than the room's.

That's the honest cost and the UI states it at the moment of choice:

> **Add your transcriber to this call?**
> It'll appear in the participant list for everyone, because it can hear
> everything. That's not avoidable — anything that can hear you is visible.
>
> [ Add it ]   [ Use my desktop instead ]   [ Not now ]

The second button exists because mechanism 1 is almost always the better answer.

## Delegated capability, as a general model

Both cases above are instances of one idea worth building properly: **you grant
a specific capability to a specific principal, scoped and revocable.**

```
  grant {
    to:        agent:transcriber@revel.chat | device:laptop
    can:       transcribe | translate | summarise | index | archive
    scope:     this call | this room | this space | everything
    expires:   never | 1 hour | when I leave
  }
```

Grants live in Settings → Integrations, each showing what it can do, where, and
a revoke button. Revoking a device grant is instant; revoking an agent grant
removes it from the relevant rooms, which is a Commit and therefore effective at
the next epoch (`03` §5).

## Custom event types — why this is open-ended rather than a feature list

The thing that makes "you can do anything" true rather than marketing:

**An agent can emit event types nobody has seen before.** The event envelope
(`04` §2) carries an opaque encrypted payload with a `type` string. A client that
doesn't recognise a type renders a graceful fallback — the agent's name, a
one-line summary the agent supplies, and any actions it declares — instead of
breaking or hiding it.

So a new integration doesn't need a client release. A poll, a build status, a
now-playing card, a form, a game state, a shared shopping list: all just event
types an agent defines, rendered richly by clients that know them and acceptably
by clients that don't. **The server never changes.**

Plugins (`07`) are the other half: a plugin can register a renderer for a custom
event type, so a community can ship the rich view for its own agent's events
without anything shipping in core.

## Things this makes possible

Grouped by which primitive does the work, to make the trust story explicit each
time:

**Your own devices — nobody is told**
- transcription and live captions from a weak device
- translation model inference
- search indexing for a newly enrolled device
- thumbnail and preview generation
- "summarise what I missed" running locally

**Agents — visible in the roster**
- translator, transcriber, captioner
- an Ayusami persona as a room member
- moderation helpers, automod-by-consent
- CI and alerting feeds, RSS, calendar, on-call rotations
- polls, forms, standups, reminders, scheduled messages
- archivers and exporters
- listening-together, now-playing, game state
- **bridges** — see below

**Plugins — only you see them**
- message actions ("send to Obsidian", "make a task")
- composer tools, GIF pickers, snippet libraries
- custom renderers for an agent's event types
- personal automations: *when X happens in this room, do Y* — running locally,
  reading only what you can already read
- alternative views: a kanban over a room's events, a calendar over its polls

## Bridges, and their honesty problem

A bridge to Discord, Matrix or IRC copies content *out* of the encrypted world
into one where somebody else can read it. It is, definitionally, the thing we
promise doesn't happen invisibly.

So bridges are allowed, and they are **loud**:

- a bridge is an agent, so it's in the roster like anything else;
- its badge is not customisable to something cosy — a bridge reads **Bridge**;
- the room shows a persistent, undismissable line: *"Messages here are copied to
  Discord. People there can read them."*
- adding one is a rung-4 confirmation naming the destination.

We don't ban them — bridges are how people actually migrate, and a migration
path matters more than purity (`27` §4). We just refuse to let one be quiet.

## The permission model, in one place

Every integration answers the same three questions, and the UI always shows the
answers together:

1. **What can it read?** — rooms it's a member of; nothing else, ever.
2. **What can it do?** — its roles, same machinery as a person (`23`).
3. **Who can see that it's there?** — everyone, always, if it holds keys.

Nothing here introduces a new trust primitive. That's deliberate: the reason
this can be open-ended without becoming dangerous is that every extension is
either a member you can see, a plugin that can't see past your own screen, or
your own hardware.
