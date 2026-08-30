/**
 * The handshake surface: how two people ever end up in the same MLS group.
 *
 * Everything in `envelope.ts` assumes a group already exists and both ends
 * already hold its keys. This is the part that gets them there — key package
 * supply, claiming, the handshake log, Welcome delivery — and it is the one
 * place the server touches cryptographic material at all.
 *
 * ## The server still parses nothing
 *
 * Every `bytes` field here is base64 of an MLS structure the server never
 * decodes. It routes them, orders them, and refuses the ones that arrive at the
 * wrong epoch. That is enough to make delivery work and not nearly enough to
 * forge a roster: `docs/03` §5 requires every client to validate that the tree
 * only ever changed through proposals it saw and commits signed by a member, so
 * a lying server produces a group nobody can open rather than a group it can
 * read.
 *
 * Read that as the security posture for this whole file. Fields like `added`
 * and `removed` below are **delivery hints** — the server uses them to decide
 * who to fan out to, never to decide who is in the group.
 */
import { z } from 'zod';
import { AccountId, DevicePub, Snowflake } from './ids.js';

// ---------------------------------------------------------------------------
// Key packages
// ---------------------------------------------------------------------------

/**
 * A device's shelf of one-time key packages, plus the last-resort one.
 *
 * `docs/03` §5: every device keeps ≥ 20 at the IdP and replenishes on connect.
 * One-time means one-time — the private half is erased by the join that
 * consumes it, so a device that reuses one has given up forward secrecy for
 * that add. The last-resort package exists so that running dry degrades to
 * "weaker forward secrecy, logged" rather than "you cannot be added to
 * anything until you next open the app".
 */
export const KeyPackageUpload = z.object({
  packages: z.array(z.string().base64().max(65536)).max(200),
  lastResort: z.string().base64().max(65536).optional(),
});
export type KeyPackageUpload = z.infer<typeof KeyPackageUpload>;

/** What is left on the shelf. A device polls this to know when to top up. */
export const KeyPackageSupply = z.object({
  available: z.number().int().nonnegative(),
  lastResort: z.boolean(),
});
export type KeyPackageSupply = z.infer<typeof KeyPackageSupply>;

/**
 * Claim key packages for the accounts about to be added.
 *
 * By account, not by device: you add a *person*, and `docs/03` §1's per-device
 * leaves mean every one of their devices needs its own package. Making the
 * caller enumerate devices would also make it possible to target one.
 */
export const ClaimRequest = z.object({ accounts: z.array(AccountId).min(1).max(200) });
export type ClaimRequest = z.infer<typeof ClaimRequest>;

export const Claim = z.object({
  account: AccountId,
  device: DevicePub,
  keyPackage: z.string().base64(),
  /**
   * True when the shelf was empty and the reusable package was handed out.
   *
   * Surfaced rather than hidden because it is a real, if small, downgrade, and
   * because a device that sees this about itself should replenish immediately.
   */
  lastResort: z.boolean(),
});
export type Claim = z.infer<typeof Claim>;

export const ClaimResponse = z.object({
  claims: z.array(Claim),
  /** Accounts with no device that could supply one. Not an error — add the rest. */
  missing: z.array(AccountId),
});
export type ClaimResponse = z.infer<typeof ClaimResponse>;

// ---------------------------------------------------------------------------
// The handshake log
// ---------------------------------------------------------------------------

/**
 * `proposal` or `commit`, and deliberately not `welcome`.
 *
 * `docs/04` §1 sketches one table with all three kinds, but a Welcome is
 * addressed to specific devices and everything in this log is fanned out to
 * every member. Putting them together would either broadcast a Welcome to
 * people it is not for or make the log conditional per reader. They are two
 * tables (`group_welcomes` is the other) for that reason.
 */
export const HandshakeKind = z.enum(['proposal', 'commit']);
export type HandshakeKind = z.infer<typeof HandshakeKind>;

export const WelcomeInput = z.object({
  /**
   * One Welcome covering everyone this commit added — MLS emits a single
   * message, not one per leaf, so these are the same bytes rowed per device
   * (`docs/31`: a batched add of 500 puts 500 members' secrets in this one).
   */
  bytes: z.string().base64().max(1_400_000),
  /**
   * Who it is for. Checked against the claims made for this group: a member
   * cannot push arbitrary bytes at a device that was never being added.
   */
  devices: z.array(DevicePub).min(1).max(500),
});
export type WelcomeInput = z.infer<typeof WelcomeInput>;

