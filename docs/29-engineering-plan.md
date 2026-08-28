# Engineering plan

The docs so far describe *what* to build. This is the set of decisions that
decide whether it survives contact with a second version of itself. Most of these
are nearly free to get right at the start and expensive-to-impossible to retrofit.

---

## 1. Protocol versioning — the urgent one

**Why it's urgent here specifically:** encrypted history **cannot be
re-encrypted**. Every message ever sent stays in the format it was sent in,
sealed, forever. There is no migration script, no backfill, no "we'll fix the
schema in v2 and rewrite the rows". Whatever v1 emits, v9 must still be able to
read.

That is a much harder constraint than a normal app has, and it is entirely
front-loaded: get it right once and it costs nothing forever.

**The rules:**

1. **Additive only within a major version.** New optional fields, new event
   types. Never repurpose a field, never change a field's meaning, never make an
   optional field required.
2. **Unknown fields are preserved and re-emitted.** A v1 client editing a v2
   message must round-trip the fields it doesn't understand rather than
   destroying them. This is the single most commonly skipped rule and the one
   that silently eats data.
3. **Unknown event types render a fallback**, never an error and never silence
   (`28`). The sender supplies a one-line plaintext summary inside the encrypted
   payload precisely so old clients have something honest to show.
4. **Every sealed format carries an explicit version byte** — the event envelope,
   the era-encryption blob, the key backup, the device certificate. One byte now
   saves an unversioned-format archaeology project later.
5. **The server never parses payloads**, so server-side compatibility is free.
   This is a real structural advantage of the opaque-log design and it should be
   protected: any temptation to have the server understand an event type is also
   a temptation to break this.

**The genuinely hard case: changing crypto.** A ciphersuite is fixed per MLS
group, so migrating means **creating a new group**, not upgrading one. Old
history stays readable under the old suite; new messages use the new one; the
timeline shows a seam. Write this down as the expected mechanism now, because the
post-quantum migration (`03` §12) is expected to trigger exactly this.

**Deprecation policy:** a major version bump means old clients get read-only
access to affected rooms with a clear message, never a silent failure. Nothing is
ever deleted because a client is old.

---

## 2. Licence — undecided, and it matters

Never discussed. For a self-hostable privacy product it's load-bearing: it
decides whether someone can run a closed, modified fork as a competing hosted
service.

**Recommendation, a split:**

| What | Licence | Why |
| --- | --- | --- |
| Server and clients | **AGPL-3.0** | A modified version run as a network service must publish its source. This is the clause that stops a closed fork of an E2EE product — where "closed" and "trustworthy" are in direct tension. Signal and Element both landed here. |
| Protocol spec, client SDK, agent SDK | **Apache-2.0** | People must be able to build bots, clients and bridges freely, including commercially. Copyleft here would strangle the ecosystem the product needs (`28`). |
| The mark, Wren, the name | **not open** | Reserved, so a fork can't impersonate the hosted instance. Forking the code is welcome; pretending to *be* Revel is not. |

The AGPL choice has a real cost — some companies won't touch it, and some
contributors dislike it. Worth accepting here, because the alternative is
"someone runs a proprietary fork and tells users it's private."

---

## 3. Observability without surveillance

An E2EE app that ships detailed telemetry has quietly undone its own argument.
But shipping *nothing* means debugging blind. The line:

**Server.** Structured logs with no payloads — there are none to log. But
metadata is still sensitive, so: no per-user request logs beyond what rate
limiting needs, short retention (days), aggregate counters rather than
per-account traces, and the retention policy published (`27` §7).

**Client crash reporting.** Off by default, opt-in, and **scrubbed at the
source** — a crash report must never carry event content, room names, handles,
keys or local-database contents. That means a hand-written scrubber, not
Sentry's defaults, because a stack trace can carry a decrypted message in a local
variable. Self-hosted collector (GlitchTip or similar); never a third-party SaaS
that would see what our own server can't.

**Metrics.** Aggregate only: version distribution, crash rate, sync latency
percentiles. Never anything that reconstructs a social graph.

**The test to apply to any new telemetry:** *would we be comfortable if this
were leaked in full?* If not, it doesn't ship.

---

## 4. Testing strategy

Kith reached 175 backend tests that needed no DB or network — worth reproducing.
What's new here is that the hard bugs are **distributed and stateful**.

| Layer | Approach |
| --- | --- |
| Pure logic | Ordinary unit tests: permissions, snowflakes, plurality/proxy tags, markdown node tree. |
| **Room reducer** | **Property-based.** Events applied in any order with duplicates and gaps must converge to the same state. This is where correctness actually lives. |
| Crypto core (Rust) | Known-answer tests, round-trips, and **adversarial** tests: tampered ciphertext, replayed events, forged commits, out-of-order handshakes, a malicious delivery service. |
| **Multi-client** | A harness that runs N in-process clients against a real server and scripts scenarios. **This is the one that would have caught Kith's bugs** — own-leaf commits, diverged sessions, Welcome lag, commit races, device revocation mid-conversation, offline/reconnect with queued sends. |
| Decoder | Fuzz the event decoder. It parses attacker-influenced bytes. |
| UI | Component tests for the message list and composer; the reference page is the visual check. |

**Every bug found in a real conversation gets a scenario in the multi-client
harness before it's fixed.** That harness is the project's actual safety net.

---

## 5. Performance budgets

The product claims "instant" (`05` §1). Claims need numbers, and numbers need to
be measured or they rot:

| Thing | Budget |
| --- | --- |
| Cold open → last room painted from local store | **< 300 ms** |
| Room switch (cached) | **< 100 ms** |
| Keypress → local echo of a sent message | **< 16 ms** |
| Message list scroll, 100k local events | **60 fps** |
| MLS commit, 200-member group | **< 500 ms** |
| Decrypt + render an incoming message | **< 50 ms** |

Measured in CI on a fixed machine where possible; the MLS numbers come out of the
Phase 0 benchmark (`26`) and get re-run whenever the crypto core changes.

---

## 6. Security process

Cheap, and conspicuous by its absence:

- **`/.well-known/security.txt`** with a real contact and policy (Kith had one).
- **A written disclosure policy**: how to report, what response time to expect,
  what we commit to. No bug bounty initially — it costs money — but public credit.
- **Signed authorisation letters** for anyone doing permitted security testing.
  Kith built this (`authz.md`): an Ed25519-signed document, verifiable in-browser,
  that the server never sees or enforces. It's a genuinely nice piece of work and
  it ports directly.
- **A published threat model** — already written (`03` §10); it just needs to be
  a page on the site rather than an internal doc.

---

## 7. The self-hoster's first run

Flagged as a gap twice and still unwritten. The target is that a competent
stranger gets a working Host in **under fifteen minutes**:

```
  docker compose up          # postgres + revel, migrations run on boot
  revel init                 # config, server keypair, first admin invite
```

Needs: a Compose file with sane defaults, TLS/reverse-proxy guidance, a
`revel doctor` that checks config, connectivity, storage and clock skew, a
backup-and-restore runbook with an actual restore test, and clear guidance on
which role(s) to run (`02`: Host, IdP, or both).

The admin surface exists (`18`), including the part that says why there's no
message browser. What's missing is everything before it.

---

## What this doc doesn't cover

Deliberately out of scope here and tracked in `27`: monetisation mechanics, the
abuse/regulatory policy, the audit, Discord migration tooling, i18n.
