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

const URL_RE = /\bhttps?:\/\/[^\s<>()]+[^\s<>().,!?:;'"]/g;
const INLINE_RE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(~~[^~\n]+~~)|(@[\w-]{1,32})|(#[\w-]{1,64})/g;

/** Split a run of plain text into link and non-link tokens. */
function linkify(s: string, out: Token[]) {
  let last = 0;
  for (const m of s.matchAll(URL_RE)) {
    const i = m.index!;
    if (i > last) out.push({ t: 'text', v: s.slice(last, i) });
    out.push({ t: 'link', v: m[0].replace(/^https?:\/\//, ''), href: m[0] });
    last = i + m[0].length;
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) });
}

function inline(s: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const m of s.matchAll(INLINE_RE)) {
    const i = m.index!;
    if (i > last) linkify(s.slice(last, i), out);
    const [, code, bold, italic, strike, mention, room] = m;
    if (code) out.push({ t: 'code', v: code.slice(1, -1) });
    else if (bold) out.push({ t: 'bold', v: bold.slice(2, -2) });
    else if (italic) out.push({ t: 'italic', v: italic.slice(1, -1) });
    else if (strike) out.push({ t: 'strike', v: strike.slice(2, -2) });
    else if (mention) out.push({ t: 'mention', v: mention.slice(1) });
    else if (room) out.push({ t: 'room', v: room.slice(1) });
    last = i + m[0].length;
  }
  if (last < s.length) linkify(s.slice(last), out);
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
