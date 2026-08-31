# Notification rules

`docs/05` §8 is the whole brief, and it is a promise about **predictability**
rather than about features:

> **Notifications you can predict.** One rules screen: per room — everything /
> mentions / nothing; per space — inherit; global — DND, quiet hours, sounds.
> **The rule that fired is shown on the notification.** Muted things get a quiet
> dot, never a badge.

This document is the rest of that sentence. `packages/core/src/notify/rules.ts`
is the implementation, `packages/core/test/notify.test.ts` is one test per rule.

## Where the decision happens

**On the client, after decryption.** The server sends a content-free push
(`{room}` at most) to devices with no live socket; the device wakes, syncs,
decrypts, and decides. `docs/04` §5's *reconcile-on-open means a missed push
never means a missed message* is what makes that affordable — a push is a nudge,
not a delivery, so the rules can be arbitrarily personal without the Host
learning any of them.

Which means the server's four rules (`apps/server/src/push.ts`) and this
document's eleven are answering different questions. The server's are about
**who may be woken and what waking them reveals**. These are about **whether
being woken was worth it**, and the server cannot participate: it does not know
your settings, cannot see a mention, and must not.

## The rules, in order

First match wins. The order *is* the specification.

| # | Rule | Notifies | Marks | Because |
| --- | --- | --- | --- | --- |
| 1 | `self` — you sent it | no | — | "you sent this" |
| 2 | `never-notifies` — silent or ephemeral | no | — | "reactions and receipts never notify" |
| 3 | `muted` — set to nothing | no | dot | "this room is muted" |
| 4 | `dnd` | no | badge | "do not disturb is on" |
| 5 | `quiet-hours` | no | badge | "quiet hours" |
| 6 | `mention` — `@` you | **yes** | badge | "you were mentioned" |
| 7 | `reply` — to something you wrote | **yes** | badge | "a reply to you" |
| 8 | `broadcast` — `@everyone` or a role you hold | **yes** | badge | "everyone here was mentioned" |
| 9 | `direct` — an unmuted DM | **yes** | badge | "a direct message" |
| 10 | `mentions-only` — and this was not one | no | badge | "this room only notifies for mentions" |
| 11 | `everything` | **yes** | badge | "this room notifies for everything" |

### 1. Self is matched on the account, not the device

Your laptop must not buzz about something you sent from your phone. This is the
same rule the server enforces at rule 3 of `push.ts`, and it is account-level in
both places for the same reason.

### 2. Silent events do not mark either

`docs/04` §2 already says a `silent` event never notifies. It also must not
badge: a room that goes bold because somebody reacted is a room whose bold means
nothing, and the value of an unread marker is entirely in how often it is wrong.

### 3. A mute is absolute

**A direct `@you` in a muted room does not notify.** This is the contested one,
and the argument is that a mute you have to re-explain to each person who pings
you is not a mute — it is a request that other people can revoke by typing your
name. Slack and Discord default the other way; this is a deliberate divergence.

The room still gets its quiet dot, so it is discoverable the moment you look. A
dot says *something happened here* without asserting that it is owed attention,
which is the entire difference between a muted room and an unread one.

Mute is checked **above** DND, so when both apply the notification says "this
room is muted" — the more specific and more durable reason is the more useful
one to show.

### 4. Nothing overrides Do Not Disturb

No priority contacts. No repeated-DM heuristic. No `@everyone`.

The argument is not that emergencies do not exist; it is that a DND with
exceptions is one you cannot reason about, and every exception is a thing
somebody else gets to decide about your evening. Everything queues, everything
badges, and it is all there when you come back. **A switch that can be
overridden is a suggestion, and a suggestion is exactly what people have learned
to distrust about every other app's DND.**

If this turns out to be wrong, the shape that would change it is a per-person
"always reach me" override on a DM — deliberate, visible in one list, and never
extended to rooms or broadcasts. It is not built.

### 5. Quiet hours suppress, they do not delay

A queue that empties at 07:00 is twelve notifications arriving at once about
things you have already read, which is worse than the silence it was softening.

The window is local minutes from midnight, `[start, end)`, wrapping past
midnight. `start === end` is an **empty** window rather than a whole day: the
setting that means "always" is DND, and having two ways to spell it is how
somebody silences themselves by accident.

### 6–8. What counts as a mention

Three things, all decided together:

- **An `@` at your account, or at any of your faces.** A face is you wearing a
  different name, so being addressed at one you are not currently speaking as
  still reaches you. The notification names the face, so you know which hat
  somebody wanted.
- **A reply to your message.** A strong signal and a quiet one — people reply far
  less often than they chat.
- **`@everyone`, or a role you hold.** Already gated by `MENTION_EVERYONE`
  (`docs/04`), so only people who may be noisy can be.

**A new message in a thread you posted in does not count**, and that was
decided rather than overlooked. Auto-following threads is how a feature that
exists to keep a conversation *out of* the main room becomes the loudest thing
in it. If somebody wants you in a thread they can reply to you or name you, both
of which already notify.

### 9. DMs sit outside the global room default

A DM has no space to inherit from, and falling through to a global default of
`mentions` would mean a message from one specific person, sent only to you,
silently not notifying. Nobody means that when they set a default for rooms. So
a DM's floor is `everything`, and muting one is an explicit per-room act.

## The rule that fired is shown

Every decision carries `because` — short, lowercase, unpunctuated, appended to
the notification rather than a sentence of its own (`docs/08`).

This is not a nicety. It is the mechanism that makes the rules *checkable* by
the person they belong to: a notification that explains itself is one you can
disagree with, and the settings screen is two taps from the disagreement. Every
notification system people hate is one where the answer to "why did that
happen?" is unavailable.

There is a test asserting that every reachable rule has copy, so the deck cannot
fall behind the rule list.

## Why the engine is a pure function

Every input is passed in — settings, event, reader, **and the time of day**.
Nothing reads a clock, a store, or a preference. That is what makes "the rule
that fired" a thing that can be *true* rather than reconstructed afterwards: the
decision is reproducible, so the label is the actual reason. It is also why
every rule's test is one line.

An absent `minuteOfDay` means *unknown*, not midnight, and unknown never
silences anything. A rules engine that fails closed is one that eats your
messages.

## Not decided here

- **Sounds.** `docs/05` §8 lists them under global settings; which sound, and
  whether per-rule, is a design question and not a rules question.
- **Grouping and rate limiting.** Twenty notifications from one room in a minute
  is a real problem and it is a delivery problem, downstream of every decision
  above.
- **Per-person overrides.** See rule 4.
- **The rules screen itself.** `docs/33` owns the UI; this owns the behaviour it
  configures.