export const HandshakeInput = z.object({
  kind: HandshakeKind,
  /**
   * The epoch this was built **from**, not the one it produces.
   *
   * This is the whole commit-race mechanism. Two devices that both build on
   * epoch 4 both send `epoch: 4`; the server advances to 5 for whichever
   * arrives first and refuses the other with the epoch it actually reached.
   * The loser has lost nothing — it never applied its own commit — so it
   * clears staged changes, catches up, and rebuilds (`CryptoEngine.commit`).
   */
  epoch: z.number().int().min(0),
  bytes: z.string().base64().max(350_000),
  /** Commit only. Stored per device and served on that device's next connect. */
  welcome: WelcomeInput.optional(),
  /** Delivery hints. See the note at the top of this file. */
  added: z.array(DevicePub).max(500).optional(),
  removed: z.array(DevicePub).max(500).optional(),
});
export type HandshakeInput = z.infer<typeof HandshakeInput>;

export const HandshakeRecord = z.object({
  group: Snowflake,
  /** Per group, monotonic, gapless. A client catches up with `?since=`. */
  seq: z.number().int().nonnegative(),
  kind: HandshakeKind,
  epoch: z.number().int().min(0),
  /**
   * The device that sent it, or `server` for an external-sender proposal.
   *
   * `docs/03` §5 configures the Host as an MLS external sender so it can
   * propose an Add or Remove on a membership change. It can propose; it cannot
   * commit, and a client checks that rather than taking this field's word.
   */
  sender: z.union([DevicePub, z.literal('server')]),
  bytes: z.string().base64(),
  createdAt: z.number().int(),
});
export type HandshakeRecord = z.infer<typeof HandshakeRecord>;

/** What a commit produced, once the server accepted it. */
export const HandshakeAccepted = z.object({
  seq: z.number().int().nonnegative(),
  /** The epoch the group is now at. One higher than the input for a commit. */
  epoch: z.number().int().min(0),
});
export type HandshakeAccepted = z.infer<typeof HandshakeAccepted>;

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export const GroupInfo = z.object({
  id: Snowflake,
  epoch: z.number().int().min(0),
  /**
   * Who the server will nudge to commit: `docs/03` §5's designated committer,
   * the online device of the group that most recently sent something.
   */
  committer: DevicePub.nullable(),
  /** How many proposals are waiting for a commit to sweep them up. */
  pendingProposals: z.number().int().nonnegative(),
  /** Devices the server believes are in the group. A delivery hint. */
  size: z.number().int().nonnegative(),
  /**
   * Rooms this group's keys open, filtered to the ones the asker may read.
   *
   * The reverse of `rooms.group_id`, and a joiner cannot work without it: a
   * Welcome carries a group id and nothing else, so without this a device that
   * has successfully joined a group has no idea which conversation it just
   * gained the ability to read.
   */
  rooms: z.array(Snowflake),
});
export type GroupInfo = z.infer<typeof GroupInfo>;

/**
 * A pending Welcome, waiting for its device to come back.
 *
 * `docs/03` §5: "the Host stores the Welcome for each added leaf and serves it
 * on that device's next connect." A device invited while offline finds it
 * here; the alternative is an invite that silently expires because nobody was
 * looking.
 */
export const PendingWelcome = z.object({
  group: Snowflake,
  bytes: z.string().base64(),
  createdAt: z.number().int(),
});
export type PendingWelcome = z.infer<typeof PendingWelcome>;

/**
 * The public ratchet tree, fetched separately from the Welcome.
 *
 * `docs/03` §5 rejects the `ratchet_tree` extension, and `docs/31` §2 has the
 * numbers: inlining it makes a single join at 2,000 members cost 627 KiB
 * instead of 0.4 KiB. Out of band it is one cacheable fetch per epoch that
 * every joiner shares.
 */
export const RatchetTree = z.object({
  epoch: z.number().int().min(0),
  tree: z.string().base64(),
});
export type RatchetTree = z.infer<typeof RatchetTree>;
