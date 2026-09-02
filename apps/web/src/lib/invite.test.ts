/**
 * Spotting an invite link in something somebody typed.
 *
 * The card this drives asks *this* Host about the code, which is safe in the
 * one way that matters: `/invites/<code>` is unauthenticated by design, and the
 * Host minted the code, so nothing is disclosed that it does not already hold.
 * That safety is entirely a property of the link being ours, which is why the
 * origin check is the load-bearing part of this function rather than a detail.
 */
import { describe, expect, it, vi } from 'vitest';
import { inviteIn } from './invite.js';

vi.stubGlobal('location', { origin: 'https://revel.chat' });

const KEY = '/+r+4JGHPU6/bk3K6KuE7iHuYqoHERnFqt+gX4cZ1p8=';

describe('finding an invite in a message', () => {
  it('finds one on its own', () => {
    const found = inviteIn(`https://revel.chat/i/r4vw-qbza-usib#${KEY}`);
    expect(found?.code).toBe('r4vw-qbza-usib');
  });

  it('finds one somebody wrote a sentence around', () => {
    // Which is how anybody actually sends one.
    const found = inviteIn(`come hang out https://revel.chat/i/abcd-efgh-ijkl#${KEY} it's quiet`);
    expect(found?.code).toBe('abcd-efgh-ijkl');
    expect(found?.url).toBe(`https://revel.chat/i/abcd-efgh-ijkl#${KEY}`);
  });

  it('keeps the whole fragment, including the base64 that looks like punctuation', () => {
    // `+`, `/` and `=` are all ordinary base64 and all easy to lose to a
    // careless character class. Losing any of them yields a link that previews
    // and cannot be used.
    expect(inviteIn(`https://revel.chat/i/aaaa-bbbb-cccc#${KEY}`)?.url).toContain(KEY);
  });

  it('ignores an invite to another deployment', () => {
    // We would be asking our Host about a code it never minted, and it would
    // rightly say no — so this renders as an ordinary link instead of a card
    // that says the invite is broken when it is somebody else's and fine.
    expect(inviteIn(`https://example.com/i/abcd-efgh-ijkl#${KEY}`)).toBeNull();
  });

  it('ignores a link with no key, because there is nothing to offer', () => {
    // This is exactly what the address bar holds after `/i/<code>` strips the
    // fragment, so it is a link people really do end up pasting.
    expect(inviteIn('https://revel.chat/i/r4vw-qbza-usib')).toBeNull();
  });

  it('ignores ordinary messages, cheaply', () => {
    expect(inviteIn('the buttons need to feel like you can press them')).toBeNull();
    expect(inviteIn('')).toBeNull();
  });

  it('takes the first when there are two, rather than stacking cards', () => {
    const two = `https://revel.chat/i/aaaa-bbbb-cccc#${KEY} and https://revel.chat/i/dddd-eeee-ffff#${KEY}`;
    expect(inviteIn(two)?.code).toBe('aaaa-bbbb-cccc');
  });
});
