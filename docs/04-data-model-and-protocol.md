# Data model and protocol

What the server stores, what goes over the wire, and what lives only inside the
ciphertext. The organising idea (from `02-architecture.md` principle 3): the
**server stores opaque events and enforces policy**; the **client's room
reducer owns semantics**.

## 1. Entities

### Server-side (Postgres)

**IdP role**

| Table | Holds |
| --- | --- |
| `accounts` | `id` (account pubkey), `handle` (unique), `display_name`, `avatar_blob`, `status` (active/suspended), `created`, `moved_to` (nullable IdP) |
| `devices` | `pub`, `account_id`, `cert` (signed by account key), `label`, `created`, `revoked_at` |
| `opaque_records` | per account: the OPAQUE registration record |
| `key_backups` | per account: `{kek_wrap, rk_wrap, pk_wraps[]}`, `version` |
| `second_factors` | per account: `kind` (totp / webauthn), secret or credential (encrypted at rest), `label`, `created` — a policy gate on finishing OPAQUE login + releasing the backup + registering a device cert |
| `key_packages` | per device: one-time MLS KeyPackages + one last-resort; `claimed_by_host`, `claimed_at` |
| `transparency_log` | append-only `{seq, account_id, handle, event (bind/rebind/device-add/device-revoke/move), payload_hash, prev_hash}` — Merkle roots + signed tree heads published periodically |
| `email_verifications` / `password_resets` | single-use token hashes, atomic `DELETE … RETURNING` (Kith) |

**Host role**

| Table | Holds |
| --- | --- |
| `spaces` | `id`, `owner_account`, `listing` (nullable public `{name, description, icon}`), `settings` (plaintext policy: default history mode, accept-invites, size caps) |
| `rooms` | `id`, `space_id` (nullable → DM/group), `kind` (space/dm/group), `group_id`, `visibility` (`everyone` / `roles:[…]` / `list`), `history_mode` (`join` / `forward`), `stream_paging` (bool), `notify_hints` (bool) |
| `space_members` / `room_members` | `(space_id, account_id)` / `(room_id, account_id)` + `joined_at` |
| `roles`, `member_roles`, `room_overrides` | Kith's model verbatim: bitfield per role, `@everyone` shares the space id, allow/deny masks per role per room |
| `bans` | `(space_id, account_id, by, reason?, at)` |
| `invites` | `code`, `space_id`/`room_id`, `wrapped_keys` (to the invite pubkey), `uses`, `max_uses`, `expires_at` |
| `groups` | `id`, `epoch`, `designated_committer_device`, `pending_proposal_count`, `tree_blob` (public ratchet tree) |
| `group_members` | `(group_id, device_pub, leaf_index, added_epoch, removed_epoch?)` |
| `group_handshake` | append-only `{group_id, seq, kind (proposal/commit/welcome), sender (device or 'server'), bytes, epoch}` |
| `group_welcomes` | `(group_id, device_pub, welcome_bytes, anchor_included)` — served on that device's next connect |
| `group_anchors` | `(group_id, account_id, sealed_anchor)` — the history anchor sealed under the account key, opaque; a newly signed-in device fetches it to read backlog |
| `events` | **the opaque log**: `id` (snowflake, monotonic per room), `room_id`, `sender_device`, `class`, `epoch`, `stream` (nullable), `notify` (nullable account[]), `payload` (bytea), `size`, `created`, `purged_at`, `client_nonce` (unique per device) |
| `blobs` | `id`, `room_id`, `uploader`, `size`, `content_hash`, `created`, `purged_at` — bytes in S3 |
| `device_sessions` | short-lived Host session tokens bound to a device pub |
| `push_subscriptions` | `(device_pub, kind (webpush/apns/fcm), endpoint/tokens, keys)` |
| `voice_states` / `call_sessions` | who's in which voice room (plaintext presence) |
| `agent_hosts` | agent accounts' registered hosts (metadata only; no callback URLs — there are no webhooks) |
| `agent_labels` | per agent account: `label` from the fixed set (`agent`/`bot`/`friend`/`assistant`/`companion`/`service`, default `agent`). Cosmetic only — the badge is always rendered, and the roster's "can read this room" line is not derived from it. See `11-people-and-agents.md`. |

