# Spaces — the UX

A **space** is a community (`16-terminology.md`). This covers creating, joining,
discovering and running one, plus what a host administrator sees.

## One host, many spaces

Stating this plainly because it's the thing Discord's vocabulary obscures:

> **A space is not a unit of hosting.** One Host runs any number of spaces. The
> hosted instance at `revel.chat` runs everybody's. A self-hoster's box can run
> one space or two hundred.

Concretely, from `04-data-model-and-protocol.md`: `spaces` is just a table on the
Host, `rooms.space_id` points into it. Creating a space is an INSERT and a
key-group setup — no provisioning, no container, no per-space server process.
That's a deliberate architectural property and it drives the UX:

- **Creating a space is instant and free.** No "request a server", no queue, no
  plan. You click, it exists.
- **Spaces are cheap enough to be casual.** One for a project, one for six
  friends, one for a game night. The rail is expected to hold a dozen.
- A self-hoster does not spin up "a server per community" — they run one Host and
  make spaces in it, the same as anyone.

The cost that *does* scale per space is the encryption groups (an MLS group per
audience, `03` §4/§5), which is why the group-size ceiling is documented and the
UI refuses adds past it rather than degrading silently.

## Creating a space

Deliberately three fields and one screen:

```
   Name        [ Solexsis                 ]
   Icon        [ drop an image, or pick a colour ]
   Who's it for
     ( ) Just the people I invite            ← default
     ( ) Anyone with the link
     ( ) Listed publicly on revel.chat
```

Everything else — rooms, roles, audiences — is created with sane defaults and
changed later. A new space arrives with `#general`, an `@everyone` role, one
audience ("everyone in this space"), and you in it. No wizard.

**The host line.** Under the form, quiet: *"This space will live on
revel.chat."* With a **Change** link for people running their own Host. That is
the only time hosting is mentioned, and it's a real choice with a real
consequence, so it's stated once and then dropped.

**Honest limit, surfaced when it matters:** a space lives on exactly one Host and
**cannot be moved** — no federation means no migration path. Moving a community
to another Host means making a new space there and inviting people across;
history stays behind, because history is encrypted to a key-group whose event log
lives on the old Host. This is written into the *Change* flow, not buried in a
FAQ, because someone choosing a self-hosted box for their community deserves to
know it's a one-way door.

## Joining

**By invite link** — the primary path. `revel.chat/i/<code>#<key>` where the
fragment carries the key material and never reaches the server (`03` §4, the
Wormhole trick). The landing page shows space name, icon, member count, and who
invited you, then one button. If you're not signed in, the invite is stashed and
survives sign-up.

**By discovery** — opt-in only. A space is invisible unless it chose to be
listed. The directory is a plain searchable list, no algorithmic ranking, no
"trending", no engagement surface. It is a phone book, not a feed.

**What a join actually does, said once on the invite page:** *"You'll be able to
read messages sent from now on"* — or *"…and everything sent before"* if the
space grants history. That single line is the history-mode setting made visible
at the only moment anyone cares.

## Space settings — the IA

One modal, left-hand tabs, ordered by how often they're touched:

| Tab | Holds |
| --- | --- |
| **Overview** | name, icon, description, who-it's-for, the public listing toggle |
| **Rooms** | list, reorder, categories, create/delete, per-room settings |
| **People** | members, their roles, search, kick/ban, pending invites |
| **Roles** | the role list and the permission editor |
| **Who can see what** | audiences — the crypto boundary, below |
| **Invites** | active links, uses remaining, expiry, revoke |
| **Moderation** | reports queue, ban list, purge log |
| **Danger** | transfer ownership, delete space |

### Roles and permissions

Kith's model, ported (`04` §4). The editor is a list of permissions with
toggles, grouped, with a plain sentence under each rather than a bare flag name.
Hierarchy is enforced and *explained* at the point of failure: you cannot grant a
permission you lack, and the UI says why rather than greying out mysteriously —
*"You can't grant Ban members because you don't have it."*

### "Who can see what" — audiences without saying MLS

The hard one. A room's audience is its encryption group; the crypto boundary is
the audience, and finer permissions are server-enforced policy, not
confidentiality (`03` §4). Users must not be misled about which is which.

The UI never says "MLS", "epoch", or "key group". It says:

```
  Who can see #staff-only

    ( ) Everyone in this space
    (•) People with a role:   [ Mod ] [ Admin ]  +
    ( ) Only people I pick

  ─────────────────────────────────────────────
  Everyone listed above holds the keys to this room.
  Other permissions — who can post, who can pin — are
  rules this space enforces. This one is the lock itself.
```

That last block is the whole distinction in three lines, at the point of
decision. **Audience is immutable after creation** (no re-encryption story for a
populated room), so the picker is disabled afterwards with: *"To change who can
see a room, make a new one — the messages in here were encrypted for the people
above and that can't be rewritten."*

Keeping the tier set small is a v1 constraint, so the UI nudges toward reusing an
existing audience: picking roles that match an existing group says *"same as
#mod-chat"* rather than silently creating a second group.

### Moderation

Everything mods can do, they can do because they're members who can read the
room. There is no god view, and the moderation tab says so once.

- **Reports** arrive via franking (`03` §9): a reporter's client attaches proof
  that a specific message is genuine, so a mod sees the reported message and can
  trust it wasn't fabricated — without gaining access to anything else. The queue
  shows the message, reporter, and time, with Dismiss / Delete / Kick / Ban.
- **Purge** deletes bytes on the Host and sends an in-band redaction. The UI is
  honest: *"This removes it from the server and from everyone's app. People who
  already read it may have kept it."*
- **Ban** is hierarchy-checked, owner-unbannable, and survives rejoin.
- **No automod**, and the tab says why in one line, linking to the threat model
  rather than apologising for it.

## The host admin surface

For self-hosters. A separate, deliberately boring screen at `/admin`, available
to the Host operator, **not** to space owners.

```
  Host        revel.example            up 14 days
  Spaces      12          Rooms  148       Accounts  61
  Storage     4.2 GB of 50 GB used
  Providers   accepting: revel.chat, cool.town, *
  Queues      push 0 pending · webhooks n/a
```

Plus: per-space storage and member counts, invite/registration controls, blob
retention policy, accepted-IdP allow-list, and the group-size ceiling.

**What it deliberately cannot show:** messages, room names, member display names,
who talked to whom in a room. The admin page says this out loud —

> *There is no message browser here. The server stores ciphertext it can't read,
> so there is nothing for this page to show you. That's the product working.*

— because a self-hoster arriving from a Matrix or Mastodon background will look
for it, and the absence should read as design rather than an unfinished feature.
