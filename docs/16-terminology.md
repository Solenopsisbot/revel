# Terminology

The nouns, settled. These appear in every doc, every label, and every piece of
copy, so getting them wrong is expensive and getting them *inconsistent* is
worse.

## The decision

| Noun | What it is | What it is **not** |
| --- | --- | --- |
| **Host** | A running server — the software. Holds many spaces. `revel.chat` is one; your box is another. | Not a community. Users mostly never say this word. |
| **Space** | A community. Has rooms, members, roles. What a Discord user calls "a server". | Not a server, not a machine, not a unit of hosting. |
| **Room** | A single conversation channel inside a space. Also what a DM is, structurally. | Not a "channel" in copy — see below. |
| **Thread** | A branch inside a room. | Not a room. |
| **Identity provider (IdP)** | Where your account and handle live. | Not where your messages live. |
| **Account** | The keypair that is you. | Not a "profile" and not a face. |
| **Face** | One of the ways an account appears. | Not an account, not an "identity" in copy. |
| **Device** | One enrolled client holding a device key. | Not a session. |
| **Agent** | An account that is software. | Not a "bot" unless its owner picked that label. |

## Why "space" and not "server"

This is the one that matters, and it's the reason not to just copy Discord.

**We are a self-hostable product where "server" already means a server.** Discord
could get away with calling a community a "server" because you can't run one; the
word was free. Here it isn't. A user reading *"your server is on our servers"* or
*"move your server to another server"* is being actively misled by our own
vocabulary. When someone self-hosts, the ambiguity becomes a support burden
forever.

So: a **Host** is a server. A **Space** is a community. One Host holds many
spaces — see `18-spaces-ux.md`.

Rejected alternatives:

- **Server** — collides with the actual thing, as above. Fatal for this product.
- **Guild** — Discord's internal API term. Gamey, and nobody says it out loud.
- **Community** — accurate but four syllables and slightly civic-worthy; "join a
  community" is heavier than "join a space".
- **Place / Hall / House** — cute, and cute core nouns age badly. The most-used
  noun in the product should be boring.

**Space** is neutral, short, verbs cleanly ("your spaces", "leave the space"),
and is already the Matrix term for roughly this concept, so a chunk of the
target audience reads it without instruction.

> If this gets overruled later it's a rename of one word across the docs, the
> UI strings, and the schema's `spaces` table. Cheap now, expensive after launch.

## Why "room" and not "channel"

"Channel" is Discord/Slack vocabulary and would be fine, but **room** does
double duty: a DM, a group DM and a space channel are the *same object* in our
data model (`04-data-model-and-protocol.md`) — one MLS group, one event log. One
noun for one thing. It also fits the spatial metaphor the whole product runs on,
and it's what the encryption docs already say.

Copy uses "room" everywhere. `#design` is a room. Your DM with Ash is a room.

## Casing and formatting in UI copy

- Nouns are lowercase in running copy: "create a space", "this room", "your
  faces". Capitalised only when they start a sentence or label a UI section.
- **Never** capitalise for emphasis ("your Space"). It reads as a product trying
  to trademark a common word.
- The address form is `viola@revel.chat` — see `17-identity-ux.md`.
