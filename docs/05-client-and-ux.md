# Client and UX

"Really good UX from the start" is the brief. This doc is the plan for
*how* — what good means here, where E2EE products usually fail, and the client
architecture that makes the UI cheap to get right.

## 1. What "good" means for this product

1. **Instant.** The app opens on the last room you were in, fully rendered from
   the local store, in under 300 ms, before the socket is even connected.
   Sending is optimistic. Switching rooms never shows a spinner. Scrollback is
   local until you hit the edge of what you've synced.
2. **Crypto is invisible until it must not be.** No lock icons on every message,
   no "encryption enabled" banners, no toggles. Everything is encrypted, so
   nothing needs announcing. The crypto surfaces exactly three times: when you
   sign up (recovery code), optionally when you add a device (scan a QR instead
   of typing), and when you verify a friend (safety number, optional). And once
   when something is wrong — see §3. Signing in on a new device looks like
   signing in to anything else: handle, password, a 2FA code.
3. **Never a dead end.** "Unable to decrypt" as a permanent tombstone is the
   Matrix failure the discussion thread is about. Every failure state has a
   button: "Sync from your other device", "Ask <name> to re-share", "This device
   joined after this was sent — history is off for this room".
4. **Plurality is invisible until you use it.** A singlet sees no face
   switcher and no "system" vocabulary anywhere — for them it is simply a
   chat app. Every plural affordance appears the moment a second face
   exists and disappears if you go back to one. See
   [`11-people-and-agents.md`](11-people-and-agents.md).
5. **Headmates are a first-class control, not a setting.** The face switcher
   is in the composer, one keystroke away, with proxy tags for people who type
   faster than they click. Per-face avatars, expressions per message, per-room
   face presence — all Kith features, all kept, all inside the ciphertext now.
6. **Computer friends look like members** because they are. A bot in the roster
   has a badge and a one-line "can read this room" — the same line every human
   member implicitly has. Adding one is the same flow as inviting a person.
7. **Both keyboard-first and touch-first.** ⌘K palette from day one (Kith's
   modular branch built one; port it). Swipe-to-reply, long-press menus,
   finger-tracked drawers from Kith's mobile pass. Enter-sends only with a fine
   pointer.
8. **Notifications you can predict.** One rules screen: per room — everything /
   mentions / nothing; per space — inherit; global — DND, quiet hours, sounds.
   The rule that fired is shown on the notification. Muted things get a quiet
   dot, never a badge. The eleven rules, in order, are `35-notification-rules.md`
   — including the two that are arguments: a mute beats a direct mention, and
   nothing at all beats DND.
9. **Customisable, but never at the cost of a baseline.** Kith's CSS-variable
   seam (theme, accent, radius, density, font, column layout, reduce-motion) is
   in the design system from the first component, synced to the account.
10. **Accessible from the first component.** Reduce-motion, contrast tokens,
   focus rings, a message list that screen readers can actually traverse
   (`role="log"`, live-region for new messages, skip links). Not a phase.
11. **No emoji anywhere in the product's own surfaces.** Not in buttons,
    empty states, headings, system messages or notifications. Every glyph is
    a drawn icon. Emoji are *user content* — the picker, a reaction someone
    chose, text someone typed — and nothing else. See
    [`07-design-language.md`](07-design-language.md).

## 2. Information architecture

```
Home ─ inbox (unified unread across DMs + mentions), DMs, group DMs, friends
Spaces (rail) ─ rooms grouped by category ─ threads ─ annotations
Voice rooms ─ persistent, join/leave, captions panel
You ─ faces, devices, notification rules, appearance, safety numbers
```

- **Rooms** are Discord channels without the word "channel". A space's rooms
  are the sidebar; DMs are rooms without a space and live under Home.
- **Threads** are streams within a room: open in a side panel on desktop, as a
  pushed view on mobile. A room with `stream_paging` off still supports threads
  (paged client-side), just less efficiently — the setting is a privacy knob.
- **Annotations** (an idea from the original discussion) fold under a message:
  a translation, a transcription of a voice clip, a note. Toggle per kind in
  the room header ("show translations: German"). Anyone can annotate; a bot
  usually does.
- **Expressions** — the per-message avatar picker — sits in the composer next
  to the face switcher, Kith-style.

## 3. The three cliffs, as screens

**Sign-up.** Handle, display name, password. Then one full-screen step:
"This is your recovery code. We can't reset your password without it." Copy /
download / show-as-QR, and a checkbox that says "I saved it" that you actually
have to tick. Then an *optional* "Add a passkey too — then you'll rarely need
that code" with a one-tap enrol. Then you're in a DM with a welcome bot (a real
agent, visibly in the roster — the first demonstration of principle 5).

**Sign in on a new device.** Handle, password, and — if enrolled — a six-digit
code or a passkey tap. That's the whole screen; it looks like signing in to
anything else. Then the new device populates rooms in the background with a
progress line, history included. Under the form: "Have another device handy?
Scan instead" → the QR path, where the old device gets "A new device wants to
join — is this you?" with the new device's fingerprint and a "Yes, that's my
phone" tap. Either way, every *other* device gets a quiet "New device signed
in: <label>, <where>" notification with a "Not me — sign it out" button.

**Forgot password.** "Enter your recovery code" or "Use your passkey", then set
a new password. The copy says why there's no email reset: "We can't reset your
password because we never had it — that's the point."

