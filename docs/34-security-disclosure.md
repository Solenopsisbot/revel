# Security disclosure

`docs/29` §6 asks for four cheap things that are conspicuous by their absence.
Two of them are code and are done; two are commitments, and commitments are not
mine to write.

Everything here was decided on 2026-08-31. There are no brackets left, which
is the point: a disclosure policy with a `[decide]` in it is worse than no
policy, because it advertises that nobody is on the other end.

| `29` §6 asks for | Status |
| --- | --- |
| `/.well-known/security.txt` | Built, served, and pointed at the page below. |
| A written disclosure policy | Published at `/security`. This document is the reasoning behind it. |
| Signed authorisation letters | Not built. Kith's `authz.md` ports directly. |
| A published threat model | Written (`03` §10). Needs to be a page, not a doc. |

---

## How to report

Email **security@revel.chat**. It reaches a person, not a queue.

Include what you did, what happened, and what you expected. A rough
reproduction beats a polished write-up; we would rather read four sentences
today than a PDF next month.

If a report is sensitive enough that email is not good enough, say so in an
empty message and we will find another channel. Do not sit on something because
the channel is imperfect.

## What we commit to

- **We will acknowledge within 72 hours.** That is a human saying "we have
  it", not a fix.
- **We will tell you what we think within 7 days** — including "this is not a
  bug, and here is why", which is a real answer and one you are owed.
- **We will tell you when it is fixed**, and what the fix was.
- **We will credit you** by whatever name you give us, or not at all if you
  prefer. See below.
- **We will not threaten you.** Not with lawyers, not with law enforcement, not
  with a strongly-worded letter. Reporting a vulnerability in good faith is a
  thing we asked you to do.

## What we ask

- **Give us 90 days before you publish**, and the clock does not stop. We can
  ask for more time and explain why; you can say no. A deadline a vendor is
  allowed to pause is not a deadline, and every disclosure programme that
  quietly acquired one became a way of never shipping the fix.
- Do not access, modify or keep anybody else's data. If you need to prove a
  bug touches real data, tell us and we will make you an account that is
  allowed to.
- Do not degrade the service for other people. No load testing, no denial of
  service, no spam.
- Stay inside the systems we run. Third-party services we happen to use are not
  ours to authorise, and neither are other people's self-hosted instances —
  which is most of them.

## Scope

**In scope:** the hosted Host and IdP, the official clients, this repository,
and the protocol itself. A flaw in the design is worth more than a flaw in the
code and is explicitly wanted.

**Out of scope**, and stated plainly so nobody wastes an afternoon:

- Anything that requires an attacker who already controls a user's device. That
  is not a boundary this design defends and never claimed to be.
- Metadata the server is *documented* to hold (`03` §7 has the list). If you
  think the list is wrong, that is a design report and very much in scope.
- Rate limits, missing security headers, and reports whose entire content is a
  scanner's output.
- Somebody else's self-hosted instance. Ask them.

## Credit, not money

**There is no bug bounty.** It costs money that does not exist yet, and a badly
funded bounty is worse than none: it sets a price on a thing and then fails to
pay it.

What there is instead: public credit, by name or handle or anonymously, in
`SECURITY-CREDITS.md` at the root of this repository. A file rather than a page,
because a page needs somebody to maintain a site and a file needs somebody to
open a pull request — and a credit list that is one commit away from being
updated is one that actually gets updated. It can move to a page later without
breaking the promise. If a bounty ever appears, everything already reported is
eligible retroactively; that is easy to promise and cheap to keep.

## Authorisation letters

Kith built something worth porting: an **Ed25519-signed document** stating that
a named person is permitted to test named systems between named dates,
verifiable in a browser, which **the server never sees and never enforces**.

The point is that it is for the researcher, not for us. Somebody doing
authorised testing can hold a thing they can show to an employer, a lawyer, or
an upstream provider, and it does not depend on us being reachable or still
existing when they need it.

Not built here yet. `docs/29` §6 lists it; the Kith implementation ports
directly.

## Decisions still needed

None. All five are made, and this is what they came out as:

1. **The contact address** — `security@revel.chat`.
2. **Acknowledgement and response times** — 72 hours to acknowledge, 7 days for
   an assessment.
3. **The disclosure window** — 90 days, and the clock does not stop.
4. **Where credit is published** — `SECURITY-CREDITS.md` in this repository.
5. **A PGP key** — no. Most reporters will not use one, and publishing a key
   nobody has the private half of the habit for is a way of looking prepared
   rather than being reachable. The offer of another channel on request is the
   part that actually helps.

## What is published where

- **`/security`** — the policy, in the product's voice, for somebody who has
  just found something. `apps/web/src/routes/security/+page.svelte`.
- **`/.well-known/security.txt`** — RFC 9116, served only when
  `REVEL_SECURITY_CONTACT` is set, with `Policy:` pointing at the page above.
  See `.env.example`.
- **`SECURITY-CREDITS.md`** — the credit list, at the root of this repository.
- **This document** — the reasoning. Every commitment on the page has one here,
  which is the difference between a policy and a promise somebody can argue
  their way out of later.
