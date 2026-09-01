/**
 * The room reducer. `docs/04` §3.
 *
 * > Pure function `(state, event) → state`, applied in event-id order. Handles:
 * > message insert, edit (latest wins, keeps history), redaction (drops body,
 * > keeps tombstone), reaction aggregation, receipts → per-account read
 * > markers, pins, thread indexes, faces roster, name/topic, annotations.
 * > […] this is where Kith's `applyDispatch` + `dedupeReplace` +
 * > `reconcileIncoming` + `applyReaction` live, except it's one function and it
 * > doesn't know about WebSockets.
 *
 * It doesn't know about sockets, storage, crypto, or the clock. Everything it
 * needs arrives as an argument, which is what makes a room's contents a
 * function of its event log — the same log always produces the same room, on
 * any device, in any order of arrival.
 *
 * ## Purity, and the escape hatch
 *
 * `reduce` returns a new state and never touches the one it was given. Doing
 * that per event would copy the message array once per event, which turns
 * replaying a 10,000-event room into 50 million operations. So the real work
 * lives in [`reduceAll`], which copies once and then fills in a draft nobody
 * else has a reference to yet, and `reduce` is the single-event case of it.
 * The contract callers see is unchanged.
 */
import type { RoleName } from '@revel/protocol';
import type { Annotation, LocalEvent, Message, Reaction, RoomState } from './state.js';
import { compareIds, emptyRoom } from './state.js';

export interface ReduceOptions {
  /**
   * Whether an account may redact somebody else's message.
   *
   * `docs/04` §4: `MANAGE_EVENTS` is enforced by the server on purge and **by
   * the client on honouring redactions from non-authors**. Authors always may,
   * in band, and that case never reaches this predicate.
   *
   * Defaults to refusing. A missing permission check should fail closed: the
   * cost of wrongly ignoring a moderator is a stale row until the next sync,
   * and the cost of wrongly honouring a stranger is anyone being able to
   * delete anything.
   */
  mayModerate?: (account: string) => boolean;
}

/** Apply one event. See the note on `reduceAll` about why this delegates. */
export function reduce(
  state: RoomState,
  event: LocalEvent,
  options: ReduceOptions = {},
): RoomState {
  return reduceAll(state, [event], options);
}

/**
 * Apply a batch, in event-id order.
 *
 * Sorts first: `docs/04` says "applied in event-id order", and a caller handing
 * over a socket burst or a page of history has no reason to have done that
 * already. Sorting here rather than trusting the caller is the difference
 * between a reducer and a reducer plus a rule nobody remembers.
 *
 * ## How much order-independence this actually has
 *
 * Within a batch: complete. Hand over the same events in any order and the room
 * is identical, because they are sorted before anything is applied.
 *
 * Across batches: guaranteed for the two patterns delivery actually produces —
 * **forward** (live events, ids increasing) and **backward** (a backfill page,
 * entirely older than what is held). Both are covered by the deferral in
 * `RoomState.deferred`: an event whose target has not arrived waits for it, and
 * every event waiting on one message is applied in id order when it lands.
 *
 * It is *not* guaranteed for an arbitrary interleaving — batches shuffled so
 * that some events targeting a message are applied directly and others are
 * deferred can order those two groups differently than a single sorted pass
 * would. Making that exact would mean keeping a per-message event log and
 * recomputing the message on every late arrival, which is a large amount of
 * machinery for a delivery pattern no transport produces. The property tests
 * assert the two real ones and say this out loud rather than quietly testing
 * the easy case.
 */