**Something's wrong.** One design for every crypto failure — a banner in the
room, never a modal, never a tombstone-per-message:
- "This device can't read messages here yet" → *Sync* (fetch the Welcome /
  ask another device) — the normal case after enrol lag.
- "This room's history is off for you" → not an error; a subtle note at the
  top of the scrollback.
- "<name>'s key changed" → *Verify* / *Trust anyway* / *Ask them*. Shown once,
  inline, not on every message.
- "Your encryption state and <name>'s disagree" (the diverged-1:1 case Kith
  hit) → *Reset this conversation* (new group, old history stays readable).

## 4. Client architecture

The single most important structural decision for UX velocity: **the UI is
thin because the core is thick.**

```
packages/core   (no DOM, no framework, runs in browser / Tauri / Bun)
  session/      device auth, IdP client, socket with resume
  crypto/       engine glue: groups, era roots, anchors, welcomes, commit policy
  sync/         cursors per room, catch-up, push handling, optimistic queue
  rooms/        reduce.ts + selectors (messages by room, thread, pins, unread)
  store/        Store interface: Dexie impl (web), SQLite impl (Tauri/Bun)
  search/       local FTS over decrypted bodies (MiniSearch or FlexSearch; SQLite FTS5 where available)
  notify/       rules engine → "should this event notify, and how"
  api/          typed REST client over @uca/protocol

apps/web        SvelteKit. Components read core state via a tiny runes bridge.
packages/ui     tokens + primitives (Button, Menu, Sheet, Dialog, Avatar, Field, Toast, Tooltip, VirtualList)
```

- **State** lives in the core as plain observable stores; `apps/web` wraps them
  in `$state` once at the bridge. No component talks to the network or the
  crypto. Kith's 1,783-line `store.svelte.ts` becomes the `sync/` + `rooms/`
  modules with unit tests and no Svelte in them.
- **Virtualised message list** from the start (Kith's wasn't; it worked until it
  didn't). Author grouping, day dividers, jump-to-reply, scroll anchoring on
  prepend — all in one well-tested component.
- **Composer** is its own package-level component: node-tree editing (not a
  textarea + regex), face switcher, expression picker, attachments with
  client-side thumbnails + sealing, `@`/`:`/`#` autocomplete, reply banner,
  ↑-to-edit, slash commands feeding the palette.
- **Design system first.** Phase 0 builds `packages/ui` with real components
  against fake data: the shell, the message list, the composer, the three-cliff
  screens, light/dark, cozy/compact, reduce-motion. This is the "UX from the
  start" investment — it's cheap before there's a backend and expensive after.
  No Figma; the design tool is the running app.

## 5. Platforms and notifications — the honest plan

| Platform | Client | Notifications | Key storage |
| --- | --- | --- | --- |
| Desktop browser | web app (PWA) | Web Push via service worker; reliable on Chrome/Firefox/Edge | non-extractable `CryptoKey` in IndexedDB |
| Desktop app | Tauri 2 around the web build | native OS notifications; **the reliable path** | OS keychain |
| Android | PWA now; Tauri 2 / native later | Web Push works; FCM once native | Keystore once native |
| iOS | PWA now; native required for real use | Web Push **only** if installed to Home Screen, **not at all in the EU** (DMA), flaky after restarts. Native APNs is the only honest answer | Keychain once native |

So: the web app is the product for v1, the desktop app is what we tell people
to use if they care about "trust no one", and **mobile is a real second
project** — the discussion's "you need a full team" point lands here. Until
then, the reconcile-on-open guarantee means a missed push is never a lost
message, which is more than Matrix managed.

Push payloads are content-free. The device decrypts locally and shows a preview
only if the user chose "show previews on lock screen".

## 6. The QoL list from the discussion, mapped

| Ask | How, under "no ghost readers" |
| --- | --- |
| Auto audio transcription (voice clips) | on-device (Whisper via `transformers.js`/WebGPU on desktop; `whisper.cpp` in Tauri) → posted as an `m.annotation {kind:'transcript'}` by *your* client; or a transcriber agent in the roster |
| Real-time voice call captions | same models on the receiving device; hardware that can sustain a Whisper-class model in real time, which today means a laptop or desktop with a neural engine or discrete GPU — phones get a "captions need the desktop app" note in v1; or a captioner agent that's visibly in the call |
| Auto image captioning | on-device model on upload; caption travels inside the `BlobRef` as alt text — accessibility win too |
| Auto-translate, togglable per message | **built in** — on-device translation via a browser/OS/bundled-model ladder, local and private by default, never cloud. Full design in [`10-translation.md`](10-translation.md). |
| Multiple pfps per identity | Kith's expressions, kept |
| Link previews | generated by the *sender's* client and shipped inside the event (Signal's approach) — the server never fetches URLs |
| Custom emotes, stickers | encrypted blobs referenced from `room.emotes` |
| Disappearing messages | `expires` field on `m.message`, honoured client-side, with the "anyone can save it" line in the setting's description |
| Search | local index per device; new devices index as they sync history |

## 7. Plugins and customisation

Phase 1 of Kith's modular roadmap (theme/accent/radius/density/font/reduce-
motion/column order, synced) is in the design system from the start. Kith's
sandboxed-plugin design (`plugins-design.md`) is adopted unchanged as the
post-v1 extension story: opaque-origin iframes, host-mediated RPC, manifest
permissions, no ambient authority, and — because the core is headless —
plugins can also run against the agent host as room members, which is the
honest way to give a plugin read access.
