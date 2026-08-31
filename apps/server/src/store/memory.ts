/** In-memory Store. Used by the tests and by `revel dev`. */
import type { Event, HandshakeRecord, KeyPackageSupply, KeyPackageUpload } from '@revel/protocol';
import { compareIds } from '@revel/protocol';
import type {
  Account,
  Blob,
  Challenge,
  ClaimedPackage,
  Device,
  EnrolChannel,
  Enrolment,
  Group,
  GroupMember,
  GroupMemberInput,
  HandshakeAppend,
  HandshakeResult,
  LoginSession,
  Membership,
  Override,
  Role,
  Room,
  Session,
  Store,
  StoredPushSubscription,
  StoredWelcome,
  StoredWrap,
  TotpSecret,
} from './types.js';

/** One device's key package shelf. */
interface Shelf {
  packages: string[];
  lastResort: string | null;
}

/** An outstanding claim: a package taken for a group but not yet used by a commit. */
interface OutstandingClaim extends ClaimedPackage {
  groupId: string;
  devicePub: string;
}

export class MemoryStore implements Store {
  rooms = new Map<string, Room>();
  memberships = new Map<string, Membership>();
  roles = new Map<string, Role>();
  overrides: Override[] = [];
  owners = new Set<string>();
  devices = new Map<string, Device>();
  events = new Map<string, Event[]>();
  #nonces = new Map<string, Event>();

  async getRoom(id: string) {
    return this.rooms.get(id) ?? null;
  }

  async createRoom(room: Room, members: string[]) {
    const existing = this.rooms.get(room.id);
    if (existing) return { room: existing, created: false };

    this.rooms.set(room.id, room);
    for (const accountId of members) await this.addMember(room.id, accountId);
    return { room, created: true };
  }

  async listAccountRooms(accountId: string) {
    const out: Room[] = [];
    for (const membership of this.memberships.values()) {
      if (membership.accountId !== accountId) continue;
      const room = this.rooms.get(membership.roomId);
      if (room) out.push(room);
    }
    return out;
  }

  async listRoomMembers(roomId: string) {
    return [...this.memberships.values()].filter((m) => m.roomId === roomId);
  }

  async addMember(roomId: string, accountId: string, roleIds: string[] = []) {
    this.memberships.set(`${roomId}:${accountId}`, { roomId, accountId, roleIds });
  }

  async removeMember(roomId: string, accountId: string) {
    this.memberships.delete(`${roomId}:${accountId}`);
  }

  accounts = new Map<string, Account>();
  /** handle (folded) -> account id. The uniqueness constraint, made explicit. */
  handles = new Map<string, string>();

  async getAccount(id: string) {
    return this.accounts.get(id) ?? null;
  }

  async getAccountByHandle(handle: string) {
    const id = this.handles.get(handle);
    return id ? (this.accounts.get(id) ?? null) : null;
  }

  async claimHandle(account: Account) {
    const holder = this.handles.get(account.handle);
    if (holder) return { account: this.accounts.get(holder) as Account, claimed: false };

    // Releasing the old handle in the same step. Two handles pointing at one
    // account would make `getAccountByHandle` and `getAccount` disagree about
    // what somebody is called.
    const previous = this.accounts.get(account.id);
    if (previous) this.handles.delete(previous.handle);

    const merged: Account = { ...(previous ?? account), handle: account.handle };
    this.accounts.set(account.id, merged);
    this.handles.set(account.handle, account.id);
    return { account: merged, claimed: true };
  }

  async updateAccount(id: string, patch: Partial<Pick<Account, 'displayName' | 'avatar'>>) {
    const account = this.accounts.get(id);
    if (!account) return null;
    const updated = { ...account, ...patch };
    this.accounts.set(id, updated);
    return updated;
  }

  async accountExists(accountId: string) {
    for (const device of this.devices.values()) {
      if (device.accountId === accountId && !device.revokedAt) return true;
    }
    return false;
  }
  async getMembership(roomId: string, accountId: string) {
    return this.memberships.get(`${roomId}:${accountId}`) ?? null;
  }
  async getRoles(spaceId: string, roleIds: string[]) {
    return roleIds
      .map((r) => this.roles.get(r))
      .filter((r): r is Role => !!r && r.spaceId === spaceId);
  }
  async getOverrides(roomId: string) {
    return this.overrides.filter((o) => o.roomId === roomId);
  }
  async isOwner(spaceId: string, accountId: string) {
    return this.owners.has(`${spaceId}:${accountId}`);
  }
  async getDevice(pub: string) {
    return this.devices.get(pub) ?? null;
  }