export function reduceAll(
  state: RoomState,
  events: LocalEvent[],
  options: ReduceOptions = {},
): RoomState {
  const fresh = events.filter((e) => !state.applied.has(e.id));
  if (fresh.length === 0) return state;

  const draft = clone(state);
  fresh.sort((a, b) => compareIds(a.id, b.id));

  for (const event of fresh) {
    // Re-checked inside the loop: a batch can legitimately contain the same
    // event twice when a socket burst overlaps a history page.
    if (draft.applied.has(event.id)) continue;
    draft.applied.add(event.id);
    if (!draft.lastEventId || compareIds(event.id, draft.lastEventId) > 0) {
      draft.lastEventId = event.id;
    }
    apply(draft, event, options);
  }

  // Anything that was waiting for a message this batch brought in, applied now
  // rather than the moment the message landed.
  //
  // The timing is the whole trick. Draining at insert time puts a deferred
  // event ahead of every lower-id event still to come in the same batch, which
  // is wrong precisely where it matters: backfilling a page reinstates an old
  // message, and the edits and reactions from that same page must apply before
  // the ones held over from the live stream. Deferred events are always newer
  // than the page that unblocked them, so waiting until the end and sorting
  // gives the same order a single pass over the whole log would have.
  drainReady(draft, options);

  return draft;
}

/** A shallow copy deep enough that nothing reachable from `state` is mutated. */
function clone(state: RoomState): RoomState {
  return {
    ...state,
    messages: [...state.messages],
    byId: new Map(state.byId),
    pinned: [...state.pinned],
    receipts: new Map(state.receipts),
    threadNames: new Map(state.threadNames),
    threadNamesAt: new Map(state.threadNamesAt),
    faces: new Map(state.faces),
    facesAt: new Map(state.facesAt),
    spaceRoles: new Map(state.spaceRoles),
    threads: new Map(state.threads),
    applied: new Set(state.applied),
    deferred: new Map(state.deferred),
  };
}

/**
 * How many events may be waiting for targets that have not arrived.
 *
 * Unbounded, this is a leak with a plausible cause: a reaction to a message
 * that was purged before this device ever synced has a target that is never
 * coming. Ten thousand is far above any real backlog and far below anything a
 * person would notice.
 */
const MAX_DEFERRED = 10_000;

/**
 * Park an event until its target arrives. See `RoomState.deferred`.
 *
 * The event is already in `applied`, so a re-delivery will not queue it twice.
 */
function defer(draft: RoomState, target: string, event: LocalEvent): void {
  let waiting = 0;
  for (const list of draft.deferred.values()) waiting += list.length;
  if (waiting >= MAX_DEFERRED) return;

  const list = draft.deferred.get(target);
  draft.deferred.set(target, list ? [...list, event] : [event]);
}

/** Apply everything whose target has now arrived, in id order across all of them. */
function drainReady(draft: RoomState, options: ReduceOptions): void {
  const ready: LocalEvent[] = [];
  for (const [target, waiting] of draft.deferred) {
    if (!draft.byId.has(target)) continue;
    ready.push(...waiting);
    draft.deferred.delete(target);
  }
  if (ready.length === 0) return;

  ready.sort((a, b) => compareIds(a.id, b.id));
  // One pass is enough: nothing that can be deferred inserts a message, so
  // draining cannot unblock anything else.
  for (const event of ready) apply(draft, event, options);
}

