# Voice and calls — the UX

Media is LiveKit; frames are end-to-end encrypted with insertable streams keyed
from the room's MLS exporter, so the SFU forwards ciphertext it cannot decode
(`03-identity-and-crypto.md` §6, proven in Kith across Chrome and Safari). This
doc is what a person sees.

## The governing idea

> **A call is just a room being loud.** Same audience, same keys, same roster.

That single sentence resolves most of the design questions. Who can hear you is
exactly who can read the room — not a separate permission, not a separate
concept, not a separate mental model. It also means the "no ghost readers"
promise carries into audio for free: **everyone who can hear is in the
participant list**, including any agent that is transcribing.

## Two shapes of call

| | **Voice rooms** | **Calls** |
| --- | --- | --- |
| Where | inside a space, always present in the room list | in a DM or group DM |
| Joining | click it, you're in — no ringing, no invite | it rings |
| Leaving | click out; the room persists, empty | ends when the last person leaves |
| Feels like | a room you walk into | a phone call |

Voice rooms are the Discord affordance worth keeping — the drop-in space where
people are just *around*. Calls are the intentional thing. They share all the
same in-call UI; they differ only in how you arrive.

## Starting and joining

**A voice room** shows its occupants inline in the room list as small avatars
before you join, so you can see who's in there without committing. Clicking joins
immediately, mic **muted by default** — arriving already-broadcasting into a
conversation you haven't heard yet is a small hostile act, and every app that
does it is wrong.

**A DM call** rings. The incoming card shows the caller's face, the room, and two
buttons — answer or decline — plus "answer muted", which is the option people
actually want when they're not sure what they're walking into. The ring respects
Do Not Disturb and per-source mute (`05` §1).

**Joining is a two-second operation**, not a modal, not a device wizard. Whatever
you used last time is used again. Device selection lives in the call, not in
front of it.

## In-call

```
 ┌──────────────────────────────────────────────────────────────┐
 │  the couch · 4 people                       [captions] [⤢]   │
 │                                                              │
 │    ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
 │    │   Mika   │  │  Viola   │  │   June   │  │Transcriber│   │
 │    │ speaking │  │          │  │  muted   │  │  agent    │   │
 │    └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
 │                                                              │
 │      [ mic ]  [ camera ]  [ share ]  [ ⋯ ]      [ leave ]    │
 └──────────────────────────────────────────────────────────────┘
```

- **Tiles** carry the face's colour as a speaking ring, so the same identity
  colour that names them in chat identifies their voice. Plural systems get this
  for free: the tile shows the *face* that joined.
- **Speaking indication is a ring, not a jump.** Tiles never reorder while
  someone talks — a grid that reshuffles on every utterance is unusable in a
  four-way conversation.
- **Muted is legible at a glance**, on the tile itself, not only in a control bar.
- **An agent in the call gets a tile** with its badge and the same *can hear this
  call* line the roster uses. A transcriber that listened invisibly would be the
  exact thing we promise doesn't exist.
- The call **survives navigation** — a persistent bar keeps it alive while you
  read other rooms, and clicking the bar returns you (Kith's `voice.svelte.ts`
  pattern: the controller lives outside components).

**Controls in the `⋯` menu**, not the main bar: input/output device, noise
suppression, echo cancellation, AGC, push-to-talk. The main bar has four things
because a bar with nine things means nobody finds any of them.

## Screen sharing

Share opens a picker; the shared surface becomes a second tile from that
participant, and other people can focus it. Two guardrails worth building in:

- **A visible, persistent "you are sharing" indicator** in your own window, with
  a stop button. The most common screen-share failure is not knowing you still
  are.
- **Never auto-focus your own share** into your own view — the infinite-mirror
  effect that makes people panic.

## Encryption, in a call

Normally invisible. The key derives from the MLS exporter, every member at the
epoch derives the same one, and it **rotates on every membership change** — so
someone joining or leaving mid-call triggers a rekey that nobody should notice.

But it can fail, and Kith found the failure mode: **a diverged session is
silence.** You see a tile, it looks fine, and there is no audio. That is the
worst possible failure because it looks like a network problem, and it needs a
real UI:

> **You can't hear June.** Your apps disagree about this call's keys — usually
> a device that joined mid-call and didn't catch up.
> **[ Reconnect audio ]**

Shown on the affected tile, not as a global banner, because it is per-person.
And the reciprocal message appears on their side, so both parties know rather
than each assuming the other went quiet.

**Mid-call join and the epoch bump** is worth one line of feedback when it
happens — a brief "keys updated" flicker on the participant list — because a
half-second audio gap with no explanation reads as a glitch, and a half-second
gap with an explanation reads as security working.

## Recording — the honest bit

We cannot prevent recording. Someone can point a phone at the screen, run OBS,
or use a virtual audio device. So:

- There is **no "recording" indicator that claims to be authoritative**, because
  it would be a lie by omission the first time someone recorded around it.
- A client that *does* record via the app announces it, and the announcement is
  a courtesy signal, described as one: *"Ash's app says it started recording.
  Apps can be modified — treat this as a courtesy, not a guarantee."*
- The threat-model line applies here more than anywhere: **if someone can hear
  it, they can keep it.** Said once, in the call settings, not on every call.

## Captions and transcription

Two paths, per `10-translation.md`'s rule (on-device, or a visible member):

1. **On-device captions.** Whisper-class model running on the *receiving*
   device. This needs hardware that can sustain a Whisper-class model in real
   time — a laptop or desktop with a neural engine or discrete GPU. A mid-range
   phone cannot, and gets an honest note rather than a janky experience.
2. **A captioner agent** in the call, visible in the participant list, producing
   captions everyone sees.

Captions render in a panel beside the tiles, not overlaid across faces, with the
speaker's face colour per line. Live captions are **never** posted to the room as
messages unless someone explicitly saves them — a call transcript silently
appearing in the chat log would be a nasty surprise.

## Connection quality

One dot per tile: good / degraded / reconnecting. On sustained trouble, a single
line naming the actual problem — *"Your connection is unstable"* versus *"June's
connection is unstable"* — because the default assumption in every call is that
it's the other person's fault, and the app knows which it is.

Dropping is not fatal: the client reconnects to the same room automatically and
says it's doing so. Leaving is always deliberate.

## Mobile and backgrounding

- The call continues in the background with an OS notification and controls.
- `navigator.sendBeacon` on `pagehide` clears presence if the tab dies mid-call,
  so nobody lingers as a ghost participant (Kith's `leaveBeacon`).
- Bluetooth/route changes are handled without dropping the call, and the current
  route is shown in the device menu.
