/**
 * The open-redirect guard on `?next=`.
 *
 * This runs on `/signin` and `/signup` — the two pages in the product where
 * somebody is typing a password. A `?next=` that accepted a full URL means
 * `revel.chat/signin?next=https://reve1.chat/app`: you sign in on the real
 * site and land on a copy that asks you to do it again, having watched you
 * treat the first one as trustworthy.
 */
import { describe, expect, it } from 'vitest';
import { safeNext } from './next.js';

describe('where to go after signing in', () => {
  it('takes a same-origin path', () => {
    expect(safeNext('/i/abcd-efgh-ijkl')).toBe('/i/abcd-efgh-ijkl');
    expect(safeNext('/app?space=123')).toBe('/app?space=123');
  });

  it('falls back when there is nothing to go to', () => {
    expect(safeNext(null)).toBe('/app');
    expect(safeNext(undefined)).toBe('/app');
    expect(safeNext('')).toBe('/app');
    expect(safeNext('/i/x', '/somewhere')).toBe('/i/x');
    expect(safeNext(null, '/somewhere')).toBe('/somewhere');
  });

  it('refuses anything that could leave this origin', () => {
    // A full URL, the obvious one.
    expect(safeNext('https://reve1.chat/app')).toBe('/app');
    expect(safeNext('http://evil.example')).toBe('/app');
    // Protocol-relative, which a browser reads as another host despite the
    // leading slash — the case a naive `startsWith('/')` check lets through.
    expect(safeNext('//evil.example/app')).toBe('/app');
    // A backslash, which some browsers treat as a path separator and the URL
    // parser does not. Refused rather than reasoned about.
    expect(safeNext('/\\evil.example')).toBe('/app');
    expect(safeNext('\\\\evil.example')).toBe('/app');
    // Schemes that are not navigation at all.
    expect(safeNext('javascript:alert(1)')).toBe('/app');
    expect(safeNext('data:text/html,<script>')).toBe('/app');
  });
});
