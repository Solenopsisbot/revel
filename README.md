# Revel

A chat platform where the server is a blind relay.

Every room is end-to-end encrypted — no cleartext path, no exceptions, no
"enterprise mode" that turns it off. Plural systems and AI agents are members,
not features. And anything that can read a room is visible in that room's member
list, because a promise you can't check isn't a promise.

> **Status: early.** The design is complete and the crypto core has begun. There
> is no usable application yet. See [`docs/06-roadmap.md`](docs/06-roadmap.md).

## What's here

| Path | |
| --- | --- |
| [`docs/`](docs/) | The full design — 32 documents. Start with [`docs/README.md`](docs/README.md). |
| [`crates/revel-crypto/`](crates/revel-crypto/) | The Rust crypto core: device certificates, MLS identity, benchmarks. |
| [`design/`](design/) | A zero-build design reference. Open `design/index.html` in a browser. |

## The shape of it

- **Host** — a server. Runs many **spaces** (communities), each with **rooms**.
- **Identity provider** — where your handle and encrypted account backup live.
  Separate from where your messages live, and you can move.
- **Account key → device certificates.** Your account signs each device in;
  every device is its own leaf in the MLS group, so signing one out actually
  cuts it off.
- **No federation.** A room lives on exactly one Host, which buys total ordering
  and avoids the distributed-systems problem that eats projects like this.

Vocabulary is deliberate — see [`docs/16-terminology.md`](docs/16-terminology.md)
for why a community is a "space" and not a "server".

## Running what exists

```sh
cargo test -p revel-crypto                                   # 9 tests
cargo run --release -p revel-crypto --example bench          # group scaling
cargo run --release -p revel-crypto --features pq --example bench_join
```

Measured results, including the ones that contradicted the design:
[`docs/31-phase0-results.md`](docs/31-phase0-results.md).

## Honest limits

Stated here because they're stated everywhere else too
([`docs/03-identity-and-crypto.md`](docs/03-identity-and-crypto.md) §10):

- **Anyone who can read a message can keep it.** Screenshots exist. Disappearing
  messages are a courtesy, not a guarantee.
- **Metadata is visible** to the server: who is in a room, when, how much.
- **The crypto is unaudited.** Parts of it — era encryption with anchor-split
  history, the device certificate hierarchy — are our own design, which is
  exactly where bugs live.
- **A web client can be backdoored on any load.** Until there are signed native
  builds, the honest claim is "encrypted against the server's data, not its
  code".

## Licence

[AGPL-3.0-or-later](LICENSE) for the server and clients. A modified version run
as a network service must publish its source — the clause that stops a closed
fork of an end-to-end encrypted product, where "closed" and "trustworthy" pull
against each other. Protocol and SDK crates will be Apache-2.0 so bots, clients
and bridges can be built freely. Reasoning in
[`docs/29-engineering-plan.md`](docs/29-engineering-plan.md) §2.

The name, the mark and the Wren artwork are not covered by that licence. Fork
the code freely; please don't ship something that claims to be Revel.

## Credit

Design inspiration, and the idea that a hosted instance should sell capacity
while self-hosting stays free, both came from **Noelle**. Thanks.