Note what's **absent** versus Kith: no `messages` table with content, no
`reactions`, no `read_state`, no `identities` on the Host, no `emotes` (custom
emotes are encrypted blobs referenced from encrypted events), no
`channel_directory` mirror, no `agent_tokens.callbackUrl`.

### Client-side (local store, `packages/core`)

The local store is the real database the UI reads from. Per room: decrypted
events, the reducer's materialised state (messages, edits applied, reactions
aggregated, threads, pins, read markers, faces), the MLS session state and era
roots (sealed at rest under the device key), the search index. Plus account-
level: contacts, spaces, preferences, notification rules.

## 2. The event envelope

```ts
// server-visible
type EventEnvelope = {
  id: string;               // server-assigned snowflake, monotonic per room
  room: string;
  sender: string;           // device pub
  class: 'ephemeral' | 'silent' | 'normal';
  epoch: number;            // which era root opens `payload`
  stream?: string;          // thread id, if the room allows stream paging
  notify?: string[];        // account ids, if the room allows notify hints
  payload: Uint8Array;      // XChaCha20-Poly1305 over EncryptedEvent
  size: number;
  created: number;
};

// inside `payload`, after opening with the era key
type EncryptedEvent =
  | { v: 1; type: 'm.message';    face?: FaceRef; body: RichText; attachments?: BlobRef[]; reply_to?: EventId; thread?: EventId; mentions?: AccountId[]; expression?: string }
  | { v: 1; type: 'm.edit';       target: EventId; body: RichText }
  | { v: 1; type: 'm.redact';     target: EventId; reason?: string }
  | { v: 1; type: 'm.reaction';   target: EventId; key: string; remove?: boolean }
  | { v: 1; type: 'm.receipt';    up_to: EventId }                       // class: silent
  | { v: 1; type: 'm.typing';     face?: FaceRef; stop?: boolean }         // class: ephemeral
  | { v: 1; type: 'm.pin';        target: EventId; unpin?: boolean }
  | { v: 1; type: 'm.annotation'; target: EventId; kind: string; body: RichText }   // one per (target, author, kind)
  //   kind is namespaced: 'translation:de', 'transcript', 'caption', 'note'.
  //   Translations are usually LOCAL and never become events at all — this
  //   type is only for translations a member chooses to SHARE (10-translation.md).
  | { v: 1; type: 'm.poll' | 'm.poll.vote' | 'm.call.invite' | 'm.call.state' | … }
  | { v: 1; type: 'room.name';    name: string; topic?: string; icon?: BlobRef }
  | { v: 1; type: 'room.faces';   faces: Face[] }                          // this account's headmates as seen in this room
  | { v: 1; type: 'room.emotes';  emotes: Emote[] }
  | { v: 1; type: 'room.history'; anchor_epoch: number; link: WrappedKey } // backward links, published by committers
  | { v: 1; type: 'frank';        commitment: Uint8Array }                  // franking tag, attached to m.message
```

- `FaceRef` is `{ id, name, color, avatar?: BlobRef, pronouns? }` — a *snapshot*,
  so a message renders correctly even if the face is later renamed (Kith's
  denormalised author snapshot, now inside the ciphertext). `room.faces` carries
  the live roster for the member list and the switcher.
- `BlobRef` is `{ id, key, nonce, size, mime, name, hash, thumb?: BlobRef }` —
  the blob is sealed under its own random key client-side; the key travels in
  the event. The server stores ciphertext with no name or type. Thumbnails are
  generated client-side before upload.
