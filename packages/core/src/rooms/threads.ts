/**
 * Threads, derived.
 *
 * `docs/04` §3 lists "thread indexes" among the reducer's jobs, and this is
 * that index — computed from the messages rather than maintained beside them.
 *
 * Only the **name** is stored in `RoomState` (`m.thread` sets it). Everything
 * else is a fact about which messages carry a `thread`, so deriving it means
 * there is nothing to keep in step: a reply that arrives, is edited, redacted,
 * or turns out to have been a duplicate updates the summary by existing or not
 * existing. A stored count would be a second source of truth for the same
 * question, and the two would eventually disagree on a bad reconnect.
 *
 * `docs/16` is firm about what a thread *is*: "a branch inside a room. **Not a
 * room.**" So there is no thread object, no membership and no separate history.
 * A thread is a parent message and the messages that point at it.
 */
import type { Message, RoomState } from './state.js';
import { compareIds } from './state.js';

export interface ThreadSummary {
  /** The message it branches from. This is the thread's identity. */
  parent: string;
  /** What somebody called it, if anybody did (`m.thread`). */
  name?: string;
  /** Replies, not counting the parent. */
  count: number;
  /** Accounts that have said something in it, in the order they first did. */
  participants: string[];
  /** The newest reply's timestamp, for sorting by liveliness. */
  lastAt: number;
  /** The newest reply's id, for "jump to the end". */
  lastId?: string;
  /** Whether this account has said anything in it. */
  joined: boolean;
}

/**
 * Every thread in a room, newest activity first.
 *
 * `account` decides `joined`, which is what a "your threads" list filters on —
 * `docs/24` puts a thread under its room, and a list of every branch anybody
 * ever started is a list nobody reads.
 */
export function threadsIn(state: RoomState, account?: string): ThreadSummary[] {
  const byParent = new Map<string, Message[]>();
  for (const message of state.messages) {
    if (!message.thread) continue;
    // A redacted reply still counts as activity — somebody spoke here, and the
    // tombstone is still in the branch. A *purged* one is bytes the server
    // dropped, and it is still a message that existed.
    byParent.set(message.thread, [...(byParent.get(message.thread) ?? []), message]);
  }

  const out: ThreadSummary[] = [];
  for (const [parent, replies] of byParent) {
    const participants: string[] = [];
    for (const reply of replies) {
      if (!participants.includes(reply.account)) participants.push(reply.account);
    }
    const last = replies.reduce((a, b) => (compareIds(a.id, b.id) >= 0 ? a : b));
    const name = state.threadNames.get(parent);

    out.push({
      parent,
      ...(name ? { name } : {}),
      count: replies.length,
      participants,
      lastAt: last.at,
      lastId: last.id,
      joined: !!account && participants.includes(account),
    });
  }

  return out.sort((a, b) => b.lastAt - a.lastAt);
}

/** One thread, or undefined if nothing has branched off that message. */
export function threadOf(
  state: RoomState,
  parent: string,
  account?: string,
): ThreadSummary | undefined {
  return threadsIn(state, account).find((t) => t.parent === parent);
}

/**
 * What to call a thread nobody named.
 *
 * The parent's first line, trimmed. Not a generic "Thread" — a list of six
 * identical labels is a list you have to click through one at a time, which is
 * the failure a name is supposed to fix.
 */
export function threadLabel(summary: ThreadSummary, parent?: Message): string {
  if (summary.name) return summary.name;
  const body = typeof parent?.body === 'string' ? parent.body : '';
  const firstLine = body.split('\n')[0]?.trim() ?? '';
  if (!firstLine) return 'Thread';
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine;
}
