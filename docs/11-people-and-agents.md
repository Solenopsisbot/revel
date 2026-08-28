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

### Linking faces — an explicit, off-by-default privacy control

Some systems are openly plural; some very much are not. So:

**"Link my faces publicly"** — off by default.

- **Off:** each face appears as an independent person. Nothing in the UI connects
  them. No badge, no shared profile, no "also known as". This is the safe default
  and it must stay the default.
- **On:** a face's profile card shows the account it belongs to and its other
  faces, and messages can carry a relationship badge whose **label the account
  owner writes themselves** — "same system", "same account", "alt", or nothing.

Because faces live inside the ciphertext (`03-identity-and-crypto.md` §7), this
is genuinely a privacy control and not a display preference: with linking off,
the server never learns the connection either, since it never sees faces at all.

### The profile card — "system information should be good"

Clicking any face opens one card, and it's the same card everywhere:

```
┌──────────────────────────────────────────┐
│  [avatar]  June                          │
│            she/her · mint                │
│            "does the actual work"        │
│                                          │
│  ── if faces are linked publicly ──      │
│  Part of  Viola's account                │  ← owner-written label
│  Other faces here:  [V] Viola  [A] Ash   │  ← only faces present in THIS room
│                                          │
│  ── always ──                            │
│  In this room since   12 March           │
│  Roles                Member, Designer   │
│  [ Message ]  [ Verify encryption ]      │
└──────────────────────────────────────────┘
```

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
