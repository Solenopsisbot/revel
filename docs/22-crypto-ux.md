# The crypto surfaces

The design rule from `05-client-and-ux.md` is that **crypto is invisible until it
must not be**. This doc covers the exceptions: the handful of moments it becomes
visible, plus the deliberate "show me" surfaces for people who want to look.

Everything here is a *rare* screen. If any of these becomes routine, something
upstream is wrong.

## The four states a conversation can be in

Only one of them is worth showing, which is the whole point:

| State | What the user sees |
| --- | --- |
| **Working** (overwhelmingly the default) | **nothing.** No lock, no badge, no green tick, no "encrypted" label. |
| **Catching up** — device joined, keys not yet arrived | a banner with a *Sync* button; messages render as they decrypt |
| **History withheld** — you joined after these were sent | a quiet note at the top of the scrollback, not an error |
| **Diverged** — your session and theirs disagree | a banner with *Reset this conversation* |

**Why no lock icon anywhere.** Everything is encrypted, so a badge saying so
carries zero information — it's decoration that trains people to ignore it,
which then makes it useless on the day it matters. Signal-style "this
conversation is encrypted" banners exist because the app also has unencrypted
SMS; we have no such distinction to draw.

## Verification

Comparing safety numbers is the **fallback**. The primary defence is key
transparency (`03` §2) — an append-only log where the server cannot swap your
key without detection. That ordering is important to the design: verification is
an option offered without pressure, not a chore the app nags about.

- **Unverified is the normal state and looks normal.** No shields, no "not
  verified" warnings, no shame badges. A product where most contacts are marked
  with a warning has taught its users to ignore warnings.
- **Verify encryption** lives on the profile card. The screen shows the 60-digit
  number and a QR, with one line: *"If these match on both screens, nobody is in
  the middle. Together? Scan it. Apart? Read it out — an attacker would have to
  fake your voice live."*
- **Per account, not per face**, and the screen says so — otherwise it's exactly
  the thing a plural user would wonder about.
- Once verified, a small mark on the profile card. Not on every message.

## When a key changes

The one genuinely security-critical interruption (`12` rung 4). It happens for
mundane reasons — new phone, reinstall — and for one bad reason, and the UI must
not cry wolf while still being takeable seriously.

**In a live conversation** it is a popup, because you're actively talking to
someone who may not be them. Everywhere else it's a banner or a notice. In all
cases the copy states both possibilities in one breath — *"usually a new phone;
also what an attack looks like"* — and offers *Compare codes* / *It's fine*.

**Never** silently accept a key change, and never block the conversation over
one. Both extremes are wrong: silent acceptance defeats the mechanism, blocking
teaches people to click through.

## Resetting a diverged conversation

Kith hit this and never built the fix. It happens: two sides' MLS state
disagrees, and new messages stop arriving.

```
  You and Emeri have drifted apart

  Your apps disagree about this conversation's keys, so new
  messages aren't getting through. Resetting starts a fresh
  session — everything you already have stays readable, and
  neither of you loses history.

  [ Reset this conversation ]        [ Not now ]
```

It creates a new group for the pair, both sides keep their existing decrypted
history locally, and a system line marks the seam in the timeline so the gap
isn't mysterious later. This is a **recoverable** state and the copy makes that
obvious — the Matrix failure being avoided is precisely the dead-end.

## Attachments

Files are sealed client-side with a per-file key that travels inside the
encrypted event (`04` §2), so the blob store holds ciphertext with no filename
or type.

Visible consequences, and they need handling:

- **No hotlinking.** An attachment URL pasted elsewhere is meaningless bytes.
  The share menu offers *Copy link* only for people in the room, and says why:
  *"Only people in this room can open this."*
- **Downloading decrypts locally.** Large files show real progress for the
  decrypt step, not a frozen spinner.
- **Thumbnails are generated before upload** on the sender's device, and travel
  as their own sealed blob — the server can't generate them.
- **Link previews are built by the sender's client** and shipped inside the
  event. The server never fetches a URL, which also means no IP leak to the
  linked site for readers.

## Backup, recovery, and the keys screen

Settings → Account holds the three wraps (`03` §1) as three plain rows:

```
  Password          set                          [ Change ]
  Recovery code     saved 27 Aug                  [ Show ] [ Replace ]
  Passkeys          1 registered                  [ Manage ]

  Any one of these can get you back into your account.
  If you lose all three, the account is gone — we can't
  recover it, and neither can anyone else.
```

- **Show** re-reveals the recovery code behind a re-auth. People lose the paper.
- **Replace** generates a new one and invalidates the old — needed after you've
  read it aloud to someone or stored it somewhere you regret.
- The closing sentence appears here permanently, not just at sign-up, because
  this is the screen someone visits when they're already worried.

## "What the server can see" — the flagship

Wren generates it from the room's real configuration (`12`). It belongs in three
places: her command surface, the room's settings, and **Settings → About**, one
tap from a curious stranger's first poke at the app.

It is the most persuasive screen in the product and the only one that makes the
architecture legible to a non-technical person. It should be generated, never
canned, so it stays true as settings change — a hardcoded reassurance that
silently stops matching reality is worse than none.

## Key transparency, from the user's side

Mostly the user sees **nothing**, which is correct — the log, the inclusion
proofs and the monitor all run without ceremony.

The one thing that surfaces: if the monitor ever detects that **your own** key
binding changed without you doing it, that is unambiguously bad and gets the
strongest treatment in the app — a full-screen interruption, not a banner, with
the plainest language we have and a direct route to rotating your key. This is
the only place in the product that earns real alarm, and reserving it for exactly
this is what keeps it meaningful.
