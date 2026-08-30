# Wren as a guide — heuristics, notices, and doing things

`09-mascot.md` is who Wren *is*. This is the system she runs on: what she's
allowed to notice, where it surfaces, what she can do about it, and the limits
that stop her becoming Clippy. Her actual notice copy is `13-wren-notices.md`.

## The problem, stated honestly

A proactive assistant with heuristics and popups is, structurally, Clippy. That
is the shape. Clippy failed because he was proactive about things you hadn't
asked about, interruptive during focused work, and impossible to switch off.

So the design has to earn the proactivity back. Two inversions do most of it:

> **1. She has an inbox, not a megaphone.** Everything Wren notices goes into a
> quiet panel you open when you want it. Interrupting you is the rare exception,
> not the delivery mechanism.
>
> **2. She acts, she doesn't advise.** Every notice carries a button that
> performs the thing. "You should enrol a passkey" is nagging. A button that
> enrols the passkey is help.

## The escalation ladder

Four rungs. Almost everything stays on rung one.

| Rung | Surface | Used for | Interrupts? |
| --- | --- | --- | --- |
| 1 | **The Wren panel** — a list of notices, each with an action | everything, by default | no |
| 2 | **Ambient dot** on her icon — neutral / gold / coral by highest severity | telling you the panel has something | no |
| 3 | **Inline card** — rendered into a natural gap: an empty room, the top of a settings page, the space after an action completes | things that are relevant *right where you already are* | no |
| 4 | **Popup** — a real modal that takes focus | three cases only, below | yes |

**Rung 4 is allowed exactly three times, by category:**

1. **You are about to do something irreversible.** Deleting a space, revoking
   your last device, turning off history for a room, removing a member who will
   lose access at the next epoch.
2. **A live safety condition.** Someone's key changed *in a conversation you are
   currently in*. This is the one attack-shaped event a person must not miss.
3. **A genuine cliff edge.** You have exactly one device and no confirmed
   recovery code — i.e. one dropped phone from losing the account permanently.

Anything that isn't one of those three is not permitted to interrupt. Not as a
product decision that can be revisited per-feature — as a rule enforced in one
place in code, so a future notice can't quietly promote itself.

## The interruption budget

Even rung 4 is rate-limited, because three legitimate reasons can still add up
to a bad day:

- **One interrupting popup per session. Three per week.**
- Over budget, the popup **degrades to a rung-3 card or a rung-1 notice** — it is
  never dropped, just demoted.
- The safety category (key changed in a live conversation) can exceed the budget,
  because suppressing it would be the one genuinely dangerous silence.
- Dismissing a notice **category** silences that category permanently, not for a
  session. "Don't show me this again" has to mean it or the whole thing is
  untrustworthy.

**Three volume settings**, in her panel and in settings:

| Setting | Behaviour |
| --- | --- |
| **Quiet** | Panel only. Never interrupts, never renders inline cards. The dot still appears. |
| **Normal** (default) | The ladder as described. |
| **Chatty** | More heuristics enabled, including the low-value hygiene ones, and inline cards appear more freely. Still never exceeds the popup budget. |

## Timing — right moment, not just right content

A correct notice at a wrong moment is a wrong notice. Wren never surfaces
anything at rung 3 or 4:

- while the composer has focus or unsent text,
- during a call, or while a mic is live,
- while the user is actively scrolling,
- within a few seconds of app launch (let the app finish opening first),
- while another Wren surface is already open.

She prefers **transitions and gaps**: opening the app and landing on an empty
room, finishing an action, arriving at a settings page, coming back after a long
absence. Those are the moments where a suggestion feels like timing rather than
interruption.

## What she may reason about — and what she must not

This is a privacy product, so a helper with heuristics needs an explicit charter.

**She may use, all locally:**

- device and key state (how many devices, which are stale, whether a recovery
  code was confirmed, whether a passkey exists);
- room configuration and membership (who's in it, which agents, history mode,
  invite settings, size);
- your own settings and preferences;
- coarse local usage facts (a room you've never posted in, a room you haven't
  opened in months, counts and recency — not content);
- **on-device language detection**, because it powers a feature you can see
  (`10-translation.md`).

**She must never:**

- send anything off-device in order to make a suggestion — not telemetry, not a
  "which tips are useful" ping, nothing. Her heuristics run where your keys are
  and produce nothing over the network;
- build or persist a behavioural profile beyond the minimum a specific notice
  needs, and each such fact expires when the notice resolves;
- comment on message content, or on *you*. "Your key changed" is her. "You seem
  to be arguing" or "you've been chatting a lot today" is the end of the
  character;
