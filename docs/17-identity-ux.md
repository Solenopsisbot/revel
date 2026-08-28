# Identity, accounts, and devices — the UX

The architecture is in `03-identity-and-crypto.md`. This is what a person
actually sees and does. The whole challenge: **an identity system with real
sovereignty in it, that a normal person never has to think about.**

## The governing rule

> **Nobody is asked to understand identity providers in order to sign up.**

The default path mentions the concept exactly once, in a line most people will
skim, and everything still works. The sovereignty is *available*, not compulsory.
A system that makes you make a decision you have no basis for is not giving you
freedom; it's offloading a design problem onto the user. Matrix's homeserver
picker at signup is the canonical example of getting this wrong.

## Sign-up: what you actually see

```
   Pick a handle
   ┌──────────────────────────────┐
   │ viola                        │ @ revel.chat  ▾
   └──────────────────────────────┘
   Your address will be viola@revel.chat
```

- The handle field is the hero. The `@ revel.chat` part is a **quiet dropdown**
  next to it, pre-filled, that most people will never touch.
- Opening it shows: *Revel (recommended)*, any IdPs you've used before, and
  **"Use another provider…"** with a plain-language line: *"Your handle and your
  account backup live with a provider. Your messages never do. You can move
  later without losing anything."*
- That's it. One sentence, at the moment of relevance, and no further mention.

## Your address, and how it's displayed

`viola@revel.chat` — email-shaped, per the ratified decision.

**Display rule:** show the bare handle (`viola`) when the viewer is on the same
IdP as the person; show the full address (`ash@cool.town`) when they aren't.
Consequences:

- On the hosted instance, which is nearly everyone, addresses look like plain
  usernames and the federation-shaped complexity is invisible.
- The moment a foreign account appears in a room, its provider is visible —
  which is exactly when you'd want to know.
- **Handles are not unique across IdPs.** Two different people can both be
  `viola`. So the *full address* is the identifier everywhere it matters —
  invites, mentions that resolve to a specific person, blocking, verification.
  The bare handle is a display convenience, never a key.

## The provider is not the point — a place to say so

Settings → Account shows a small block:

```
  Your provider          revel.chat            [ Move… ]
  What lives there       your handle, your encrypted account backup,
                         your device list
  What doesn't           your messages, your rooms, your keys
```

Three lines. It answers the question people actually have — *what does this
thing know about me* — without a lecture, and it's the only place the concept
is explained at any length.

## Moving provider

Rare, but it is the entire sovereignty claim, so it must be real and legible.

1. Settings → Account → **Move…**
2. Enter the new provider. We check it's reachable and accepts new accounts.
3. Explain the actual consequences, plainly:
   > Your account key doesn't change, so **your rooms, your history and your
   > contacts are unaffected** — nobody has to re-add you. Your address changes
   > from `viola@revel.chat` to `viola@cool.town`, and mentions of your old
   > address will still resolve for as long as the old provider keeps serving
   > the forwarding record.
4. Confirm with the account key (a rung-4 Wren popup — it's irreversible-ish).
5. Everything continues. A system message in your DMs notes the change so
   contacts aren't confused by the new address.

**Honest limit, stated in the flow:** if your old provider vanishes entirely
rather than cooperating, the forwarding record dies with it. Your account still
works — your key is your key — but people who only knew your old address have to
be told the new one, the same as changing an email.

## When the provider is down

This must not take the product with it, and architecturally it doesn't:

| Still works | Broken |
| --- | --- |
| Every enrolled device keeps sending and reading. Hosts cache the device list and certificates. | Signing in on a **new** device. |
| Rooms, history, calls, everything. | Enrolling a device, revoking one, changing password. |
| Foreign accounts already known to the Host. | First-time resolution of an unseen handle from that provider. |

UI: a quiet banner in settings, not a modal, not a red bar over the chat.
*"revel.chat isn't reachable right now. Messaging is unaffected — you just can't
add a device until it's back."* This is a Wren rung-1 notice, not an alarm.

## Devices — the management screen

Settings → Devices. One row per device: name, platform, **last seen**, and
whether it's this one.

```
  This device      laptop · macOS · now
  Phone            iPhone · 2 hours ago                    [ Sign out ]
  iPad             iPadOS · 94 days ago                    [ Sign out ]
  Agent host       Linux · 5 minutes ago    Agent: Kiko    [ Sign out ]

  [ Add a device ]                    Show fingerprints ▾
```

- **"Sign out" not "Revoke".** The word people know, doing the cryptographically
  serious thing underneath. The confirmation says what actually happens: *"Phone
  won't be able to read anything sent from now on. It keeps whatever it already
  downloaded — that can't be taken back."* That last clause is the un-ringable
  bell from the threat model, said plainly.
- Fingerprints are collapsed by default. People who want them know what they are.
- Stale devices (90+ days) get a muted row and a Wren notice, never a nag.
- Agent hosts appear here too, labelled with the agent they run, because they
  are devices holding keys and hiding that would be dishonest.

## Multiple accounts — and why it isn't "faces"

These are two different things and conflating them would be a serious UX failure:

| | **Faces** | **Accounts** |
| --- | --- | --- |
| What | ways one account appears | genuinely separate identities |
| Keys | one keypair | one keypair **each** |
| Shared | permissions, rooms, devices, history | nothing |
| Who it's for | plural systems; anyone wanting a different presentation | work vs personal; an alt nobody can link to you |
| Switching | in the composer, per message | whole-app, like logging into another account |

**Cryptographically unlinkable is the point of multi-account.** Two accounts on
the same device share no key material, and nothing in the protocol connects them.
If we ever added a "switch account" affordance that leaked a correlation — shared
push tokens, a common device identifier presented to the Host — we would have
quietly broken the promise. Account switching therefore uses **separate device
keys, separate sessions, separate push subscriptions**.

UI: the account switcher lives at the bottom of the rail, showing the current
account's avatar; clicking gives a list plus "Add an account". Switching is a
full context swap with a brief transition, not a merge. **There is no unified
inbox across accounts** — that would be the correlation leak in convenience form,
and it's worth the inconvenience to not have it.

## Verification, without the ceremony

Comparing safety numbers is the fallback, not the main event (key transparency,
`03` §2, is the primary defence). So:

- The profile card has **Verify encryption** — never a nag, never a badge of
  shame for unverified contacts. Unverified is the normal state and the UI treats
  it as normal.
- The compare screen shows a 60-digit number and a QR, with one line: *"If these
  match on both screens, nobody is in the middle. If you're together, scan. If
  not, read it out — an attacker would have to fake your voice in real time."*
- Verification is per **account**, not per face, and the screen says so, because
  it's exactly the thing a plural user would otherwise wonder about.
