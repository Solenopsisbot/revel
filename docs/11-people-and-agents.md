# People, faces, and agents

How the product shows you *who* you're talking to: a person, one of their faces,
or a piece of software. Three audiences have to be served at once — plural
systems, singlets, and everyone dealing with bots — and the design fails if
serving one of them taxes the others.

## Part 1 — Plurality is invisible until you use it

The single rule that makes this work:

> **A singlet never sees a plurality affordance.** No face switcher, no "system"
> vocabulary, no faces list, no badges about who else is in your account. The app
> looks like a normal chat app, because for them it is one.

Kith got the data model right (`01-lessons-from-kith.md`) but surfaced the
machinery to everyone. Here the machinery only appears once it's load-bearing.

### What that means concretely

| Surface | Singlet (1 face) | Plural (2+ faces) |
| --- | --- | --- |
| Composer | no face chip at all | face chip left of the input, click or `⌘/Ctrl+↑↓` to switch |
| Settings | "Profile" — name, avatar, pronouns, bio | "Profile" plus a **Faces** section listing each face |
| Their own messages | just their name | name of the face that spoke, in that face's colour |
| Someone else's messages | a name and avatar | same — unless that account has chosen to link its faces publicly (below) |
| Member list | one row per person | one row per *present face*, optionally grouped |

The entry point that turns it on is one row in profile settings — **"Add another
face"** — with a one-line explanation. Discoverable if you're looking, invisible
if you're not. Creating a second face is what switches every affordance above
into existence; deleting back down to one hides them again.

### Vocabulary

Default chrome uses **"face"** and **"profile"**, which are legible to everyone
and presume nothing. The word **"system"** does not appear in default UI. Plural
users who want their own language get it where it belongs — in *their* text: the
account profile's display name, bio, and the relationship label below.

We are not going to teach singlets plural terminology as a precondition for using
a chat app, and we are not going to make plural people use flattened corporate
words for themselves. Neutral chrome, personal content.

### Linking faces — a control that was removed, and why

There was a **"link my faces publicly"** switch here, off by default, described
as an explicit privacy control. It is gone. The analysis below is why, and it
was already in this document before the switch was deleted — what changed is
that the conclusion now follows from it.

The short version: within a room, a face is presentation and nothing more.
Across rooms, faces genuinely separate you. The switch claimed the first and
only delivered the second, which the second did on its own anyway.

Concretely, three steps, available to any member of the room with no privileges
beyond membership:

1. Being in an MLS group means holding **every member's leaf credential**, which
   is a device certificate carrying their account public key. You cannot be in
   the group without it.
2. `RoomState.faces` records the **announcing account against every face**.
3. `GET /idp/accounts/key/<accountPub>` resolves an account key to a handle,
   **unauthenticated**.

`26-platform-and-stack.md` treats custom clients as a supported thing to write,
so "our client does not show it" is not a property. The switch withheld the
connection from exactly one person: whoever was running a client that honoured
it. A setting that protects nobody while implying it protects you is worse than
no setting — which is the argument this project makes about everything else.

What replaces it is a sentence in the Faces screen saying which of the two
properties you actually get, and a pointer to the feature that delivers the
other one.

#### The analysis this rests on

The sentence above is true and it is not the whole picture, so the limit belongs
next to the promise rather than in a results doc somebody has to go and find.

**The server cannot tell. Another member in the same room can, exactly.**

Attribution is cryptographic and it is per *account*: a message's sender is an
MLS leaf, and the leaf resolves to the account that owns it. The face is a field
*inside* the message. So if two of your faces both post in one room, every
member of that room holds two messages that resolve to the same account and
carry different faces. **That is a direct link, not an inference** — no counting,
no watching who posts when, nothing to be clever about. A client that renders
faces rather than accounts is a courtesy, and courtesy is not a security
boundary: the account id is right there in what every member already received.

Counting only matters in the weaker cases — faces in *different* rooms, or a
face that has never spoken. There, a member still sees how many accounts are in
the group and how many faces have spoken, and four faces across three accounts
still means somebody is plural.

No UI change fixes either. Per-account attribution is what makes a message
attributable at all, and a room where you cannot tell who is talking is not a
room.

So the honest statement is much narrower than it reads. Against a member of a
room you have used two faces in, linking off protects against nothing at all.

It does not protect against the server either, though it long claimed to. The
server never learns the connection because **faces live inside the ciphertext**
(`03-identity-and-crypto.md` §7) — that is true with or without a switch, and
the switch was never what delivered it. What the switch actually governed was
one optional field, `FaceCard.address`, and an address is derivable from the
account key that every member of the room already holds.

That leaves a client that carelessly renders two faces as one person — a real
failure mode, and one this codebase committed and then fixed (`31` §23). A bug
to not have, not a control to ship.

For anyone who needs the stronger property, the answer is already in the design
and it is a different feature: `17-identity-ux.md`'s **multiple accounts**,
which are *cryptographically* unlinkable — separate device keys, separate
sessions, separate push subscriptions, and nothing in the protocol connecting
them. That is the tool for "nobody may know these are the same person". Faces
are the tool for "I present differently in different places". Presenting the
weaker one as if it were the stronger one is how somebody gets outed by a
feature that promised not to do that.

