# Mobile

The web app is the v1 product (`05` §5), and most people will meet it on a
phone. Mobile is not a scaled-down desktop layout; it's the primary surface for
a large share of use, and the docs have so far described it in passing. This
fixes that.

## The layout model

Desktop has four columns (rail, rooms, chat, members). A phone has **one
column and two drawers**:

```
   ← swipe                                    swipe →
  ┌──────────┐   ┌────────────────────┐   ┌──────────┐
  │  rail +  │   │        chat        │   │ members  │
  │  rooms   │   │   (the only view)  │   │          │
  └──────────┘   └────────────────────┘   └──────────┘
```

- **Chat is the app.** It is always what's on screen; the drawers are transient.
- The left drawer merges the rail and room list into one scrollable panel —
  spaces along the top edge, rooms below — because two nested drawers is a maze.
- The right drawer is the member list, opened from the header, used rarely.
- **Threads push a new view** rather than opening a panel, with a back button.
  Panels-within-drawers do not work on a 390px screen.

Kith's finger-tracked drawers carry over: the panel follows your thumb 1:1,
axis-locked in the first ~10px so a vertical scroll still wins, and commits past
the halfway point on release. That responsiveness is most of what makes a web app
stop feeling like a website.

## Navigation and the back button

The phone's back gesture must do the obvious thing, every time:

| You're in | Back goes to |
| --- | --- |
| a thread | its room |
| a room | the room list drawer, opened |
| the room list | the previous space, or home |
| a modal or sheet | closed, nothing else |
| a call | the call minimises, it does not hang up |

This is a real state machine and it's worth writing down, because getting it
wrong — the classic web-app failure of back exiting the app from three levels
deep — is the single fastest way to feel broken.

## Touch specifics

- **Enter is a newline, the send button sends.** On a fine pointer Enter sends.
  This branches on pointer type, not screen width, so a tablet with a keyboard
  behaves like a desktop (Kith's `layout.coarse`).
- **Swipe right on a message to reply**, with a reveal indicator, committing past
  ~56px. Long-press opens the context menu, since touch has no right-click.
  Tap toggles the action bar.
- **Touch targets are 44px minimum**, which the density tokens must respect —
  `compact` density reduces padding but never below the target floor on coarse
  pointers.
- **The composer grows** to a few lines then scrolls, and the send button never
  moves out from under a thumb reaching for it.
- **The face switcher is a bottom sheet** on touch, not a dropdown — a plural
  user switching faces mid-conversation is a frequent action and deserves a big
  target.

## Notifications — the honest table

This is where mobile hurts, and pretending otherwise helps nobody.

| | Android (PWA) | iOS (PWA) | Native (later) |
| --- | --- | --- | --- |
| Push | works | **home-screen install only**, and **not at all in the EU** | works |
| Reliability | good | unreliable after restarts, unsubscribes silently | good |
| Background sync | yes | **no** | yes |

The mitigations, which are real but not a substitute:

- **Reconcile on open.** Every launch syncs from the local cursors, so a missed
  push never means a missed message — it means a late one. This is the property
  that makes the situation survivable and it's worth engineering carefully.
- **Content-free pushes** decrypt locally, so a delayed notification still shows
  correct content when it lands.
- **We say so in the app.** The notification settings screen on iOS states the
  limitation plainly instead of showing a toggle that silently does nothing —
  including the EU case, which is not the user's fault and shouldn't look like
  their misconfiguration.

Native mobile is a real second project (`06` Phase 7). This section exists so
nobody discovers these constraints late and treats them as bugs.

## Calls on a phone

- Joining is one tap and **starts muted** (`21`).
- The in-call view is a vertical tile stack; the active speaker takes the top
  slot and the rest scroll.
- The call **continues in the background** with an OS notification and controls,
  and survives a screen lock.
- `sendBeacon` on `pagehide` clears presence if the tab is killed, so nobody
  lingers as a ghost participant.
- Bluetooth and route changes don't drop the call; the current route is shown.
- On-device captions are **desktop-only in v1** and the UI says so rather than
  offering a toggle that produces a slideshow.

## Flaky connections

A phone's connection is not a desktop's, so the sync engine's behaviour is
user-visible and must be calm about it:

- Outgoing messages show a **pending** state and send on reconnect. They are
  never silently dropped and never duplicated — the `client_nonce` dedup
  (`04` §2) is what makes retry safe.
- Connection state is **one small dot** in the header. Not a red banner, not a
  modal, not a toast per reconnect.
- Reading works entirely offline from the local store, including search.
- Media downloads resume rather than restarting.

## Storage on a device that has none

Local-first on a 64GB phone with 2GB free is a real constraint, so the
`19-app-shell-ux.md` storage screen is *more* important on mobile, not less:

- Media caching is capped by default on metered/small devices, with the cap
  visible and adjustable.
- Old media evicts before old messages — text is small and precious, images are
  large and re-downloadable.
- Translation models are opt-in downloads with their size shown before the tap
  (`10`).

## What the phone gives up in v1

Stated plainly so it can be a decision rather than a disappointment: no multiple
windows, no on-device captions, no drag-to-reorder, and a reduced customisation
surface (theme and density yes; column layout is meaningless with one column).
Everything else — every room, every face, every agent, calls, search, history —
is the same product.
