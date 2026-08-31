/**
 * Message body → tokens.
 *
 * Deliberately small. Chat is not a document format, and every construct added
 * here is one more thing that renders differently on three platforms. What is
 * supported: code spans and fences, links, @mentions, #rooms, and one level
 * each of bold / italic / strike.
 *
 * Nothing here ever produces HTML — the caller renders tokens as elements, so
 * a message body cannot inject markup no matter what it contains.
 */
export type Token =
  | { t: 'text'; v: string }
  | { t: 'link'; v: string; href: string }
  | { t: 'mention'; v: string }
  | { t: 'room'; v: string }
  | { t: 'code'; v: string }
  | { t: 'bold'; v: string }
  | { t: 'italic'; v: string }
  | { t: 'strike'; v: string };

export interface Block {
  kind: 'text' | 'code';
  /** For a fenced block, the language tag if one was given. */
  lang?: string;
  tokens?: Token[];
  raw?: string;
}

/** Shared with `TOKEN_RE` below, so there is one definition of "a URL". */
const URL_SOURCE = 'https?:\\/\\/[^\\s<>()]+[^\\s<>().,!?:;\'"]';

/**
 * One pass, and **the order of the alternatives is the precedence.**
 *
 * There is a real chain here and neither obvious ordering satisfies it alone:
 *
 * - **Code beats links.** A URL in backticks is quoted text — something being
 *   talked *about*, not somewhere to go.
 * - **Links beat `#room` and `@mention`.** This was the other way round, and a
 *   URL containing a `#` was torn in half: `#contrast-minimum` matched the room
 *   rule before the link rule ever saw it, so the link stopped at the fragment
 *   and the rest rendered as a link to a room that does not exist. Any
 *   `example.com/x#y` hit it, which is most links to a specific part of a page.
 *
 * Two nested passes cannot express that — the outer one always wins everywhere
 * — so it is one regex whose alternatives are tried in order at each position.
 * Adding a construct means deciding where in this list it goes.
 */
const TOKEN_RE = new RegExp(
  [
    '(`[^`\\n]+`)', // code — first, so nothing inside it is interpreted
    `(${URL_SOURCE})`, // links — before anything that could match inside a URL
    '(\\*\\*[^*\\n]+\\*\\*)',
    '(\\*[^*\\n]+\\*)',
    '(~~[^~\\n]+~~)',
    '(@[\\w-]{1,32})',
    '(#[\\w-]{1,64})',
  ].join('|'),
  'g',
);

function inline(s: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const m of s.matchAll(TOKEN_RE)) {
    const i = m.index!;
    if (i > last) out.push({ t: 'text', v: s.slice(last, i) });
    const [, code, link, bold, italic, strike, mention, room] = m;
    if (code) out.push({ t: 'code', v: code.slice(1, -1) });
    // Only `https://` is hidden, and only because it is the default everybody
    // assumes. `http://` stays visible: it is the one part of a scheme that
    // means something different, and hiding it would render an insecure link
    // identically to a secure one. Same argument the preview card makes for
    // showing the URL under a sender-written title — a link must not be able to
    // say one thing and go somewhere else.
    else if (link) out.push({ t: 'link', v: link.replace(/^https:\/\//, ''), href: link });
    else if (bold) out.push({ t: 'bold', v: bold.slice(2, -2) });
    else if (italic) out.push({ t: 'italic', v: italic.slice(1, -1) });
    else if (strike) out.push({ t: 'strike', v: strike.slice(2, -2) });
    else if (mention) out.push({ t: 'mention', v: mention.slice(1) });
    else if (room) out.push({ t: 'room', v: room.slice(1) });
    last = i + m[0].length;
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) });
  return out;
}

/**
 * Fenced blocks first, so nothing inside ``` is interpreted. A fence that is
 * never closed still renders as code — matching what the person was clearly
 * in the middle of doing beats matching the grammar.
 */
export function parse(body: string): Block[] {
  const blocks: Block[] = [];
  const parts = body.split(/```/);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const nl = part.indexOf('\n');
      const first = nl < 0 ? part : part.slice(0, nl);
      const isLang = /^[\w+#.-]{0,16}$/.test(first.trim());
      blocks.push({
        kind: 'code',
        lang: isLang && first.trim() ? first.trim() : undefined,
        raw: (isLang ? part.slice(nl + 1) : part).replace(/\n$/, ''),
      });
    } else if (part) {
      blocks.push({ kind: 'text', tokens: inline(part) });
    }
  });
  return blocks;
}

const PICTOGRAPHIC = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|️|‍|\s)+$/u;

/**
 * A message that is nothing but a few emoji gets drawn large.
 *
 * This is the one place emoji get to be the whole message, and shrinking them
 * to body size makes a deliberate gesture look like a typo. Three is the cut:
 * past that it is a wall, not a gesture.
 */
export function jumbo(body: string): boolean {
  const s = body.trim();
  if (!s || !PICTOGRAPHIC.test(s)) return false;
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let n = 0;
  for (const g of seg.segment(s)) {
    if (g.segment.trim()) n++;
    if (n > 3) return false;
  }
  return n > 0;
}
