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
    faces: new Map(state.faces),
    threads: new Map(state.threads),
    applied: new Set(state.applied),
  };
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
      pin(draft, payload);
      return;
    case 'm.annotation':
      annotate(draft, event, payload);
      return;
    case 'room.name':
      draft.name = payload.name;
      draft.topic = payload.topic;
      return;
    case 'room.faces':
      for (const face of payload.faces) draft.faces.set(face.id, face);
      return;
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
  if (!target) return;
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
  if (!target || target.redacted) return;

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
    annotations: undefined,
    redacted: {
      by: isAuthor ? 'author' : 'moderator',
      at: event.at,
      reason: payload.reason,
    },
  });
}

// ---------------------------------------------------------------------------
// Reactions, receipts, pins, annotations
// ---------------------------------------------------------------------------

function react(draft: RoomState, event: LocalEvent, payload: KnownShape): void {
  const target = draft.byId.get(payload.target);
  if (!target || target.redacted || target.purged) return;

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

function pin(draft: RoomState, payload: KnownShape): void {
  const target = draft.byId.get(payload.target);
  if (!target) return;

  if (payload.unpin) {
    draft.pinned = draft.pinned.filter((id) => id !== payload.target);
    replace(draft, { ...target, pinned: undefined });
    return;
  }

  if (!draft.pinned.includes(payload.target)) {
    // Most recently pinned first: a pinned list is a noticeboard, and the new
    // notice goes on top.
    draft.pinned = [payload.target, ...draft.pinned];
  }
  replace(draft, { ...target, pinned: true });
}

function annotate(draft: RoomState, event: LocalEvent, payload: KnownShape): void {
  const target = draft.byId.get(payload.target);
  if (!target || target.redacted || target.purged) return;

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

/** Mark an unacknowledged message as failed, so the UI can offer a retry. */
export function markFailed(state: RoomState, clientNonce: string): RoomState {
  const target = state.messages.find((m) => m.pending && m.clientNonce === clientNonce);
  if (!target) return state;
  const draft = clone(state);
  replace(draft, { ...target, failed: true });
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
