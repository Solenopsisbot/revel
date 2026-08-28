# Agents — the full lifecycle

`11-people-and-agents.md` covers how agents are *displayed*. This is how one
comes to exist, gets keys, joins rooms, and gets taken away again.

This is the surface where "computer friends are people" either becomes real or
stays a slogan, and it's also the one Kith explicitly left unfinished ("we need
an agent SDK", `e2ee-design.md` §14 open question). So it's designed properly
here.

## The shape of the problem

Under E2EE there is no such thing as a stateless webhook bot — the server has no
plaintext to POST (`03` §8). An agent must be a **key-holding member**. Which
means an agent is not a config entry; **it's an account with a device**, and the
device is a process someone runs.

That's more setup than "paste a webhook URL", and pretending otherwise would be
dishonest. The design job is to make the extra step feel like a normal thing
rather than a research project.

## Creating an agent

From your own account: **Settings → Agents → New agent**. Three fields, all
changeable later.

```
   Name        [ Translator            ]
   Label       [ Service ▾ ]              ← the fixed vocabulary from doc 11
   Avatar      [ pick a colour or image ]
```

Creating it mints a **separate account** with its own keypair, owned by you.
Two things are said at this moment, once:

> This is a real account with its own keys. You own it, you can delete it, and
> it will appear in the member list of every room you add it to.
>
> It needs somewhere to run — the next step.

## The agent host

The daemon that holds the agent's device key and speaks the protocol
(`02-architecture.md`). One binary, three ways to run it:

| | For |
| --- | --- |
| **On your computer** | trying it out, personal bots, a persona running on your own laptop |
| **On a server you control** | anything that should be online when your laptop isn't |
| **Alongside a self-hosted Host** | the natural home for a community's own agents |

The setup screen gives a copy-paste command and a **pairing code**:

```
   Run this where the agent should live:

     revel-agent pair 4K7M-XN2A

   Waiting for Translator to connect…            [ still waiting ]
```

Pairing is **the same device-enrolment flow people already have** (`17`): the
agent host generates its own device key, the pairing code carries a one-time
channel, your client signs the device certificate with the *agent's* account key
(which your client holds, because you own the agent), and the host receives the
account key sealed to it. No token pasting, no secret in an env var, and the
credential never travels through a copy-paste buffer.

Once connected the screen flips to a normal device row: name, platform, last
seen, sign out.

## Bot logic talks to localhost, in any language

The agent host holds keys and speaks the protocol; **your code doesn't have to**.
It exposes a plain local API:

```
  ws://127.0.0.1:7700/events     decrypted events, as JSON, as they arrive
  POST /rooms/:id/messages       send
  POST /events/:id/annotations   annotate (translations, transcripts, notes)
  POST /events/:id/reactions     react
  GET  /rooms                    what it's in
```

Plaintext on the loopback interface, ciphertext everywhere else. This is what
makes an Ayusami persona a twenty-line integration: Python reads events off a
websocket, calls `responder.generate_reply`, POSTs the result. No crypto in the
bot, no MLS in the bot, no keys in the bot.

Bound to loopback only, with a token in a file the host writes at pair time —
anything on the machine that can read that file can act as the agent, which is
the same trust boundary as an SSH key and is stated plainly in the docs.

## Adding an agent to a room

Same flow as inviting a person, with one extra sentence that is the whole "no
ghost readers" promise made concrete at the moment it matters:

> **Translator will be able to read everything in #design from now on** — and
> everything sent before it joined, because this room shares history with new
> members.
>
> It will appear in the member list. Anyone in the room can see it's there.
>
> [ Add Translator ]   [ Cancel ]

The second clause is generated from the room's actual history setting, so it
tells the truth per room rather than reciting a general disclaimer.

Removing is symmetrical and honest about the limit: *"Translator won't be able to
read anything sent from now on. It keeps whatever it already received — that
can't be taken back."*

## When the agent host is offline

Agents are devices, and devices go away. The room shows it plainly rather than
letting people wonder why the bot went quiet: the roster entry greys out with
*"not connected — last seen 2 hours ago"*, exactly as a human's device would.

Messages sent while it was away are still readable when it returns, subject to
the same history rules as anyone — MLS doesn't require presence to receive, only
to *commit*. Which leads to the one genuine operational wrinkle:

**An agent can be a committer.** Because agents are often the most reliably
online member of a room, a key-holding agent is an excellent designated
committer for MLS proposals (`03` §5). Where one exists, it takes that job. It's
a real benefit of the key-holding model and it costs nothing to arrange.

## Permissions

Agents pass the same permission checks as humans — no separate "bot permissions"
concept (the Kith property worth keeping). `MANAGE_AGENTS` gates who may add or
remove them in a space. An agent's roles are set the same way anyone's are.

Practical consequence worth stating in the UI: **an agent cannot do anything its
roles don't permit**, so a misbehaving bot is bounded by the same machinery that
bounds a misbehaving person, and the fix is the same — change its roles, or kick
it.

## What we deliberately do not offer

**A hosted key-holding runtime.** "We'll run your bot for you" would mean us
holding the agent's keys, which means us being able to read every room it's in.
That is precisely the ghost reader we promise doesn't exist, and no amount of
policy language would make it not be one.

So the honest position, stated in the docs rather than buried: **if you want an
agent, you run it.** The binary is small, it runs on a Raspberry Pi, and the
self-host path exists for exactly this. If that's too much, the answer is that
this product can't give you the thing you want without lying about it.