function apply(draft: RoomState, event: LocalEvent, options: ReduceOptions): void {
  if (!event.payload.known) {
    // `docs/29` §1 rule 3: a type we do not understand is a newer client's
    // feature, and it keeps its place rather than vanishing. We cannot tell
    // whether it was meant to be a timeline row, so it becomes one — a visible
    // "something happened here" is recoverable, a silent drop is not.
    insert(draft, {
      id: event.id,
      account: event.account,
      at: event.at,
      body: '',
      unknown: { type: event.payload.type, raw: event.payload.raw },
    });
    return;
  }

  const payload = event.payload.event;

  switch (payload.type) {
    case 'm.message':
      insertMessage(draft, event, payload);
      return;
    case 'm.edit':
      edit(draft, event, payload);
      return;
    case 'm.redact':
      redact(draft, event, payload, options);
      return;
    case 'm.reaction':
      react(draft, event, payload);
      return;
    case 'm.receipt':
      receipt(draft, event, payload);
      return;
    case 'm.pin':
      pin(draft, event, payload);
      return;
    case 'm.annotation':
      annotate(draft, event, payload);
      return;
    case 'room.name':
      // Newest by id wins, not newest to arrive. A backfill delivers old
      // events after new ones, and without this, paging far enough up renames
      // the room to whatever it was called back then.
      if (!draft.nameAt || compareIds(event.id, draft.nameAt) > 0) {
        draft.name = payload.name;
        draft.topic = payload.topic;
        draft.nameAt = event.id;
      }
      return;
    case 'space.name':
      // Same last-writer-wins as `room.name`, and for the same reason: a
      // backfill delivers old events after new ones, so "newest to arrive"
      // would rename the space to whatever it was called last month.
      //
      // Kept on the room's state because that is where events live. A space's
      // name is read from any room in its `everyone` audience — every member
      // is in that one by definition, so every member has it.
      if (!draft.spaceNameAt || compareIds(event.id, draft.spaceNameAt) > 0) {
        draft.spaceName = payload.name;
        draft.spaceColour = payload.colour;
        draft.spaceNameAt = event.id;
      }
      return;
    case 'space.roles':
      // Whole list, last writer wins — see the event's own comment. Replacing
      // the map rather than merging into it is the point: a role that is gone
      // from the newest list is a role that was deleted, and merging would keep
      // naming it forever.
      if (!draft.spaceRolesAt || compareIds(event.id, draft.spaceRolesAt) > 0) {
        draft.spaceRoles = new Map(
          payload.roles.map((role: RoleName) => [role.id, { name: role.name, colour: role.colour }]),
        );
        draft.spaceRolesAt = event.id;
      }
      return;
    case 'room.faces':
      // Per face, for the same reason: a face renamed last week must not be
      // un-renamed by a page of history from last month.
      for (const face of payload.faces) {
        const at = draft.facesAt.get(face.id);
        if (at && compareIds(event.id, at) <= 0) continue;
        draft.faces.set(face.id, face);
        draft.facesAt.set(face.id, event.id);
      }
      return;
    case 'm.thread': {
      // Last writer wins by event id, like `room.name` and for the same
      // reason: paging far enough back must not rename a thread to whatever it
      // was called a month ago.
      const at = draft.threadNamesAt.get(payload.target);
      if (at && compareIds(event.id, at) <= 0) return;
      draft.threadNames.set(payload.target, payload.name);
      draft.threadNamesAt.set(payload.target, event.id);
      return;
    }
    case 'm.typing':
      // Deliberately nothing. Typing is `ephemeral` (`docs/03` §7) — never
      // stored, dropped if nobody is listening, and meaningless the moment it
      // is a second old. Folding it into persisted room state would mean
      // writing a row to disk to say somebody might be about to type, and
      // replaying it later as though they still were.
      return;
    default:
      // A known-to-zod type this switch has not caught up with. Same rule as an
      // unknown type: keep it rather than drop it.
      insert(draft, {
        id: event.id,
        account: event.account,
        at: event.at,
        body: '',
        unknown: { type: payload.type, raw: payload as Record<string, unknown> },
      });
  }
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function insertMessage(draft: RoomState, event: LocalEvent, payload: KnownShape): void {
  const message: Message = {
    id: event.id,
    account: event.account,
    at: event.at,
    body: payload.body,
    face: payload.face,
    replyTo: payload.replyTo,
    thread: payload.thread,
    attachments: payload.attachments,
    mentions: payload.mentions,
    expression: payload.expression,
    expiresAt: payload.expiresAt,
    // Carried through rather than dropped: a report is the plaintext plus this
    // key, checked against the commitment the Host holds (`docs/03` §9). A
    // reducer that discarded it would leave the key only in bytes nobody kept.
    frank: payload.frank,
    clientNonce: event.clientNonce,
  };

  if (event.purgedAt != null) {
    // The bytes are gone from the server. Not a redaction — nobody chose it,
    // and the UI says so differently.
    message.purged = true;
    message.body = '';
    message.attachments = undefined;
  }

  insert(draft, message);
}

/**
 * Put a message in id order, replacing our own optimistic copy if this is its
 * echo.
 *
 * `docs/04` §3: "Optimistic sends insert a local event with a `pending` flag
 * and the `client_nonce`; the server's echo replaces it by nonce." The nonce is
 * the only link between the two — the local copy has no server id yet, which is
 * the whole reason it was optimistic.
 */
function insert(draft: RoomState, message: Message): void {
  if (draft.byId.has(message.id)) return;

  if (message.clientNonce) {
    const pendingIndex = draft.messages.findIndex(
      (m) => m.pending && m.clientNonce === message.clientNonce,
    );
    if (pendingIndex !== -1) {
      const local = draft.messages[pendingIndex] as Message;
      draft.messages.splice(pendingIndex, 1);
      draft.byId.delete(local.id);
      untrack(draft, local);
      // Anything the local copy accumulated while in flight — a reaction from
      // someone who saw it, say — would have been keyed to its temporary id and
      // is gone with it. That is correct: those events name the real id.
    }
  }

  draft.messages.splice(placeFor(draft.messages, message), 0, message);
  draft.byId.set(message.id, message);

  if (message.thread) {
    const replies = draft.threads.get(message.thread) ?? [];
    const next = [...replies, message.id].sort(compareIds);
    draft.threads.set(message.thread, next);
  }
}

/**
 * Where a message belongs.
 *
 * The array is acknowledged messages in id order, then unacknowledged ones in
 * the order they were sent. Pending messages cannot be placed by id because
 * they do not have one yet — their local id is a placeholder, and comparing it
 * to a snowflake is meaningless. (`compareIds` orders by length first, so a
 * short local id would sort *before* every real event and an optimistic message
 * would appear at the top of the room instead of the bottom.)
 *
 * So they go at the end, which is also where they belong: by definition they
 * are the newest thing this client knows about. A real event arriving later
 * slots into the acknowledged prefix, and the echo removes the local copy.
 *
 * Binary search over that prefix, because a history page is a big burst.
 */
function placeFor(messages: Message[], message: Message): number {
  let high = messages.length;
  while (high > 0 && (messages[high - 1] as Message).pending) high--;
  if (message.pending) return messages.length;

  let low = 0;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (compareIds((messages[mid] as Message).id, message.id) < 0) low = mid + 1;
    else high = mid;
  }
  return low;
}

