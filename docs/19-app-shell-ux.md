# The app shell — settings, search, and the web app

Everything not covered by identity (`17`), spaces (`18`), messaging (`05`) or
Wren (`12`). The connective tissue.

## Settings — the full IA

One surface, reachable by `⌘,` or from the account menu. Sections ordered by how
often a real person opens them, not by how the system is architected.

| Section | Holds |
| --- | --- |
| **Account** | handle and address, provider block + Move (`17`), password, passkeys, recovery code, sign out |
| **Faces** | the face list, add/edit/reorder, proxy tags, per-face avatars and expressions, **"link my faces publicly"** — hidden entirely at one face (`11`) |
| **Devices** | the device list, add, sign out, fingerprints (`17`) |
| **Notifications** | global rules, per-space and per-room overrides, quiet hours, sounds, lock-screen previews |
| **Language** | interface language; **translation** — which languages you read, per-room overrides, downloaded models and their sizes (`10`) |
| **Appearance** | theme, accent, density, font, personality, reduce motion, column layout, presets, import/export (`07`) |
| **Wren** | Quiet / Normal / Chatty, plus silenced notice categories with a way to un-silence (`12`) |
| **Privacy & safety** | who can DM you, who can add you to spaces, blocked accounts, read receipts, typing indicators |
| **Storage & data** | local database size, per-space breakdown, downloaded models, cached media, **export**, clear local data |
| **About** | version, build hash, licences, **what the server can see** (Wren's generated explainer, `12`), security contact |

Two things worth calling out:

**Read receipts and typing are opt-out and live under Privacy**, not Appearance,
because they are disclosures about you rather than preferences about the app.

**"What the server can see" is in About**, one tap from a stranger's first
curious poke at the app. It is the single most persuasive screen we have and it
should not be buried in a docs site.

## Storage & data — a real screen, not a stub

Local-first means the client holds a real database, so a person can and will ask
where their disk went. Nobody does this screen well and it's cheap to do properly:

```
  On this device                                    2.4 GB

    Messages and history          410 MB
    Media and files             1,700 MB   [ Clear cached media ]
    Search index                   90 MB
    Translation models            210 MB   [ Manage ]

  By space
    Solexsis                    1,100 MB
    Braid                         840 MB
    Direct messages               460 MB

  [ Export everything ]        [ Clear local data ]
```

- **Clear cached media** is safe and reversible (re-downloads on demand). Said so.
- **Clear local data** is not: it drops decrypted history this device holds, and
  history the room won't re-serve is gone from here. Rung-4 confirmation, in
  Wren's voice, naming the consequence.
- **Export everything** produces a readable archive — plain JSON plus media
  files, not a proprietary blob. If a person's messages are genuinely theirs, an
  export has to be usable somewhere that isn't us. This is also the honest answer
  to "what if you shut down".

## Search

Local-only, per `03` — the server is the search adversary, so there is nothing to
query server-side.

- `⌘K` is the command surface (Wren, `12`); **`⌘F` searches**. Two keys, two
  jobs, because merging them makes both worse.
- Scope defaults to the current room with a one-click widen to the current space
  and then everything. Filters: from a person, has a file, in a date range, in a
  thread.
- **Indexing is visible and honest.** A new device shows *"Searching 12 of 148
  rooms — older messages are still being indexed"* rather than silently returning
  incomplete results. A search that can't see everything must say so, or people
  will conclude the message doesn't exist.
- Results show room, face, timestamp and a highlighted excerpt; enter jumps to
  the message in place with it briefly highlighted.
- Search never leaves the device, and the empty state says exactly that once.

## The web app

The web client is the product for v1 (`05` §5). Which means the browser
experience is not a fallback and shouldn't feel like one.

**Install.** After a few sessions, a single quiet inline offer to install as an
app — better notifications, a dock icon, its own window. Dismissed once means
never again. On iOS the copy is honest rather than hopeful: notifications need
the home-screen install, and in the EU they don't work at all.

**Deep links.** Every meaningful thing has a URL: space, room, message, invite,
settings section. Links are shareable, the back button works, and refreshing
lands you where you were. Opening a message link you can't decrypt yet shows the
"catching up on keys" banner, not an error.

**Multiple windows.** Popping a room or a call into its own window is a real
use-case for a chat app on a desktop, and the shell is built for it: state lives
in the core (`05` §4), so a second window is another view over the same local
database, synchronised through a broadcast channel. Not v1, but the architecture
must not preclude it.

**Offline.** The service worker serves the shell; the local database serves the
content. Offline you can read everything you have, search it, and compose —
outgoing messages queue with a clear pending state and send on reconnect. The
connection state is one small dot in the header, not a modal that blocks the app.

**Tabs.** Two tabs of the app must not fight over the local database or the
socket. One tab holds the connection and the others follow it via a leader
election; if the leader closes, another takes over within a second. Getting this
wrong produces the duplicated-notification bug every web chat app ships at least
once.

## Keyboard

A chat app that can't be driven from the keyboard loses its power users on day
one. The set, all remappable later:

| | |
| --- | --- |
| `⌘K` | command surface / ask Wren |
| `⌘F` | search |
| `⌘,` | settings |
| `⌘⇧A` | switch account |
| `⌥↑ / ↓` | previous / next room with unread |
| `⌘1…9` | jump to space |
| `Esc` | close, or clear the reply |
| `↑` | edit your last message |
| `⌘/Ctrl + ↑↓` in composer | switch face |
| `⇧Esc` | mark space read |

Every shortcut is listed in the command surface next to its action, so it teaches
itself rather than living in a help page nobody opens.

## Onboarding, end to end

The three cliffs (`05` §3) cover the crypto. The rest of the first run:

1. Handle, password, recovery code (`08` copy) — the only mandatory steps.
2. **One overlay, with Wren.** She says what she is, that she lives on this
   device, and that you can ignore her — and then gives you the button that
   turns her down, because advising you a setting exists is the Clippy move
   and doing the thing is her own rule (`12`).
3. One inline card: *"Spaces you're invited to appear here. Or make one — it
   takes a second."* Dismissible, gone forever once you have a space.
4. Nothing else. No tour, no coach marks, no progress ring. The three-cliff
   screens already spent the user's patience on the things that genuinely
   can't be recovered from, and that budget is finite.

### Why an overlay and not a DM with Wren

This step used to read *"you land in a DM with Wren — a real conversation with
a real account visibly in the roster."* That was wrong, and wrong in a way that
mattered: `09-mascot.md` §"Why she can't be a room bot" is explicit that Wren
**cannot be in a room**. A mascot who can read your conversations is precisely
the ghost reader the product swears doesn't exist, and shipping her as one
would have burned the thesis down to make onboarding friendlier.

An overlay is the honest surface — it is the client talking to you, on your
device, in the one place that is not a room. It also lets her introduction make
a claim a welcome *bot* never could. `08`'s bot leads with "you can see me in
the member list right now"; Wren leads with **"I'm not in your rooms. I can't
be."** Hers is the stronger sentence, and it is the product's whole argument in
six words.

If someone wants Wren *in* a room she can be added as an agent account, with a
real leaf in the group and a real roster entry — a separate instance, sharing
no state, per `09` §"The agent account".

## Accessibility, concretely

Named here so it's testable rather than aspirational:

- The message list is a `log` with a polite live region for incoming messages;
  new-message announcements are throttled so a busy room doesn't flood a screen
  reader.
- Every icon-only control has a label; the icon set is decorative-by-default with
  `aria-hidden` and the accessible name on the control.
- Full keyboard traversal with a visible focus ring everywhere (`07` tokens), a
  skip-to-composer link, and no keyboard traps in modals or the thread panel.
- Face colours are never the *only* carrier of meaning — names are always present
  — because the palette is doing identity work and a colour-blind user must not
  lose attribution.
- Reduce-motion kills the typing dots, the drawer tracking and the button lift.
- Contrast is enforced by the token system and checked in the reference page, not
  by eye.
