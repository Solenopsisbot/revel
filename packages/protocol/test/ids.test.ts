import { describe, expect, it } from 'vitest';
import { SnowflakeFactory, compareIds, isSnowflake, shardOf, timestampOf } from '../src/ids.js';

describe('snowflakes', () => {
  it('round-trips the timestamp', () => {
    const f = new SnowflakeFactory(7);
    const now = Date.now();
    const id = f.next(now);
    expect(timestampOf(id)).toBe(now);
    expect(shardOf(id)).toBe(7);
  });

  it('is strictly increasing within a millisecond', () => {
    const f = new SnowflakeFactory();
    const fixed = Date.now();
    const ids = Array.from({ length: 500 }, () => f.next(fixed));
    for (let i = 1; i < ids.length; i++) {
      expect(compareIds(ids[i]!, ids[i - 1]!)).toBe(1);
    }
  });

  it('sorts lexically-safely by numeric comparison across digit lengths', () => {
    // The trap: ids are decimal strings, so a naive string sort puts "9" after
    // "10". Room ordering depends on this being numeric.
    const sorted = ['9', '10', '100'].sort(compareIds);
    expect(sorted).toEqual(['9', '10', '100']);
  });

  it('never repeats even when the clock goes backwards', () => {
    const f = new SnowflakeFactory();
    const t = Date.now();
    const seen = new Set<string>();
    for (const ms of [t, t + 1, t - 5, t - 5, t + 2, t - 100]) {
      for (let i = 0; i < 20; i++) {
        const id = f.next(ms);
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
  });

  it('stays monotonic across a backwards clock jump', () => {
    const f = new SnowflakeFactory();
    const t = Date.now();
    const a = f.next(t);
    const b = f.next(t - 1000);
    expect(compareIds(b, a)).toBe(1);
  });

  it('rejects an out-of-range shard', () => {
    expect(() => new SnowflakeFactory(-1)).toThrow(RangeError);
    expect(() => new SnowflakeFactory(4096)).toThrow(RangeError);
    expect(() => new SnowflakeFactory(1.5)).toThrow(RangeError);
  });

  it('recognises its own ids and rejects junk', () => {
    expect(isSnowflake(new SnowflakeFactory().next())).toBe(true);
    for (const bad of ['', 'abc', '-1', '1.5', '9'.repeat(21), ' 12']) {
      expect(isSnowflake(bad)).toBe(false);
    }
  });

  it('gives different shards different ids at the same instant', () => {
    const t = Date.now();
    expect(new SnowflakeFactory(1).next(t)).not.toBe(new SnowflakeFactory(2).next(t));
  });
});