function untrack(draft: RoomState, message: Message): void {
  if (!message.thread) return;
  const replies = draft.threads.get(message.thread);
  if (!replies) return;
  const next = replies.filter((id) => id !== message.id);
  if (next.length) draft.threads.set(message.thread, next);
  else draft.threads.delete(message.thread);
}

/** Replace a message in place, keeping its position and identity in the maps. */
function replace(draft: RoomState, message: Message): void {
  const index = draft.messages.findIndex((m) => m.id === message.id);
  if (index === -1) return;
  draft.messages[index] = message;
  draft.byId.set(message.id, message);
}

// ---------------------------------------------------------------------------
// Edits, redactions
// ---------------------------------------------------------------------------

function edit(draft: RoomState, event: LocalEvent, payload: KnownShape): void {
  const target = draft.byId.get(payload.target);
  if (!target) return defer(draft, payload.target, event);
  // Authors always may, and only authors ever may — an edit is not a moderation
  // action. Somebody else's edit of your words would be a forgery with your
  // name on it, which is a different and much worse thing than a deletion.
  if (target.account !== event.account) return;
  // A redacted message has no body to edit, and letting one be edited would
  // resurrect what a redaction was for.
  if (target.redacted || target.purged) return;

  replace(draft, {
    ...target,
    body: payload.body,
    editedAt: event.at,
    edits: [...(target.edits ?? []), { body: target.body, at: target.editedAt ?? target.at }],
  });
}

