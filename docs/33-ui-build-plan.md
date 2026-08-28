# Building the whole UI first

**Decision: yes.** Build every screen against mock data and a mock API before
the real backend exists.

## Why this is the right order, not procrastination

The obvious objection is that this is building the fun part first. It isn't,
for four reasons specific to this project:

1. **The design docs describe a product nobody has seen.** Thirty-two documents
   is a lot of prose about interactions. Building them turns a description into
   a specification, and the gap between "we wrote that down" and "that works"
   only closes by building it.
2. **The mock API is the real API.** The client talks to the interface
   `packages/core` will expose (`docs/05` §4). Designing that interface from
   what the UI actually needs beats designing it from what happened to be
   convenient to store, and then discovering the mismatch at integration.
3. **Interaction problems are cheap now.** Finding out the settings IA is wrong
   costs an afternoon today and a migration later.
4. **It is the artifact that makes this real to other people.** `docs/27` says a
   team is needed. Nobody joins a repository of specifications; people join a
   thing they can click.

The risk is building UI for backend behaviour that later changes. It's bounded:
the protocol is settled (`packages/protocol` exists and is tested), the crypto
is proven, and the seam between UI and core is defined. Where something is
genuinely undecided the UI should show the *honest* version — a real "we don't
know yet" is better than a confident mock.

## The rule for every screen

> **Mock the data, never the honesty.**

Empty states, failure states and the crypto banners get built at the same time
as the happy path — not after. `docs/22` and `docs/08` already write the copy;
a screen that only has a happy path has not been designed, and those are exactly
the screens that get deferred and then shipped badly.

## Order

Roughly by how much each teaches us, and how expensive it is to get wrong.

### 1. The three cliffs — sign-up, recovery code, new device
The highest-stakes UX in the product and the most-written-about (`docs/05` §3,
copy in `docs/08`). If these don't feel right nothing else matters, because
people never reach the rest. Includes the forgot-password screen, which 4.6
flagged as the single riskiest thing to get wrong.

### 2. The landing page
The design review's sharpest criticism was that you cannot feel what the product
is. The hero on the reference page is a sketch of the answer; this is the answer.

### 3. Settings, complete
The full IA from `docs/19`: account, faces, devices, notifications, language and
translation, appearance, Wren, privacy, storage, about. Includes **"what the
server can see"**, which is the most persuasive screen in the product and is
currently a paragraph in a doc.

### 4. Wren — panel, notices, the command surface
`docs/12` and `docs/13` are written and unbuilt. The command surface doubles as
search and navigation, so it pays for itself immediately during development.

### 5. Spaces — create, join, discover, settings, roles, audiences
`docs/18`. The audience picker is the one to be careful with: it has to make the
crypto boundary legible without saying "MLS".

### 6. Voice and calls
`docs/21`. Including the diverged-audio failure, which is the state that reads
as a network glitch and must not.

### 7. Mobile
`docs/24`. One column, two drawers, the back-button state machine. Best done
after the desktop surfaces exist, so it is a real adaptation rather than a
guess.

### 8. The long tail
Threads, search results, profile cards, invites, the agent pairing flow,
moderation queue, storage screen.

## What "done" means for a screen

- The happy path works from real interaction, not a static mock.
- Empty, loading, and at least one failure state exist.
- Keyboard reachable; focus visible; screen-reader labels present.
- Motion follows `docs/32`, added in the same pass rather than retrofitted.
- It works in all three themes and at `calm` personality.
- No emoji in chrome; every glyph is a drawn icon.

## After this

When the real core lands, the work is swapping the fake core for the real one
behind the same interface. If that turns out to be a large change, the interface
was wrong — and finding that out costs one refactor rather than a rewrite.