- moralise about privacy. She explains what is true and what a setting does. She
  does not tell you that you should care.

## The heuristics

Grouped by what they're for. Each has a severity that drives the dot colour, and
a rung ceiling — the highest rung it is ever allowed to reach.

| Group | Heuristic | Ceiling |
| --- | --- | --- |
| **Keys & devices** | recovery code generated but never confirmed saved | 4 (cliff edge, if also single-device) |
| | only one device enrolled | 3 |
| | passkey supported by this device but not enrolled | 1 |
| | a device not seen in 90 days | 1 |
| | a contact's key changed — **in a live conversation** | 4 (safety) |
| | a contact's key changed — noticed later | 3 |
| **Who can read this** | you are adding an agent to a room | 4 (irreversible-ish: it will read from now on) |
| | turning on history-for-new-members in a large room | 4 (irreversible) |
| | an invite link that is long-lived *and* high-use | 3 |
| | posting in a room with an agent you may have forgotten | 1 |
| **Getting more out of it** | a room mostly in a language you don't read → offer translation | 3 |
| | repeated voice clips from someone → offer transcription | 1 |
| | never opened the command surface | 1 |
| **Housekeeping** | downloaded language models never used | 1 |
| | local history for rooms you left | 1 |
| | local storage getting large | 1 |

**Cut during review:** *"a very busy room you never post in → offer to mute."*
It reads as state (counts, recency) but is one abstraction step from "we noticed
you're not engaging", which is where every bad notification system ends up.
Lurking is not a problem to solve. Muting stays a normal feature you can reach
in one click; Wren just doesn't bring it up. The copy outlived this decision in
`13-wren-notices.md` for a while; it now sits there under *"things she must
never say"*, which is the only place a cut notice is safe to keep.

New heuristics get a ceiling at review time. **A heuristic without a declared
ceiling doesn't ship** — that's the mechanism that keeps rung 4 from silting up.

## Doing things — Wren is the command surface

The ⌘K palette from `05-client-and-ux.md` and "asking Wren" are the same
surface. One input, opened with `⌘K` (or `⌘J` for the panel with the input
focused), accepting both fuzzy commands and plain phrasing.

She can drive essentially the whole app:

- **Navigate** — jump to a room, a person, a message, a setting.
- **Create** — a room, a space, an invite, a face, a passkey.
- **Configure** — translation for a room, notification rules, theme, density,
  personality, mute, status.
- **Security** — show the recovery code, verify a contact, enrol or revoke a
  device, rotate keys.
- **Explain** — the interesting one, below.

Two rules on actions:

1. **She uses the same code paths the UI uses.** No privileged internal API, no
   capability the user doesn't have. If she can do it, you can do it by hand, and
   she'll show you where.
2. **Irreversible actions confirm**, in her voice, naming the consequence — and
   that confirmation is one of the three legitimate popups.

### Explaining is a first-class capability

In an end-to-end encrypted app, *"what can the server actually see here?"* is a
question people genuinely have and nobody answers well. Wren answers it from the
real configuration of the real room:

> **What the server can see about #design**
>
> That it exists, who's in it, and that 4,182 messages have been sent — with
> their sizes and timestamps. Not a word of what any of them say, including the
> room's name and topic, which are encrypted too.
>
> Threads here are server-visible, which means it can also see which messages
> are grouped into which thread. You can turn that off in room settings; paging
> gets slower.
>
> Kiko and Translator can read everything in here, and both are in the member
> list.

That is generated, not canned — it reads the room's actual settings, so it stays
true when they change. It's the single best argument the product has, and it
should be one keystroke away.

## Where she appears — and doesn't

Additions to `09-mascot.md` §3, all consistent with it:

- **Appears:** the panel, the ambient dot, inline cards in gaps, the three
  popups, the command surface, onboarding, the three cliff screens, empty states,
  error banners.
- **Never appears:** anywhere in the message list, in the composer, over a call,
  in the member list, as a persistent floating widget, or as a sidebar pet. There
  is no "Wren's tips" panel that lives on screen. The panel is opened, used, and
  closed.

## What this costs

- The heuristics are local, so they run on the user's battery. They're cheap
  (config checks and counters, not inference) and run on transitions, not on a
  timer.
- Every heuristic is a maintenance liability and a chance to annoy someone. The
  ceiling table above is the review gate; the "things she must never say" list in
  `13-wren-notices.md` is the taste gate.
- A guide that can do everything is a large surface to keep honest. The
  same-code-paths rule is what keeps it from drifting into a privileged backdoor.