function redact(
  draft: RoomState,
  event: LocalEvent,
  payload: KnownShape,
  options: ReduceOptions,
): void {
  const target = draft.byId.get(payload.target);
  if (!target) return defer(draft, payload.target, event);
  if (target.redacted) return;

  const isAuthor = target.account === event.account;
  if (!isAuthor && !(options.mayModerate?.(event.account) ?? false)) return;

  replace(draft, {
    ...target,
    body: '',
    attachments: undefined,
    edits: undefined,
    mentions: undefined,
    // Reactions go too: they were about content that no longer exists, and a
    // tombstone with six laughing faces attached reads as a joke about the
    // deletion rather than a record of one.
    reactions: undefined,
    pinned: undefined,
    pinnedAt: undefined,
    annotations: undefined,
    redacted: {
      by: isAuthor ? 'author' : 'moderator',
      at: event.at,
      reason: payload.reason,
    },
  });
  // A pinned message that is redacted stops being a notice: what was on the
  // board is gone, and leaving the tombstone up there is worse than nothing.
  repin(draft);
}

// ---------------------------------------------------------------------------
// Reactions, receipts, pins, annotations
// ---------------------------------------------------------------------------

function react(draft: RoomState, event: LocalEvent, payload: KnownShape): void {
  const target = draft.byId.get(payload.target);
  if (!target) return defer(draft, payload.target, event);
  if (target.redacted || target.purged) return;

  const reactions = (target.reactions ?? []).map((r) => ({ ...r, accounts: [...r.accounts] }));
  const existing = reactions.find((r) => r.key === payload.key);

  if (payload.remove) {
    if (!existing) return;
    existing.accounts = existing.accounts.filter((a) => a !== event.account);
    replace(draft, { ...target, reactions: prune(reactions) });
    return;
  }

  if (existing) {
    // Set semantics: reacting twice with the same key is the same as once, so a
    // replayed event changes nothing.
    if (existing.accounts.includes(event.account)) return;
    existing.accounts.push(event.account);
  } else {
    reactions.push({ key: payload.key, accounts: [event.account] });
  }
  replace(draft, { ...target, reactions: prune(reactions) });
}

function prune(reactions: Reaction[]): Reaction[] | undefined {
  const kept = reactions.filter((r) => r.accounts.length > 0);
  return kept.length ? kept : undefined;
}

function receipt(draft: RoomState, event: LocalEvent, payload: KnownShape): void {
  const current = draft.receipts.get(event.account);
  // Monotonic. A receipt that moved backwards would un-read messages, and
  // out-of-order delivery would make the unread count flicker.
  if (current && compareIds(payload.upTo, current) <= 0) return;
  draft.receipts.set(event.account, payload.upTo);
}

function pin(draft: RoomState, event: LocalEvent, payload: KnownShape): void {
  const target = draft.byId.get(payload.target);
  if (!target) return defer(draft, payload.target, event);

  if (payload.unpin) {
    replace(draft, { ...target, pinned: undefined, pinnedAt: undefined });
  } else {
    // Keep the first pin's id, not the latest: pinning something already
    // pinned is a no-op, and letting it jump to the top of the noticeboard
    // would make a duplicate event visible.
    replace(draft, { ...target, pinned: true, pinnedAt: target.pinnedAt ?? event.id });
  }
  repin(draft);
}

/**
 * Rebuild the pinned list from the messages, newest pin first.
 *
 * Derived rather than maintained, so it cannot drift from `Message.pinned`, and
 * ordered by the pin event's id so it is a fact about the log rather than about
 * the order pages of history arrived in. Pinned lists are noticeboards — this
 * is a handful of entries, recomputed on an event that is rare.
 */
function repin(draft: RoomState): void {
  draft.pinned = draft.messages
    .filter((m) => m.pinned && m.pinnedAt)
    .sort((a, b) => compareIds(b.pinnedAt as string, a.pinnedAt as string))
    .map((m) => m.id);
}