- `RichText` is a **node tree** (Kith's `markdown.ts` output shape), never raw
  markdown-to-HTML. Rendered without `{@html}`.
- **Annotations** are the discussion's "annotate publicly" idea: a translation
  bot posts `m.annotation {kind:'translation:de'}`; a user posts
  `{kind:'note'}`. The UI shows them folded under the message, toggleable per
  kind, and the server never knows they exist. Replies are messages, threads are
  streams, annotations are per-message-per-author-per-kind.
- Adding a feature = adding a variant here + a reducer case + UI. The server
  table above does not change.

## 3. The room reducer

`packages/core/src/rooms/reduce.ts`. Pure function `(state, event) → state`,
applied in event-id order. Handles: message insert, edit (latest wins, keeps
history), redaction (drops body, keeps tombstone), reaction aggregation,
receipts → per-account read markers, pins, thread indexes, faces roster,
name/topic, emotes, annotations. Unit-tested exhaustively; this is where Kith's
`applyDispatch` + `dedupeReplace` + `reconcileIncoming` + `applyReaction` live,
except it's one function and it doesn't know about WebSockets.

Optimistic sends insert a local event with a `pending` flag and the
`client_nonce`; the server's echo replaces it by nonce.

## 4. Permissions

Kith's bitfield model with a pruned set, since the server can't see content:

| Flag | Enforced by |
| --- | --- |
| `VIEW` | server (membership in the audience → in the MLS group); the *actual* gate is key possession |
| `SEND` | server, on `POST /events` |
| `SEND_MEDIA` | server, on blob upload |
| `MANAGE_EVENTS` | server, on purge; client, on honouring redactions from non-authors |
| `MENTION_EVERYONE` | server, on `notify` hints covering the whole room; client, on rendering the ping |
| `MANAGE_ROOMS` / `MANAGE_ROLES` / `MANAGE_SPACE` / `MANAGE_AGENTS` | server |
| `KICK` / `BAN` / `INVITE` | server |
| `ADMINISTRATOR` | owner-equivalent short-circuit |

Dropped: `ADD_REACTIONS` (a reaction is just a `silent` event; `SEND` covers
it), `MANAGE_OWN_MESSAGES` (authors always may, in-band). Resolution
(`@everyone` ∪ roles, then room overrides, owner short-circuit, threads inherit
the room) is Kith's `resolveEffectivePermissions` ported to
`packages/protocol`, and **the client runs the same function** so UI gating
agrees with the server.

## 5. Wire protocol

**REST** (Hono, JSON, device-session bearer). Grouped: `/idp/*` (register,
OPAQUE start/finish, 2fa enrol/verify, backup, devices, key-packages, handles,
log), `/spaces`,
`/rooms`, `/rooms/:id/events` (POST + paged GET with `before`/`after`/`stream`),
`/rooms/:id/events/:eid/purge`, `/rooms/:id/history` (ciphertext for
re-request), `/groups/:id/{handshake,welcome,tree,key-packages/claim}`,
`/blobs`, `/invites`, `/voice/token`, `/push/subscribe`. Errors are
`{ error: '<code>' }` (Kith).

**One WebSocket per device**, not per room. Kith ran a socket per guild plus a
DM socket plus a user socket and the client juggled them; here the server
multiplexes.

```
client → server
  HELLO      { device_session, resume?: { cursors: Record<roomId, lastEventId> } }
  SUB        { rooms: [...] }            // optional narrowing; default = everything you're in
  TYPING     { room, payload }           // an ephemeral event, never persisted
  ACK        { s }

server → client
  READY      { rooms: [...summaries], pending_welcomes: [...], pending_commits: [groupId...] }
  EVENT      { s, envelope }             // one opaque event
  HANDSHAKE  { s, group, seq, kind, bytes }
  COMMIT_REQUESTED { group, deadline }   // "you're the designated committer"
  PRESENCE   { account, state }
  VOICE      { room, states }
  HEARTBEAT / HEARTBEAT_ACK
```

- `s` is a per-connection monotonic sequence; `resume.cursors` lets a client
  catch up per room after a disconnect without re-`READY`-ing everything
  (local-first: the client already has everything up to the cursor).
- Heartbeat/backoff/kick-on-focus behaviour is Kith's `gateway.ts`.
- Push: the server sends a **content-free** push (`{room}` at most) for
  `normal` events to devices with no live socket; the client wakes, syncs from
  its cursors, decrypts, and decides locally whether that deserves a
  notification. Reconcile-on-open means a missed push never means a missed
  message.

## 6. Ids

Snowflakes (Kith's `snowflake.ts`): time-sortable, server-assigned for events
(one sequence per room → total order), random for client-minted things. 1:1 DM
ids are deterministic from the sorted account pair.

## 7. Migrations

Postgres via Drizzle, generated SQL, applied on server start (self-hosters get
"it just migrates"). One schema, one migration stream. No DO-style hand-numbered
blocks.
