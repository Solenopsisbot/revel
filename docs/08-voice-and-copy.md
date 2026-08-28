# Voice and copy

How the product talks. Everything in section 2 is final copy — a developer
pastes it, a designer lays it out. If this doc and a mockup disagree, this doc
wins until this doc is updated.

---

## 1. Voice rules

The product sounds like a friend who happens to know how the building is wired.
Warm, specific, sometimes funny, never trying to impress you and never trying
to scare you. It tells you what things cost in the same breath as what they do.
It never asks you to trust it — it shows you the architecture and lets you
decide.

**Surface is playful. Underneath is blunt.** Bright
button, and then in small muted type directly below: the honest caveat. That
small type is not a disclaimer. It's the other half of the sentence.

### Rules

1. **Never say "military-grade," "bank-grade," or any grade.** Our encryption
   is not a marketing adjective. It is a specific protocol (MLS, RFC 9420) and
   we link to the spec.
2. **Never put a padlock icon in anything.** No shields, no green ticks, no
   "secured by" badges. Everything is encrypted; decorating it implies
   something else isn't.
3. **State costs alongside benefits.** If search is private, say it's
   local-only and slower. If disappearing messages exist, say anyone who saw
   them can screenshot them. If the web client is convenient, say the desktop
   app is the stronger trust path. Every feature description is a full
   sentence, not half of one.
4. **Be honest about what we can't do.** "We can't" is a complete thought.
   Don't soften it into "currently" or "at this time." If the server genuinely
   cannot reset your password, say so and say why and don't apologise.
5. **No emoji in UI chrome.** Words. (User-generated content is their business;
   reactions, custom emotes, message bodies — all fine. The product's own voice
   uses none.)

### Do / don't