  blobs = new Map<string, Blob>();
  #blobBytes = new Map<string, Uint8Array>();

  async putBlob(blob: Blob, bytes: Uint8Array) {
    // One step, because a row without bytes is a broken attachment and bytes
    // without a row are storage nobody will ever collect. In Postgres the row
    // is written after the object store confirms.
    //
    // **First write wins, and the stored row comes back.** This used to
    // overwrite, which meant a colliding id silently replaced somebody else's
    // ciphertext — and re-uploading over a purged id quietly un-purged it.
    // Postgres refused the write and reported success anyway; both were wrong
    // in different directions, and the honest answer is the row that is there.
    const existing = this.blobs.get(blob.id);
    if (existing) return existing;

    this.#blobBytes.set(blob.id, bytes);
    this.blobs.set(blob.id, blob);
    return blob;
  }

  async getBlob(id: string) {
    return this.blobs.get(id) ?? null;
  }

  async readBlob(id: string) {
    return this.#blobBytes.get(id) ?? null;
  }

  async purgeBlob(id: string, at: number) {
    const blob = this.blobs.get(id);
    if (!blob || blob.purgedAt) return false;
    this.#blobBytes.delete(id);
    blob.purgedAt = at;
    blob.size = 0;
    return true;
  }

  pushSubscriptions = new Map<string, StoredPushSubscription>();

  async putPushSubscription(subscription: StoredPushSubscription) {
    this.pushSubscriptions.set(subscription.devicePub, subscription);
  }

  async getPushSubscription(devicePub: string) {
    return this.pushSubscriptions.get(devicePub) ?? null;
  }

  async deletePushSubscription(devicePub: string) {
    this.pushSubscriptions.delete(devicePub);
  }

  challenges = new Map<string, Challenge>();
  sessions = new Map<string, Session>();

  async registerDevice(device: Device) {
    const existing = this.devices.get(device.pub);
    // Re-registering a revoked device must not un-revoke it. Otherwise "sign
    // out this device" lasts exactly as long as it takes to press the button
    // again on the device you were signing out.
    if (existing) return { device: existing, created: false };
    this.devices.set(device.pub, device);
    return { device, created: true };
  }

  async revokeDevice(pub: string, at: number) {
    const device = this.devices.get(pub);
    if (!device || device.revokedAt) return false;
    device.revokedAt = at;
    await this.deleteDeviceSessions(pub);
    // And its push channel. A revoked device's endpoint is a live line to a
    // phone somebody has just signed out; keeping it would mean the one action
    // whose entire purpose is "stop talking to that device" leaves the loudest
    // channel open.
    await this.deletePushSubscription(pub);
    return true;
  }

  async putChallenge(nonceHash: string, challenge: Challenge) {
    this.challenges.set(nonceHash, challenge);
  }

  async takeChallenge(nonceHash: string) {
    const challenge = this.challenges.get(nonceHash);
    // Deleted as it is read, in one call, because two round trips is how the
    // same nonce gets spent twice.
    this.challenges.delete(nonceHash);
    if (!challenge) return null;
    return challenge.expiresAt < Date.now() ? null : challenge;
  }

  async putSession(tokenHash: string, session: Session) {
    this.sessions.set(tokenHash, session);
  }