**This has to reach the person, not just the doc**, and it does: the face
switcher asks before a face can do something that connects it to another, and
points at a second account for the case where that is not acceptable.

Two situations, because they are not the same fact:

- **In a DM**, faces are membership. `mineIds` records which of your faces are
  in a conversation; one that is not is greyed out, and picking it asks to
  *bring it in*.
- **In a space room**, there is no per-face membership to join — roles and
  audiences are account-level (`03` §4), so every face may already post. What is
  still disclosable is two of your faces turning up in the same room, since the
  second one to speak is what joins them up. So the face stays selectable and
  the click asks once.

The condition is deliberately narrow and self-limiting: nothing to reveal if
none of your faces has spoken there yet, and nothing to reveal if *this* face
already has. It fires at most once per face per room, ever — **friction on a
privacy control is how people learn to click through it.**

The face you pick is remembered **per room**, which is not only convenience: the
check runs against the room you are in, so an account-wide selection would let
you switch somewhere it is harmless and arrive somewhere it is not, already set
to the face that gives you away.

### The profile card — "system information should be good"

Clicking any face opens one card, and it's the same card everywhere:

```
┌──────────────────────────────────────────┐
│  [avatar]  June                          │
│            she/her · mint                │
│            "does the actual work"        │
│                                          │
│  ── not built ──                         │
│  Other faces here:  [V] Viola  [A] Ash   │  ← only faces present in THIS room
│                                          │
│  ── always ──                            │
│  In this room since   12 March           │
│  Roles                Member, Designer   │
│  [ Message ]  [ Verify encryption ]      │
└──────────────────────────────────────────┘
```

The "other faces here" block was gated on the linking switch, and both the
switch and the owner-written "part of X's account" label went with it. What is
left is a design decision nobody has taken: the information is no longer secret
— any member can derive it, see above — so the question is only whether *this*
client is the one to surface it, and for whom. Today the card says "another of
your faces" about your own faces, to you, and says nothing about anybody else's.

Design notes that matter:

- **Only faces present in this room are listed.** A system's full roster is not
  leaked into a room its other faces never joined. Per-room face presence was a
  Kith feature (`GuildIdentities`) and it's kept.
- The card is identical for singlets minus the linked block — so there's one
  component, not two.
- "Verify encryption" (the safety-number compare) is per **account**, not per
  face, because keys are per account. The card says so in one line, since it's
  exactly the sort of thing that's confusing otherwise.
- Colour is the face's colour from the candy palette, everywhere and
  consistently: name, avatar ring, bubble tint, member-list row.

### Member list

Rooms list **faces that are present**, not accounts. For an unlinked account
that's simply several independent-looking people, which is the point. For a
linked account with several faces present, they're grouped under one subtle
header using the owner's own label. Grouping is a rendering choice made from the
encrypted `room.faces` event — the server does no grouping and knows nothing.

## Part 2 — Agents are labelled "Agent", not "friend"

Not every bot is a friend. A moderation bot, a CI notifier, and a companion are
all agents, and calling them all "friend" is both inaccurate and a bit
patronising.

### The badge system

Every agent account carries an **agent-class badge at all times**. This is not
optional and not removable — it's the visible half of "no ghost readers".

The *label on it* is chosen by the agent's owner from a fixed set:

| Label | For |
| --- | --- |
| **Agent** | the default. Anything that acts on its own behalf. |
| **Bot** | plain automation — notifiers, CI, webhook-ish things. |
| **Friend** | a companion account, someone's computer friend. Opt-in, never automatic. |
| **Assistant** | a helper the user drives. |
| **Companion** | a persistent character (an Ayusami persona, say). |
| **Service** | infrastructure — a translator, a transcriber, an archiver. |

Rules on the set:

- **Fixed vocabulary in v1**, no free text. A custom label is a
  human-impersonation vector, and "Verified" or "Staff" or a zero-width space are
  exactly what someone would try first. Custom labels can come later behind a
  blocklist and a length cap.
- **Every label renders in the same agent-badge style** — one distinct visual
  treatment, different word inside. So label choice changes the flavour and never
  the recognisability. You can tell it's software at a glance whether it says
  *Bot* or *Friend*.
- **A human can never wear one**, and an agent can never *not* wear one.
- Human accounts driving the API with a personal access token get a separate
  `automated` marker on those specific messages (Kith's behaviour, kept) — that's
  about the message, not the account.

### The line that actually matters

Below the badge, in the roster, every agent shows the same plain sentence:

> **can read this room**

Not customisable, not stylable, not removable, shown for every agent in every
room. The badge is flavour; this is the security statement. It's the sentence
that makes the whole "no ghost readers" promise checkable by a person rather
than by a cryptographer.

Adding an agent to a room uses the same flow as inviting a person, and the
confirmation says the same thing in bigger type: *"Translator will be able to
read everything in #design from now on."*

### What agents can't do

- Can't be in a room without appearing in its roster.
- Can't hide the "can read this room" line.
- Can't take a label implying humanity or authority.
- Can't read history from before they joined unless the room's history setting
  grants it — same rule as people.
