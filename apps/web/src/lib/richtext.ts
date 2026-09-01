/**
 * Message body → tokens.
 *
 * Deliberately small. Chat is not a document format, and every construct added
 * here is one more thing that renders differently on three platforms.
 *
 * **Inline:** code spans, links (bare and `[labelled](…)`), @mentions, #rooms,
 * and one level each of bold / italic / strike.
 *
 * **Block:** fenced code, `#` headings, `>` quotes, and `-`/`1.` lists.
 *
 * What is deliberately *absent*: tables, images, footnotes, HTML, and nested
 * lists. Each is a format decision people would then have to get right in a
 * text box, and none of them is a thing anybody has ever wanted mid-sentence.
 *
 * Nothing here ever produces HTML — the caller renders tokens as elements, so
 * a message body cannot inject markup no matter what it contains. That is the
 * property the whole file exists to keep, and it is why a labelled link is a
 * token with a separate `v` and `href` rather than anything resembling markup.
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
  kind: 'text' | 'code' | 'heading' | 'quote' | 'list';
  /** For a fenced block, the language tag if one was given. */
  lang?: string;
  tokens?: Token[];
  raw?: string;
  /** `heading`: 1, 2 or 3. Deeper is a document, not a message. */
  level?: number;
  /** `list`: the items, each already tokenised. */
  items?: Token[][];
  /** `list`: whether it was written `1.` rather than `-`. */
  ordered?: boolean;
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
    // A labelled link, **before** the bare-URL rule. Otherwise the URL inside
    // the parens matches first and the whole thing renders as `[label](` plus
    // a link plus `)`.
    `(\\[[^\\]\\n]{1,200}\\]\\((?:${URL_SOURCE})\\))`,
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
    const [, code, labelled, link, bold, italic, strike, mention, room] = m;
    if (code) out.push({ t: 'code', v: code.slice(1, -1) });
    // `[label](href)`. The label is shown and the href is where it goes, so
    // this is the one construct where those can differ — which is exactly the
    // thing a phishing link wants. `RichText` renders the href in the title
    // attribute for that reason; a link must not be able to say one thing and
    // go somewhere else without that being inspectable.
    else if (labelled) {
      const cut = labelled.lastIndexOf('](');
      out.push({
        t: 'link',
        v: labelled.slice(1, cut),
        href: labelled.slice(cut + 2, -1),
      });
    }
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
      blocks.push(...lines(part));
    }
  });
  return blocks;
}

/**
 * The block grammar, outside code fences.
 *
 * Line-based and single-pass, because everything it supports is decided by the
 * first few characters of a line. Anything that is not a heading, a quote or a
 * list item is prose, and consecutive prose lines stay in **one** block — the
 * renderer sets `white-space: pre-wrap`, so a hard newline inside a paragraph
 * is already a line break and splitting per line would double it.
 *
 * `# ` needs the space. `#general` is a room mention and always was; requiring
 * the space is both what CommonMark says and the only thing keeping the two
 * apart, since a heading and a room reference start with the same character.
 */
function lines(part: string): Block[] {
  const out: Block[] = [];
  /** Prose accumulating until something that is not prose ends it. */
  let prose: string[] = [];
  const flush = () => {
    if (!prose.length) return;
    // Trailing blank lines are the separator that ended the paragraph, not
    // content — keeping them puts an empty line at the bottom of every block.
    const text = prose.join('\n').replace(/\n+$/, '');
    if (text) out.push({ kind: 'text', tokens: inline(text) });
    prose = [];
  };

  for (const line of part.split('\n')) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      out.push({
        kind: 'heading',
        level: heading[1]!.length,
        tokens: inline(heading[2]!),
      });
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      // Consecutive `>` lines are one quote, so quoting a paragraph does not
      // produce a stack of separate bars.
      const last = out[out.length - 1];
      if (last?.kind === 'quote') {
        last.tokens = [...(last.tokens ?? []), { t: 'text', v: '\n' }, ...inline(quote[1]!)];
      } else {
        out.push({ kind: 'quote', tokens: inline(quote[1]!) });
      }
      continue;
    }

    const item = /^\s*(?:([-*+])|(\d{1,3})[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const ordered = !item[1];
      const last = out[out.length - 1];
      // Same list only if it is the same *kind* of list: a bulleted line after
      // a numbered one is a new list, not item four.
      if (last?.kind === 'list' && last.ordered === ordered) {
        last.items = [...(last.items ?? []), inline(item[3]!)];
      } else {
        out.push({ kind: 'list', ordered, items: [inline(item[3]!)] });
      }
      continue;
    }

    prose.push(line);
  }
  flush();
  return out;
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