  async getSession(tokenHash: string) {
    const session = this.sessions.get(tokenHash);
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
      this.sessions.delete(tokenHash);
      return null;
    }
    return session;
  }

  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }

  async deleteDeviceSessions(devicePub: string) {
    for (const [hash, session] of this.sessions) {
      if (session.devicePub === devicePub) this.sessions.delete(hash);
    }
  }

  async sweepExpired(now: number) {
    let challenges = 0;
    let sessions = 0;
    for (const [hash, challenge] of this.challenges) {
      if (challenge.expiresAt < now) {
        this.challenges.delete(hash);
        challenges += 1;
      }
    }
    for (const [hash, session] of this.sessions) {
      if (session.expiresAt < now) {
        this.sessions.delete(hash);
        sessions += 1;
      }
    }
    // Login sessions leak the same way — an abandoned sign-in never finishes,
    // so nothing ever reads the row that would clear it.
    for (const [id, login] of this.loginSessions) {
      if (login.expiresAt < now) this.loginSessions.delete(id);
    }
    return { challenges, sessions };
  }

  async appendEvent(e: Event) {
    // Idempotency is scoped per device: two devices may legitimately pick the
    // same nonce, and one must not shadow the other.
    const key = `${e.sender}:${e.clientNonce}`;
    const existing = this.#nonces.get(key);
    if (existing) return { event: existing, deduped: true };

    const list = this.events.get(e.room) ?? [];
    list.push(e);
    this.events.set(e.room, list);
    this.#nonces.set(key, e);
    return { event: e, deduped: false };
  }

  async listEvents(roomId: string, opts: { before?: string; limit?: number } = {}) {
    const all = [...(this.events.get(roomId) ?? [])].sort((a, b) => compareIds(a.id, b.id));
    const filtered = opts.before ? all.filter((e) => compareIds(e.id, opts.before!) < 0) : all;
    const limit = opts.limit ?? 50;
    return filtered.slice(-limit);
  }

  async purgeEvent(roomId: string, eventId: string) {
    const list = this.events.get(roomId);
    const found = list?.find((e) => e.id === eventId);
    // Already purged is not a second purge — see the note in `postgres.ts`.
    if (!found || found.purgedAt) return false;
    found.payload = '';
    found.size = 0;
    found.purgedAt = Date.now();
    return true;
  }

  // -------------------------------------------------------------------------
  // The handshake surface
  // -------------------------------------------------------------------------

  groups = new Map<string, Group>();
  groupMembers = new Map<string, GroupMember>();
  handshake = new Map<string, HandshakeRecord[]>();
  welcomes = new Map<string, StoredWelcome[]>();
  trees = new Map<string, { epoch: number; tree: string }>();
  shelves = new Map<string, Shelf>();
  claims = new Map<string, OutstandingClaim>();

  async listAccountDevices(accountId: string, opts: { includeRevoked?: boolean } = {}) {
    return [...this.devices.values()].filter(
      (d) => d.accountId === accountId && (opts.includeRevoked || !d.revokedAt),
    );
  }

  async publishKeyPackages(devicePub: string, upload: KeyPackageUpload) {
    // Replace rather than append. A device that has just restored from backup
    // holds different private halves than whatever is on the shelf, and adding
    // to a stale shelf means handing out packages nobody can open.
    const shelf: Shelf = {
      packages: [...upload.packages],
      lastResort: upload.lastResort ?? this.shelves.get(devicePub)?.lastResort ?? null,
    };
    this.shelves.set(devicePub, shelf);
    return this.keyPackageSupply(devicePub);
  }

  async keyPackageSupply(devicePub: string): Promise<KeyPackageSupply> {
    const shelf = this.shelves.get(devicePub);
    return { available: shelf?.packages.length ?? 0, lastResort: !!shelf?.lastResort };
  }

  async claimKeyPackage(devicePub: string, groupId: string): Promise<ClaimedPackage | null> {
    const key = `${groupId}:${devicePub}`;
    const outstanding = this.claims.get(key);
    if (outstanding)
      return { keyPackage: outstanding.keyPackage, lastResort: outstanding.lastResort };

    const shelf = this.shelves.get(devicePub);
    if (!shelf) return null;

    // `shift`, not `pop`: oldest first, so a package that has been sitting
    // around is spent before a fresh one and the shelf's age stays bounded.
    const one = shelf.packages.shift();
    const claim: ClaimedPackage | null = one
      ? { keyPackage: one, lastResort: false }
      : shelf.lastResort
        ? { keyPackage: shelf.lastResort, lastResort: true }
        : null;
    if (!claim) return null;

    this.claims.set(key, { ...claim, groupId, devicePub });
    return claim;
  }

  async hasClaim(groupId: string, devicePub: string) {
    return this.claims.has(`${groupId}:${devicePub}`);
  }

  async getGroup(id: string) {
    return this.groups.get(id) ?? null;
  }

  async createGroup(id: string, roomId: string, creator: GroupMemberInput) {
    // **Idempotent, like Postgres's `ON CONFLICT DO NOTHING`.** This used to
    // overwrite unconditionally, which rewound an existing group to epoch 0 —
    // and a group at epoch 0 accepts a stale commit built at epoch 0, which is
    // precisely the fork that `appendHandshake`'s locked transaction exists to
    // prevent. Found by review; the conformance suite never called this twice.
    const existing = this.groups.get(id);
    const group: Group = existing ?? { id, epoch: 0, pendingProposals: 0 };
    this.groups.set(id, group);
    const room = this.rooms.get(roomId);
    if (room) room.groupId = id;
    this.groupMembers.set(`${id}:${creator.devicePub}`, {
      ...creator,
      groupId: id,
      addedEpoch: 0,
      lastActiveAt: Date.now(),
    });
    return group;
  }

  async getGroupRooms(groupId: string) {
    return [...this.rooms.values()].filter((r) => r.groupId === groupId);
  }

  async listGroupMembers(groupId: string) {
    return [...this.groupMembers.values()].filter((m) => m.groupId === groupId);
  }

  async getGroupMember(groupId: string, devicePub: string) {
    return this.groupMembers.get(`${groupId}:${devicePub}`) ?? null;
  }

  async touchGroupMember(groupId: string, devicePub: string, at: number) {
    const member = this.groupMembers.get(`${groupId}:${devicePub}`);
    if (member) member.lastActiveAt = at;
  }

  async leaveGroup(groupId: string, devicePub: string) {
    this.groupMembers.delete(`${groupId}:${devicePub}`);
    this.claims.delete(`${groupId}:${devicePub}`);
    await this.ackWelcome(devicePub, groupId);
  }

  async appendHandshake(input: HandshakeAppend): Promise<HandshakeResult> {
    const group = this.groups.get(input.groupId);
    if (!group) return { accepted: false, reason: 'epoch_conflict', epoch: 0 };

    // Everything below this line is one transaction in Postgres. Nothing may
    // observe a half-applied commit: a log entry without the epoch bump lets a
    // second commit in at the same epoch, and an epoch bump without the log
    // entry strands every other member one epoch behind forever.
    if (input.epoch !== group.epoch) {
      return { accepted: false, reason: 'epoch_conflict', epoch: group.epoch };
    }

    if (input.welcome) {
      const unclaimed = input.welcome.devices.filter((d) => !this.claims.has(`${group.id}:${d}`));
      if (unclaimed.length) {
        return {
          accepted: false,
          reason: 'unclaimed_welcome',
          epoch: group.epoch,
          devices: unclaimed,
        };
      }
    }

    const log = this.handshake.get(group.id) ?? [];
    const record: HandshakeRecord = {
      group: group.id,
      seq: log.length,
      kind: input.kind,
      epoch: input.epoch,
      sender: input.sender,
      bytes: input.bytes,
      createdAt: input.at,
    };
    log.push(record);
    this.handshake.set(group.id, log);

    if (input.kind === 'proposal') {
      group.pendingProposals += 1;
      return { accepted: true, record, epoch: group.epoch };
    }

    // A commit sweeps up every proposal that was waiting, whether or not it
    // included them — the ones it missed are stale at the new epoch anyway.
    group.epoch += 1;
    group.pendingProposals = 0;

    // Before the Welcome rows below, so the tree is never the missing half of
    // an invitation somebody can already see.
    if (input.tree) await this.putTree(group.id, group.epoch, input.tree);

    for (const member of input.added ?? []) {
      this.groupMembers.set(`${group.id}:${member.devicePub}`, {
        ...member,
        groupId: group.id,
        addedEpoch: group.epoch,
        lastActiveAt: input.at,
      });
    }
    for (const devicePub of input.removed ?? []) {
      this.groupMembers.delete(`${group.id}:${devicePub}`);
      // Drop this group's queued Welcome for a device that is no longer in it.
      // One still sitting there would let a removed device walk back in — and
      // only this group's: the device may be legitimately joining others.
      const queue = this.welcomes.get(devicePub)?.filter((w) => w.groupId !== group.id) ?? [];
      if (queue.length) this.welcomes.set(devicePub, queue);
      else this.welcomes.delete(devicePub);
    }

    if (input.welcome) {
      for (const devicePub of input.welcome.devices) {
        // One row per device holding the same bytes (`docs/04` §1's
        // `group_welcomes`), replacing any earlier unacked one for this group:
        // only the newest can still be opened at the current epoch.
        const queue = this.welcomes.get(devicePub)?.filter((w) => w.groupId !== group.id) ?? [];
        queue.push({ groupId: group.id, bytes: input.welcome.bytes, createdAt: input.at });
        this.welcomes.set(devicePub, queue);
        this.claims.delete(`${group.id}:${devicePub}`);
      }
    }

    return { accepted: true, record, epoch: group.epoch };
  }

  async listHandshake(groupId: string, opts: { since?: number; limit?: number } = {}) {
    const log = this.handshake.get(groupId) ?? [];
    const since = opts.since ?? -1;
    return log.filter((r) => r.seq > since).slice(0, opts.limit ?? 200);
  }

  async listWelcomes(devicePub: string, groupId?: string) {
    const queue = this.welcomes.get(devicePub) ?? [];
    return groupId ? queue.filter((w) => w.groupId === groupId) : [...queue];
  }

  async ackWelcome(devicePub: string, groupId: string) {
    const queue = this.welcomes.get(devicePub)?.filter((w) => w.groupId !== groupId) ?? [];
    if (queue.length) this.welcomes.set(devicePub, queue);
    else this.welcomes.delete(devicePub);
  }

  async putTree(groupId: string, epoch: number, tree: string) {
    const current = this.trees.get(groupId);
    // Never go backwards. Handshake records can be retried and a late write of
    // an older tree would hand joiners a tree that does not match the epoch
    // their Welcome is for.
    if (current && current.epoch > epoch) return;
    this.trees.set(groupId, { epoch, tree });
  }

  async getTree(groupId: string) {
    return this.trees.get(groupId) ?? null;
  }

  // -------------------------------------------------------------------------
  // Enrolment
  // -------------------------------------------------------------------------

  enrolments = new Map<string, Enrolment>();
  /** account pub → its wraps, by kind. One of each, replaceable. */
  wraps = new Map<string, Map<string, StoredWrap>>();
  loginSessions = new Map<string, LoginSession>();
  totp = new Map<string, TotpSecret>();

  async createEnrolment(enrolment: Enrolment) {
    // Not an upsert. Overwriting would let anybody who knows a handle replace
    // the record and the wraps — an account takeover with no password in it.
    if (this.enrolments.has(enrolment.handle)) return null;
    // And one handle per account, which Postgres enforces with a unique index
    // on `account_pub`. Two handles resolving to one account would make the
    // wraps reachable by a name their owner did not choose.
    if (await this.getEnrolmentByAccount(enrolment.accountPub)) return null;
    this.enrolments.set(enrolment.handle, enrolment);
    return enrolment;
  }

  async getEnrolment(handle: string) {
    return this.enrolments.get(handle) ?? null;
  }

  async getEnrolmentByAccount(accountPub: string) {
    for (const e of this.enrolments.values()) if (e.accountPub === accountPub) return e;
    return null;
  }

  async putWrap(accountPub: string, wrap: StoredWrap) {
    const set = this.wraps.get(accountPub) ?? new Map<string, StoredWrap>();
    set.set(wrap.kind, wrap);
    this.wraps.set(accountPub, set);
  }

  async wrapsFor(accountPub: string): Promise<StoredWrap[]> {
    return [...(this.wraps.get(accountPub)?.values() ?? [])].sort((a, b) =>
      a.kind.localeCompare(b.kind),
    );
  }

  async putRegistrationRecord(accountPub: string, record: string) {
    const enrolment = await this.getEnrolmentByAccount(accountPub);
    if (enrolment) this.enrolments.set(enrolment.handle, { ...enrolment, record });
  }

  async putLoginSession(id: string, session: LoginSession) {
    this.loginSessions.set(id, session);
  }

  async takeLoginSession(id: string) {
    const session = this.loginSessions.get(id);
    // Single use, deleted as it is read — the same rule as a challenge, and for
    // the same reason: a state that can be spent twice is a replay.
    this.loginSessions.delete(id);
    if (!session) return null;
    return session.expiresAt < Date.now() ? null : session;
  }

  channels = new Map<string, EnrolChannel>();

  async putChannel(id: string, channel: EnrolChannel) {
    this.channels.set(id, channel);
  }

  async getChannel(id: string) {
    const channel = this.channels.get(id);
    if (!channel) return null;
    if (channel.expiresAt < Date.now()) {
      this.channels.delete(id);
      return null;
    }
    return channel;
  }

  async deliverChannel(id: string, delivery: string) {
    const channel = await this.getChannel(id);
    // Once. A channel that accepted a second delivery would let anybody who
    // saw the QR overwrite what the real device sent.
    if (!channel || channel.delivery) return false;
    this.channels.set(id, { ...channel, delivery });
    return true;
  }

  async takeChannel(id: string) {
    const channel = await this.getChannel(id);
    if (channel?.delivery) this.channels.delete(id);
    return channel;
  }

  async getTotp(accountPub: string) {
    return this.totp.get(accountPub) ?? null;
  }

  async putTotp(accountPub: string, secret: TotpSecret) {
    this.totp.set(accountPub, secret);
  }

  async deleteTotp(accountPub: string) {
    this.totp.delete(accountPub);
  }
}