| Don't | Do |
| --- | --- |
| "Your messages are protected with military-grade encryption." | "Messages are end-to-end encrypted. The server stores ciphertext it can't open." |
| "We take your privacy seriously." | (Just don't say this. Ever. About anything.) |
| "For your security, please..." | "You'll need your recovery code. We can't reset your password — that's the whole point." |
| "Error: Unable to decrypt message (0x4A21)" | "This device can't read messages here yet. It's syncing — give it a minute, or tap Sync." |
| "Would you like to enable disappearing messages for enhanced privacy?" | "Disappearing messages are on. They'll be removed after the timer runs out — but anyone who saw them can save them. That part's on humans, not software." |

---

## 2. The screens

### Sign-up: recovery code

The user has just chosen a handle and password. This is the full-screen moment
that follows. It is a **moment screen** — full personality, display type, the
works.

> **This is your way back in.**
>
> Your password never leaves your device — not even we have it. That means if
> you forget it, nobody can reset it. This recovery code is the only backup
> that exists.
>
> Write it down. Save the file. Do both. If you lose this and forget your
> password, your account is gone and we genuinely cannot help you. We're not
> being dramatic. That is the architecture.
>
> `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`
>
> [Copy to clipboard]  [Download as file]  [Show as QR]
>
> [ ] I saved my recovery code somewhere I won't lose it.
>
> [Continue]

The checkbox must be ticked before [Continue] enables. The button is greyed
and inert until then — no tooltip, no explanation, the label is the
explanation.

After the user continues, the optional passkey step:

> **One more thing (optional)**
>
> Add a passkey and you can unlock with your face or fingerprint instead of
> typing your password every time. Your recovery code still works as a backup
> either way.
>
> [Add a passkey]  [Skip for now]

### Sign-in: new device

Handle + password + 2FA. This is workspace-register — clean, boring, fast.

> **Sign in**
>
> Handle
> `[                    ]`
>
> Password
> `[                    ]`
>
> [Sign in]
>
> *Have another device handy?* [Scan instead]

If the IdP has a second factor enrolled, after handle + password:

> **One more step**
>
> Enter the code from your authenticator app.
>
> `[      ]`
>
> [Verify]

Or, if passkey:

> [Use passkey instead]

### QR device-add: new device side

The new device shows this while displaying a QR code and waiting to be
scanned:

> **Scan this from a device you're already signed in on.**
>
> Open your device list and tap "Add a device." It'll scan this and send your
> keys over.
>
> *Waiting...*

### QR device-add: existing device side

The existing device sees this after scanning:

> **New device wants to join**
>
> A device identifying itself as:
>
> **[device label]**
> Fingerprint: `XXXX XXXX XXXX XXXX`
>
> wants access to your account. If this is you, confirm. If you didn't just
> scan a QR code on another device, deny it and check your account.
>
> [That's mine -- approve]  [Deny]

### Forgot password

> **Reset your password**
>
> We can't email you a reset link because we never had your password — your
> device proves it to the server using a protocol called OPAQUE, and no
> password-shaped thing is ever stored. That's the architecture that keeps your
> data yours, and this is the one place it's inconvenient.
>
> You have two ways back in:
>
> **Recovery code**
> The one from when you signed up. Enter it below and pick a new password.
>
> `[                                        ]`
>
> [Reset with recovery code]
>
> **Passkey**
> If you enrolled one, it can unlock your account too.
>
> [Use passkey]
>
> *If you don't have either of these, the account cannot be recovered. This
> is not a policy — it is a property of the system. The server does not have
> enough information to let you back in.*

### "New device signed in" notification

Shown on every other enrolled device as a system notification and as an
in-app banner:

> **New sign-in: [device label]**
> [location, if available] -- just now
>
> [That's me]  [Not me -- sign it out]

If the user taps "Not me," the device is immediately revoked and the user
is taken to their device list.

### First-run: empty room state

The user has signed up and lands in their space for the first time. No rooms,
no DMs yet. The main chat area shows:

> **Nothing here yet.**
>
> This is where your rooms will be. Create one, or check your DMs — someone
> might have already said hi.
>
> [Create a room]

### First-run: welcome bot message

The welcome bot is a real agent account, visible in the member roster with
the bot badge. Its first DM to the user:

> **[bot name]** *bot*
>
> hey -- i'm [name], and i live here. not a tutorial, not a tooltip. i'm
> an actual account in this app. you can see me in the member list right now
> if you want to check.
>
> that's kind of the whole idea: if something can read a room, it shows up.
> no ghost readers. bots, agents, your friends, your headmates -- everyone's
> in the roster or they're not here.
>
> a few things worth knowing:
>
> -- your messages are encrypted before they leave your device. the server
> moves ciphertext around and can't read any of it. that means search is
> local (it works, it's just on your machine), and i can only read rooms
> i'm a member of, same as anyone.
>
> -- you can have multiple faces on this account. if you're plural, or you
> just want a different name somewhere, open the face switcher in the
> composer. it's not a feature, it's how accounts work.
>
> -- that recovery code from sign-up? keep it somewhere real. i can't help
> you get back in if you lose it. nobody can.
>
> anyway. welcome. go make a room or something.

### Empty states

**No DMs yet:**

> **No conversations yet.**
>
> When someone messages you or you message them, it'll show up here.

**No rooms in this space:**

> **This space is empty.**
>
> Rooms are where the talking happens. Make one?
>
> [Create a room]

**No search results:**

> **Nothing matched.**
>
> Search runs on your device over messages you've synced. If something's
> recent and missing, give it a moment to catch up.

**All caught up:**

This is the fading hairline rule in the message list. The text centred on it:

> You're caught up.

No button, no action. Just the line.

### Error banners

These appear as a quiet banner at the top of the room, never as a modal.
Colour is the muted warning tone, not red.

**Can't read messages yet (sync lag after new device enrolment):**

> This device can't read messages here yet. It's syncing — give it a minute.
> [Sync now]

**History is off for you (not an error):**

> This room doesn't share history with devices that joined after it was sent.
> Everything from here on is yours.

**Key change:**

> **[name]'s key changed.** This happens when someone gets a new device or
> reinstalls. If you're not sure, ask them.
> [Verify]  [Trust anyway]

**Session disagreement (diverged 1:1):**

> Your session and **[name]**'s disagree on the state of this conversation.
> This can happen after a reinstall or a long offline stretch. You can keep
> going in a new session — your old messages stay readable.
> [Start a new session]

### Room settings toggles

Each toggle has a one-line description underneath it in `--text-mute`.

**New members can read past messages**

> When someone joins, they get the full history of this room. Turn this off
> and new members only see messages sent after they arrived.

**Disappearing messages**

> Messages are removed after the timer runs out. This is a courtesy, not a
> guarantee — anyone who saw a message can screenshot it. Software can't fix
> that.

**Show message previews on lock screen**

> If this is on, notification previews include message text. If it's off,
> you'll see who sent it but not what they said. Previews are decrypted on
> your device — the push payload is always content-free.

**Threads are visible to the server**

> Threads in this room are separate streams on the server, which makes them
> faster to load but means the server knows that a thread exists (not what's
> in it). Turn this off and threads are paged client-side — slower, but the
> server doesn't see the structure.

### Bot in roster

**Badge text (next to the bot's name in the member list):**

> bot -- can read this room

**Adding a bot — the flow:**

The "Add members" sheet (same one used for inviting people) has a toggle at
the top:

> [People]  [Bots]

When switched to Bots, the list shows available agents. Tapping one opens a
confirmation:

> **Add [bot name] to [room name]?**
>
> [Bot name] will be able to read and send messages in this room, the same as
> any member. It shows up in the member list with a "bot" badge — everyone in
> the room can see it's here.
>
> [Add to room]  [Cancel]

---

## 3. Words we don't use

| Avoid | Say instead | Why |
| --- | --- | --- |
| server (meaning a community) | **space** | "Server" is a machine. A community is a space. Discord conflated these and now everyone thinks they run a server. They do not. |
| identity (meaning a persona) | **face** | "Identity" already means the cryptographic keypair. A persona is a face. Plural systems know what this means; everyone else picks it up fast. |
| military-grade | (banned) | Meaningless, and it sounds like ad copy for a VPN. |
| end-to-end encrypted (as a selling point) | **encrypted** or describe the architecture | Everything is E2EE. Saying it on one thing implies other things aren't. When we need to be specific, we describe the mechanism. |
| privacy-focused / privacy-first | (avoid in UI; fine in external writing) | The product is a chat app, not a privacy app. The privacy is structural. Labelling it centers the wrong thing — it should be like insulation, not like a feature. |
| secure | **encrypted**, or name the specific property | "Secure" is a claim with no definition. Say what's actually true: encrypted, verified, local-only, content-free. |
| we take your privacy seriously | (banned) | Every company that has ever leaked your data said this first. |
| sync / synchronise (user-facing) | **catch up** or **get your messages** | "Sync" is a backend word. The user's mental model is "my messages are arriving." |
| utilize | **use** | Come on. |
| enhanced | (banned) | Enhanced what? Compared to what? Say the thing. |
| seamless | (banned) | Nothing is seamless. If it were seamless you wouldn't need to describe it. |
| leverage (as a verb) | **use** | See "utilize." |
| trusted / trust us | (avoid) | We are asking people to verify, not to trust. The whole architecture is about reducing the trust surface. Saying "trust us" undermines it. |
