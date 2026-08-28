import { describe, expect, it } from 'vitest';
import type { Event } from '@revel/protocol';
import { Hub, type Connection } from '../src/hub.js';

const conn = (pub: string, account: string, sink: unknown[]): Connection => ({
  devicePub: pub,
  accountId: account,
  send: (f) => sink.push(f),
});

const event = (over: Partial<Event> = {}): Event => ({
  id: '1',
  room: 'room1',
  sender: 'dev-a',
  class: 'normal',
  epoch: 1,
  payload: 'AAAA',
  size: 4,
  createdAt: Date.now(),
  purgedAt: null,
  clientNonce: 'nonce-abcdefgh',
  ...over,
});

describe('fan-out', () => {
  it('delivers to every subscriber of the room', () => {
    const hub = new Hub();
    const a: unknown[] = [];
    const b: unknown[] = [];
    hub.subscribe('room1', conn('dev-a', 'alice', a));
    hub.subscribe('room1', conn('dev-b', 'bob', b));
    expect(hub.broadcast('room1', event())).toBe(2);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('never delivers to another room', () => {
    const hub = new Hub();
    const other: unknown[] = [];
    hub.subscribe('room2', conn('dev-c', 'carol', other));
    expect(hub.broadcast('room1', event())).toBe(0);
    expect(other).toHaveLength(0);
  });

  it('can exclude the sender', () => {
    const hub = new Hub();
    const mine: unknown[] = [];
    const theirs: unknown[] = [];
    const me = conn('dev-a', 'alice', mine);
    hub.subscribe('room1', me);
    hub.subscribe('room1', conn('dev-b', 'bob', theirs));
    hub.broadcast('room1', event(), { exclude: me });
    expect(mine).toHaveLength(0);
    expect(theirs).toHaveLength(1);
  });

  it('delivers to several devices of one account independently', () => {
    // Per-device leaves mean an account's devices are separate subscribers;
    // if one were treated as "the account", the other would miss messages.
    const hub = new Hub();
    const laptop: unknown[] = [];
    const phone: unknown[] = [];
    hub.subscribe('room1', conn('dev-laptop', 'alice', laptop));
    hub.subscribe('room1', conn('dev-phone', 'alice', phone));
    expect(hub.broadcast('room1', event())).toBe(2);
    expect(laptop).toHaveLength(1);
    expect(phone).toHaveLength(1);
  });

  it('stops delivering after unsubscribe', () => {
    const hub = new Hub();
    const sink: unknown[] = [];
    const c = conn('dev-a', 'alice', sink);
    hub.subscribe('room1', c);
    hub.unsubscribe('room1', c);
    expect(hub.broadcast('room1', event())).toBe(0);
    expect(hub.subscriberCount('room1')).toBe(0);
  });

  it('removes a connection from every room on disconnect', () => {
    const hub = new Hub();
    const sink: unknown[] = [];
    const c = conn('dev-a', 'alice', sink);
    hub.subscribe('room1', c);
    hub.subscribe('room2', c);
    hub.disconnect(c);
    expect(hub.subscriberCount('room1')).toBe(0);
    expect(hub.subscriberCount('room2')).toBe(0);
  });

  it('is idempotent about subscribing twice', () => {
    // A reconnect that re-subscribes must not double-deliver.
    const hub = new Hub();
    const sink: unknown[] = [];
    const c = conn('dev-a', 'alice', sink);
    hub.subscribe('room1', c);
    hub.subscribe('room1', c);
    expect(hub.subscriberCount('room1')).toBe(1);
    hub.broadcast('room1', event());
    expect(sink).toHaveLength(1);
  });

  it('tolerates unsubscribing something that was never subscribed', () => {
    const hub = new Hub();
    expect(() => hub.unsubscribe('nope', conn('x', 'y', []))).not.toThrow();
    expect(() => hub.disconnect(conn('x', 'y', []))).not.toThrow();
  });
});
