import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EVERYONE,
  Permission as P,
  canActOnRole,
  canGrant,
  everything,
  has,
  hasExact,
  listPermissions,
  parse,
  resolve,
  serialize,
} from '../src/permissions.js';

const role = (roleId: string, bits: bigint) => ({ roleId, bits });

describe('permission bits', () => {
  it('administrator short-circuits has() but not hasExact()', () => {
    expect(has(P.ADMINISTRATOR, P.BAN)).toBe(true);
    expect(hasExact(P.ADMINISTRATOR, P.BAN)).toBe(false);
  });

  it('survives the string round-trip used for storage and JSON', () => {
    const bits = P.VIEW | P.SEND | P.ADMINISTRATOR;
    expect(parse(serialize(bits))).toBe(bits);
    expect(parse(null)).toBe(0n);
    expect(parse(undefined)).toBe(0n);
    expect(parse('')).toBe(0n);
  });

  it('lists exactly the flags held', () => {
    expect(listPermissions(P.VIEW | P.KICK).sort()).toEqual(['KICK', 'VIEW']);
  });

  it('gives @everyone a sensible starting set that excludes moderation', () => {
    expect(has(DEFAULT_EVERYONE, P.SEND)).toBe(true);
    expect(hasExact(DEFAULT_EVERYONE, P.BAN)).toBe(false);
    expect(hasExact(DEFAULT_EVERYONE, P.MANAGE_SPACE)).toBe(false);
  });
});

describe('resolve', () => {
  it('unions the roles', () => {
    const bits = resolve({ roleBits: [role('a', P.VIEW), role('b', P.SEND)] });
    expect(has(bits, P.VIEW)).toBe(true);
    expect(has(bits, P.SEND)).toBe(true);
  });

  it('gives an owner everything regardless of roles', () => {
    expect(resolve({ roleBits: [], isOwner: true })).toBe(everything());
  });

  it('treats an administrator role as everything', () => {
    expect(resolve({ roleBits: [role('a', P.ADMINISTRATOR)] })).toBe(everything());
  });

  it('applies room overrides', () => {
    const bits = resolve({
      roleBits: [role('a', P.VIEW | P.SEND)],
      overrides: [{ roleId: 'a', allow: P.BAN, deny: P.SEND }],
    });
    expect(has(bits, P.BAN)).toBe(true);
    expect(hasExact(bits, P.SEND)).toBe(false);
  });

  it('ignores overrides for roles the account does not hold', () => {
    const bits = resolve({
      roleBits: [role('a', P.VIEW)],
      overrides: [{ roleId: 'other', allow: everything(), deny: 0n }],
    });
    expect(hasExact(bits, P.BAN)).toBe(false);
  });

  it('applies every deny before any allow, so a deny cannot be undone by another role', () => {
    // Two roles, one denying SEND and one allowing it. Order-dependent logic
    // would let the allow win depending on array order; it must not.
    const overrides = [
      { roleId: 'a', allow: 0n, deny: P.SEND },
      { roleId: 'b', allow: P.SEND, deny: 0n },
    ];
    const forwards = resolve({ roleBits: [role('a', P.SEND), role('b', 0n)], overrides });
    const backwards = resolve({
      roleBits: [role('b', 0n), role('a', P.SEND)],
      overrides: [...overrides].reverse(),
    });
    expect(has(forwards, P.SEND)).toBe(true);
    expect(forwards).toBe(backwards);
  });
});

describe('escalation guards', () => {
  it('refuses to grant a permission the actor lacks', () => {
    expect(canGrant(P.VIEW | P.SEND, P.BAN)).toBe(false);
    expect(canGrant(P.VIEW | P.BAN, P.BAN)).toBe(true);
  });

  it('never lets a non-owner grant administrator, even as an administrator', () => {
    expect(canGrant(P.ADMINISTRATOR, P.ADMINISTRATOR)).toBe(false);
    expect(canGrant(everything(), P.ADMINISTRATOR)).toBe(false);
    expect(canGrant(0n, P.ADMINISTRATOR, true)).toBe(true);
  });

  it('lets an administrator grant anything else', () => {
    expect(canGrant(P.ADMINISTRATOR, P.BAN | P.KICK)).toBe(true);
  });

  it('enforces role hierarchy', () => {
    expect(canActOnRole(5, 3)).toBe(true);
    expect(canActOnRole(3, 3)).toBe(false);
    expect(canActOnRole(3, 5)).toBe(false);
    expect(canActOnRole(0, 99, true)).toBe(true);
  });
});