function annotate(draft: RoomState, event: LocalEvent, payload: KnownShape): void {
  const target = draft.byId.get(payload.target);
  if (!target) return defer(draft, payload.target, event);
  if (target.redacted || target.purged) return;

  const annotation: Annotation = {
    author: event.account,
    kind: payload.kind,
    body: payload.body,
    at: event.at,
  };

  // One per (target, author, kind) — `docs/04` §2. A second translation from
  // the same translator replaces the first rather than stacking.
  const rest = (target.annotations ?? []).filter(
    (a) => !(a.author === annotation.author && a.kind === annotation.kind),
  );
  replace(draft, { ...target, annotations: [...rest, annotation] });
}

// ---------------------------------------------------------------------------
// Optimistic sends
// ---------------------------------------------------------------------------

/**
 * Insert a message that has been sent but not acknowledged.
 *
 * Its id is local and temporary; the server's echo arrives with a real one and
 * `insert` swaps them by nonce. Until then it renders provisional (`docs/32`),
 * which is the honest version of "sent" — the server has not said so yet.
 */
export function addPending(
  state: RoomState,
  message: Omit<Message, 'pending'> & { clientNonce: string },
): RoomState {
  const draft = clone(state);
  insert(draft, { ...message, pending: true });
  return draft;
}

/**
 * Back to pending: a retry is in flight.
 *
 * The row keeps its id and its nonce, because it is the same message — the
 * server deduplicates on the nonce, so a retry that lands after the original
 * finally arrived is a no-op rather than a second copy.
 */
export function markPending(state: RoomState, clientNonce: string): RoomState {
  const target = state.messages.find((m) => m.clientNonce === clientNonce && m.failed);
  if (!target) return state;
  const draft = clone(state);
  const { failed: _failed, ...rest } = target;
  replace(draft, { ...rest, pending: true });
  return draft;
}

/** Mark an unacknowledged message as failed, so the UI can offer a retry. */
export function markFailed(state: RoomState, clientNonce: string): RoomState {
  const target = state.messages.find((m) => m.pending && m.clientNonce === clientNonce);
  if (!target) return state;
  const draft = clone(state);
  replace(draft, { ...target, failed: true });
  return draft;
}

/**
 * Mark a message as purged: the server has dropped the bytes.
 *
 * Not a `reduce` case, and it cannot be one. The server's tombstone
 * broadcast carries the **same id as the event it purged** (`apps/server`
 * sends `{ id, payload: '', purgedAt }`), so feeding it through `reduce` would
 * hit the applied set and be discarded as a duplicate of the message it is
 * trying to erase.
 *
 * Distinct from a redaction, and shown differently: a redaction is somebody
 * deciding, a purge is the bytes being gone. Nobody chose it in the room.
 */
export function markPurged(state: RoomState, eventId: string, at: number): RoomState {
  const target = state.byId.get(eventId);
  if (!target || target.purged) return state;

  const draft = clone(state);
  replace(draft, {
    ...target,
    body: '',
    attachments: undefined,
    edits: undefined,
    reactions: undefined,
    annotations: undefined,
    pinned: undefined,
    pinnedAt: undefined,
    purged: true,
    purgedAt: at,
  });
  // Same as a redaction: what was on the noticeboard is gone, and a tombstone
  // pinned to the top of the room is worse than an empty board.
  repin(draft);
  return draft;
}

/** Drop an unacknowledged message — a send the sender gave up on. */
export function dropPending(state: RoomState, clientNonce: string): RoomState {
  const index = state.messages.findIndex((m) => m.pending && m.clientNonce === clientNonce);
  if (index === -1) return state;
  const draft = clone(state);
  const [gone] = draft.messages.splice(index, 1);
  if (gone) {
    draft.byId.delete(gone.id);
    untrack(draft, gone);
  }
  return draft;
}

export { emptyRoom };

/**
 * The payload shapes, loosely.
 *
 * The protocol's union is zod-inferred and discriminated, and narrowing it
 * through a switch here would mean re-deriving all ten variants for no benefit:
 * every branch below reads fields the schema has already validated, and a field
 * that is not there is `undefined`, which every branch already handles.
 */
// biome-ignore lint/suspicious/noExplicitAny: see above
type KnownShape = any;
