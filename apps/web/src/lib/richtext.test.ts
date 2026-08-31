/**
 * The message body tokenizer, and mostly the link half of it.
 *
 * The rule being defended is small and load-bearing: **a link must not be able
 * to say one thing and go somewhere else.** The preview card already argues
 * this — it shows the URL under a title the *sender's* client wrote, so a
 * friendly title cannot hide an unfriendly destination — and the inline link
 * has to hold the same line, because it is the thing people actually click.
 *
 * Written after a report that a URL only appeared in the preview card and not
 * in the message text where it was typed.
 */
import { describe, expect, it } from 'vitest';
import { parse } from './richtext.js';

/** Every token in a body, flattened across blocks. */
function tokens(body: string) {
  return parse(body).flatMap((b) => b.tokens ?? []);
}

const links = (body: string) => tokens(body).filter((t) => t.t === 'link');

describe('links in the body', () => {
  it('appears where it was typed, not only in a preview', () => {
    const ts = tokens('read this https://example.com/a first');
    expect(ts.map((t) => t.t)).toEqual(['text', 'link', 'text']);
    expect(ts[0]).toMatchObject({ v: 'read this ' });
    expect(ts[2]).toMatchObject({ v: ' first' });
  });

  it('hides https:// and nothing else', () => {
    const [link] = links('see https://example.com/a/b?c=d#e');
    expect(link).toMatchObject({
      v: 'example.com/a/b?c=d#e',
      href: 'https://example.com/a/b?c=d#e',
    });
  });

  it('keeps http:// visible, because it means something different', () => {
    // The one part of a scheme worth showing. Hiding it would render an
    // insecure link identically to a secure one.
    const [link] = links('see http://example.com/a');
    expect(link).toMatchObject({ v: 'http://example.com/a', href: 'http://example.com/a' });
  });

  it('never shortens the path, the query, or the fragment', () => {
    // No eliding the middle, no trailing ellipsis. Somebody checking where a
    // link goes has to be able to read all of it.
    const url = 'https://example.com/one/two/three/four?q=a+very+long+value&r=2#section-9';
    const [link] = links(`x ${url}`);
    expect(link?.href).toBe(url);
    expect(link?.v).toBe(url.replace('https://', ''));
  });

  it('does not swallow the punctuation that follows a sentence', () => {
    const ts = tokens('it is at https://example.com/a.');
    const [link] = ts.filter((t) => t.t === 'link');
    expect(link?.href).toBe('https://example.com/a');
    expect(ts[ts.length - 1]).toMatchObject({ t: 'text', v: '.' });
  });

  it('finds every link in a line, not just the first', () => {
    expect(links('https://a.example and https://b.example').map((l) => l.href)).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('keeps a URL whole when it has a #fragment', () => {
    // **The bug this file found.** `#contrast-minimum` matched the `#room` rule
    // before the link rule saw it, so the link stopped at the fragment and the
    // rest rendered as a link to a room that does not exist. Any link to a
    // specific part of a page hit it — including the one in the fixtures.
    const url = 'https://www.w3.org/TR/WCAG22/#contrast-minimum';
    const ts = tokens(`see ${url}`);
    expect(ts.filter((t) => t.t === 'room')).toEqual([]);
    expect(ts.filter((t) => t.t === 'link')[0]?.href).toBe(url);
  });

  it('does not turn an @ inside a URL into a mention', () => {
    const url = 'https://example.com/users/@viola';
    expect(tokens(url).filter((t) => t.t === 'mention')).toEqual([]);
    expect(links(url)[0]?.href).toBe(url);
  });

  it('still finds #rooms and @mentions outside a URL', () => {
    // The fix must not have bought link integrity by breaking the two things
    // that share its punctuation.
    const ts = tokens('@rae see #design and https://example.com/x#y');
    expect(ts.filter((t) => t.t === 'mention').map((t) => t.v)).toEqual(['rae']);
    expect(ts.filter((t) => t.t === 'room').map((t) => t.v)).toEqual(['design']);
    expect(links('@rae see #design and https://example.com/x#y')).toHaveLength(1);
  });

  it('leaves a link inside a code span alone', () => {
    // Code is quoted text, not a destination.
    expect(links('`https://example.com`')).toEqual([]);
  });

  it('produces no markup, whatever the body contains', () => {
    // Tokens are rendered as elements by the caller, so a body cannot inject
    // anything — but the tokenizer must not be the place that changes.
    const ts = tokens('<img src=x onerror=alert(1)> https://example.com');
    expect(ts.some((t) => t.t === 'text' && t.v.includes('<img'))).toBe(true);
    expect(links('<img src=x> https://example.com')).toHaveLength(1);
  });
});
